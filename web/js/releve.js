// Relevé bancaire PDF : extraction (`extraire_releve_pdf`) et recoupement avec
// les totaux imprimés sur le relevé (`controler_extraction`).

import { lirePages, ouvrirPdf } from "./pdf-mots.js";
import { extraireParCoordonnees } from "./releve-coordonnees.js";
import { extraireParTableaux } from "./releve-tableaux.js";

/**
 * Extrait les opérations d'un relevé PDF (contenu en octets). Renvoie
 * { operations: [{ date, libelle, montant }], controles } ; montant en
 * centimes, crédit − débit (positif = entrée sur le compte).
 */
export async function extraireRelevePdf(octets) {
  let operations;
  let controles;
  try {
    const pdf = await ouvrirPdf(octets);
    try {
      const pages = await lirePages(pdf);
      ({ operations, controles } = extraireParCoordonnees(pages));
      // Aucune opération : relevé sans colonnes repérables par leur position
      // (« Extrait de compte ») — on se rabat sur ses tableaux, sans totaux.
      if (operations.length === 0) {
        operations = extraireParTableaux(pages);
        controles = {};
      }
    } finally {
      // Libère le worker et la mémoire (≈ fin du `with pdfplumber.open(...)`).
      await pdf.loadingTask.destroy();
    }
  } catch (erreur) {
    throw new Error(`Erreur lors de l'extraction du PDF : ${erreur.message}`, { cause: erreur });
  }

  if (operations.length === 0) {
    throw new Error(
      "Aucune opération n'a pu être extraite du relevé PDF. Vérifiez que le"
      + " document contient bien un tableau avec des colonnes Débit et Crédit.",
    );
  }
  return { operations, controles };
}

/**
 * Confronte l'extraction aux totaux de contrôle imprimés sur le relevé.
 * Renvoie { statut, tableau } : statut vaut true (tout concorde), false (écart)
 * ou null (aucun total exploitable : extraction non vérifiable).
 * Montants en centimes ; nombres d'opérations en unités.
 */
export function controlerExtraction({ operations, controles }) {
  const debits = operations.filter((o) => o.montant < 0);
  const credits = operations.filter((o) => o.montant > 0);
  const somme = (liste) => liste.reduce((total, o) => total + o.montant, 0); // ≈ sum()

  const attendus = [
    ["Nombre d'opérations au débit", debits.length, controles.nb_debits],
    ["Nombre d'opérations au crédit", credits.length, controles.nb_credits],
    ["Total des débits", -somme(debits), controles.total_debits],
    ["Total des crédits", somme(credits), controles.total_credits],
  ];
  if (controles.solde_initial != null) {
    attendus.push([
      "Solde de clôture recalculé",
      controles.solde_initial + somme(credits) + somme(debits),
      controles.solde_final,
    ]);
  }

  const tableau = attendus
    .filter(([, , annonce]) => annonce != null)
    .map(([controle, extrait, annonce]) => ({ controle, extrait, annonce, ecart: extrait - annonce }));
  if (tableau.length === 0) return { statut: null, tableau: [] };
  return { statut: tableau.every((ligne) => ligne.ecart === 0), tableau };
}
