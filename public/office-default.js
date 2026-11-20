// Kantor placeholder: tata letak 8 ruangan yang sama dengan prompt kantor di Office Prompt Kit,
// digambar di canvas memakai tileset Kenney "Roguelike Indoors" (CC0) + perabot yang digambar kode.
// Dipakai sampai ada public/assets/office/office.png (gambar ChatGPT Anda) + koordinat hasil picker.

export const MAP_W = 1448;
export const MAP_H = 1086;

export const ROOM_LABELS = {
  briefing: 'Briefing Room',
  meeting: 'Meeting Room',
  approval: 'Approval Office',
  workspace: 'Workspace',
  command: 'Command Center',
  server: 'Server Room',
  pantry: 'Pantry',
  lounge: 'Lounge',
};

// Semua angka dalam PERSEN lebar/tinggi peta (format yang sama dengan hasil picker).
export const DEFAULT_COORDS = {
  rooms: {
    briefing: { x: 3, y: 4, w: 29, h: 27 },
    meeting: { x: 35, y: 4, w: 30, h: 27 },
    approval: { x: 68, y: 4, w: 29, h: 27 },
    workspace: { x: 3, y: 38, w: 36, h: 33 },
    command: { x: 44, y: 38, w: 53, h: 34 },
    lounge: { x: 3, y: 77, w: 22, h: 19 },
    pantry: { x: 27, y: 77, w: 30, h: 19 },
    server: { x: 73, y: 77, w: 24, h: 19 },
  },
  doors: [
    { id: 'd_briefing', room: 'briefing', x: 17.5, y: 31 },
    { id: 'd_meeting', room: 'meeting', x: 50, y: 31 },
    { id: 'd_approval', room: 'approval', x: 82.5, y: 31 },
    { id: 'd_workspace', room: 'workspace', x: 39, y: 54 },
    { id: 'd_command', room: 'command', x: 44, y: 54 },
    { id: 'd_pantry', room: 'pantry', x: 41.5, y: 77 },
    { id: 'd_lounge', room: 'lounge', x: 25, y: 87 },
    { id: 'd_server', room: 'server', x: 85, y: 77 },
  ],
  nodes: [
    { id: 'j_top_l', x: 17.5, y: 34.5 },
    { id: 'j_top_m', x: 41.5, y: 34.5 },
    { id: 'j_top_c', x: 50, y: 34.5 },
    { id: 'j_top_r', x: 82.5, y: 34.5 },
    { id: 'j_mid', x: 41.5, y: 54 },
    { id: 'j_bot', x: 41.5, y: 74 },
    { id: 'j_cmd', x: 85, y: 70 },
    { id: 'j_cmd_w', x: 47, y: 69 },
    { id: 'j_pantry', x: 41.5, y: 87 },
  ],
  edges: [
    ['d_briefing', 'j_top_l'],
    ['j_top_l', 'j_top_m'],
    ['j_top_m', 'j_top_c'],
    ['j_top_c', 'd_meeting'],
    ['j_top_c', 'j_top_r'],
    ['j_top_r', 'd_approval'],
    ['j_top_m', 'j_mid'],
    ['j_mid', 'd_workspace'],
    ['j_mid', 'd_command'],
    ['j_mid', 'j_bot'],
    ['j_bot', 'd_pantry'],
    // Belok lewat lantai kosong, bukan memotong konter dapur / deretan konsol.
    ['d_pantry', 'j_pantry'],
    ['j_pantry', 'd_lounge'],
    ['d_command', 'j_cmd_w'],
    ['j_cmd_w', 'j_cmd'],
    ['j_cmd', 'd_server'],
  ],
  seats: [
    // briefing: dua baris kursi menghadap layar
    ...[8, 14, 20, 26].flatMap((x) => [
      { room: 'briefing', x, y: 18 },
      { room: 'briefing', x, y: 25 },
    ]),
    // meeting: mengelilingi meja panjang
    ...[41, 47, 53, 59].flatMap((x) => [
      { room: 'meeting', x, y: 11.5 },
      { room: 'meeting', x, y: 27 },
    ]),
    // approval: kursi tamu di depan meja penting
    { room: 'approval', x: 78, y: 24 },
    { room: 'approval', x: 87, y: 24 },
    { room: 'approval', x: 73, y: 27.5 },
    { room: 'approval', x: 92, y: 27.5 },
    // workspace: berdiri di depan tiap meja
    ...[9.5, 21, 32.5].flatMap((x) => [
      { room: 'workspace', x, y: 52 },
      { room: 'workspace', x, y: 67 },
    ]),
    // command: kursi pemimpin dulu (dipakai Lead), lalu konsol
    { room: 'command', x: 70.5, y: 55 },
    ...[54, 63, 78, 87].map((x) => ({ room: 'command', x, y: 64 })),
    { room: 'command', x: 59, y: 70 },
    { room: 'command', x: 82, y: 70 },
    // server
    { room: 'server', x: 79, y: 90 },
    { room: 'server', x: 89, y: 90 },
    { room: 'server', x: 84, y: 94.5 },
    // lounge & pantry (ruang istirahat)
    { room: 'lounge', x: 8, y: 87 },
    { room: 'lounge', x: 20, y: 87 },
    { room: 'lounge', x: 9, y: 94 },
    { room: 'lounge', x: 15, y: 94.5 },
    { room: 'lounge', x: 21, y: 94 },
    { room: 'pantry', x: 31, y: 89 },
    { room: 'pantry', x: 37, y: 94 },
    { room: 'pantry', x: 47, y: 89 },
    { room: 'pantry', x: 53, y: 94 },
    { room: 'pantry', x: 45, y: 95 },
  ],
};

