/* Config web Firebase — remplace les valeurs ci-dessous par celles de
   ta console (Paramètres du projet → Tes applications → Application Web).

   Ces clés ne sont PAS des secrets : la config web Firebase est publique
   par conception, la sécurité vient des règles Firestore (firestore.rules).

   Tant que apiKey/projectId restent des placeholders, AmeBet tourne en
   mode local (localStorage) sans jamais contacter le réseau.

   En CI, ce fichier est réécrit à partir du secret FIREBASE_CONFIG
   (voir scripts/write-config.mjs et .github/workflows/deploy.yml). */

window.__AMEBET_FIREBASE__ = {
  apiKey: "VOTRE_API_KEY",
  authDomain: "VOTRE_PROJECT_ID.firebaseapp.com",
  projectId: "VOTRE_PROJECT_ID",
  storageBucket: "VOTRE_PROJECT_ID.appspot.com",
  messagingSenderId: "VOTRE_SENDER_ID",
  appId: "VOTRE_APP_ID"
};
