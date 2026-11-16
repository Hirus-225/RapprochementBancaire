// Lecture d'un PDF : des instructions de dessin de PDF.js aux mots positionnés,
// comme pdfplumber (`page.extract_words()`) puis `_lignes_de_mots` (app.py).
//
// Pourquoi ne pas utiliser `page.getTextContent()` de PDF.js ? Parce qu'il livre
// des morceaux de plusieurs mots (« Du 01/01/2026 au 18/08/2026 ») sans la
// position des caractères à l'intérieur, et y intercale des espaces fictives.
// Or le lecteur par coordonnées range chaque mot dans une colonne d'après sa
// position exacte. On repart donc de la liste des instructions de dessin
// (`getOperatorList`), qui donne la chasse de chaque glyphe, et on refait le
// calcul de pdfminer (la bibliothèque sous pdfplumber), caractère par caractère.

import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import { ESPACE, rogner } from "./outils.js";

const ici = (chemin) => new URL(chemin, import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = ici("../vendor/pdfjs/pdf.worker.min.mjs");

const OPS = pdfjsLib.OPS;
const TOLERANCE_X = 3; // pdfplumber : DEFAULT_X_TOLERANCE
const TOLERANCE_Y = 3; // pdfplumber : DEFAULT_Y_TOLERANCE
const LIGATURES = { "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "ﬁ": "fi", "ﬂ": "fl", "ﬆ": "st", "ﬅ": "st" };
const ESPACES_SEULES = new RegExp(`^${ESPACE}+$`);

/**
 * Ouvre un PDF (contenu en octets). Tout se passe dans le navigateur : PDF.js
 * ne télécharge rien, ses tables de caractères et polices standard sont
 * servies depuis vendor/.
 */
export function ouvrirPdf(octets) {
  return pdfjsLib.getDocument({
    // PDF.js « transfère » le tableau d'octets à son worker, qui le vide côté
    // page : on lui en donne une copie pour que l'appelant garde le sien.
    data: octets.slice(),
    cMapUrl: ici("../vendor/pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: ici("../vendor/pdfjs/standard_fonts/"),
    fontExtraProperties: true, // pour connaître la descente et le type de chaque police
    disableFontFace: true, // on ne dessine rien : inutile de charger les polices dans la page
    isEvalSupported: false,
  }).promise;
}

// ---------------------------------------------------------------------------
// Matrices (mêmes formules, dans le même ordre, que pdfminer.utils)
// ---------------------------------------------------------------------------
// Une matrice [a, b, c, d, e, f] transforme (x, y) en (a·x + c·y + e, b·x + d·y + f).

function multiplier([a1, b1, c1, d1, e1, f1], [a0, b0, c0, d0, e0, f0]) {
  return [
    a0 * a1 + c0 * b1, b0 * a1 + d0 * b1,
    a0 * c1 + c0 * d1, b0 * c1 + d0 * d1,
    a0 * e1 + c0 * f1 + e0, b0 * e1 + d0 * f1 + f0,
  ];
}

function translater([a, b, c, d, e, f], x, y) {
  return [a, b, c, d, x * a + y * c + e, x * b + y * d + f];
}

const point = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f];

/**
 * Nombre décimal écrit dans le PDF, retrouvé à partir de sa valeur en
 * précision simple.
 *
 * PDF.js range les matrices de texte et les tracés dans des Float32Array :
 * « 14.17 » y devient 14.170000076293945. pdfminer, lui, lit 14.17 en double
 * précision. Or pdfplumber compare des positions par égalité exacte (sommets
 * des cellules d'un tableau) : on retrouve donc le décimal le plus court qui,
 * arrondi en précision simple, redonne la même valeur — celui du fichier. Un
 * nombre qui n'est pas représentable en précision simple est déjà en double
 * précision : il est rendu tel quel.
 *
 * Précaution : sur les quatre relevés de référence, la retirer ne change aucun
 * résultat (leurs tableaux tombent sur des valeurs exactes en précision simple).
 * Elle protège un relevé futur dont les égalités ne tiendraient qu'en double.
 */
export function decimal(x) {
  if (Number.isInteger(x) || Math.fround(x) !== x) return x;
  for (let chiffres = 1; chiffres <= 9; chiffres++) {
    const candidat = Number(x.toPrecision(chiffres));
    if (Math.fround(candidat) === x) return candidat;
  }
  return x;
}

/** Une matrice (ou des arguments) en nombres ordinaires, décimaux retrouvés. */
const nombres = (valeurs) => Array.from(valeurs, decimal);

/** Rectangle englobant l'image d'un rectangle par une matrice. */
function rectangle(m, x0, y0, x1, y1) {
  const coins = [point(m, x0, y0), point(m, x1, y0), point(m, x1, y1), point(m, x0, y1)];
  const xs = coins.map((p) => p[0]);
  const ys = coins.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ---------------------------------------------------------------------------
// Caractères et traits
// ---------------------------------------------------------------------------

function etatTexteInitial() {
  return {
    matrice: [1, 0, 0, 1, 0, 0], // Tm
    ligne: [0, 0], // position courante dans la ligne (linematrix de pdfminer)
    police: null,
    taille: 0,
    espaceCaracteres: 0, // Tc
    espaceMots: 0, // Tw
    echelle: 100, // Tz, en %
    interligne: 0, // = −TL, convention de pdfminer
    elevation: 0, // Ts
  };
}

/** Police PDF.js chargée par son nom interne (« g_d0_f1 »). */
function police(page, nom) {
  // `objs.get(nom, rappel)` appelle `rappel` dès que l'objet est disponible ;
  // on enveloppe ce rappel dans une promesse pour pouvoir l'attendre.
  const source = nom.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => source.get(nom, resolve));
}

/**
 * Parcourt les instructions de dessin d'une page et renvoie :
 *   - caracteres : { texte, x0, x1, top, bottom, droit }, dans l'ordre du flux ;
 *   - objets : traits peints (« line », « rect », « curve »), comme les classe
 *     pdfminer — ils servent au lecteur par tableaux.
 * Coordonnées de pdfplumber : `top` est mesuré depuis le haut de la page.
 */
async function analyserPage(page) {
  const liste = await page.getOperatorList({ annotationMode: pdfjsLib.AnnotationMode.DISABLE });
  const [vx0, vy0, , vy1] = page.view;
  const hauteur = vy1 - vy0;

  // Polices utilisées, chargées une fois pour toutes avant le parcours.
  const polices = new Map();
  for (const [i, op] of liste.fnArray.entries()) {
    if (op === OPS.setFont && !polices.has(liste.argsArray[i][0])) {
      const nom = liste.argsArray[i][0];
      polices.set(nom, await police(page, nom));
    }
  }

  let ctm = [1, 0, 0, 1, -vx0, -vy0];
  let texte = etatTexteInitial();
  const pile = []; // sauvegardes q / Q (≈ list utilisée comme pile)
  const caracteres = [];
  const objets = [];

  for (const [i, op] of liste.fnArray.entries()) {
    const args = liste.argsArray[i];
    switch (op) {
      case OPS.save:
        pile.push({ ctm, texte: structuredClone(texte) }); // structuredClone ≈ copy.deepcopy
        break;
      case OPS.restore:
        if (pile.length) ({ ctm, texte } = pile.pop());
        break;
      case OPS.transform:
        ctm = multiplier(nombres(args), ctm);
        break;
      case OPS.paintFormXObjectBegin:
        pile.push({ ctm, texte: structuredClone(texte) });
        if (args[0]) ctm = multiplier(nombres(args[0]), ctm);
        break;
      case OPS.paintFormXObjectEnd:
        if (pile.length) ({ ctm, texte } = pile.pop());
        break;
      case OPS.beginText:
        texte.matrice = [1, 0, 0, 1, 0, 0];
        texte.ligne = [0, 0];
        break;
      case OPS.setFont:
        [texte.police, texte.taille] = args;
        break;
      case OPS.setCharSpacing:
        texte.espaceCaracteres = args[0];
        break;
      case OPS.setWordSpacing:
        texte.espaceMots = args[0];
        break;
      case OPS.setHScale:
        texte.echelle = args[0];
        break;
      case OPS.setLeading:
        texte.interligne = -args[0];
        break;
      case OPS.setTextRise:
        texte.elevation = args[0];
        break;
      case OPS.setTextMatrix:
        // PDF.js transmet ici la matrice enveloppée — [Float32Array(6)] —, et non
        // ses six nombres à plat comme pour `transform`.
        texte.matrice = nombres(args.length === 1 ? args[0] : args);
        texte.ligne = [0, 0];
        break;
      case OPS.setLeadingMoveText:
        texte.interligne = args[1];
      // pas de `break` : TD déplace ensuite comme Td (on « tombe » dans le cas suivant)
      case OPS.moveText: {
        const [tx, ty] = args;
        const [a, b, c, d, e, f] = texte.matrice;
        texte.matrice = [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
        texte.ligne = [0, 0];
        break;
      }
      case OPS.nextLine: {
        const [a, b, c, d, e, f] = texte.matrice;
        texte.matrice = [a, b, c, d, texte.interligne * c + e, texte.interligne * d + f];
        texte.ligne = [0, 0];
        break;
      }
      case OPS.showText:
        texte.ligne = afficherTexte(args[0], texte, ctm, polices, hauteur, caracteres);
        break;
      case OPS.constructPath:
        peindre(args, ctm, hauteur, objets);
        break;
      default:
        break; // couleurs, images… sans effet sur le texte ni les traits
    }
  }
  return { caracteres, objets };
}

// Codes des segments d'un tracé dans les données de `constructPath` (PDF.js 6).
const SEGMENT = { 0: "m", 1: "l", 2: "c", 3: "c", 4: "h" };
const NOMBRE_DE_COORDONNEES = { m: 2, l: 2, c: 6, h: 0 };
const PEINTURES_FERMANTES = new Set([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const PEINTURES = new Set([
  OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke,
  OPS.closeFillStroke, OPS.closeEOFillStroke,
]);

/**
 * Tracé peint : `constructPath` porte [peinture, [données], boîte]. Les
 * données enchaînent un code de segment et ses coordonnées. Un tracé non peint
 * (`endPath`, découpe) ne laisse aucun trait, comme dans pdfminer.
 */
function peindre([peinture, [donnees] = []], ctm, hauteur, objets) {
  if (!PEINTURES.has(peinture) || !donnees) return;
  const segments = [];
  for (let i = 0; i < donnees.length;) {
    const lettre = SEGMENT[donnees[i]];
    if (lettre === undefined) return; // code inconnu : on ne devine pas
    const n = donnees[i] === 3 ? 4 : NOMBRE_DE_COORDONNEES[lettre];
    segments.push([lettre, ...nombres(donnees.slice(i + 1, i + 1 + n))]);
    i += 1 + n;
  }
  if (PEINTURES_FERMANTES.has(peinture)) segments.push(["h"]);
  classerChemin(segments, ctm, hauteur, objets);
}

/** Classe un chemin en trait, rectangle ou courbe (`paint_path` de pdfminer). */
function classerChemin(segments, ctm, hauteur, objets) {
  let forme = segments.map((s) => s[0]).join("");
  if (forme[0] !== "m") return;
  if (forme.split("m").length - 1 > 1) {
    // Plusieurs sous-chemins : chacun est classé à part (« m » suivi d'autre chose).
    for (const m of forme.matchAll(/m[^m]+/g)) {
      classerChemin(segments.slice(m.index, m.index + m[0].length), ctm, hauteur, objets);
    }
    return;
  }

  // Un point par segment : sa destination (le point de départ pour « h »).
  const pts = segments.map((s) => {
    const [x, y] = s[0] === "h" ? segments[0].slice(-2) : s.slice(-2);
    return point(ctm, x, y);
  });
  const memePoint = (p, q) => p[0] === q[0] && p[1] === q[1];
  if (forme.length > 3 && forme.endsWith("lh") && memePoint(pts.at(-2), pts[0])) {
    forme = `${forme.slice(0, -2)}h`;
    pts.pop();
  }

  if (forme === "mlh" || forme === "ml") {
    objets.push(objetGraphique("line", [pts[0], pts[1]], hauteur));
  } else if (forme === "mlllh" || forme === "mllll") {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = pts;
    const ferme = memePoint(pts[0], pts[4]);
    const carre =
      (x0 === x1 && y1 === y2 && x2 === x3 && y3 === y0) ||
      (y0 === y1 && x1 === x2 && y2 === y3 && x3 === x0);
    if (ferme && carre) objets.push(objetGraphique("rect", [pts[0], pts[2]], hauteur));
    else objets.push(objetGraphique("curve", pts, hauteur));
  } else {
    objets.push(objetGraphique("curve", pts, hauteur));
  }
}

/** Objet graphique aux coordonnées de pdfplumber (rectangle englobant de ses points). */
function objetGraphique(type, pts, hauteur) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return {
    type,
    x0, x1,
    top: hauteur - y1,
    bottom: hauteur - y0,
    width: x1 - x0,
    height: y1 - y0,
    pts: pts.map(([x, y]) => [x, hauteur - y]),
  };
}

/**
 * Place les glyphes d'une instruction d'affichage de texte (Tj / TJ) —
 * `render_string_horizontal` puis `LTChar` de pdfminer. Renvoie la nouvelle
 * position dans la ligne.
 */
function afficherTexte(glyphes, texte, ctm, polices, hauteur, caracteres) {
  const p = polices.get(texte.police);
  if (!p) return texte.ligne;
  const taille = texte.taille;
  const echelle = texte.echelle * 0.01;
  const espaceCaracteres = texte.espaceCaracteres * echelle;
  // Polices composites (multi-octets) : pdfminer n'applique pas l'espacement des mots.
  const espaceMots = p.composite ? 0 : texte.espaceMots * echelle;
  const pasDecalage = 0.001 * taille * echelle;
  const echelleGlyphe = (p.fontMatrix ?? [0.001])[0];
  const descente = (p.descent ?? 0) * taille;
  const matrice = multiplier(texte.matrice, ctm);

  let [x, y] = texte.ligne;
  let espacer = false;
  for (const glyphe of glyphes) {
    if (typeof glyphe === "number") {
      // Ajustement d'un TJ, en millièmes de la taille de police.
      x -= glyphe * pasDecalage;
      espacer = true;
      continue;
    }
    if (!glyphe) continue;
    // pdfminer n'ajoute l'espacement des caractères qu'ENTRE deux glyphes.
    if (espacer) x += espaceCaracteres;

    const m = translater(matrice, x, y);
    const avance = (glyphe.width ?? p.defaultWidth ?? 0) * echelleGlyphe * taille * echelle;
    const [x0, y0, x1, y1] = rectangle(
      m, 0, descente + texte.elevation, avance, descente + texte.elevation + taille,
    );
    caracteres.push({
      texte: glyphe.unicode ?? "",
      x0,
      x1,
      top: hauteur - y1,
      bottom: hauteur - y0,
      droit: m[0] * m[3] * echelle > 0 && m[1] * m[2] <= 0,
    });

    x += avance;
    if (glyphe.originalCharCode === 32 && espaceMots) x += espaceMots;
    espacer = true;
  }
  return [x, y];
}

// ---------------------------------------------------------------------------
// Mots (pdfplumber : WordExtractor, réglages par défaut)
// ---------------------------------------------------------------------------

/** Regroupe des valeurs en chaîne : écart ≤ tolérance avec la précédente. */
export function grappes(valeurs, tolerance) {
  const triees = [...new Set(valeurs)].sort((a, b) => a - b);
  const indice = new Map();
  let numero = 0;
  triees.forEach((v, i) => {
    if (i > 0 && v > triees[i - 1] + tolerance) numero++;
    indice.set(v, numero);
  });
  return indice; // valeur → numéro de grappe
}

function fusionner(caracteres) {
  return {
    texte: caracteres.map((c) => LIGATURES[c.texte] ?? c.texte).join(""),
    x0: Math.min(...caracteres.map((c) => c.x0)),
    x1: Math.max(...caracteres.map((c) => c.x1)),
    top: Math.min(...caracteres.map((c) => c.top)),
    bottom: Math.max(...caracteres.map((c) => c.bottom)),
  };
}

function motsDeLigne(caracteres) {
  const mots = [];
  let courant = [];
  const clore = () => {
    if (courant.length) mots.push(fusionner(courant));
    courant = [];
  };
  for (const c of caracteres) {
    if (ESPACES_SEULES.test(c.texte)) {
      clore();
    } else if (c.texte === "") {
      // pdfplumber : un caractère sans texte forme un mot à lui seul.
      clore();
      courant = [c];
      clore();
    } else if (courant.length) {
      const precedent = courant.at(-1);
      const nouveauMot =
        c.x0 < precedent.x0 ||
        c.x0 > precedent.x1 + TOLERANCE_X ||
        Math.abs(c.top - precedent.top) > TOLERANCE_Y;
      if (nouveauMot) clore();
      courant.push(c);
    } else {
      courant.push(c);
    }
  }
  clore();
  return mots;
}

/** Mots d'une page, dans l'ordre de `page.extract_words()` de pdfplumber. */
export function motsDePage(caracteres) {
  const mots = [];
  // Les caractères se suivent par blocs de même orientation (itertools.groupby).
  let debut = 0;
  while (debut < caracteres.length) {
    let fin = debut;
    while (fin < caracteres.length && caracteres[fin].droit === caracteres[debut].droit) fin++;
    const bloc = caracteres.slice(debut, fin);
    debut = fin;

    // Lignes : grappes de `top` (tolérance 3), dans l'ordre des grappes ; tri
    // stable, donc l'ordre du flux est conservé à l'intérieur d'une grappe.
    const grappe = grappes(bloc.map((c) => c.top), TOLERANCE_Y);
    const lignes = new Map();
    for (const c of [...bloc].sort((a, b) => grappe.get(a.top) - grappe.get(b.top))) {
      const n = grappe.get(c.top);
      if (!lignes.has(n)) lignes.set(n, []);
      lignes.get(n).push(c);
    }
    for (const ligne of lignes.values()) {
      mots.push(...motsDeLigne(ligne.sort((a, b) => a.x0 - b.x0)));
    }
  }
  return mots;
}

/**
 * Regroupe les mots en lignes visuelles (haut → bas, gauche → droite) —
 * `_lignes_de_mots` (app.py) : un mot dont le haut s'écarte de plus de
 * `tolerance` du premier mot de la ligne en ouvre une nouvelle.
 */
function lignesDeMots(mots, tolerance = 3.0) {
  const tries = mots
    .filter((m) => rogner(m.texte))
    .sort((a, b) => a.top - b.top || a.x0 - b.x0); // tri sur (top, x0)
  const lignes = [];
  let courante = [];
  let topReference = null;
  for (const mot of tries) {
    if (courante.length && Math.abs(mot.top - topReference) > tolerance) {
      lignes.push(courante.sort((a, b) => a.x0 - b.x0));
      courante = [];
    }
    if (!courante.length) topReference = mot.top;
    courante.push(mot);
  }
  if (courante.length) lignes.push(courante.sort((a, b) => a.x0 - b.x0));
  return lignes;
}

/**
 * Lit toutes les pages d'un PDF ouvert : pour chacune, ses dimensions, ses
 * lignes de mots { texte, x0, x1, top, bottom }, ses caractères et ses traits.
 */
export async function lirePages(pdf) {
  const pages = [];
  for (let numero = 1; numero <= pdf.numPages; numero++) {
    const page = await pdf.getPage(numero);
    const [x0, y0, x1, y1] = page.view;
    const { caracteres, objets } = await analyserPage(page);
    const lignes = lignesDeMots(motsDePage(caracteres));
    pages.push({ numero, largeur: x1 - x0, hauteur: y1 - y0, lignes, caracteres, objets });
  }
  return pages;
}
