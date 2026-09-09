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

const LOG_MAX = 300;

const normLog = (id, d) => ({
  id,
  at: d.at || 0,
  by: d.by || '—',
  kind: d.kind || 'action',
  icon: d.icon || '',
  label: d.label || '',
  scope: d.scope || 'fight',
  ref: d.ref || '',
  before: d.before === undefined ? null : d.before,
  after: d.after === undefined ? null : d.after,
  undone: d.undone || 0,
  undoneBy: d.undoneBy || ''
});

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

  const roomsCol = fs.collection(db, 'rooms');
  const room = fs.doc(db, 'rooms', roomId);
  const fightsCol = fs.collection(room, 'fights');
  const logsCol = fs.collection(room, 'logs');
  const settingsDoc = fs.doc(room, 'meta', 'settings');
  const fightRef = id => fs.doc(fightsCol, id);

  let fights = [], settings = {}, logs = [], rooms = [], ready = 0;
  const push = () => onData({
    fights, settings, logs,
    rooms: rooms.some(r => r.id === roomId)
      ? rooms
      : [{ id: roomId, fights: fights.length, open: fights.filter(f => !f.winner).length, lastSeen: Date.now(), lastBy: '' }, ...rooms]
  });
  const live = pending => onStatus({
    mode: 'cloud',
    label: pending ? 'Enregistrement…' : 'Firebase',
    detail: 'salle « ' + roomId +' » · projet ' + cfg.projectId + ' · session ' + account
  });
  const fail = err => onStatus({ mode: 'error', label: 'Erreur Firebase', detail: (err.code || err.message) + ' — vérifie les règles Firestore' });

  /* Index des salles : un doc par salle, pour que chacun retrouve les carnets
     déjà ouverts. Une salle n'y apparaît qu'à partir de son premier combat. */
  let announced = false;
  const announce = () => {
    if (announced || !fights.length) return;
    announced = true;
    fs.setDoc(room, {
      id: roomId, lastSeen: Date.now(),
      fights: fights.length, open: fights.filter(f => !f.winner).length
    }, { merge: true }).catch(() => {});
  };

  const stopFights = fs.onSnapshot(fs.query(fightsCol, fs.orderBy('createdMs', 'desc')), snap => {
    fights = snap.docs.map(d => normalize(d.id, d.data())).sort(bySeniority);
    ready |= 1; live(snap.metadata.hasPendingWrites); announce(); push();
  }, fail);

  const stopRooms = fs.onSnapshot(fs.query(roomsCol, fs.limit(120)), snap => {
    rooms = snap.docs.map(d => {
      const v = d.data() || {};
      return { id: d.id, fights: v.fights || 0, open: v.open || 0, lastSeen: v.lastSeen || 0, lastBy: v.lastBy || '' };
    }).sort((x, y) => (y.lastSeen || 0) - (x.lastSeen || 0));
    push();
  }, () => { rooms = []; push(); });

  const stopLogs = fs.onSnapshot(fs.query(logsCol, fs.orderBy('at', 'desc'), fs.limit(LOG_MAX)), snap => {
    logs = snap.docs.map(d => normLog(d.id, d.data()));
    push();
  }, () => {});

  const stopSettings = fs.onSnapshot(settingsDoc, snap => {
    settings = snap.exists() ? snap.data() : {};
    ready |= 2; push();
  }, fail);

  return {
    mode: 'cloud', roomId,
    async createFight(a, b) {
      const ref = await fs.addDoc(fightsCol, {
        a, b, winner: null, bets: [], createdMs: Date.now(), createdAt: fs.serverTimestamp()
      });
      return ref.id;
    },
    addBet: (fightId, bet) => fs.updateDoc(fightRef(fightId), { bets: fs.arrayUnion(bet) }),
    removeBet: (fightId, bet) => fs.updateDoc(fightRef(fightId), { bets: fs.arrayRemove(bet) }),
    /* Réécrit le tableau complet : sert aux drapeaux « argent rendu ». */
    updateBets: (fightId, bets) => fs.updateDoc(fightRef(fightId), { bets }),
    setWinner: (fightId, winner, bets) => fs.updateDoc(fightRef(fightId), bets
      ? { winner, settledMs: winner ? Date.now() : 0, bets }
      : { winner, settledMs: winner ? Date.now() : 0 }),
    deleteFight: fightId => fs.deleteDoc(fightRef(fightId)),
    /* Réécrit un combat entier — sert à annuler une action depuis le journal. */
    setFight: (fightId, data) => fs.setDoc(fightRef(fightId), data),
    saveSettings: patch => fs.setDoc(settingsDoc, patch, { merge: true }),
    addLog: entry => fs.setDoc(fs.doc(logsCol, entry.id), entry),
    markLog: (id, patch) => fs.updateDoc(fs.doc(logsCol, id), patch),
    /* L'index des salles est déjà en écoute temps réel : rien à recharger. */
    refreshRooms() { push(); },
    touchRoom: patch => { announced = true; return fs.setDoc(room, { id: roomId, ...patch }, { merge: true }); },
    stop() { stopFights(); stopSettings(); stopLogs(); stopRooms(); }
  };
}

