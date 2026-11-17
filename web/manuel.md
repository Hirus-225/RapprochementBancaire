# Manuel de procédure — Rapprochement bancaire

**Version 2.1 — 17 novembre 2026**

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

Ajoutez-la à vos favoris pour la retrouver facilement. La page « Rapprochement
bancaire » se lit de haut en bas :

- un **bandeau bleu marine**, avec la navigation en haut à droite
  (**Rapprochement**, **Manuel de procédure**) ;
- la section **Fichiers** : les deux zones de dépôt ;
- la bande grise **Réglages** : les deux curseurs et le bouton de lancement ;
- la section **Résultat**, qui n'apparaît qu'après un rapprochement.

Sur un écran étroit, tout passe sur une seule colonne.

---

## 4. Lancer un rapprochement

Trois gestes suffisent ; le réglage des curseurs est facultatif.

### Étape 1 — Déposer le relevé bancaire

Dans la section **Fichiers**, sous **Relevé bancaire** (repère *PDF*), glissez
le PDF dans la zone de dépôt, ou cliquez n'importe où dans cette zone pour le
choisir parmi vos fichiers. Le nom et la taille du fichier s'affichent alors, et
la mention **En attente** devient **Prêt**. Le lien **Retirer** permet de
l'enlever.

### Étape 2 — Déposer le grand livre

Sous **Grand livre comptable** (repère *Excel*), déposez le fichier de la même
façon. Au clavier, la touche Tab atteint chaque zone de dépôt, et Espace ouvre
le choix du fichier.

### Étape 3 — Ajuster les réglages (facultatif)

Dans la bande **Réglages**, deux curseurs affinent l'appariement :

| Réglage | Effet | Défaut |
|---|---|---|
| **Tolérance sur la date** | Écart de date maximal accepté entre banque et compta. | 4 jours |
| **Similarité des libellés** | Plus la valeur est basse, plus l'outil rapproche, au risque d'appariements erronés. | 80 % |

Ces deux réglages n'influencent **que le rapprochement partiel** (voir §7) ;
laissez-les tels quels en cas de doute.

### Étape 4 — Lancer

À droite des curseurs, un message indique où vous en êtes (« Il manque le
relevé bancaire. », « Les deux fichiers sont prêts. »…). Le bouton **Lancer le
rapprochement** reste grisé tant qu'il manque un fichier. Cliquez dessus : le
message « Traitement en cours… » s'affiche quelques secondes, puis la page
descend jusqu'au résultat.

> **Changer un fichier ou un réglage efface le résultat.** Le résultat affiché
> correspond toujours aux fichiers et aux réglages du moment : si vous en
> modifiez un, cliquez de nouveau sur **Lancer le rapprochement**.

---

## 5. Lire l'écran de résultats

La section **Résultat** présente d'abord le contrôle de l'extraction (§6),
puis trois chiffres clés, et enfin le détail ligne à ligne dans des onglets.

### Les trois chiffres clés

| Bloc | Ce qu'il indique |
|---|---|
| **Taux de rapprochement** | Part des opérations bancaires appariées. La barre colorée et sa légende détaillent la répartition : *Parfait*, *N° de chèque*, *Partiel* et *Non rapprochées*. |
| **À saisir en comptabilité** | Opérations du relevé absentes du grand livre, avec leur **solde net** en F CFA. |
| **En attente à la banque** | Écritures du grand livre absentes du relevé, avec leur **solde net** en F CFA. |

Sous chacun des deux derniers blocs, un lien (**Voir ces opérations**, **Voir
ces écritures**) ouvre directement l'onglet correspondant.

### Les trois onglets

Ils reprennent le détail ligne à ligne : **Rapprochées**, **À saisir en
comptabilité** et **En attente à la banque**. Le nombre de lignes figure à côté
de chaque titre. Dans l'onglet **Rapprochées**, chaque ligne montre côté
**Banque** la date, le libellé et le montant, côté **Comptabilité** la date et
le libellé, puis la similarité des libellés (sur 100). Quand les deux dates
diffèrent, l'écart est indiqué sous la date comptable (par exemple « 4 j
avant » : la compta a daté l'opération 4 jours avant la banque). Les montants
positifs sont en vert. Les dates s'affichent au format JJ/MM/AAAA.

Au-dessus du tableau :

- le champ **Filtrer par libellé ou montant** ne garde que les lignes qui
  contiennent le texte ou le montant saisi (les espaces sont ignorées :
  `186400` trouve `186 400`) ;
- dans l'onglet **Rapprochées**, les boutons **Tous**, **Parfait**, **N° de
  chèque** et **Partiel** filtrent selon le type de correspondance ;
- un compteur indique combien de lignes sont affichées (« 27 sur 56 lignes »).

Ces filtres ne servent qu'à l'écran : ils ne modifient pas le classeur Excel.

### Le classeur Excel

