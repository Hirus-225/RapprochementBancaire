# Manuel de procédure — Rapprochement bancaire

**Version 1.0 — 17 septembre 2026**

Confronter un relevé bancaire à votre grand livre comptable et obtenir, en un
clic, la liste des opérations rapprochées et des écarts à traiter.

Ce manuel s'adresse au service comptable. Aucune connaissance technique n'est
nécessaire.

| | |
|---|---|
| **Destiné à** | Service comptable |
| **Entrées** | Relevé PDF + grand livre Excel |
| **Sortie** | Classeur Excel à 3 feuilles |

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

Deux fichiers, dans les bons formats.

### Le relevé bancaire — au format PDF

Le PDF d'origine de la banque, **non modifié**. L'outil sait lire les relevés où
une seule des colonnes Débit / Crédit est renseignée par ligne, y compris
lorsque les montants utilisent l'espace comme séparateur de milliers
(`200 000`).

### Le grand livre — au format Excel

Un fichier `.xlsx` ou `.xls` contenant au minimum une colonne **date**, une
colonne **libellé**, et soit des colonnes **Débit** et **Crédit**, soit une
colonne **Montant**. Limitez l'extraction au compte banque et à la période du
relevé.

> **Attention aux données sensibles.** Ces fichiers contiennent des données
> bancaires nominatives. Ne les déposez que dans l'outil prévu, et ne les
> diffusez pas.

---

## 3. Ouvrir l'outil

L'outil s'utilise dans un navigateur web — rien à installer.

Rendez-vous à l'adresse de l'application :

```
rapprochement-facile.streamlit.app
```

Ajoutez-la à vos favoris pour la retrouver facilement. Une page « Assistant de
rapprochement bancaire » s'affiche : deux zones de dépôt de fichiers au centre,
et un panneau de paramètres sur la gauche.

> **Mise en veille.** L'application peut se mettre en veille après une période
> d'inactivité. Si un message « wake up » apparaît, cliquez sur le bouton proposé
> et patientez quelques secondes : elle redémarre d'elle-même.

---

## 4. Lancer un rapprochement

Trois gestes suffisent ; le réglage des curseurs est facultatif.

### Étape 1 — Déposer le relevé bancaire

Sous **1. Relevé bancaire**, glissez le PDF ou cliquez pour le sélectionner.

### Étape 2 — Déposer le grand livre

Sous **2. Grand livre comptable**, déposez le fichier Excel. Tant que les deux
fichiers ne sont pas chargés, le bouton de lancement reste inactif.

### Étape 3 — Ajuster les paramètres (facultatif)

Dans le panneau de gauche, deux curseurs affinent l'appariement :

| Réglage | Effet | Défaut |
|---|---|---|
| **Tolérance sur la date (jours)** | Écart de date maximal accepté entre banque et compta. | 4 jours |
| **Similarité minimale des libellés (%)** | Plus la valeur est basse, plus l'outil rapproche — au risque d'appariements erronés. | 80 % |

Ces deux réglages n'influencent **que le rapprochement partiel** (voir §7) ;
laissez-les tels quels en cas de doute.

### Étape 4 — Lancer

Cliquez sur **Lancer le rapprochement**. Le traitement dure quelques secondes.

---

## 5. Lire l'écran de résultats

Les chiffres clés en haut, le détail dans les onglets, le classeur à télécharger
en bas.

### Les quatre indicateurs

| Indicateur | Ce qu'il compte |
|---|---|
| **Opérations rapprochées** | Opérations appariées entre les deux sources. |
| **Manquants en compta** | Présentes en banque, introuvables en comptabilité. |
| **Manquants en banque** | Présentes en compta, introuvables sur le relevé. |
| **Taux de rapprochement** | Part des opérations bancaires appariées. |

### Les trois onglets

Ils reprennent le détail ligne à ligne : **Rapprochées**, **Dans la banque,
absentes en compta** et **En compta, absentes de la banque**.

### Le classeur Excel

Le bouton **Télécharger le fichier de résultat Excel** enregistre
`resultat_rapprochement.xlsx`, avec une feuille par onglet plus, le cas échéant,
une feuille **Contrôles extraction**. C'est ce fichier que vous conservez comme
pièce de rapprochement.

---

## 6. Les contrôles et alertes

**Avant d'exploiter un résultat, lisez toujours le bandeau de contrôle.** Il
vous dit si l'extraction du relevé est fiable.

L'outil recoupe ce qu'il a lu dans le PDF avec les totaux imprimés en pied de
relevé (nombre d'opérations, total des mouvements, solde de clôture recalculé).
Trois situations possibles :

| Bandeau | Ce que cela veut dire | Ce qu'il faut faire |
|---|---|---|
| **Extraction vérifiée** | Les totaux lus correspondent à ceux du relevé : le tableau de contrôle (colonnes *Extrait*, *Annoncé par le relevé*, *Écart*) affiche un écart nul partout. | Vous pouvez exploiter le résultat en confiance. |
| **Écart détecté** | Les totaux ne concordent pas : des opérations ont été mal lues ou omises. | N'exploitez pas le rapprochement et signalez le relevé au support. |
| **Non vérifiable** | Le relevé ne porte aucun total de contrôle exploitable : l'extraction n'a pas pu être vérifiée automatiquement. | Le résultat peut être bon, mais recoupez vous-même le nombre d'opérations et les totaux avant de le valider. |

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
différence d'arrondi laissera l'opération non rapprochée.

### Les numéros de chèque doivent concorder

L'appariement par chèque ignore les zéros de tête (`0412083` = `412083`), mais
pas une différence de chiffre : un numéro divergent entre banque et compta reste
à arbitrer à la main.

### Un relevé sans totaux n'est pas vérifié automatiquement

Sur ce type de relevé, le garde-fou d'extraction ne peut pas se prononcer (§6,
alerte orange) : le recoupement manuel vous revient.

---

## 9. En cas de problème

| Ce que vous constatez | Cause probable et conduite à tenir |
|---|---|
| Le bouton de lancement reste grisé | Un des deux fichiers n'est pas chargé. Vérifiez que le relevé et le grand livre sont bien déposés. |
| « Aucune opération n'a pu être extraite » | Le PDF n'expose pas de colonnes Débit/Crédit lisibles (relevé scanné en image, format inhabituel). Fournissez le PDF d'origine de la banque, non scanné. |
| Écart détecté (bandeau rouge) | Extraction incomplète ou erronée. N'exploitez pas le résultat ; transmettez le relevé au support. |
| Taux de rapprochement très bas | Souvent une inversion Débit/Crédit à l'export du grand livre (voir l'alerte de sens), ou une période / un compte qui ne correspondent pas au relevé. |
| « Colonnes date ou libellé introuvables » | Le grand livre ne contient pas les colonnes attendues. Renommez-les clairement (date, libellé, débit, crédit) et ré-exportez. |

---

## 10. Versions

| Version | Date | Changement |
|---|---|---|
| 1.0 | 17/09/2026 | Première rédaction, reprise du manuel HTML embarqué dans l'application. |
