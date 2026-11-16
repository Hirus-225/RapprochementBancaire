# Rapprochement bancaire

Outil web de rapprochement bancaire pour les services comptables francophones.

Un relevé bancaire PDF et un grand livre Excel sont déposés, confrontés
opération par opération, puis exportés en classeur Excel à trois feuilles :
les opérations rapprochées, celles présentes en banque mais absentes de la
comptabilité, et celles présentes en comptabilité mais absentes du relevé.

**Tout se passe dans le navigateur.** Le site est statique (HTML, CSS et
JavaScript, sans serveur applicatif) : les fichiers déposés sont lus sur le
poste de l'utilisateur et ne sont envoyés nulle part. Pas de compte, pas de
base de données, pas d'historique. Une politique de sécurité (CSP) interdit
d'ailleurs à la page tout échange avec un autre site.

L'application en ligne : <https://charleszogoue.ci/RapprochementBancaire/>

## Ce que l'outil fait — et ne fait pas

Il prépare et fiabilise le rapprochement ; il ne le valide pas à la place du
comptable. Les opérations qu'il ne parvient pas à apparier ne sont pas des
erreurs de l'outil : ce sont les points à examiner.

Le mode d'emploi complet, destiné à l'utilisateur comptable, est dans
[`web/manuel.md`](web/manuel.md) — et affiché dans l'application elle-même,
page « Manuel de procédure ».

## Lancer le site en local

Aucune installation, aucune étape de construction. Il suffit d'un petit
serveur web, par exemple celui de Python, lancé **à la racine du dépôt** :

```
python3 -m http.server
```

puis d'ouvrir <http://localhost:8000/web/>. Ouvrir `web/index.html` par
double-clic ne fonctionne pas : le navigateur refuse les modules JavaScript
servis depuis une adresse `file://`.

## Les deux garde-fous

C'est le point central du projet : **l'extraction d'un PDF et une inversion de
signe échouent toutes deux sans lever d'erreur**, en produisant un
rapprochement faux mais d'apparence normale. Deux contrôles automatiques les
rattrapent, et leur verdict s'affiche au-dessus du résultat.

