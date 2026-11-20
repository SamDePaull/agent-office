// Renderer kantor: menggerakkan karakter mengikuti snapshot dari server (SSE).
// Server memutuskan RUANGAN tiap karakter; di sini kursi, jalur, animasi, efek, dan notifikasi.
import { DEFAULT_COORDS, MAP_H, MAP_W, ROOM_LABELS, drawPlaceholderOffice } from './office-default.js';
import { createCustomPanel } from './custom.js';
import { createInbox } from './inbox.js';
import { placeholderPose } from './sprites.js';
import { createPet, updatePet } from './pet-view.js';
import { createPetCards } from './pet-cards.js';

const $ = (id) => document.getElementById(id);
// Ruang istirahat: lounge & pantry, plus briefing & meeting selama tidak dipakai bekerja.
const REST_ROOMS = ['lounge', 'pantry', 'briefing', 'meeting'];
const GLOW = { workspace: '#60a5fa', command: '#38bdf8', server: '#4ade80', meeting: '#f0b44c', briefing: '#f0b44c', approval: '#f0b44c' };
const BUBBLE_MS = 15_000;
const GOODBYE_MS = 2_400;
const SETTLE_AFTER_MS = 5 * 60_000;
const STALE_MS = 15 * 60_000;
const STATUS_LABEL = { working: 'bekerja', waiting: 'menunggu Anda', idle: 'idle', completed: 'selesai', resting: 'istirahat', offline: 'offline' };

let cfg;
let coords;
let points = {}; // id → {x, y} untuk pintu & simpul
let adj = {}; // id → [id]
let roomDoor = {}; // room → id pintu
const chars = new Map(); // key → runtime karakter
const seatOwner = new Map(); // indeks kursi → key
let lastSnap = null;
let demo = null;
let detailKey = null;
let primed = false; // snapshot pertama tidak memicu notifikasi
// Panel Kustom; memanggil loadConfig() setelah menyimpan supaya tab ini langsung ikut berubah.
const custom = createCustomPanel({ reload: () => loadConfig(), portraitSrc: (d, s) => portraitSrc(d, s) });

// Sesi yang dipilih di panel Sesi: kantor, roster, dan aktivitas hanya menampilkan sesi itu.
let selectedSid = null;
const inbox = createInbox({
  getSelected: () => selectedSid,
  onSelect(sid) {
    selectedSid = sid;
    if (lastSnap && !demo) apply(lastSnap);
  },
  notify: () => {}, // notifikasi sistem sudah dipicu checkAlerts saat status berubah jadi "menunggu"
});

function viewOf(snap) {
  if (!selectedSid || !snap.sessions?.some((s) => s.sid === selectedSid)) {
    selectedSid = null;
    return snap;
  }
  return {
    ...snap,
    chars: snap.chars.filter((c) => !c.sid || c.sid === selectedSid),
    ticker: (snap.ticker ?? []).filter((t) => t.sid === selectedSid),
  };
}

