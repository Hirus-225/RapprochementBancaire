// Lecteur par tableaux : équivalent de `_extraire_par_tableaux` (app.py), qui
// s'appuie sur `page.extract_tables()` de pdfplumber. PDF.js ne détecte pas les
// tableaux : on refait ici l'algorithme de pdfplumber (TableFinder, réglages par
// défaut, stratégie « lines »), à partir des traits peints sur la page.
//
//   traits peints → arêtes horizontales / verticales → aimantées (3 pt) →
//   jointes (3 pt) → intersections (3 pt) → cellules → tableaux → texte des
//   cellules.
//
// Les comparaisons de positions sont des égalités EXACTES, comme dans
// pdfplumber : d'où la récupération des décimaux du fichier (pdf-mots.js).

import { grappes, motsDePage } from "./pdf-mots.js";
import { enCentimes, normaliser, rogner } from "./outils.js";
import { MOTIF_DATE, MOTIF_NOMBRE } from "./releve-coordonnees.js";

const AIMANTATION = 3; // snap_tolerance
const JONCTION = 3; // join_tolerance
const LONGUEUR_MIN = 3; // edge_min_length
const LONGUEUR_MIN_PREFILTRE = 1; // edge_min_length_prefilter
const INTERSECTION = 3; // intersection_tolerance

// ---------------------------------------------------------------------------
// Arêtes (pdfplumber.utils.geometry)
// ---------------------------------------------------------------------------

function rectEnAretes(r) {
  return [
    { ...r, height: 0, bottom: r.top, orientation: "h" },
    { ...r, height: 0, top: r.top + r.height, orientation: "h" },
    { ...r, width: 0, x1: r.x0, orientation: "v" },
    { ...r, width: 0, x0: r.x1, orientation: "v" },
  ];
}

function courbeEnAretes(c) {
  // Chaque paire de points consécutifs (≈ zip(pts, pts[1:])).
  return c.pts.slice(1).map((p1, i) => {
    const p0 = c.pts[i];
    let orientation = null;
    if (p0[0] === p1[0]) orientation = "v";
    else if (p0[1] === p1[1]) orientation = "h";
    return {
      x0: Math.min(p0[0], p1[0]),
      x1: Math.max(p0[0], p1[0]),
      top: Math.min(p0[1], p1[1]),
      bottom: Math.max(p0[1], p1[1]),
      width: Math.abs(p0[0] - p1[0]),
      height: Math.abs(p0[1] - p1[1]),
      orientation,
    };
  });
}

/** `page.edges` : arêtes des traits, puis des rectangles, puis des courbes. */
function aretesDeLaPage(objets) {
  const parType = (type) => objets.filter((o) => o.type === type);
  return [
    // Un trait est « horizontal » si son haut et son bas coïncident, sinon
    // « vertical » — même incliné (règle de pdfplumber, reproduite telle quelle).
    ...parType("line").map((o) => ({ ...o, orientation: o.top === o.bottom ? "h" : "v" })),
    ...parType("rect").flatMap(rectEnAretes),
    ...parType("curve").flatMap(courbeEnAretes),
  ];
}

function filtrerAretes(aretes, orientation, longueurMin) {
  return aretes.filter((a) => {
    const dimension = a.orientation === "v" ? a.height : a.width;
    return (orientation === null || a.orientation === orientation) && dimension >= longueurMin;
  });
}

/**
 * Regroupe des objets en grappes de valeurs voisines (`cluster_objects`) :
 * grappes dans l'ordre croissant, ordre d'origine conservé dans chaque grappe.
 */
export function enGrappes(objets, cle, tolerance) {
  const numero = grappes(objets.map(cle), tolerance);
  const groupes = new Map();
  for (const o of [...objets].sort((a, b) => numero.get(cle(a)) - numero.get(cle(b)))) {
    const n = numero.get(cle(o));
    if (!groupes.has(n)) groupes.set(n, []);
    groupes.get(n).push(o);
  }
  return [...groupes.values()];
}

