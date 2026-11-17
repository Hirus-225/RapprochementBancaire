// Interface du site.
//
// La page est construite une fois (index.html), puis des fonctions sont
// attachées aux événements : dépôt d'un fichier, curseur, bouton, onglet,
// navigation. La logique métier vit dans les autres modules ; ce fichier ne
// fait que l'enchaîner et en afficher le résultat.
//
// Sécurité : tout texte venant des fichiers de l'utilisateur (libellés…) est
// inséré avec `textContent`, jamais comme du HTML — un libellé piégé ne peut
// donc pas devenir du code. Seul le manuel, fichier du site, est rendu en HTML.
// La politique de sécurité interdit aussi l'attribut `style` : les largeurs
// calculées (barre de répartition, barre de score) passent par
// `element.style.…`, que la politique autorise.

import { marked } from "../vendor/marked/marked.esm.js";
import { arrondiPair, ecartJours } from "./outils.js";
import { chargerGrandLivre } from "./grand-livre.js";
import { controlerExtraction, extraireRelevePdf } from "./releve.js";
import {
  SCORE_MINIMUM, TOLERANCE_JOURS, TYPE_CHEQUE, TYPE_PARFAIT, TYPE_PARTIEL,
  controlerSensMontants, executerRapprochement, nettoyerDonnees,
} from "./rapprochement.js";
import { NOM_FICHIER, classeurResultats, enOctets, telecharger } from "./export.js";

// `$` : raccourci pour querySelector (≈ trouver un élément de la page par sélecteur CSS).
// `$$` : la même chose pour tous les éléments correspondants, rendus sous forme de liste.
const $ = (selecteur, racine = document) => racine.querySelector(selecteur);
const $$ = (selecteur, racine = document) => [...racine.querySelectorAll(selecteur)];

// ---------------------------------------------------------------------------
// Petits constructeurs d'éléments et mises en forme
// ---------------------------------------------------------------------------

/**
 * Crée un élément ; `texte` est inséré comme texte brut (jamais interprété).
 * Les `enfants` peuvent être des éléments ou des chaînes (insérées comme texte).
 */
function element(balise, { classe, texte, attributs = {} } = {}, enfants = []) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined) e.textContent = texte;
  for (const [nom, valeur] of Object.entries(attributs)) e.setAttribute(nom, valeur);
  e.append(...enfants);
  return e;
}

/** Message d'avertissement (fond ambre pâle) ou d'erreur (fond rouge pâle). */
const alerte = (genre, texte) =>
  element("p", { classe: `alerte alerte--${genre}`, texte, attributs: { role: "alert" } });

/** Coche verte du contrôle d'extraction réussi (dessin SVG). */
function coche() {
  const espace = "http://www.w3.org/2000/svg"; // un SVG se crée dans son propre « espace de noms »
  const dessin = document.createElementNS(espace, "svg");
  const attributs = {
    width: "20", height: "20", viewBox: "0 0 20 20", fill: "none", stroke: "currentColor",
    "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true",
  };
  for (const [nom, valeur] of Object.entries(attributs)) dessin.setAttribute(nom, valeur);
  const trait = document.createElementNS(espace, "path");
  trait.setAttribute("d", "m4 10.5 4 4 8-9");
  dessin.append(trait);
  return dessin;
}

const formatNombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
/** Montant en centimes → « −400 000 » ou « 1 234,56 ». */
const montant = (centimes) => (centimes == null ? "" : formatNombre.format(centimes / 100));

/** Date « AAAA-MM-JJ » → « JJ/MM/AAAA », pour l'affichage seulement (le classeur garde AAAA-MM-JJ). */
const dateLisible = (date) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date ?? "")
    ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
    : (date ?? "");

/** « 1 opération », « 3 opérations » (et « 0 opération », comme en français). */
const compter = (nombre, singulier, pluriel) => `${nombre} ${nombre > 1 ? pluriel : singulier}`;

/** Pourcentage écrit comme `f"{x:.1f}"` en Python (demi arrondi au pair), avec la virgule française. */
const pourcentage = (x) => (arrondiPair(x * 10) / 10).toFixed(1).replace(".", ",");

/** Défilement doux, sauf si l'utilisateur a demandé à réduire les animations. */
const defilement = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

/**
 * Les trois types de rapprochement. `valeur` est le texte réel de `typeMatch`
 * (celui du classeur Excel) ; `nom` est la forme courte affichée à l'écran.
 */