// ---------- gambar placeholder ----------

const T = 16; // ukuran tile Kenney
const STEP = 17; // tile + margin 1px
const S = 3; // skala tile di peta

const px = (pct, axis) => (pct / 100) * (axis === 'x' ? MAP_W : MAP_H);
const rectPx = (r) => ({ x: px(r.x, 'x'), y: px(r.y, 'y'), w: px(r.w, 'x'), h: px(r.h, 'y') });

function tile(ctx, sheet, col, row, x, y, scale = S) {
  ctx.drawImage(sheet, col * STEP, row * STEP, T, T, Math.round(x), Math.round(y), T * scale, T * scale);
}

const FLOORS = {
  briefing: ['#3a2f2a', '#41352f'],
  meeting: ['#2f3340', '#353a48'],
  approval: ['#3b3125', '#43382a'],
  workspace: ['#2e2a26', '#35302b'],
  command: ['#1d2533', '#222b3b'],
  server: ['#1b1f26', '#20252d'],
  pantry: ['#c9c2b2', '#b9b19f'],
  lounge: ['#3a2a35', '#41303c'],
};

function floor(ctx, r, colours, checker = false) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  floorInner(ctx, r, colours, checker);
  ctx.restore();
}

function floorInner(ctx, r, [a, b], checker) {
  ctx.fillStyle = a;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = b;
  const g = 24;
  for (let y = r.y; y < r.y + r.h; y += g)
    for (let x = r.x; x < r.x + r.w; x += g) {
      const i = Math.round((x - r.x) / g) + Math.round((y - r.y) / g);
      if (checker ? i % 2 === 0 : (Math.round((y - r.y) / g) % 2 === 0 && x === r.x) || i % 7 === 0)
        ctx.fillRect(x, y, checker ? g : g - 1, checker ? g : 1);
    }
}

function walls(ctx, r) {
  const t = 14;
  ctx.fillStyle = '#0d0d12';
  ctx.fillRect(r.x - t, r.y - t, r.w + t * 2, t);
  ctx.fillRect(r.x - t, r.y + r.h, r.w + t * 2, t);
  ctx.fillRect(r.x - t, r.y, t, r.h);
  ctx.fillRect(r.x + r.w, r.y, t, r.h);
  ctx.fillStyle = '#2b2a36';
  ctx.fillRect(r.x - t, r.y - t, r.w + t * 2, 3);
}

function doorGap(ctx, d, rooms) {
  const x = px(d.x, 'x');
  const y = px(d.y, 'y');
  const r = rectPx(rooms[d.room]);
  const nearV = Math.min(Math.abs(x - r.x), Math.abs(x - (r.x + r.w)));
  const nearH = Math.min(Math.abs(y - r.y), Math.abs(y - (r.y + r.h)));
  ctx.fillStyle = '#4a4458';
  if (nearH <= nearV) ctx.fillRect(x - 36, y - 16, 72, 32);
  else ctx.fillRect(x - 16, y - 36, 32, 72);
}

function monitorDesk(ctx, cx, cy) {
  ctx.fillStyle = '#5b4632';
  ctx.fillRect(cx - 60, cy - 30, 120, 44);
  ctx.fillStyle = '#6e5640';
  ctx.fillRect(cx - 60, cy - 30, 120, 6);
  for (const dx of [-30, 6]) {
    ctx.fillStyle = '#111520';
    ctx.fillRect(cx + dx, cy - 26, 26, 18);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(cx + dx + 2, cy - 24, 22, 13);
    ctx.fillStyle = '#93c5fd';
    ctx.fillRect(cx + dx + 4, cy - 21, 12, 2);
    ctx.fillRect(cx + dx + 4, cy - 17, 16, 2);
  }
  ctx.fillStyle = '#1f2430';
  ctx.fillRect(cx - 18, cy - 2, 36, 7);
}

