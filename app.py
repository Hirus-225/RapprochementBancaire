"""Rapprochement bancaire — logique métier de référence (Python).

Le site (dossier `web/`, en JavaScript) est l'application publiée. Ce module en
est la référence : `script_reference_js.py` l'exécute sur les jeux de
`data_entree/` et la page `web/tests/tests.html` vérifie que la version
JavaScript reproduit ses résultats à l'identique. `script_rapprochement.py`
l'utilise pour les traitements en lot. Toute modification de la logique se fait
ici ET dans `web/js/`, puis se valide par la page de tests (zéro écart).
"""

import math
import numbers
import re
import unicodedata
from collections import Counter
from datetime import datetime

import pandas as pd
import pdfplumber
from thefuzz import fuzz


# Valeurs par défaut des réglages de l'étape 3 (match partiel).
TOLERANCE_JOURS = 4
SCORE_MINIMUM = 80

# Le mois est chiffré (« 30/01/2026 ») ou abrégé en lettres (« 30-Jan-2026 »).
_MOTIF_DATE = re.compile(r"^\d{1,2}[/.-](?:\d{1,2}|[A-Za-z]{3,9})[/.-]\d{2,4}$")
# Numérotation de ligne (« 1. », « 2. »…) précédant la date sur certains relevés.
_MOTIF_NUMERO_LIGNE = re.compile(r"^\d{1,3}\.$")
_MOTIF_NOMBRE = re.compile(r"^-?[\d.,]+$")
_MOTIF_NUMERO_PAGE = re.compile(r"^\d{1,3}\s*/\s*\d{1,3}$")
# Pied de page « n° de page + date et heure d'édition » (« 1 09 Feb 2026, 10:23 »).
_MOTIF_PIED_HORODATE = re.compile(
    r"^\d{1,3}\s+\d{1,2}[\s/.-][a-z0-9]{2,9}[\s/.-]\d{2,4},?\s+\d{1,2}:\d{2}$"
)
# Devise accolée au montant (« XOF6,000.00 ») : retirée avant lecture du nombre.
_MOTIF_DEVISE = re.compile(r"^(?:XOF|F\.?CFA|CFA|EUR|USD)", re.IGNORECASE)
# Numéro de chèque : suite de chiffres suivant un marqueur « N° » / « N ». Le
# « N » se trouve parfois soudé au mot qui le précède (« CHEQUEN 3521911 »).
_MOTIF_NUMERO_CHEQUE = re.compile(r"(?:\bN|\bCHEQUEN)\s*°?\s*(\d{3,})")

# Mots-clés permettant de repérer chaque colonne dans la ligne d'en-tête du PDF.
_MOTS_ENTETE = {
    "date": ("date", "op."),
    "libelle": (
        "libelle", "operation", "operations", "intitule", "details",
        "description",
    ),
    "reference": ("reference",),
    "valeur": ("valeur", "value"),
    "debit": ("debit", "debits", "payments", "withdrawals"),
    "credit": ("credit", "credits", "deposits"),
    "solde": ("solde", "balance"),
}

# Écart horizontal (en points) au-delà duquel deux mots d'en-tête relèvent de
# deux colonnes distinctes ; en deçà ils forment un seul intitulé (« Montant
# Débit »). Sur les relevés connus, les mots d'un même intitulé sont séparés de
# 1,9 à 4,0 points et deux colonnes voisines d'au moins 8,8 : 6 tombe au milieu.
# Seule exception, le relevé Ecobank ne laisse que 7,4 points entre « Transaction
# Date » et « Description » — sans conséquence si les deux fusionnaient, la
# colonne Date ne servant jamais à situer un mot. À réexaminer si un relevé
# arrive dans un corps nettement plus gros.
_ECART_ENTETE = 6

# Lignes de pied de page qui marquent la fin de la zone exploitable.
_MARQUEURS_FIN = ("sauf erreur", "sauf observation")

# Libellés des lignes de synthèse dont on extrait les totaux de contrôle.
_SOLDE_INITIAL = ("solde precedent", "report a nouveau", "ancien solde")
_NOMBRE_OPERATIONS = "nombre de transactions"
_TOTAL_MOUVEMENTS = "total des mouvements"
_SOLDE_FINAL = "solde au"

# Certains relevés n'impriment pas leurs totaux sur les colonnes Débit/Crédit
# mais dans un cartouche d'en-tête, sous la forme « libellé : montant ». Le
# montant est capté en tolérant l'espace ou le point comme séparateur de
# milliers, sans jamais déborder sur le montant suivant de la même ligne ; la
# devise peut lui être accolée (« Total Debit XOF33,336,584.00 »).
_MONTANT_CARTOUCHE = (
    r"(?:xof|f\.?cfa|cfa|eur|usd)?\s*"
    r"(-?\d{1,3}(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?)"
)
_CARTOUCHE = (
    (
        "solde_initial",
        r"ancien solde|solde precedent|report a nouveau|opening balance",
    ),
    ("solde_final", r"nouveau solde|solde final|closing balance"),
    ("total_credits", r"(?:somme|total)(?: des)? credits?"),
    ("total_debits", r"(?:somme|total)(?: des)? debits?"),
)


