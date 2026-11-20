// Katalog: semua skill, slash command, subagent, server MCP, dan plugin yang terpasang di Claude Code,
// plus statistik pemakaian dari log hook. Hanya membaca ~/.claude — tidak pernah menulis ke sana.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { redact } from './state.mjs';

const HOME = homedir();
const CLAUDE = join(HOME, '.claude');
const DAY = 86_400_000;
export const NEW_DAYS = 7;
// [Inggris, Indonesia]
export const BUILTIN_AGENTS = {
  'general-purpose': ['General-purpose agent for research, code search, and multi-step tasks.', 'Agent serbaguna untuk riset, pencarian kode, dan tugas bertahap.'],
  Explore: ['Fast read-only search across many files; returns the conclusion.', 'Pencarian cepat hanya-baca di banyak berkas; mengembalikan kesimpulan.'],
  Plan: ['Architect: drafts a step-by-step implementation plan.', 'Arsitek: menyusun rencana implementasi langkah demi langkah.'],
  'claude-code-guide': ['Answers questions about Claude Code, the Agent SDK, and the Claude API.', 'Menjawab pertanyaan tentang Claude Code, Agent SDK, dan Claude API.'],
  'statusline-setup': ["Configures Claude Code's status line.", 'Mengatur status line Claude Code.'],
};

const readJson = (f, fb) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return fb;
  }
};
const dirs = (d) => {
  try {
    // Ikuti symlink (mis. ~/.claude/skills/agent-reach → ~/.agents/skills/agent-reach).
    return readdirSync(d, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || (e.isSymbolicLink() && statSync(join(d, e.name), { throwIfNoEntry: false })?.isDirectory())))
      .map((e) => e.name);
  } catch {
    return [];
  }
};
const files = (d, ext) => {
  try {
    return readdirSync(d).filter((n) => n.endsWith(ext) && !n.startsWith('.'));
  } catch {
    return [];
  }
};
const mtime = (f) => {
  try {
    return Math.round(statSync(f).mtimeMs);
  } catch {
    return 0;
  }
};
const born = (f) => {
  try {
    const s = statSync(f);
    return Math.round(s.birthtimeMs || s.mtimeMs);
  } catch {
    return 0;
  }
};