/** Aimante les arêtes voisines (≤ 3 pt) sur leur position moyenne (`snap_edges`). */
function aimanter(aretes) {
  const deplacer = (attribut, champs) => (groupe) => {
    // Somme dans l'ordre de la grappe, comme sum() en Python : l'ordre des
    // additions change le dernier chiffre, et pdfplumber compare ensuite par égalité.
    let somme = 0;
    for (const a of groupe) somme += a[attribut];
    const moyenne = somme / groupe.length;
    return groupe.map((a) => {
      const decalage = moyenne - a[attribut];
      const copie = { ...a };
      for (const champ of champs) copie[champ] = a[champ] + decalage;
      return copie;
    });
  };
  const verticales = aretes.filter((a) => a.orientation === "v");
  const horizontales = aretes.filter((a) => a.orientation === "h");
  return [
    ...enGrappes(verticales, (a) => a.x0, AIMANTATION).flatMap(deplacer("x0", ["x0", "x1"])),
    ...enGrappes(horizontales, (a) => a.top, AIMANTATION).flatMap(deplacer("top", ["top", "bottom"])),
  ];
}

/** Joint les arêtes d'une même droite qui se touchent à 3 pt près (`join_edge_group`). */
function joindreGroupe(aretes, orientation) {
  const [debut, fin] = orientation === "h" ? ["x0", "x1"] : ["top", "bottom"];
  const triees = [...aretes].sort((a, b) => a[debut] - b[debut]);
  const jointes = [triees[0]];
  for (const a of triees.slice(1)) {
    const derniere = jointes.at(-1);
    if (a[debut] <= derniere[fin] + JONCTION) {
      if (a[fin] > derniere[fin]) {
        // resize_object : prolonge l'arête et met à jour sa longueur.
        const prolongee = { ...derniere, [fin]: a[fin] };
        if (fin === "x1") prolongee.width = a[fin] - derniere.x0;
        else prolongee.height = derniere.height + (a[fin] - derniere[fin]);
        jointes[jointes.length - 1] = prolongee;
      }
    } else {
      jointes.push(a);
    }
  }
  return jointes;
}

/** `merge_edges` : aimantation, puis jonction droite par droite. */
function fusionnerAretes(aretes) {
  const position = (a) => (a.orientation === "h" ? a.top : a.x0);
  // Tri sur (orientation, position) : « h » avant « v », comme les tuples Python.
  const triees = aimanter(aretes).sort((a, b) =>
    a.orientation === b.orientation ? position(a) - position(b) : a.orientation < b.orientation ? -1 : 1,
  );
  const resultat = [];
  let groupe = [];
  for (const a of triees) {
    const precedente = groupe[0];
    if (precedente && (precedente.orientation !== a.orientation || position(precedente) !== position(a))) {
      resultat.push(...joindreGroupe(groupe, precedente.orientation));
      groupe = [];
    }
    groupe.push(a);
  }
  if (groupe.length) resultat.push(...joindreGroupe(groupe, groupe[0].orientation));
  return resultat;
}

/** Arêtes utiles d'une page (`TableFinder.get_edges`). */
export function aretesUtiles(objets) {
  const toutes = aretesDeLaPage(objets);
  const aretes = [
    ...filtrerAretes(toutes, "v", LONGUEUR_MIN_PREFILTRE),
    ...filtrerAretes(toutes, "h", LONGUEUR_MIN_PREFILTRE),
  ];
  return filtrerAretes(fusionnerAretes(aretes), null, LONGUEUR_MIN);
}

// ---------------------------------------------------------------------------
// Intersections, cellules, tableaux (pdfplumber.table)
// ---------------------------------------------------------------------------

const cleRect = (a) => `${a.x0}|${a.top}|${a.x1}|${a.bottom}`;
const clePoint = (x, y) => `${x}|${y}`;

