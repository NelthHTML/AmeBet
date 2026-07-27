/* Réécrit firebase-config.js à partir de la variable d'environnement
   FIREBASE_CONFIG (secret GitHub). Utile si tu préfères ne pas versionner
   ta config — sinon, laisse le fichier commité et ce script ne tourne pas.

   Usage :  FIREBASE_CONFIG='{"apiKey":"...", ...}' node scripts/write-config.mjs
*/

import { writeFileSync } from 'node:fs';

const raw = process.env.FIREBASE_CONFIG;

if (!raw || !raw.trim()) {
  console.log('FIREBASE_CONFIG absent — on garde le firebase-config.js du dépôt.');
  process.exit(0);
}

let config;
try {
  config = JSON.parse(raw);
} catch (err) {
  console.error('FIREBASE_CONFIG n\'est pas du JSON valide :', err.message);
  console.error('Attendu : {"apiKey":"...","authDomain":"...","projectId":"...",');
  console.error('           "storageBucket":"...","messagingSenderId":"...","appId":"..."}');
  process.exit(1);
}

const required = ['apiKey', 'projectId', 'appId'];
const missing = required.filter((k) => !config[k]);
if (missing.length) {
  console.error('Clés manquantes dans FIREBASE_CONFIG :', missing.join(', '));
  process.exit(1);
}

// Valeurs déductibles : évite d'avoir à toutes les coller dans le secret.
config.authDomain ??= `${config.projectId}.firebaseapp.com`;
config.storageBucket ??= `${config.projectId}.appspot.com`;

const body = `/* Généré au déploiement depuis le secret FIREBASE_CONFIG.
   Ne pas éditer à la main : toute modification sera écrasée au prochain build.
   Pour travailler en local, édite firebase-config.js dans le dépôt. */

window.__AMEBET_FIREBASE__ = ${JSON.stringify(config, null, 2)};
`;

writeFileSync('firebase-config.js', body, 'utf8');
console.log(`firebase-config.js écrit pour le projet « ${config.projectId} ».`);
