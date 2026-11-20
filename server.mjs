// Server Agent Office: menerima event hook Claude Code, menyimpan state, mengirimkannya ke browser
// lewat SSE, dan melayani panel Kustom. Hanya mendengar di 127.0.0.1.
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { appendFile, open, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize as normPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEvent, clip, createState, describeTool, normalize, prune, redact, setSessionMeta, snapshot } from './lib/state.mjs';
import {
  TOOL_GROUPS,
  addCharacter,
  addOffice,
  applyTemplate,
  removeTemplate,
  saveTemplate,
  applyPatch,
  buildTeam,
  fromTeam,
  isCharacterId,
  normalizeSettings,
  removeCharacter,
} from './lib/settings.mjs';
import { buildCatalog, createUsage, readDoc, scanInstalled } from './lib/catalog.mjs';
import { updateHistory, usageFromHistory } from './lib/history.mjs';
import { hashText, runClaude, translateDoc, translateMany } from './lib/translate.mjs';
import { FACES, createPet, petOnEvent, petPat, petToJson, petView } from './lib/pet.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = join(ROOT, 'data');
const EVENTS = join(DATA, 'events');
const COORDS = join(DATA, 'coords');
const RAW = join(ROOT, 'raw');
const CHAR_OUT = join(PUBLIC, 'assets/characters');
const OFFICE_OUT = join(PUBLIC, 'assets/office');
const PORT = Number(process.env.PORT || 4316);
const HOST = '127.0.0.1';
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const MAX_BODY = 8 * 1024 * 1024;
const MAX_UPLOAD = 25 * 1024 * 1024;
const BOOT_ID = `${Date.now().toString(36)}`; // berubah tiap server dimulai ulang
const BUILTIN_TYPES = ['Explore', 'general-purpose', 'Plan', 'claude-code-guide', 'claude', 'statusline-setup'];

for (const d of [EVENTS, COORDS, CHAR_OUT, OFFICE_OUT]) mkdirSync(d, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function readJsonSync(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await rename(tmp, file);
}

// ---------- pengaturan ----------

const SETTINGS_FILE = join(DATA, 'settings.json');
const DEFAULT_TEAM = {
  lead: { name: 'Jensen', role: 'Orchestrator', sprite: 'lead', colour: '#76b900' },
  types: {
    Explore: { name: 'Coki', role: 'Explore', sprite: 'explore', colour: '#a78bfa' },
    'general-purpose': { name: 'Windah', role: 'General', sprite: 'general', colour: '#fb923c' },
    Plan: { name: 'Gibran', role: 'Plan', sprite: 'plan', colour: '#e5e7eb' },
    'claude-code-guide': { name: 'dr. Tirta', role: 'Guide', sprite: 'guide', colour: '#2dd4bf' },
    claude: { name: 'Speed', role: 'Catch-all', sprite: 'claude', colour: '#ef4444' },
    '*': { name: 'Agent', role: 'Subagent', sprite: 'default', colour: '#a09cb3' },
  },
};
let settings = loadSettings();
let team = buildTeam(settings);

function loadSettings() {
  const saved = readJsonSync(SETTINGS_FILE, null);
  if (saved) return normalizeSettings(saved);
  // Pertama kali: bangun dari team.json lama.
  // Kalau keduanya tidak ada (mis. baru clone), pakai tim bawaan.
  const legacy = readJsonSync(join(DATA, 'team.json'), null);
  return normalizeSettings(fromTeam(legacy?.lead ? legacy : DEFAULT_TEAM));
}

async function saveSettings(next) {
  settings = normalizeSettings(next);
  team = buildTeam(settings);
  await writeJsonAtomic(SETTINGS_FILE, settings);
  broadcastConfig();
}

const manifestFile = join(CHAR_OUT, 'manifest.json');
const readManifest = () => readJsonSync(manifestFile, {});

function coordsFor(officeId) {
  const own = readJsonSync(join(COORDS, `${officeId}.json`), null);
  if (own) return own;
  // Peta yang digenerate dengan denah yang sama memakai koordinat peta utama.
  return readJsonSync(join(COORDS, 'malam.json'), null) ?? readJsonSync(join(DATA, 'office-coordinates.json'), null);
}

function knownTypes() {
  const seen = new Set([...BUILTIN_TYPES, ...Object.keys(settings.assign)]);
  for (const a of state.agents.values()) seen.add(a.type);
  seen.delete('lead');
  seen.delete('*');
  return ['lead', ...[...seen].sort((a, b) => a.localeCompare(b)), '*'];
}

function configPayload() {
  return {
    team,
    settings: {
      characters: settings.characters,
      assign: settings.assign,
      slots: settings.slots,
      templates: settings.templates,
      theme: settings.theme,
      rooms: settings.rooms,
      offices: settings.offices
        .filter((o) => existsSync(join(OFFICE_OUT, o.file)))
        .map((o) => ({ ...o, url: `/assets/office/${o.file}`, coordinates: coordsFor(o.id) })),
    },
    toolGroups: Object.fromEntries(Object.entries(TOOL_GROUPS).map(([k, g]) => [k, g.label])),
    knownTypes: knownTypes(),
    manifest: readManifest(),
  };
}

// ---------- state + persistensi ----------

const state = createState();
const samples = []; // payload mentah terakhir (dipotong) untuk /api/debug/samples

const dayFile = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return join(EVENTS, `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.ndjson`);
};

