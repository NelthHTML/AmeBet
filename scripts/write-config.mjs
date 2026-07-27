/* Réécrit firebase-config.js à partir du secret FIREBASE_CONFIG (JSON).
   Sans secret, le placeholder est conservé et AmeBet démarre en mode local. */
import { writeFileSync } from 'node:fs';

const raw = process.env.FIREBASE_CONFIG;
if (!raw || !raw.trim()) {
  console.log('FIREBASE_CONFIG absent — firebase-config.js laissé tel quel (mode local).');
  process.exit(0);
}

let cfg;
try { cfg = JSON.parse(raw); }
catch (e) { console.error('FIREBASE_CONFIG n’est pas du JSON valide :', e.message); process.exit(1); }

for (const k of ['apiKey', 'projectId', 'appId']) {
  if (!cfg[k]) { console.error('Clé manquante dans FIREBASE_CONFIG : ' + k); process.exit(1); }
}

writeFileSync('firebase-config.js',
  '/* Généré par scripts/write-config.mjs — ne pas éditer à la main. */\n' +
  'window.__AMEBET_FIREBASE__ = ' + JSON.stringify(cfg, null, 2) + ';\n');

console.log('firebase-config.js écrit pour le projet ' + cfg.projectId);
