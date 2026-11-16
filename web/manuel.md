# Manuel de procédure — Rapprochement bancaire

**Version 2.0 — 16 novembre 2026**

Confronter un relevé bancaire à votre grand livre comptable et obtenir, en un
clic, la liste des opérations rapprochées et des écarts à traiter.

Ce manuel s'adresse au service comptable. Aucune connaissance technique n'est
nécessaire.

| | |
|---|---|
| **Destiné à** | Service comptable |
| **Entrées** | Relevé PDF + grand livre Excel |
| **Sortie** | Classeur Excel à 3 feuilles |
| **Confidentialité** | Vos fichiers sont lus dans votre navigateur et ne sont envoyés nulle part |

---

## 1. À quoi sert l'outil

L'outil compare automatiquement deux documents portant sur **la même période**
et **le même compte** :

| Document | Ce que c'est |
|---|---|
| **Le relevé bancaire** | Le PDF fourni par la banque, tel qu'il vous est transmis. |
| **Le grand livre** | L'extraction Excel du compte « banque » de votre comptabilité. |

Il apparie les opérations qui correspondent de part et d'autre, puis produit un
classeur Excel à trois feuilles : les opérations rapprochées, celles présentes
en banque mais absentes de la compta, et celles présentes en compta mais
absentes de la banque.

> **À retenir.** L'outil prépare et fiabilise le rapprochement ; il ne le valide
> pas à votre place. Les opérations qu'il ne parvient pas à apparier ne sont pas
> des erreurs de l'outil : ce sont les points que vous devez examiner.

---

## 2. Ce qu'il vous faut

Deux fichiers, dans les bons formats, et un navigateur à jour.

### Le relevé bancaire — au format PDF

Le PDF d'origine de la banque, **non modifié**. L'outil sait lire les relevés où
une seule des colonnes Débit / Crédit est renseignée par ligne, y compris
lorsque les montants utilisent l'espace comme séparateur de milliers
(`200 000`). Il lit aussi les relevés rédigés en anglais (colonnes *Payments* /
*Deposits*, dates `30-Jan-2026`, montants précédés de la devise comme
`XOF6,000.00`).

### Le grand livre — au format Excel

Un fichier `.xlsx` ou `.xls` contenant au minimum une colonne **date**, une
colonne **libellé**, et soit des colonnes **Débit** et **Crédit**, soit une
colonne **Montant**. Les intitulés de colonnes doivent figurer sur la
**première ligne** de la feuille, et le grand livre sur la **première
feuille** du classeur. Limitez l'extraction au compte banque et à la période du
relevé.

### Un navigateur à jour

Chrome, Edge, Firefox ou Safari, dans une version récente. Rien à installer.

> **Vos données restent chez vous.** Les fichiers que vous déposez sont lus par
> votre navigateur, sur votre ordinateur : ils ne sont envoyés à aucun serveur,
> ni conservés une fois la page fermée. Ils contiennent néanmoins des données
> bancaires nominatives : ne les diffusez pas.

---

## 3. Ouvrir l'outil

Rendez-vous à l'adresse de l'application :

```
https://charleszogoue.ci/RapprochementBancaire/
```

Ajoutez-la à vos favoris pour la retrouver facilement. La page « Assistant de
rapprochement bancaire » s'affiche : deux zones de dépôt de fichiers au centre,
et à gauche un panneau avec la navigation (**Rapprochement**, **Manuel de
procédure**) et les paramètres. Sur un écran étroit, ce panneau passe au-dessus
de la page.

---

## 4. Lancer un rapprochement

Trois gestes suffisent ; le réglage des curseurs est facultatif.

### Étape 1 — Déposer le relevé bancaire

Sous **1. Relevé Bancaire**, glissez le PDF dans la zone de dépôt, ou cliquez
sur **Parcourir les fichiers** pour le sélectionner. Le nom du fichier s'affiche
alors dans une pastille verte ; la croix **×** permet de le retirer.

### Étape 2 — Déposer le grand livre

Sous **2. Grand Livre Comptable**, déposez le fichier Excel de la même façon.
Tant que les deux fichiers ne sont pas déposés, un message vous le rappelle et
le bouton de lancement n'apparaît pas.

### Étape 3 — Ajuster les paramètres (facultatif)