const TYPES = [
  { cle: "parfait", valeur: TYPE_PARFAIT, nom: "Parfait", puce: "puce--marine" },
  { cle: "cheque", valeur: TYPE_CHEQUE, nom: "N° de chèque", puce: "puce--ciel" },
  { cle: "partiel", valeur: TYPE_PARTIEL, nom: "Partiel", puce: "puce--ambre" },
];
const typeDe = (typeMatch) => TYPES.find((type) => type.valeur === typeMatch);

// ---------------------------------------------------------------------------
// Tableaux simples (contrôles, aperçu de l'extraction brute)
// ---------------------------------------------------------------------------

/**
 * Tableau de données. `colonnes` : [{ titre, valeur(ligne), genre }] ; genre
 * « nombre » aligne à droite, « texte » (libellés) peut passer à la ligne ; les
 * autres colonnes restent sur une ligne.
 */
function tableau(colonnes, lignes) {
  const entete = element("tr", {}, colonnes.map((c) =>
    element("th", { texte: c.titre, classe: c.genre === "nombre" ? "nombre" : "", attributs: { scope: "col" } })));
  const corps = lignes.map((ligne) => element("tr", {}, colonnes.map((c) => {
    const valeur = c.valeur(ligne);
    return element("td", { classe: c.genre ?? "", texte: valeur == null ? "" : String(valeur) });
  })));
  return element("div", { classe: "table-wrap", attributs: { tabindex: "0" } }, [
    element("table", { classe: "data" }, [element("thead", {}, [entete]), element("tbody", {}, corps)]),
  ]);
}

/** Tableau des contrôles : nombres d'opérations en unités, montants en centimes. */
function tableauControles(lignes) {
  const valeur = (ligne, v) => (ligne.controle.startsWith("Nombre") ? formatNombre.format(v) : montant(v));
  return tableau([
    { titre: "Contrôle", valeur: (l) => l.controle, genre: "texte" },
    { titre: "Extrait", valeur: (l) => valeur(l, l.extrait), genre: "nombre" },
    { titre: "Annoncé par le relevé", valeur: (l) => valeur(l, l.annonce), genre: "nombre" },
    { titre: "Écart", valeur: (l) => valeur(l, l.ecart), genre: "nombre" },
  ], lignes);
}

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
  const zone = $(".depot__zone", depot);
  const fiche = $(".fichier", depot);
  const etat = $(".depot__etat", depot);
  const retirer = $("[data-retirer]", depot);
  const erreur = $(".depot__erreur", depot);

  function retenir(fichier) {
    erreur.hidden = true;
    if (fichier && !extensions.some((ext) => fichier.name.toLowerCase().endsWith(ext))) {
      erreur.textContent = `Fichier refusé : format attendu ${depot.dataset.format}.`;
      erreur.hidden = false;
      fichier = null;
    }
    fichiers[nom] = fichier ?? null;
    const pret = Boolean(fichiers[nom]);
    zone.hidden = pret;
    fiche.hidden = !pret;
    etat.textContent = pret ? "Prêt" : "En attente";
    etat.classList.toggle("puce--marine", pret); // ajoute la classe si prêt, la retire sinon
    if (pret) {
      $(".fichier__nom", fiche).textContent = fichier.name;
      $(".fichier__taille", fiche).textContent = tailleLisible(fichier.size);
    }
    entree.value = ""; // permet de redéposer le même fichier après l'avoir retiré
    entreesModifiees();
  }

  // Après un choix, le champ disparaît avec la zone : le focus passe à « Retirer »,
  // et revient au champ quand on retire le fichier (utile au clavier).
  entree.addEventListener("change", () => {
    retenir(entree.files[0]);
    if (fichiers[nom]) retirer.focus();
  });
  retirer.addEventListener("click", () => {
    retenir(null);
    entree.focus();
  });

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
// Réglages et état du lancement
// ---------------------------------------------------------------------------

const curseurTolerance = $("#tolerance");
const curseurScore = $("#score");
curseurTolerance.value = TOLERANCE_JOURS;
curseurScore.value = SCORE_MINIMUM;

for (const [curseur, sortie, ecrire] of [
  [curseurTolerance, $("#tolerance-valeur"), (v) => compter(Number(v), "jour", "jours")],
  [curseurScore, $("#score-valeur"), (v) => `${v} %`],
]) {
  sortie.textContent = ecrire(curseur.value);
  curseur.addEventListener("input", () => {
    sortie.textContent = ecrire(curseur.value);
    entreesModifiees();
  });
}