/** Frontmatter YAML sederhana: `key: nilai`, nilai berkutip, dan blok `|` / `>`. */
export function frontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    if (val === '') {
      // Blok bersarang satu tingkat (metadata:\n  author: laravel) → "metadata.author".
      while (i + 1 < lines.length && /^\s+[\w-]+:\s*\S/.test(lines[i + 1])) {
        const [, k, v] = lines[++i].match(/^\s+([\w-]+):\s*(.*)$/);
        out[`${key}.${k}`] = v.replace(/^(['"])(.*)\1$/, '$2').trim();
      }
      continue;
    }
    if (/^[|>][+-]?$/.test(val)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim());
      val = block.join(val.startsWith('|') ? '\n' : ' ').trim();
    } else val = val.replace(/^(['"])(.*)\1$/, '$2').trim();
    out[key] = val;
  }
  return out;
}

const mdItem = (file, fallbackName) => {
  let fm = {};
  try {
    fm = frontmatter(readFileSync(file, 'utf8').slice(0, 20_000));
  } catch {}
  return { name: fm.name || fallbackName, desc: fm.description || '', author: fm['metadata.author'] || fm.author || '' };
};

/** Folder proyek yang mungkin punya .claude/: dari ~/.claude.json dan ~/Developer/* (tanpa worktree). */
function projectDirs() {
  const set = new Set(Object.keys(readJson(join(HOME, '.claude.json'), {}).projects ?? {}));
  for (const d of dirs(join(HOME, 'Developer'))) set.add(join(HOME, 'Developer', d));
  return [...set].filter((p) => p !== HOME && !p.includes('/.claude/') && existsSync(p)).sort();
}

/** Isi satu folder .claude (pribadi / proyek / plugin): skill, command, agent. */
function scanClaudeDir(base, source, items) {
  scanSkills(join(base, 'skills'), source, items);
  scanCommandsAgents(base, source, items);
}

function scanSkills(root, source, items) {
  const prefix = source.plugin ? `${source.plugin}:` : source.prefix ?? '';
  for (const d of dirs(root)) {
    const file = join(root, d, 'SKILL.md');
    if (!existsSync(file)) continue;
    const { name, desc, author } = mdItem(file, d);
    // Tanggal folder, bukan SKILL.md: berkas itu dibuat ulang setiap kali skill diedit.
    items.push({ kind: 'skill', name, desc, file, invoke: `/${prefix}${name}`, key: `${prefix}${name}`, author, installedAt: born(join(root, d)), ...source });
  }
}

function scanCommandsAgents(base, source, items) {
  const prefix = source.plugin ? `${source.plugin}:` : source.prefix ?? '';
  for (const f of files(join(base, 'commands'), '.md')) {
    const file = join(base, 'commands', f);
    const { desc } = mdItem(file, f);
    const name = basename(f, '.md');
    items.push({ kind: 'command', name, desc, file, invoke: `/${prefix}${name}`, key: `${prefix}${name}`, installedAt: born(file), ...source });
  }
  for (const f of files(join(base, 'agents'), '.md')) {
    const file = join(base, 'agents', f);
    const { name, desc } = mdItem(file, basename(f, '.md'));
    items.push({ kind: 'agent', name, desc, file, invoke: `pakai agent ${name} untuk `, key: name, installedAt: born(file), ...source });
  }
}

/* ---------------- asal (siapa / dari mana) ---------------- */

// Nama tampilan untuk kunci asal yang dikenal; selain ini huruf pertama dibesarkan.
const ORIGIN_LABELS = {
  anthropic: 'Anthropic',
  mattpocock: 'Matt Pocock',
  'remotion-dev': 'Remotion',
  supabase: 'Supabase',
  laravel: 'Laravel',
  figma: 'Figma',
  growkaz: 'GrowKaz',
  jeffallan: 'Jeffallan',
  notion: 'Notion',
  elevenlabs: 'ElevenLabs',
  context7: 'Context7 (Upstash)',
  google: 'Google',
  higgsfield: 'Higgsfield',
  lightpanda: 'Lightpanda',
  self: 'Buatan sendiri',
};
export const originLabel = (key) => ORIGIN_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
const ownerKey = (s) => String(s).toLowerCase().split('/')[0].replace(/[^a-z0-9-]/g, '') || 'self';
// Paket/perintah MCP stdio yang dikenal → pembuatnya.
const MCP_COMMANDS = [
  [/boost:mcp/, 'laravel'],
  [/chrome-devtools-mcp/, 'google'],
  [/@supabase\//, 'supabase'],
  [/@notionhq\//, 'notion'],
  [/@upstash\/context7/, 'context7'],
];

let ctx = { locks: new Map(), anyLock: new Map(), pluginAuthors: {} };

function mcpOrigin(it) {
  const m = it.mcp;
  if (!m) {
    // Konektor claude.ai / server yang hanya terlihat dari pemakaian: vendornya = namanya.
    const vendor = ownerKey(it.name.replace(/\s+/g, '-'));
    return { key: vendor, via: it.scope === 'claudeai' ? 'konektor claude.ai' : 'terdeteksi dari pemakaian' };
  }
  if (m.type !== 'stdio') {
    try {
      const host = new URL(m.target).hostname;
      if (host === '127.0.0.1' || host === 'localhost') return { key: ownerKey(it.name), via: `server lokal ${host}` };
      const parts = host.split('.');
      return { key: parts.length > 1 ? parts.at(-2) : host, via: host };
    } catch {}
  }
  for (const [re, key] of MCP_COMMANDS) if (re.test(m.target)) return { key, via: m.target.split(' ').slice(0, 3).join(' ') };
  return { key: ownerKey(it.name), via: 'perintah lokal' };
}

/** Tentukan asal satu item. Urutan bukti: plugin → skills-lock.json → author di SKILL.md → bawaan. */
export function originOf(it) {
  let o;
  if (it.kind === 'mcp') o = mcpOrigin(it);
  else if (it.plugin && ctx.pluginAuthors[it.plugin]) o = { key: ownerKey(ctx.pluginAuthors[it.plugin]), via: `plugin ${it.plugin}` };
  else if (it.scope === 'claudeai') o = { key: 'anthropic', via: 'skill claude.ai' };
  else if (it.scope === 'builtin') o = { key: 'anthropic', via: 'bawaan Claude Code' };
  else {
    // Lock proyek sendiri dulu; kalau tidak ada, skill bernama sama yang tercatat di proyek lain.
    const lock = (it.project && ctx.locks.get(it.project)?.[it.name]) || ctx.anyLock.get(it.name);
    if (lock) o = { key: ownerKey(lock), via: `GitHub ${lock}` };
    else if (it.author) o = { key: ownerKey(it.author), via: `author: ${it.author}` };
    else if (it.scope === 'seen') o = { key: 'anthropic', via: 'bawaan Claude Code (terdeteksi)' };
    else o = { key: 'self', via: 'tidak ada sumber tercatat' };
  }
  return { ...o, label: originLabel(o.key) };
}

const mcpKey = (name) => String(name).replace(/[^A-Za-z0-9_-]/g, '_');

/** Ringkasan konfigurasi MCP tanpa rahasia: isi env/header tidak pernah dikirim, argumen dimasking. */
function mcpSummary(cfg = {}) {
  const type = cfg.type || (cfg.url ? 'http' : 'stdio');
  let target = '';
  if (cfg.url) {
    try {
      const u = new URL(cfg.url);
      target = `${u.origin}${u.pathname}`;
    } catch {
      target = '(url)';
    }
  } else target = redact([cfg.command, ...(cfg.args ?? [])].filter(Boolean).join(' ')).slice(0, 200);
  return { type, target, env: Object.keys(cfg.env ?? {}), headers: Object.keys(cfg.headers ?? {}) };
}

function addMcp(items, servers, source, mcpScope) {
  for (const [name, cfg] of Object.entries(servers ?? {})) {
    const key = source.plugin ? mcpKey(`plugin_${source.plugin}_${name}`) : mcpKey(name);
    const sum = mcpSummary(cfg);
    items.push({ kind: 'mcp', name, desc: `${sum.type} · ${sum.target || '-'}`, descId: `${sum.type} · ${sum.target || '-'}`, invoke: `pakai MCP ${name} untuk `, key, mcp: sum, mcpScope: typeof mcpScope === 'function' ? mcpScope(name) : mcpScope, installedAt: 0, ...source });
  }
}

/** Pindai semua yang terpasang. */
export function scanInstalled() {
  ctx = { locks: new Map(), anyLock: new Map(), pluginAuthors: {} };
  const items = [];
  const user = { scope: 'user', scopeLabel: 'Pribadi' };
  scanClaudeDir(CLAUDE, user, items);

  // Skill claude.ai yang tersinkron (anthropic-skills:*).
  for (const bucket of dirs(join(CLAUDE, 'skills', 'synced')))
    scanSkills(join(CLAUDE, 'skills', 'synced', bucket), { scope: 'claudeai', scopeLabel: 'claude.ai', prefix: 'anthropic-skills:' }, items);

  const claudeJson = readJson(join(HOME, '.claude.json'), {});
  addMcp(items, claudeJson.mcpServers, user, 'user');

  for (const p of projectDirs()) {
    const src = { scope: 'project', scopeLabel: basename(p), project: p };
    // skills-lock.json (dari `npx skills add`) mencatat repo asal tiap skill.
    const lock = readJson(join(p, 'skills-lock.json'), {}).skills ?? {};
    const sources = Object.fromEntries(Object.entries(lock).map(([n, v]) => [n, v?.source]).filter(([, v]) => v));
    ctx.locks.set(p, sources);
    for (const [n, v] of Object.entries(sources)) ctx.anyLock.set(n, v);
    scanClaudeDir(join(p, '.claude'), src, items);
    // .mcp.json = cakupan "project" (ikut repo); ~/.claude.json per proyek = cakupan "local".
    const shared = readJson(join(p, '.mcp.json'), {}).mcpServers ?? {};
    const local = claudeJson.projects?.[p]?.mcpServers ?? {};
    addMcp(items, { ...shared, ...local }, src, (n) => (n in local ? 'local' : 'project'));
  }

  // Plugin: tiap plugin jadi satu item + isinya (skill/command/agent/MCP) dengan awalan nama plugin.
  const installed = readJson(join(CLAUDE, 'plugins', 'installed_plugins.json'), {}).plugins ?? {};
  for (const [full, versions] of Object.entries(installed)) {
    const v = [...(versions ?? [])].sort((a, b) => String(b.lastUpdated).localeCompare(String(a.lastUpdated)))[0];
    if (!v?.installPath || !existsSync(v.installPath)) continue;
    const meta = readJson(join(v.installPath, '.claude-plugin', 'plugin.json'), {});
    const plugin = meta.name || full.split('@')[0];
    ctx.pluginAuthors[plugin] = (typeof meta.author === 'string' ? meta.author : meta.author?.name) || full.split('@')[1] || plugin;
    const src = { scope: 'plugin', scopeLabel: `plugin ${plugin}`, plugin };
    const installedAt = Date.parse(v.installedAt) || born(v.installPath);
    const before = items.length;
    scanClaudeDir(v.installPath, src, items);
    addMcp(items, readJson(join(v.installPath, '.mcp.json'), {}).mcpServers ?? readJson(join(v.installPath, '.mcp.json'), {}), src, 'plugin');
    for (let i = before; i < items.length; i++) items[i].installedAt = items[i].installedAt || installedAt;
    const hooks = readJson(join(v.installPath, 'hooks', 'hooks.json'), null);
    const contents = items.slice(before).reduce((acc, it) => ({ ...acc, [it.kind]: (acc[it.kind] ?? 0) + 1 }), {});
    items.push({
      kind: 'plugin',
      name: plugin,
      desc: meta.description || '',
      file: existsSync(join(v.installPath, 'README.md')) ? join(v.installPath, 'README.md') : null,
      invoke: `/${plugin}:`,
      key: plugin,
      version: v.version,
      marketplace: full.split('@')[1] ?? '',
      contents: { ...contents, hooks: hooks ? Object.keys(hooks.hooks ?? hooks).length : 0 },
      installedAt,
      scope: 'plugin',
      scopeLabel: `plugin ${plugin}`,
      plugin,
    });
  }

  for (const [name, [desc, descId]] of Object.entries(BUILTIN_AGENTS))
    items.push({ kind: 'agent', name, desc, descId, invoke: `pakai agent ${name} untuk `, key: name, installedAt: 0, scope: 'builtin', scopeLabel: 'Bawaan' });

  for (const it of items) it.id = [it.kind, it.scope, it.plugin ?? it.project ?? '', it.name].join('|');
  // Satu id unik walau ada nama kembar di sumber yang sama.
  const seen = new Map();
  for (const it of items) {
    const n = seen.get(it.id) ?? 0;
    seen.set(it.id, n + 1);
    if (n) it.id += `#${n}`;
  }
  return items;
}

/* ---------------- pemakaian (dari lib/history.mjs) ---------------- */

// skill = tool Skill dipanggil Claude; cmd = slash command yang Anda ketik; agent; mcp (kunci = nama server).
export function createUsage() {
  return { skill: new Map(), cmd: new Map(), agent: new Map(), mcp: new Map() };
}

/** cwd → nama proyek: subfolder & worktree (…/my-app/src/components, …/.claude/worktrees/x) ikut proyek induknya. */
export function projectOf(cwd) {
  const s = String(cwd ?? '');
  const dev = s.match(/\/Developer\/([^/]+)/);
  if (dev) return dev[1];
  return basename(s.split('/.claude/')[0]) || '?';
}

const inScope = (cwd, it) => it.scope !== 'project' || cwd === it.project || cwd?.startsWith(it.project + '/');

function usageFor(it, u) {
  const maps = it.kind === 'mcp' ? [u.mcp] : it.kind === 'agent' ? [u.agent] : it.kind === 'plugin' ? [] : [u.skill, u.cmd];
  const empty = { count: 0, last: 0, projects: [], tools: [] };
  const keys = [it.key];
  // MCP plugin bisa terdaftar sebagai plugin_<plugin>_<server> atau langsung nama server.
  if (it.kind === 'mcp' && it.plugin) keys.push(mcpKey(it.name));
  const out = { count: 0, last: 0, projects: new Map(), tools: new Map() };
  for (const map of maps) for (const k of keys) {
    const r = map.get(k);
    if (!r) continue;
    for (const [cwd, c] of r.byCwd) {
      if (!inScope(cwd, it)) continue;
      out.count += c.count;
      out.last = Math.max(out.last, c.last);
      const p = projectOf(cwd);
      out.projects.set(p, (out.projects.get(p) ?? 0) + c.count);
    }
    for (const [t, n] of r.tools) out.tools.set(t, (out.tools.get(t) ?? 0) + n);
  }
  if (!out.count) return empty;
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
  return { count: out.count, last: out.last, projects: top(out.projects, 6), tools: top(out.tools, 12) };
}

/**
 * Yang tidak tercatat di disk tapi terlihat dipakai: konektor claude.ai (mcp__claude_ai_*), server MCP
 * yang sudah dilepas, dan skill bawaan Claude Code (artifact-design, dataviz, …).
 */
function detectedFromUsage(items, u) {
  const knownSkills = new Set(items.filter((i) => i.kind === 'skill' || i.kind === 'command').map((i) => i.key));
  for (const key of u.skill.keys()) {
    if (knownSkills.has(key)) continue;
    const plug = key.includes(':') ? key.split(':')[0] : null;
    items.push({
      kind: 'skill',
      name: key.includes(':') ? key.split(':').slice(1).join(':') : key,
      desc: plug
        ? `Skill from ${plug} — not on disk, detected from usage.`
        : 'Built into Claude Code or since removed — detected from usage.',
      descId: plug
        ? `Skill dari ${plug} — tidak ada di disk, terdeteksi dari pemakaian.`
        : 'Skill bawaan Claude Code atau yang sudah dilepas — terdeteksi dari pemakaian.',
      invoke: `/${key}`,
      key,
      installedAt: 0,
      scope: 'seen',
      scopeLabel: 'Terdeteksi',
      plugin: plug ?? undefined,
      detected: true,
      id: `skill|seen|${key}`,
    });
  }
  const known = new Set(items.filter((i) => i.kind === 'mcp').flatMap((i) => [i.key, mcpKey(i.name)]));
  for (const key of u.mcp.keys()) {
    if (known.has(key)) continue;
    const ai = key.match(/^claude_ai_(.+)$/);
    const plug = key.match(/^plugin_([^_]+)_(.+)$/);
    const name = ai ? ai[1].replace(/_/g, ' ') : plug ? plug[2] : key;
    items.push({
      kind: 'mcp',
      name,
      desc: ai ? 'claude.ai connector — detected from usage.' : 'MCP server — detected from usage.',
      descId: ai ? 'Konektor claude.ai — terdeteksi dari pemakaian.' : 'Server MCP — terdeteksi dari pemakaian.',
      invoke: `pakai MCP ${name} untuk `,
      key,
      installedAt: 0,
      scope: ai ? 'claudeai' : plug ? 'plugin' : 'user',
      scopeLabel: ai ? 'claude.ai' : plug ? `plugin ${plug[1]}` : 'Pribadi',
      plugin: plug?.[1],
      detected: true,
      id: `mcp|seen|${key}`,
    });
  }
}

/** Gabungkan item + pemakaian + catatan menjadi payload untuk browser (tanpa path mentah berkas). */
export function buildCatalog(items, u, notes, firstSeen, now = Date.now()) {
  const all = [...items];
  detectedFromUsage(all, u);
  return all.map((it) => {
    const usage = usageFor(it, u);
    const installedAt = it.installedAt || firstSeen[it.id] || 0;
    const { file, key, ...rest } = it;
    let contentHash = null;
    try {
      if (file) contentHash = createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 12);
    } catch {}
    return {
      ...rest,
      hasDoc: Boolean(file) || it.kind === 'mcp',
      contentHash,
      modifiedAt: file ? mtime(file) : 0,
      path: file ? file.replace(HOME, '~') : null,
      usage,
      origin: originOf(it),
      installedAt,
      isNew: installedAt > 0 && now - installedAt < NEW_DAYS * DAY,
      note: notes[it.id] ?? null,
    };
  });
}

/** Dokumen untuk modal "Buka": isi .md (dibatasi), atau ringkasan konfigurasi MCP. */
export function readDoc(item, lang = 'id') {
  const en = lang === 'en';
  if (item.kind === 'mcp') {
    const m = item.mcp;
    const hidden = en ? '(values hidden)' : '(isi disembunyikan)';
    if (!m)
      return {
        text: en ? 'Its configuration is not on this computer (managed by claude.ai).' : 'Konfigurasinya tidak ada di komputer ini (dikelola claude.ai).',
        format: 'text',
      };
    return {
      text: [
        `${en ? 'Type   ' : 'Tipe   '}: ${m.type}`,
        `Target : ${m.target || '-'}`,
        `Env    : ${m.env.length ? `${m.env.join(', ')}  ${hidden}` : '-'}`,
        `${en ? 'Headers' : 'Header '}: ${m.headers.length ? `${m.headers.join(', ')}  ${hidden}` : '-'}`,
      ].join('\n'),
      format: 'text',
    };
  }
  if (!item.file) return { text: item.desc || (en ? '(no document)' : '(tidak ada dokumen)'), format: 'text' };
  let text = readFileSync(item.file, 'utf8');
  if (text.length > 120_000) text = text.slice(0, 120_000) + '\n\n… (dipotong)';
  return { text: redact(text), format: 'md', path: item.file.replace(HOME, '~') };
}
