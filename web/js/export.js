// Classeur Excel de résultat : équivalent de `ecrire_resultats` (app.py) et du
// bouton de téléchargement de l'interface Streamlit.
//
// Le classeur Python n'a aucune mise en forme (en-têtes non gras, format
// « Standard ») : la version gratuite de SheetJS, qui n'écrit pas de styles,
// produit donc le même classeur. Les dates restent du texte « AAAA-MM-JJ »,
// les montants sont des nombres en unités (centimes ÷ 100).

import * as XLSX from "../vendor/sheetjs/xlsx.mjs";

export const NOM_FICHIER = "resultat_rapprochement.xlsx";
const TYPE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const enUnites = (centimes) => (centimes == null ? null : centimes / 100);

/**
 * Feuille à partir d'un en-tête et de lignes de valeurs. `aoa_to_sheet`
 * (« array of arrays ») écrit l'en-tête même sans aucune ligne, comme
 * `to_excel` sur un tableau vide. Une valeur absente (libellé vide) devient un
 * texte vide "" — pandas écrit ainsi les valeurs manquantes (`na_rep=""`), et
 * non une cellule vide.
 */
const feuille = (entete, lignes) =>
  XLSX.utils.aoa_to_sheet([entete, ...lignes.map((ligne) => ligne.map((v) => v ?? ""))]);

const feuilleOperations = (operations) =>
  feuille(["date", "libelle", "montant"], operations.map((o) => [o.date, o.libelle, enUnites(o.montant)]));

/**
 * Construit le classeur de résultat :
 *   - « Opérations rapprochées » ;
 *   - « Manquants en compta » (opérations bancaires sans écriture) ;
 *   - « Manquants en banque » (écritures sans opération bancaire) ;
 *   - « Contrôles extraction », seulement si le relevé porte des totaux.
 * `resultat` vient d'executerRapprochement, `controle` de controlerExtraction.
 */
export function classeurResultats({ rapprochees, manquantsCompta, manquantsBanque }, controle = null) {
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille(
    [
      "ID_Match", "Type_Match", "Date_Banque", "Libelle_Banque", "Montant_Banque",
      "Date_Compta", "Libelle_Compta", "Montant_Compta", "Score_Similarité",
    ],
    rapprochees.map((r) => [
      r.idMatch, r.typeMatch, r.dateBanque, r.libelleBanque, enUnites(r.montantBanque),
      r.dateCompta, r.libelleCompta, enUnites(r.montantCompta), r.score,
    ]),
  ), "Opérations rapprochées");
  XLSX.utils.book_append_sheet(classeur, feuilleOperations(manquantsCompta), "Manquants en compta");
  XLSX.utils.book_append_sheet(classeur, feuilleOperations(manquantsBanque), "Manquants en banque");

  if (controle && controle.tableau.length > 0) {
    // Nombres d'opérations en unités, montants en centimes : seuls les seconds se divisent.
    const valeur = (ligne, v) => (ligne.controle.startsWith("Nombre") ? v : enUnites(v));
    XLSX.utils.book_append_sheet(classeur, feuille(
      ["Contrôle", "Extrait", "Annoncé par le relevé", "Écart"],
      controle.tableau.map((l) => [l.controle, valeur(l, l.extrait), valeur(l, l.annonce), valeur(l, l.ecart)]),
    ), "Contrôles extraction");
  }
  return classeur;
}

/** Contenu du fichier .xlsx, en octets. */
export function enOctets(classeur) {
  return new Uint8Array(XLSX.write(classeur, { type: "array", bookType: "xlsx", compression: true }));
}

/**
 * Propose le fichier au téléchargement — sans serveur : les octets sont
 * enveloppés dans un Blob (un « fichier en mémoire »), auquel le navigateur
 * attribue une adresse locale temporaire (blob:…) ; un lien <a download> vers
 * cette adresse, cliqué par programme, déclenche l'enregistrement.
 */
export function telecharger(octets, nom = NOM_FICHIER) {
  const adresse = URL.createObjectURL(new Blob([octets], { type: TYPE_XLSX }));
  const lien = document.createElement("a");
  lien.href = adresse;
  lien.download = nom;
  document.body.append(lien);
  lien.click();
  lien.remove();
  // L'adresse temporaire retient le fichier en mémoire : on la libère ensuite.
  setTimeout(() => URL.revokeObjectURL(adresse), 0);
}