def _normaliser(texte):
  """Minuscules sans accents, pour comparer des libellés."""
  texte = unicodedata.normalize("NFKD", str(texte))
  texte = "".join(c for c in texte if not unicodedata.combining(c))
  return texte.strip().lower()


def _en_nombre(texte):
  """Convertit '1 234,56', '1.234,56' ou '200 000' en float (None si échec).

  Une valeur déjà numérique — cellule Excel — est rendue telle quelle. La faire
  passer par son écriture texte serait faux sans rien lever : `1234.5600000000001`
  (résidu de calcul) ou `1234.567` perdraient leur point, pris pour un séparateur
  de milliers, et vaudraient 12345600000000001 ou 1234567.
  """
  if isinstance(texte, numbers.Number) and not isinstance(texte, bool):
    valeur = float(texte)
    return valeur if math.isfinite(valeur) else None

  # Toutes les espaces sont retirées, y compris les insécables (U+00A0, U+202F)
  # que les exports comptables français placent entre les milliers : sans quoi
  # « 1 234,56 » resterait illisible et la ligne disparaîtrait au nettoyage.
  brut = re.sub(r"\s+", "", str(texte)).replace("€", "").replace("XOF", "")
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


def _grouper_entete(ligne):
  """Regroupe les mots contigus de la ligne d'en-tête en intitulés de colonnes."""
  groupes = []
  for mot in ligne:
    if groupes and mot["x0"] - groupes[-1][-1]["x1"] <= _ECART_ENTETE:
      groupes[-1].append(mot)
    else:
      groupes.append([mot])
  return groupes


def _detecter_colonnes(ligne):
  """Repère la ligne d'en-tête et renvoie l'emprise horizontale de chaque colonne.

  Chaque colonne est reconnue sur son intitulé entier — « Montant Débit »,
  « Date de valeur » — pour que son emprise couvre toute sa largeur : réduite au
  seul mot-clé, elle démarrerait trop à droite et le montant le plus large
  tomberait hors de sa propre colonne. Un intitulé qui porte deux mots-clés est
  arbitré par ordre de spécificité (« Date de valeur » est la colonne Valeur).

  Renvoie None si la ligne n'est pas un en-tête : il faut au minimum une colonne
  Débit et une colonne Crédit pour pouvoir situer les montants, et aucun
  chiffre — une ligne de cartouche « Total Debit … Total Credit … » porte les
  deux mots-clés mais n'est pas un en-tête.
  """
  if any(c.isdigit() for mot in ligne for c in mot["text"]):
    return None

  emprises = {}
  for groupe in _grouper_entete(ligne):
    mots = [_normaliser(m["text"]) for m in groupe]
    colonne = next(
        (
            c
            for c in (
                "debit", "credit", "solde", "valeur", "libelle", "reference",
                "date",
            )
            if any(m in _MOTS_ENTETE[c] for m in mots)
        ),
        None,
    )
    if colonne is not None and colonne not in emprises:
      emprises[colonne] = (groupe[0]["x0"], groupe[-1]["x1"])

  if "debit" not in emprises or "credit" not in emprises:
    return None
  return emprises


def _ordre_colonnes(emprises):
  """Colonnes classées de gauche à droite d'après l'en-tête, la date exceptée.

  L'ordre n'est pas le même d'un relevé à l'autre : la colonne Valeur suit le
  libellé sur les uns et le précède sur les autres. Le déduire des positions
  évite d'avoir à le figer. La colonne Date en est écartée : elle sert de repère
  de gauche, jamais à situer un montant.
  """
  return sorted(
      (c for c in emprises if c != "date"), key=lambda c: emprises[c][0]
  )


def _frontieres(emprises):
  """Frontières verticales entre colonnes, déduites de l'en-tête.

  La frontière Date/Libellé n'en fait pas partie : ces colonnes sont alignées à
  gauche alors que leur titre est centré. La date est identifiée autrement, par
  son allure en tête de la zone de gauche.
  """
  ordre = _ordre_colonnes(emprises)
  return {
      (gauche, droite): (emprises[gauche][1] + emprises[droite][0]) / 2
      for gauche, droite in zip(ordre, ordre[1:])
  }


def _colonne_du_mot(mot, emprises, frontieres):
  """Attribue un mot à une colonne numérique d'après sa position horizontale."""
  centre = (mot["x0"] + mot["x1"]) / 2
  ordre = _ordre_colonnes(emprises)
  for gauche, droite in zip(ordre, ordre[1:]):
    if centre < frontieres[(gauche, droite)]:
      return gauche
  return ordre[-1]