let calculEnCours = false;
let resultatAffiche = false;
let octetsResultat = null; // le classeur Excel du dernier calcul, prêt à télécharger

/** Message d'état, bouton et phrase d'aide de la colonne « lancement ». */
function majLancement() {
  const releve = Boolean(fichiers.releve);
  const grandLivre = Boolean(fichiers["grand-livre"]);
  const prets = releve && grandLivre;
  $("#lancer").disabled = !prets || calculEnCours;

  let etat;
  let aide;
  if (resultatAffiche) {
    etat = "Rapprochement effectué.";
    aide = "Modifiez un fichier ou un réglage pour le relancer.";
  } else if (prets) {
    etat = "Les deux fichiers sont prêts.";
    aide = "Le calcul se fait dans ce navigateur, en quelques secondes.";
  } else {
    if (!releve && !grandLivre) etat = "Déposez le relevé et le grand livre.";
    else if (!releve) etat = "Il manque le relevé bancaire.";
    else etat = "Il manque le grand livre.";
    aide = "Le bouton s'active dès que les deux fichiers sont déposés.";
  }
  $("#lancement-etat").textContent = etat;
  $("#lancement-aide").textContent = aide;
}

/** Retire le résultat affiché et cache la section « Résultat ». */
function effacerResultat() {
  resultatAffiche = false;
  octetsResultat = null;
  $("#resultat").hidden = true;
  $("#messages").replaceChildren();
  $("#detail").hidden = true;
  $("#telecharger").hidden = true;
}

/**
 * Un fichier ou un réglage a changé : le résultat affiché ne correspond plus
 * aux entrées, on le retire (il faut relancer).
 */
function entreesModifiees() {
  effacerResultat();
  majLancement();
}

// ---------------------------------------------------------------------------
// Résultat : contrôle d'extraction et synthèse
// ---------------------------------------------------------------------------

/** Recoupement avec les totaux du relevé : volet, avertissement ou erreur. */
function afficherControles({ statut, tableau: lignes }) {
  if (statut === null) {
    return [alerte("avertissement",
      "Ce relevé ne comporte pas de totaux de contrôle exploitables :"
      + " l'extraction n'a pas pu être vérifiée automatiquement. Recoupez le"
      + " nombre d'opérations et les totaux avant d'exploiter le résultat.")];
  }
  if (statut) {
    // Le nombre de contrôles dépend du relevé (3 ou 5) : on le lit dans le tableau.
    const phrase = lignes.length === 1
      ? " Le contrôle sur les totaux du relevé est à écart nul."
      : ` Les ${lignes.length} contrôles sur les totaux du relevé sont à écart nul.`;
    const voir = element("span", { classe: "go", texte: "Voir les contrôles" });
    const volet = element("details", { classe: "verif" }, [
      element("summary", {}, [
        coche(),
        element("span", {}, [element("strong", { texte: "Extraction vérifiée." }), phrase]),
        voir,
      ]),
      element("div", { classe: "verif__corps" }, [tableauControles(lignes)]),
    ]);
    // « toggle » : le volet vient d'être ouvert ou fermé.
    volet.addEventListener("toggle", () => {
      voir.textContent = volet.open ? "Masquer les contrôles" : "Voir les contrôles";
    });
    return [volet];
  }
  return [
    alerte("erreur",
      "L'extraction ne correspond pas aux totaux imprimés sur le relevé :"
      + " des opérations ont été mal lues ou omises. Le rapprochement ci-dessous"
      + " n'est pas fiable."),
    tableauControles(lignes),
  ];
}

/** Somme des montants d'une liste d'opérations, en centimes entiers (donc exacte). */
const solde = (operations) => operations.reduce((total, o) => total + (o.montant ?? 0), 0);

