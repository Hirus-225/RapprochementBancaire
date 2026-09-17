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
from thefuzz import fuzz

# Manuel de procédure : `docs/MANUEL-PROCEDURE.md` est la seule source. Il est
# lu depuis le disque et rendu tel quel dans l'onglet dédié — recopier son texte
# dans une constante Python créerait deux versions du même document, qui
# divergeraient à la première correction.
_CHEMIN_MANUEL = Path(__file__).parent / "docs" / "MANUEL-PROCEDURE.md"

# ---------------------------------------------------------------------------
# Design system « Assistant de rapprochement » — volet CSS.
#
# Les jetons ci-dessous sont ceux du kit ; ils sont repris à l'identique dans
# `.streamlit/config.toml` (ce que Streamlit peint lui-même : widgets,
# dataframes, alertes, rayons, typographie). Toute retouche de palette doit
# passer par les deux fichiers.
#
# Cette feuille ne fait que ce que le thème Streamlit ne sait pas exprimer :
# les composants du kit (navigation, boutons, zones de dépôt, onglets,
# indicateurs) et les chiffres en tabulaire.
# ---------------------------------------------------------------------------
_STYLE = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

/* ── Jetons du kit ───────────────────────────────────────────────────── */
:root {
  --font-display: "Fraunces", Georgia, "Times New Roman", serif;
  --font-sans: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --text-xs: 12px; --text-sm: 14px; --text-base: 16px; --text-lg: 18px;
  --text-xl: 22px; --text-2xl: 28px; --text-3xl: 36px;

  --bg: #FFFFFF; --surface: #F0F2F6; --surface-2: #F7F8FB;
  --border: #E1E5EC; --border-strong: #C7CDD9;
  --text: #31333F; --text-muted: #6B6E7D; --text-faint: #9B9EAC;
  --accent: #0E7A63; --accent-strong: #0A5D4B; --accent-soft: #E2F0EC;
  --accent-contrast: #FFFFFF;

  --info: #0054A3;    --info-bg: #E9F2FD;    --info-border: #C3DCF7;
  --success: #177233; --success-bg: #E7F5EB; --success-border: #BFE3C9;
  --warning: #8A6400; --warning-bg: #FBF3D8; --warning-border: #EBDCA4;
  --danger: #A1373E;  --danger-bg: #FBEBEC;  --danger-border: #EFC9CC;

  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;

  --r-sm: 4px; --r-md: 8px; --r-lg: 10px; --r-xl: 16px; --r-full: 999px;
  --shadow-sm: 0 1px 2px rgba(49,51,63,.06);
  --shadow-md: 0 2px 8px rgba(49,51,63,.08);
  --shadow-lg: 0 12px 32px rgba(49,51,63,.12);
  --ring: 0 0 0 3px rgba(14,122,99,.25);
  --ease: cubic-bezier(.2,.7,.3,1);
}

/* ── Fondations ──────────────────────────────────────────────────────── */
html, body, .stApp, [data-testid="stAppViewContainer"],
[data-testid="stMarkdownContainer"], [data-testid="stWidgetLabel"],
.stButton, .stRadio, .stMetric, .stTabs {
  font-family: var(--font-sans);
}
/* Ne jamais toucher aux icônes Material de Streamlit (sinon ligatures en clair). */
[data-testid="stIconMaterial"], .material-icons, .material-icons-outlined,
.material-symbols-rounded, .material-symbols-outlined {
  font-family: 'Material Symbols Rounded', 'Material Symbols Outlined', 'Material Icons' !important;
}
/* Titres : familles et tailles viennent du thème ; reste l'équilibrage. */
h1, h2, h3, h4 { text-wrap: balance; }
h1 { line-height: 1.2; letter-spacing: -.01em; }
h2 { line-height: 1.25; letter-spacing: -.01em; }
h3 { line-height: 1.3; }
a { text-underline-offset: 3px; }
a:hover { color: var(--accent-strong); }
:focus-visible { outline: none; box-shadow: var(--ring); border-radius: var(--r-sm); }
hr, [data-testid="stDivider"] { border: 0; border-top: 1px solid var(--border); }
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}

/* Colonne principale : allure de document */
.block-container { max-width: 1060px; padding-top: var(--sp-6); padding-bottom: var(--sp-8); }

