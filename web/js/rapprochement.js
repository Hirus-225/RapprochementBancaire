// Préparation et rapprochement des deux sources : nettoyage, contrôle du sens
// des montants et rapprochement en trois passes (équivalents de
// `nettoyer_donnees`, `controler_sens_montants` et `executer_rapprochement`).

import { ESPACE, convertirDates, ecartJours, numeroCheque, rogner } from "./outils.js";
import { jourDateExcel } from "./grand-livre.js";
import { ratio, tokenSetRatio } from "./similarite.js";

// Valeurs par défaut des réglages de l'étape 3 (réglables depuis l'interface).
export const TOLERANCE_JOURS = 4;
export const SCORE_MINIMUM = 80;

export const TYPE_PARFAIT = "Parfait";
export const TYPE_CHEQUE = "Numéro de chèque";
export const TYPE_PARTIEL = "Partiel (Tolérance date & libellé)";

const ESPACES_MULTIPLES = new RegExp(`${ESPACE}+`, "g");

/**
 * Standardise libellés, montants et dates — équivalent de `nettoyer_donnees`.
 *
 * Reçoit et renvoie des opérations `{ date, libelle, montant }` (montant en
 * centimes). Le tableau d'entrée n'est pas modifié : on en construit un nouveau,
 * comme `df.copy()`.
 *   - libellé : espaces multiples réduites à une, bords rognés, MAJUSCULES ;
 *     un libellé absent reste absent (null) ;
 *   - date : « AAAA-MM-JJ ». Une colonne de dates Excel est recopiée telle
 *     quelle ; une colonne de textes est convertie d'un bloc, le format étant
 *     déduit de la première valeur (convertirDates) ;
 *   - sont écartées les opérations sans date valide, sans montant lisible, ou
 *     dont le montant est nul (rien à rapprocher).
 */
export function nettoyerDonnees(operations, anneeCourante = new Date().getFullYear()) {
  const datesBrutes = operations.map((o) => o.date);
  const datesExcel = datesBrutes.every((d) => d === null || typeof d === "object");
  const dates = datesExcel
    ? datesBrutes.map((d) => (d === null ? null : jourDateExcel(d)))
    : convertirDates(datesBrutes.map((d) => (d === null ? "" : d)), anneeCourante);

  return operations
    .map((o, i) => ({
      date: dates[i],
      libelle: o.libelle === null ? null : rogner(String(o.libelle).replace(ESPACES_MULTIPLES, " ")).toUpperCase(),
      montant: o.montant,
    }))
    .filter((o) => o.date !== null && o.montant !== null && o.montant !== 0);
}

/**
 * Détecte une inversion de signe entre relevé et comptabilité
 * (`controler_sens_montants`). Le compte de banque tenu en comptabilité est le
 * miroir du relevé ; se tromper de sens ne lève aucune erreur mais ramène le
 * rapprochement à zéro. Renvoie un message d'alerte, ou null.
 */
export function controlerSensMontants(banque, compta) {
  // Map ≈ Counter : montant → nombre d'écritures comptables de ce montant.
  const effectifs = new Map();
  for (const { montant } of compta) effectifs.set(montant, (effectifs.get(montant) ?? 0) + 1);

  const directs = banque.filter((o) => effectifs.has(o.montant)).length;
  const inverses = banque.filter((o) => effectifs.has(-o.montant)).length;

  if (inverses > Math.max(5, directs * 1.5)) {
    return (
      "Les montants concordent bien mieux en inversant le signe de la"
      + ` comptabilité (${inverses} correspondances contre ${directs}). Vérifiez`
      + " la convention Débit/Crédit du grand livre avant d'exploiter le"
      + " résultat."
    );
  }
  return null;
}

/**
 * Rapproche les deux sources en trois passes (`executer_rapprochement`) :
 *   1. Parfait : même montant et même date ;
 *   2. Numéro de chèque : même montant et même numéro, quelle que soit la date
 *      (la compta date le chèque à l'émission, la banque à l'encaissement) ;
 *   3. Partiel : même montant, date à ± toleranceJours et similarité des
 *      libellés strictement supérieure à scoreMinimum.
 *
 * Chaque passe ne voit que ce qui reste non rapproché. À candidats multiples,
 * le meilleur l'emporte et, à égalité, le premier dans l'ordre du fichier —
 * comme `max()` / `min()` en Python, qui gardent le premier extremum rencontré.
 *
 * Renvoie { rapprochees, manquantsCompta, manquantsBanque } :
 *   - manquantsCompta : opérations bancaires absentes de la compta ;
 *   - manquantsBanque : écritures comptables absentes du relevé.
 */