function replayToday() {
  const file = dayFile(Date.now());
  if (!existsSync(file)) return 0;
  // Semua event hari ini diputar ulang: statistik harian butuh semuanya; sesi lama otomatis
  // dianggap tidak aktif oleh snapshot().
  let n = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      applyEvent(state, JSON.parse(line), team);
      n++;
    } catch {
      /* baris rusak dilewati */
    }
  }
  return n;
}

// ---------- katalog tools & skill ----------

const NOTES_FILE = join(DATA, 'catalog-notes.json');
const SEEN_FILE = join(DATA, 'catalog-seen.json');
const HISTORY_FILE = join(DATA, 'usage-history.json');
let catalogNotes = readJsonSync(NOTES_FILE, {});

// Pemakaian dari transcript Claude Code: pindaian penuh pertama ±15 dtk di latar, lalu inkremental.
const history = readJsonSync(HISTORY_FILE, { files: {} });
const scan = { running: null, progress: null, ready: Object.keys(history.files).length > 0 };
function refreshHistory() {
  scan.running ??= (async () => {
    try {
      const changed = await updateHistory(history, (done, total) => (scan.progress = { done, total }));
      if (changed) await writeJsonAtomic(HISTORY_FILE, history);
    } catch (err) {
      console.error('[katalog] gagal memindai transcript:', err.message);
    } finally {
      scan.ready = true;
      scan.progress = null;
      scan.running = null;
    }
  })();
  return scan.running;
}

// ---------- terjemahan (claude -p, cache per hash teks) ----------
const TRANS_FILE = join(DATA, 'translations.json');
const translations = readJsonSync(TRANS_FILE, {});
const trans = { running: null, done: 0, total: 0, error: null, failed: new Set() };

function queueTranslations(texts) {
  const todo = [...new Set(texts)].filter((t) => t && !translations[hashText(t)] && !trans.failed.has(hashText(t)));
  if (!todo.length || trans.running) return;
  trans.done = 0;
  trans.total = todo.length;
  trans.error = null;
  trans.running = (async () => {
    for (let i = 0; i < todo.length; i += 15) {
      const batch = todo.slice(i, i + 15);
      try {
        const out = await translateMany(batch);
        batch.forEach((t, k) => (out[k] ? (translations[hashText(t)] = out[k]) : trans.failed.add(hashText(t))));
        await writeJsonAtomic(TRANS_FILE, translations);
      } catch (err) {
        trans.error = String(err.message || err);
        console.error('[katalog] terjemahan gagal:', trans.error);
        if (/tidak ditemukan|login|Not logged/i.test(trans.error)) break; // tidak ada gunanya mencoba batch lain
        batch.forEach((t) => trans.failed.add(hashText(t)));
      }
      trans.done = Math.min(todo.length, i + batch.length);
    }
  })().finally(() => (trans.running = null));
}

// ---------- "skill apa untuk tugas ini?" ----------
let lastCatalog = [];
let asking = false;
async function askCatalog({ q, lang }) {
  q = String(q ?? '').trim().slice(0, 400);
  if (q.length < 3) throw new Error(lang === 'en' ? 'describe the task first' : 'tulis tugasnya dulu');
  if (asking) throw new Error(lang === 'en' ? 'still answering the previous question' : 'masih menjawab pertanyaan sebelumnya');
  if (!lastCatalog.length) await catalogPayload();
  // Daftar ringkas: satu baris per item; nomor baris dipetakan balik ke id asli.
  const pool = lastCatalog.filter((i) => i.kind !== 'plugin');
  const lines = pool.map(
    (i, n) =>
      `${n}\t${i.kind}\t${i.kind === 'skill' || i.kind === 'command' ? i.invoke : i.name}\t${i.origin?.label ?? ''}\t${i.scopeLabel}\t${String(i.desc).replace(/\s+/g, ' ').slice(0, 170)}`,
  );
  const prompt = `Anda membantu pengguna Claude Code memilih skill / slash command / subagent / server MCP yang sudah terpasang untuk sebuah tugas.
Tugas pengguna: «${q}»

Daftar yang terpasang (no, jenis, cara panggil/nama, asal, lokasi, deskripsi):
${lines.join('\n')}

Pilih 1–5 item yang PALING cocok, urut dari yang terbaik; utamakan item yang mencakup seluruh alur tugas sebelum item yang hanya satu langkahnya. Kalau tidak ada yang cocok, kembalikan array kosong.
Untuk tiap item tulis alasan singkat (maks 20 kata) dalam bahasa ${lang === 'en' ? 'Inggris' : 'Indonesia'}; sebutkan kapan dipakai atau urutannya kalau beberapa item dipakai bersama.
Balas HANYA JSON: [{"no": 12, "why": "…"}]`;
  asking = true;
  try {
    const raw = await runClaude(prompt, { model: 'sonnet', timeoutMs: 90_000 }); // Sonnet: pilihan lebih tepat, tetap ±5 dtk
    const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1) || '[]');
    return arr
      .filter((r) => Number.isInteger(r?.no) && pool[r.no])
      .slice(0, 5)
      .map((r) => ({ id: pool[r.no].id, why: String(r.why ?? '').slice(0, 300) }));
  } finally {
    asking = false;
  }
}

