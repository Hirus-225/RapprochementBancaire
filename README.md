# Rapprochement bancaire

Outil web de rapprochement bancaire pour les services comptables francophones.

Un relevé bancaire PDF et un grand livre Excel sont déposés, confrontés
opération par opération, puis exportés en classeur Excel à trois feuilles :
les opérations rapprochées, celles présentes en banque mais absentes de la
comptabilité, et celles présentes en comptabilité mais absentes du relevé.
**Aucune donnée n'est conservée** : les fichiers sont lus en mémoire le temps
du traitement. Pas de compte, pas de base de données, pas d'historique.

L'application en ligne : [rapprochement-facile.streamlit.app](https://rapprochement-facile.streamlit.app)

## Ce que l'outil fait — et ne fait pas

Il prépare et fiabilise le rapprochement ; il ne le valide pas à la place du
comptable. Les opérations qu'il ne parvient pas à apparier ne sont pas des
erreurs de l'outil : ce sont les points à examiner.

Le mode d'emploi complet, destiné à l'utilisateur comptable, est dans
[`docs/MANUEL-PROCEDURE.md`](docs/MANUEL-PROCEDURE.md) — et affiché dans
l'application elle-même, onglet « Manuel de procédure ».

## Installation

```
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Lancer l'application en local

```
./venv/bin/streamlit run app.py
```

L'application s'ouvre sur http://localhost:8501. `Ctrl+C` arrête le serveur.
Le thème est lu dans `.streamlit/config.toml`, relativement au dossier depuis
lequel la commande est lancée.

## Les deux garde-fous

C'est le point central du projet : **l'extraction d'un PDF et une inversion de
signe échouent toutes deux sans lever d'erreur**, en produisant un
rapprochement faux mais d'apparence normale. Deux contrôles automatiques les
rattrapent, et leur verdict s'affiche au-dessus du résultat.

| Contrôle | Ce qu'il recoupe |
|---|---|
| **Extraction** | Les opérations lues sont confrontées aux totaux imprimés sur le relevé : nombre d'opérations, total des débits et des crédits, solde de clôture recalculé. Verdict : conforme, écart détecté, ou non vérifiable si le relevé ne porte aucun total. |
| **Sens des montants** | Le compte banque de la comptabilité est le miroir du relevé (une entrée d'argent y est un débit, un crédit à la banque). Si les montants concordaient nettement mieux signe inversé, l'application alerte sur une colonne Débit/Crédit inversée à l'export du grand livre. |

Un résultat dont le bandeau d'extraction est rouge ne doit pas être exploité.

## Comment l'appariement procède

Trois passes, de la plus sûre à la plus permissive ; la colonne `Type_Match`
du classeur indique laquelle a joué.

| Passe | Règle |
|---|---|
| **Parfait** | Même montant et même date. |
| **Numéro de chèque** | Même montant et même numéro de chèque, quelle que soit la date — la banque date l'encaissement, la comptabilité l'émission. |
| **Partiel** | Même montant, date proche et libellés suffisamment ressemblants. |

L'égalité des montants est stricte, au centime près. Seule la troisième passe
dépend des deux curseurs de la barre latérale (tolérance de date, 4 jours par
défaut ; similarité minimale des libellés, 80 %).

## Lecture des relevés

`extraire_releve_pdf` essaie d'abord un parseur **par coordonnées**, qui lit
chaque montant d'après sa position horizontale — seul moyen de savoir s'il est
au débit ou au crédit sur les relevés qui n'en renseignent qu'une colonne par
ligne, et d'encaisser les montants dont l'espace sépare les milliers
(`200 000`). Si ce chemin ne rend aucune opération, l'outil bascule sur un
parseur **par tableaux**, qui repère les colonnes Débit/Crédit sur la ligne
d'en-tête de chaque page.

Trois formats de relevé sont couverts à ce jour, dont les relevés SIB et ceux
de la Société Générale CI (dates pointées, lignes numérotées, totaux en
cartouche d'en-tête).

## Vérification après modification du parseur

Le dépôt ne contient aucun jeu de test : les relevés et grands livres qui
servent de non-régression sont de **vraies données bancaires nominatives** et
restent hors du dépôt, comme le script de traitement en lot qui les exploite.

La vérification se fait donc en local, sur ces fichiers : les contrôles
d'extraction doivent afficher un **écart nul** sur chacun des relevés de
référence, et le nombre d'opérations rapprochées rester inchangé. **À relancer
après toute retouche du parseur** — c'est le seul filet contre une extraction
silencieusement fausse.

## Déploiement

Streamlit Community Cloud installe `requirements.txt` et lance `app.py`.

1. Pousser la branche `main` sur GitHub.
2. Sur [share.streamlit.io](https://share.streamlit.io), se connecter avec le
   compte GitHub, puis **New app**.
3. Dépôt `Hirus-225/RapprochementBancaire`, branche `main`, fichier principal
   `app.py`.
4. Dans **Advanced settings**, choisir une version de Python proposée par
   l'hébergeur — **3.11 ou 3.12**. Le poste de développement tourne en 3.14,
   que Streamlit Cloud ne propose pas ; le code n'utilise aucune syntaxe qui
   en dépende.
5. Déployer, puis vérifier sur l'URL obtenue qu'un rapprochement complet passe
   de bout en bout, manuel compris.

### Ce qui doit partir avec l'application

`docs/` en fait partie : l'application y lit `MANUEL-PROCEDURE.md` pour
afficher son mode d'emploi. Un déploiement qui l'oublierait afficherait un
message d'erreur à la place du manuel.

## Contenu du dépôt

| Fichier | Contenu |
|---|---|
| `app.py` | Logique métier **et** interface Streamlit. Seul fichier applicatif, volontairement autonome. |
| `docs/MANUEL-PROCEDURE.md` | Le mode d'emploi, pour l'utilisateur comptable. Affiché dans l'application. |
| `.streamlit/config.toml` | Le thème : couleurs, rayons et typographies que Streamlit peint lui-même. |
| `requirements.txt` | Streamlit, pandas, pdfplumber, openpyxl, thefuzz. |

## Règles non négociables

1. **Aucune donnée bancaire réelle dans ce dépôt.** Les dossiers `data_entree/`
   et `data_sortie/` contiennent des relevés nominatifs (IBAN, titulaire,
   numéro de carte) ; le `.gitignore` les refuse, ainsi que tout PDF, classeur
   ou CSV déposé ailleurs dans le projet.
2. **Le manuel a une seule source**, `docs/MANUEL-PROCEDURE.md`. Ne jamais en
   recopier le texte dans le code : c'est la version affichée à l'utilisateur
   qui deviendrait la périmée.
3. **Ne jamais dupliquer la logique métier** hors de `app.py`. Les outils
   annexes l'importent ; deux copies avaient divergé par le passé.
4. **Les garde-fous d'extraction ne se contournent pas.** Un relevé dont les
   totaux ne concordent pas produit un rapprochement faux, pas un
   rapprochement approximatif.
5. **Le code, les identifiants et les messages sont en français.**

## Licence

MIT — voir [`LICENSE`](LICENSE).
