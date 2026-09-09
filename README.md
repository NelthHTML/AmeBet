# AmeBet

Carnet de paris sur combats : on ouvre un combat, on enregistre les mises au nom
de chaque parieur, on valide le vainqueur, et le carnet répartit le pot et la part
de chaque organisateur. Interface en français, thème Nocturne.

- **Carnet** — combats en cours, saisie des paris, aperçu du gain avant validation.
- **Historique** — trois outils sur une page : recherche par parieur (tous ses paris + ce qu’il te reste à lui rendre), historique global, et journal par jour. Chaque gagnant se coche « rendu » quand l’argent est remis ; les cases se cumulent par combat ou par journée.
- **Bilan** — net par parieur, et prises encaissées par organisateur.
- **Journal** — qui a fait quoi : chaque écriture est signée du nom de l’organisateur, filtrable par personne ou par mot-clé, et **annulable** (l’état d’avant l’action est rétabli).
- **Tournoi** — un tableau à élimination directe ou en toutes rondes : on ajoute autant de participants qu’on veut, les paris portent **uniquement sur le grand gagnant**, et le tableau se recalcule dès qu’un vainqueur est saisi ou corrigé. À la fin, **Clôturer** archive le tournoi (vainqueur, mises, participants).
- **Forfaits** — billetterie de l’arène, indépendante des paris : les forfaits proposés (créés et retarifés à tout moment) et la liste des spectateurs. En fin de soirée, **Clôturer la séance** demande à quel jour de combat elle a eu lieu, archive la liste (noms, forfaits et prix figés) et remet le compteur à zéro pour la suivante.

## Comment ça marche

| | |
|---|---|
| Cotes | *Partage du pot* — cote = pot net / mises du camp — ou *cote fixe 2,00*, part déduite du gain |
| Part organisateur | **Un seul taux par salle**, partagé : il vit dans Firestore, donc si tu le mets à 20 % tout le monde l’a à 20 %. Détaché du pot dès la prise du pari — c’est le bénéfice, il ne repart pas aux gagnants |
| Argent rendu | Chaque pari gagnant porte un drapeau `paidMs` : coché dans l’historique, il est visible par tous les organisateurs de la salle |
| Bénéfice cumulé | Coche des combats ou des journées : la barre de sélection additionne mises, payé, bénéfice et reste à rendre |
| Organisateur | Le champ démarre sur `x` : tant qu’il n’est pas renseigné le carnet est en **lecture seule** et toute action répond « Merci d’entrer votre nom d’organisateur ». Chaque pari, part et paiement est signé de ce nom |
| Salles | Le bouton 🚪 à côté du champ *Salle* liste les salles existantes (combats, combats ouverts, dernier passage) pour ne pas se perdre entre carnets. En mode Firebase la liste est temps réel et commune à tout le monde ; en local elle ne montre que ce navigateur |
| Salle | Un carnet partagé, identifié par `?salle=nom` — plusieurs organisateurs sur le même carnet en temps réel |

## Deux modes de stockage

AmeBet démarre en **mode local** (localStorage, données dans le navigateur) tant que
`firebase-config.js` contient les placeholders. Dès qu’une vraie config y est,
il bascule en **mode Firebase** : Firestore en temps réel, connexion anonyme.
Le bandeau et la pastille en haut de page indiquent le mode actif.

## Brancher Firebase