let lastItems = [];
async function catalogPayload() {
  // Belum pernah dipindai: jangan buat browser menunggu; halaman memuat ulang saat siap.
  if (scan.ready) await refreshHistory();
  else refreshHistory();
  lastItems = scanInstalled();
  // Item tanpa tanggal pasang (MCP, dll.): tanggal pertama kali terlihat. Pemindaian pertama = sudah lama ada.
  const first = !existsSync(SEEN_FILE);
  const seen = readJsonSync(SEEN_FILE, {});
  let changed = first;
  for (const it of lastItems)
    if (!(it.id in seen)) {
      seen[it.id] = first ? 0 : Date.now();
      changed = true;
    }
  if (changed) await writeJsonAtomic(SEEN_FILE, seen);
  const usage = usageFromHistory(history, createUsage());
  const items = buildCatalog(lastItems, usage, catalogNotes, seen);
  queueTranslations(items.filter((i) => i.desc && !i.descId).map((i) => i.desc));
  for (const i of items) if (!i.descId && i.desc) i.descId = translations[hashText(i.desc)] ?? null;
  lastCatalog = items;
  return {
    items,
    translating: trans.running ? { done: trans.done, total: trans.total } : null,
    translateError: trans.error,
    scannedAt: Date.now(),
    notes: catalogNotes, // untuk kartu gabungan (id grup) di halaman
    usageReady: scan.ready,
    progress: scan.progress,
  };
}

function cleanNote(body = {}) {
  const tags = (Array.isArray(body.tags) ? body.tags : String(body.tags ?? '').split(','))
    .map((t) => String(t).trim().toLowerCase().slice(0, 24))
    .filter(Boolean)
    .slice(0, 8);
  const note = {
    fav: Boolean(body.fav),
    text: String(body.text ?? '').slice(0, 2000),
    tags: [...new Set(tags)],
    origin: String(body.origin ?? '').trim().slice(0, 80), // asal yang diisi manual, mis. "Panniantong/Agent-Reach"
  };
  return note.fav || note.text || note.tags.length || note.origin ? note : null;
}

// Pesan terakhir asisten dari transcript (JSONL), hanya membaca ekor berkas.
async function lastAssistantText(path) {
  if (!path || typeof path !== 'string') return '';
  let fh;
  try {
    fh = await open(path, 'r');
    const { size } = await fh.stat();
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('"assistant"')) continue;
      try {
        const row = JSON.parse(line);
        const content = row?.message?.content;
        if (row?.type !== 'assistant' || !Array.isArray(content)) continue;
        // Subagent menyerahkan laporan akhirnya lewat tool (mis. SubagentHandback), bukan teks.
        const handback = content.find((b) => b.type === 'tool_use' && /handback/i.test(b.name ?? ''));
        if (handback) {
          const strings = Object.values(handback.input ?? {}).filter((v) => typeof v === 'string');
          const longest = strings.sort((a, b) => b.length - a.length)[0];
          if (longest) return longest;
        }
        const text = content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join(' ')
          .trim();
        if (text) return text;
      } catch {
        /* baris terpotong di awal buffer */
      }
    }
  } catch {
    /* transcript tidak terbaca: diam saja */
  } finally {
    await fh?.close();
  }
  return '';
}

/** Judul sesi (custom-title / ai-title) dan branch git terakhir dari ekor transcript. */
async function readSessionMeta(path) {
  if (!path || typeof path !== 'string') return {};
  let fh;
  try {
    fh = await open(path, 'r');
    const { size } = await fh.stat();
    const len = Math.min(size, 768 * 1024);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const text = buf.toString('utf8');
    const last = (re) => {
      let m;
      let out = null;
      while ((m = re.exec(text))) out = m[1];
      return out;
    };
    const custom = last(/"type":"custom-title"[^\n]*?"customTitle":"((?:[^"\\]|\\.)*)"/g);
    const ai = last(/"aiTitle":"((?:[^"\\]|\\.)*)"/g);
    const branch = last(/"gitBranch":"((?:[^"\\]|\\.)*)"/g);
    const unq = (s) => (s ? JSON.parse(`"${s}"`) : '');
    return { title: clip(unq(custom || ai), 90), branch: unq(branch) };
  } catch {
    return {};
  } finally {
    await fh?.close();
  }
}

async function refreshMeta(sid) {
  const s = state.sessions.get(sid);
  if (!s?.tp) return;
  if (setSessionMeta(state, sid, await readSessionMeta(s.tp))) broadcast();
}

