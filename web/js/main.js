// Étape 0 — vérifie que les bibliothèques de vendor/ se chargent et fonctionnent,
// sans aucun fichier réel : le PDF et le classeur de test sont fabriqués en mémoire.
// Ce fichier sera remplacé par l'interface à l'étape 7.

// `import * as X from "…"` ≈ `import X` en Python : tout le module sous un nom.
// `import { a } from "…"` ≈ `from module import a`.
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import * as XLSX from "../vendor/sheetjs/xlsx.mjs";
import { marked } from "../vendor/marked/marked.esm.js";

// `import.meta.url` est l'adresse de ce fichier — l'équivalent de `__file__`.
// On construit les chemins à partir de lui, comme `Path(__file__).parent / …`.
const ici = (chemin) => new URL(chemin, import.meta.url).href;

// PDF.js fait son travail dans un « worker » (fil d'exécution séparé) pour ne pas
// figer la page : on lui indique où trouver son code, en local.
pdfjsLib.GlobalWorkerOptions.workerSrc = ici("../vendor/pdfjs/pdf.worker.min.mjs");

const liste = document.querySelector("#verifications");

function afficher(nom, reussi, detail) {
  const li = document.createElement("li");
  li.className = reussi ? "ok" : "echec";
  li.textContent = `${nom} — ${detail}`; // `${…}` ≈ f-string Python
  liste.append(li);
  console.log(`[étape 0] ${reussi ? "OK" : "ÉCHEC"} ${nom} : ${detail}`);
}

// Fabrique un PDF minimal d'une page contenant « Bonjour 200 000 ».
function pdfMinimal() {
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]"
      + " /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const flux = "BT /F1 12 Tf 72 770 Td (Bonjour 200 000) Tj ET";
  objets.push(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`);

  let texte = "%PDF-1.4\n";
  const positions = [];
  objets.forEach((contenu, i) => {
    positions.push(texte.length);
    texte += `${i + 1} 0 obj\n${contenu}\nendobj\n`;
  });
  const debutXref = texte.length;
  texte += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const p of positions) texte += `${String(p).padStart(10, "0")} 00000 n \n`;
  texte += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\n`;
  texte += `startxref\n${debutXref}\n%%EOF\n`;
  return new TextEncoder().encode(texte); // texte → octets (≈ str.encode())
}

// `async` : la fonction peut attendre (`await`) des opérations lentes sans bloquer
// la page. Chaque `await` ≈ « attends le résultat de cette promesse ».
async function verifierPdfjs() {
  const pdf = await pdfjsLib.getDocument({
    data: pdfMinimal(),
    cMapUrl: ici("../vendor/pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: ici("../vendor/pdfjs/standard_fonts/"),
  }).promise;
  const page = await pdf.getPage(1);
  const contenu = await page.getTextContent();
  const texte = contenu.items.map((item) => item.str).join("");
  const attendu = "Bonjour 200 000";
  afficher(
    `PDF.js ${pdfjsLib.version}`,
    texte === attendu,
    `texte lu : « ${texte} » (attendu « ${attendu} »)`,
  );
}

function verifierSheetjs() {
  // Écrit un classeur en mémoire puis le relit : aller-retour complet.
  const feuille = XLSX.utils.aoa_to_sheet([["Date", "Montant"], ["2026-01-30", 1234.56]]);
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, "Test");
  const octets = XLSX.write(classeur, { type: "array", bookType: "xlsx" });

  const relu = XLSX.read(octets, { type: "array" });
  const lignes = XLSX.utils.sheet_to_json(relu.Sheets.Test, { header: 1 });
  const montant = lignes[1][1];
  afficher(
    `SheetJS ${XLSX.version}`,
    montant === 1234.56,
    `aller-retour .xlsx de ${octets.byteLength} octets, montant relu : ${montant}`,
  );
}

function verifierMarked() {
  const html = marked.parse("# Manuel\n\n> À retenir");
  const reussi = html.includes("<h1>Manuel</h1>") && html.includes("<blockquote>");
  afficher("marked", reussi, `rendu : ${html.replace(/\s+/g, " ").trim()}`);
}

async function verifierPolices() {
  const familles = ['500 28px "Fraunces"', '16px "IBM Plex Sans"', '16px "IBM Plex Mono"'];
  // `Promise.all` attend plusieurs promesses en parallèle (≈ asyncio.gather).
  await Promise.all(familles.map((f) => document.fonts.load(f)));
  const manquantes = familles.filter((f) => !document.fonts.check(f));
  afficher(
    "Polices locales",
    manquantes.length === 0,
    manquantes.length === 0 ? "Fraunces, IBM Plex Sans et Mono chargées" : `absentes : ${manquantes.join(", ")}`,
  );
}

// Chaque vérification est isolée : l'échec de l'une n'empêche pas les autres.
// try/catch ≈ try/except ; `erreur.message` ≈ str(e).
for (const [nom, verification] of [
  ["PDF.js", verifierPdfjs],
  ["SheetJS", verifierSheetjs],
  ["marked", verifierMarked],
  ["Polices", verifierPolices],
]) {
  try {
    await verification();
  } catch (erreur) {
    afficher(nom, false, `erreur : ${erreur.message}`);
  }
}
