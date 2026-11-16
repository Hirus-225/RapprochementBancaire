// Lecteur par coordonnées : équivalent de `_extraire_par_coordonnees` (app.py)
// et de ses fonctions d'appui. Chaque mot est rangé dans une colonne d'après sa
// position horizontale, les colonnes étant déduites de la ligne d'en-tête,
// relue à chaque page. Voir CLAUDE.md, « Extraction du PDF — pourquoi les
// coordonnées », pour les raisons de chaque règle.

import { CHIFFRE, CHIFFRE_ISDIGIT, ESPACE, ESPACE_CARACTERES, enCentimes, normaliser, rogner } from "./outils.js";

// --- Motifs (mêmes expressions qu'app.py ; `\d` → \p{Nd}, `\s` → ESPACE) -----
// Le drapeau `u` est nécessaire pour `\p{…}`.
const D = CHIFFRE;
const S = ESPACE;

// Le mois est chiffré (« 30/01/2026 ») ou abrégé en lettres (« 30-Jan-2026 »).
export const MOTIF_DATE = new RegExp(`^${D}{1,2}[/.-](?:${D}{1,2}|[A-Za-z]{3,9})[/.-]${D}{2,4}$`, "u");
// Numérotation de ligne (« 1. », « 2. »…) précédant la date sur certains relevés.
const MOTIF_NUMERO_LIGNE = new RegExp(`^${D}{1,3}\\.$`, "u");
export const MOTIF_NOMBRE = new RegExp(`^-?[${D}.,]+$`, "u");
const MOTIF_NUMERO_PAGE = new RegExp(`^${D}{1,3}${S}*/${S}*${D}{1,3}$`, "u");
// Pied de page « n° de page + date et heure d'édition » (« 1 09 Feb 2026, 10:23 »).
const MOTIF_PIED_HORODATE = new RegExp(
  `^${D}{1,3}${S}+${D}{1,2}[${ESPACE_CARACTERES}/.-][a-z0-9]{2,9}[${ESPACE_CARACTERES}/.-]${D}{2,4},?${S}+${D}{1,2}:${D}{2}$`,
  "u",
);
// Devise accolée au montant (« XOF6,000.00 ») : retirée avant lecture du nombre.
const MOTIF_DEVISE = /^(?:XOF|F\.?CFA|CFA|EUR|USD)/i;
const CONTIENT_CHIFFRE = new RegExp(CHIFFRE_ISDIGIT, "u");

// Mots-clés permettant de repérer chaque colonne dans la ligne d'en-tête du PDF.
const MOTS_ENTETE = {
  date: ["date", "op."],
  libelle: ["libelle", "operation", "operations", "intitule", "details", "description"],
  reference: ["reference"],
  valeur: ["valeur", "value"],
  debit: ["debit", "debits", "payments", "withdrawals"],
  credit: ["credit", "credits", "deposits"],
  solde: ["solde", "balance"],
};
// Ordre d'arbitrage quand un intitulé porte deux mots-clés (« Date de valeur »).
const PRIORITE_COLONNES = ["debit", "credit", "solde", "valeur", "libelle", "reference", "date"];

// Écart horizontal (points) au-delà duquel deux mots d'en-tête relèvent de deux
// colonnes distinctes (voir le commentaire de _ECART_ENTETE dans app.py).
const ECART_ENTETE = 6;

// Lignes de pied de page qui marquent la fin de la zone exploitable.
const MARQUEURS_FIN = ["sauf erreur", "sauf observation"];

// Libellés des lignes de synthèse dont on extrait les totaux de contrôle.
const SOLDE_INITIAL = ["solde precedent", "report a nouveau", "ancien solde"];
const NOMBRE_OPERATIONS = "nombre de transactions";
const TOTAL_MOUVEMENTS = "total des mouvements";
const SOLDE_FINAL = "solde au";

// Totaux imprimés en cartouche d'en-tête, « libellé : montant ».
const MONTANT_CARTOUCHE =
  `(?:xof|f\\.?cfa|cfa|eur|usd)?${S}*`
  + `(-?${D}{1,3}(?:[${ESPACE_CARACTERES}.,]${D}{3})*(?:[.,]${D}{1,2})?)`;
const CARTOUCHE = [
  ["solde_initial", "ancien solde|solde precedent|report a nouveau|opening balance"],
  ["solde_final", "nouveau solde|solde final|closing balance"],
  ["total_credits", "(?:somme|total)(?: des)? credits?"],
  ["total_debits", "(?:somme|total)(?: des)? debits?"],
].map(([cle, motif]) => [cle, new RegExp(`(?:${motif})${S}*:?${S}*${MONTANT_CARTOUCHE}`, "u")]);

// --- Lecture des nombres pour les contrôles ----------------------------------

/**
 * Valeur d'un total de contrôle : centimes pour un montant ; pour un nombre
 * d'opérations, l'unité (enCentimes / 100). Python stocke un float dans les
 * deux cas, d'où ce même passage par _en_nombre.
 */