function keepSample(p) {
  const cut = (v, d = 0) => {
    if (typeof v === 'string') return v.length > 300 ? v.slice(0, 300) + '…' : v;
    if (Array.isArray(v)) return d > 3 ? '[…]' : v.slice(0, 5).map((x) => cut(x, d + 1));
    if (v && typeof v === 'object') {
      if (d > 3) return '{…}';
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x, d + 1)]));
    }
    return v;
  };
  samples.unshift({ at: new Date().toISOString(), payload: cut(p) });
  if (samples.length > 40) samples.length = 40;
}

async function ingest(payload) {
  const ts = Date.now();
  keepSample(payload);
  if (payload.hook_event_name === 'Stop' || payload.hook_event_name === 'SubagentStop') {
    payload.say =
      payload.last_assistant_message ||
      (await lastAssistantText(
        payload.hook_event_name === 'SubagentStop' ? payload.agent_transcript_path : payload.transcript_path,
      ));
  }
  const e = normalize(payload, ts);
  releaseAnsweredElsewhere(payload);
  applyEvent(state, e, team);
  petEvent(e);
  await appendFile(dayFile(ts), JSON.stringify(e) + '\n');
  broadcast();
  if (e.tp) refreshMeta(e.sid); // judul bisa berubah setelah prompt / jawaban
  return e;
}

// ---------- izin & pertanyaan yang dijawab dari web ----------

// Izin & pertanyaan ditahan sampai dijawab di pet/halaman Agent Office (batas aman 30 menit);
// sesudah itu, atau kalau semua halaman/pet terputus > 10 dtk, dialog biasa muncul di VS Code.
const WAIT_MS = 30 * 60_000;
const ORPHAN_MS = 10_000;
const pending = new Map(); // id → { item, resolve }
let pendingSeq = 0;

function summarizeInput(tool, input = {}) {
  if (tool === 'Bash') return clip(input.command, 400);
  if (input.file_path) return redact(input.file_path);
  if (input.url) return clip(input.url, 200);
  if (input.query) return clip(input.query, 200);
  const d = describeTool(tool, input);
  if (d) return d;
  try {
    return clip(JSON.stringify(input), 300);
  } catch {
    return '';
  }
}

/**
 * Tahan jawaban hook selama halaman kantor terbuka. Mengembalikan jawaban dari web,
 * atau null kalau tidak ada yang membuka halaman / waktunya habis / Claude membatalkan.
 */
function waitForWeb(req, item) {
  // Halaman Agent Office atau pet desktop yang terbuka bisa menjawab.
  if (!clients.size) return Promise.resolve(null);
  const id = `p${Date.now().toString(36)}${(pendingSeq += 1)}`;
  item = { id, createdAt: Date.now(), expiresAt: Date.now() + WAIT_MS, ...item };
  return new Promise((resolve) => {
    const done = (answer, why = 'dijawab lewat web') => {
      if (!pending.has(id)) return;
      clearTimeout(timer);
      pending.delete(id);
      console.log(`[${new Date().toISOString()}] ${item.kind} ${item.tool} (${item.project}) → ${answer ? why : why}`);
      broadcast(true);
      resolve(answer);
    };
    const timer = setTimeout(() => done(null, 'waktu habis, dialihkan ke VS Code'), WAIT_MS);
    req.socket.once('close', () => done(null, 'dibatalkan Claude Code')); // hook dihentikan (mis. pengguna menekan Esc)
    pending.set(id, { item, done });
    broadcast(true);
  });
}

const inputKey = (v) => {
  try {
    return JSON.stringify(v ?? {});
  } catch {
    return '';
  }
};

/**
 * Hook PermissionRequest tidak dihentikan Claude Code saat dialognya dijawab langsung di VS Code,
 * jadi kartunya bisa tertinggal. Event sesudahnya dari sesi + agen yang sama menandakan sudah dijawab:
 * tool yang sama selesai/gagal (input identik), atau gilirannya berakhir / ada prompt baru.
 */
function releaseAnsweredElsewhere(p) {
  if (!pending.size) return;
  const ev = p.hook_event_name;
  const agent = p.agent_id ?? '';
  for (const { item, done } of [...pending.values()]) {
    if (item.sid !== p.session_id || item.agent !== agent) continue;
    const sameTool = (ev === 'PostToolUse' || ev === 'PostToolUseFailure') && p.tool_name === item.tool && inputKey(p.tool_input) === item.inputKey;
    const turnOver = ev === 'Stop' || ev === 'StopFailure' || ev === 'SubagentStop' || ev === 'UserPromptSubmit';
    if (sameTool || turnOver) done(null, 'dijawab langsung di Claude Code');
  }
}

function whoOf(p) {
  if (p.agent_id) return (team.types[p.agent_type] ?? team.types['*']).name;
  return team.lead.name;
}

function sessionOf(p) {
  const s = state.sessions.get(p.session_id);
  return { sid: p.session_id, project: s?.project ?? '', title: s?.title ?? '' };
}

