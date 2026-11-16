// Outils de base : équivalents JavaScript des petites fonctions de app.py
// (_normaliser, _en_nombre, conversion des dates de nettoyer_donnees,
// _numero_cheque) et de deux comportements implicites de Python que le code
// métier suppose (l'arrondi « au pair » et les classes Unicode des expressions
// régulières).
//
// Chaque fonction est vérifiée par web/tests/ contre les résultats que produit
// app.py lui-même (script_reference_js.py).

// ---------------------------------------------------------------------------
// Arrondi « au pair » (arrondi bancaire)
// ---------------------------------------------------------------------------

/**
 * Arrondit à l'entier le plus proche, les demis vers l'entier pair — comme
 * `round()` en Python et `numpy.round`. `Math.round` arrondit les demis vers
 * le haut : Math.round(80.5) = 81 mais round(80.5) = 80 en Python. thefuzz
 * arrondit ses scores ainsi, et la règle « score > 80 » en dépend.
 */
export function arrondiPair(x) {
  const plancher = Math.floor(x);
  const reste = x - plancher; // exact pour tout montant réaliste (< 2⁵²)
  if (reste < 0.5) return plancher;
  if (reste > 0.5) return plancher + 1;
  return plancher % 2 === 0 ? plancher : plancher + 1;
}

// ---------------------------------------------------------------------------
// Classes de caractères alignées sur Python
// ---------------------------------------------------------------------------
// En Python, `\s`, `\w`, `\d` et `\b` suivent les tables Unicode ; en JavaScript,
// `\w`, `\d` et `\b` ne connaissent que l'ASCII, et `\s` n'a pas tout à fait la
// même liste que Python. On écrit donc ces classes explicitement.

/** Contenu de la classe d'espaces de Python, sans crochets (pour `[\s.,]`). */
export const ESPACE_CARACTERES =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

/** Espaces au sens de Python (`str.isspace()`, donc `\s` de `re`). */
export const ESPACE = `[${ESPACE_CARACTERES}]`;

/** Caractère de mot au sens de Python (`\w` : lettre, chiffre ou « _ »). */
export const MOT = "[\\p{L}\\p{N}_]";

/** Chiffre décimal au sens de `\d` en Python (toutes écritures). Drapeau `u` requis. */
export const CHIFFRE = "\\p{Nd}";

/**
 * Chiffre au sens de `str.isdigit()` : les chiffres décimaux, plus exposants,
 * indices et chiffres cerclés (², ₃, ①…). Drapeau `u` requis.
 */
export const CHIFFRE_ISDIGIT =
  "[\\p{Nd}\\u00b2\\u00b3\\u00b9\\u1369-\\u1371\\u19da\\u2070\\u2074-\\u2079\\u2080-\\u2089"
  + "\\u2460-\\u2468\\u2474-\\u247c\\u2488-\\u2490\\u24ea\\u24f5-\\u24fd\\u24ff\\u2776-\\u277e"
  + "\\u2780-\\u2788\\u278a-\\u2792\\u{10a40}-\\u{10a43}\\u{10e60}-\\u{10e68}\\u{11052}-\\u{1105a}"
  + "\\u{1f100}-\\u{1f10a}]";

const ESPACES_AUX_BORDS = new RegExp(`^${ESPACE}+|${ESPACE}+$`, "g");

