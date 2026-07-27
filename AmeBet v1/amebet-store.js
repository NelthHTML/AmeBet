/* AmeBet — couche de données.
   Deux modes, même API : Firestore (temps réel, multi-organisateurs) si
   firebase-config.js est rempli, sinon localStorage (démo hors ligne).   */

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

const isPlaceholder = v => !v || /^(VOTRE_|YOUR_|TODO|xxx|__)/i.test(String(v));

export function firebaseConfig() {
  const c = (typeof window !== 'undefined' && window.__AMEBET_FIREBASE__) || null;
  if (!c) return null;
  if (isPlaceholder(c.apiKey) || isPlaceholder(c.projectId)) return null;
  return c;
}

const uid = p => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

const SEED = () => {
  const d = Date.now();
  return [
    { id: 'seed-1', a: 'Kaen Rikudō', b: 'Suiga Mizuhara', winner: null, createdMs: d - 36e5, bets: [
      { id: 'sb1', name: 'Ayame', amount: 20000, side: 'a', by: 'Shin', rate: 5, at: d - 35e5 },
      { id: 'sb2', name: 'Genma', amount: 32000, side: 'b', by: 'Rin', rate: 8, at: d - 34e5 },
      { id: 'sb3', name: 'Rurika', amount: 15000, side: 'a', by: 'Shin', rate: 5, at: d - 33e5 },
      { id: 'sb4', name: 'Mokuren', amount: 8000, side: 'a', by: 'Rin', rate: 8, at: d - 32e5 }
    ] },
    { id: 'seed-2', a: 'Tsurara Yukimura', b: 'Gyōdō Kurotsuki', winner: null, createdMs: d - 72e5, bets: [
      { id: 'sb5', name: 'Genma', amount: 25000, side: 'a', by: 'Shin', rate: 5, at: d - 71e5 }
    ] },
    { id: 'seed-0', a: 'Ibuki Nagare', b: 'Kōsuke Tanma', winner: 'a', createdMs: d - 30 * 36e5, bets: [
      { id: 'sb6', name: 'Ayame', amount: 30000, side: 'a', by: 'Shin', rate: 5, at: d - 30 * 36e5 },
      { id: 'sb7', name: 'Rurika', amount: 20000, side: 'b', by: 'Shin', rate: 5, at: d - 30 * 36e5 },
      { id: 'sb8', name: 'Mokuren', amount: 10000, side: 'b', by: 'Rin', rate: 8, at: d - 30 * 36e5 }
    ] }
  ];
};

const normalize = (id, d) => ({
  id,
  a: d.a || '', b: d.b || '',
  winner: d.winner || null,
  createdMs: d.createdMs || 0,
  settledMs: d.settledMs || 0,
  bets: Array.isArray(d.bets) ? d.bets : []
});

const bySeniority = (x, y) => (y.createdMs || 0) - (x.createdMs || 0);

export async function createStore(opts) {
  const cfg = firebaseConfig();
  if (!cfg) {
    opts.onStatus({ mode: 'local', label: 'Local', detail: 'firebase-config.js non rempli — données dans ce navigateur' });
    return localStore(opts);
  }
  try {
    return await cloudStore(cfg, opts);
  } catch (err) {
    opts.onStatus({ mode: 'error', label: 'Firebase injoignable', detail: String(err && (err.code || err.message) || err) });
    return localStore(opts, true);
  }
}

/* ---------------------------------------------------------------- Firestore */