/* Épure : masque le bouton Deploy et le liseré, garde le menu ⋮ */
[data-testid="stAppDeployButton"], [data-testid="stDecoration"], footer { display: none !important; }
header[data-testid="stHeader"] { background: transparent; }

/* ── Barre latérale : la navigation du kit (.nav) ────────────────────── */
/* Titres de groupe (.nav-title) : mono, capitales, discret. */
[data-testid="stSidebar"] h3 {
  font-family: var(--font-mono) !important;
  font-size: 11px !important; font-weight: 400 !important;
  letter-spacing: .12em; text-transform: uppercase; color: var(--text-muted);
}
[data-testid="stSidebar"] [data-testid="stRadioGroup"] { gap: var(--sp-1); }
/* Une navigation n'affiche pas de rond de bouton radio. */
[data-testid="stSidebar"] [data-testid="stRadioOption"] > div > div > div:first-child:not([data-testid]) {
  display: none;
}
[data-testid="stSidebar"] [data-testid="stRadioOption"] {
  padding: 7px var(--sp-3); border-radius: var(--r-md);
  transition: background .15s var(--ease);
}
[data-testid="stSidebar"] [data-testid="stRadioOption"] p {
  font-size: var(--text-sm); color: var(--text-muted);
}
[data-testid="stSidebar"] [data-testid="stRadioOption"]:hover { background: var(--bg); }
[data-testid="stSidebar"] [data-testid="stRadioOption"]:hover p { color: var(--text); }
[data-testid="stSidebar"] [data-testid="stRadioOption"][data-selected="true"] { background: var(--accent-soft); }
[data-testid="stSidebar"] [data-testid="stRadioOption"][data-selected="true"] p {
  color: var(--accent); font-weight: 500;
}
/* En-tête de la barre latérale : .eyebrow + nom du produit en Fraunces. */
.ds-eyebrow {
  font-family: var(--font-mono); font-size: var(--text-xs);
  letter-spacing: .14em; text-transform: uppercase; color: var(--accent);
}

/* ── Boutons (.btn) ──────────────────────────────────────────────────── */
[data-testid="stBaseButton-secondary"], [data-testid="stBaseButton-primary"] {
  font-family: var(--font-sans); font-size: var(--text-sm); font-weight: 500;
  line-height: 1; padding: 10px var(--sp-4); border: 1px solid transparent;
  transition: background .15s var(--ease), border-color .15s var(--ease),
              color .15s var(--ease), transform .06s var(--ease);
}
[data-testid="stBaseButton-secondary"] { background: var(--surface); color: var(--text); }
[data-testid="stBaseButton-secondary"]:hover {
  background: var(--border); color: var(--text); border-color: transparent;
}
[data-testid="stBaseButton-primary"] { background: var(--accent); color: var(--accent-contrast); }
[data-testid="stBaseButton-primary"]:hover {
  background: var(--accent-strong); color: var(--accent-contrast); border-color: transparent;
}
[data-testid="stBaseButton-secondary"]:active,
[data-testid="stBaseButton-primary"]:active { transform: translateY(1px); }
/* Le téléchargement du résultat est l'action secondaire encadrée (.btn--secondary). */
[data-testid="stDownloadButton"] [data-testid="stBaseButton-secondary"] {
  background: var(--bg); border-color: var(--border-strong);
}
[data-testid="stDownloadButton"] [data-testid="stBaseButton-secondary"]:hover {
  background: var(--accent-soft); border-color: var(--accent); color: var(--accent);
}

/* ── Zones de dépôt (.dropzone) ──────────────────────────────────────── */
[data-testid="stFileUploaderDropzone"] {
  background: var(--surface); border: 1px dashed var(--border-strong);
  border-radius: var(--r-lg); padding: var(--sp-4);
  transition: border-color .15s var(--ease), background .15s var(--ease);
}
[data-testid="stFileUploaderDropzone"]:hover {
  border-color: var(--accent); background: var(--accent-soft);
}
[data-testid="stFileUploaderDropzone"] small { color: var(--text-muted); font-size: var(--text-xs); }
/* Fichier chargé : la pastille du kit (.file-pill). */
[data-testid="stFileUploaderFile"] {
  background: var(--accent-soft); border-radius: var(--r-md); padding: 6px var(--sp-3);
}
[data-testid="stFileUploaderFile"] [data-testid="stFileUploaderFileName"] {
  font-family: var(--font-mono); font-size: var(--text-xs); color: var(--accent);
}

