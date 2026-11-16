// Préparation et rapprochement des deux sources. Étape 2 : `nettoyerDonnees`.
// Les contrôles et les trois passes de rapprochement arrivent à l'étape 3.

import { ESPACE, convertirDates, rogner } from "./outils.js";
import { jourDateExcel } from "./grand-livre.js";

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