function wallDisplay(ctx, r) {
  const w = r.w * 0.7;
  const x = r.x + (r.w - w) / 2;
  const y = r.y + 10;
  ctx.fillStyle = '#0b0f17';
  ctx.fillRect(x, y, w, 70);
  const panels = 4;
  for (let i = 0; i < panels; i++) {
    const pw = (w - 10 * (panels + 1)) / panels;
    const pxx = x + 10 + i * (pw + 10);
    ctx.fillStyle = i === 1 ? '#0f2c4d' : '#10233a';
    ctx.fillRect(pxx, y + 8, pw, 54);
    ctx.strokeStyle = i % 2 ? '#60a5fa' : '#4ade80';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k <= 8; k++) ctx.lineTo(pxx + 6 + (k * (pw - 12)) / 8, y + 50 - ((k * 37 + i * 11) % 30));
    ctx.stroke();
  }
}

function serverRack(ctx, x, y) {
  ctx.fillStyle = '#0f1218';
  ctx.fillRect(x, y, 44, 80);
  ctx.fillStyle = '#252b36';
  for (let i = 0; i < 6; i++) ctx.fillRect(x + 4, y + 6 + i * 12, 36, 8);
  const leds = ['#4ade80', '#60a5fa', '#f0b44c', '#4ade80'];
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = leds[(i + x) % leds.length];
    ctx.fillRect(x + 32, y + 8 + i * 12, 4, 3);
  }
}