const nombreOperations = (texte) => {
  const centimes = enCentimes(texte);
  return centimes === null ? null : centimes / 100;
};

// --- En-tête et colonnes ------------------------------------------------------

const centre = (mot) => (mot.x0 + mot.x1) / 2;

/** Regroupe les mots contigus de la ligne d'en-tête en intitulés de colonnes. */
function grouperEntete(ligne) {
  const groupes = [];
  for (const mot of ligne) {
    const dernier = groupes.at(-1);
    if (dernier && mot.x0 - dernier.at(-1).x1 <= ECART_ENTETE) dernier.push(mot);
    else groupes.push([mot]);
  }
  return groupes;
}

/**
 * Repère la ligne d'en-tête et renvoie l'emprise horizontale de chaque colonne
 * ({ debit: [x0, x1], … }), ou null si la ligne n'est pas un en-tête (il faut
 * au moins Débit et Crédit, et aucun chiffre — un cartouche « Total Debit …
 * Total Credit … » porte les deux mots-clés mais n'est pas un en-tête).
 */
function detecterColonnes(ligne) {
  if (ligne.some((mot) => CONTIENT_CHIFFRE.test(mot.texte))) return null;

  const emprises = {};
  for (const groupe of grouperEntete(ligne)) {
    const mots = groupe.map((m) => normaliser(m.texte));
    const colonne = PRIORITE_COLONNES.find((c) => mots.some((m) => MOTS_ENTETE[c].includes(m)));
    // `in` teste la présence d'une clé dans un objet, comme `in` sur un dict.
    if (colonne !== undefined && !(colonne in emprises)) {
      emprises[colonne] = [groupe[0].x0, groupe.at(-1).x1];
    }
  }
  if (!("debit" in emprises) || !("credit" in emprises)) return null;
  return emprises;
}

/** Colonnes classées de gauche à droite d'après l'en-tête, la date exceptée. */
function ordreColonnes(emprises) {
  return Object.keys(emprises)
    .filter((c) => c !== "date")
    .sort((a, b) => emprises[a][0] - emprises[b][0]);
}

/** Frontières entre colonnes voisines : frontieres[k] sépare ordre[k] et ordre[k+1]. */
function frontieres(emprises) {
  const ordre = ordreColonnes(emprises);
  return ordre.slice(1).map((droite, k) => (emprises[ordre[k]][1] + emprises[droite][0]) / 2);
}

/** Attribue un mot à une colonne d'après sa position horizontale. */
function colonneDuMot(mot, ordre, limites) {
  const k = limites.findIndex((limite) => centre(mot) < limite);
  return k === -1 ? ordre.at(-1) : ordre[k];
}

/**
 * Abscisse séparant la zone « date + libellé » des colonnes numériques : le
 * bord GAUCHE de la colonne qui suit le libellé (et non le point milieu, qui
 * ferait basculer la fin d'un libellé long du côté des montants).
 */
function limiteZoneGauche(emprises) {
  const ordre = ordreColonnes(emprises);
  const rang = ordre.indexOf("libelle");
  if (rang !== -1 && rang + 1 < ordre.length) return emprises[ordre[rang + 1]][0];
  return Math.min(emprises.debit[0], emprises.credit[0]);
}

/** Vrai si la colonne Valeur précède le libellé (elle reste alors en zone gauche). */
function valeurAvantLibelle(emprises) {
  if (!("valeur" in emprises) || !("libelle" in emprises)) return false;
  return emprises.valeur[0] < emprises.libelle[0];
}

/**
 * Isole la date d'opération en tête de la zone de gauche, en sautant un numéro
 * de ligne (« 1. ») et, si la colonne Valeur est à gauche, la date de valeur.
 * Renvoie [date, mots restants] ; date null si la ligne n'ouvre pas d'opération.
 */
function detacherDate(mots, valeurAGauche) {
  let restants = mots;
  if (
    restants.length >= 2 &&
    MOTIF_NUMERO_LIGNE.test(rogner(restants[0].texte)) &&
    MOTIF_DATE.test(rogner(restants[1].texte))
  ) {
    restants = restants.slice(1);
  }
  if (!restants.length || !MOTIF_DATE.test(rogner(restants[0].texte))) return [null, mots];

  const dateOperation = rogner(restants[0].texte);
  restants = restants.slice(1);
  if (valeurAGauche && restants.length && MOTIF_DATE.test(rogner(restants[0].texte))) {
    restants = restants.slice(1);
  }
  return [dateOperation, restants];
}

// --- Totaux de contrôle -------------------------------------------------------

/** Totaux écrits « libellé : montant » en cartouche, avant l'en-tête. */
function lireCartouche(texte, controles) {
  for (const [cle, motif] of CARTOUCHE) {
    if (cle in controles) continue;
    const trouve = motif.exec(texte);
    if (trouve) {
      const montant = enCentimes(trouve[1]);
      if (montant !== null) controles[cle] = montant;
    }
  }
}