Dans le panneau de gauche, deux curseurs affinent l'appariement :

| Réglage | Effet | Défaut |
|---|---|---|
| **Tolérance sur la date (jours)** | Écart de date maximal accepté entre banque et compta. | 4 jours |
| **Similarité minimale des libellés (%)** | Plus la valeur est basse, plus l'outil rapproche — au risque d'appariements erronés. | 80 % |

Ces deux réglages n'influencent **que le rapprochement partiel** (voir §7) ;
laissez-les tels quels en cas de doute.

### Étape 4 — Lancer

Cliquez sur **Lancer le rapprochement**. Le message « Traitement en cours… »
s'affiche quelques secondes.

> **Changer un fichier ou un réglage efface le résultat.** Le résultat affiché
> correspond toujours aux fichiers et aux réglages du moment : si vous en
> modifiez un, cliquez de nouveau sur **Lancer le rapprochement**.

---

## 5. Lire l'écran de résultats

Le contrôle de l'extraction d'abord, puis les chiffres clés, le détail dans les
onglets et le classeur à télécharger en bas.

### Les quatre indicateurs

| Indicateur | Ce qu'il compte |
|---|---|
| **Opérations rapprochées** | Opérations appariées entre les deux sources. |
| **Manquants en compta** | Présentes en banque, introuvables en comptabilité. |
| **Manquants en banque** | Présentes en compta, introuvables sur le relevé. |
| **Taux de rapprochement** | Part des opérations bancaires appariées. |

### Les trois onglets

Ils reprennent le détail ligne à ligne : **Rapprochées**, **Dans la banque,
absentes en compta** et **En compta, absentes de la banque**. Un tableau trop
large pour l'écran défile horizontalement dans son cadre.

### Le classeur Excel

Le bouton **Télécharger le résultat (Excel)** enregistre
`resultat_rapprochement.xlsx` dans votre dossier de téléchargements, avec une
feuille par onglet plus, le cas échéant, une feuille **Contrôles extraction**.
C'est ce fichier que vous conservez comme pièce de rapprochement.

---

## 6. Les contrôles et alertes

**Avant d'exploiter un résultat, lisez toujours le contrôle d'extraction.** Il
vous dit si la lecture du relevé est fiable.

L'outil recoupe ce qu'il a lu dans le PDF avec les totaux imprimés sur le
relevé (nombre d'opérations, total des mouvements, solde de clôture recalculé).
Trois situations possibles :

| Affichage | Ce que cela veut dire | Ce qu'il faut faire |
|---|---|---|
| **Volet « Extraction vérifiée sur les totaux du relevé »** | Les totaux lus correspondent à ceux du relevé. Dépliez le volet : le tableau de contrôle (colonnes *Extrait*, *Annoncé par le relevé*, *Écart*) affiche un écart nul partout. | Vous pouvez exploiter le résultat en confiance. |
| **Message rouge « L'extraction ne correspond pas… »** | Les totaux ne concordent pas : des opérations ont été mal lues ou omises. | N'exploitez pas le rapprochement et signalez le relevé au support. |
| **Message orange « Ce relevé ne comporte pas de totaux de contrôle exploitables… »** | L'extraction n'a pas pu être vérifiée automatiquement. | Le résultat peut être bon, mais recoupez vous-même le nombre d'opérations et les totaux avant de le valider. |

### Alerte sur le sens des montants

Un message signalant une **convention Débit/Crédit** inhabituelle veut dire que
les montants concorderaient bien mieux en inversant le signe de la comptabilité.
C'est le signe d'une colonne Débit/Crédit inversée dans l'extraction du grand
livre : corrigez l'export avant d'exploiter le résultat.

---

## 7. Traiter les écarts

Les opérations non rapprochées sont le cœur de votre travail : chacune a une
explication.

Une opération peut apparaître dans l'une des deux feuilles « manquants » pour
des raisons parfaitement normales : chèque émis mais pas encore encaissé,
écriture passée sur une autre période, report à nouveau hors périmètre du
relevé, ou différence à corriger dans un des deux systèmes.

### Comment l'outil apparie — trois niveaux

La colonne **Type_Match** du résultat indique comment chaque opération a été
rapprochée :

| Type de correspondance | Règle appliquée |
|---|---|
| **Parfait** | Même montant et même date. |
| **Numéro de chèque** | Même montant et même numéro de chèque, quelle que soit la date — la banque date l'encaissement, la compta l'émission. |
| **Partiel** | Même montant, date proche (dans la tolérance) et libellés suffisamment ressemblants. |

> **Marche à suivre.** Pour chaque ligne restée non rapprochée, cherchez sa
> contrepartie dans l'autre feuille (souvent même montant, à une date ou un
> libellé près). Si vous la trouvez : c'est un simple décalage, à documenter. Si
> vous ne la trouvez pas : c'est une vraie différence à corriger dans la banque
> ou la comptabilité.

