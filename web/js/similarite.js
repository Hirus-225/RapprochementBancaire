// Similarité de libellés : équivalents de `fuzz.ratio` et `fuzz.token_set_ratio`
// de thefuzz (qui délègue à rapidfuzz). Les formules reprennent celles de
// rapidfuzz ligne à ligne, y compris l'ordre des opérations : un score qui
// tombe pile sur x,5 est arrondi « au pair » par Python, et un écart d'un
// dernier chiffre dans le calcul suffirait à le faire basculer.

import { arrondiPair } from "./outils.js";

/**
 * Découpe un texte en caractères Unicode.
 *
 * Une chaîne JS est une suite d'unités UTF-16 : « 😀 ».length vaut 2, alors que
 * len("😀") vaut 1 en Python. `Array.from` découpe par caractère réel, comme
 * Python — indispensable puisque les scores dépendent des longueurs.
 */
const caracteres = (texte) => Array.from(texte);

/** Longueur de la plus longue sous-suite commune (programmation dynamique). */
function plusLongueSousSuite(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  // Deux lignes du tableau suffisent : la ligne courante ne dépend que de la
  // précédente. Int32Array ≈ un tableau numpy d'entiers, initialisé à 0.
  let precedente = new Int32Array(b.length + 1);
  let courante = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      courante[j] = a[i - 1] === b[j - 1]
        ? precedente[j - 1] + 1
        : Math.max(precedente[j], courante[j - 1]);
    }
    [precedente, courante] = [courante, precedente]; // échange, comme a, b = b, a
  }
  return precedente[b.length];
}

/**
 * Distance « Indel » : nombre minimal d'insertions et de suppressions pour
 * passer d'une suite à l'autre (une substitution compte pour deux).
 */
function distanceIndel(a, b) {
  return a.length + b.length - 2 * plusLongueSousSuite(a, b);
}

/** `_norm_distance` de rapidfuzz (seuil de score nul). */
function scoreDepuisDistance(distance, sommeLongueurs) {
  return sommeLongueurs ? 100 - (100 * distance) / sommeLongueurs : 100;
}

/** Score brut (non arrondi) de `rapidfuzz.fuzz.ratio`. */
function ratioBrut(a, b) {
  const somme = a.length + b.length;
  const distanceNormalisee = somme ? distanceIndel(a, b) / somme : 0;
  return (1 - distanceNormalisee) * 100;
}

/**
 * `fuzz.ratio` de thefuzz : similarité caractère par caractère, de 0 à 100.
 * Aucun prétraitement : la casse et la ponctuation comptent.
 */
export function ratio(s1, s2) {
  // Libellé absent (NaN côté pandas) : rapidfuzz renvoie 0.
  if (s1 == null || s2 == null) return 0; // `== null` vaut pour null et undefined
  return arrondiPair(ratioBrut(caracteres(String(s1)), caracteres(String(s2))));
}

/**
 * Prétraitement de thefuzz (`full_process` avec `force_ascii=True`) :
 * 1. les caractères U+0080 à U+00FF sont supprimés (é, °, espace insécable…) —
 *    supprimés, pas remplacés : « N°12 » devient « N12 », « CAFÉ » devient
 *    « CAF » ;
 * 2. tout ce qui n'est ni lettre ni chiffre devient une espace ;
 * 3. espaces des bords retirées, minuscules.
 *
 * rapidfuzz passe en minuscules caractère par caractère : « İ » (I turc pointé)
 * y devient « i », là où `toLowerCase` produit « i » + point combinant.
 */
export function pretraiter(texte) {
  const sansLatin1 = String(texte).replace(/[\u0080-ÿ]/g, "");
  const alphanumerique = sansLatin1.replace(/[^\p{L}\p{N}]/gu, " ");
  return alphanumerique.trim().replaceAll("İ", "i").toLowerCase();
}

/** Tri par point de code, comme `sorted()` sur des chaînes Python. */
function comparerPointsDeCode(a, b) {
  const ca = caracteres(a);
  const cb = caracteres(b);
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    const ecart = ca[i].codePointAt(0) - cb[i].codePointAt(0);
    if (ecart !== 0) return ecart;
  }
  return ca.length - cb.length;
}

/**
 * `fuzz.token_set_ratio` de thefuzz : compare les **ensembles de mots**. Si tous
 * les mots d'un libellé figurent dans l'autre, le score vaut 100 — utile ici,
 * car le libellé bancaire porte souvent des références absentes de la compta.
 */
export function tokenSetRatio(s1, s2) {
  // Libellé absent : pandas le représente par NaN, que thefuzz ne reconnaît pas
  // comme « absent » et convertit en texte — il devient le mot « nan ». Un
  // libellé bancaire contenant « NAN » obtient donc 100. Reproduit tel quel.
  const texte = (s) => (s == null ? "nan" : s);
  // `Set` ≈ `set` en Python : pas de doublons.
  const motsA = new Set(pretraiter(texte(s1)).split(" ").filter(Boolean));
  const motsB = new Set(pretraiter(texte(s2)).split(" ").filter(Boolean));
  if (motsA.size === 0 || motsB.size === 0) return 0;

  const communs = [...motsA].filter((m) => motsB.has(m));
  const seulementA = [...motsA].filter((m) => !motsB.has(m)).sort(comparerPointsDeCode);
  const seulementB = [...motsB].filter((m) => !motsA.has(m)).sort(comparerPointsDeCode);

  // Un libellé entièrement contenu dans l'autre.
  if (communs.length > 0 && (seulementA.length === 0 || seulementB.length === 0)) {
    return 100;
  }

  const diffA = caracteres(seulementA.join(" "));
  const diffB = caracteres(seulementB.join(" "));
  const longueurCommuns = caracteres(communs.join(" ")).length;
  const separateur = longueurCommuns !== 0 ? 1 : 0;

  // Longueurs de « communs + reste de A » et « communs + reste de B ».
  const longueurCommunsA = longueurCommuns + separateur + diffA.length;
  const longueurCommunsB = longueurCommuns + separateur + diffB.length;

  const resultat = scoreDepuisDistance(
    distanceIndel(diffA, diffB),
    longueurCommunsA + longueurCommunsB,
  );
  if (!longueurCommuns) return arrondiPair(resultat);

  // Comparaison de chaque « communs + reste » avec les seuls mots communs : la
  // distance se réduit à la longueur du reste.
  const ratioA = scoreDepuisDistance(separateur + diffA.length, longueurCommuns + longueurCommunsA);
  const ratioB = scoreDepuisDistance(separateur + diffB.length, longueurCommuns + longueurCommunsB);
  return arrondiPair(Math.max(resultat, ratioA, ratioB));
}
