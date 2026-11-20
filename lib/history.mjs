// Riwayat pemakaian dari transcript Claude Code (~/.claude/projects/**/*.jsonl).
// Dipindai sekali penuh, lalu hanya bagian yang baru ditambahkan (per berkas, dari offset terakhir).
// Yang disimpan hanya agregat: jenis, nama, cwd, jumlah, waktu terakhir — tanpa isi percakapan.
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PROJECTS = join(homedir(), '.claude', 'projects');
const CHUNK = 4 * 1024 * 1024;

async function listJsonl(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await listJsonl(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

const CMD_RE = /<command-name>\/?([\w:.-]{1,80})<\/command-name>/;

/** Ambil "hit" dari satu baris transcript: [jenis, kunci, sub, cwd, ts]. */
export function hitsFromLine(line) {
  if (!line.includes('"tool_use"') && !line.includes('command-name>')) return [];
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return [];
  }
  const ts = Date.parse(o.timestamp) || 0;
  const cwd = o.cwd || '';
  const content = o.message?.content;
  const out = [];
  if (o.type === 'assistant' && Array.isArray(content)) {
    for (const b of content) {
      if (b?.type !== 'tool_use') continue;
      const name = String(b.name ?? '');
      const input = b.input ?? {};
      if (name === 'Skill' && input.skill) out.push(['skill', String(input.skill), '', cwd, ts]);
      else if (name === 'Agent' || name === 'Task') out.push(['agent', String(input.subagent_type || 'general-purpose'), '', cwd, ts]);
      else if (name.startsWith('mcp__')) {
        const m = name.match(/^mcp__(.+?)__(.+)$/);
        if (m) out.push(['mcp', m[1], m[2], cwd, ts]);
      }
    }
  } else if (o.type === 'user' && !o.isCompactSummary) {
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => (b?.type === 'text' ? b.text : '')).join('\n') : '';
    const m = text.match(CMD_RE);
    if (m) out.push(['cmd', m[1], '', cwd, ts]);
  }
  return out;
}

/** Baca satu berkas dari `offset` sampai baris utuh terakhir. Mengembalikan offset baru. */
async function scanFile(file, offset, size, onHit) {
  const fh = await open(file, 'r');
  try {
    let pos = offset;
    let carry = Buffer.alloc(0);
    let consumed = offset;
    const buf = Buffer.allocUnsafe(CHUNK);
    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - pos), pos);
      if (!bytesRead) break;
      pos += bytesRead;
      // Potong di byte '\n' terakhir supaya karakter UTF-8 tidak terbelah di batas potongan.
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      const nl = data.lastIndexOf(10);
      if (nl < 0) {
        carry = Buffer.from(data);
        continue;
      }
      const text = data.toString('utf8', 0, nl);
      consumed += nl + 1;
      carry = Buffer.from(data.subarray(nl + 1));
      for (const line of text.split('\n')) for (const h of hitsFromLine(line)) onHit(h);
    }
    return consumed; // sisa (baris belum selesai ditulis) dibaca lagi lain kali
  } finally {
    await fh.close();
  }
}

/**
 * cache = { files: { path: { size, offset, agg: { "jenis|kunci|sub|cwd": [jumlah, terakhir] } } } }
 * Mengembalikan true kalau ada yang berubah.
 */
export async function updateHistory(cache, onProgress) {
  cache.files ??= {};
  const list = await listJsonl(PROJECTS);
  const present = new Set(list);
  let changed = false;
  for (const f of Object.keys(cache.files))
    if (!present.has(f)) {
      // Transcript yang dihapus Claude Code tetap dihitung: riwayat pemakaian tidak ikut hilang.
      cache.files[f].gone = true;
    }
  let done = 0;
  for (const file of list) {
    done++;
    let st;
    try {
      st = await stat(file);
    } catch {
      continue;
    }
    let rec = cache.files[file];
    if (rec && st.size === rec.size) continue;
    if (!rec || st.size < rec.offset) rec = cache.files[file] = { size: 0, offset: 0, agg: {} };
    const agg = rec.agg;
    rec.offset = await scanFile(file, rec.offset, st.size, ([kind, key, sub, cwd, ts]) => {
      const k = `${kind}|${key}|${sub}|${cwd}`;
      const a = (agg[k] ??= [0, 0]);
      a[0]++;
      a[1] = Math.max(a[1], ts);
    });
    rec.size = st.size;
    changed = true;
    onProgress?.(done, list.length);
  }
  return changed;
}

/** Gabungkan agregat semua berkas ke bentuk usage yang dipakai lib/catalog.mjs. */
export function usageFromHistory(cache, u) {
  for (const rec of Object.values(cache.files ?? {})) {
    for (const [k, [count, last]] of Object.entries(rec.agg ?? {})) {
      const [kind, key, sub, ...cwdParts] = k.split('|');
      const cwd = cwdParts.join('|');
      const map = u[kind];
      if (!map) continue;
      let r = map.get(key);
      if (!r) map.set(key, (r = { count: 0, last: 0, byCwd: new Map(), tools: new Map() }));
      r.count += count;
      r.last = Math.max(r.last, last);
      const c = r.byCwd.get(cwd) ?? { count: 0, last: 0 };
      c.count += count;
      c.last = Math.max(c.last, last);
      r.byCwd.set(cwd, c);
      if (sub) r.tools.set(sub, (r.tools.get(sub) ?? 0) + count);
    }
  }
  return u;
}