/* ── Messages (.alert) ───────────────────────────────────────────────── */
/* Fond et texte viennent des palettes du thème (config.toml) ; le kit ajoute
   un filet de la même famille, que Streamlit n'expose pas en réglage. */
[data-testid="stAlertContainer"] { border: 1px solid transparent; }
[data-testid="stAlertContainer"]:has([data-testid="stAlertContentInfo"]) { border-color: var(--info-border); }
[data-testid="stAlertContainer"]:has([data-testid="stAlertContentSuccess"]) { border-color: var(--success-border); }
[data-testid="stAlertContainer"]:has([data-testid="stAlertContentWarning"]) { border-color: var(--warning-border); }
[data-testid="stAlertContainer"]:has([data-testid="stAlertContentError"]) { border-color: var(--danger-border); }

/* ── Encadrés du manuel (.callout) ───────────────────────────────────── */
/* Le manuel est du Markdown rendu par `st.markdown` : ses `>` portent les
   encadrés « À retenir » / « Attention » du kit. Sans cette règle, Streamlit
   les rend en simple texte grisé, indiscernable du paragraphe voisin. */
[data-testid="stMarkdownContainer"] blockquote {
  background: var(--surface-2);
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--r-md) var(--r-md) 0;
  padding: var(--sp-3) var(--sp-4);
  margin: var(--sp-4) 0;
  color: var(--text);
}
[data-testid="stMarkdownContainer"] blockquote p:last-child { margin-bottom: 0; }

/* ── Indicateurs (.metric) ───────────────────────────────────────────── */
[data-testid="stMetric"] {
  background: var(--surface); border: 0; border-radius: var(--r-lg); padding: var(--sp-4);
}
[data-testid="stMetricLabel"] p {
  font-size: var(--text-xs); color: var(--text-muted);
  text-transform: uppercase; letter-spacing: .06em;
}
[data-testid="stMetricValue"] {
  font-family: var(--font-display); font-variant-numeric: tabular-nums; line-height: 1.15;
}
[data-testid="stMetricDelta"] { font-family: var(--font-mono); font-size: var(--text-xs); }

/* ── Onglets (.tabs) ─────────────────────────────────────────────────── */
/* Streamlit rend ses onglets avec react-aria : `[data-testid="stTab"]` et
   `.react-aria-SelectionIndicator` pour le trait de l'onglet actif. */
[data-testid="stTabs"] [role="tablist"] { gap: var(--sp-1); border-bottom: 1px solid var(--border); }
[data-testid="stTab"] {
  padding: 9px var(--sp-4); transition: color .15s var(--ease);
}
[data-testid="stTab"] p {
  font-family: var(--font-sans); font-size: var(--text-sm);
  font-weight: 400; color: var(--text-muted);
}
[data-testid="stTab"]:hover p { color: var(--text); }
[data-testid="stTab"][aria-selected="true"] p { color: var(--accent); font-weight: 500; }
[data-testid="stTabs"] .react-aria-SelectionIndicator { background-color: var(--accent); }

/* ── Tableaux (.table-wrap) et chiffres ──────────────────────────────── */
[data-testid="stDataFrame"] { border-radius: var(--r-lg); font-variant-numeric: tabular-nums; }

/* ── Volet dépliant (.card) ──────────────────────────────────────────── */
[data-testid="stExpander"] details {
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--r-lg);
}
[data-testid="stExpander"] summary { font-size: var(--text-sm); font-weight: 500; }

/* ── Curseurs (.slider) : la valeur et les bornes sont en mono ───────── */
[data-testid="stSliderThumbValue"] {
  font-family: var(--font-mono); font-size: var(--text-sm);
  font-weight: 500; color: var(--accent);
}
[data-testid="stSliderTickBar"] {
  font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-faint);
}