---

## 8. Points de vigilance

Quelques principes qui expliquent la plupart des résultats surprenants.

### Le compte banque de la compta est le miroir du relevé

Une entrée d'argent est un **crédit** à la banque, mais un **débit** en
comptabilité. L'outil en tient compte automatiquement :

| Source | Montant calculé |
|---|---|
| Relevé bancaire | crédit − débit |
| Grand livre | débit − crédit |

C'est pourquoi une inversion de colonnes dans l'export du grand livre fait
chuter le rapprochement — d'où l'alerte du §6.

### Les montants sont comparés au centime près

L'égalité des montants est **stricte** : aucune tolérance en centimes. Une
différence d'arrondi laissera l'opération non rapprochée. Deux frais que la
comptabilité aurait cumulés en une seule écriture ne sont pas non plus
rapprochés : à vous de les arbitrer.

### Les numéros de chèque doivent concorder

L'appariement par chèque ignore les zéros de tête (`0412083` = `412083`), mais
pas une différence de chiffre : un numéro divergent entre banque et compta reste
à arbitrer à la main.

### Les dates du grand livre doivent avoir une seule écriture

Si les dates sont saisies en texte, elles doivent toutes suivre la même forme
(par exemple `30/01/2026`) : une date écrite autrement (`2026-01-31`) est jugée
invalide et sa ligne est écartée. Les dates au format date d'Excel ne posent pas
ce problème.

### Un relevé sans totaux n'est pas vérifié automatiquement

Sur ce type de relevé, le garde-fou d'extraction ne peut pas se prononcer (§6,
message orange) : le recoupement manuel vous revient.

---

## 9. En cas de problème

| Ce que vous constatez | Cause probable et conduite à tenir |
|---|---|
| Le bouton **Lancer le rapprochement** n'apparaît pas | Un des deux fichiers n'est pas déposé. Vérifiez que les deux pastilles vertes sont affichées. |
| « Fichier refusé : format attendu… » | Le fichier déposé n'a pas la bonne extension : un PDF pour le relevé, un `.xlsx` ou `.xls` pour le grand livre. |
| « Aucune opération n'a pu être extraite » | Le PDF n'expose pas de colonnes Débit/Crédit lisibles (relevé scanné en simple image, sans texte, ou format inhabituel). Fournissez le PDF d'origine de la banque. |
| Message rouge sur l'extraction | Extraction incomplète ou erronée. N'exploitez pas le résultat ; transmettez le relevé au support. |
| Taux de rapprochement très bas | Souvent une inversion Débit/Crédit à l'export du grand livre (voir l'alerte de sens), ou une période / un compte qui ne correspondent pas au relevé. |
| « Colonnes 'date' ou 'libellé' introuvables » | Le grand livre ne contient pas les colonnes attendues, ou ses intitulés ne sont pas sur la première ligne. Renommez-les clairement (date, libellé, débit, crédit) et ré-exportez. |
| Le résultat a disparu | Un fichier ou un réglage a été modifié après le lancement (§4) : relancez le rapprochement. |
| La page reste vide ou ne réagit pas | Navigateur trop ancien : mettez-le à jour, ou essayez un autre navigateur récent. |

---

## 10. Versions

| Version | Date | Changement |
|---|---|---|
| 2.0 | 16/11/2026 | Nouvelle version de l'outil, en site web : les fichiers sont traités dans le navigateur et ne sont plus envoyés à un serveur. Nouvelle adresse, nouveaux libellés de l'écran. |
| 1.0 | 17/09/2026 | Première rédaction, reprise du manuel HTML embarqué dans l'application. |