/** Totaux imprimés en pied de relevé, sur les colonnes Débit / Crédit / Solde. */
function lireLigneDeSynthese(texteGauche, colonnes, controles) {
  const solde = enCentimes(colonnes.solde.join(""));

  if (solde !== null && !("solde_initial" in controles)) {
    if (SOLDE_INITIAL.some((x) => texteGauche.startsWith(x))) controles.solde_initial = solde;
  }
  if (texteGauche.includes(NOMBRE_OPERATIONS)) {
    controles.nb_debits = nombreOperations(colonnes.debit.join(""));
    controles.nb_credits = nombreOperations(colonnes.credit.join(""));
  } else if (texteGauche.includes(TOTAL_MOUVEMENTS)) {
    controles.total_debits = enCentimes(colonnes.debit.join(""));
    controles.total_credits = enCentimes(colonnes.credit.join(""));
  } else if (texteGauche.startsWith(SOLDE_FINAL) && solde !== null) {
    controles.solde_final = solde;
  }
}

// --- Extraction ---------------------------------------------------------------

/**
 * Extrait les opérations des pages lues par lirePages (pdf-mots.js). Renvoie
 * { operations: [{ date, libelle, montant }], controles } ; le montant est en
 * centimes, signé du point de vue de la banque : crédit − débit.
 */
export function extraireParCoordonnees(pages) {
  const operations = [];
  const controles = {};
  let emprises = null;
  let ordre = null;
  let limites = null;
  let valeurAGauche = false;

  for (const page of pages) {
    let courante = null;
    for (const ligne of page.lignes) {
      const texteLigne = normaliser(ligne.map((m) => m.texte).join(" "));

      const entete = detecterColonnes(ligne);
      if (entete) {
        emprises = entete;
        ordre = ordreColonnes(entete);
        limites = frontieres(entete);
        valeurAGauche = valeurAvantLibelle(entete);
        courante = null;
        continue;
      }

      if (emprises === null) {
        // Avant l'en-tête : seul le cartouche de totaux nous intéresse.
        lireCartouche(texteLigne, controles);
        continue;
      }

      // Pied de page : on arrête la lecture de la page en cours.
      if (MARQUEURS_FIN.some((marqueur) => texteLigne.includes(marqueur))) break;
      if (MOTIF_NUMERO_PAGE.test(texteLigne) || MOTIF_PIED_HORODATE.test(texteLigne)) continue;

      const limiteGauche = limiteZoneGauche(emprises);
      const motsGaucheBruts = ligne.filter((m) => centre(m) < limiteGauche);
      const motsDroite = ligne.filter((m) => centre(m) >= limiteGauche);

      // Une nouvelle opération s'ouvre sur une date dans la zone de gauche.
      const [dateOperation, motsGauche] = detacherDate(motsGaucheBruts, valeurAGauche);

      const colonnes = { valeur: [], debit: [], credit: [], solde: [] };
      let droiteNonNumerique = false;
      for (const mot of motsDroite) {
        const texte = rogner(mot.texte).replace(MOTIF_DEVISE, "");
        const colonne = colonneDuMot(mot, ordre, limites);
        if (colonne === "reference") continue; // référence interne de la banque
        if (colonne === "valeur" && MOTIF_DATE.test(texte)) {
          colonnes.valeur.push(texte);
        } else if (MOTIF_NOMBRE.test(texte)) {
          // Un montant large peut déborder sous l'en-tête « Valeur ».
          const cible = colonne === "valeur" ? "debit" : colonne;
          // Python lève ici une KeyError (colonne « libelle » ou « date ») :
          // l'erreur remonte et arrête l'extraction, avec le même message.
          if (!(cible in colonnes)) throw new Error(`'${cible}'`);
          colonnes[cible].push(texte);
        } else {
          droiteNonNumerique = true;
        }
      }

      const libelle = rogner(motsGauche.map((m) => rogner(m.texte)).join(" "));
      const montantsPresents = ["debit", "credit", "solde"].some((c) => colonnes[c].length > 0);

      if (dateOperation) {
        const debit = enCentimes(colonnes.debit.join("")) ?? 0;
        const credit = enCentimes(colonnes.credit.join("")) ?? 0;
        courante = { date: dateOperation, libelle, montant: credit - debit };
        operations.push(courante);
      } else if (droiteNonNumerique || montantsPresents) {
        // Bloc d'adresse, solde d'ouverture, totaux de fin… : on ferme
        // l'opération en cours pour ne pas polluer son libellé.
        if (montantsPresents && !droiteNonNumerique) {
          lireLigneDeSynthese(normaliser(libelle), colonnes, controles);
        }
        courante = null;
      } else if (courante !== null && libelle) {
        courante.libelle = rogner(`${courante.libelle} ${libelle}`);
      }
    }
  }
  return { operations, controles };
}