1. Crée un projet sur [console.firebase.google.com](https://console.firebase.google.com).
2. **Firestore Database** → créer la base (mode production).
3. **Authentication** → *Sign-in method* → activer **Anonyme**.
4. **Paramètres du projet** → *Tes applications* → **Web** → copie l’objet `firebaseConfig`.
5. Colle-le dans `firebase-config.js` :

```js
window.__AMEBET_FIREBASE__ = {
  apiKey: "AIza…",
  authDomain: "amebet.firebaseapp.com",
  projectId: "amebet",
  storageBucket: "amebet.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
```

6. Publie les règles : `firebase deploy --only firestore:rules`
   (ou copie `firestore.rules` dans la console).

> La config web Firebase **n’est pas un secret** — elle est publique par conception.
> La sécurité vient des règles Firestore, pas de la clé.

### Données

```
rooms/{salle}                     index des salles, pour le sélecteur
  id, lastSeen, lastBy, fights, open

rooms/{salle}/fights/{combatId}
  a, b            noms des combattants
  winner          'a' | 'b' | null
  createdMs       tri du carnet
  settledMs       horodatage de la validation
  bets[]          { id, name, amount, side, by, rate, at,
                    paidMs, paidBy }   argent rendu au parieur (0 = pas encore)

rooms/{salle}/logs/{actionId}      journal en ajout seul, 300 dernières actions
  at, by          horodatage et nom de l’organisateur
  kind, label     type d’action et libellé lisible
  scope, ref      'fight' + id du combat, ou 'settings'
  before, after   état d’avant / d’après — « Annuler » réécrit `before`
  undone, undoneBy

rooms/{salle}/meta/settings
  mode            'pot' | 'fixe'
  fee             part de l’organisateur en %, partagée par toute la salle
  sessions[]      séances de billetterie archivées (60 dernières)
                  dayKey, dayMs, closedMs, by, total, rows[]
  plans[]         { id, name, price, perk }            forfaits de l’arène
  spectators[]    { id, name, planId, note, by, at }   billetterie, hors paris
  tournament      tournoi en cours, ou null
                  id, name, format ('elim' | 'poule'), size, createdMs, by,
                  entrants[] { id, name, seed },
                  results   { matchId: entrantId }  vainqueurs saisis,
                  bets[]    { id, name, amount, pick, by, rate, at, paidMs, paidBy },
                  champion
  tournaments[]   tournois archivés (40 derniers)
                  name, format, champion, createdMs, closedMs, by, entrants[], bets[]
```

Le tournoi vit dans `meta/settings`, comme les autres réglages de salle : il est
donc partagé en temps réel, journalisé et **annulable** depuis le journal, sans
collection ni index supplémentaire. Le tableau n’est jamais stocké : il est
recalculé à chaque rendu depuis `results`, donc corriger un vainqueur reprend
tout seul les tours suivants.

Les paris sont écrits en `arrayUnion` / `arrayRemove` : deux organisateurs peuvent
saisir en même temps sans s’écraser. Cocher « rendu » réécrit le tableau `bets`
du combat concerné (`updateBets`), puisque le drapeau vit sur le pari lui-même.

### Ce que chaque action écrit

| Action | Écriture Firestore |
|---|---|
| Ouvrir un combat | `addDoc` dans `fights` + ligne de journal + `rooms/{salle}` remis à jour |
| Ajouter / retirer un pari | `arrayUnion` / `arrayRemove` sur `bets` + journal |
| Valider un vainqueur | `winner`, `settledMs` et taux figés sur chaque pari + journal |
| Cocher « rendu » | `paidMs` / `paidBy` sur le pari, via `updateBets` + journal |
| Part, cotes, forfaits, spectateurs, tournoi | `meta/settings` en *merge*, groupé toutes les 0,5 s + journal |
| Clôturer une séance | `sessions` + `spectators: []` dans le même *merge* — donc annulable d’un seul geste depuis le journal |
| Annuler depuis le journal | réécrit l’état d’avant (`setFight` ou `saveSettings`) et marque la ligne `undone` |

Les quatre écoutes temps réel (`fights`, `logs`, `meta/settings`, `rooms`) sont
posées à la connexion et coupées au changement de salle. Aucune requête composite :
tout tient sur les index automatiques de Firestore.

## Déployer

### GitHub Pages (automatique)

```bash
git init && git add . && git commit -m "AmeBet"
git remote add origin git@github.com:<toi>/amebet.git
git push -u origin main
```

Puis, sur GitHub :

1. **Settings → Pages → Source : GitHub Actions**.
2. **Settings → Secrets and variables → Actions → New repository secret**
   `FIREBASE_CONFIG` = l’objet de config **en JSON** (clés entre guillemets) :
   `{"apiKey":"AIza…","authDomain":"…","projectId":"…","storageBucket":"…","messagingSenderId":"…","appId":"…"}`
3. Chaque push sur `main` régénère `firebase-config.js` **et `.firebaserc`** depuis le
   secret, puis publie.
4. Dans Firebase → **Authentication → Settings → Domaines autorisés**, ajoute
   `<toi>.github.io`.

Le fichier `.nojekyll` est indispensable : sans lui, GitHub Pages ignore `_ds/`
(le design system) parce que le dossier commence par un underscore.

### Firebase Hosting (alternative)

En local :

```bash
npm i -g firebase-tools
firebase login
# renseigne ton projet dans .firebaserc (ou laisse scripts/write-config.mjs le faire)
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

En CI, le workflow `.github/workflows/firebase.yml` fait la même chose à chaque
push sur `main`. Deux secrets à créer :

| Secret | Contenu |
|---|---|
| `FIREBASE_CONFIG` | la config web en JSON — sert aussi à écrire `.firebaserc` |
| `FIREBASE_SERVICE_ACCOUNT` | le JSON d’un compte de service (Console → Paramètres → *Comptes de service* → **Générer une nouvelle clé privée**) |

Sans `FIREBASE_SERVICE_ACCOUNT`, le workflow se termine sans rien publier — les
deux déploiements (Pages et Hosting) peuvent donc cohabiter sans se gêner.
Pense à ajouter `<projet>.web.app` dans **Authentication → Settings → Domaines
autorisés**.

## Fichiers

```
index.html          redirection vers le carnet
AmeBet.dc.html      l’application
amebet-store.js     couche de données — Firestore ou repli localStorage
firebase-config.js  config web (placeholders par défaut)
firebase.json       hosting + pointeurs règles/index
.firebaserc         projet Firebase par défaut (réécrit en CI)
firestore.rules     règles d’accès
firestore.indexes.json  aucun index composite — volontairement vide
support.js          runtime de rendu
_ds/                design system Nocturne
scripts/            génération de la config en CI
.github/workflows/  deploy.yml (GitHub Pages) · firebase.yml (Hosting + règles)
archive/            versions précédentes du carnet
```
