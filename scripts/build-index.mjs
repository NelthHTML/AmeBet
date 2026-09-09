/* Fait de la page d'accueil l'application elle-même.

   Sans ça, ouvrir https://<toi>.github.io/AmeBet/ affiche la page de
   redirection et l'URL finit par « /AmeBet.dc.html » (et la redirection
   perd le ?salle=… au passage). En copiant le carnet dans index.html,
   l'URL reste propre : https://<toi>.github.io/AmeBet/?salle=principale

   Le fichier source AmeBet.dc.html reste publié à côté : les anciens
   liens continuent de marcher. */
import { copyFileSync, existsSync } from 'node:fs';

const src = 'AmeBet.dc.html';
if (!existsSync(src)) { console.error('Introuvable : ' + src); process.exit(1); }

copyFileSync(src, 'index.html');
console.log(src + ' → index.html (URL racine propre)');