/** Points où une arête verticale croise une horizontale (`edges_to_intersections`). */
function intersections(aretes) {
  const verticales = aretes
    .filter((a) => a.orientation === "v")
    .sort((a, b) => a.x0 - b.x0 || a.top - b.top);
  const horizontales = aretes
    .filter((a) => a.orientation === "h")
    .sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const points = new Map(); // clé « x|y » → { x, y, v: Set, h: Set } (rectangles des arêtes)
  for (const v of verticales) {
    for (const h of horizontales) {
      if (
        v.top <= h.top + INTERSECTION &&
        v.bottom >= h.top - INTERSECTION &&
        v.x0 >= h.x0 - INTERSECTION &&
        v.x0 <= h.x1 + INTERSECTION
      ) {
        const cle = clePoint(v.x0, h.top);
        if (!points.has(cle)) points.set(cle, { x: v.x0, y: h.top, v: new Set(), h: new Set() });
        points.get(cle).v.add(cleRect(v));
        points.get(cle).h.add(cleRect(h));
      }
    }
  }
  return points;
}

/** Cellules rectangulaires décrites par les intersections (`intersections_to_cells`). */
function cellulesDepuis(points) {
  const ont = (a, b) => [...a].some((x) => b.has(x)); // intersection non vide de deux Set
  const relies = (p1, p2) =>
    (p1.x === p2.x && ont(p1.v, p2.v)) || (p1.y === p2.y && ont(p1.h, p2.h));

  const tries = [...points.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  const cellules = [];
  tries.forEach((pt, i) => {
    if (i === tries.length - 1) return;
    const reste = tries.slice(i + 1);
    const dessous = reste.filter((p) => p.x === pt.x);
    const droite = reste.filter((p) => p.y === pt.y);
    for (const bas of dessous) {
      if (!relies(pt, bas)) continue;
      for (const cote of droite) {
        if (!relies(pt, cote)) continue;
        const coin = points.get(clePoint(cote.x, bas.y));
        if (coin && relies(coin, cote) && relies(coin, bas)) {
          cellules.push([pt.x, pt.y, coin.x, coin.y]);
          return; // la plus petite cellule partant de ce point
        }
      }
    }
  });
  return cellules;
}

/** Regroupe les cellules qui partagent un coin en tableaux (`cells_to_tables`). */
function tableauxDepuis(cellules) {
  const coins = ([x0, top, x1, bottom]) =>
    [[x0, top], [x0, bottom], [x1, top], [x1, bottom]].map(([x, y]) => clePoint(x, y));

  const restantes = [...cellules];
  const tableaux = [];
  let coinsCourants = new Set();
  let courantes = [];
  while (restantes.length) {
    const avant = courantes.length;
    for (const cellule of [...restantes]) {
      const sesCoins = coins(cellule);
      if (courantes.length === 0 || sesCoins.some((c) => coinsCourants.has(c))) {
        for (const c of sesCoins) coinsCourants.add(c);
        courantes.push(cellule);
        restantes.splice(restantes.indexOf(cellule), 1); // ≈ list.remove
      }
    }
    if (courantes.length === avant) {
      tableaux.push(courantes);
      coinsCourants = new Set();
      courantes = [];
    }
  }
  if (courantes.length) tableaux.push(courantes);

  const origine = (t) => t.reduce((m, c) => (c[1] < m[0] || (c[1] === m[0] && c[0] < m[1]) ? [c[1], c[0]] : m), [Infinity, Infinity]);
  return tableaux
    .map((t) => ({ t, o: origine(t) }))
    .sort((a, b) => a.o[0] - b.o[0] || a.o[1] - b.o[1])
    .map(({ t }) => t)
    .filter((t) => t.length > 1);
}

/** Lignes d'un tableau : cellules rangées par colonne, null là où il n'y en a pas. */
function lignesDuTableau(cellules) {
  const triees = [...cellules].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const xs = [...new Set(cellules.map((c) => c[0]))].sort((a, b) => a - b);
  const lignes = [];
  let i = 0;
  while (i < triees.length) {
    const top = triees[i][1];
    const parX = new Map();
    for (; i < triees.length && triees[i][1] === top; i++) parX.set(triees[i][0], triees[i]);
    lignes.push(xs.map((x) => parX.get(x) ?? null));
  }
  return lignes;
}

const englobant = (rects) => [
  Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])),
  Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3])),
];

/** Caractère dont le centre tombe dans le rectangle (bords droit et bas exclus). */
function dansRect(c, [x0, top, x1, bottom]) {
  const milieuV = (c.top + c.bottom) / 2;
  const milieuH = (c.x0 + c.x1) / 2;
  return milieuH >= x0 && milieuH < x1 && milieuV >= top && milieuV < bottom;
}

