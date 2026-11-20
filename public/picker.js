// Alat klik-peta: menandai ruangan, kursi, pintu, simpul, dan sambungan di atas office.png.
// Semua posisi disimpan sebagai PERSEN lebar/tinggi gambar (1 desimal).
import { DEFAULT_COORDS, MAP_H, MAP_W, ROOM_LABELS, drawPlaceholderOffice } from './office-default.js';

const $ = (id) => document.getElementById(id);
const ROOMS = Object.keys(ROOM_LABELS);
const MODES = {
  room: 'Tarik kotak untuk ruangan yang dipilih di menu.',
  seat: 'Klik lantai kosong di depan meja/kursi — tempat karakter berdiri.',
  door: 'Klik tepat di celah pintu ruangan yang dipilih di menu.',
  node: 'Klik persimpangan koridor.',
  connect: 'Klik dua pintu/simpul yang bisa dilalui tanpa menembus dinding.',
  erase: 'Klik dekat sebuah titik/sambungan/ruangan untuk menghapusnya.',
};
const COLORS = { room: '#f0b44c', seat: '#4ade80', door: '#62b3ff', node: '#a78bfa', edge: '#e9e6f2' };

let mode = 'room';
let officeId = 'malam';
let data;
const history = [];
let drag = null;
let pending = null; // titik pertama mode connect

const r1 = (v) => Math.round(v * 10) / 10;
const clone = (v) => JSON.parse(JSON.stringify(v));
const toPx = (p) => ({ x: (p.x / 100) * MAP_W, y: (p.y / 100) * MAP_H });

function snapshotHistory() {
  history.push(clone(data));
  if (history.length > 100) history.shift();
}

function pointAt(ev) {
  const b = $('board').getBoundingClientRect();
  return { x: r1(((ev.clientX - b.left) / b.width) * 100), y: r1(((ev.clientY - b.top) / b.height) * 100) };
}

function roomOf(p) {
  return Object.entries(data.rooms).find(([, r]) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)?.[0];
}

const linkables = () => [...data.doors, ...data.nodes];
function nearest(list, p, max = 2.5) {
  let best = null;
  let bd = max;
  for (const it of list) {
    const d = Math.hypot(it.x - p.x, (it.y - p.y) * (MAP_H / MAP_W));
    if (d < bd) [best, bd] = [it, d];
  }
  return best;
}

