// Interface du site.
//
// La page est construite une fois (index.html), puis des fonctions sont
// attachées aux événements : dépôt d'un fichier, curseur, bouton, navigation.
// La logique métier vit dans les autres modules ; ce fichier ne fait que
// l'enchaîner et en afficher le résultat.
//
// Sécurité : tout texte venant des fichiers de l'utilisateur (libellés…) est
// inséré avec `textContent`, jamais comme du HTML — un libellé piégé ne peut
// donc pas devenir du code. Seul le manuel, fichier du site, est rendu en HTML.

import { marked } from "../vendor/marked/marked.esm.js";
import { arrondiPair } from "./outils.js";
import { chargerGrandLivre } from "./grand-livre.js";
import { controlerExtraction, extraireRelevePdf } from "./releve.js";
import {
  SCORE_MINIMUM, TOLERANCE_JOURS, controlerSensMontants, executerRapprochement, nettoyerDonnees,
} from "./rapprochement.js";
import { NOM_FICHIER, classeurResultats, enOctets, telecharger } from "./export.js";

// `$` : raccourci pour querySelector (≈ trouver un élément de la page par sélecteur CSS).
const $ = (selecteur, racine = document) => racine.querySelector(selecteur);

// ---------------------------------------------------------------------------
// Petits constructeurs d'éléments
// ---------------------------------------------------------------------------

/** Crée un élément ; `texte` est inséré comme texte brut (jamais interprété). */
function element(balise, { classe, texte, attributs = {} } = {}, enfants = []) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined) e.textContent = texte;
  for (const [nom, valeur] of Object.entries(attributs)) e.setAttribute(nom, valeur);
  e.append(...enfants);
  return e;
}

/** Message coloré : information, succès, avertissement ou erreur. */
function alerte(genre, texte) {
  const role = genre === "error" || genre === "warning" ? "alert" : "status";
  return element("div", { classe: `alert alert--${genre}`, texte, attributs: { role } });
}

const formatNombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
/** Montant en centimes → « −400 000 » ou « 1 234,56 ». */
const montant = (centimes) => (centimes == null ? "" : formatNombre.format(centimes / 100));

/**
 * Tableau de données. `colonnes` : [{ titre, valeur(ligne),
 * genre }] ; genre « nombre » aligne à droite, « texte » (libellés) peut passer
 * à la ligne ; les autres colonnes restent sur une ligne.
 */
function tableau(colonnes, lignes) {
  const entete = element("tr", {}, colonnes.map((c) => element("th", { texte: c.titre, attributs: { scope: "col" } })));
  const corps = lignes.map((ligne) => element("tr", {}, colonnes.map((c) => {
    const valeur = c.valeur(ligne);
    return element("td", { classe: c.genre ?? "", texte: valeur == null ? "" : String(valeur) });
  })));
  return element("div", { classe: "table-wrap", attributs: { tabindex: "0" } }, [
    element("table", { classe: "data" }, [element("thead", {}, [entete]), element("tbody", {}, corps)]),
  ]);
}

const colonnesOperations = [
  { titre: "date", valeur: (o) => o.date, genre: "date" },
  { titre: "libelle", valeur: (o) => o.libelle, genre: "texte" },
  { titre: "montant", valeur: (o) => montant(o.montant), genre: "nombre" },
];

const colonnesRapprochees = [
  { titre: "ID_Match", valeur: (r) => r.idMatch, genre: "nombre" },
  { titre: "Type_Match", valeur: (r) => r.typeMatch },
  { titre: "Date_Banque", valeur: (r) => r.dateBanque, genre: "date" },
  { titre: "Libelle_Banque", valeur: (r) => r.libelleBanque, genre: "texte" },
  { titre: "Montant_Banque", valeur: (r) => montant(r.montantBanque), genre: "nombre" },
  { titre: "Date_Compta", valeur: (r) => r.dateCompta, genre: "date" },
  { titre: "Libelle_Compta", valeur: (r) => r.libelleCompta, genre: "texte" },
  { titre: "Montant_Compta", valeur: (r) => montant(r.montantCompta), genre: "nombre" },
  { titre: "Score_Similarité", valeur: (r) => r.score, genre: "nombre" },
];

