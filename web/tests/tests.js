// Tests de non-régression : la version JavaScript doit reproduire exactement les
// résultats d'app.py, écrits par script_reference_js.py dans data_sortie/reference/.
//
// La page ne contient aucune donnée : elle lit les relevés et les références sur
// le serveur local. En ligne (GitHub Pages), ces fichiers n'existent pas — c'est
// voulu, ils contiennent de vraies données bancaires.
//
// Chaque groupe de tests renvoie une liste de cas { statut, detail } :
//   "conforme" — identique à Python ;
//   "ecart"    — différent : à corriger ;
//   "tolere"   — différent pour une raison connue et documentée.

import * as outils from "../js/outils.js";
import * as similarite from "../js/similarite.js";
import { chargerGrandLivre } from "../js/grand-livre.js";
import { controlerSensMontants, executerRapprochement, nettoyerDonnees } from "../js/rapprochement.js";
import { lirePages, ouvrirPdf } from "../js/pdf-mots.js";
import { extraireParCoordonnees } from "../js/releve-coordonnees.js";
import { controlerExtraction, extraireRelevePdf } from "../js/releve.js";

const RACINE_PROJET = new URL("../../", import.meta.url);
const DOSSIER_REFERENCE = new URL("data_sortie/reference/", RACINE_PROJET);

/** Contenu brut d'un fichier du projet (relevé, grand livre), en octets. */
async function lireFichier(chemin) {
  const reponse = await fetch(new URL(encodeURI(chemin), RACINE_PROJET));
  if (!reponse.ok) throw new Error(`${chemin} : HTTP ${reponse.status}`);
  return new Uint8Array(await reponse.arrayBuffer());
}

async function lireJson(nom) {
  const reponse = await fetch(new URL(nom, DOSSIER_REFERENCE));
  // fetch ne lève pas d'erreur sur un 404 : il faut tester `ok` soi-même.
  if (!reponse.ok) throw new Error(`${nom} : HTTP ${reponse.status}`);
  return reponse.json();
}

/** Cas de test : compare deux valeurs (égalité stricte, `===`). */
function comparer(obtenu, attendu, contexte) {
  return {
    statut: obtenu === attendu ? "conforme" : "ecart",
    detail: { ...contexte, obtenu, attendu }, // `...` recopie les champs (≈ {**contexte})
  };
}

// ---------------------------------------------------------------------------
// Étape 1 — outils.js et similarite.js
// ---------------------------------------------------------------------------

/** Valeur passée à _en_nombre côté Python (NaN n'existe pas en JSON). */
const entreeNombre = (e) => (e.type === "nombre" && e.valeur === "NaN" ? NaN : e.valeur);

// Plages d'écriture que l'outil peut rencontrer : latin, grec, cyrillique,
// accents combinants, ponctuation, symboles monétaires, ligatures. Hors de ces
// plages, les écarts viennent des versions d'Unicode (Python 3.14 : Unicode 16 ;
// rapidfuzz : table plus ancienne ; navigateur : la sienne) et sont tolérés.
const PLAGES_UTILES = [
  [0x0000, 0x052f], [0x1e00, 0x1fff], [0x2000, 0x20cf], [0x2100, 0x214f], [0xfb00, 0xfb06],
];
const dansPlageUtile = (code) => PLAGES_UTILES.some(([debut, fin]) => code >= debut && code <= fin);