async function cloudStore(cfg, { roomId, onData, onStatus }) {
  const [app, auth, fs] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js')
  ]);

  const instance = app.getApps().length ? app.getApps()[0] : app.initializeApp(cfg);
  const db = fs.getFirestore(instance);

  let account = 'anonyme';
  try {
    const a = auth.getAuth(instance);
    const cred = a.currentUser ? { user: a.currentUser } : await auth.signInAnonymously(a);
    account = (cred.user && cred.user.uid || '').slice(0, 6);
  } catch (e) {
    /* connexion anonyme désactivée dans la console : on continue,
       les règles Firestore décideront. */
  }

  const room = fs.doc(db, 'rooms', roomId);
  const fightsCol = fs.collection(room, 'fights');
  const settingsDoc = fs.doc(room, 'meta', 'settings');
  const fightRef = id => fs.doc(fightsCol, id);

  let fights = [], settings = {}, ready = 0;
  const push = () => onData({ fights, settings });
  const live = pending => onStatus({
    mode: 'cloud',
    label: pending ? 'Enregistrement…' : 'Firebase',
    detail: 'salle « ' + roomId +' » · projet ' + cfg.projectId + ' · session ' + account
  });
  const fail = err => onStatus({ mode: 'error', label: 'Erreur Firebase', detail: (err.code || err.message) + ' — vérifie les règles Firestore' });

  const stopFights = fs.onSnapshot(fs.query(fightsCol, fs.orderBy('createdMs', 'desc')), snap => {
    fights = snap.docs.map(d => normalize(d.id, d.data())).sort(bySeniority);
    ready |= 1; live(snap.metadata.hasPendingWrites); push();
  }, fail);

  const stopSettings = fs.onSnapshot(settingsDoc, snap => {
    settings = snap.exists() ? snap.data() : {};
    ready |= 2; push();
  }, fail);

  return {
    mode: 'cloud', roomId,
    createFight: (a, b) => fs.addDoc(fightsCol, {
      a, b, winner: null, bets: [], createdMs: Date.now(), createdAt: fs.serverTimestamp()
    }),
    addBet: (fightId, bet) => fs.updateDoc(fightRef(fightId), { bets: fs.arrayUnion(bet) }),
    removeBet: (fightId, bet) => fs.updateDoc(fightRef(fightId), { bets: fs.arrayRemove(bet) }),
    setWinner: (fightId, winner, bets) => fs.updateDoc(fightRef(fightId), bets
      ? { winner, settledMs: winner ? Date.now() : 0, bets }
      : { winner, settledMs: winner ? Date.now() : 0 }),
    deleteFight: fightId => fs.deleteDoc(fightRef(fightId)),
    saveSettings: patch => fs.setDoc(settingsDoc, patch, { merge: true }),
    stop() { stopFights(); stopSettings(); }
  };
}

/* ------------------------------------------------- Repli : ce navigateur   */

function localStore({ roomId, onData, onStatus }, degraded) {
  const key = 'amebet:' + roomId;
  let data;
  try {
    const raw = localStorage.getItem(key);
    data = raw ? JSON.parse(raw) : null;
  } catch (e) { data = null; }
  if (!data || !Array.isArray(data.fights)) data = { fights: SEED(), settings: {} };

  const push = () => onData({ fights: data.fights.slice().sort(bySeniority), settings: data.settings || {} });
  const persist = () => {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
    push();
  };
  const at = id => data.fights.find(f => f.id === id);

  const onExternal = e => {
    if (e.key !== key || !e.newValue) return;
    try { data = JSON.parse(e.newValue); push(); } catch (err) {}
  };
  window.addEventListener('storage', onExternal);

  if (!degraded) setTimeout(() => onStatus({ mode: 'local', label: 'Local', detail: 'salle « ' + roomId + ' » — données dans ce navigateur' }), 0);
  setTimeout(push, 0);

  return {
    mode: 'local', roomId,
    async createFight(a, b) {
      data.fights = [{ id: uid('f-'), a, b, winner: null, bets: [], createdMs: Date.now() }, ...data.fights];
      persist();
    },
    async addBet(fightId, bet) { const f = at(fightId); if (f) { f.bets = [...f.bets, bet]; persist(); } },
    async removeBet(fightId, bet) { const f = at(fightId); if (f) { f.bets = f.bets.filter(b => b.id !== bet.id); persist(); } },
    async setWinner(fightId, winner, bets) { const f = at(fightId); if (f) { f.winner = winner; if (bets) f.bets = bets; f.settledMs = winner ? Date.now() : 0; persist(); } },
    async deleteFight(fightId) { data.fights = data.fights.filter(f => f.id !== fightId); persist(); },
    async saveSettings(patch) { data.settings = { ...(data.settings || {}), ...patch }; persist(); },
    stop() { window.removeEventListener('storage', onExternal); }
  };
}
