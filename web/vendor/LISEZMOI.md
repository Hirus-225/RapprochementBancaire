# Bibliothèques tierces (copiées en local)

Le site n'appelle aucun CDN : tout ce qui est chargé par la page vient de ce dossier.
Chaque bibliothèque est figée à une version précise ; pour en changer, remplacer les
fichiers ci-dessous **et** mettre à jour ce tableau.

| Dossier | Bibliothèque | Version | Provenance | Fichiers retenus |
|---|---|---|---|---|
| `pdfjs/` | PDF.js (Mozilla) — lecture des PDF | 6.4.299 | paquet npm `pdfjs-dist` | `build/pdf.min.mjs`, `build/pdf.worker.min.mjs`, `cmaps/`, `standard_fonts/`, `LICENSE` (Apache-2.0) |
| `sheetjs/` | SheetJS Community Edition — lecture et écriture Excel | 0.20.3 | `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` | `xlsx.mjs`, `LICENSE` (Apache-2.0) |
| `marked/` | marked — rendu du manuel Markdown | 18.1.2 | paquet npm `marked` | `lib/marked.esm.js`, `LICENSE` (MIT) |
| `fonts/` | Fraunces (variable, axes opsz + wght), IBM Plex Sans 400/500/600, IBM Plex Mono 400/500 — sous-ensemble *latin* | 5.3.0 | paquets npm `@fontsource-variable/fraunces`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` | fichiers `.woff2`, `polices.css`, licences OFL-1.1 |

Points d'attention :

- **SheetJS ne s'installe pas depuis npm** : le paquet `xlsx` du registre npm est resté
  en 0.18.5, version qui porte une faille connue (CVE-2023-30533). Toujours reprendre
  l'archive sur `cdn.sheetjs.com`.
- **PDF.js** : `cmaps/` et `standard_fonts/` servent aux PDF dont les polices ne sont pas
  incorporées ; ils sont déclarés à `getDocument` (`cMapUrl`, `standardFontDataUrl`) pour
  que PDF.js ne cherche jamais à les télécharger ailleurs.
- Le sous-ensemble *latin* des polices couvre le français (y compris œ, €, ’ et « »).
  Un caractère hors de ce sous-ensemble s'affiche dans la police de secours du système.