/* ------------------------------------------------- Repli : ce navigateur   */

function localStore({ roomId, onData, onStatus }, degraded) {
  const key = 'amebet:' + roomId;
  const REG = 'amebet:rooms';

  const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };

  /** Salles ouvertes dans ce navigateur — l'équivalent local de l'index Firestore. */
  const roomIndex = () => {
    const reg = readJSON(REG) || {}, out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('amebet:') !== 0 || k === 'amebet:salle' || k === REG) continue;
        const d = readJSON(k);
        if (!d || !Array.isArray(d.fights)) continue;
        const id = k.slice(7), meta = reg[id] || {};
        out.push({
          id, fights: d.fights.length, open: d.fights.filter(f => !f.winner).length,
          lastSeen: meta.lastSeen || 0, lastBy: meta.lastBy || ''
        });
      }
    } catch (e) {}
    return out.sort((x, y) => (y.lastSeen || 0) - (x.lastSeen || 0));
  };
  let data;
  try {
    const raw = localStorage.getItem(key);
    data = raw ? JSON.parse(raw) : null;
  } catch (e) { data = null; }
  if (!data || !Array.isArray(data.fights)) data = { fights: SEED(), settings: {}, logs: [] };
  if (!Array.isArray(data.logs)) data.logs = [];

  const push = () => onData({
    rooms: (idx => idx.some(r => r.id === roomId) ? idx : [{ id: roomId, fights: data.fights.length, open: data.fights.filter(f => !f.winner).length, lastSeen: Date.now(), lastBy: '' }, ...idx])(roomIndex()),
    fights: data.fights.slice().sort(bySeniority),
    settings: data.settings || {},
    logs: data.logs.slice().sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, LOG_MAX).map(l => normLog(l.id, l))
  });
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
      const id = uid('f-');
      data.fights = [{ id, a, b, winner: null, bets: [], createdMs: Date.now() }, ...data.fights];
      persist();
      return id;
    },
    async addBet(fightId, bet) { const f = at(fightId); if (f) { f.bets = [...f.bets, bet]; persist(); } },
    async removeBet(fightId, bet) { const f = at(fightId); if (f) { f.bets = f.bets.filter(b => b.id !== bet.id); persist(); } },
    async updateBets(fightId, bets) { const f = at(fightId); if (f) { f.bets = bets; persist(); } },
    async setWinner(fightId, winner, bets) { const f = at(fightId); if (f) { f.winner = winner; if (bets) f.bets = bets; f.settledMs = winner ? Date.now() : 0; persist(); } },
    async deleteFight(fightId) { data.fights = data.fights.filter(f => f.id !== fightId); persist(); },
    async setFight(fightId, doc) {
      const rest = data.fights.filter(f => f.id !== fightId);
      data.fights = [{ ...doc, id: fightId }, ...rest];
      persist();
    },
    async saveSettings(patch) { data.settings = { ...(data.settings || {}), ...patch }; persist(); },
    async addLog(entry) { data.logs = [entry, ...data.logs].slice(0, LOG_MAX); persist(); },
    refreshRooms() { push(); },
    async touchRoom(patch) {
      const reg = readJSON(REG) || {};
      reg[roomId] = { ...(reg[roomId] || {}), ...patch };
      try { localStorage.setItem(REG, JSON.stringify(reg)); } catch (e) {}
      push();
    },
    async markLog(id, patch) { data.logs = data.logs.map(l => l.id === id ? { ...l, ...patch } : l); persist(); },
    stop() { window.removeEventListener('storage', onExternal); }
  };
}