/** Texte de caractères, sans mise en page (`extract_text`) : mots, puis lignes. */
function texteDe(caracteres) {
  if (caracteres.length === 0) return "";
  const lignes = enGrappes(motsDePage(caracteres), (m) => m.top, 3);
  return lignes.map((ligne) => ligne.map((m) => m.texte).join(" ")).join("\n");
}

/**
 * Tableaux d'une page, comme `page.find_tables()` / `extract_tables()` :
 * [{ bbox, lignes (rectangles des cellules), contenu (texte ou null) }].
 */
export function tableauxDeLaPage(page) {
  const aretes = aretesUtiles(page.objets);
  const cellules = cellulesDepuis(intersections(aretes));
  const tableaux = tableauxDepuis(cellules).map((cellulesDuTableau) => {
    const lignes = lignesDuTableau(cellulesDuTableau);
    const contenu = lignes.map((ligne) => {
      const caracteresLigne = page.caracteres.filter((c) => dansRect(c, englobant(ligne.filter(Boolean))));
      return ligne.map((cellule) =>
        cellule === null ? null : texteDe(caracteresLigne.filter((c) => dansRect(c, cellule))));
    });
    return { bbox: englobant(cellulesDuTableau), lignes, contenu };
  });
  return { aretes, cellules, tableaux };
}

// ---------------------------------------------------------------------------
// Opérations (_extraire_par_tableaux)
// ---------------------------------------------------------------------------

/**
 * Position des colonnes utiles sur une ligne d'en-tête de tableau
 * (`_colonnes_du_tableau`), ou null si la ligne n'est pas un en-tête.
 */
function colonnesDuTableau(cellules) {
  if (!cellules.includes("debit") || !cellules.includes("credit")) return null;
  const premiere = (test) => {
    const i = cellules.findIndex(test);
    return i === -1 ? null : i;
  };
  return {
    debit: cellules.indexOf("debit"),
    credit: cellules.indexOf("credit"),
    date: premiere((c) => c.includes("date")),
    libelle: premiere((c) => ["libelle", "operation", "intitule"].some((x) => c.includes(x))),
  };
}

/**
 * Extrait les opérations des tableaux du relevé. La ligne d'en-tête, relue
 * chaque fois qu'elle apparaît, donne la position des colonnes Débit et
 * Crédit ; sans en-tête connu, ultime secours : les deux dernières cellules
 * remplies (voir CLAUDE.md : ne jamais en faire la règle).
 */
export function extraireParTableaux(pages) {
  const operations = [];
  let colonnes = null;
  for (const page of pages) {
    for (const tableau of tableauxDeLaPage(page).tableaux) {
      for (const ligne of tableau.contenu) {
        const cellules = ligne.map((c) => (c === null ? "" : rogner(String(c))));
        const entete = colonnesDuTableau(cellules.map(normaliser));
        if (entete) {
          colonnes = entete;
          continue;
        }

        const dateVal = cellules.find((c) => MOTIF_DATE.test(c));
        if (!dateVal) continue;

        let debit;
        let credit;
        let libelle;
        if (colonnes && Math.max(colonnes.debit, colonnes.credit) < cellules.length) {
          debit = enCentimes(cellules[colonnes.debit]) ?? 0;
          credit = enCentimes(cellules[colonnes.credit]) ?? 0;
          if (colonnes.libelle !== null && colonnes.libelle < cellules.length) {
            libelle = cellules[colonnes.libelle];
          } else {
            libelle = cellules.filter((c) => c !== dateVal && !MOTIF_NOMBRE.test(c)).join(" ");
          }
        } else {
          const remplies = cellules.filter(Boolean);
          if (remplies.length < 4) continue;
          debit = enCentimes(remplies.at(-2)) ?? 0;
          credit = enCentimes(remplies.at(-1)) ?? 0;
          libelle = remplies.filter((c) => c !== dateVal && !MOTIF_NOMBRE.test(c)).join(" ");
        }
        operations.push({ date: dateVal, libelle, montant: credit - debit });
      }
    }
  }
  return operations;
}