/** Tableau des contrôles : nombres d'opérations en unités, montants en centimes. */
function tableauControles(lignes) {
  const valeur = (ligne, v) => (ligne.controle.startsWith("Nombre") ? formatNombre.format(v) : montant(v));
  return tableau([
    { titre: "Contrôle", valeur: (l) => l.controle },
    { titre: "Extrait", valeur: (l) => valeur(l, l.extrait), genre: "nombre" },
    { titre: "Annoncé par le relevé", valeur: (l) => valeur(l, l.annonce), genre: "nombre" },
    { titre: "Écart", valeur: (l) => valeur(l, l.ecart), genre: "nombre" },
  ], lignes);
}

/** Indicateur chiffré. */
const metrique = (libelle, valeur) => element("div", { classe: "metrique" }, [
  element("p", { classe: "metrique__libelle", texte: libelle }),
  element("p", { classe: "metrique__valeur", texte: String(valeur) }),
]);

/**
 * Onglets accessibles : boutons role="tab", flèches gauche/droite
 * pour passer de l'un à l'autre, un seul panneau visible.
 */
function onglets(definitions) {
  const liste = element("div", { attributs: { role: "tablist", "aria-label": "Résultats" } });
  const panneaux = [];
  const boutons = definitions.map(({ titre, contenu }, i) => {
    const id = `onglet-${i}`;
    const bouton = element("button", {
      texte: titre,
      attributs: { type: "button", role: "tab", id, "aria-controls": `${id}-panneau` },
    });
    panneaux.push(element("div", {
      attributs: { role: "tabpanel", id: `${id}-panneau`, "aria-labelledby": id, tabindex: "0" },
    }, [contenu]));
    return bouton;
  });

  function choisir(index) {
    boutons.forEach((b, i) => {
      b.setAttribute("aria-selected", String(i === index));
      b.tabIndex = i === index ? 0 : -1; // seul l'onglet actif reçoit la tabulation
      panneaux[i].hidden = i !== index;
    });
  }
  boutons.forEach((b, i) => {
    b.addEventListener("click", () => choisir(i));
    b.addEventListener("keydown", (evenement) => {
      const pas = { ArrowRight: 1, ArrowLeft: -1 }[evenement.key];
      if (!pas) return;
      const suivant = (i + pas + boutons.length) % boutons.length;
      choisir(suivant);
      boutons[suivant].focus();
    });
  });
  liste.append(...boutons);
  choisir(0);
  return element("div", { classe: "onglets" }, [liste, ...panneaux]);
}

/** Pourcentage écrit comme `f"{x:.1f}"` en Python (demi arrondi au pair). */
const pourcentage = (x) => `${(arrondiPair(x * 10) / 10).toFixed(1)} %`;

// ---------------------------------------------------------------------------
// Dépôt des fichiers
// ---------------------------------------------------------------------------

const fichiers = { releve: null, "grand-livre": null };

const tailleLisible = (octets) =>
  octets < 1024 * 1024 ? `${Math.max(1, Math.round(octets / 1024))} Ko` : `${(octets / 1024 / 1024).toFixed(1)} Mo`;