/** Les trois blocs : taux et répartition, puis les deux listes d'écarts. */
function afficherSynthese({ rapprochees, manquantsCompta, manquantsBanque }, nombreBanque) {
  $("#taux").replaceChildren(
    pourcentage((rapprochees.length / nombreBanque) * 100),
    element("small", { texte: "%" }),
  );

  // Barre de répartition : un segment par type, plus les opérations non rapprochées.
  const parts = [
    ...TYPES.map((type) => ({
      classe: `t-${type.cle}`,
      nom: type.nom,
      nombre: rapprochees.filter((r) => r.typeMatch === type.valeur).length,
    })),
    { classe: "t-reste", nom: "Non rapprochées", nombre: manquantsCompta.length },
  ];
  const segments = parts.filter((p) => p.nombre > 0).map((p) => {
    const segment = element("span", { classe: p.classe });
    segment.style.flexGrow = String(p.nombre); // largeur proportionnelle au nombre (CSSOM, permis par la CSP)
    return segment;
  });
  const repartition = $("#repartition");
  repartition.replaceChildren(...segments);
  repartition.setAttribute("aria-label", parts.map((p) => `${p.nom} : ${p.nombre}`).join(", "));
  $("#legende").replaceChildren(...parts.map((p) =>
    element("span", {}, [element("i", { classe: p.classe }), p.nom, element("b", { texte: String(p.nombre) })])));

  for (const [idNombre, idSolde, lignes, singulier, pluriel] of [
    ["#nombre-compta", "#solde-compta", manquantsCompta, "opération", "opérations"],
    ["#nombre-banque", "#solde-banque", manquantsBanque, "écriture", "écritures"],
  ]) {
    $(idNombre).replaceChildren(
      String(lignes.length),
      element("span", { texte: lignes.length > 1 ? pluriel : singulier }),
    );
    $(idSolde).replaceChildren("Solde net : ", element("b", { texte: `${montant(solde(lignes))} F CFA` }), ".");
  }
}

// ---------------------------------------------------------------------------
// Résultat : onglets, filtre et tableau détaillé
// ---------------------------------------------------------------------------

// Lignes de chaque onglet, remplies après un calcul.
const donnees = { rapprochees: [], compta: [], banque: [] };
let ongletActif = "rapprochees";
let typeFiltre = "tous";

const boutonsOnglets = $$("#onglets [role=tab]");
const champFiltre = $("#filtre");
const puces = $("#puces");

/** Active un onglet : bouton marine, panneau relié, filtre remis à zéro. */
function choisirOnglet(cle) {
  ongletActif = cle;
  typeFiltre = "tous";
  champFiltre.value = "";
  for (const bouton of boutonsOnglets) {
    const actif = bouton.dataset.onglet === cle;
    bouton.setAttribute("aria-selected", String(actif));
    bouton.tabIndex = actif ? 0 : -1; // seul l'onglet actif reçoit la tabulation
    if (actif) $("#panneau").setAttribute("aria-labelledby", bouton.id);
  }
  dessinerTableau();
}

// Flèches gauche/droite (et Début/Fin) pour passer d'un onglet à l'autre.
boutonsOnglets.forEach((bouton, i) => {
  bouton.addEventListener("click", () => choisirOnglet(bouton.dataset.onglet));
  bouton.addEventListener("keydown", (evenement) => {
    const dernier = boutonsOnglets.length - 1;
    const cible = {
      ArrowRight: i === dernier ? 0 : i + 1,
      ArrowLeft: i === 0 ? dernier : i - 1,
      Home: 0,
      End: dernier,
    }[evenement.key];
    if (cible === undefined) return;
    evenement.preventDefault();
    choisirOnglet(boutonsOnglets[cible].dataset.onglet);
    boutonsOnglets[cible].focus();
  });
});

// Puces de type : « Tous », puis un bouton par type de rapprochement.
for (const [cle, nom] of [["tous", "Tous"], ...TYPES.map((type) => [type.cle, type.nom])]) {
  const bouton = element("button", { classe: "puce", texte: nom, attributs: { type: "button", "data-type": cle } });
  bouton.addEventListener("click", () => {
    typeFiltre = cle;
    dessinerTableau();
  });
  puces.append(bouton);
}
champFiltre.addEventListener("input", dessinerTableau);

/** Texte en minuscules, sans aucune espace (« 1 850 000 » → « 1850000 »). */
const sansEspaces = (texte) => String(texte ?? "").toLowerCase().replace(/\s/g, "");

/** La ligne contient-elle la recherche, dans un libellé ou dans le montant affiché ? */
function correspond(ligne, recherche) {
  if (!recherche) return true;
  const valeurs = ongletActif === "rapprochees"
    ? [ligne.libelleBanque, ligne.libelleCompta, montant(ligne.montantBanque)]
    : [ligne.libelle, montant(ligne.montant)];
  return valeurs.some((valeur) => sansEspaces(valeur).includes(recherche));
}

/** Cellule de montant, en vert quand il est positif. */
const celluleMontant = (centimes, classe = "") =>
  element("td", { classe: `nombre ${centimes > 0 ? "positif" : ""} ${classe}`.trim(), texte: montant(centimes) });

