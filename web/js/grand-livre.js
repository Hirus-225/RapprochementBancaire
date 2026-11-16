// Lecture du grand livre comptable (Excel) : équivalent de `charger_grand_livre`
// (app.py), qui s'appuie sur pd.read_excel.
//
// SheetJS lit les cellules ; il reste à reproduire ce que pandas fait de lui-même
// entre la cellule et le tableau, car ces règles décident des montants lus et des
// lignes conservées :
//   - l'en-tête est TOUJOURS la ligne 1 de la feuille (même vide) ;
//   - les lignes vides en fin de feuille sont ignorées, celles du milieu gardées ;
//   - « NA », « None », « #N/A »… et les cellules en erreur sont des valeurs
//     manquantes ;
//   - une colonne dont toutes les valeurs ont l'allure d'un nombre devient
//     numérique : le texte « 1.234 » y vaut 1,234 (et non 1 234), un booléen 1 ;
//     une seule valeur non numérique, et la colonne garde chaque cellule telle
//     quelle ;
//   - une colonne de dates Excel (valeurs manquantes admises) reste une colonne
//     de dates ; une date isolée parmi des textes est écrite « 2026-02-01 00:00:00 ».

import * as XLSX from "../vendor/sheetjs/xlsx.mjs";
import { enCentimes, normaliser } from "./outils.js";

const PREFIXE_ERREUR = "Erreur lors du chargement du fichier Excel : ";

// Textes que pandas lit comme « valeur manquante » (pandas._libs.parsers.STR_NA_VALUES).
const VALEURS_MANQUANTES = new Set([
  "", "#N/A", "#N/A N/A", "#NA", "-1.#IND", "-1.#QNAN", "-NaN", "-nan", "1.#IND",
  "1.#QNAN", "<NA>", "N/A", "NA", "NULL", "NaN", "None", "n/a", "nan", "null",
]);

// Texte que pandas convertit en nombre dans une colonne numérique.
const TEXTE_NUMERIQUE = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/;
const TEXTE_ENTIER = /^\s*[+-]?\d+\s*$/;

// ---------------------------------------------------------------------------
// Cellules
// ---------------------------------------------------------------------------

/**
 * Valeur d'une cellule, comme la remet openpyxl à pandas :
 * texte, nombre, booléen, date Excel ({ annee, mois, jour, heure, minute, seconde })
 * ou null (cellule vide ou en erreur).
 */
function valeurCellule(cellule, date1904) {
  if (!cellule) return null;
  switch (cellule.t) { // `switch` ≈ `match` en Python
    case "s":
      return cellule.v;
    case "b":
      return cellule.v;
    case "n":
      // Excel stocke une date comme un nombre de jours ; seul le format de la
      // cellule (« jj/mm/aaaa »…) dit qu'il s'agit d'une date. On la décode sans
      // passer par l'objet Date de JavaScript, qui appliquerait le fuseau horaire.
      if (cellule.z && XLSX.SSF.is_date(cellule.z)) {
        const d = XLSX.SSF.parse_date_code(cellule.v, { date1904 });
        return { annee: d.y, mois: d.m, jour: d.d, heure: d.H, minute: d.M, seconde: d.S };
      }
      return cellule.v;
    default: // "e" (erreur), "z" (cellule vide mise en forme)…
      return null;
  }
}

const estDateExcel = (v) => v !== null && typeof v === "object";
const estManquante = (v) => v === null || (typeof v === "string" && VALEURS_MANQUANTES.has(v));
const deuxChiffres = (n) => String(n).padStart(2, "0");

/** « AAAA-MM-JJ » d'une date Excel. */
export function jourDateExcel(d) {
  return `${d.annee}-${deuxChiffres(d.mois)}-${deuxChiffres(d.jour)}`;
}

/** Date Excel écrite comme `str(datetime)` en Python : « 2026-02-01 00:00:00 ». */
function texteDateExcel(d) {
  return `${jourDateExcel(d)} ${deuxChiffres(d.heure)}:${deuxChiffres(d.minute)}:${deuxChiffres(d.seconde)}`;
}

/**
 * Nombre à virgule écrit comme `str(float)` en Python : 123.0, 0.1, 1e+16, 1e-05.
 * JavaScript écrit 123, 1e+16 mais 0.00001 : les règles diffèrent aux extrêmes.
 */