export function executerRapprochement(
  banque,
  compta,
  toleranceJours = TOLERANCE_JOURS,
  scoreMinimum = SCORE_MINIMUM,
) {
  // Un tableau de booléens par source tient lieu de colonne « statut ».
  const banqueRapprochee = banque.map(() => false);
  const comptaRapprochee = compta.map(() => false);
  const rapprochees = [];

  function enregistrer(ib, ic, typeMatch, score) {
    const b = banque[ib];
    const c = compta[ic];
    rapprochees.push({
      idMatch: rapprochees.length + 1,
      typeMatch,
      dateBanque: b.date,
      libelleBanque: b.libelle,
      montantBanque: b.montant,
      dateCompta: c.date,
      libelleCompta: c.libelle,
      montantCompta: c.montant,
      score,
    });
    banqueRapprochee[ib] = true;
    comptaRapprochee[ic] = true;
  }

  // Indices des opérations bancaires encore libres au début d'une passe.
  const banqueLibre = () => banque.map((_, i) => i).filter((i) => !banqueRapprochee[i]);

  /** Indices des écritures comptables libres et de même montant que `b`. */
  function candidats(b) {
    const indices = [];
    for (const [ic, c] of compta.entries()) {
      if (!comptaRapprochee[ic] && c.montant === b.montant) indices.push(ic);
    }
    return indices;
  }

  // Étape 1 : montant et date identiques ; à candidats multiples, le libellé le
  // plus ressemblant, pour ne pas apparier deux opérations jumelles au hasard.
  for (const ib of banqueLibre()) {
    const b = banque[ib];
    let meilleur = -1;
    let meilleurScore = -Infinity;
    for (const ic of candidats(b)) {
      if (compta[ic].date !== b.date) continue;
      const score = ratio(b.libelle, compta[ic].libelle);
      if (score > meilleurScore) [meilleur, meilleurScore] = [ic, score];
    }
    if (meilleur >= 0) enregistrer(ib, meilleur, TYPE_PARFAIT, 100);
  }

  // Étape 2 : même montant et même numéro de chèque, sans contrainte de date ;
  // à candidats multiples, la date la plus proche.
  const chequeDe = (o) => (o.libelle == null ? null : numeroCheque(o.libelle));
  const chequesCompta = compta.map(chequeDe);
  for (const ib of banqueLibre()) {
    const b = banque[ib];
    const cheque = chequeDe(b);
    if (!cheque) continue;
    let meilleur = -1;
    let meilleurEcart = Infinity;
    for (const ic of candidats(b)) {
      if (chequesCompta[ic] !== cheque) continue;
      const ecart = Math.abs(ecartJours(compta[ic].date, b.date));
      if (ecart < meilleurEcart) [meilleur, meilleurEcart] = [ic, ecart];
    }
    if (meilleur >= 0) {
      enregistrer(ib, meilleur, TYPE_CHEQUE, tokenSetRatio(b.libelle, compta[meilleur].libelle));
    }
  }

  // Étape 3 : montant identique, date tolérée, libellés proches.
  for (const ib of banqueLibre()) {
    const b = banque[ib];
    let meilleur = -1;
    let meilleurScore = 0;
    for (const ic of candidats(b)) {
      if (Math.abs(ecartJours(compta[ic].date, b.date)) > toleranceJours) continue;
      const score = tokenSetRatio(b.libelle, compta[ic].libelle);
      if (score > scoreMinimum && score > meilleurScore) [meilleur, meilleurScore] = [ic, score];
    }
    if (meilleur >= 0) enregistrer(ib, meilleur, TYPE_PARTIEL, meilleurScore);
  }

  const restantes = (operations, rapprochee) =>
    operations
      .filter((_, i) => !rapprochee[i])
      .map(({ date, libelle, montant }) => ({ date, libelle, montant }));

  return {
    rapprochees,
    manquantsCompta: restantes(banque, banqueRapprochee),
    manquantsBanque: restantes(compta, comptaRapprochee),
  };
}