/** Tableau des rapprochées : colonnes regroupées sous « Banque » et « Comptabilité ». */
function tableauRapprochees(lignes) {
  const th = (texte, classe = "", attributs = {}) =>
    element("th", { texte, classe, attributs: { scope: "col", ...attributs } });
  const entete = element("thead", {}, [
    element("tr", { classe: "groupes" }, [
      th("", "", { colspan: "2" }),
      th("Banque", "filet", { colspan: "3", scope: "colgroup" }),
      th("Comptabilité", "filet", { colspan: "2", scope: "colgroup" }),
      th("", "filet"),
    ]),
    element("tr", {}, [
      th("N°"), th("Type"), th("Date", "filet"), th("Libellé"), th("Montant", "nombre"),
      th("Date", "filet"), th("Libellé"), th("Similarité", "filet"),
    ]),
  ]);

  const corps = element("tbody", {}, lignes.map((r) => {
    const type = typeDe(r.typeMatch);
    const puce = element("span", {
      classe: `puce ${type?.puce ?? ""}`.trim(),
      texte: type?.nom ?? r.typeMatch,
      attributs: { title: r.typeMatch }, // le libellé complet, comme dans le classeur
    });

    // Écart de dates : positif quand la compta a daté l'opération avant la banque.
    const dateCompta = element("td", { classe: "date filet" }, [dateLisible(r.dateCompta)]);
    const ecart = r.dateBanque && r.dateCompta ? ecartJours(r.dateCompta, r.dateBanque) : 0;
    if (ecart) {
      dateCompta.append(element("span", { classe: "ecart", texte: `${Math.abs(ecart)} j ${ecart > 0 ? "avant" : "après"}` }));
    }

    const barre = element("i");
    barre.style.width = `${Math.min(100, Math.max(0, Number(r.score) || 0))}%`; // CSSOM, permis par la CSP

    return element("tr", {}, [
      element("td", { classe: "numero", texte: String(r.idMatch) }),
      element("td", {}, [puce]),
      element("td", { classe: "date filet", texte: dateLisible(r.dateBanque) }),
      element("td", { classe: "texte", texte: r.libelleBanque ?? "" }),
      // Un seul montant : il est égal des deux côtés par construction.
      celluleMontant(r.montantBanque),
      dateCompta,
      element("td", { classe: "texte", texte: r.libelleCompta ?? "" }),
      element("td", { classe: "filet" }, [
        element("span", { classe: "score" }, [
          element("span", { classe: "score__barre", attributs: { "aria-hidden": "true" } }, [barre]),
          String(r.score),
        ]),
      ]),
    ]);
  }));
  return element("table", { classe: "data rapprochees" }, [entete, corps]);
}

/** Tableau des opérations non rapprochées (l'un ou l'autre côté). */
function tableauOperations(lignes) {
  return element("table", { classe: "data" }, [
    element("thead", {}, [element("tr", {}, [
      element("th", { texte: "Date", attributs: { scope: "col" } }),
      element("th", { texte: "Libellé", attributs: { scope: "col" } }),
      element("th", { texte: "Montant", classe: "nombre", attributs: { scope: "col" } }),
    ])]),
    element("tbody", {}, lignes.map((o) => element("tr", {}, [
      element("td", { classe: "date", texte: dateLisible(o.date) }),
      element("td", { classe: "texte", texte: o.libelle ?? "" }),
      celluleMontant(o.montant),
    ]))),
  ]);
}

/** Redessine le tableau de l'onglet actif selon le filtre. N'agit que sur l'affichage. */
function dessinerTableau() {
  const toutes = donnees[ongletActif];
  const rapprochees = ongletActif === "rapprochees";
  puces.hidden = !rapprochees;
  for (const bouton of $$("button", puces)) bouton.setAttribute("aria-pressed", String(bouton.dataset.type === typeFiltre));

  const recherche = sansEspaces(champFiltre.value);
  const lignes = toutes.filter((ligne) => correspond(ligne, recherche)
    && (!rapprochees || typeFiltre === "tous" || typeDe(ligne.typeMatch)?.cle === typeFiltre));

  $("#compte-lignes").textContent = lignes.length === toutes.length
    ? compter(toutes.length, "ligne", "lignes")
    : `${lignes.length} sur ${compter(toutes.length, "ligne", "lignes")}`;

  let contenu;
  if (toutes.length === 0) contenu = element("p", { classe: "vide", texte: "Aucune ligne dans cet onglet." });
  else if (lignes.length === 0) contenu = element("p", { classe: "vide", texte: "Aucune ligne ne correspond à ce filtre." });
  else contenu = rapprochees ? tableauRapprochees(lignes) : tableauOperations(lignes);
  $("#tableau").replaceChildren(contenu);
}