def _limite_zone_gauche(emprises):
  """Abscisse séparant la zone « date + libellé » des colonnes numériques.

  La coupure se fait au bord gauche de la colonne qui suit le libellé, et non à
  mi-chemin : un libellé long déborde volontiers vers les colonnes voisines, et
  le point milieu ferait basculer sa fin du côté des montants, où elle se
  collerait au montant sans rien lever comme erreur.
  """
  ordre = _ordre_colonnes(emprises)
  if "libelle" in ordre:
    rang = ordre.index("libelle")
    if rang + 1 < len(ordre):
      return emprises[ordre[rang + 1]][0]
  # En-tête sans intitulé de libellé reconnu : la première colonne numérique
  # sert de repère, elle est toujours présente (`_detecter_colonnes`).
  return min(emprises["debit"][0], emprises["credit"][0])


def _valeur_avant_libelle(emprises):
  """Vrai si la colonne Valeur précède le libellé, donc reste en zone gauche."""
  if "valeur" not in emprises or "libelle" not in emprises:
    return False
  return emprises["valeur"][0] < emprises["libelle"][0]


def _detacher_date(mots, valeur_a_gauche):
  """Isole la date d'opération en tête de la zone de gauche.

  La date n'est pas toujours le premier mot : certains relevés numérotent leurs
  lignes (« 1. », « 2. »…) et impriment la date de valeur juste après la date
  d'opération, avant le libellé. Renvoie `(date, mots restants)`, la date valant
  None quand la ligne n'en ouvre pas une nouvelle (suite de libellé).
  """
  restants = mots
  if (
      len(restants) >= 2
      and _MOTIF_NUMERO_LIGNE.match(restants[0]["text"].strip())
      and _MOTIF_DATE.match(restants[1]["text"].strip())
  ):
    restants = restants[1:]

  if not restants or not _MOTIF_DATE.match(restants[0]["text"].strip()):
    return None, mots

  date_operation = restants[0]["text"].strip()
  restants = restants[1:]
  # Colonne Valeur placée avant le libellé : la seconde date est la date de
  # valeur, elle n'appartient pas au libellé.
  if (
      valeur_a_gauche
      and restants
      and _MOTIF_DATE.match(restants[0]["text"].strip())
  ):
    restants = restants[1:]
  return date_operation, restants


def _lire_cartouche(texte, controles):
  """Capte les totaux de contrôle écrits « libellé : montant » en tête de relevé.

  Complète `_lire_ligne_de_synthese`, qui lit les totaux imprimés en pied sur les
  colonnes Débit/Crédit. Sans ce second chemin, un relevé qui annonce pourtant
  ses totaux resterait invérifiable.
  """
  for cle, motif in _CARTOUCHE:
    if cle in controles:
      continue
    trouve = re.search(f"(?:{motif})" + r"\s*:?\s*" + _MONTANT_CARTOUCHE, texte)
    if trouve:
      montant = _en_nombre(trouve.group(1))
      if montant is not None:
        controles[cle] = montant


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
  valeur_a_gauche = False

  for page in pdf.pages:
    courante = None
    for ligne in _lignes_de_mots(page):
      texte_ligne = _normaliser(" ".join(m["text"] for m in ligne))

      entete = _detecter_colonnes(ligne)
      if entete:
        emprises, frontieres = entete, _frontieres(entete)
        valeur_a_gauche = _valeur_avant_libelle(entete)
        courante = None
        continue

      if emprises is None:
        # Avant l'en-tête : seul le cartouche de totaux nous intéresse.
        _lire_cartouche(texte_ligne, controles)
        continue

      # Pied de page : on arrête la lecture de la page en cours.
      if any(marqueur in texte_ligne for marqueur in _MARQUEURS_FIN):
        break
      if _MOTIF_NUMERO_PAGE.match(texte_ligne) or _MOTIF_PIED_HORODATE.match(
          texte_ligne
      ):
        continue

      limite_gauche = _limite_zone_gauche(emprises)
      mots_gauche = [m for m in ligne if (m["x0"] + m["x1"]) / 2 < limite_gauche]
      mots_droite = [m for m in ligne if (m["x0"] + m["x1"]) / 2 >= limite_gauche]

      # Une nouvelle opération s'ouvre sur une date dans la zone de gauche.
      date_operation, mots_gauche = _detacher_date(mots_gauche, valeur_a_gauche)

      colonnes = {"valeur": [], "debit": [], "credit": [], "solde": []}
      droite_non_numerique = False
      for mot in mots_droite:
        texte = _MOTIF_DEVISE.sub("", mot["text"].strip())
        colonne = _colonne_du_mot(mot, emprises, frontieres)
        if colonne == "reference":
          # Référence interne de la banque, intercalée entre le libellé et les
          # montants : ni l'un ni l'autre, et elle couperait le libellé en deux
          # (« PAIEMENT CHEQUE N » … « 3521913 » sur la ligne suivante).
          continue
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