/** `texte.strip()` de Python. */
export function rogner(texte) {
  return texte.replace(ESPACES_AUX_BORDS, "");
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

/**
 * Vrai si le caractère a une classe combinante canonique non nulle — ce que
 * teste `unicodedata.combining(c)` en Python. JavaScript n'expose pas cette
 * propriété ; on la déduit du réordonnancement que fait NFD : deux marques qui
 * se suivent sont remises dans l'ordre croissant de leur classe, et une marque
 * de classe nulle ne bouge jamais.
 *   - après U+0301 (classe 230), une marque de classe 1 à 229 passe devant ;
 *   - devant U+0334 (classe 1), une marque de classe > 1 passe derrière.
 * Une marque de classe non nulle déclenche au moins l'un des deux échanges.
 */
function estCombinant(c) {
  return (
    `á${c}`.normalize("NFD") !== `á${c}` ||
    `a${c}̴`.normalize("NFD") !== `a${c}̴`
  );
}

/**
 * Minuscules sans accents, pour comparer des libellés (`_normaliser`).
 *
 * NFKD sépare chaque lettre accentuée en lettre + accent (« é » → « e » + « ́ »),
 * puis on retire les accents. Seules les marques (`\p{M}`) sont candidates ;
 * `estCombinant` les départage comme Python.
 */
export function normaliser(texte) {
  const decompose = String(texte)
    .normalize("NFKD")
    .replace(/\p{M}/gu, (marque) => (estCombinant(marque) ? "" : marque));
  return rogner(decompose).toLowerCase();
}

// ---------------------------------------------------------------------------
// Montants
// ---------------------------------------------------------------------------

const ESPACES = new RegExp(`${ESPACE}+`, "g");
// Après nettoyage, il ne doit rester qu'un nombre : signe, chiffres et au plus
// deux décimales derrière un point.
const NOMBRE_DECIMAL = /^([+-]?)(\d*)(?:\.(\d{1,2}))?$/;

/**
 * Convertit un montant en **centimes entiers** (null si illisible) — équivalent
 * de `_en_nombre`, suivi de l'arrondi à deux décimales de `nettoyer_donnees`.
 *
 * - Un nombre (cellule Excel) est multiplié par 100 puis arrondi au pair, comme
 *   `numpy.round(x, 2)`.
 * - Un texte (« 1 234,56 », « 1.234,56 », « XOF6,000.00 », « 200 000 ») est
 *   converti **sans passer par un nombre à virgule** : la partie entière et les
 *   décimales sont lues comme des chiffres, donc sans aucune erreur d'arrondi.
 *   Le séparateur décimal est le dernier « , » ou « . » suivi d'un ou deux
 *   chiffres ; les autres sont des séparateurs de milliers.
 *
 * Écart volontaire avec Python : seuls les chiffres décimaux sont acceptés.
 * `float()` lit aussi « 1e5 », « 1_000 », « inf » ou des chiffres arabes, sans
 * usage sur un relevé ou un grand livre — on les refuse plutôt que de deviner.
 */
export function enCentimes(valeur) {
  if (typeof valeur === "number") {
    return Number.isFinite(valeur) ? arrondiPair(valeur * 100) : null;
  }
  if (typeof valeur !== "string") return null; // booléen, null, undefined…

  let brut = valeur.replace(ESPACES, "").replaceAll("€", "").replaceAll("XOF", "");
  if (!brut) return null;

  if (/[.,]\d{1,2}$/.test(brut)) {
    // `.at(-3)` ≈ brut[-3] en Python ; vaut undefined si le texte est trop court.
    const separateur = ".,".includes(brut.at(-3) ?? "") ? brut.at(-3) : brut.at(-2);
    const position = brut.lastIndexOf(separateur); // ≈ rpartition
    const entier = brut.slice(0, position).replace(/[.,]/g, "");
    brut = `${entier}.${brut.slice(position + 1)}`;
  } else {
    brut = brut.replace(/[.,]/g, "");
  }

  const morceaux = NOMBRE_DECIMAL.exec(brut);
  if (!morceaux) return null;
  const [, signe, entier, decimales = ""] = morceaux; // affectation par décomposition
  if (!entier && !decimales) return null; // « - » ou « . » seuls

  const centimes = Number(entier || "0") * 100 + Number(decimales.padEnd(2, "0"));
  if (!Number.isSafeInteger(centimes)) return null; // montant absurde (> 90 000 milliards)
  return signe === "-" ? -centimes : centimes;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
// `nettoyer_donnees` convertit les dates avec pd.to_datetime(…, dayfirst=True).
// pandas y a trois comportements à reproduire :
//   1. il déduit le format de la PREMIÈRE valeur de la colonne et l'impose à
//      toutes les autres : une date écrite autrement devient invalide ;
//   2. s'il ne sait pas déduire ce format (première valeur illisible), il lit
//      chaque valeur séparément, en acceptant toutes les écritures connues ;
//   3. une année à deux chiffres est placée à moins de 50 ans de l'année en
//      cours (règle de dateutil) : en 2026, « 69 » → 2069 et « 76 » → 1976.

const MOIS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MOIS_COMPLETS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// Groupes nommés `(?<nom>…)` : on lit ensuite `m.groups.jour`, comme `m.group("jour")`.
const FORME_ISO =
  /^(?<annee>\d{4})(?<sep>[-/.])(?<mois>\d{1,2})\k<sep>(?<jour>\d{1,2})(?<heure>[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)?$/;
const FORME_JOUR_EN_TETE =
  /^(?<jour>\d{1,2})(?<sep>[-/. ])(?<mois>\d{1,2}|[A-Za-z]{3,9})\k<sep>(?<annee>\d{4}|\d{2})$/;

/** Analyse une date écrite ; renvoie ses parties et la « signature » de son format. */
function analyserDate(texte) {
  let m = FORME_ISO.exec(texte);
  if (m) {
    const { annee, sep, mois, jour, heure } = m.groups;
    return {
      annee: Number(annee), mois: Number(mois), jour: Number(jour),
      format: `iso${sep}${heure ? "h" + heure.length : ""}`,
    };
  }
  m = FORME_JOUR_EN_TETE.exec(texte);
  if (!m) return null;
  const { jour, sep, mois, annee } = m.groups;

  let numeroMois;
  let genreMois;
  if (/^\d/.test(mois)) {
    numeroMois = Number(mois);
    genreMois = "chiffres";
  } else {
    const nom = mois.toLowerCase();
    if (MOIS.includes(nom)) {
      numeroMois = MOIS.indexOf(nom) + 1;
      genreMois = "abrege";
    } else if (MOIS_COMPLETS.includes(nom)) {
      numeroMois = MOIS_COMPLETS.indexOf(nom) + 1;
      genreMois = "complet";
    } else {
      return null;
    }
  }
  return {
    annee: Number(annee), anneeSurDeuxChiffres: annee.length === 2,
    mois: numeroMois, jour: Number(jour),
    format: `jma${sep}${genreMois}${annee.length}`,
  };
}

/** Année à deux chiffres → quatre chiffres, à moins de 50 ans de l'année en cours. */
function siecle(annee, anneeCourante) {
  let complete = annee + Math.floor(anneeCourante / 100) * 100;
  if (complete >= anneeCourante + 50) complete -= 100;
  else if (complete < anneeCourante - 50) complete += 100;
  return complete;
}

/** « AAAA-MM-JJ » si la date existe au calendrier, sinon null (31/02, 00/01…). */
function ecrireDate(annee, mois, jour) {
  // Date.UTC compte les mois de 0 à 11 et « corrige » silencieusement un
  // 31 février en 3 mars : on vérifie donc que la date n'a pas bougé.
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  if (d.getUTCFullYear() !== annee || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) {
    return null;
  }
  if (annee < 1000) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Convertit une colonne de dates écrites en « AAAA-MM-JJ » (null si invalide),
 * comme le fait `nettoyer_donnees` sur une colonne de texte.
 *
 * La fonction prend la colonne entière, et non une date isolée, parce que le
 * format retenu dépend de la première valeur (voir plus haut).
 */
export function convertirDates(textes, anneeCourante = new Date().getFullYear()) {
  const valeurs = textes.map((t) => rogner(String(t ?? "")));
  const premiere = valeurs.find((v) => v !== "");
  const formatImpose = premiere === undefined ? null : analyserDate(premiere)?.format ?? null;

  return valeurs.map((v) => {
    const date = analyserDate(v);
    if (!date) return null;
    if (formatImpose && date.format !== formatImpose) return null;
    const annee = date.anneeSurDeuxChiffres ? siecle(date.annee, anneeCourante) : date.annee;
    return ecrireDate(annee, date.mois, date.jour);
  });
}

/** Nombre de jours entre deux dates « AAAA-MM-JJ » (b − a). */
export function ecartJours(a, b) {
  // Les dates sont manipulées en UTC : en heure locale, un passage à l'heure
  // d'été ferait d'une journée 23 ou 25 heures et fausserait la division.
  const jour = (texte) => Date.UTC(+texte.slice(0, 4), +texte.slice(5, 7) - 1, +texte.slice(8, 10));
  return Math.round((jour(b) - jour(a)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Numéro de chèque
// ---------------------------------------------------------------------------

// `\bN` de Python, avec une frontière de mot Unicode : le « N » ne doit pas être
// précédé d'une lettre, d'un chiffre ou de « _ ». Le drapeau `u` active `\p{…}`.
const MOTIF_NUMERO_CHEQUE = new RegExp(
  `(?<!${MOT})(?:N|CHEQUEN)${ESPACE}*°?${ESPACE}*(\\p{Nd}{3,})`,
  "u",
);

/**
 * Numéro de chèque d'un libellé, zéros de tête ignorés (null en son absence) —
 * équivalent de `_numero_cheque`. « N° 0412083 » et « N°412083 » donnent tous
 * deux « 412083 ».
 */
export function numeroCheque(libelle) {
  const m = MOTIF_NUMERO_CHEQUE.exec(String(libelle).toUpperCase());
  if (!m) return null;
  return m[1].replace(/^0+/, "") || "0";
}
