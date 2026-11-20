// Potret halaman lokal dengan Chrome terpasang (butuh paket playwright).
// PLAYWRIGHT_FROM=<folder berisi node_modules/playwright> kalau playwright tidak terpasang di repo ini.
// Pakai: node tools/shot.mjs <url|file> <out.png> [lebar] [tinggi] [tungguMs]
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
const require = createRequire(join(process.env.PLAYWRIGHT_FROM || process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const [target, out, w = '1440', h = '900', wait = '1500'] = process.argv.slice(2);
const url = /^https?:/.test(target) ? target : 'file://' + resolve(target);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
await browser.close();
if (logs.length) console.log(logs.join('\n'));
console.log('saved', out);
