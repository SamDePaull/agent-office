// Karakter placeholder original (chibi pixel 32x32) untuk tipe yang belum punya gambar di raw/.
// Format pose sama dengan kit: front, side (menghadap KIRI), back, portrait.

const HAIR = ['#2b2118', '#f5d06b', '#c2410c', '#e5e7eb', '#1e3a8a', '#7c3aed', '#0f766e', '#be185d'];
const SKIN = ['#f3cfa6', '#e0ac7e', '#c68b5b', '#f6d9bf'];
const STYLES = ['spiky', 'bob', 'cap', 'long'];

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function look(sprite, colour) {
  const h = hash(sprite);
  return {
    hair: HAIR[h % HAIR.length],
    skin: SKIN[(h >>> 3) % SKIN.length],
    style: STYLES[(h >>> 6) % STYLES.length],
    coat: colour,
    pants: '#26232f',
  };
}

const OUT = '#141018';

function painter(ctx) {
  // Gambar blok dengan garis tepi 1px gelap: tepi dulu, lalu isi.
  const parts = [];
  const add = (x, y, w, h, c) => parts.push([x, y, w, h, c]);
  const flush = () => {
    ctx.fillStyle = OUT;
    for (const [x, y, w, h] of parts) ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    for (const [x, y, w, h, c] of parts) {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    }
    parts.length = 0;
  };
  return { add, flush };
}

function drawPose(ctx, L, pose) {
  const p = painter(ctx);
  const side = pose === 'side';
  const back = pose === 'back';

  // kaki & badan
  if (side) {
    p.add(13, 27, 3, 4, L.pants);
    p.add(17, 27, 3, 4, shade(L.pants, 0.8));
    p.add(12, 30, 5, 1, '#0b0b0f');
    p.add(11, 18, 10, 10, L.coat);
    p.add(13, 19, 3, 7, shade(L.coat, 0.75));
  } else {
    p.add(12, 27, 3, 4, L.pants);
    p.add(17, 27, 3, 4, L.pants);
    p.add(11, 30, 4, 1, '#0b0b0f');
    p.add(17, 30, 4, 1, '#0b0b0f');
    p.add(10, 18, 12, 10, L.coat);
    p.add(8, 19, 2, 7, shade(L.coat, 0.8));
    p.add(22, 19, 2, 7, shade(L.coat, 0.8));
    p.add(8, 25, 2, 2, L.skin);
    p.add(22, 25, 2, 2, L.skin);
  }
  p.flush();
  if (!back && !side) {
    ctx.fillStyle = shade(L.coat, 1.25);
    ctx.fillRect(15, 18, 2, 9);
  }

  // kepala (besar, chibi)
  if (side) p.add(8, 4, 14, 14, L.skin);
  else p.add(9, 4, 14, 14, L.skin);
  p.flush();

  // rambut
  ctx.fillStyle = L.hair;
  const hairTop = () => ctx.fillRect(back ? 9 : 8, 3, back ? 14 : side ? 15 : 16, 4);
  if (back) {
    ctx.fillRect(9, 3, 14, 13);
    if (L.style === 'long') ctx.fillRect(9, 3, 14, 17);
  } else if (side) {
    ctx.fillRect(9, 3, 14, 4);
    ctx.fillRect(15, 3, 8, 12);
    if (L.style === 'long') ctx.fillRect(16, 3, 7, 17);
  } else {
    hairTop();
    ctx.fillRect(9, 6, 3, 6);
    ctx.fillRect(20, 6, 3, 6);
    ctx.fillRect(12, 6, 4, 2);
    if (L.style === 'long') {
      ctx.fillRect(8, 6, 3, 13);
      ctx.fillRect(21, 6, 3, 13);
    }
  }
  if (L.style === 'spiky') {
    ctx.fillRect(10, 1, 3, 3);
    ctx.fillRect(15, 0, 3, 4);
    ctx.fillRect(20, 1, 3, 3);
  } else if (L.style === 'cap') {
    ctx.fillStyle = shade(L.coat, 0.9);
    ctx.fillRect(8, 2, 16, 4);
    if (!back) ctx.fillRect(side ? 4 : 10, 5, side ? 8 : 12, 2);
  } else if (L.style === 'bob') {
    ctx.fillRect(back ? 8 : 8, 4, back ? 16 : 16, 3);
  }

  // wajah
  if (!back) {
    ctx.fillStyle = '#1b1530';
    if (side) {
      ctx.fillRect(10, 10, 2, 3);
    } else {
      ctx.fillRect(12, 10, 2, 3);
      ctx.fillRect(18, 10, 2, 3);
      ctx.fillStyle = 'rgba(244,114,182,0.45)';
      ctx.fillRect(11, 14, 2, 1);
      ctx.fillRect(19, 14, 2, 1);
    }
  }
}

const cache = new Map();

/** URL data untuk satu pose placeholder. */
export function placeholderPose(sprite, colour, pose) {
  const key = `${sprite}|${colour}|${pose}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d');
  drawPose(ctx, look(sprite, colour), pose === 'portrait' ? 'front' : pose);
  let url;
  if (pose === 'portrait') {
    const p = document.createElement('canvas');
    p.width = 64;
    p.height = 64;
    const pc = p.getContext('2d');
    pc.imageSmoothingEnabled = false;
    pc.fillStyle = shade(colour, 0.35);
    pc.fillRect(0, 0, 64, 64);
    pc.drawImage(c, 4, 0, 24, 18, 4, 4, 56, 42);
    pc.drawImage(c, 4, 18, 24, 14, 4, 46, 56, 32);
    url = p.toDataURL();
  } else url = c.toDataURL();
  cache.set(key, url);
  return url;
}