function preparerDepot(depot) {
  const nom = depot.dataset.depot; // data-depot="releve" → dataset.depot
  const extensions = depot.dataset.extensions.split(",");
  const entree = $("input[type=file]", depot);
  const zone = $(".dropzone", depot);
  const pastille = $(".file-pill", depot);
  const erreur = $(".depot__erreur", depot);

  function retenir(fichier) {
    erreur.hidden = true;
    if (fichier && !extensions.some((ext) => fichier.name.toLowerCase().endsWith(ext))) {
      erreur.textContent = `Fichier refusé : format attendu ${depot.dataset.format}.`;
      erreur.hidden = false;
      fichier = null;
    }
    fichiers[nom] = fichier ?? null;
    zone.hidden = Boolean(fichiers[nom]);
    pastille.hidden = !fichiers[nom];
    if (fichiers[nom]) {
      $(".file-pill__nom", pastille).textContent = fichier.name;
      $(".file-pill__taille", pastille).textContent = tailleLisible(fichier.size);
    }
    entree.value = ""; // permet de redéposer le même fichier après l'avoir retiré
    entreesModifiees();
  }

  $("[data-parcourir]", depot).addEventListener("click", () => entree.click());
  entree.addEventListener("change", () => retenir(entree.files[0]));
  $(".file-pill__retirer", pastille).addEventListener("click", () => retenir(null));

  // Glisser-déposer : il faut annuler le comportement par défaut du navigateur
  // (ouvrir le fichier dans l'onglet) pour recevoir le fichier.
  zone.addEventListener("dragover", (evenement) => {
    evenement.preventDefault();
    zone.classList.add("survol");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("survol"));
  zone.addEventListener("drop", (evenement) => {
    evenement.preventDefault();
    zone.classList.remove("survol");
    retenir(evenement.dataTransfer.files[0]);
  });
}

// ---------------------------------------------------------------------------
// Paramètres et état de la page
// ---------------------------------------------------------------------------

const curseurTolerance = $("#tolerance");
const curseurScore = $("#score");
curseurTolerance.value = TOLERANCE_JOURS;
curseurScore.value = SCORE_MINIMUM;

for (const [curseur, sortie] of [[curseurTolerance, $("#tolerance-valeur")], [curseurScore, $("#score-valeur")]]) {
  sortie.textContent = curseur.value;
  curseur.addEventListener("input", () => {
    sortie.textContent = curseur.value;
    entreesModifiees();
  });
}

const resultats = $("#resultats");

/**
 * Un fichier ou un réglage a changé : le résultat affiché ne correspond plus
 * aux entrées, on le retire (il faut relancer). Le bouton n'apparaît qu'une
 * fois les deux fichiers déposés.
 */
function entreesModifiees() {
  resultats.replaceChildren();
  const prets = Boolean(fichiers.releve && fichiers["grand-livre"]);
  $("#attente").hidden = prets;
  $("#lancer").hidden = !prets;
}

// ---------------------------------------------------------------------------
// Rapprochement
// ---------------------------------------------------------------------------

/** Recoupement avec les totaux du relevé : volet, avertissement ou erreur. */
function afficherControles({ statut, tableau: lignes }) {
  if (statut === null) {
    return [alerte("warning",
      "Ce relevé ne comporte pas de totaux de contrôle exploitables :"
      + " l'extraction n'a pas pu être vérifiée automatiquement. Recoupez le"
      + " nombre d'opérations et les totaux avant d'exploiter le résultat.")];
  }
  if (statut) {
    return [element("details", { classe: "card" }, [
      element("summary", { texte: "Extraction vérifiée sur les totaux du relevé" }),
      tableauControles(lignes),
    ])];
  }
  return [
    alerte("error",
      "L'extraction ne correspond pas aux totaux imprimés sur le relevé :"
      + " des opérations ont été mal lues ou omises. Le rapprochement ci-dessous"
      + " n'est pas fiable."),
    tableauControles(lignes),
  ];
}

/** Laisse au navigateur le temps de dessiner (le sablier) avant un calcul long. */
const laisserDessiner = () => new Promise((fin) => requestAnimationFrame(() => setTimeout(fin, 0)));

async function lancer() {
  const bouton = $("#lancer");
  const progression = $("#progression");
  resultats.replaceChildren();
  bouton.disabled = true;
  progression.hidden = false;
  await laisserDessiner();

  const afficher = (...elements) => resultats.append(...elements);
  try {
    // `file.arrayBuffer()` lit le fichier déposé, dans le navigateur — rien n'est envoyé.
    const [octetsReleve, octetsGrandLivre] = await Promise.all([
      fichiers.releve.arrayBuffer(),
      fichiers["grand-livre"].arrayBuffer(),
    ]);
    const releve = await extraireRelevePdf(new Uint8Array(octetsReleve));
    const comptaBrut = chargerGrandLivre(new Uint8Array(octetsGrandLivre));
    const controle = controlerExtraction(releve);

    const banque = nettoyerDonnees(releve.operations);
    const compta = nettoyerDonnees(comptaBrut);

    if (banque.length === 0) {
      afficher(
        alerte("error",
          "Aucune opération exploitable dans le relevé PDF après nettoyage."
          + " Aperçu de l'extraction brute :"),
        tableau([
          { titre: "date", valeur: (o) => o.date, genre: "date" },
          { titre: "libelle", valeur: (o) => o.libelle, genre: "texte" },
          { titre: "montant", valeur: (o) => montant(o.montant), genre: "nombre" },
        ], releve.operations),
      );
      return;
    }
    if (compta.length === 0) {
      afficher(alerte("error", "Aucune écriture exploitable dans le grand livre après nettoyage."));
      return;
    }

    afficher(...afficherControles(controle));

    const alerteSens = controlerSensMontants(banque, compta);
    if (alerteSens) afficher(alerte("warning", alerteSens));

    const resultat = executerRapprochement(
      banque, compta, Number(curseurTolerance.value), Number(curseurScore.value),
    );
    const { rapprochees, manquantsCompta, manquantsBanque } = resultat;

    afficher(
      alerte("success", "Rapprochement effectué avec succès !"),
      element("div", { classe: "metriques" }, [
        metrique("Opérations Rapprochées", rapprochees.length),
        metrique("Manquants en Compta", manquantsCompta.length),
        metrique("Manquants en Banque", manquantsBanque.length),
        metrique("Taux de rapprochement", pourcentage((rapprochees.length / banque.length) * 100)),
      ]),
      onglets([
        { titre: `Rapprochées (${rapprochees.length})`, contenu: tableau(colonnesRapprochees, rapprochees) },
        {
          titre: `Dans la banque, absentes en compta (${manquantsCompta.length})`,
          contenu: tableau(colonnesOperations, manquantsCompta),
        },
        {
          titre: `En compta, absentes de la banque (${manquantsBanque.length})`,
          contenu: tableau(colonnesOperations, manquantsBanque),
        },
      ]),
      element("hr"),
    );

    const octets = enOctets(classeurResultats(resultat, controle));
    const telechargement = element("button", {
      classe: "btn btn--encadre btn--bloc",
      texte: "Télécharger le résultat (Excel)",
      attributs: { type: "button" },
    });
    telechargement.addEventListener("click", () => telecharger(octets, NOM_FICHIER));
    afficher(telechargement);
  } catch (erreur) {
    console.error(erreur);
    afficher(alerte("error", `Une erreur est survenue lors du traitement : ${erreur.message}`));
  } finally {
    bouton.disabled = false;
    progression.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Navigation entre les deux pages et manuel
// ---------------------------------------------------------------------------

let manuelCharge = false;

async function chargerManuel() {
  if (manuelCharge) return;
  const conteneur = $("#manuel");
  try {
    const reponse = await fetch(new URL("../manuel.md", import.meta.url));
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    // Le manuel est un fichier du site (pas une donnée de l'utilisateur) :
    // on peut l'insérer comme HTML.
    conteneur.innerHTML = marked.parse(await reponse.text());
    manuelCharge = true;
  } catch {
    conteneur.replaceChildren(alerte("error",
      "Le manuel de procédure est introuvable. Vérifiez que le fichier"
      + " manuel.md est bien livré avec le site."));
  }
}

/** Affiche la page désignée par l'adresse (#rapprochement ou #manuel). */
function afficherPage() {
  const page = location.hash === "#manuel" ? "manuel" : "rapprochement";
  $("#page-rapprochement").hidden = page !== "rapprochement";
  $("#page-manuel").hidden = page !== "manuel";
  $("#parametres").hidden = page !== "rapprochement";
  $("#aide-manuel").hidden = page !== "manuel";
  for (const lien of document.querySelectorAll(".nav a")) {
    if (lien.dataset.page === page) lien.setAttribute("aria-current", "page");
    else lien.removeAttribute("aria-current");
  }
  document.title = page === "manuel" ? "Manuel de procédure — Rapprochement bancaire" : "Rapprochement bancaire";
  window.scrollTo(0, 0); // chaque page s'ouvre en haut, pas à la position de la précédente
  if (page === "manuel") chargerManuel();
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

document.querySelectorAll(".depot").forEach(preparerDepot);
$("#lancer").addEventListener("click", lancer);
window.addEventListener("hashchange", afficherPage); // boutons Précédent / Suivant compris
afficherPage();
entreesModifiees();
