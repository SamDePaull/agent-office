// Pipeline gambar bersama: dipakai scripts/build-assets.mjs dan unggahan dari panel Kustom.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

export const POSES = ['front', 'side', 'back'];
export const OFFICE_W = 1448;
export const OFFICE_H = 1086;

/** Latar tidak transparan (putih / kotak-kotak) → transparan, diisi dari keempat sudut saja. */
async function clearBackground(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x, y) => (y * w + x) * 4;
  let transparentEdge = 0;
  for (let x = 0; x < w; x++) if (data[at(x, 0) + 3] < 10) transparentEdge++;
  if (transparentEdge > w * 0.5) return sharp(data, { raw: info }); // sudah transparan

  const seen = new Uint8Array(w * h);
  const tol = 40;
  const close = (i, ref) =>
    Math.abs(data[i] - ref[0]) + Math.abs(data[i + 1] - ref[1]) + Math.abs(data[i + 2] - ref[2]) <= tol * 3;
  // Latar kotak-kotak punya dua warna: pakai warna sudut dan tetangganya sebagai referensi.
  const refs = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [Math.min(8, w - 1), 0],
    [0, Math.min(8, h - 1)],
  ].map(([x, y]) => [data[at(x, y)], data[at(x, y) + 1], data[at(x, y) + 2]]);
  const stack = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h || seen[y * w + x]) continue;
    seen[y * w + x] = 1;
    const i = at(x, y);
    if (!refs.some((r) => close(i, r))) continue;
    data[i + 3] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return sharp(data, { raw: info });
}

async function trimmed(input) {
  const png = await (await clearBackground(input)).png().toBuffer();
  const out = await sharp(png).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
  return { buf: out.data, w: out.info.width, h: out.info.height };
}

/**
 * Proses satu karakter dari rawDir/<pose>.png ke outDir/.
 * front wajib; side/back/portrait boleh kosong (pakai front / potongan kepala dari front).
 * Mengembalikan daftar pose yang diganti dengan cadangan.
 */
async function opaqueArea(buf) {
  const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 128) n++;
  return n;
}

/**
 * fadeBottom: pudarkan sebagian bawah gambar depan (untuk gambar setengah badan).
 * targetArea: samakan luas visual pose depan (piksel buram di bingkai 256) supaya karakter
 * gemuk/lebar tidak tampak raksasa dibanding yang ramping.
 */
async function fadeBottom(buf, fraction) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const start = Math.round(info.height * (1 - fraction));
  for (let y = start; y < info.height; y++) {
    const k = 1 - (y - start) / (info.height - start);
    for (let x = 0; x < info.width; x++) data[(y * info.width + x) * 4 + 3] *= k;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

export async function processSprite(rawDir, outDir, { kernel = 'nearest', targetArea = 0, fade = 0 } = {}) {
  const file = (p) => join(rawDir, `${p}.png`);
  if (!existsSync(file('front'))) throw new Error('gambar depan (front.png) belum ada');
  mkdirSync(outDir, { recursive: true });
  const substituted = [];
  const sources = {};
  for (const p of POSES) {
    if (existsSync(file(p))) sources[p] = file(p);
    else {
      sources[p] = file('front');
      substituted.push(p);
    }
  }
  // Satu skala per karakter (dari pose tertinggi) + rata bawah, supaya ukurannya tidak berubah saat berbalik.
  const poses = Object.fromEntries(await Promise.all(POSES.map(async (p) => [p, await trimmed(sources[p])])));
  if (fade) for (const p of POSES) if (sources[p] === file('front') || p === 'front') poses[p].buf = await fadeBottom(poses[p].buf, fade);
  const tallest = Math.max(...POSES.map((p) => poses[p].h));
  const widest = Math.max(...POSES.map((p) => poses[p].w));
  let scale = Math.min(240 / tallest, 240 / widest);
  if (targetArea) scale = Math.min(scale, Math.sqrt(targetArea / (await opaqueArea(poses.front.buf))));
  for (const p of POSES) {
    const { buf, w, h } = poses[p];
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));
    const body = await sharp(buf).resize(nw, nh, { kernel }).png().toBuffer();
    await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: body, left: Math.round((256 - nw) / 2), top: 256 - nh - 8 }])
      .png()
      .toFile(join(outDir, `${p}_256.png`));
  }
  let portrait;
  if (existsSync(file('portrait'))) portrait = (await trimmed(file('portrait'))).buf;
  else {
    // Tanpa potret: ambil bagian atas (kepala & bahu) dari pose depan.
    const f = poses.front;
    const side = Math.min(f.w, Math.round(f.h * 0.55));
    portrait = await sharp(f.buf)
      .extract({ left: Math.max(0, Math.round((f.w - side) / 2)), top: 0, width: side, height: Math.min(side, f.h) })
      .png()
      .toBuffer();
    substituted.push('portrait');
  }
  for (const size of [128, 512])
    await sharp(portrait)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel })
      .png()
      .toFile(join(outDir, `portrait_${size}.png`));
  return { substituted };
}

/** Satu gambar diam (pet): latar dibuang, dipotong, dimuat dalam bingkai persegi rata bawah. */
export async function processStill(input, outFile, { size = 256, kernel = 'lanczos3' } = {}) {
  const { buf } = await trimmed(input);
  const body = await sharp(buf)
    .resize(size - 8, size - 8, { fit: 'inside', kernel })
    .png()
    .toBuffer({ resolveWithObject: true });
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: body.data, left: Math.round((size - body.info.width) / 2), top: size - body.info.height - 4 }])
    .png()
    .toFile(outFile);
}

/** Gambar peta → PNG 1448 x 1086. */
export async function processOffice(input, outFile, { kernel = 'nearest' } = {}) {
  await sharp(input).resize(OFFICE_W, OFFICE_H, { fit: 'fill', kernel }).png().toFile(outFile);
}

/** Pastikan berkas unggahan memang gambar yang bisa dibaca. */
export async function assertImage(buf) {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('berkas bukan gambar');
  if (meta.width > 8000 || meta.height > 8000) throw new Error('gambar terlalu besar (maks 8000px)');
  return meta;
}