function questionsOf(input) {
  return (input?.questions ?? []).map((q) => ({
    question: String(q.question ?? ''),
    header: String(q.header ?? ''),
    multiSelect: Boolean(q.multiSelect),
    options: (q.options ?? []).map((o) => ({ label: String(o.label ?? ''), description: String(o.description ?? '') })),
  }));
}

/**
 * Hook PermissionRequest (sinkron). Dialog pertanyaan Claude (AskUserQuestion) juga lewat jalur ini,
 * jadi satu hook melayani keduanya: izin → allow/deny, pertanyaan → allow + jawaban di updatedInput.
 */
async function handlePermission(req) {
  const p = JSON.parse((await readBody(req)).toString('utf8'));
  await ingest(p);
  const base = { ...sessionOf(p), who: whoOf(p), tool: p.tool_name, agent: p.agent_id ?? '', inputKey: inputKey(p.tool_input) };
  const questions = p.tool_name === 'AskUserQuestion' ? questionsOf(p.tool_input) : [];
  const answer = questions.length
    ? await waitForWeb(req, { kind: 'question', ...base, questions })
    : await waitForWeb(req, { kind: 'permission', ...base, summary: summarizeInput(p.tool_name, p.tool_input) });
  if (!answer) return {};
  let decision;
  if (answer.answers) decision = { behavior: 'allow', updatedInput: { ...p.tool_input, answers: answer.answers } };
  else if (answer.decision === 'allow') decision = { behavior: 'allow' };
  else decision = { behavior: 'deny', message: 'Ditolak lewat Agent Office.' };
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
}

function decide(id, body) {
  const entry = pending.get(id);
  if (!entry) throw new Error('permintaan ini sudah tidak menunggu (dijawab di VS Code atau waktunya habis)');
  if (entry.item.kind === 'permission') {
    if (!['allow', 'deny'].includes(body.decision)) throw new Error('keputusan harus allow/deny');
    entry.done({ decision: body.decision });
  } else {
    const answers = body.answers;
    if (!answers || typeof answers !== 'object') throw new Error('jawaban kosong');
    const valid = Object.fromEntries(
      entry.item.questions
        .filter((q) => typeof answers[q.question] === 'string' && answers[q.question].trim())
        .map((q) => [q.question, answers[q.question].trim().slice(0, 500)]),
    );
    if (Object.keys(valid).length !== entry.item.questions.length) throw new Error('semua pertanyaan perlu dijawab');
    entry.done({ answers: valid });
  }
}

// inputKey/agent hanya untuk pencocokan di server; tidak perlu dikirim ke halaman.
const pendingList = () => [...pending.values()].map(({ item: { inputKey: _k, agent: _a, ...rest } }) => rest);

// ---------- SSE ----------

const clients = new Set();
let lastSent = '';

function fullSnap() {
  const snap = { ...snapshot(state, team), pending: pendingList() };
  snap.pet = petView(pet, snap);
  snap.petFeed = petFeed(snap);
  return snap;
}

// ---------- pet ----------

const FEED_MS = 3 * 60_000;
/** Pesan untuk kartu pet: selesai (dengan cuplikan jawaban terakhir) dan gagal, 3 menit terakhir. */
function petFeed(snap, now = Date.now()) {
  if (pet.mutedUntil > now) return []; // dibisukan: izin & pertanyaan tetap tampil (lewat pending)
  return (snap.notices ?? [])
    .filter((n) => ['done', 'agent', 'fail'].includes(n.kind) && now - n.ts < FEED_MS)
    .slice(0, 6)
    .map((n) => {
      const sess = snap.sessions?.find((x) => x.sid === n.sid);
      const say = n.kind === 'done' && sess?.say ? clip(sess.say, 240) : '';
      return { id: n.id, kind: n.kind, ts: n.ts, who: n.who, text: n.text, say, sid: n.sid, title: sess?.title || sess?.project || '' };
    });
}
const PET_FILE = join(DATA, 'pet.json');
const pet = (() => {
  const saved = readJsonSync(PET_FILE, null);
  if (saved) return createPet(saved);
  // Pertama kali: skill/MCP yang sudah pernah dipakai tidak memberi bonus "pertama kali".
  const u = usageFromHistory(history, createUsage());
  return createPet({}, [...[...u.skill.keys(), ...u.cmd.keys()].map((k) => `skill:${k}`), ...[...u.mcp.keys()].map((k) => `mcp:${k}`)]);
})();
let petSaveTimer = null;
function petSave() {
  petSaveTimer ??= setTimeout(() => {
    petSaveTimer = null;
    writeJsonAtomic(PET_FILE, petToJson(pet)).catch(() => {});
  }, 5000);
}
function petEvent(e) {
  if (!petOnEvent(pet, e)) return;
  petSaveTimer ??= setTimeout(() => {
    petSaveTimer = null;
    writeJsonAtomic(PET_FILE, petToJson(pet)).catch(() => {});
  }, 5000);
}
// Mood bisa berubah tanpa event baru (senang/sedih habis waktunya): kirim ulang kalau berubah.
let lastMood = '';
setInterval(() => {
  if (!clients.size) return;
  const v = petView(pet, fullSnap());
  const key = `${v.mood}|${v.follow}|${v.level}|${Boolean(v.gain)}`;
  if (key !== lastMood) {
    lastMood = key;
    broadcast();
  }
}, 2000);