// Les liens « Voir ces opérations / écritures » ouvrent l'onglet correspondant.
for (const lien of $$("[data-aller]")) {
  lien.addEventListener("click", () => {
    choisirOnglet(lien.dataset.aller);
    $("#onglets").scrollIntoView({ behavior: defilement(), block: "start" });
    $(`#onglet-${lien.dataset.aller}`).focus({ preventScroll: true });
  });
}

$("#telecharger").addEventListener("click", () => {
  if (octetsResultat) telecharger(octetsResultat, NOM_FICHIER);
});

// ---------------------------------------------------------------------------
// Rapprochement
// ---------------------------------------------------------------------------

/** Laisse au navigateur le temps de dessiner (le sablier) avant un calcul long. */
const laisserDessiner = () => new Promise((fin) => requestAnimationFrame(() => setTimeout(fin, 0)));

async function lancer() {
  effacerResultat();
  calculEnCours = true;
  majLancement();
  $("#progression").hidden = false;
  await laisserDessiner();

  const afficher = (...elements) => $("#messages").append(...elements);
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
        alerte("erreur",
          "Aucune opération exploitable dans le relevé PDF après nettoyage."
          + " Aperçu de l'extraction brute :"),
        tableau([
          { titre: "date", valeur: (o) => o.date, genre: "date" },
          { titre: "libelle", valeur: (o) => o.libelle, genre: "texte" },
          { titre: "montant", valeur: (o) => montant(o.montant), genre: "nombre" },
        ], releve.operations),
      );
      return; // le bloc `finally` ci-dessous s'exécute quand même
    }
    if (compta.length === 0) {
      afficher(alerte("erreur", "Aucune écriture exploitable dans le grand livre après nettoyage."));
      return;
    }

    afficher(...afficherControles(controle));

    const alerteSens = controlerSensMontants(banque, compta);
    if (alerteSens) afficher(alerte("avertissement", alerteSens));

    const resultat = executerRapprochement(
      banque, compta, Number(curseurTolerance.value), Number(curseurScore.value),
    );
    octetsResultat = enOctets(classeurResultats(resultat, controle));

    afficherSynthese(resultat, banque.length);
    donnees.rapprochees = resultat.rapprochees;
    donnees.compta = resultat.manquantsCompta;
    donnees.banque = resultat.manquantsBanque;
    for (const bouton of boutonsOnglets) $("b", bouton).textContent = String(donnees[bouton.dataset.onglet].length);
    choisirOnglet("rapprochees");

    $("#detail").hidden = false;
    $("#telecharger").hidden = false;
    resultatAffiche = true;
  } catch (erreur) {
    console.error(erreur);
    afficher(alerte("erreur", `Une erreur est survenue lors du traitement : ${erreur.message}`));
  } finally {
    calculEnCours = false;
    $("#progression").hidden = true;
    $("#resultat").hidden = false;
    majLancement();
    $("#resultat").scrollIntoView({ behavior: defilement(), block: "start" });
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
    conteneur.replaceChildren(alerte("erreur",
      "Le manuel de procédure est introuvable. Vérifiez que le fichier"
      + " manuel.md est bien livré avec le site."));
  }
}

/** Affiche la page désignée par l'adresse (#rapprochement ou #manuel). */
function afficherPage() {
  const page = location.hash === "#manuel" ? "manuel" : "rapprochement";
  document.body.dataset.page = page; // <body data-page="…"> : le CSS réduit le bandeau sur le manuel
  $("#page-rapprochement").hidden = page !== "rapprochement";
  $("#page-manuel").hidden = page !== "manuel";
  $("#titre-rapprochement").hidden = page !== "rapprochement";
  $("#titre-manuel").hidden = page !== "manuel";
  $("#accroche").hidden = page !== "rapprochement";
  for (const lien of $$(".navigation a[data-page]")) {
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

$$(".depot").forEach(preparerDepot);
$("#lancer").addEventListener("click", lancer);
window.addEventListener("hashchange", afficherPage); // boutons Précédent / Suivant compris
afficherPage();
entreesModifiees();