export function drawPlaceholderOffice(canvas, sheet, coords = DEFAULT_COORDS) {
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const R = Object.fromEntries(Object.entries(coords.rooms).map(([k, r]) => [k, rectPx(r)]));

  // lantai koridor & latar
  ctx.fillStyle = '#121218';
  ctx.fillRect(0, 0, MAP_W, MAP_H);
  floor(ctx, { x: px(2, 'x'), y: px(31, 'y'), w: px(96, 'x'), h: px(7, 'y') }, ['#4a4458', '#524b61']);
  floor(ctx, { x: px(39, 'x'), y: px(31, 'y'), w: px(5, 'x'), h: px(46, 'y') }, ['#4a4458', '#524b61']);
  floor(ctx, { x: px(27, 'x'), y: px(72, 'y'), w: px(17, 'x'), h: px(5, 'y') }, ['#4a4458', '#524b61']);
  // Sambungan pendek: Command → Server, dan Lounge → Pantry.
  floor(ctx, { x: px(81, 'x'), y: px(71, 'y'), w: px(8, 'x'), h: px(7, 'y') }, ['#4a4458', '#524b61']);
  floor(ctx, { x: px(24, 'x'), y: px(83, 'y'), w: px(4, 'x'), h: px(8, 'y') }, ['#4a4458', '#524b61']);

  for (const [k, r] of Object.entries(R)) floor(ctx, r, FLOORS[k] ?? FLOORS.workspace, k === 'pantry');
  for (const r of Object.values(R)) walls(ctx, r);
  // Server room menempel ke Command Center: dinding tipis di antaranya punya pintu sendiri.
  for (const d of coords.doors) doorGap(ctx, d, coords.rooms);
  // Celah di sisi seberang sambungan (dinding bawah Command, dinding kiri Pantry).
  ctx.fillStyle = '#4a4458';
  ctx.fillRect(px(85, 'x') - 36, px(72, 'y') - 4, 72, 24);
  ctx.fillRect(px(27, 'x') - 18, px(87, 'y') - 36, 24, 72);

  const P = (pctX, pctY) => [px(pctX, 'x'), px(pctY, 'y')];

  // Briefing: layar presentasi + 2 baris 4 kursi
  {
    const r = R.briefing;
    ctx.fillStyle = '#e8e4d8';
    ctx.fillRect(r.x + r.w * 0.2, r.y + 10, r.w * 0.6, 40);
    ctx.fillStyle = '#62b3ff';
    ctx.fillRect(r.x + r.w * 0.24, r.y + 16, r.w * 0.2, 4);
    ctx.fillRect(r.x + r.w * 0.24, r.y + 26, r.w * 0.35, 4);
    for (const x of [8, 14, 20, 26])
      for (const y of [18, 25]) {
        const [cx, cy] = P(x, y);
        tile(ctx, sheet, 1, 4, cx - 24, cy - 62);
      }
    tile(ctx, sheet, 16, 0, r.x + 6, r.y + 6);
  }

  // Meeting: meja panjang + kursi + papan
  {
    const r = R.meeting;
    const [tx, ty] = P(39, 15.5);
    tile(ctx, sheet, 0, 0, tx, ty);
    for (let i = 1; i <= 4; i++) tile(ctx, sheet, 1, 0, tx + i * 48, ty);
    tile(ctx, sheet, 2, 0, tx + 5 * 48, ty);
    tile(ctx, sheet, 0, 1, tx, ty + 48);
    for (let i = 1; i <= 4; i++) tile(ctx, sheet, 1, 1, tx + i * 48, ty + 48);
    tile(ctx, sheet, 2, 1, tx + 5 * 48, ty + 48);
    for (const x of [41, 47, 53, 59]) {
      const [cx] = P(x, 0);
      tile(ctx, sheet, 0, 4, cx - 24, ty - 46);
      tile(ctx, sheet, 1, 4, cx - 24, ty + 96);
    }
    ctx.fillStyle = '#f5f1e6';
    ctx.fillRect(r.x + r.w - 120, r.y + 8, 100, 30);
    tile(ctx, sheet, 17, 0, r.x + 6, r.y + r.h - 54);
  }

  // Approval: meja penting + lampu + 2 kursi tamu
  {
    const r = R.approval;
    const [dx, dy] = P(77, 12);
    for (let i = 0; i < 4; i++) tile(ctx, sheet, i === 0 ? 0 : i === 3 ? 2 : 1, 0, dx + i * 48, dy);
    tile(ctx, sheet, 1, 2, dx + 72, dy - 40);
    ctx.fillStyle = 'rgba(240,180,76,0.25)';
    ctx.beginPath();
    ctx.arc(dx + 170, dy + 18, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0b44c';
    ctx.fillRect(dx + 164, dy + 10, 12, 12);
    for (const x of [78, 87]) {
      const [cx, cy] = P(x, 24);
      tile(ctx, sheet, 1, 4, cx - 24, cy - 62);
    }
    tile(ctx, sheet, 19, 13, r.x + 10, r.y + 8, 3);
    tile(ctx, sheet, 16, 0, r.x + r.w - 54, r.y + 6);
  }

  // Workspace: 6 meja komputer + rak di dinding kiri
  {
    const r = R.workspace;
    for (const x of [9.5, 21, 32.5])
      for (const y of [46, 61]) {
        const [cx, cy] = P(x, y);
        monitorDesk(ctx, cx, cy);
      }
    for (let i = 0; i < 4; i++) tile(ctx, sheet, 1, 13, r.x + 6 + i * 48, r.y + r.h - 50);
    tile(ctx, sheet, 17, 0, r.x + r.w - 52, r.y + 6);
  }

  // Command: layar dinding besar + konsol
  {
    const r = R.command;
    wallDisplay(ctx, r);
    for (const x of [54, 63, 78, 87]) {
      const [cx, cy] = P(x, 58.5);
      monitorDesk(ctx, cx, cy);
    }
    const [lx, ly] = P(70.5, 49.5);
    monitorDesk(ctx, lx, ly);
    tile(ctx, sheet, 16, 0, r.x + 6, r.y + r.h - 54);
    tile(ctx, sheet, 17, 0, r.x + r.w - 54, r.y + r.h - 54);
  }

  // Server: rak + meja kecil
  {
    const r = R.server;
    for (let i = 0; i < 6; i++) serverRack(ctx, r.x + 12 + i * 54, r.y + 10);
  }

  // Lounge: sofa, karpet, meja kopi, lampu/tanaman
  {
    const r = R.lounge;
    for (let i = 0; i < 3; i++) tile(ctx, sheet, 16 + i, 8, r.x + 40 + i * 48, r.y + 8);
    for (let i = 0; i < 3; i++) tile(ctx, sheet, 16 + i, 9, r.x + 40 + i * 48, r.y + 56);
    for (let i = 0; i < 3; i++) tile(ctx, sheet, 16 + i, 15, r.x + 40 + i * 48, r.y + 108);
    tile(ctx, sheet, 7, 0, r.x + 88, r.y + 110);
    tile(ctx, sheet, 16, 0, r.x + 6, r.y + 6);
  }

  // Pantry: konter, wastafel, kompor, kulkas, mesin minuman, meja kecil
  {
    const r = R.pantry;
    const cols = [[0, 12], [8, 12], [1, 12], [14, 14], [2, 12], [5, 12], [6, 12]];
    cols.forEach(([c, rw], i) => tile(ctx, sheet, c, rw, r.x + 8 + i * 48, r.y + 6));
    tile(ctx, sheet, 11, 15, r.x + r.w - 56, r.y + 6);
    tile(ctx, sheet, 11, 16, r.x + r.w - 56, r.y + 54);
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(r.x + r.w - 110, r.y + 10, 40, 70);
    ctx.fillStyle = '#fca5a5';
    ctx.fillRect(r.x + r.w - 104, r.y + 18, 28, 20);
    tile(ctx, sheet, 7, 0, r.x + r.w * 0.42, r.y + r.h * 0.55);
  }

  // Pintu Server menempel ke Command (garis kecil sebagai kusen)
  ctx.fillStyle = '#f0b44c';
  for (const d of coords.doors) {
    const [x, y] = P(d.x, d.y);
    ctx.fillRect(x - 3, y - 3, 6, 6);
  }
}