/** Satu baris untuk status line Claude Code (stdin JSON status line → teks). */
function petLine(body) {
  const snap = fullSnap();
  const v = snap.pet;
  const sid = body?.session_id;
  const sess = snap.sessions.find((x) => x.sid === sid);
  const mine = snap.chars.filter((c) => c.sid === sid);
  const kit = mine.find((c) => c.kit)?.kit;
  const fail = mine.find((c) => c.fail)?.fail;
  const lead = mine.find((c) => c.key.startsWith('lead'));
  const parts = [`\x1b[33m${FACES[v.mood]}\x1b[0m Lv${v.level}`];
  if (fail) parts.push(`\x1b[31m⚠ ${fail.tool || 'gagal'}\x1b[0m`);
  else if (kit) parts.push(`${kit.kind === 'mcp' ? '🔌' : '📚'} ${kit.name}`);
  else if (lead?.status === 'working' && lead.tool) parts.push(`⌨ ${lead.tool}`);
  const where = sess?.project ?? String(body?.workspace?.current_dir ?? '').split('/').pop();
  if (where) parts.push(where + (sess?.branch ? ` ⎇ ${sess.branch}` : ''));
  if (v.gain) parts.push(`\x1b[32m+${v.gain.xp} XP\x1b[0m`);
  return parts.join(' · ');
}

function broadcast(force = false) {
  const snap = fullSnap();
  const { now: _now, ...rest } = snap;
  const body = JSON.stringify(rest);
  if (!force && body === lastSent) return;
  lastSent = body;
  const msg = `data: ${JSON.stringify(snap)}\n\n`;
  for (const res of clients) res.write(msg);
}

/** Beri tahu semua tab bahwa pengaturan/aset berubah; mereka memuat ulang /api/config. */
function broadcastConfig() {
  for (const res of clients) res.write(`event: config\ndata: {}\n\n`);
  broadcast(true);
}

// Ruangan ikut berubah karena waktu (briefing → kerja, kembaran pergi), jadi cek tiap detik.
setInterval(() => broadcast(), 1000).unref();
setInterval(() => prune(state), 60_000).unref();