function flottantPython(x) {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  const absolu = Math.abs(x);
  if (absolu !== 0 && (absolu < 1e-4 || absolu >= 1e16)) {
    // « 1e-5 » → « 1e-05 » : Python écrit l'exposant sur au moins deux chiffres.
    return x.toExponential().replace(/e([+-])(\d)$/, "e$10$2");
  }
  return Number.isInteger(x) ? `${x}.0` : String(x);
}

// ---------------------------------------------------------------------------
// Colonnes : le typage implicite de pandas
// ---------------------------------------------------------------------------

/**
 * Type une colonne comme le fait pandas à la lecture. Renvoie
 * `{ genre, valeurs }`, genre valant :
 *   "dates"   — que des dates Excel (ou des manquantes) ;
 *   "entier"  — que des nombres entiers, aucune manquante ;
 *   "decimal" — que des nombres, textes numériques ou booléens ;
 *   "objet"   — mélange : chaque cellule garde sa valeur.
 * Les valeurs manquantes deviennent null.
 */
function typerColonne(brutes) {
  const valeurs = brutes.map((v) => (estManquante(v) ? null : v));
  const presentes = valeurs.filter((v) => v !== null);

  if (presentes.every(estDateExcel)) return { genre: "dates", valeurs };

  const numerique = (v) =>
    typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && TEXTE_NUMERIQUE.test(v));
  if (presentes.length > 0 && presentes.every(numerique) && !presentes.every((v) => typeof v === "boolean")) {
    const nombres = valeurs.map((v) => (v === null ? null : Number(v))); // Number(true) = 1, Number(" 42 ") = 42
    const entiers =
      presentes.length === valeurs.length &&
      presentes.every((v) => (typeof v === "number" && Number.isInteger(v)) || (typeof v === "string" && TEXTE_ENTIER.test(v)));
    return { genre: entiers ? "entier" : "decimal", valeurs: nombres };
  }
  return { genre: "objet", valeurs };
}

/** Une valeur écrite comme `astype(str)` de pandas (null reste null). */
function enTextePython(valeur, genre, colonneSansHeure) {
  if (valeur === null) return null;
  if (typeof valeur === "string") return valeur;
  if (typeof valeur === "boolean") return valeur ? "True" : "False";
  if (estDateExcel(valeur)) {
    // Une colonne de dates toutes à minuit s'écrit sans l'heure.
    return genre === "dates" && colonneSansHeure ? jourDateExcel(valeur) : texteDateExcel(valeur);
  }
  // Nombre : flottant dans une colonne « decimal » ; dans une colonne « objet »,
  // openpyxl a remis un entier si la valeur est entière.
  if (genre === "decimal") return flottantPython(valeur);
  return Number.isInteger(valeur) ? String(valeur) : flottantPython(valeur);
}

function colonneEnTexte({ genre, valeurs }) {
  const sansHeure = valeurs.every(
    (v) => !estDateExcel(v) || (v.heure === 0 && v.minute === 0 && v.seconde === 0),
  );
  return valeurs.map((v) => enTextePython(v, genre, sansHeure));
}

// ---------------------------------------------------------------------------
// Feuille → tableau de colonnes nommées
// ---------------------------------------------------------------------------

/** Noms de colonnes de pandas : vide → « Unnamed: 3 », doublon → « Débit.1 ». */
function nommerColonnes(entetes) {
  const compte = new Map(); // nom → nombre de fois déjà attribué (≈ defaultdict(int))
  return entetes.map((valeur, i) => {
    let nom = valeur === null || valeur === "" ? `Unnamed: ${i}` : enTextePython(valeur, "objet", false);
    let n = compte.get(nom) ?? 0;
    while (n > 0) {
      compte.set(nom, n + 1);
      nom = `${nom}.${n}`;
      n = compte.get(nom) ?? 0;
    }
    compte.set(nom, n + 1);
    return nom;
  });
}