// ---------- utilitas ----------

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s} dtk`;
  if (s < 3600) return `${Math.round(s / 60)} mnt`;
  return `${Math.round(s / 3600)} jam`;
}
function dur(ms) {
  const m = Math.round(ms / 60_000);
  if (m < 1) return '<1 mnt';
  return m < 60 ? `${m} mnt` : `${Math.floor(m / 60)}j ${m % 60}m`;
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (n) => Number(n || 0).toLocaleString('id-ID');
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`agent-office:${k}`);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`agent-office:${k}`, JSON.stringify(v));
    } catch {
      /* penyimpanan diblokir: abaikan */
    }
  },
};

// ---------- peta & graf jalan ----------

function buildGraph() {
  points = {};
  adj = {};
  roomDoor = {};
  for (const d of coords.doors) {
    points[d.id] = { x: d.x, y: d.y };
    roomDoor[d.room] ??= d.id;
  }
  for (const n of coords.nodes) points[n.id] = { x: n.x, y: n.y };
  for (const [a, b] of coords.edges) {
    (adj[a] ??= []).push(b);
    (adj[b] ??= []).push(a);
  }
}

function bfs(from, to) {
  if (from === to) return [from];
  const prev = { [from]: null };
  const q = [from];
  while (q.length) {
    const cur = q.shift();
    for (const nx of adj[cur] ?? []) {
      if (nx in prev) continue;
      prev[nx] = cur;
      if (nx === to) {
        const path = [to];
        let p = cur;
        while (p !== null) {
          path.unshift(p);
          p = prev[p];
        }
        return path;
      }
      q.push(nx);
    }
  }
  return null;
}

function pathBetween(fromRoom, toRoom, toPos) {
  if (!fromRoom || fromRoom === toRoom) return [toPos];
  const a = roomDoor[fromRoom];
  const b = roomDoor[toRoom];
  const ids = a && b ? bfs(a, b) : null;
  if (!ids) return [toPos];
  return [...ids.map((id) => points[id]), toPos];
}

// ---------- kursi ----------

function releaseSeat(key) {
  for (const [i, k] of seatOwner) if (k === key) seatOwner.delete(i);
}

function claimSeat(key, room) {
  releaseSeat(key);
  const seats = coords.seats.map((s, i) => ({ ...s, i })).filter((s) => s.room === room);
  // Kursi pertama Command Center milik Lead utama.
  const reserved = room === 'command' ? seats[0]?.i : undefined;
  let pick;
  if (key === 'lead' && reserved !== undefined) pick = seats[0];
  else {
    const free = seats.filter((s) => s.i !== reserved && !seatOwner.has(s.i));
    // Di ruang istirahat pilih kursi acak supaya tidak menumpuk di pojok yang sama.
    pick = REST_ROOMS.includes(room) ? free[Math.floor(Math.random() * free.length)] : free[0];
  }
  if (pick) {
    seatOwner.set(pick.i, key);
    return { x: pick.x, y: pick.y, seat: pick.i };
  }
  // Ruangan penuh: berdiri di titik acak (tetap per karakter) di dalam ruangan.
  const r = coords.rooms[room];
  const h = hash(key + room);
  return { x: r.x + r.w * (0.2 + (h % 60) / 100), y: r.y + r.h * (0.45 + ((h >>> 8) % 40) / 100) };
}

function freeSeats(room) {
  return coords.seats.filter((s, i) => s.room === room && !seatOwner.has(i)).length;
}

/** Ruangan yang sedang dipakai bekerja tidak dijadikan tempat istirahat. */
function busyRooms(exceptKey) {
  const busy = new Set();
  for (const rt of chars.values())
    if (rt.key !== exceptKey && ['working', 'waiting'].includes(rt.data.status)) busy.add(rt.room);
  return busy;
}

function pickRestRoom(rt) {
  const busy = busyRooms(rt.key);
  const options = REST_ROOMS.filter((r) => coords.rooms[r] && !busy.has(r) && freeSeats(r) > 0);
  if (REST_ROOMS.includes(rt.room) && !busy.has(rt.room) && Math.random() < 0.6) return rt.room;
  if (!options.length) return 'lounge';
  // Berbobot jumlah kursi kosong: ruangan yang lengang lebih sering dipilih.
  const weights = options.map((r) => freeSeats(r));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) if ((roll -= weights[i]) <= 0) return options[i];
  return options[0];
}

// ---------- sprite ----------

// ?v= dari manifest supaya gambar yang baru diunggah tidak tertahan cache browser.
const ver = (sprite) => cfg.manifest[sprite]?.v ?? 0;
export function poseSrc(data, pose) {
  if (cfg.manifest?.[data.sprite]) return `/assets/characters/${data.sprite}/${pose}_256.png?v=${ver(data.sprite)}`;
  return placeholderPose(data.sprite, data.colour, pose);
}
export function portraitSrc(data, size = 128) {
  if (cfg.manifest?.[data.sprite]) return `/assets/characters/${data.sprite}/portrait_${size}.png?v=${ver(data.sprite)}`;
  return placeholderPose(data.sprite, data.colour, 'portrait');
}

// ---------- efek ----------

function setGlow(rt, on) {
  if (!rt.glow) {
    rt.glow = document.createElement('div');
    rt.glow.className = 'glow';
    $('fx').append(rt.glow);
  }
  if (on) {
    // Monitor ada di atas titik berdiri (meja di depan karakter).
    rt.glow.style.left = `${rt.x}%`;
    rt.glow.style.top = `${rt.y - 8}%`;
    rt.glow.style.setProperty('--g', `${GLOW[rt.room] ?? '#60a5fa'}aa`);
  }
  rt.glow.classList.toggle('on', on);
}

function buildServerLeds() {
  const r = coords.rooms.server;
  if (!r) return;
  const box = document.createElement('div');
  box.className = 'leds';
  box.id = 'leds';
  Object.assign(box.style, { left: `${r.x + 3}%`, top: `${r.y + 2.5}%`, width: `${r.w - 6}%`, height: `${r.h * 0.45}%` });
  const colours = ['#4ade80', '#60a5fa', '#4ade80', '#f0b44c'];
  for (let i = 0; i < 46; i++) {
    const dot = document.createElement('i');
    dot.style.left = `${(i * 37) % 100}%`;
    dot.style.top = `${(i * 53) % 100}%`;
    dot.style.setProperty('--l', colours[i % colours.length]);
    dot.style.animationDelay = `${((i * 0.137) % 0.9).toFixed(2)}s`;
    box.append(dot);
  }
  $('fx').append(box);
}

const KIT_MS = 20_000; // sama dengan lib/state.mjs
const FAIL_MS = 30_000;

// ---------- karakter ----------

function createChar(data) {
  const el = document.createElement('div');
  el.className = 'char';
  el.style.setProperty('--c', data.colour);
  el.innerHTML = `<div class="body"><img alt=""></div><div class="tag"></div>`;
  el.addEventListener('click', () => openDetail(data.key));
  $('chars').append(el);
  const rt = { key: data.key, el, img: el.querySelector('img'), tag: el.querySelector('.tag'), x: 50, y: 50, room: null, target: null, legs: [], timer: 0, data };
  setPose(rt, 'front', false);
  chars.set(data.key, rt);
  return rt;
}

function setPose(rt, pose, mirror) {
  const src = poseSrc(rt.data, pose);
  if (rt.img.getAttribute('src') !== src) rt.img.src = src;
  rt.el.classList.toggle('mirror', Boolean(mirror));
}

function placeAt(rt, p) {
  rt.el.style.transitionDuration = '0ms';
  rt.el.style.left = `${p.x}%`;
  rt.el.style.top = `${p.y}%`;
  rt.el.style.zIndex = String(Math.round(p.y * 10));
  rt.x = p.x;
  rt.y = p.y;
}

function walk(rt, pts, onDone) {
  clearTimeout(rt.timer);
  rt.legs = pts.slice();
  rt.el.classList.add('moving');
  setGlow(rt, false);
  const step = () => {
    const p = rt.legs.shift();
    if (!p) {
      rt.el.classList.remove('moving', 'walking-out');
      setPose(rt, 'front', false);
      renderChar(rt, Date.now());
      onDone?.();
      return;
    }
    const dxp = ((p.x - rt.x) * MAP_W) / 100;
    const dyp = ((p.y - rt.y) * MAP_H) / 100;
    const dist = Math.hypot(dxp, dyp) / (MAP_W / 100);
    if (dist < 0.05) return step();
    const ms = clamp(dist * 32, 220, 1300);
    if (Math.abs(dxp) > Math.abs(dyp)) setPose(rt, 'side', dxp > 0);
    else setPose(rt, dyp < 0 ? 'back' : 'front', false);
    rt.el.style.transitionDuration = `${ms}ms`;
    rt.el.style.left = `${p.x}%`;
    rt.el.style.top = `${p.y}%`;
    rt.el.style.zIndex = String(Math.round(Math.max(p.y, rt.y) * 10));
    rt.x = p.x;
    rt.y = p.y;
    rt.timer = setTimeout(step, ms);
  };
  step();
}

function go(rt, target, { instant = false, out = false } = {}) {
  const room = target === 'break' ? pickRestRoom(rt) : target;
  const seat = claimSeat(rt.key, room);
  const from = rt.room;
  rt.room = room;
  if (instant || !from) {
    placeAt(rt, seat);
    return;
  }
  if (out) rt.el.classList.add('walking-out');
  walk(rt, pathBetween(from, room, seat));
}

function renderChar(rt, now) {
  const d = rt.data;
  const working = d.status === 'working';
  const toolLine = working
    ? [d.tool, d.detail].filter(Boolean).join(' · ')
    : d.status === 'waiting'
      ? d.waiting === 'question'
        ? 'bertanya kepada Anda'
        : 'menunggu izin'
      : d.status === 'completed'
        ? 'selesai'
        : '';
  const html = `${esc(d.name)}${toolLine ? `<span class="tool">${esc(toolLine)}</span>` : ''}`;
  if (rt.tagHtml !== html) {
    rt.tag.innerHTML = html;
    rt.tagHtml = html;
  }
  const resting = ['resting', 'completed'].includes(d.status) && rt.target === 'break';
  rt.el.classList.toggle('quiet', resting && !(rt.goodbyeUntil > now));
  rt.el.querySelector('.badge')?.remove();
  rt.el.querySelector('.coffee')?.remove();
  rt.el.querySelector('.age')?.remove();
  const failing = d.fail && now - d.fail.ts < FAIL_MS ? d.fail : null;
  if (failing) rt.el.insertAdjacentHTML('beforeend', '<div class="badge fail">⚠</div>');
  else if (d.badge) rt.el.insertAdjacentHTML('beforeend', `<div class="badge">${esc(d.badge)}</div>`);
  else if (resting && !rt.el.classList.contains('moving')) rt.el.insertAdjacentHTML('beforeend', '<div class="coffee">☕</div>');
  const stale = working && d.heartbeat && now - d.heartbeat > STALE_MS;
  rt.el.classList.toggle('stale', Boolean(stale));
  if (stale) rt.el.insertAdjacentHTML('beforeend', `<div class="age">${ago(d.heartbeat)}</div>`);

  // Meja menyala selama karakter bekerja di tempatnya.
  setGlow(rt, working && !rt.el.classList.contains('moving') && rt.room !== 'approval' && !REST_ROOMS.slice(0, 2).includes(rt.room));

  const showSay = d.say && (rt.goodbyeUntil > now || now - d.sayTs < BUBBLE_MS);
  let bubble = rt.el.querySelector('.bubble');
  if (showSay) {
    const text = d.say.length > 140 ? d.say.slice(0, 139) + '…' : d.say;
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'bubble';
      rt.el.append(bubble);
    }
    // Dekat tepi peta: rata ke sisi dalam supaya tidak terpotong.
    bubble.classList.toggle('edge-l', rt.x < 18);
    bubble.classList.toggle('edge-r', rt.x > 82);
    if (bubble.textContent !== text) bubble.textContent = text;
  } else bubble?.remove();

  // Papan nama skill / MCP yang sedang dipakai (±20 dtk); klik → buka di Katalog.
  // Papan error didahulukan; papan skill/MCP hanya kalau tidak ada gelembung ucapan.
  const kit = failing ? { kind: 'fail', name: [failing.tool || 'jawaban', failing.detail].filter(Boolean).join(': ') } : !showSay && d.kit && now - d.kit.ts < KIT_MS ? d.kit : null;
  let plate = rt.el.querySelector('.kit');
  if (kit) {
    const label = `${kit.kind === 'fail' ? '⚠' : kit.kind === 'mcp' ? '🔌' : '📚'} ${kit.name}`;
    if (!plate) {
      plate = document.createElement('button');
      plate.className = 'kit';
      plate.addEventListener('click', (e) => {
        e.stopPropagation();
        if (plate.classList.contains('fail')) return openDetail(rt.key);
        window.open(`/catalog.html?q=${encodeURIComponent(plate.dataset.q)}`, '_blank', 'noopener');
      });
      rt.el.append(plate);
    }
    plate.classList.toggle('fail', kit.kind === 'fail');
    plate.dataset.q = kit.name.split(':').pop();
    plate.title = kit.kind === 'fail' ? `${failing.text || 'Gagal'} — klik untuk detail` : `${kit.kind === 'mcp' ? 'MCP' : 'Skill'} ${kit.name} — buka di Katalog`;
    plate.classList.toggle('edge-l', rt.x < 18);
    plate.classList.toggle('edge-r', rt.x > 82);
    if (plate.textContent !== label) plate.textContent = label;
  } else plate?.remove();
}

// ---------- notifikasi ----------

const prefs = { perm: store.get('nPerm', true), done: store.get('nDone', false), fail: store.get('nFail', true), sound: store.get('nSound', true) };
let audio = null;

function chime(kind) {
  if (!prefs.sound) return;
  try {
    audio ??= new AudioContext();
    const notes = kind === 'done' ? [660, 880] : kind === 'fail' ? [440, 330] : [880, 660, 880];
    notes.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t = audio.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.14);
    });
  } catch {
    /* audio tidak tersedia */
  }
}

function notify(kind, title, body, key) {
  if ((kind === 'perm' && !prefs.perm) || (kind === 'done' && !prefs.done) || (kind === 'fail' && !prefs.fail)) return;
  chime(kind);
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: `agent-office-${kind}-${key}`, silent: true });
    // Notifikasi tanpa pilihan (selesai/gagal) ditutup sendiri; izin tetap sampai diklik.
    if (kind !== 'perm') setTimeout(() => n.close(), 8000);
    n.onclick = () => {
      window.focus();
      openDetail(key);
      n.close();
    };
  } catch {
    /* sebagian webview (mis. Simple Browser VS Code) tidak mendukung Notification */
  }
}

function notifyHint() {
  const hint = $('nHint');
  if (!('Notification' in window)) hint.textContent = 'Notifikasi sistem tidak didukung di sini; hanya bunyi dan judul tab.';
  else if (Notification.permission === 'denied') hint.textContent = 'Notifikasi diblokir browser. Izinkan lewat ikon gembok di bilah alamat.';
  else if (Notification.permission === 'default') hint.textContent = 'Browser akan meminta izin saat Anda menyalakan salah satu pilihan.';
  else hint.textContent = 'Notifikasi sistem aktif.';
  $('bell').classList.toggle('on', prefs.perm || prefs.done || prefs.fail);
}

async function askPermission() {
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  notifyHint();
}

$('bell').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('notifyMenu');
  if (!menu.hidden) inbox.markRead(); // menutup riwayat = sudah dibaca
  menu.hidden = !menu.hidden;
  $('bell').setAttribute('aria-expanded', String(!menu.hidden));
  audio ??= new AudioContext(); // klik pertama membuka kunci audio browser
  notifyHint();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('.notify-wrap') || $('notifyMenu').hidden) return;
  $('notifyMenu').hidden = true;
  inbox.markRead();
});
for (const [id, key] of [
  ['nPerm', 'perm'],
  ['nDone', 'done'],
  ['nFail', 'fail'],
  ['nSound', 'sound'],
]) {
  $(id).checked = prefs[key];
  $(id).addEventListener('change', (e) => {
    prefs[key] = e.target.checked;
    store.set(id, prefs[key]);
    if (e.target.checked && key !== 'sound') askPermission();
    notifyHint();
  });
}
$('nTest').addEventListener('click', async () => {
  await askPermission();
  const saved = { ...prefs };
  Object.assign(prefs, { perm: true });
  notify('perm', 'Agent Office', 'Contoh: Jensen butuh izin di my-app', 'lead');
  Object.assign(prefs, saved);
});

function checkAlerts(prev, data) {
  if (!primed || demo || !prev) return;
  if (data.status === 'waiting' && prev.status !== 'waiting') {
    const what = data.waiting === 'question' ? 'bertanya kepada Anda' : 'butuh izin';
    notify('perm', `${data.name} ${what}`, `${data.project || 'Claude Code'}${data.tool ? ` · ${data.tool}` : ''}`, data.key);
  }
  if (data.key.startsWith('lead') && prev.status === 'working' && data.status === 'idle') {
    notify('done', `${data.name} selesai menjawab`, data.project || 'Claude Code', data.key);
  }
}

// ---------- panel detail ----------

function openDetail(key) {
  detailKey = key;
  $('detail').hidden = false;
  renderDetail();
  $('dClose').focus();
}
function closeDetail() {
  detailKey = null;
  $('detail').hidden = true;
}
$('dClose').addEventListener('click', closeDetail);
$('detail').addEventListener('click', (e) => e.target === $('detail') && closeDetail());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDetail());

function renderDetail() {
  if (!detailKey) return;
  const d = chars.get(detailKey)?.data;
  if (!d) return closeDetail();
  $('detail').querySelector('.sheet').style.setProperty('--c', d.colour);
  const src = portraitSrc(d, 512);
  if ($('dPortrait').getAttribute('src') !== src) $('dPortrait').src = src;
  $('dName').textContent = d.name;
  $('dRole').textContent = d.role;
  $('dStatus').className = `dstatus s-${d.status}`;
  $('dStatus').innerHTML = `<span class="sdot"></span>${esc(STATUS_LABEL[d.status] ?? d.status)}${d.project ? ` · ${esc(d.project)}` : ''}`;
  const facts = [];
  if (d.task) facts.push(['Tugas', d.task]);
  if (d.status === 'working' && d.tool) facts.push(['Sekarang', [d.tool, d.detail].filter(Boolean).join(' · ')]);
  if (d.since && d.status !== 'resting') facts.push([d.status === 'completed' ? 'Selesai' : 'Mulai', `${fmtTime(d.since)} (${ago(d.since)} lalu)`]);
  if (d.toolCount) facts.push(['Tool dipakai', num(d.toolCount)]);
  if (d.say) facts.push(['Pesan terakhir', d.say]);
  $('dFacts').innerHTML = facts.length
    ? facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')
    : '<dt>Status</dt><dd>Belum ada tugas sejak server berjalan.</dd>';
  $('dFiles').innerHTML = d.files?.length
    ? d.files.map((f) => `<li>${esc(f)}</li>`).join('')
    : '<li class="none">Belum ada berkas yang diubah.</li>';
  $('dRecent').innerHTML = (d.recent ?? []).length
    ? d.recent.map((r) => `<li><time>${fmtTime(r.ts)}</time><span>${esc(r.text)}</span></li>`).join('')
    : '<li><span>Belum ada aktivitas.</span></li>';
}

// ---------- pet ----------

let petEl = null;
let petCards = null;
let petFailKey = null;
const leadKeyOf = (sid) => lastSnap?.chars?.find((c) => c.sid === sid && c.key.startsWith('lead'))?.key;
/** Pet ikut karakter yang sedang diawasinya; kalau tidak ada, duduk di Ruang Santai. */
function renderPet() {
  const v = lastSnap?.pet;
  if (!v || !coords?.rooms) return;
  if (!petEl) {
    petEl = createPet('in-office');
    const box = document.createElement('div');
    box.className = 'pet-cards';
    petEl.prepend(box);
    petCards = createPetCards(box, {
      open: ({ sid }) => {
        const key = leadKeyOf(sid);
        if (key) openDetail(key);
      },
    });
    // Klik = elus; klik dua kali = buka detail karakter yang sedang diawasi pet.
    let clickTimer = null;
    petEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.pet-cards')) return; // tombol di kartu punya aksinya sendiri
      clearTimeout(clickTimer);
      if (e.detail >= 2) {
        if (lastSnap?.pet?.follow && chars.has(lastSnap.pet.follow)) openDetail(lastSnap.pet.follow);
        return;
      }
      clickTimer = setTimeout(() => fetch('/api/pet/pat', { method: 'POST' }), 260);
    });
    $('chars').append(petEl);
  }
  updatePet(petEl, v);
  if (!demo) petCards.update(lastSnap);
  const rt = v.follow && chars.get(v.follow);
  let x;
  let y;
  if (rt && !rt.el.classList.contains('walking-out')) {
    x = rt.x + (rt.x > 85 ? -4.5 : 4.5);
    y = rt.y + 0.5;
  } else {
    const r = coords.rooms.lounge ?? Object.values(coords.rooms)[0];
    x = r.x + r.w * 0.22;
    y = r.y + r.h * 0.8;
  }
  petEl.style.left = `${x}%`;
  petEl.style.top = `${y}%`;
  petEl.classList.toggle('cards-left', x > 50);
  petEl.classList.toggle('cards-right', x <= 50);
  petEl.style.zIndex = String(Math.round(y * 10) + 1);
  // Notifikasi gagal sekali per kejadian (bukan per render).
  const failing = lastSnap.chars?.find((c) => c.fail);
  const fk = failing ? `${failing.key}:${failing.fail.ts}` : null;
  if (fk && fk !== petFailKey && primed && !demo)
    notify('fail', `${failing.name} gagal: ${failing.fail.tool || 'jawaban'}`, failing.fail.text || failing.project || 'Claude Code', failing.key);
  petFailKey = fk ?? petFailKey;
}

// ---------- snapshot ----------

function apply(full) {
  const now = Date.now();
  if (!demo) inbox.update(full);
  const snap = demo ? full : viewOf(full);
  $('office').classList.toggle('dark', !snap.lightsOn && cfg.settings.theme.dimIdle);
  $('live').classList.toggle('on', Boolean(snap.lightsOn));
  $('liveText').textContent = demo ? 'DEMO' : snap.lightsOn ? 'LIVE' : 'OFFLINE';
  const sel = selectedSid && snap.sessions?.find((s) => s.sid === selectedSid);
  $('project').innerHTML = sel
    ? `melihat sesi <b>${esc(sel.title || sel.project)}</b>`
    : snap.project
      ? `working on <b>${esc(snap.project)}</b>${snap.sessions?.length > 1 ? ` · ${snap.sessions.length} sesi` : ''}`
      : 'menunggu sesi Claude Code…';

  const seen = new Set();
  for (const data of snap.chars) {
    seen.add(data.key);
    let rt = chars.get(data.key);
    const fresh = !rt;
    if (fresh) rt = createChar(data);
    const prev = fresh ? null : rt.data;
    rt.data = data;
    rt.el.style.setProperty('--c', data.colour);
    checkAlerts(prev, data);

    if (fresh) {
      rt.target = data.room;
      go(rt, data.room, { instant: true });
    } else if (data.room !== rt.target) {
      const finishedNow =
        data.status === 'completed' && prev.status !== 'completed' && now - (data.completedTs || now) < SETTLE_AFTER_MS;
      rt.target = data.room;
      if (finishedNow && data.room === 'break') {
        // Ucapan penutup di meja dulu, baru berjalan ke ruang istirahat.
        rt.goodbyeUntil = now + GOODBYE_MS;
        clearTimeout(rt.timer);
        rt.timer = setTimeout(() => go(rt, 'break', { out: true }), GOODBYE_MS);
      } else go(rt, data.room);
    }
    renderChar(rt, now);
  }
  for (const [key, rt] of chars) {
    if (seen.has(key)) continue;
    chars.delete(key);
    releaseSeat(key);
    clearTimeout(rt.timer);
    rt.glow?.remove();
    rt.el.style.transitionDuration = '600ms';
    rt.el.style.opacity = '0';
    setTimeout(() => rt.el.remove(), 650);
  }

  const waiting = snap.chars.some((c) => c.status === 'waiting');
  document.title = waiting && !demo ? '(!) Agent Office' : 'Agent Office';
  $('leds')?.classList.toggle('on', [...chars.values()].some((rt) => rt.room === 'server' && rt.data.status === 'working'));
  renderRoster(snap, now);
  renderStats(snap.stats);
  renderTicker(snap);
  renderDetail();
  primed = true;
}

function renderRoster(snap, now) {
  const order = { waiting: 0, working: 1, idle: 2, completed: 3, resting: 4, offline: 5 };
  const list = [...snap.chars].sort(
    (a, b) => (a.key === 'lead' ? -1 : b.key === 'lead' ? 1 : 0) || (order[a.status] ?? 6) - (order[b.status] ?? 6),
  );
  $('roster').innerHTML = list
    .map((d) => {
      const what =
        d.status === 'working'
          ? [d.tool, d.detail].filter(Boolean).join(' · ') || d.task
          : d.status === 'waiting'
            ? d.waiting === 'question'
              ? 'bertanya kepada Anda'
              : 'menunggu izin'
            : d.task;
      const when = d.since && d.status !== 'resting' ? ` · ${ago(d.status === 'working' ? d.heartbeat : d.since)}` : '';
      const label = d.status === 'waiting' ? 'menunggu' : (STATUS_LABEL[d.status] ?? d.status);
      return `<button class="member s-${d.status}" style="--c:${d.colour}" data-key="${esc(d.key)}">
        <img src="${portraitSrc(d)}" alt="">
        <div style="min-width:0">
          <div class="top"><span class="name">${esc(d.name)}</span><span class="role">${esc(d.role)}</span></div>
          <div class="status"><span class="sdot"></span><span>${esc(label)}${when}${what ? ` — ${esc(what)}` : ''}</span></div>
        </div></button>`;
    })
    .join('');
}

function renderStats(st) {
  if (!st) {
    $('stats').hidden = true;
    return;
  }
  $('stats').hidden = false;
  const rows = (st.projects ?? [])
    .slice(0, 4)
    .map((p) => `<div><span>${esc(p.name)}</span><span>${num(p.tools)} tool${p.fails ? ` · <em class="fails">${num(p.fails)} gagal</em>` : ''} · ${dur(p.activeMs)}</span></div>`)
    .join('');
  $('stats').innerHTML = `<h3>Hari ini</h3>
    <div class="stat-grid">
      <div class="stat"><b>${num(st.prompts)}</b><span>prompt</span></div>
      <div class="stat"><b>${num(st.tools)}</b><span>tool</span></div>
      <div class="stat"><b>${num(st.files)}</b><span>berkas</span></div>
      <div class="stat"><b>${dur(st.activeMs)}</b><span>aktif</span></div>
      ${st.fails ? `<div class="stat bad"><b>${num(st.fails)}</b><span>gagal</span></div>` : ''}
    </div>
    ${rows ? `<div class="proj-rows">${rows}</div>` : ''}`;
}

function renderTicker(snap) {
  $('ticker').innerHTML = (snap.ticker ?? [])
    .slice(0, 30)
    .map((t) => `<li><time>${fmtTime(t.ts)}</time><span>${esc(t.text)}</span></li>`)
    .join('');
}

$('roster').addEventListener('click', (e) => {
  const key = e.target.closest('.member')?.dataset.key;
  const rt = key && chars.get(key);
  if (!rt) return;
  rt.el.classList.add('highlight');
  setTimeout(() => rt.el.classList.remove('highlight'), 2500);
  openDetail(key);
});

// Karakter yang beristirahat sesekali pindah tempat.
setInterval(() => {
  for (const rt of chars.values()) {
    if (rt.target !== 'break' || rt.el.classList.contains('moving') || rt.goodbyeUntil > Date.now()) continue;
    if (Math.random() < 0.15) go(rt, 'break');
  }
}, 6000);

// Perbarui label waktu & gelembung yang kedaluwarsa.
setInterval(() => {
  const snap = demo?.snap ?? (lastSnap && viewOf(lastSnap));
  if (!snap) return;
  const now = Date.now();
  for (const rt of chars.values()) renderChar(rt, now);
  renderPet();
  renderRoster(snap, now);
  renderDetail();
}, 1000);

// ---------- mode demo (jelas berlabel, bukan data asli) ----------

function startDemo() {
  const t = cfg.team;
  const types = Object.keys(t.types).filter((k) => k !== '*');
  const base = (key, spec, room, status) => ({
    key,
    sprite: spec.sprite,
    name: spec.name,
    role: spec.role,
    colour: spec.colour,
    room,
    status,
    waiting: null,
    badge: null,
    tool: null,
    detail: '',
    task: '',
    say: '',
    sayTs: 0,
    since: Date.now(),
    heartbeat: Date.now(),
    project: 'demo',
    recent: [],
    files: [],
  });
  const snap = {
    lightsOn: true,
    project: 'demo',
    sessions: [{}],
    // Mode berurutan: yang bekerja adalah karakter slot; karakter per tipe jadi staf yang istirahat.
    chars: t.slots?.length
      ? [base('lead', t.lead, 'command', 'working'), ...t.slots.map((sp, i) => base(`slot:${i}`, sp, 'break', 'resting')), ...types.map((k) => base(`type:${k}`, t.types[k], 'break', 'resting'))].map((x, i, all) => (i > (t.slots?.length ?? 0) ? { ...x, staff: true } : x))
      : [base('lead', t.lead, 'command', 'working'), ...types.map((k) => base(`type:${k}`, t.types[k], 'break', 'resting'))],
    ticker: [],
    stats: { prompts: 12, tools: 348, files: 21, activeMs: 2.4 * 3600_000, projects: [{ name: 'demo', prompts: 12, tools: 348, files: 21, activeMs: 2.4 * 3600_000 }] },
  };
  const tools = [
    ['Read', 'app.tsx', 'workspace'],
    ['Edit', 'page-banner.tsx', 'workspace'],
    ['Grep', 'useLanguage', 'workspace'],
    ['Bash', 'npm run build', 'server'],
    ['WebSearch', 'tailwind v4 @theme', 'meeting'],
  ];
  const lines = ['Selesai: 3 berkas diperbarui, build hijau.', 'Ketemu 12 pemakaian, rangkuman di atas.', 'Tes lulus semua.'];
  demo = { snap, timer: 0 };
  const tick = () => {
    const now = Date.now();
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const workers = snap.chars.filter((x) => x.key !== 'lead' && !x.staff);
    const c = workers[Math.floor(Math.random() * workers.length)];
    const r = Math.random();
    if (c.status === 'working' && r < 0.35) {
      Object.assign(c, { status: 'completed', room: 'break', say: pick(lines), sayTs: now, completedTs: now, since: now, tool: null, waiting: null, badge: null });
    } else if (r < 0.12) {
      Object.assign(c, { status: 'waiting', room: 'approval', waiting: 'permission', badge: '!' });
    } else {
      const [tool, detail, room] = pick(tools);
      Object.assign(c, { status: 'working', room, tool, detail, waiting: null, badge: null, task: 'Tugas demo', heartbeat: now });
    }
    c.recent = [{ ts: now, text: `${c.status}${c.tool ? ` · ${c.tool}` : ''}` }, ...c.recent].slice(0, 12);
    const lead = snap.chars[0];
    const [tool, detail, room] = pick(tools);
    Object.assign(lead, { tool, detail, room: Math.random() < 0.2 ? 'briefing' : Math.random() < 0.5 ? 'command' : room });
    snap.ticker.unshift({ ts: now, text: `${c.name}: ${STATUS_LABEL[c.status]}${c.tool ? ` (${c.tool})` : ''}` });
    snap.ticker.length = Math.min(snap.ticker.length, 20);
    apply(structuredClone(snap));
  };
  tick();
  demo.timer = setInterval(tick, 2500);
}

function resetChars() {
  for (const rt of chars.values()) {
    clearTimeout(rt.timer);
    rt.el.remove();
    rt.glow?.remove();
  }
  chars.clear();
  seatOwner.clear();
}

$('demo').addEventListener('change', (e) => {
  resetChars();
  if (e.target.checked) startDemo();
  else {
    clearInterval(demo?.timer);
    demo = null;
    if (lastSnap) apply(lastSnap);
  }
});

// ---------- mulai ----------

async function loadSheet() {
  const img = new Image();
  img.src = '/assets/kenney-indoor.png';
  await img.decode();
  return img;
}

/** Peta yang dipakai sekarang; "auto" memilih peta siang (06.00–18.00) atau malam menurut jam komputer. */
function resolveOffice() {
  const { offices, theme } = cfg.settings;
  if (theme.office === 'auto') {
    const h = new Date().getHours();
    const want = h >= 6 && h < 18 ? 'day' : 'night';
    return offices.find((o) => o.time === want) ?? offices[0] ?? null;
  }
  return offices.find((o) => o.id === theme.office) ?? offices[0] ?? null;
}

let builtOffice = null; // `${id}|${koordinat}` yang sedang tergambar

async function buildOffice() {
  const office = resolveOffice();
  const key = `${office?.id}|${JSON.stringify(office?.coordinates ?? null)}`;
  if (key === builtOffice) return;
  const coordsChanged = builtOffice?.split('|').slice(1).join('|') !== key.split('|').slice(1).join('|');
  builtOffice = key;
  coords = office?.coordinates ?? DEFAULT_COORDS;
  buildGraph();
  $('map').innerHTML = '';
  $('banner').hidden = true;
  if (office) {
    const img = new Image();
    img.src = office.url;
    img.alt = '';
    $('map').append(img);
    if (!office.coordinates) {
      $('banner').hidden = false;
      $('banner').textContent = `Peta "${office.name}" belum dipetakan — buka "Peta" untuk menandai ruangan, kursi, dan pintu.`;
    }
  } else {
    const canvas = document.createElement('canvas');
    $('map').append(canvas);
    drawPlaceholderOffice(canvas, await loadSheet(), coords);
  }
  $('fx').querySelector('#leds')?.remove();
  buildServerLeds();
  // Koordinat berubah: semua karakter ditaruh ulang di kursi barunya.
  if (coordsChanged && chars.size) {
    resetChars();
    const snap = demo?.snap ?? lastSnap;
    if (snap) apply(snap);
  }
}

function applyLook() {
  const { theme, rooms } = cfg.settings;
  document.documentElement.style.setProperty('--gold', theme.accent);
  document.documentElement.dataset.theme = theme.panel;
  // Label ruangan: pojok kiri bawah tiap ruangan, hanya saat peta di-hover.
  $('labels').innerHTML = Object.entries(coords.rooms)
    .map(([k, r]) => `<div style="left:${r.x + 0.8}%;top:${r.y + r.h - 1}%">${esc(rooms.labels[k] ?? ROOM_LABELS[k] ?? k)}</div>`)
    .join('');
}

export async function loadConfig() {
  cfg = await (await fetch('/api/config')).json();
  await buildOffice();
  applyLook();
  for (const rt of chars.values()) setPose(rt, 'front', false); // gambar karakter mungkin baru
  custom.refresh(cfg);
}

// Mode "auto" bisa berganti peta saat jam melewati 06.00/18.00.
setInterval(() => cfg?.settings.theme.office === 'auto' && buildOffice().then(applyLook), 60_000);

async function boot() {
  await loadConfig();
  notifyHint();

  const es = new EventSource('/api/stream');
  es.onmessage = (m) => {
    lastSnap = JSON.parse(m.data);
    if (!demo) apply(lastSnap);
    renderPet();
  };
  es.addEventListener('config', () => loadConfig());
  // Dari panel pet desktop: "sorot sesi ini" (mis. di monitor khusus Agent Office).
  es.addEventListener('focus', (m) => {
    const { sid } = JSON.parse(m.data);
    selectedSid = sid || null;
    if (lastSnap && !demo) apply(lastSnap);
    const key = sid && leadKeyOf(sid);
    const rt = key && chars.get(key);
    if (rt) {
      rt.el.classList.add('highlight');
      setTimeout(() => rt.el.classList.remove('highlight'), 2500);
    }
  });
  // Server diperbarui/dimulai ulang → muat ulang halaman supaya kode tampilan selalu yang terbaru.
  let version = null;
  es.addEventListener('hello', (m) => {
    const v = JSON.parse(m.data).version;
    if (version && v !== version) location.reload();
    version = v;
  });
  if (new URLSearchParams(location.search).has('demo')) {
    $('demo').checked = true;
    startDemo();
  }
}

boot();
