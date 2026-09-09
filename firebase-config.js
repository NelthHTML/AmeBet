/* Config web Firebase — projet « amebet ».

   Ces clés ne sont PAS des secrets : la config web Firebase est publique
   par conception, la sécurité vient des règles Firestore (firestore.rules).

   En CI, ce fichier est réécrit à partir du secret FIREBASE_CONFIG
   (voir scripts/write-config.mjs et .github/workflows/deploy.yml). */

window.__AMEBET_FIREBASE__ = {
  apiKey: "AIzaSyBDCJ7ROZFqtvfCTmkFMOA-JC5mhysD3WM",
  authDomain: "amebet.firebaseapp.com",
  projectId: "amebet",
  storageBucket: "amebet.firebasestorage.app",
  messagingSenderId: "304028065302",
  appId: "1:304028065302:web:f13cf98729c364b142df37",
  measurementId: "G-CKJQRKRSWP"
};