/** Première feuille du classeur → { noms, colonnes } (colonnes typées). */
function lireFeuille(octets) {
  // cellDates: false + cellNF: true : les dates restent des nombres accompagnés
  // de leur format, décodés ensuite sans fuseau horaire (valeurCellule).
  const classeur = XLSX.read(octets, { type: "array", cellDates: false, cellNF: true, cellText: false });
  const feuille = classeur.Sheets[classeur.SheetNames[0]];
  const date1904 = Boolean(classeur.Workbook?.WBProps?.date1904); // `?.` : s'arrête sans erreur si absent

  // Étendue réelle des cellules, toujours comptée depuis A1 (comme pandas).
  let derniereLigne = -1;
  let derniereColonne = -1;
  for (const adresse of Object.keys(feuille)) {
    if (adresse.startsWith("!")) continue; // clés techniques de SheetJS (!ref, !merges…)
    const { r, c } = XLSX.utils.decode_cell(adresse);
    derniereLigne = Math.max(derniereLigne, r);
    derniereColonne = Math.max(derniereColonne, c);
  }

  const lignes = [];
  for (let r = 0; r <= derniereLigne; r++) {
    const ligne = [];
    for (let c = 0; c <= derniereColonne; c++) {
      ligne.push(valeurCellule(feuille[XLSX.utils.encode_cell({ r, c })], date1904));
    }
    lignes.push(ligne);
  }
  // Lignes vides en fin de feuille : ignorées.
  const vide = (ligne) => ligne.every((v) => v === null || v === "");
  while (lignes.length > 0 && vide(lignes.at(-1))) lignes.pop();

  const [entetes = [], ...donnees] = lignes;
  const largeur = Math.max(derniereColonne + 1, 0);
  const noms = nommerColonnes(Array.from({ length: largeur }, (_, c) => entetes[c] ?? null));
  const colonnes = noms.map((_, c) => typerColonne(donnees.map((ligne) => ligne[c])));
  return { noms, colonnes, nombreLignes: donnees.length };
}

// ---------------------------------------------------------------------------
// Grand livre
// ---------------------------------------------------------------------------

/**
 * Cherche une colonne par mot-clé (`_trouver_colonne`) : d'abord un nom égal au
 * mot-clé, puis un nom qui le contient, en ignorant les noms qui contiennent une
 * exclusion (« solde débit » n'est pas « débit »). Renvoie l'indice, ou -1.
 */
export function trouverColonne(noms, motsCles, exclusions = []) {
  for (const exact of [true, false]) {
    for (const [i, nom] of noms.entries()) { // ≈ enumerate()
      if (exclusions.some((x) => nom.includes(x))) continue;
      if (motsCles.some((cle) => (exact ? nom === cle : nom.includes(cle)))) return i;
    }
  }
  return -1;
}

/**
 * Charge le grand livre (contenu du fichier .xlsx ou .xls) et renvoie ses
 * écritures `{ date, libelle, montant }` :
 *   - montant en centimes, débit − crédit (miroir du relevé : une entrée
 *     d'argent est un débit en comptabilité) — null si illisible ;
 *   - libellé en texte (null si absent) ;
 *   - date : date Excel ({ annee, mois, jour… }) si la colonne ne contient que
 *     des dates, sinon le texte de la cellule — nettoyerDonnees convertit.
 */
export function chargerGrandLivre(octets) {
  try {
    const { noms: nomsBruts, colonnes } = lireFeuille(octets);
    const noms = nomsBruts.map(normaliser);

    const iDate = trouverColonne(noms, ["date"]);
    const iLibelle = trouverColonne(noms, ["libelle", "intitule", "piece", "operation"]);
    const iDebit = trouverColonne(noms, ["debit"], ["solde"]);
    const iCredit = trouverColonne(noms, ["credit"], ["solde"]);

    if (iDate < 0 || iLibelle < 0) {
      throw new Error("Colonnes 'date' ou 'libellé' introuvables dans le fichier Excel.");
    }

    let montants;
    if (iDebit >= 0 && iCredit >= 0) {
      const credits = colonnes[iCredit].valeurs;
      // Une valeur illisible compte pour 0 (fillna(0) côté Python).
      montants = colonnes[iDebit].valeurs.map(
        (debit, i) => (enCentimes(debit) ?? 0) - (enCentimes(credits[i]) ?? 0),
      );
    } else {
      const iMontant = trouverColonne(noms, ["montant"], ["solde"]);
      if (iMontant < 0) {
        throw new Error(
          "Impossible de trouver les colonnes Débit/Crédit ou Montant dans la comptabilité.",
        );
      }
      montants = colonnes[iMontant].valeurs.map(enCentimes);
    }

    const colonneDate = colonnes[iDate];
    const dates = colonneDate.genre === "dates" ? colonneDate.valeurs : colonneEnTexte(colonneDate);
    const libelles = colonneEnTexte(colonnes[iLibelle]);

    return montants.map((montant, i) => ({ date: dates[i], libelle: libelles[i], montant }));
  } catch (erreur) {
    // ≈ raise RuntimeError(f"Erreur lors du chargement du fichier Excel : {e}")
    throw new Error(PREFIXE_ERREUR + erreur.message, { cause: erreur });
  }
}
