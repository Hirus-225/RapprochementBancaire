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

const DOSSIER_REFERENCE = new URL("../../data_sortie/reference/", import.meta.url);

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
      nom: "Unicode : caractères de mot (\\w)",
      description: "Classe MOT contre \\w de Python (lettre, chiffre ou « _ »).",
      cas: () => testsUnicode(unicode, "mot", (c) => MOT_SEUL.test(c)),
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

function afficherEtape(titre, groupes) {
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
      cas = groupe.cas();
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

  const bilan = afficherEtape("Étape 1 — outils et similarité", groupesEtape1(index, jeux, unicode));

  const total = bilan.conformes + bilan.ecarts + bilan.toleres;
  elementBilan.textContent =
    `${nombreFr(total)} vérifications : ${nombreFr(bilan.ecarts)} écart(s), `
    + `${nombreFr(bilan.toleres)} toléré(s).`;
  elementBilan.classList.add(bilan.ecarts ? "echec" : "ok");
  console.log(`[tests] BILAN ${elementBilan.textContent}`);
}

lancer();