Le bouton **Télécharger le classeur Excel**, en haut de la section Résultat,
enregistre `resultat_rapprochement.xlsx` dans votre dossier de
téléchargements. Il contient trois feuilles, **Opérations rapprochées**,
**Manquants en compta** et **Manquants en banque**, et, le cas échéant, une
quatrième feuille **Contrôles extraction**. Il reprend toutes les lignes,
quels que soient les filtres de l'écran. C'est ce fichier que vous conservez
comme pièce de rapprochement.

---

## 6. Les contrôles et alertes

**Avant d'exploiter un résultat, lisez toujours le contrôle d'extraction.** Il
vous dit si la lecture du relevé est fiable.

L'outil recoupe ce qu'il a lu dans le PDF avec les totaux imprimés sur le
relevé (nombre d'opérations, total des mouvements, solde de clôture recalculé).
Trois situations possibles :

| Affichage | Ce que cela veut dire | Ce qu'il faut faire |
|---|---|---|
| **Coche verte « Extraction vérifiée. Les 5 contrôles sur les totaux du relevé sont à écart nul. »** (3 contrôles sur certains relevés) | Les totaux lus correspondent à ceux du relevé. Cliquez sur **Voir les contrôles** : le tableau (colonnes *Extrait*, *Annoncé par le relevé*, *Écart*) affiche un écart nul partout. | Vous pouvez exploiter le résultat en confiance. |
| **Message sur fond rouge « L'extraction ne correspond pas… »**, suivi du tableau des contrôles | Les totaux ne concordent pas : des opérations ont été mal lues ou omises. La colonne *Écart* montre lesquels. | N'exploitez pas le rapprochement et signalez le relevé au support. |
| **Message sur fond orangé « Ce relevé ne comporte pas de totaux de contrôle exploitables… »** | L'extraction n'a pas pu être vérifiée automatiquement. | Le résultat peut être bon, mais recoupez vous-même le nombre d'opérations et les totaux avant de le valider. |

### Alerte sur le sens des montants

Un message sur fond orangé signalant une **convention Débit/Crédit** inhabituelle veut dire que
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

La colonne **Type** de l'onglet Rapprochées (colonne **Type_Match** du classeur
Excel) indique comment chaque opération a été rapprochée :

| À l'écran | Dans le classeur | Règle appliquée |
|---|---|---|
| **Parfait** | Parfait | Même montant et même date. |
| **N° de chèque** | Numéro de chèque | Même montant et même numéro de chèque, quelle que soit la date — la banque date l'encaissement, la compta l'émission. |
| **Partiel** | Partiel (Tolérance date & libellé) | Même montant, date proche (dans la tolérance) et libellés suffisamment ressemblants. |

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
message sur fond orangé) : le recoupement manuel vous revient.

---

## 9. En cas de problème

| Ce que vous constatez | Cause probable et conduite à tenir |
|---|---|
| Le bouton **Lancer le rapprochement** reste grisé | Un des deux fichiers n'est pas déposé : le message au-dessus du bouton indique lequel. Les deux zones doivent afficher **Prêt**. |
| « Fichier refusé : format attendu… » | Le fichier déposé n'a pas la bonne extension : un PDF pour le relevé, un `.xlsx` ou `.xls` pour le grand livre. |
| « Aucune opération n'a pu être extraite » | Le PDF n'expose pas de colonnes Débit/Crédit lisibles (relevé scanné en simple image, sans texte, ou format inhabituel). Fournissez le PDF d'origine de la banque. |
| Message sur fond rouge à propos de l'extraction | Extraction incomplète ou erronée. N'exploitez pas le résultat ; transmettez le relevé au support. |
| Taux de rapprochement très bas | Souvent une inversion Débit/Crédit à l'export du grand livre (voir l'alerte de sens), ou une période / un compte qui ne correspondent pas au relevé. |
| « Colonnes 'date' ou 'libellé' introuvables » | Le grand livre ne contient pas les colonnes attendues, ou ses intitulés ne sont pas sur la première ligne. Renommez-les clairement (date, libellé, débit, crédit) et ré-exportez. |
| Le résultat a disparu | Un fichier ou un réglage a été modifié après le lancement (§4) : relancez le rapprochement. |
| La page reste vide ou ne réagit pas | Navigateur trop ancien : mettez-le à jour, ou essayez un autre navigateur récent. |

---

## 10. Versions

| Version | Date | Changement |
|---|---|---|
| 2.1 | 17/11/2026 | Nouvel habillage de l'écran, sur une seule colonne : bandeau, sections Fichiers, Réglages et Résultat ; nouveaux noms des onglets et du bouton de téléchargement ; filtre et types de correspondance au-dessus du tableau. Le classeur Excel ne change pas. |
| 2.0 | 16/11/2026 | Nouvelle version de l'outil, en site web : les fichiers sont traités dans le navigateur et ne sont plus envoyés à un serveur. Nouvelle adresse, nouveaux libellés de l'écran. |
| 1.0 | 17/09/2026 | Première rédaction, reprise du manuel HTML embarqué dans l'application. |