| Contrôle | Ce qu'il recoupe |
|---|---|
| **Extraction** | Les opérations lues sont confrontées aux totaux imprimés sur le relevé : nombre d'opérations, total des débits et des crédits, solde de clôture recalculé. Verdict : conforme, écart détecté, ou non vérifiable si le relevé ne porte aucun total. |
| **Sens des montants** | Le compte banque de la comptabilité est le miroir du relevé (une entrée d'argent y est un débit, un crédit à la banque). Si les montants concordaient nettement mieux signe inversé, l'application alerte sur une colonne Débit/Crédit inversée à l'export du grand livre. |

Un résultat dont le contrôle d'extraction est en rouge ne doit pas être exploité.

## Comment l'appariement procède

Trois passes, de la plus sûre à la plus permissive ; la colonne `Type_Match`
du classeur indique laquelle a joué.

| Passe | Règle |
|---|---|
| **Parfait** | Même montant et même date. |
| **Numéro de chèque** | Même montant et même numéro de chèque, quelle que soit la date — la banque date l'encaissement, la comptabilité l'émission. |
| **Partiel** | Même montant, date proche et libellés suffisamment ressemblants. |

L'égalité des montants est stricte, au centime près ; les montants sont
manipulés en **centimes entiers**, sans erreur d'arrondi. Seule la troisième
passe dépend des deux curseurs de la barre latérale (tolérance de date,
4 jours par défaut ; similarité minimale des libellés, 80 %).

## Lecture des relevés

Le relevé est lu avec PDF.js. L'outil essaie d'abord un lecteur **par
coordonnées**, qui range chaque montant dans sa colonne d'après sa position
horizontale — seul moyen de savoir s'il est au débit ou au crédit sur les
relevés qui n'en renseignent qu'une colonne par ligne, et d'encaisser les
montants dont l'espace sépare les milliers (`200 000`). Si ce chemin ne rend
aucune opération, l'outil bascule sur un lecteur **par tableaux**, qui
reconstruit les cellules à partir des traits dessinés dans le PDF.

Quatre formats de relevé sont couverts à ce jour : deux mises en page SIB,
celle de la Société Générale CI (dates pointées, lignes numérotées, totaux en
cartouche d'en-tête) et celle d'Ecobank (en-tête en anglais, dates
`30-Jan-2026`, devise accolée aux montants, colonne de référence entre le
libellé et les montants).

## Une référence Python, une page de tests

La logique métier existe en deux exemplaires, **tenus identiques par les
tests** :

- `web/js/` — la version JavaScript, celle que le site exécute ;
- `app.py` — la version Python d'origine, conservée comme **référence**.

Un script local (hors dépôt, car il lit les vrais relevés) fait tourner
`app.py` sur les jeux de référence et en écrit les résultats dans
`data_sortie/reference/`. La page `web/tests/tests.html`, ouverte en local
depuis la racine du dépôt, compare la version JavaScript à ces résultats —
mots lus dans les PDF, tableaux, montants, dates, scores de similarité,
rapprochements, classeur exporté — et doit afficher **zéro écart**.

**Toute modification de la logique se fait dans les deux versions** et se
valide par cette page. C'est le seul filet contre une extraction
silencieusement fausse.

## Publication

Le site est publié sur GitHub Pages par le flux
[`.github/workflows/pages.yml`](.github/workflows/pages.yml), à chaque mise à
jour de `main` qui touche `web/` (ou à la demande, onglet *Actions*). Le flux
publie le dossier `web/` tel quel, sans la page de tests.

Prérequis, une seule fois : *Settings → Pages → Build and deployment →
Source : « GitHub Actions »*.

## Contenu du dépôt

| Chemin | Contenu |
|---|---|
| `web/index.html` | La page de l'application. |
| `web/js/` | La logique (lecture du PDF et du grand livre, nettoyage, contrôles, rapprochement, export) et l'interface (`main.js`). |
| `web/css/style.css` | L'habillage : jetons et composants du design system. |
| `web/manuel.md` | Le mode d'emploi, affiché dans l'application. |
| `web/vendor/` | Bibliothèques copiées en local, versions figées : PDF.js, SheetJS, marked, polices. Voir `web/vendor/LISEZMOI.md`. |
| `web/tests/` | La page de tests de non-régression (usage local). |
| `app.py` | La logique métier de référence, en Python. |
| `requirements.txt` | Dépendances de la référence Python : pandas, pdfplumber, openpyxl, thefuzz, xlrd. |
| `.github/workflows/pages.yml` | La publication sur GitHub Pages. |

## Règles non négociables

1. **Aucune donnée bancaire réelle dans ce dépôt.** Les dossiers `data_entree/`
   et `data_sortie/` contiennent des relevés nominatifs (IBAN, titulaire,
   numéro de carte) ; le `.gitignore` les refuse, ainsi que tout PDF, classeur
   ou CSV déposé ailleurs dans le projet.
2. **Aucun échange avec un autre site.** Pas de CDN, pas de police distante,
   pas de mesure d'audience : tout est servi par le site lui-même, et la CSP
   (`default-src 'self'`) le fait respecter par le navigateur.
3. **Le manuel a une seule source**, `web/manuel.md`.
4. **La logique JavaScript et la référence Python restent identiques**, à zéro
   écart sur la page de tests.
5. **Les garde-fous d'extraction ne se contournent pas.** Un relevé dont les
   totaux ne concordent pas produit un rapprochement faux, pas un
   rapprochement approximatif.
6. **Le code, les identifiants et les messages sont en français.**

## Licence

MIT — voir [`LICENSE`](LICENSE). Les bibliothèques de `web/vendor/` gardent
leur propre licence (Apache-2.0, MIT, OFL), jointe à chacune.