// ---------- HTTP ----------

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on('end', () => (size > limit ? reject(new Error('berkas terlalu besar')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
const readJson = async (req) => JSON.parse((await readBody(req)).toString('utf8') || '{}');

// Halaman web lain tidak boleh mengirim event palsu atau mengubah pengaturan.
const originOk = (req) => !req.headers.origin || ORIGINS.has(req.headers.origin);

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const file = normPath(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !existsSync(file)) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

// Pipeline gambar (sharp) dimuat saat pertama dipakai, supaya server tetap jalan tanpa sharp.
let assetsLib;
const assets = async () => (assetsLib ??= await import('./lib/assets.mjs'));

async function uploadCharacter(req, id, pose) {
  if (!settings.characters[id] || !isCharacterId(id)) throw new Error('karakter tidak ada');
  if (!['front', 'side', 'back', 'portrait'].includes(pose)) throw new Error('pose tidak dikenal');
  const { assertImage, processSprite } = await assets();
  const buf = await readBody(req, MAX_UPLOAD);
  await assertImage(buf);
  const sharp = (await import('sharp')).default;
  const dir = join(RAW, id);
  mkdirSync(dir, { recursive: true });
  await sharp(buf).png().toFile(join(dir, `${pose}.png`));
  if (!existsSync(join(dir, 'front.png'))) return { ok: true, note: 'Tersimpan. Unggah gambar depan supaya karakter tampil.' };
  const { substituted } = await processSprite(dir, join(CHAR_OUT, id), { targetArea: 19400 }); // ukuran visual setara Jensen
  const manifest = readManifest();
  manifest[id] = { v: Date.now() };
  await writeJsonAtomic(manifestFile, manifest);
  broadcastConfig();
  return { ok: true, substituted };
}

async function uploadOffice(req, name, time) {
  const { assertImage, processOffice } = await assets();
  const buf = await readBody(req, MAX_UPLOAD);
  await assertImage(buf);
  const [next, id] = addOffice(settings, { name, file: '', time: ['day', 'night'].includes(time) ? time : null });
  const file = `${id}.png`;
  next.offices.find((o) => o.id === id).file = file;
  mkdirSync(join(RAW, 'offices'), { recursive: true });
  const sharp = (await import('sharp')).default;
  await sharp(buf).png().toFile(join(RAW, 'offices', file));
  await processOffice(buf, join(OFFICE_OUT, file));
  // Titik awal: koordinat peta utama; periksa & sesuaikan di halaman Peta.
  const base = coordsFor('malam');
  if (base) await writeJsonAtomic(join(COORDS, `${id}.json`), base);
  await saveSettings(next);
  return { ok: true, id };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const { pathname } = url;
  const mutating = req.method !== 'GET' && req.method !== 'HEAD';
  try {
    if (pathname === '/api/hook' && req.method === 'POST') {
      if (req.headers.origin) return send(res, 403, { error: 'browser origin not allowed' });
      await ingest(JSON.parse((await readBody(req)).toString('utf8')));
      return send(res, 200, { ok: true });
    }
    // Hook sinkron: jawaban (atau {} = biarkan Claude Code bertanya seperti biasa) dikirim balik ke hook.
    if (pathname === '/api/permission' && req.method === 'POST') {
      if (req.headers.origin) return send(res, 403, { error: 'browser origin not allowed' });
      return send(res, 200, await handlePermission(req));
    }
    if (mutating && pathname.startsWith('/api/') && !originOk(req)) return send(res, 403, { error: 'origin not allowed' });

    if (pathname === '/api/state') return send(res, 200, fullSnap());
    if (pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ version: BOOT_ID })}\n\n`);
      res.write(`data: ${JSON.stringify(fullSnap())}\n\n`);
      res.isPet = url.searchParams.get('pet') === '1';
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
        // Tidak ada lagi yang bisa menjawab: kembalikan permintaan yang tertahan ke VS Code.
        if (!clients.size && pending.size)
          setTimeout(() => {
            if (clients.size) return;
            for (const { done } of [...pending.values()]) done(null, 'halaman & pet tertutup, dialihkan ke VS Code');
          }, ORPHAN_MS);
      });
      return;
    }
    if (pathname === '/api/config') return send(res, 200, configPayload());
    let pm = pathname.match(/^\/api\/pending\/([a-z0-9]+)$/);
    if (pm && req.method === 'POST') {
      const body = await readJson(req);
      // Catat dari mana jawaban datang (halaman office / pet desktop / lainnya).
      const ref = String(req.headers.referer ?? '').replace(/^https?:\/\/[^/]+/, '') || '-';
      const ua = /AgentOfficePet|AppleWebKit(?!.*Chrome)/.test(req.headers['user-agent'] ?? '') ? 'webview' : /Chrome/.test(req.headers['user-agent'] ?? '') ? 'chrome' : 'lain';
      console.log(`[${new Date().toISOString()}] jawaban ${pm[1]}: ${body.decision ?? 'answers'} dari ${ref} (${ua})`);
      decide(pm[1], body);
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/settings' && req.method === 'PUT') {
      await saveSettings(applyPatch(settings, await readJson(req)));
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/characters' && req.method === 'POST') {
      const body = await readJson(req);
      let [next, id] = addCharacter(settings, body);
      if (body.type) next = applyPatch(next, { assign: { [body.type]: id } });
      await saveSettings(next);
      return send(res, 200, { ok: true, id });
    }
    if (pathname === '/api/templates' && req.method === 'POST') {
      const [next, id] = saveTemplate(settings, (await readJson(req)).name);
      await saveSettings(next);
      return send(res, 200, { ok: true, id });
    }
    const tm = pathname.match(/^\/api\/templates\/([a-z0-9-]+)(\/apply)?$/);
    if (tm && req.method === 'POST' && tm[2]) {
      await saveSettings(applyTemplate(settings, tm[1]));
      return send(res, 200, { ok: true });
    }
    if (tm && req.method === 'DELETE' && !tm[2]) {
      await saveSettings(removeTemplate(settings, tm[1]));
      return send(res, 200, { ok: true });
    }
    let m = pathname.match(/^\/api\/characters\/([a-z0-9-]+)$/);
    if (m && req.method === 'DELETE') {
      await saveSettings(removeCharacter(settings, m[1]));
      return send(res, 200, { ok: true });
    }
    m = pathname.match(/^\/api\/upload\/character\/([a-z0-9-]+)\/(front|side|back|portrait)$/);
    if (m && req.method === 'POST') return send(res, 200, await uploadCharacter(req, m[1], m[2]));
    if (pathname === '/api/upload/office' && req.method === 'POST') {
      return send(res, 200, await uploadOffice(req, url.searchParams.get('name') || 'Peta baru', url.searchParams.get('time')));
    }
    m = pathname.match(/^\/api\/offices\/([a-z0-9-]+)$/);
    if (m && req.method === 'DELETE') {
      const id = m[1];
      if (settings.theme.office === id) throw new Error('peta sedang dipakai — pilih peta lain dulu');
      if (settings.offices.length <= 1) throw new Error('harus ada minimal satu peta');
      const next = structuredClone(settings);
      next.offices = next.offices.filter((o) => o.id !== id);
      await saveSettings(next);
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/coordinates' && req.method === 'POST') {
      const office = url.searchParams.get('office') || 'malam';
      if (!settings.offices.some((o) => o.id === office)) throw new Error('peta tidak ditemukan');
      const coords = await readJson(req);
      if (!coords || typeof coords !== 'object' || !coords.rooms) throw new Error('butuh {rooms, seats, doors, nodes, edges}');
      await writeJsonAtomic(join(COORDS, `${office}.json`), coords);
      broadcastConfig();
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/pet' && req.method === 'GET') return send(res, 200, fullSnap().pet);
    if (pathname === '/api/pet/pat' && req.method === 'POST') {
      if (petPat(pet)) petSave();
      broadcast(true);
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/pet/mute' && req.method === 'POST') {
      const minutes = Math.min(24 * 60, Math.max(0, Number((await readJson(req)).minutes) || 0));
      pet.mutedUntil = minutes ? Date.now() + minutes * 60_000 : 0;
      petSave();
      broadcast(true);
      return send(res, 200, { ok: true, mutedUntil: pet.mutedUntil });
    }
    // Panel pet → "sorot sesi ini" di halaman office yang terbuka (mis. monitor khusus).
    if (pathname === '/api/focus' && req.method === 'POST') {
      const sid = String((await readJson(req)).sid ?? '').slice(0, 80);
      for (const c of clients) if (!c.isPet) c.write(`event: focus\ndata: ${JSON.stringify({ sid })}\n\n`);
      return send(res, 200, { ok: true });
    }
    m = pathname.match(/^\/api\/session\/([\w-]{1,80})\/last$/);
    if (m && req.method === 'GET') {
      const sess = state.sessions.get(m[1]);
      if (!sess) return send(res, 404, { error: 'sesi tidak ditemukan' });
      const text = (await lastAssistantText(sess.tp)) || sess.say || '';
      return send(res, 200, { text: redact(text) });
    }
    if (pathname === '/api/pet/line' && req.method === 'POST') {
      let body = {};
      try {
        body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
      } catch {}
      return send(res, 200, petLine(body), 'text/plain; charset=utf-8');
    }
    if (pathname === '/api/catalog' && req.method === 'GET') return send(res, 200, await catalogPayload());
    if (pathname === '/api/catalog/doc' && req.method === 'GET') {
      // Hanya berkas yang memang ada di hasil pindaian — bukan path sembarang dari browser.
      if (!lastItems.length) await catalogPayload();
      const id = url.searchParams.get('id');
      const item = lastItems.find((i) => i.id === id);
      if (!item) return send(res, 404, { error: 'item tidak ditemukan — pindai ulang' });
      const doc = readDoc(item, url.searchParams.get('lang') === 'en' ? 'en' : 'id');
      if (url.searchParams.get('lang') === 'id' && doc.format === 'md') {
        const cached = translations[`doc:${hashText(doc.text)}`];
        if (cached) return send(res, 200, { ...doc, text: cached, translated: true });
        // Belum ada: terjemahkan hanya kalau diminta (bisa ±1 menit untuk dokumen panjang).
        if (url.searchParams.get('translate') !== '1') return send(res, 200, { ...doc, translated: false });
        const MAX = 40_000;
        let src = doc.text;
        const cut = src.length > MAX;
        if (cut) src = src.slice(0, src.lastIndexOf('\n', MAX));
        const out = (await translateDoc(src)) + (cut ? '\n\n_(dokumen dipotong — bagian selanjutnya hanya ada dalam bahasa aslinya)_' : '');
        translations[`doc:${hashText(doc.text)}`] = out;
        await writeJsonAtomic(TRANS_FILE, translations);
        return send(res, 200, { ...doc, text: out, translated: true });
      }
      return send(res, 200, doc);
    }
    if (pathname === '/api/catalog/ask' && req.method === 'POST') return send(res, 200, { results: await askCatalog(await readJson(req)) });
    if (pathname === '/api/catalog/note' && req.method === 'PUT') {
      const id = url.searchParams.get('id');
      if (!id || id.length > 400) throw new Error('id tidak valid');
      const note = cleanNote(await readJson(req));
      const next = { ...catalogNotes };
      if (note) next[id] = note;
      else delete next[id];
      await writeJsonAtomic(NOTES_FILE, next);
      catalogNotes = next;
      return send(res, 200, { ok: true, note });
    }
    if (pathname === '/api/debug/samples') return send(res, 200, samples);
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    return serveStatic(req, res, pathname);
  } catch (err) {
    return send(res, 400, { error: String(err.message || err) });
  }
});

// Migrasi sekali: koordinat lama menjadi milik peta utama ("malam").
if (!existsSync(join(COORDS, 'malam.json')) && existsSync(join(DATA, 'office-coordinates.json'))) {
  copyFileSync(join(DATA, 'office-coordinates.json'), join(COORDS, 'malam.json'));
  unlinkSync(join(DATA, 'office-coordinates.json'));
}
if (!existsSync(SETTINGS_FILE)) await writeJsonAtomic(SETTINGS_FILE, settings);

const replayed = replayToday();
refreshHistory(); // siapkan cache pemakaian untuk katalog
for (const sid of state.sessions.keys()) refreshMeta(sid);
server.listen(PORT, HOST, () => {
  console.log(`Agent Office → http://localhost:${PORT}  (event diputar ulang: ${replayed})`);
});
