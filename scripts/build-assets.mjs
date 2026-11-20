// Memproses gambar di raw/ menjadi aset siap pakai.
//
//   raw/<sprite>/front.png (wajib), side.png (menghadap KIRI), back.png, portrait.png (opsional)
//   raw/office.png
//
// → public/assets/characters/<sprite>/{front,side,back}_256.png, portrait_128.png, portrait_512.png
// → public/assets/office/office.png (1448 x 1086)
// → public/assets/characters/manifest.json
//
// Pemakaian: npm run assets [-- --smooth] [-- --raw <folder>] [-- --out <folder>]
//   --smooth  pakai lanczos (untuk gaya non-pixel-art); default nearest-neighbour.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processOffice, processSprite } from '../lib/assets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? resolve(args[i + 1]) : fallback;
};
const RAW = opt('--raw', join(ROOT, 'raw'));
const OUT = opt('--out', join(ROOT, 'public/assets'));
const kernel = args.includes('--smooth') ? 'lanczos3' : 'nearest';

const manifestFile = join(OUT, 'characters/manifest.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
const sprites = existsSync(RAW) ? readdirSync(RAW).filter((d) => statSync(join(RAW, d)).isDirectory()) : [];

let failed = false;
for (const sprite of sprites) {
  try {
    const { substituted } = await processSprite(join(RAW, sprite), join(OUT, 'characters', sprite), { kernel });
    manifest[sprite] = { v: Date.now() };
    console.log(`✓ ${sprite}${substituted.length ? `  (cadangan dari pose depan: ${substituted.join(', ')})` : ''}`);
  } catch (err) {
    failed = true;
    console.error(`✗ ${sprite}: ${err.message}`);
  }
}

const officeRaw = join(RAW, 'office.png');
if (existsSync(officeRaw)) {
  mkdirSync(join(OUT, 'office'), { recursive: true });
  await processOffice(officeRaw, join(OUT, 'office/office.png'), { kernel });
  console.log('✓ office.png → 1448 x 1086');
}

mkdirSync(join(OUT, 'characters'), { recursive: true });
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
if (failed) process.exitCode = 1;
