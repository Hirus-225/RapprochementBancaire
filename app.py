"""Assistant de rapprochement bancaire (application Streamlit autonome).

Ce fichier contient à la fois la logique métier et l'interface : c'est le seul
module à déployer avec `requirements.txt`. `script_rapprochement.py` importe ces
fonctions plutôt que de les recopier — ne jamais dupliquer la logique ailleurs.
"""

import io
import re
import unicodedata
from collections import Counter
from datetime import datetime
from pathlib import Path

import pandas as pd
import pdfplumber
import streamlit as st
import streamlit.components.v1 as components
from thefuzz import fuzz

# Manuel de procédure embarqué : servi tel quel dans l'onglet dédié de l'app.
_CHEMIN_MANUEL = Path(__file__).with_name("manuel.html")

# Habillage épuré, cohérent avec le manuel (typographies Fraunces + IBM Plex,
# palette « grand livre »). Les couleurs de fond/texte viennent de config.toml ;
# cette feuille ne fait que la typographie, l'espacement et le style des blocs.
_STYLE = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

/* Bordure translucide et accent de l'habillage. */
:root { --trait: rgba(130,142,133,.30); --accent-fonce: #0A5A49; }

html, body, .stApp, [data-testid="stAppViewContainer"],
[data-testid="stMarkdownContainer"], [data-testid="stWidgetLabel"],
.stButton, .stRadio, .stMetric, .stTabs {
  font-family: "IBM Plex Sans", system-ui, -apple-system, sans-serif;
}
/* Ne jamais toucher aux icônes Material de Streamlit (sinon ligatures en clair). */
[data-testid="stIconMaterial"], .material-icons, .material-icons-outlined,
.material-symbols-rounded, .material-symbols-outlined {
  font-family: 'Material Symbols Rounded', 'Material Symbols Outlined', 'Material Icons' !important;
}
/* Titres en Fraunces ; la couleur vient du thème clair de config.toml. */
h1, h2, h3, h4,
[data-testid="stHeading"] h1, [data-testid="stHeading"] h2, [data-testid="stHeading"] h3 {
  font-family: "Fraunces", Georgia, serif !important;
  font-weight: 500; letter-spacing: -.01em;
}
h1 { font-size: 2.25rem !important; }

/* Colonne principale : allure de document */
.block-container { max-width: 1060px; padding-top: 2.6rem; padding-bottom: 4rem; }

/* Épure : masque le bouton Deploy et le liseré, garde le menu ⋮ */
[data-testid="stAppDeployButton"], [data-testid="stDecoration"], footer { display: none !important; }
header[data-testid="stHeader"] { background: transparent; }

/* Barre latérale */
[data-testid="stSidebar"] { border-right: 1px solid var(--trait); }
[data-testid="stSidebar"] [role="radiogroup"] { gap: .15rem; }

/* Boutons */
.stButton > button, [data-testid="stDownloadButton"] > button {
  border-radius: 8px; font-weight: 600; padding: .55rem 1.15rem; border: 1px solid var(--trait);
  transition: background .15s ease, border-color .15s ease;
}
.stButton > button[kind="primary"]:hover { background: var(--accent-fonce); border-color: var(--accent-fonce); }

/* Indicateurs, façon fiches — fond transparent + bordure fine. */
[data-testid="stMetric"] {
  background: transparent; border: 1px solid var(--trait); border-radius: 10px; padding: .9rem 1.05rem;
}
[data-testid="stMetricValue"] { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
[data-testid="stMetricLabel"] p { font-size: .82rem; opacity: .78; }

/* Onglets */
.stTabs [data-baseweb="tab-list"] { gap: .35rem; border-bottom: 1px solid var(--trait); }
.stTabs [data-baseweb="tab"] { font-weight: 500; }

/* Tableaux de données : chiffres alignés */
[data-testid="stDataFrame"] { font-variant-numeric: tabular-nums; }

/* Zones de dépôt de fichiers */
[data-testid="stFileUploaderDropzone"] { border-radius: 10px; }
</style>
"""


def _appliquer_style():
  """Injecte l'habillage épuré de l'application."""
  st.markdown(_STYLE, unsafe_allow_html=True)


# Valeurs par défaut des tolérances de l'étape 2 (réglables depuis l'interface).
TOLERANCE_JOURS = 4
SCORE_MINIMUM = 80

_MOTIF_DATE = re.compile(r"^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$")
_MOTIF_NOMBRE = re.compile(r"^-?[\d.,]+$")
_MOTIF_NUMERO_PAGE = re.compile(r"^\d{1,3}\s*/\s*\d{1,3}$")
# Numéro de chèque : suite de chiffres suivant un marqueur « N° » / « N ».
_MOTIF_NUMERO_CHEQUE = re.compile(r"\bN\s*°?\s*(\d{3,})")

# Mots-clés permettant de repérer chaque colonne dans la ligne d'en-tête du PDF.
_MOTS_ENTETE = {
    "date": ("date", "op."),
    "libelle": ("libelle", "operation", "operations", "intitule"),
    "valeur": ("valeur",),
    "debit": ("debit", "debits"),
    "credit": ("credit", "credits"),
    "solde": ("solde",),
}

# Lignes de pied de page qui marquent la fin de la zone exploitable.
_MARQUEURS_FIN = ("sauf erreur", "sauf observation")

# Libellés des lignes de synthèse dont on extrait les totaux de contrôle.
_SOLDE_INITIAL = ("solde precedent", "report a nouveau", "ancien solde")
_NOMBRE_OPERATIONS = "nombre de transactions"
_TOTAL_MOUVEMENTS = "total des mouvements"
_SOLDE_FINAL = "solde au"


def _normaliser(texte):
  """Minuscules sans accents, pour comparer des libellés."""
  texte = unicodedata.normalize("NFKD", str(texte))
  texte = "".join(c for c in texte if not unicodedata.combining(c))
  return texte.strip().lower()


def _en_nombre(texte):
  """Convertit '1 234,56', '1.234,56' ou '200 000' en float (None si échec)."""
  brut = (
      str(texte)
      .replace(" ", "")
      .replace(" ", "")
      .replace("€", "")
      .replace("XOF", "")
      .strip()
  )
  if not brut:
    return None
  # Le séparateur décimal est le dernier ',' ou '.' suivi de 1 ou 2 chiffres.
  if re.search(r"[.,]\d{1,2}$", brut):
    separateur = brut[-3] if brut[-3] in ".," else brut[-2]
    entier, _, decimales = brut.rpartition(separateur)
    brut = entier.replace(".", "").replace(",", "") + "." + decimales
  else:
    brut = brut.replace(".", "").replace(",", "")
  try:
    return float(brut)
  except ValueError:
    return None


def _lignes_de_mots(page, tolerance=3.0):
  """Regroupe les mots d'une page en lignes visuelles (haut→bas, gauche→droite)."""
  mots = [m for m in page.extract_words() if m["text"].strip()]
  mots.sort(key=lambda m: (m["top"], m["x0"]))

  lignes = []
  courante = []
  top_reference = None
  for mot in mots:
    if courante and abs(mot["top"] - top_reference) > tolerance:
      lignes.append(sorted(courante, key=lambda m: m["x0"]))
      courante = []
    if not courante:
      top_reference = mot["top"]
    courante.append(mot)
  if courante:
    lignes.append(sorted(courante, key=lambda m: m["x0"]))
  return lignes


def _detecter_colonnes(ligne):
  """Repère la ligne d'en-tête et renvoie l'emprise horizontale de chaque colonne.

  Renvoie None si la ligne n'est pas un en-tête : il faut au minimum une colonne
  Débit et une colonne Crédit pour pouvoir situer les montants.
  """
  emprises = {}
  for mot in ligne:
    texte = _normaliser(mot["text"])
    for colonne, mots_cles in _MOTS_ENTETE.items():
      if texte in mots_cles:
        x0, x1 = emprises.get(colonne, (mot["x0"], mot["x1"]))
        emprises[colonne] = (min(x0, mot["x0"]), max(x1, mot["x1"]))
        break

  if "debit" not in emprises or "credit" not in emprises:
    return None
  return emprises


def _frontieres(emprises):
  """Frontières verticales entre colonnes numériques, déduites de l'en-tête.

  La frontière Date/Libellé n'en fait pas partie : ces colonnes sont alignées à
  gauche alors que leur titre est centré. La date est identifiée autrement, comme
  premier mot de la ligne quand il ressemble à une date.
  """
  ordre = [
      c for c in ("libelle", "valeur", "debit", "credit", "solde") if c in emprises
  ]
  return {
      (gauche, droite): (emprises[gauche][1] + emprises[droite][0]) / 2
      for gauche, droite in zip(ordre, ordre[1:])
  }


def _colonne_du_mot(mot, emprises, frontieres):
  """Attribue un mot à une colonne numérique d'après sa position horizontale."""
  centre = (mot["x0"] + mot["x1"]) / 2
  ordre = [
      c for c in ("libelle", "valeur", "debit", "credit", "solde") if c in emprises
  ]
  for gauche, droite in zip(ordre, ordre[1:]):
    if centre < frontieres[(gauche, droite)]:
      return gauche
  return ordre[-1]


def _lire_ligne_de_synthese(texte_gauche, colonnes, controles):
  """Mémorise les totaux de contrôle imprimés en pied de relevé."""
  debit = _en_nombre("".join(colonnes["debit"]))
  credit = _en_nombre("".join(colonnes["credit"]))
  solde = _en_nombre("".join(colonnes["solde"]))

  if solde is not None and "solde_initial" not in controles:
    if any(texte_gauche.startswith(x) for x in _SOLDE_INITIAL):
      controles["solde_initial"] = solde
  if _NOMBRE_OPERATIONS in texte_gauche:
    controles["nb_debits"] = debit
    controles["nb_credits"] = credit
  elif _TOTAL_MOUVEMENTS in texte_gauche:
    controles["total_debits"] = debit
    controles["total_credits"] = credit
  elif texte_gauche.startswith(_SOLDE_FINAL) and solde is not None:
    controles["solde_final"] = solde


def _extraire_par_coordonnees(pdf):
  """Extrait les opérations en s'appuyant sur la position des colonnes.

  Indispensable pour les relevés sans bordures de tableau : seule la position
  horizontale dit si un montant est au débit ou au crédit, puisqu'une seule des
  deux colonnes est renseignée par ligne.
  """
  operations = []
  controles = {}
  emprises = None
  frontieres = None

  for page in pdf.pages:
    courante = None
    for ligne in _lignes_de_mots(page):
      texte_ligne = _normaliser(" ".join(m["text"] for m in ligne))

      entete = _detecter_colonnes(ligne)
      if entete:
        emprises, frontieres = entete, _frontieres(entete)
        courante = None
        continue

      if emprises is None:
        continue

      # Pied de page : on arrête la lecture de la page en cours.
      if any(marqueur in texte_ligne for marqueur in _MARQUEURS_FIN):
        break
      if _MOTIF_NUMERO_PAGE.match(texte_ligne):
        continue

      limite_gauche = frontieres[
          ("libelle", "valeur" if "valeur" in emprises else "debit")
      ]
      mots_gauche = [m for m in ligne if (m["x0"] + m["x1"]) / 2 < limite_gauche]
      mots_droite = [m for m in ligne if (m["x0"] + m["x1"]) / 2 >= limite_gauche]

      # Une nouvelle opération commence par une date dans la colonne de gauche.
      date_operation = None
      if mots_gauche and _MOTIF_DATE.match(mots_gauche[0]["text"].strip()):
        date_operation = mots_gauche[0]["text"].strip()
        mots_gauche = mots_gauche[1:]

      colonnes = {"valeur": [], "debit": [], "credit": [], "solde": []}
      droite_non_numerique = False
      for mot in mots_droite:
        texte = mot["text"].strip()
        colonne = _colonne_du_mot(mot, emprises, frontieres)
        if colonne == "valeur" and _MOTIF_DATE.match(texte):
          colonnes["valeur"].append(texte)
        elif _MOTIF_NOMBRE.match(texte):
          # Un montant large peut déborder sous l'en-tête « Valeur ».
          colonnes["debit" if colonne == "valeur" else colonne].append(texte)
        else:
          droite_non_numerique = True

      libelle = " ".join(m["text"].strip() for m in mots_gauche).strip()
      montants_presents = any(colonnes[c] for c in ("debit", "credit", "solde"))

      if date_operation:
        debit = _en_nombre("".join(colonnes["debit"])) or 0.0
        credit = _en_nombre("".join(colonnes["credit"])) or 0.0
        courante = {
            "date": date_operation,
            "libelle": libelle,
            "montant": credit - debit,
        }
        operations.append(courante)
      elif droite_non_numerique or montants_presents:
        # Bloc d'adresse, solde d'ouverture, totaux de fin de relevé… : on ferme
        # l'opération en cours pour ne pas polluer son libellé.
        if montants_presents and not droite_non_numerique:
          _lire_ligne_de_synthese(_normaliser(libelle), colonnes, controles)
        courante = None
      elif courante is not None and libelle:
        courante["libelle"] = f"{courante['libelle']} {libelle}".strip()

  return operations, controles


def _colonnes_du_tableau(cellules_normalisees):
  """Repère la position des colonnes utiles sur une ligne d'en-tête de tableau.

  Renvoie None si la ligne n'est pas un en-tête (il faut au minimum les colonnes
  Débit et Crédit pour situer les montants).
  """
  if "debit" not in cellules_normalisees or "credit" not in cellules_normalisees:
    return None
  return {
      "debit": cellules_normalisees.index("debit"),
      "credit": cellules_normalisees.index("credit"),
      "date": next(
          (i for i, c in enumerate(cellules_normalisees) if "date" in c), None
      ),
      "libelle": next(
          (
              i
              for i, c in enumerate(cellules_normalisees)
              if any(x in c for x in ("libelle", "operation", "intitule"))
          ),
          None,
      ),
  }


def _extraire_par_tableaux(pdf):
  """Extrait les opérations en s'appuyant sur le découpage en cellules.

  Chemin adapté aux relevés dont les tableaux sont détectables par pdfplumber :
  contrairement au parseur par coordonnées, le découpage en cellules regroupe
  correctement les libellés longs, y compris quand ils débordent visuellement
  sous les colonnes numériques. La ligne d'en-tête — relue chaque fois qu'elle
  apparaît — donne la position des colonnes Débit et Crédit : indispensable car
  une seule des deux est renseignée par opération.
  """
  operations = []
  colonnes = None
  for page in pdf.pages:
    for table in page.extract_tables():
      for ligne in table:
        cellules = [str(c).strip() if c is not None else "" for c in ligne]
        entete = _colonnes_du_tableau([_normaliser(c) for c in cellules])
        if entete:
          colonnes = entete
          continue

        date_val = next((c for c in cellules if _MOTIF_DATE.match(c)), None)
        if not date_val:
          continue

        # Avec l'en-tête connu, on lit chaque montant à sa colonne. Sinon on
        # retombe sur l'heuristique de position (deux dernières cellules pleines).
        if colonnes and max(colonnes["debit"], colonnes["credit"]) < len(cellules):
          debit = _en_nombre(cellules[colonnes["debit"]]) or 0.0
          credit = _en_nombre(cellules[colonnes["credit"]]) or 0.0
          col_libelle = colonnes["libelle"]
          if col_libelle is not None and col_libelle < len(cellules):
            libelle = cellules[col_libelle]
          else:
            libelle = " ".join(
                c for c in cellules
                if c != date_val and not _MOTIF_NOMBRE.match(c)
            )
        else:
          remplies = [c for c in cellules if c]
          if len(remplies) < 4:
            continue
          debit = _en_nombre(remplies[-2]) or 0.0
          credit = _en_nombre(remplies[-1]) or 0.0
          libelle = " ".join(
              c for c in remplies if c != date_val and not _MOTIF_NOMBRE.match(c)
          )

        operations.append({
            "date": date_val,
            "libelle": libelle,
            "montant": credit - debit,
        })
  return operations


def extraire_releve_pdf(source):
  """Extrait `date | libelle | montant` d'un relevé bancaire PDF.

  `source` accepte un chemin ou un objet fichier. Le montant est signé du point
  de vue de la banque : crédit − débit (positif = entrée sur le compte). Les
  totaux de contrôle du relevé sont déposés dans `df.attrs["controles"]`.
  """
  try:
    with pdfplumber.open(source) as pdf:
      operations, controles = _extraire_par_coordonnees(pdf)
      if not operations:
        operations, controles = _extraire_par_tableaux(pdf), {}
  except Exception as e:
    raise RuntimeError(f"Erreur lors de l'extraction du PDF : {e}")

  if not operations:
    raise ValueError(
        "Aucune opération n'a pu être extraite du relevé PDF. Vérifiez que le"
        " document contient bien un tableau avec des colonnes Débit et Crédit."
    )

  df = pd.DataFrame(operations, columns=["date", "libelle", "montant"])
  df.attrs["controles"] = controles
  return df


def controler_extraction(df_brut):
  """Confronte l'extraction aux totaux de contrôle imprimés sur le relevé.

  L'extraction d'un PDF échoue silencieusement : sans ce recoupement, un relevé
  mal lu produit un rapprochement faux mais d'apparence normale. Renvoie
  `(statut, tableau)` où `statut` vaut True/False, ou None si le relevé ne porte
  aucun total de contrôle exploitable.
  """
  controles = df_brut.attrs.get("controles", {})
  debits = df_brut.loc[df_brut["montant"] < 0, "montant"]
  credits = df_brut.loc[df_brut["montant"] > 0, "montant"]

  attendus = [
      ("Nombre d'opérations au débit", len(debits), controles.get("nb_debits")),
      ("Nombre d'opérations au crédit", len(credits), controles.get("nb_credits")),
      ("Total des débits", float(-debits.sum()), controles.get("total_debits")),
      ("Total des crédits", float(credits.sum()), controles.get("total_credits")),
  ]

  solde_initial = controles.get("solde_initial")
  if solde_initial is not None:
    attendus.append((
        "Solde de clôture recalculé",
        round(solde_initial + credits.sum() + debits.sum(), 2),
        controles.get("solde_final"),
    ))

  lignes = [
      {
          "Contrôle": libelle,
          "Extrait": extrait,
          "Annoncé par le relevé": annonce,
          "Écart": round(extrait - annonce, 2),
      }
      for libelle, extrait, annonce in attendus
      if annonce is not None
  ]
  if not lignes:
    return None, pd.DataFrame()

  tableau = pd.DataFrame(lignes)
  return bool((tableau["Écart"] == 0).all()), tableau


def controler_sens_montants(df_banque, df_compta):
  """Détecte une inversion de signe entre le relevé et la comptabilité.

  Le compte de banque tenu en comptabilité est le miroir du relevé ; se tromper
  de sens ne lève aucune erreur mais ramène le rapprochement à zéro. Renvoie un
  message d'alerte, ou None si le sens paraît cohérent.
  """
  montants_compta = Counter(df_compta["montant"])
  directs = sum(1 for m in df_banque["montant"] if montants_compta[m])
  inverses = sum(1 for m in df_banque["montant"] if montants_compta[-m])

  if inverses > max(5, directs * 1.5):
    return (
        f"Les montants concordent bien mieux en inversant le signe de la"
        f" comptabilité ({inverses} correspondances contre {directs}). Vérifiez"
        " la convention Débit/Crédit du grand livre avant d'exploiter le"
        " résultat."
    )
  return None


def _trouver_colonne(colonnes, mots_cles, exclusions=()):
  """Cherche une colonne par sous-chaîne, en ignorant certaines (ex. 'solde débit')."""
  for exact in (True, False):
    for colonne in colonnes:
      if any(x in colonne for x in exclusions):
        continue
      for cle in mots_cles:
        if (colonne == cle) if exact else (cle in colonne):
          return colonne
  return None


def charger_grand_livre(source):
  """Charge le grand livre comptable et renvoie `date | libelle | montant`.

  Le compte de banque tenu en comptabilité est le miroir du relevé : une entrée
  d'argent est un **débit** en comptabilité mais un **crédit** à la banque. Le
  montant est donc calculé en débit − crédit, pour être directement comparable
  au montant issu du PDF.
  """
  try:
    df = pd.read_excel(source)
    df.columns = [_normaliser(col) for col in df.columns]

    col_date = _trouver_colonne(df.columns, ("date",))
    col_libelle = _trouver_colonne(
        df.columns, ("libelle", "intitule", "piece", "operation")
    )
    col_debit = _trouver_colonne(df.columns, ("debit",), exclusions=("solde",))
    col_credit = _trouver_colonne(df.columns, ("credit",), exclusions=("solde",))

    if not col_date or not col_libelle:
      raise ValueError(
          "Colonnes 'date' ou 'libellé' introuvables dans le fichier Excel."
      )

    if col_debit and col_credit:
      debit = df[col_debit].map(_en_nombre).fillna(0)
      credit = df[col_credit].map(_en_nombre).fillna(0)
      montant = debit - credit
    else:
      col_montant = _trouver_colonne(
          df.columns, ("montant",), exclusions=("solde",)
      )
      if not col_montant:
        raise ValueError(
            "Impossible de trouver les colonnes Débit/Crédit ou Montant dans la"
            " comptabilité."
        )
      montant = df[col_montant].map(_en_nombre)

    return pd.DataFrame({
        "date": df[col_date],
        "libelle": df[col_libelle],
        "montant": montant,
    })

  except Exception as e:
    raise RuntimeError(f"Erreur lors du chargement du fichier Excel : {e}")


def nettoyer_donnees(df):
  """Standardise libellés, montants et dates (chaînes 'YYYY-MM-DD')."""
  df = df.copy()
  if df.empty:
    return df

  df["libelle"] = (
      df["libelle"]
      .astype(str)
      .str.replace(r"\s+", " ", regex=True)
      .str.strip()
      .str.upper()
  )

  if pd.api.types.is_numeric_dtype(df["montant"]):
    df["montant"] = pd.to_numeric(df["montant"], errors="coerce")
  else:
    df["montant"] = df["montant"].map(_en_nombre)
  df["montant"] = df["montant"].round(2)

  if pd.api.types.is_datetime64_any_dtype(df["date"]):
    dates = df["date"]
  else:
    dates = pd.to_datetime(
        df["date"].astype(str).str.strip(), errors="coerce", dayfirst=True
    )
  df["date"] = dates.dt.strftime("%Y-%m-%d")

  df = df.dropna(subset=["date", "montant"])
  # Une écriture à zéro n'a rien à rapprocher et fausserait les appariements.
  df = df[df["montant"] != 0]
  return df.reset_index(drop=True)


def _numero_cheque(libelle):
  """Extrait le numéro de chèque d'un libellé, zéros de tête ignorés.

  Le numéro suit un marqueur « N° » / « N » ; renvoie None en son absence (agios,
  frais, retraits… n'en portent pas). Normaliser les zéros de tête est
  indispensable : la banque écrit « N° 0412083 » là où la compta écrit
  « N°412083 » — sans quoi le numéro, seul jeton discriminant entre les deux
  libellés, ne concorde même pas.
  """
  correspondance = _MOTIF_NUMERO_CHEQUE.search(str(libelle).upper())
  if not correspondance:
    return None
  return correspondance.group(1).lstrip("0") or "0"


def executer_rapprochement(
    df_banque,
    df_compta,
    tolerance_jours=TOLERANCE_JOURS,
    score_minimum=SCORE_MINIMUM,
):
  """Rapproche les deux sources en trois passes.

  1. Match parfait : même montant et même date.
  2. Match par numéro de chèque : même montant et même numéro de chèque, quelle
     que soit la date (la compta date le chèque à l'émission, la banque à
     l'encaissement — l'écart dépasse souvent la tolérance).
  3. Match partiel : même montant, date à ±`tolerance_jours` jours et
     similarité des libellés > `score_minimum`.
  """
  b = df_banque.copy()
  c = df_compta.copy()
  b["statut"] = "Non rapproché"
  c["statut"] = "Non rapproché"

  colonnes_resultat = [
      "ID_Match",
      "Type_Match",
      "Date_Banque",
      "Libelle_Banque",
      "Montant_Banque",
      "Date_Compta",
      "Libelle_Compta",
      "Montant_Compta",
      "Score_Similarité",
  ]
  operations_rapprochees = []
  match_id = 1

  def enregistrer(idx_b, row_b, idx_c, row_c, type_match, score):
    nonlocal match_id
    operations_rapprochees.append({
        "ID_Match": match_id,
        "Type_Match": type_match,
        "Date_Banque": row_b["date"],
        "Libelle_Banque": row_b["libelle"],
        "Montant_Banque": row_b["montant"],
        "Date_Compta": row_c["date"],
        "Libelle_Compta": row_c["libelle"],
        "Montant_Compta": row_c["montant"],
        "Score_Similarité": score,
    })
    b.loc[idx_b, "statut"] = "Rapproché"
    c.loc[idx_c, "statut"] = "Rapproché"
    match_id += 1

  # Étape 1 : montant et date identiques. À candidats multiples, on retient le
  # libellé le plus ressemblant pour ne pas apparier deux opérations jumelles au
  # hasard de l'ordre des lignes.
  for idx_b, row_b in b[b["statut"] == "Non rapproché"].iterrows():
    candidats = c[
        (c["statut"] == "Non rapproché")
        & (c["montant"] == row_b["montant"])
        & (c["date"] == row_b["date"])
    ]
    if candidats.empty:
      continue
    idx_c = max(
        candidats.index,
        key=lambda i: fuzz.ratio(row_b["libelle"], c.at[i, "libelle"]),
    )
    enregistrer(idx_b, row_b, idx_c, c.loc[idx_c], "Parfait", 100)

  # Étape 2 : même montant et même numéro de chèque, sans contrainte de date.
  # Le numéro identifie l'opération de façon fiable même quand les libellés
  # diffèrent (« SORT DE CHEQUE CHQ N° 0412083 » côté banque contre
  # « CHQ N°412083 CHIMIE COLLECTIVITES » côté compta).
  b["cheque"] = b["libelle"].map(_numero_cheque)
  c["cheque"] = c["libelle"].map(_numero_cheque)
  for idx_b, row_b in b[b["statut"] == "Non rapproché"].iterrows():
    if not row_b["cheque"]:
      continue
    candidats = c[
        (c["statut"] == "Non rapproché")
        & (c["montant"] == row_b["montant"])
        & (c["cheque"] == row_b["cheque"])
    ]
    if candidats.empty:
      continue
    date_b = datetime.strptime(row_b["date"], "%Y-%m-%d")
    idx_c = min(
        candidats.index,
        key=lambda i: abs(
            (date_b - datetime.strptime(c.at[i, "date"], "%Y-%m-%d")).days
        ),
    )
    enregistrer(
        idx_b,
        row_b,
        idx_c,
        c.loc[idx_c],
        "Numéro de chèque",
        fuzz.token_set_ratio(row_b["libelle"], c.at[idx_c, "libelle"]),
    )

  # Étape 3 : montant identique, date tolérée, libellés proches.
  for idx_b, row_b in b[b["statut"] == "Non rapproché"].iterrows():
    date_b = datetime.strptime(row_b["date"], "%Y-%m-%d")
    candidats = c[
        (c["statut"] == "Non rapproché") & (c["montant"] == row_b["montant"])
    ]

    meilleur_idx_c = None
    meilleur_score = 0
    for idx_c, row_c in candidats.iterrows():
      date_c = datetime.strptime(row_c["date"], "%Y-%m-%d")
      if abs((date_b - date_c).days) > tolerance_jours:
        continue
      score = fuzz.token_set_ratio(row_b["libelle"], row_c["libelle"])
      if score > score_minimum and score > meilleur_score:
        meilleur_score = score
        meilleur_idx_c = idx_c

    if meilleur_idx_c is not None:
      enregistrer(
          idx_b,
          row_b,
          meilleur_idx_c,
          c.loc[meilleur_idx_c],
          "Partiel (Tolérance date & libellé)",
          meilleur_score,
      )

  df_rapproches = pd.DataFrame(operations_rapprochees, columns=colonnes_resultat)
  df_manquants_compta = b[b["statut"] == "Non rapproché"][
      ["date", "libelle", "montant"]
  ]
  df_manquants_banque = c[c["statut"] == "Non rapproché"][
      ["date", "libelle", "montant"]
  ]
  return df_rapproches, df_manquants_compta, df_manquants_banque


def ecrire_resultats(writer, df_rap, df_mq_compta, df_mq_banque, df_controles=None):
  """Écrit les feuilles du classeur de résultat."""
  df_rap.to_excel(writer, sheet_name="Opérations rapprochées", index=False)
  df_mq_compta.to_excel(writer, sheet_name="Manquants en compta", index=False)
  df_mq_banque.to_excel(writer, sheet_name="Manquants en banque", index=False)
  if df_controles is not None and not df_controles.empty:
    df_controles.to_excel(writer, sheet_name="Contrôles extraction", index=False)


def _afficher_manuel():
  """Affiche le manuel de procédure (page HTML autonome) dans l'application."""
  try:
    manuel = _CHEMIN_MANUEL.read_text(encoding="utf-8")
  except OSError:
    st.error(
        "Le manuel de procédure est introuvable. Vérifiez que le fichier"
        f" `{_CHEMIN_MANUEL.name}` est bien présent à côté de `app.py`."
    )
    return
  # L'application est en thème clair : on force le manuel en clair pour rester
  # cohérent (il est théma-conscient et suivrait sinon le système).
  manuel = manuel.replace(
      '<html lang="fr">', '<html lang="fr" data-theme="light">', 1
  )
  components.html(manuel, height=900, scrolling=True)


def _afficher_controles(statut, tableau):
  """Affiche le recoupement entre l'extraction et les totaux du relevé."""
  if statut is None:
    st.warning(
        "Ce relevé ne comporte pas de totaux de contrôle exploitables :"
        " l'extraction n'a pas pu être vérifiée automatiquement. Recoupez le"
        " nombre d'opérations et les totaux avant d'exploiter le résultat."
    )
    return
  if statut:
    with st.expander("Extraction vérifiée sur les totaux du relevé"):
      st.dataframe(tableau, use_container_width=True, hide_index=True)
  else:
    st.error(
        "L'extraction ne correspond pas aux totaux imprimés sur le relevé :"
        " des opérations ont été mal lues ou omises. Le rapprochement ci-dessous"
        " n'est pas fiable."
    )
    st.dataframe(tableau, use_container_width=True, hide_index=True)


def _interface():
  """Interface Streamlit."""
  st.set_page_config(
      page_title="Rapprochement bancaire",
      page_icon=":material/account_balance:",
      layout="wide",
  )
  _appliquer_style()

  _PAGE_RAPP = "Rapprochement"
  _PAGE_MANUEL = "Manuel de procédure"
  with st.sidebar:
    st.caption("RAPPROCHEMENT BANCAIRE")
    page = st.radio("Navigation", (_PAGE_RAPP, _PAGE_MANUEL), label_visibility="collapsed")
    st.divider()

  if page == _PAGE_MANUEL:
    st.title("Manuel de procédure")
    st.caption(
        "Guide d'utilisation de l'assistant. Revenez au rapprochement via la"
        " barre latérale."
    )
    _afficher_manuel()
    return

  st.title("Assistant de rapprochement bancaire")
  st.markdown(
      "Importez votre relevé bancaire au format PDF et votre grand livre"
      " comptable en Excel pour lancer le rapprochement automatique."
  )

  with st.sidebar:
    st.subheader("Paramètres")
    st.caption(
        "Ces réglages ne concernent que le **match partiel** : les opérations de"
        " même montant et même date sont toujours rapprochées."
    )
    tolerance_jours = st.slider(
        "Tolérance sur la date (jours)",
        min_value=0,
        max_value=15,
        value=TOLERANCE_JOURS,
        help="Écart maximal accepté entre la date bancaire et la date comptable.",
    )
    score_minimum = st.slider(
        "Similarité minimale des libellés (%)",
        min_value=50,
        max_value=100,
        value=SCORE_MINIMUM,
        help=(
            "Plus la valeur est basse, plus l'outil rapproche — au risque"
            " d'appariements erronés."
        ),
    )

  col1, col2 = st.columns(2)
  with col1:
    st.subheader("1. Relevé Bancaire")
    uploaded_pdf = st.file_uploader(
        "Déposez le relevé PDF ici", type=["pdf"], key="pdf"
    )
  with col2:
    st.subheader("2. Grand Livre Comptable")
    uploaded_excel = st.file_uploader(
        "Déposez le grand livre Excel ici", type=["xlsx", "xls"], key="excel"
    )

  if not (uploaded_pdf and uploaded_excel):
    st.info(
        "Veuillez importer les deux fichiers pour activer le bouton de lancement."
    )
    return

  if not st.button(
      "Lancer le rapprochement", type="primary", use_container_width=True
  ):
    return

  with st.spinner("Traitement en cours..."):
    try:
      # pdfplumber accepte directement le buffer de l'upload Streamlit.
      df_banque_brut = extraire_releve_pdf(io.BytesIO(uploaded_pdf.getvalue()))
      df_compta_brut = charger_grand_livre(uploaded_excel)

      statut_controle, df_controles = controler_extraction(df_banque_brut)

      df_banque = nettoyer_donnees(df_banque_brut)
      df_compta = nettoyer_donnees(df_compta_brut)

      if df_banque.empty:
        st.error(
            "Aucune opération exploitable dans le relevé PDF après nettoyage."
            " Aperçu de l'extraction brute :"
        )
        st.dataframe(df_banque_brut, use_container_width=True)
        return
      if df_compta.empty:
        st.error(
            "Aucune écriture exploitable dans le grand livre après nettoyage."
        )
        return

      _afficher_controles(statut_controle, df_controles)

      alerte_sens = controler_sens_montants(df_banque, df_compta)
      if alerte_sens:
        st.warning(alerte_sens)

      df_rap, df_mq_compta, df_mq_banque = executer_rapprochement(
          df_banque, df_compta, tolerance_jours, score_minimum
      )

      st.success("Rapprochement effectué avec succès !")

      m1, m2, m3, m4 = st.columns(4)
      m1.metric("Opérations Rapprochées", len(df_rap))
      m2.metric("Manquants en Compta", len(df_mq_compta))
      m3.metric("Manquants en Banque", len(df_mq_banque))
      m4.metric(
          "Taux de rapprochement", f"{len(df_rap) / len(df_banque) * 100:.1f} %"
      )

      onglet1, onglet2, onglet3 = st.tabs([
          f"Rapprochées ({len(df_rap)})",
          f"Dans la banque, absentes en compta ({len(df_mq_compta)})",
          f"En compta, absentes de la banque ({len(df_mq_banque)})",
      ])
      onglet1.dataframe(df_rap, use_container_width=True, hide_index=True)
      onglet2.dataframe(df_mq_compta, use_container_width=True, hide_index=True)
      onglet3.dataframe(df_mq_banque, use_container_width=True, hide_index=True)

      output = io.BytesIO()
      with pd.ExcelWriter(output, engine="openpyxl") as writer:
        ecrire_resultats(writer, df_rap, df_mq_compta, df_mq_banque, df_controles)

      st.markdown("---")
      st.download_button(
          label="Télécharger le résultat (Excel)",
          data=output.getvalue(),
          file_name="resultat_rapprochement.xlsx",
          mime=(
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          ),
          use_container_width=True,
      )

    except Exception as e:
      st.error(f"Une erreur est survenue lors du traitement : {e}")


if __name__ == "__main__":
  _interface()