/* ── Légendes (.hint) ────────────────────────────────────────────────── */
[data-testid="stCaptionContainer"] { font-size: var(--text-xs); color: var(--text-muted); }
</style>
"""


def _appliquer_style():
  """Injecte les jetons et les composants du design system."""
  st.markdown(_STYLE, unsafe_allow_html=True)


# Valeurs par défaut des tolérances de l'étape 2 (réglables depuis l'interface).
TOLERANCE_JOURS = 4
SCORE_MINIMUM = 80

_MOTIF_DATE = re.compile(r"^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$")
# Numérotation de ligne (« 1. », « 2. »…) précédant la date sur certains relevés.
_MOTIF_NUMERO_LIGNE = re.compile(r"^\d{1,3}\.$")
_MOTIF_NOMBRE = re.compile(r"^-?[\d.,]+$")
_MOTIF_NUMERO_PAGE = re.compile(r"^\d{1,3}\s*/\s*\d{1,3}$")
# Numéro de chèque : suite de chiffres suivant un marqueur « N° » / « N ».
_MOTIF_NUMERO_CHEQUE = re.compile(r"\bN\s*°?\s*(\d{3,})")

# Mots-clés permettant de repérer chaque colonne dans la ligne d'en-tête du PDF.
_MOTS_ENTETE = {
    "date": ("date", "op."),
    "libelle": ("libelle", "operation", "operations", "intitule", "details"),
    "valeur": ("valeur",),
    "debit": ("debit", "debits"),
    "credit": ("credit", "credits"),
    "solde": ("solde",),
}

# Écart horizontal (en points) au-delà duquel deux mots d'en-tête relèvent de
# deux colonnes distinctes ; en deçà ils forment un seul intitulé (« Montant
# Débit »). Sur les trois relevés connus, les mots d'un même intitulé sont
# séparés de 1,9 à 4,0 points et deux colonnes voisines d'au moins 8,8 : 6 tombe
# au milieu. À réexaminer si un relevé arrive dans un corps nettement plus gros.
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
# milliers, sans jamais déborder sur le montant suivant de la même ligne.
_MONTANT_CARTOUCHE = r"(-?\d{1,3}(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?)"
_CARTOUCHE = (
    ("solde_initial", r"ancien solde|solde precedent|report a nouveau"),
    ("solde_final", r"nouveau solde|solde final"),
    ("total_credits", r"(?:somme|total) des credits"),
    ("total_debits", r"(?:somme|total) des debits"),
)


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
  Débit et une colonne Crédit pour pouvoir situer les montants.
  """
  emprises = {}
  for groupe in _grouper_entete(ligne):
    mots = [_normaliser(m["text"]) for m in groupe]
    colonne = next(
        (
            c
            for c in ("debit", "credit", "solde", "valeur", "libelle", "date")
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
      if _MOTIF_NUMERO_PAGE.match(texte_ligne):
        continue

      limite_gauche = _limite_zone_gauche(emprises)
      mots_gauche = [m for m in ligne if (m["x0"] + m["x1"]) / 2 < limite_gauche]
      mots_droite = [m for m in ligne if (m["x0"] + m["x1"]) / 2 >= limite_gauche]

      # Une nouvelle opération s'ouvre sur une date dans la zone de gauche.
      date_operation, mots_gauche = _detacher_date(mots_gauche, valeur_a_gauche)

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
  """Rend `docs/MANUEL-PROCEDURE.md` tel quel dans l'application.

  `st.markdown` affiche les titres, tableaux, citations et blocs de code du
  fichier : le manuel hérite ainsi du thème de l'application, sans HTML à
  maintenir en parallèle.
  """
  try:
    manuel = _CHEMIN_MANUEL.read_text(encoding="utf-8")
  except OSError:
    st.error(
        "Le manuel de procédure est introuvable. Vérifiez que le fichier"
        " `docs/MANUEL-PROCEDURE.md` est bien livré avec `app.py`."
    )
    return
  st.markdown(manuel)


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
    # Surtitre du kit (.eyebrow) : mono, capitales, accent.
    st.markdown(
        '<div class="ds-eyebrow">Rapprochement bancaire</div>',
        unsafe_allow_html=True,
    )
    page = st.radio("Navigation", (_PAGE_RAPP, _PAGE_MANUEL), label_visibility="collapsed")
    st.divider()
    if page == _PAGE_MANUEL:
      st.caption(
          "Le mode d'emploi. Revenez au rapprochement par la barre latérale."
      )

  if page == _PAGE_MANUEL:
    # Le manuel porte son propre titre : pas de `st.title` ici, qui le
    # doublerait.
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