function testsUnicode(unicode, nomTable, calculer) {
  const cas = [];
  for (let code = 0; code < 0x10000; code++) {
    if (code >= 0xd800 && code <= 0xdfff) continue; // demi-codets UTF-16
    const caractere = String.fromCharCode(code);
    const attendu = typeof unicode[nomTable] === "string"
      ? unicode[nomTable][code] === "1"
      : unicode[nomTable][code];
    const resultat = comparer(calculer(caractere), attendu, {
      code: `U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
    });
    if (resultat.statut === "ecart" && !dansPlageUtile(code)) resultat.statut = "tolere";
    cas.push(resultat);
  }
  return cas;
}

function groupesEtape1(index, jeux, unicode) {
  const nombres = [...index.nombres_cas_limites, ...jeux.flatMap((j) => j.nombres)];
  const paires = [
    ...index.similarite_cas_limites,
    ...index.similarite_aleatoire,
    ...jeux.flatMap((j) => j.similarite),
  ];
  const libellesCheque = jeux.flatMap((j) => j.numeros_cheque);

  // Dates : chaque colonne est convertie d'un bloc, comme dans nettoyer_donnees.
  const colonnesDates = [
    ...index.dates_cas_limites.map((c) => ({ origine: "cas limites", ...c })),
    ...jeux.map((j) => {
      const garde = new Map(j.releve_nettoye.map((o) => [o.rang_brut, o.date]));
      return {
        origine: `relevé ${j.nom}`,
        entree: j.releve_brut.map((o) => o.date),
        dates: j.releve_brut.map((_, i) => garde.get(i) ?? null), // `??` : valeur par défaut si null/undefined
      };
    }),
  ];

  const ESPACE_SEUL = new RegExp(`^${outils.ESPACE}$`);
  const MOT_SEUL = new RegExp(`^${outils.MOT}$`, "u");
  const CHIFFRE_ISDIGIT_SEUL = new RegExp(`^${outils.CHIFFRE_ISDIGIT}$`, "u");

  return [
    {
      nom: "enCentimes",
      description:
        "Lecture des montants (_en_nombre), en centimes. Au-delà de 90 000 milliards, "
        + "la version JS refuse le montant (null) là où Python le lit en perdant des chiffres.",
      cas: () => nombres.map((n) => {
        const attendu = Number.isSafeInteger(n.centimes) ? n.centimes : null;
        const resultat = comparer(outils.enCentimes(entreeNombre(n.entree)), attendu, {
          entree: n.entree.valeur,
          ...(attendu !== n.centimes && { lu_par_python: n.centimes }),
        });
        if (attendu !== n.centimes && resultat.statut === "conforme") resultat.statut = "tolere";
        return resultat;
      }),
    },
    {
      nom: "convertirDates",
      description: "Conversion des dates en AAAA-MM-JJ, colonne par colonne (pd.to_datetime, dayfirst).",
      cas: () => colonnesDates.flatMap((colonne) => {
        const obtenues = outils.convertirDates(colonne.entree, index.annee_courante);
        return obtenues.map((date, i) => comparer(date, colonne.dates[i], {
          origine: colonne.origine, premiere: colonne.entree[0], entree: colonne.entree[i],
        }));
      }),
    },
    {
      nom: "numeroCheque",
      description: "Numéro de chèque extrait des libellés nettoyés (_numero_cheque).",
      cas: () => libellesCheque.map((c) => comparer(outils.numeroCheque(c.libelle), c.numero, {
        libelle: c.libelle,
      })),
    },
    {
      nom: "ratio",
      description: "fuzz.ratio (thefuzz), arrondi « au pair » comme Python.",
      cas: () => paires.map((p) => comparer(similarite.ratio(p.a, p.b), p.ratio, { a: p.a, b: p.b })),
    },
    {
      nom: "tokenSetRatio",
      description: "fuzz.token_set_ratio (thefuzz), prétraitement compris.",
      cas: () => paires.map((p) => comparer(
        similarite.tokenSetRatio(p.a, p.b), p.token_set_ratio, { a: p.a, b: p.b },
      )),
    },
    {
      nom: "Unicode : normaliser",
      description: "_normaliser, caractère par caractère (65 536 caractères).",
      cas: () => testsUnicode(unicode, "normaliser", outils.normaliser),
    },
    {
      nom: "Unicode : prétraitement thefuzz",
      description: "full_process(force_ascii=True) de thefuzz, caractère par caractère.",
      cas: () => testsUnicode(unicode, "pretraitement", similarite.pretraiter),
    },
    {
      nom: "Unicode : majuscules",
      description: "str.upper() de Python contre toUpperCase().",
      cas: () => testsUnicode(unicode, "majuscules", (c) => c.toUpperCase()),
    },
    {
      nom: "Unicode : espaces (\\s)",
      description: "Classe ESPACE contre str.isspace() de Python.",
      cas: () => testsUnicode(unicode, "espace", (c) => ESPACE_SEUL.test(c)),
    },
    {
      nom: "Unicode : chiffres (isdigit)",
      description: "Classe CHIFFRE_ISDIGIT contre str.isdigit() de Python (repérage de l'en-tête du PDF).",
      cas: () => testsUnicode(unicode, "chiffre", (c) => CHIFFRE_ISDIGIT_SEUL.test(c)),
    },
    {
      nom: "Unicode : caractères de mot (\\w)",
      description: "Classe MOT contre \\w de Python (lettre, chiffre ou « _ »).",
      cas: () => testsUnicode(unicode, "mot", (c) => MOT_SEUL.test(c)),
    },
  ];
}

// ---------------------------------------------------------------------------
// Étape 2 — grand-livre.js et nettoyerDonnees
// ---------------------------------------------------------------------------

/** Date brute écrite comme dans la référence Python (Timestamp.isoformat()). */
function dateBrute(date) {
  if (date === null || typeof date !== "object") return date;
  const d2 = (n) => String(n).padStart(2, "0");
  return `${date.annee}-${d2(date.mois)}-${d2(date.jour)}T${d2(date.heure)}:${d2(date.minute)}:${d2(date.seconde)}`;
}

/** Compare deux listes d'opérations ligne à ligne (un cas par ligne). */
function comparerOperations(obtenues, attendues, contexte) {
  const cas = [];
  const longueur = Math.max(obtenues.length, attendues.length);
  for (let i = 0; i < longueur; i++) {
    const o = obtenues[i];
    const a = attendues[i];
    const enListe = (x) => (x ? JSON.stringify([dateBrute(x.date), x.libelle, x.montant]) : "absente");
    cas.push(comparer(enListe(o), enListe(a), { ...contexte, ligne: i }));
  }
  return cas;
}

/** Charge un grand livre et compare brut, nettoyé ou message d'erreur. */
async function casGrandLivre(chemin, attendu, contexte, anneeCourante) {
  let brut;
  try {
    brut = chargerGrandLivre(await lireFichier(chemin));
  } catch (erreur) {
    return [comparer(erreur.message, attendu.erreur ?? "(pas d'erreur attendue)", contexte)];
  }
  if (attendu.erreur) return [comparer("(aucune erreur)", attendu.erreur, contexte)];
  return [
    ...comparerOperations(brut, attendu.brut, { ...contexte, phase: "brut" }),
    ...comparerOperations(nettoyerDonnees(brut, anneeCourante), attendu.nettoye, {
      ...contexte, phase: "nettoyé",
    }),
  ];
}

function groupesEtape2(index, jeux) {
  const annee = index.annee_courante;
  return [
    {
      nom: "chargerGrandLivre : grands livres réels",
      description: "Lecture SheetJS + typage pandas, puis nettoyage, sur les grands livres des jeux de référence.",
      cas: async () => {
        const cas = [];
        for (const jeu of jeux.filter((j) => j.grand_livre)) {
          cas.push(...await casGrandLivre(
            jeu.grand_livre,
            { brut: jeu.grand_livre_brut, nettoye: jeu.grand_livre_nettoye },
            { jeu: jeu.nom },
            annee,
          ));
        }
        return cas;
      },
    },
    {
      nom: "chargerGrandLivre : classeurs synthétiques",
      description: "Règles de lecture une à une (types mêlés, en-têtes, valeurs manquantes, .xls, erreurs).",
      cas: async () => {
        const cas = [];
        for (const g of index.grands_livres_synthetiques) {
          cas.push(...await casGrandLivre(g.fichier, g, { classeur: g.nom }, annee));
        }
        return cas;
      },
    },
    {
      nom: "nettoyerDonnees : relevés",
      description: "Nettoyage du côté banque, à partir des opérations extraites par Python.",
      cas: async () => jeux.flatMap((jeu) => comparerOperations(
        nettoyerDonnees(jeu.releve_brut, annee),
        jeu.releve_nettoye,
        { jeu: jeu.nom },
      )),
    },
  ];
}

// ---------------------------------------------------------------------------
// Étape 3 — sens des montants et rapprochement
// ---------------------------------------------------------------------------

/** Opérations de la référence sans le champ technique `rang_brut`. */
const sansRang = (operations) => operations.map(({ date, libelle, montant }) => ({ date, libelle, montant }));

/** Compare un rapprochement JS à un résultat Python (un réglage). */
function comparerRapprochement(banque, compta, attendu, contexte) {
  const reglage = `tolérance ${attendu.tolerance_jours} j, score ${attendu.score_minimum}`;
  const obtenu = executerRapprochement(banque, compta, attendu.tolerance_jours, attendu.score_minimum);

  const cas = [];
  const longueur = Math.max(obtenu.rapprochees.length, attendu.rapprochees.length);
  for (let i = 0; i < longueur; i++) {
    const o = obtenu.rapprochees[i];
    const a = attendu.rapprochees[i];
    const jsEnListe = o && JSON.stringify([
      o.idMatch, o.typeMatch, o.dateBanque, o.libelleBanque, o.montantBanque,
      o.dateCompta, o.libelleCompta, o.montantCompta, o.score,
    ]);
    const pyEnListe = a && JSON.stringify([
      a.id_match, a.type_match, a.date_banque, a.libelle_banque, a.montant_banque,
      a.date_compta, a.libelle_compta, a.montant_compta, a.score,
    ]);
    cas.push(comparer(jsEnListe ?? "absente", pyEnListe ?? "absente", { ...contexte, reglage, rapprochement: i + 1 }));
  }
  cas.push(...comparerOperations(obtenu.manquantsCompta, attendu.manquants_compta, {
    ...contexte, reglage, liste: "manquants en compta",
  }));
  cas.push(...comparerOperations(obtenu.manquantsBanque, attendu.manquants_banque, {
    ...contexte, reglage, liste: "manquants en banque",
  }));
  return cas;
}

function groupesEtape3(index, jeux) {
  const jeuxComplets = jeux.filter((j) => j.grand_livre);
  const synthetique = index.rapprochement_synthetique;
  return [
    {
      nom: "executerRapprochement : jeux réels",
      description: "Trois passes sur les données nettoyées par Python, quatre réglages par jeu.",
      cas: () => jeuxComplets.flatMap((jeu) => jeu.rapprochements.flatMap((attendu) => comparerRapprochement(
        sansRang(jeu.releve_nettoye), sansRang(jeu.grand_livre_nettoye), attendu, { jeu: jeu.nom },
      ))),
    },
    {
      nom: "executerRapprochement : grands livres perturbés",
      description: "Dates décalées de ±5 j et libellés retouchés : fait travailler les passes 2 et 3.",
      cas: () => jeuxComplets.flatMap((jeu) => jeu.rapprochements_perturbes.resultats.flatMap((attendu) =>
        comparerRapprochement(
          sansRang(jeu.releve_nettoye), jeu.rapprochements_perturbes.grand_livre, attendu, { jeu: jeu.nom },
        ))),
    },
    {
      nom: "executerRapprochement : cas synthétiques",
      description:
        "Jumeaux, chèques à égale distance, bornes de tolérance et de score, libellé absent "
        + "(lu « nan » par token_set_ratio, comme en Python).",
      cas: () => synthetique.resultats.flatMap((attendu) => comparerRapprochement(
        synthetique.banque, synthetique.compta, attendu, { jeu: "synthétique" },
      )),
    },
    {
      nom: "controlerSensMontants",
      description: "Alerte d'inversion de signe : grand livre dans le bon sens, puis inversé.",
      cas: () => [
        comparer(controlerSensMontants(synthetique.banque, synthetique.compta), synthetique.alerte_sens, {
          jeu: "synthétique",
        }),
        ...jeuxComplets.flatMap((jeu) => {
          const banque = sansRang(jeu.releve_nettoye);
          const compta = sansRang(jeu.grand_livre_nettoye);
          const inverse = compta.map((o) => ({ ...o, montant: -o.montant }));
          return [
            comparer(controlerSensMontants(banque, compta), jeu.alerte_sens, { jeu: jeu.nom, sens: "direct" }),
            comparer(controlerSensMontants(banque, inverse), jeu.alerte_sens_inverse, { jeu: jeu.nom, sens: "inversé" }),
          ];
        }),
      ],
    },
    {
      nom: "Chaîne grand livre → rapprochement",
      description: "Grand livre lu et nettoyé par la version JS, relevé nettoyé par Python, réglage par défaut.",
      cas: async () => {
        const cas = [];
        for (const jeu of jeuxComplets) {
          const compta = nettoyerDonnees(chargerGrandLivre(await lireFichier(jeu.grand_livre)), index.annee_courante);
          cas.push(...comparerRapprochement(
            sansRang(jeu.releve_nettoye), compta, jeu.rapprochements[0], { jeu: jeu.nom },
          ));
        }
        return cas;
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Étape 4 — lecture des PDF et lecteur par coordonnées
// ---------------------------------------------------------------------------

// Écarts de position admis avec pdfplumber.
// - Horizontalement, le calcul est celui de pdfminer : écart constaté ≤ 0,0005 pt
//   (PDF.js stocke certaines matrices en précision simple).
// - Verticalement, PDF.js donne à toutes les polices la même descente
//   (−0,2119 em) quand pdfminer lit celle de chaque police (−0,207 à −0,212 em) :
//   l'écart vaut jusqu'à 0,005 × la taille de police (0,09 pt constaté en corps
//   18). Sans effet sur le regroupement en lignes, dont le seuil est de 3 pt.
const TOLERANCE_X = 0.05;
const TOLERANCE_HAUT = 0.25;

const pagesLues = new Map(); // relevé → pages lues par la version JS (lues une seule fois)
async function pagesDuReleve(chemin) {
  if (!pagesLues.has(chemin)) {
    const pdf = await ouvrirPdf(await lireFichier(chemin));
    pagesLues.set(chemin, await lirePages(pdf));
  }
  return pagesLues.get(chemin);
}

/** Compare les lignes de mots JS à celles de pdfplumber, page par page. */
function comparerMots(pagesJs, pagesPy, jeu) {
  const cas = [comparer(pagesJs.length, pagesPy.length, { jeu, controle: "nombre de pages" })];
  pagesPy.forEach((pagePy, p) => {
    const lignesJs = pagesJs[p]?.lignes ?? [];
    const longueur = Math.max(lignesJs.length, pagePy.lignes.length);
    for (let l = 0; l < longueur; l++) {
      const js = lignesJs[l] ?? [];
      const py = pagePy.lignes[l] ?? [];
      const texteJs = js.map((m) => m.texte).join(" ");
      const textePy = py.map((m) => m.texte).join(" ");
      const contexte = { jeu, page: p + 1, ligne: l + 1 };
      if (texteJs !== textePy) {
        cas.push(comparer(texteJs, textePy, contexte));
        continue;
      }
      // Même texte : on vérifie la position de chaque mot.
      const decalages = py.map((m, i) => Math.max(
        Math.abs(js[i].x0 - m.x0) / TOLERANCE_X,
        Math.abs(js[i].x1 - m.x1) / TOLERANCE_X,
        Math.abs(js[i].top - m.top) / TOLERANCE_HAUT,
        Math.abs(js[i].bottom - m.bottom) / TOLERANCE_HAUT,
      ));
      const pire = decalages.indexOf(Math.max(...decalages));
      const ok = decalages.every((d) => d <= 1);
      cas.push({
        statut: ok ? "conforme" : "ecart",
        detail: {
          ...contexte,
          texte: textePy.slice(0, 60),
          ...(!ok && {
            mot: py[pire].texte,
            js: [js[pire].x0, js[pire].x1, js[pire].top].map((v) => v.toFixed(3)),
            python: [py[pire].x0, py[pire].x1, py[pire].top],
          }),
        },
      });
    }
  });
  return cas;
}

function groupesEtape4(index, jeux) {
  const jeuxCoordonnees = jeux.filter((j) => j.nom !== "sib_tableaux");
  const annee = index.annee_courante;
  return [
    {
      nom: "lirePages : mots et lignes",
      description:
        `Mots reconstitués depuis les instructions de dessin de PDF.js, comparés à pdfplumber `
        + `(texte identique ; position à ${TOLERANCE_X} pt près en largeur, ${TOLERANCE_HAUT} pt en hauteur).`,
      cas: async () => {
        const cas = [];
        for (const jeu of jeux) cas.push(...comparerMots(await pagesDuReleve(jeu.releve), jeu.pages, jeu.nom));
        return cas;
      },
    },
    {
      nom: "extraireParCoordonnees",
      description:
        "Opérations et totaux de contrôle. Sur l'« Extrait de compte » (sib_tableaux), le lecteur "
        + "par coordonnées doit ne rien trouver, comme en Python, pour passer la main au lecteur par tableaux.",
      cas: async () => {
        const cas = [];
        for (const jeu of jeux) {
          const { operations, controles } = extraireParCoordonnees(await pagesDuReleve(jeu.releve));
          if (jeu.nom === "sib_tableaux") {
            cas.push(comparer(operations.length, 0, { jeu: jeu.nom, controle: "aucune opération" }));
            continue;
          }
          cas.push(...comparerOperations(operations, jeu.releve_brut, { jeu: jeu.nom }));
          const trier = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
          cas.push(comparer(trier(controles), trier(jeu.controles), { jeu: jeu.nom, controle: "totaux lus" }));
        }
        return cas;
      },
    },
    {
      nom: "controlerExtraction",
      description: "Recoupement avec les totaux du relevé, sur les opérations et totaux lus par Python.",
      cas: () => jeux.map((jeu) => {
        const { statut, tableau } = controlerExtraction({ operations: jeu.releve_brut, controles: jeu.controles });
        const enListe = (t) => JSON.stringify(t.map((l) => [l.controle, l.extrait, l.annonce, l.ecart]));
        return comparer(
          JSON.stringify([statut, enListe(tableau)]),
          JSON.stringify([jeu.controle_extraction.statut, enListe(jeu.controle_extraction.tableau)]),
          { jeu: jeu.nom },
        );
      }),
    },
    {
      nom: "Chaîne relevé → rapprochement",
      description:
        "extraireRelevePdf puis controlerExtraction, nettoyage et rapprochement, le grand livre "
        + "étant lu lui aussi par la version JS (réglage par défaut).",
      cas: async () => {
        const cas = [];
        for (const jeu of jeuxCoordonnees) {
          const releve = await extraireRelevePdf(await lireFichier(jeu.releve));
          const { statut } = controlerExtraction(releve);
          cas.push(comparer(statut, jeu.controle_extraction.statut, { jeu: jeu.nom, controle: "statut" }));
          cas.push(...comparerOperations(nettoyerDonnees(releve.operations, annee), sansRang(jeu.releve_nettoye), {
            jeu: jeu.nom, phase: "relevé nettoyé",
          }));
          if (!jeu.grand_livre) continue;
          const compta = nettoyerDonnees(chargerGrandLivre(await lireFichier(jeu.grand_livre)), annee);
          cas.push(...comparerRapprochement(
            nettoyerDonnees(releve.operations, annee), compta, jeu.rapprochements[0], { jeu: jeu.nom },
          ));
        }
        return cas;
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

/** Crée un élément HTML : `element("td", "texte", "classe")`. */
function element(balise, texte = "", classe = "") {
  const e = document.createElement(balise);
  if (texte) e.textContent = texte; // textContent n'interprète jamais de HTML : sûr
  if (classe) e.className = classe;
  return e;
}

const nombreFr = (n) => n.toLocaleString("fr-FR");

async function afficherEtape(titre, groupes) {
  const conteneur = document.querySelector("#groupes");
  conteneur.append(element("h2", titre, "etape"));

  const table = element("table", "", "groupes");
  const entete = table.createTHead().insertRow();
  for (const t of ["Groupe", "Conformes", "Écarts", "Tolérés"]) entete.append(element("th", t));
  const corps = table.createTBody();
  conteneur.append(table);

  const bilan = { conformes: 0, ecarts: 0, toleres: 0 };
  for (const groupe of groupes) {
    const debut = performance.now();
    let cas;
    try {
      cas = await groupe.cas(); // `await` sur une valeur ordinaire la renvoie telle quelle
    } catch (erreur) {
      cas = [{ statut: "ecart", detail: { erreur: erreur.message, pile: erreur.stack } }];
    }
    const duree = performance.now() - debut;
    const compte = (statut) => cas.filter((c) => c.statut === statut).length;
    const [conformes, ecarts, toleres] = [compte("conforme"), compte("ecart"), compte("tolere")];
    bilan.conformes += conformes;
    bilan.ecarts += ecarts;
    bilan.toleres += toleres;

    const ligne = corps.insertRow();
    const cellule = element("td");
    cellule.append(element("div", groupe.nom, ecarts ? "statut-echec" : "statut-ok"));
    cellule.append(element("div", `${groupe.description} (${Math.round(duree)} ms)`, "description"));
    for (const [statut, titre] of [["ecart", "écarts"], ["tolere", "tolérés"]]) {
      const exemples = cas.filter((c) => c.statut === statut).slice(0, 25);
      if (exemples.length === 0) continue;
      const details = element("details");
      details.append(element("summary", `Voir les premiers ${titre}`));
      details.append(element("pre", exemples.map((c) => JSON.stringify(c.detail)).join("\n")));
      cellule.append(details);
    }
    ligne.append(cellule);
    ligne.append(element("td", nombreFr(conformes), "nombre"));
    ligne.append(element("td", nombreFr(ecarts), `nombre ${ecarts ? "statut-echec" : ""}`));
    ligne.append(element("td", nombreFr(toleres), "nombre"));
    console.log(`[tests] ${titre} | ${groupe.nom} : ${conformes} conformes, ${ecarts} écarts, ${toleres} tolérés`);
  }
  return bilan;
}

async function lancer() {
  const elementBilan = document.querySelector("#bilan");
  let index, jeux, unicode;
  try {
    index = await lireJson("index.json");
    // Promise.all lit les fichiers en parallèle (≈ asyncio.gather).
    [jeux, unicode] = await Promise.all([
      Promise.all(index.jeux.map((j) => lireJson(j.fichier))),
      lireJson(index.fichier_unicode),
    ]);
  } catch (erreur) {
    elementBilan.textContent =
      `Résultats de référence introuvables (${erreur.message}). Lancez `
      + "« python script_reference_js.py », puis servez le projet depuis sa racine.";
    elementBilan.classList.add("echec");
    return;
  }

  const bilan = { conformes: 0, ecarts: 0, toleres: 0 };
  for (const [titre, groupes] of [
    ["Étape 1 — outils et similarité", groupesEtape1(index, jeux, unicode)],
    ["Étape 2 — grand livre et nettoyage", groupesEtape2(index, jeux)],
    ["Étape 3 — sens des montants et rapprochement", groupesEtape3(index, jeux)],
    ["Étape 4 — lecture des PDF et lecteur par coordonnées", groupesEtape4(index, jeux)],
  ]) {
    const resultat = await afficherEtape(titre, groupes);
    for (const cle of Object.keys(bilan)) bilan[cle] += resultat[cle];
  }

  const total = bilan.conformes + bilan.ecarts + bilan.toleres;
  elementBilan.textContent =
    `${nombreFr(total)} vérifications : ${nombreFr(bilan.ecarts)} écart(s), `
    + `${nombreFr(bilan.toleres)} toléré(s).`;
  elementBilan.classList.add(bilan.ecarts ? "echec" : "ok");
  console.log(`[tests] BILAN ${elementBilan.textContent}`);
}

lancer();