function nextId(prefix, list) {
  let i = 1;
  while (list.some((x) => x.id === `${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

// ---------- input ----------

$('board').addEventListener('pointerdown', (ev) => {
  const p = pointAt(ev);
  if (mode === 'room') {
    drag = { start: p, now: p };
    $('board').setPointerCapture(ev.pointerId);
    return;
  }
  snapshotHistory();
  const room = $('room').value;
  if (mode === 'seat') {
    const r = roomOf(p);
    if (!r) return msg('Kursi harus di dalam kotak ruangan.', true);
    data.seats.push({ room: r, x: p.x, y: p.y });
  } else if (mode === 'door') {
    data.doors = data.doors.filter((d) => d.id !== `d_${room}`);
    data.doors.push({ id: `d_${room}`, room, x: p.x, y: p.y });
  } else if (mode === 'node') {
    data.nodes.push({ id: nextId('j', data.nodes), x: p.x, y: p.y });
  } else if (mode === 'connect') {
    const hit = nearest(linkables(), p);
    if (!hit) {
      history.pop();
      return msg('Klik lebih dekat ke pintu atau simpul.', true);
    }
    if (!pending) {
      history.pop();
      pending = hit.id;
    } else if (pending !== hit.id) {
      const exists = data.edges.some(([a, b]) => (a === pending && b === hit.id) || (b === pending && a === hit.id));
      if (!exists) data.edges.push([pending, hit.id]);
      pending = null;
    }
  } else if (mode === 'erase') {
    const pt = nearest([...data.seats.map((s, i) => ({ ...s, kind: 'seat', i })), ...linkables().map((x) => ({ ...x, kind: 'link' }))], p);
    if (pt?.kind === 'seat') data.seats.splice(pt.i, 1);
    else if (pt?.kind === 'link') {
      data.doors = data.doors.filter((d) => d.id !== pt.id);
      data.nodes = data.nodes.filter((n) => n.id !== pt.id);
      data.edges = data.edges.filter(([a, b]) => a !== pt.id && b !== pt.id);
    } else {
      const r = roomOf(p);
      if (r) delete data.rooms[r];
      else history.pop();
    }
  }
  render();
});

$('board').addEventListener('pointermove', (ev) => {
  if (!drag) return;
  drag.now = pointAt(ev);
  render();
});

$('board').addEventListener('pointerup', () => {
  if (!drag) return;
  const { start, now } = drag;
  drag = null;
  const w = Math.abs(now.x - start.x);
  const h = Math.abs(now.y - start.y);
  if (w > 2 && h > 2) {
    snapshotHistory();
    data.rooms[$('room').value] = { x: Math.min(start.x, now.x), y: Math.min(start.y, now.y), w: r1(w), h: r1(h) };
  }
  render();
});

// ---------- gambar overlay ----------

function render() {
  const s = [];
  for (const [k, r] of Object.entries(data.rooms)) {
    const a = toPx(r);
    s.push(
      `<rect x="${a.x}" y="${a.y}" width="${(r.w / 100) * MAP_W}" height="${(r.h / 100) * MAP_H}" fill="rgba(240,180,76,.08)" stroke="${COLORS.room}" stroke-width="3" stroke-dasharray="10 6"/>`,
      `<text x="${a.x + 8}" y="${a.y + 24}" fill="${COLORS.room}" font-size="20" font-family="monospace">${k}</text>`,
    );
  }
  const byId = Object.fromEntries(linkables().map((x) => [x.id, x]));
  for (const [a, b] of data.edges) {
    if (!byId[a] || !byId[b]) continue;
    const p = toPx(byId[a]);
    const q = toPx(byId[b]);
    s.push(`<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${COLORS.edge}" stroke-width="3" opacity=".7"/>`);
  }
  for (const seat of data.seats) {
    const p = toPx(seat);
    s.push(`<circle cx="${p.x}" cy="${p.y}" r="9" fill="${COLORS.seat}" stroke="#000" stroke-width="2"/>`);
  }
  for (const d of data.doors) {
    const p = toPx(d);
    s.push(
      `<rect x="${p.x - 10}" y="${p.y - 10}" width="20" height="20" fill="${COLORS.door}" stroke="${pending === d.id ? '#fff' : '#000'}" stroke-width="${pending === d.id ? 5 : 2}"/>`,
      `<text x="${p.x + 14}" y="${p.y + 6}" fill="${COLORS.door}" font-size="16" font-family="monospace">${d.id}</text>`,
    );
  }
  for (const n of data.nodes) {
    const p = toPx(n);
    s.push(
      `<circle cx="${p.x}" cy="${p.y}" r="11" fill="${COLORS.node}" stroke="${pending === n.id ? '#fff' : '#000'}" stroke-width="${pending === n.id ? 5 : 2}"/>`,
      `<text x="${p.x + 14}" y="${p.y + 6}" fill="${COLORS.node}" font-size="16" font-family="monospace">${n.id}</text>`,
    );
  }
  if (drag) {
    const a = toPx({ x: Math.min(drag.start.x, drag.now.x), y: Math.min(drag.start.y, drag.now.y) });
    s.push(
      `<rect x="${a.x}" y="${a.y}" width="${(Math.abs(drag.now.x - drag.start.x) / 100) * MAP_W}" height="${(Math.abs(drag.now.y - drag.start.y) / 100) * MAP_H}" fill="none" stroke="#fff" stroke-width="3"/>`,
    );
  }
  $('overlay').innerHTML = s.join('');
  renderChecklist();
}

function renderChecklist() {
  const items = [];
  const has = (k) => Boolean(data.rooms[k]);
  items.push([ROOMS.every(has), `8 ruangan ditandai (${ROOMS.filter(has).length}/8)`]);
  const noDoor = ROOMS.filter((k) => !data.doors.some((d) => d.room === k));
  items.push([noDoor.length === 0, noDoor.length ? `Belum ada pintu: ${noDoor.join(', ')}` : 'Tiap ruangan punya pintu']);
  const need = { command: 3, workspace: 4, lounge: 3, pantry: 3, briefing: 2, meeting: 2, approval: 2, server: 2 };
  const short = Object.entries(need)
    .map(([k, n]) => [k, n, data.seats.filter((s) => s.room === k).length])
    .filter(([, n, c]) => c < n);
  items.push([short.length === 0, short.length ? `Kursi kurang: ${short.map(([k, n, c]) => `${k} ${c}/${n}`).join(', ')}` : 'Kursi cukup di semua ruangan']);
  // Keterjangkauan: semua pintu harus tersambung lewat graf.
  const adj = {};
  for (const [a, b] of data.edges) {
    (adj[a] ??= []).push(b);
    (adj[b] ??= []).push(a);
  }
  const start = data.doors[0]?.id;
  const seen = new Set(start ? [start] : []);
  const q = start ? [start] : [];
  while (q.length) for (const n of adj[q.shift()] ?? []) if (!seen.has(n)) seen.add(n), q.push(n);
  const unreachable = data.doors.filter((d) => !seen.has(d.id)).map((d) => d.room);
  items.push([data.doors.length > 0 && unreachable.length === 0, unreachable.length ? `Tak terjangkau: ${unreachable.join(', ')}` : 'Semua ruangan terjangkau']);
  $('check').innerHTML = items.map(([ok, t]) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${t}</li>`).join('');
  return items.every(([ok]) => ok);
}

function msg(t, bad = false) {
  $('msg').textContent = t;
  $('msg').style.color = bad ? 'var(--bad)' : 'var(--gold)';
}

// ---------- toolbar ----------

function setMode(m) {
  mode = m;
  pending = null;
  $('help').textContent = MODES[m];
  for (const b of $('modes').children) b.classList.toggle('on', b.dataset.mode === m);
  render();
}

$('modes').innerHTML = Object.keys(MODES)
  .map((m) => `<button data-mode="${m}">${m.toUpperCase()}</button>`)
  .join('');
$('modes').addEventListener('click', (e) => e.target.dataset.mode && setMode(e.target.dataset.mode));
$('room').innerHTML = ROOMS.map((k) => `<option value="${k}">${k} — ${ROOM_LABELS[k]}</option>`).join('');
$('undo').onclick = () => {
  if (history.length) data = history.pop();
  render();
};
$('save').onclick = async () => {
  const ok = renderChecklist();
  const res = await fetch(`/api/coordinates?office=${encodeURIComponent(officeId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  msg(res.ok ? (ok ? 'Tersimpan. Muat ulang halaman Kantor.' : 'Tersimpan, tapi checklist masih ada yang merah.') : 'Gagal menyimpan.', !res.ok);
};
$('download').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'office-coordinates.json';
  a.click();
};
$('import').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  snapshotHistory();
  data = JSON.parse(await f.text());
  render();
};

// ---------- mulai ----------

const cfg = await (await fetch('/api/config')).json();
const offices = cfg.settings.offices;
// Peta yang disunting: ?office=…, kalau tidak ada pakai peta aktif (atau peta pertama untuk mode otomatis).
const wanted = new URLSearchParams(location.search).get('office') ?? cfg.settings.theme.office;
const office = offices.find((o) => o.id === wanted) ?? offices[0];
officeId = office?.id ?? 'malam';
for (const [k, v] of Object.entries(cfg.settings.rooms.labels)) ROOM_LABELS[k] = v;
$('room').innerHTML = ROOMS.map((k) => `<option value="${k}">${k} — ${ROOM_LABELS[k]}</option>`).join('');
$('office').innerHTML = offices
  .map((o) => `<option value="${o.id}"${o.id === officeId ? ' selected' : ''}>Peta: ${o.name}</option>`)
  .join('');
$('office').onchange = (e) => (location.search = `?office=${encodeURIComponent(e.target.value)}`);
if (office) {
  const img = new Image();
  img.src = office.url;
  $('board').prepend(img);
  data = office.coordinates ? clone(office.coordinates) : { rooms: {}, seats: [], doors: [], nodes: [], edges: [] };
  msg(office.coordinates ? `Koordinat peta "${office.name}" dimuat.` : 'Mulai dari kosong: tandai 8 ruangan dulu.');
} else {
  const canvas = document.createElement('canvas');
  $('board').prepend(canvas);
  const sheet = new Image();
  sheet.src = '/assets/kenney-indoor.png';
  await sheet.decode();
  drawPlaceholderOffice(canvas, sheet);
  data = clone(DEFAULT_COORDS);
  msg('Belum ada office.png — menampilkan kantor placeholder & koordinat bawaannya.');
}
setMode('room');
