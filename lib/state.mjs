// Model kantor: mengubah event hook Claude Code menjadi daftar karakter + ruangannya.
// Murni (tanpa I/O) supaya bisa diuji: applyEvent() mengubah state, snapshot() membacanya.

export const ROOMS = ['briefing', 'meeting', 'approval', 'workspace', 'command', 'server', 'pantry', 'lounge'];

const LIVE_MS = 45 * 60_000; // sesi tanpa event selama ini dianggap sudah tidak aktif
const CLONE_LINGER_MS = 3 * 60_000; // agent kembar yang selesai tetap tampil sebentar
const BRIEFING_MS = 5_000; // lama singgah di ruang briefing setelah spawn
const MIN_DWELL_MS = 4_000; // karakter tidak pindah ruang lebih cepat dari ini
const TICKER_MAX = 60;
const RECENT_MAX = 12;
const FILES_MAX = 10;

export function createState() {
  return { sessions: new Map(), agents: new Map(), ticker: [], notices: [], noticeSeq: 0, daily: newDaily(null) };
}

// ---------- normalisasi payload hook ----------

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
  /\b[A-Za-z0-9+/]{48,}={0,2}/g,
];

export function redact(text) {
  let s = String(text ?? '');
  for (const re of SECRET_PATTERNS) s = s.replace(re, '[REDACTED]');
  return s;
}

export function clip(text, n) {
  const s = redact(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const base = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export function describeTool(tool, input = {}) {
  if (FILE_TOOLS.has(tool)) return base(input.file_path ?? input.notebook_path);
  switch (tool) {
    case 'Bash':
      return clip(input.description || input.command, 70);
    case 'Grep':
    case 'Glob':
      return clip(input.pattern, 50);
    case 'WebFetch':
      try {
        return new URL(input.url).host;
      } catch {
        return '';
      }
    case 'WebSearch':
      return clip(input.query, 60);
    case 'Agent':
    case 'Task':
      return clip(input.description, 60);
    case 'Skill':
      return clip(input.skill, 40);
    default:
      return '';
  }
}

/** Payload hook mentah → event ringkas yang disimpan (tanpa isi berkas atau keluaran tool). */
export function normalize(p, ts) {
  const ev = p.hook_event_name;
  const input = p.tool_input ?? {};
  const out = { ts, ev, sid: p.session_id ?? null, cwd: p.cwd ?? null };
  if (p.agent_id) out.aid = p.agent_id;
  if (p.agent_type) out.atype = p.agent_type;
  if (p.tool_name) {
    out.tool = p.tool_name;
    out.detail = describeTool(p.tool_name, input);
    if (p.tool_name === 'Agent' || p.tool_name === 'Task') {
      out.sub = input.subagent_type || 'general-purpose';
      out.desc = clip(input.description, 80);
    }
  }
  if (p.permission_mode) out.mode = p.permission_mode;
  // Lokasi transcript (lokal) untuk membaca judul & branch sesi; cukup di event yang jarang.
  if ((ev === 'SessionStart' || ev === 'UserPromptSubmit' || ev === 'Stop') && p.transcript_path) out.tp = p.transcript_path;
  // Prompt dari agent/teammate lain dibungkus tag (<agent-message …>); tampilkan isinya saja.
  if (ev === 'UserPromptSubmit') {
    const raw = String(p.prompt ?? '');
    out.prompt = clip(raw.replace(/<[^>\n]{1,200}>/g, ' '), 140);
    // Slash command yang diketik (/tdd, /figma:figma-use) — untuk statistik katalog.
    const cmd = raw.match(/<command-name>\/?([\w:.-]{1,80})<\/command-name>/) || raw.match(/^\s*\/([a-z0-9][\w:.-]{0,79})(?=\s|$)/i);
    if (cmd) out.cmd = cmd[1];
  }
  if (ev === 'Notification') {
    out.ntype = p.notification_type ?? null;
    out.msg = clip(p.message, 120);
  }
  if (ev === 'SessionEnd') out.reason = p.reason ?? null;
  // Gagal: hanya potongan pesan error (dimasking), bukan keluaran lengkap.
  if (ev === 'PostToolUseFailure' || ev === 'StopFailure') {
    const r = p.tool_response;
    out.err = clip(p.error ?? p.error_message ?? (typeof r === 'string' ? r : (r?.stderr ?? r?.error)) ?? p.message ?? p.reason ?? '', 160);
    if (p.is_interrupt) out.interrupt = true;
  }
  if (ev === 'SessionStart') out.source = p.source ?? null;
  if (p.say) out.say = clip(p.say, 220);
  return out;
}

// ---------- ruangan per tool ----------

// Tool "administratif" tidak memindahkan karakter dari ruangannya sekarang.
const META_TOOLS = new Set([
  'TodoWrite',
  'ToolSearch',
  'Skill',
  'TaskStop',
  'Monitor',
  'SendMessage',
  'ListAgents',
  'ScheduleWakeup',
  'SubagentHandback',
  'ExitPlanMode',
  'EnterPlanMode',
]);

const DEFAULT_RULES = { read: 'workspace', edit: 'workspace', bash: 'server', web: 'meeting', mcp: 'meeting', other: 'workspace' };

export function toolGroup(tool = '') {
  if (['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'].includes(tool)) return 'read';
  if (EDIT_TOOLS.has(tool)) return 'edit';
  if (['Bash', 'BashOutput', 'KillShell'].includes(tool)) return 'bash';
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'web';
  if (tool.startsWith('mcp__')) return 'mcp';
  return 'other';
}

/** Ruangan untuk sebuah tool menurut aturan di pengaturan, atau null kalau tidak memindahkan karakter. */
export function toolRoom(tool = '', rules = DEFAULT_RULES) {
  if (META_TOOLS.has(tool)) return null;
  if (tool === 'Agent' || tool === 'Task') return 'briefing';
  const room = (rules ?? DEFAULT_RULES)[toolGroup(tool)] ?? DEFAULT_RULES[toolGroup(tool)];
  return room === 'stay' ? null : room;
}

const QUESTION_TOOLS = new Set(['AskUserQuestion']);

function setWorkRoom(actor, tool, ts, rules) {
  const next = toolRoom(tool, rules);
  if (!next || next === actor.workRoom) return;
  if (!actor.workRoom || ts - actor.workRoomTs >= MIN_DWELL_MS) {
    actor.workRoom = next;
    actor.workRoomTs = ts;
  }
}

// ---------- jejak aktivitas ----------

function verb(tool, detail) {
  switch (tool) {
    case 'Read':
      return `membaca ${detail}`;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `mengedit ${detail}`;
    case 'Write':
      return `menulis ${detail}`;
    case 'Bash':
      return `menjalankan: ${detail}`;
    case 'Grep':
      return `mencari "${detail}"`;
    case 'Glob':
      return `mencari berkas ${detail}`;
    case 'WebSearch':
      return `mencari di web: ${detail}`;
    case 'WebFetch':
      return `membuka ${detail}`;
    case 'Agent':
    case 'Task':
      return `memberi tugas: ${detail}`;
    case 'AskUserQuestion':
      return 'bertanya kepada Anda';
    default:
      return detail ? `${tool} · ${detail}` : tool;
  }
}

/** Tool yang cukup penting untuk masuk ticker (baca/cari terlalu ramai, cukup di riwayat karakter). */
const TICKER_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'WebSearch', 'WebFetch', 'AskUserQuestion']);

function remember(actor, e, text) {
  actor.recent.unshift({ ts: e.ts, text });
  if (actor.recent.length > RECENT_MAX) actor.recent.length = RECENT_MAX;
  if (EDIT_TOOLS.has(e.tool) && e.detail) {
    actor.files = [e.detail, ...actor.files.filter((f) => f !== e.detail)].slice(0, FILES_MAX);
  }
}

function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} dtk`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} mnt` : `${Math.floor(m / 60)} j ${m % 60} mnt`;
}

function pushTicker(state, e, text, who) {
  state.ticker.unshift({ ts: e.ts, text, who, sid: e.sid });
  if (state.ticker.length > TICKER_MAX) state.ticker.length = TICKER_MAX;
}

/** Riwayat notifikasi (izin, pertanyaan, selesai) untuk lonceng di halaman. */
function pushNotice(state, e, kind, who, text) {
  state.noticeSeq += 1;
  state.notices.unshift({ id: `${e.ts}-${state.noticeSeq}`, ts: e.ts, kind, who, text, sid: e.sid });
  if (state.notices.length > 40) state.notices.length = 40;
}

/** Judul & branch dibaca server dari transcript (di luar applyEvent karena perlu I/O). */
export function setSessionMeta(state, sid, meta) {
  const s = state.sessions.get(sid);
  if (!s) return false;
  let changed = false;
  for (const k of ['title', 'branch']) {
    if (meta[k] && meta[k] !== s[k]) {
      s[k] = meta[k];
      changed = true;
    }
  }
  return changed;
}

// ---------- statistik harian ----------

const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

function newDaily(date) {
  return { date, prompts: 0, tools: 0, fails: 0, files: new Set(), activeMs: 0, projects: new Map() };
}

function daily(state, e, project) {
  const key = dayKey(e.ts);
  if (state.daily.date !== key) state.daily = newDaily(key);
  const d = state.daily;
  if (!d.projects.has(project)) d.projects.set(project, { prompts: 0, tools: 0, fails: 0, files: new Set(), activeMs: 0 });
  return [d, d.projects.get(project)];
}

// ---------- state sesi & agent ----------

function projectOf(cwd) {
  return base(cwd) || 'unknown';
}

function session(state, e) {
  let s = state.sessions.get(e.sid);
  if (!s) {
    s = {
      sid: e.sid,
      cwd: e.cwd,
      project: projectOf(e.cwd),
      startTs: e.ts,
      lastTs: e.ts,
      ended: false,
      status: 'idle',
      task: '',
      tool: null,
      detail: '',
      say: '',
      sayTs: 0,
      spawnTs: 0,
      waiting: null, // null | 'permission' | 'question'
      workRoom: null,
      workRoomTs: 0,
      turn: null, // { start, tools, files:Set }
      recent: [],
      files: [],
      pendingSpawns: [],
      title: '',
      branch: '',
      mode: '',
      tp: '',
      toolTotal: 0,
      allFiles: new Set(),
    };
    state.sessions.set(e.sid, s);
  }
  s.lastTs = Math.max(s.lastTs, e.ts);
  if (e.mode) s.mode = e.mode;
  if (e.tp) s.tp = e.tp;
  if (e.cwd && !s.cwd) {
    s.cwd = e.cwd;
    s.project = projectOf(e.cwd);
  }
  s.ended = e.ev === 'SessionEnd';
  return s;
}

function ensureAgent(state, s, e) {
  let a = state.agents.get(e.aid);
  if (!a) {
    const type = e.atype || 'general-purpose';
    // Ambil deskripsi dari antrean spawn sesi ini (FIFO per tipe).
    const i = s.pendingSpawns.findIndex((p) => p.type === type);
    const spawn = i >= 0 ? s.pendingSpawns.splice(i, 1)[0] : null;
    a = {
      aid: e.aid,
      sid: s.sid,
      type,
      desc: spawn?.desc ?? '',
      startTs: e.ts,
      endTs: 0,
      heartbeat: e.ts,
      status: 'working',
      waiting: null,
      tool: null,
      detail: '',
      toolCount: 0,
      workRoom: null,
      workRoomTs: 0,
      say: '',
      sayTs: 0,
      recent: [],
      files: [],
    };
    state.agents.set(e.aid, a);
  }
  if (e.atype && a.type !== e.atype) a.type = e.atype;
  return a;
}

// ---------- penerapan event ----------

export function applyEvent(state, e, team) {
  if (!e?.ev || !e.sid) return;
  const s = session(state, e);
  const [day, proj] = daily(state, e, s.project);
  const nameOf = (type) => (team.types[type] ?? team.types['*'])?.name ?? type;
  const lead = team.lead.name;
  // Tool / giliran gagal (dibatalkan Anda tidak dihitung): tanda ⚠, kartu, notifikasi, statistik.
  const recordFail = (actor, who) => {
    if (e.interrupt) return;
    actor.fail = { tool: e.ev === 'StopFailure' ? '' : e.tool ?? '', detail: e.detail ?? '', text: e.err ?? '', ts: e.ts };
    day.fails = (day.fails ?? 0) + 1;
    proj.fails = (proj.fails ?? 0) + 1;
    const what = e.ev === 'StopFailure' ? 'gagal menyelesaikan jawaban' : `gagal: ${e.tool}${e.detail ? ` · ${e.detail}` : ''}`;
    pushNotice(state, e, 'fail', who, `${who} ${what}`);
    pushTicker(state, e, `⚠ ${who} ${what} (${s.project})`, 'fail');
    remember(actor, e, `⚠ ${what}${e.err ? ` — ${e.err}` : ''}`);
  };

  const countTool = (actorName, actor) => {
    day.tools += 1;
    proj.tools += 1;
    s.toolTotal += 1;
    if (EDIT_TOOLS.has(e.tool) && e.detail) {
      day.files.add(`${s.project}/${e.detail}`);
      proj.files.add(e.detail);
      s.turn?.files.add(e.detail);
      s.allFiles.add(e.detail);
    }
    if (s.turn) s.turn.tools += 1;
    const text = verb(e.tool, e.detail);
    remember(actor, e, text);
    if (TICKER_TOOLS.has(e.tool)) pushTicker(state, e, `${actorName} ${text}`, actor === s ? 'lead' : actor.type);
  };

  // Event dari dalam subagent membawa agent_id.
  if (e.aid && e.ev !== 'SubagentStart' && e.ev !== 'SubagentStop') {
    const a = ensureAgent(state, s, e);
    a.heartbeat = e.ts;
    if (e.ev === 'PreToolUse') {
      a.status = 'working';
      a.waiting = QUESTION_TOOLS.has(e.tool) ? 'question' : null;
      if (a.waiting) pushNotice(state, e, 'question', nameOf(a.type), `${nameOf(a.type)} bertanya kepada Anda`);
      a.tool = e.tool;
      a.detail = e.detail;
      a.kit = kitOf(e) ?? a.kit;
      a.toolCount += 1;
      setWorkRoom(a, e.tool, e.ts, team.rules);
      countTool(nameOf(a.type), a);
    } else if (e.ev === 'PostToolUseFailure') {
      a.waiting = null;
      recordFail(a, nameOf(a.type));
    } else if (e.ev === 'PostToolUse') {
      a.waiting = null;
    } else if (e.ev === 'PermissionRequest' || (e.ev === 'Notification' && e.ntype === 'permission_prompt')) {
      if (a.waiting === 'question') return; // dialog pertanyaan juga lewat jalur izin
      if (!a.waiting) {
        pushTicker(state, e, `${nameOf(a.type)} menunggu izin`, 'approval');
        pushNotice(state, e, 'permission', nameOf(a.type), `${nameOf(a.type)} minta izin: ${verb(e.tool, e.detail)}`);
      }
      a.waiting = 'permission';
    }
    return;
  }

  switch (e.ev) {
    case 'SessionStart':
      s.status = 'idle';
      pushTicker(state, e, `Sesi dimulai di ${s.project}`, 'lead');
      break;
    case 'SessionEnd':
      s.status = 'idle';
      s.waiting = null;
      s.workRoom = null;
      pushTicker(state, e, `Sesi ${s.project} berakhir`, 'lead');
      break;
    case 'UserPromptSubmit':
      s.status = 'working';
      s.waiting = null;
      s.workRoom = null; // membaca prompt di Command Center dulu
      s.task = e.prompt ?? '';
      s.turn = { start: e.ts, tools: 0, files: new Set() };
      day.prompts += 1;
      proj.prompts += 1;
      if (e.cmd) s.kit = { kind: 'skill', name: e.cmd, ts: e.ts };
      remember(s, e, `menerima prompt: ${s.task}`);
      pushTicker(state, e, `${lead} menerima prompt baru (${s.project})`, 'lead');
      break;
    case 'PreToolUse':
      s.kit = kitOf(e) ?? s.kit;
      s.status = 'working';
      s.waiting = QUESTION_TOOLS.has(e.tool) ? 'question' : null;
      if (s.waiting) pushNotice(state, e, 'question', lead, `${lead} bertanya kepada Anda`);
      s.tool = e.tool;
      s.detail = e.detail;
      if (e.tool === 'Agent' || e.tool === 'Task') {
        s.spawnTs = e.ts;
        s.pendingSpawns.push({ type: e.sub, desc: e.desc, ts: e.ts });
        remember(s, e, `memberi tugas ke ${nameOf(e.sub)}: ${e.desc}`);
        pushTicker(state, e, `${lead} memberi tugas ke ${nameOf(e.sub)}: ${e.desc}`, 'lead');
        day.tools += 1;
        proj.tools += 1;
        if (s.turn) s.turn.tools += 1;
      } else {
        setWorkRoom(s, e.tool, e.ts, team.rules);
        countTool(lead, s);
      }
      break;
    case 'PostToolUse':
      s.waiting = null;
      break;
    case 'PostToolUseFailure':
      s.waiting = null;
      recordFail(s, lead);
      break;
    case 'StopFailure':
      s.status = 'idle';
      s.waiting = null;
      s.tool = null;
      recordFail(s, lead);
      break;
    case 'PermissionRequest':
    case 'Notification':
      if (e.ev === 'Notification' && e.ntype !== 'permission_prompt') break;
      if (s.waiting === 'question') break; // dialog pertanyaan juga lewat jalur izin
      if (!s.waiting) {
        pushTicker(state, e, `${lead} menunggu izin di ${s.project}`, 'approval');
        pushNotice(state, e, 'permission', lead, `${lead} minta izin: ${verb(e.tool ?? s.tool, e.detail ?? s.detail)}`);
      }
      s.waiting = 'permission';
      break;
    case 'Stop': {
      s.status = 'idle';
      s.waiting = null;
      s.tool = null;
      s.workRoom = null;
      if (e.say) {
        s.say = e.say;
        s.sayTs = e.ts;
      }
      const t = s.turn;
      if (t) {
        const took = e.ts - t.start;
        day.activeMs += took;
        proj.activeMs += took;
        const parts = [`${t.tools} tool`];
        if (t.files.size) parts.push(`${t.files.size} berkas diubah`);
        parts.push(duration(took));
        pushTicker(state, e, `${lead} selesai menjawab (${s.project}) · ${parts.join(' · ')}`, 'lead');
        pushNotice(state, e, 'done', lead, `${lead} selesai menjawab · ${parts.join(' · ')}`);
        remember(s, e, `selesai · ${parts.join(' · ')}`);
        s.turn = null;
      } else pushTicker(state, e, `${lead} selesai menjawab (${s.project})`, 'lead');
      break;
    }
    case 'SubagentStart': {
      if (!e.atype) break; // payload tanpa tipe berasal dari harness
      const a = ensureAgent(state, s, e);
      remember(a, e, `mulai: ${a.desc || a.type}`);
      pushTicker(state, e, `${nameOf(a.type)} mulai: ${a.desc || a.type}`, a.type);
      break;
    }
    case 'SubagentStop': {
      if (!e.aid || !e.atype) break; // "phantom stop": jangan ubah state siapa pun
      const a = ensureAgent(state, s, e);
      a.status = 'completed';
      a.waiting = null;
      a.endTs = e.ts;
      a.tool = null;
      if (e.say) {
        a.say = e.say;
        a.sayTs = e.ts;
      }
      const parts = [`${a.toolCount} tool`];
      if (a.files.length) parts.push(`${a.files.length} berkas diubah`);
      parts.push(duration(e.ts - a.startTs));
      remember(a, e, `selesai · ${parts.join(' · ')}`);
      pushTicker(state, e, `${nameOf(a.type)} selesai · ${parts.join(' · ')}`, a.type);
      pushNotice(state, e, 'agent', nameOf(a.type), `${nameOf(a.type)} selesai: ${a.desc || a.type} · ${parts.join(' · ')}`);
      break;
    }
  }
}

// ---------- snapshot untuk browser ----------

function isLive(s, now) {
  return !s.ended && now - s.lastTs < LIVE_MS;
}

// Status "menunggu" tanpa event lanjutan selama ini dianggap sudah dijawab/dibatalkan di VS Code
// (mis. Esc), supaya karakter tidak terjebak di Approval Office.
const STALE_WAIT_MS = 10 * 60_000;
const waitingOf = (actor, lastTs, now) => (actor.waiting && now - lastTs < STALE_WAIT_MS ? actor.waiting : null);

const BADGE = { permission: '!', question: '?' };

function leadChar(team, s, clone, now) {
  const t = team.lead;
  let room = 'command';
  let status = s.status;
  const waiting = waitingOf(s, s.lastTs, now);
  if (waiting) {
    room = 'approval';
    status = 'waiting';
  } else if (now - s.spawnTs < BRIEFING_MS) room = 'briefing';
  else if (s.status === 'working' && s.workRoom) room = s.workRoom;
  return {
    key: clone ? `lead:${s.sid}` : 'lead',
    sid: s.sid,
    sprite: t.sprite,
    name: clone ? `${t.name} · ${clip(s.title || `${s.project} ${s.sid.slice(0, 4)}`, 26)}` : t.name,
    role: t.role,
    colour: t.colour,
    room,
    status: isLive(s, now) ? status : 'offline',
    waiting,
    badge: BADGE[waiting] ?? null,
    tool: s.tool,
    detail: s.detail,
    task: s.task,
    say: s.say,
    sayTs: s.sayTs,
    since: s.turn?.start ?? s.lastTs,
    heartbeat: s.lastTs,
    toolCount: s.turn?.tools ?? 0,
    kit: isLive(s, now) && !waiting ? kitView(s.kit, now) : null,
    fail: s.fail && now - s.fail.ts < FAIL_MS ? s.fail : null,
    project: s.project,
    recent: s.recent,
    files: s.files,
    clone,
  };
}

function agentChar(team, a, s, key, clone, now, spec = null) {
  const t = spec ?? team.types[a.type] ?? team.types['*'];
  const waiting = waitingOf(a, a.heartbeat, now);
  let room;
  if (a.status === 'completed') room = 'break';
  else if (waiting) room = 'approval';
  else if (now - a.startTs < BRIEFING_MS || !a.workRoom) room = 'briefing';
  else room = a.workRoom;
  return {
    key,
    sid: a.sid,
    sprite: t.sprite,
    name: clone ? `${t.name} #${clone}` : t.name,
    role: t.role,
    colour: t.colour,
    room,
    status: waiting ? 'waiting' : a.status,
    waiting,
    badge: BADGE[waiting] ?? null,
    tool: a.tool,
    detail: a.detail,
    task: a.desc,
    say: a.say,
    sayTs: a.sayTs,
    since: a.status === 'completed' ? a.endTs : a.startTs,
    startTs: a.startTs,
    heartbeat: a.heartbeat,
    toolCount: a.toolCount,
    kit: a.status === 'working' && !waiting ? kitView(a.kit, now) : null,
    fail: a.fail && now - a.fail.ts < FAIL_MS ? a.fail : null,
    project: s?.project ?? '',
    recent: a.recent,
    files: a.files,
    clone: Boolean(clone),
    completedTs: a.endTs || 0,
  };
}

function restingChar(team, type, key, spec = null) {
  const t = spec ?? (type === 'lead' ? team.lead : team.types[type]);
  return {
    key,
    sprite: t.sprite,
    name: t.name,
    role: t.role,
    colour: t.colour,
    sid: null,
    room: type === 'lead' ? 'command' : 'break',
    status: 'resting',
    waiting: null,
    badge: null,
    tool: null,
    detail: '',
    task: '',
    say: '',
    sayTs: 0,
    since: 0,
    heartbeat: 0,
    project: '',
    recent: [],
    files: [],
    kit: null,
    fail: null,
    clone: false,
  };
}

function statsOf(state) {
  const d = state.daily;
  return {
    prompts: d.prompts,
    tools: d.tools,
    fails: d.fails ?? 0,
    files: d.files.size,
    activeMs: d.activeMs,
    projects: [...d.projects]
      .map(([name, p]) => ({ name, prompts: p.prompts, tools: p.tools, fails: p.fails ?? 0, files: p.files.size, activeMs: p.activeMs }))
      .sort((a, b) => b.tools - a.tools),
  };
}

/** Mode per tipe: satu karakter tetap per tipe yang terdaftar; yang bersamaan jadi kembaran. */
function typeChars(state, team, agents, chars, now) {
  const byType = new Map();
  for (const a of agents) {
    const key = team.types[a.type] && a.type !== '*' ? a.type : '*';
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(a);
  }
  for (const type of Object.keys(team.types).filter((k) => k !== '*')) {
    const list = (byType.get(type) ?? []).sort(
      (x, y) => (x.status === 'completed') - (y.status === 'completed') || x.startTs - y.startTs,
    );
    if (!list.length) {
      chars.push(restingChar(team, type, `type:${type}`));
      continue;
    }
    list.forEach((a, i) =>
      chars.push(agentChar(team, a, state.sessions.get(a.sid), i === 0 ? `type:${type}` : `agent:${a.aid}`, i, now)),
    );
  }
  (byType.get('*') ?? []).forEach((a, i) =>
    chars.push(agentChar(team, a, state.sessions.get(a.sid), `agent:${a.aid}`, i + 1, now)),
  );
}

/**
 * Mode berurutan: subagent ke-1 yang sedang jalan = karakter slot 1, ke-2 = slot 2, dst.
 * Slot dilepas saat agent selesai. Kelebihan slot memakai karakter slot terakhir (kembaran bernomor).
 * Karakter per tipe tetap tampil sebagai staf yang beristirahat.
 */
function slotChars(state, team, agents, chars, now) {
  const n = team.slots.length;
  const sorted = [...agents].sort((x, y) => x.startTs - y.startTs);
  const taken = new Set(sorted.filter((a) => a.status !== 'completed' && a.slot !== undefined && a.slot < n).map((a) => a.slot));
  for (const a of sorted) {
    if (a.slot !== undefined || a.status === 'completed') continue;
    let i = 0;
    while (taken.has(i) && i < n) i++;
    a.slot = i < n ? i : n; // n = luapan
    if (i < n) taken.add(i);
  }
  const holder = new Map(); // slot → agent yang menempatinya sekarang
  for (const a of sorted) if (a.status !== 'completed' && a.slot < n) holder.set(a.slot, a);
  team.slots.forEach((spec, i) => {
    const a = holder.get(i);
    if (a) chars.push(agentChar(team, a, state.sessions.get(a.sid), `slot:${i}`, 0, now, spec));
    else chars.push(restingChar(team, null, `slot:${i}`, spec));
  });
  let extra = 0;
  for (const a of sorted) {
    if (holder.get(a.slot) === a) continue;
    const overflow = a.status !== 'completed' && a.slot >= n;
    // Luapan → kembaran bernomor dari slot terakhir; yang sudah selesai tetap memakai karakternya.
    const spec = team.slots[Math.min(a.slot ?? n - 1, n - 1)];
    chars.push(agentChar(team, a, state.sessions.get(a.sid), `agent:${a.aid}`, overflow ? ++extra : 0, now, spec));
  }
  for (const type of Object.keys(team.types).filter((k) => k !== '*'))
    chars.push(restingChar(team, type, `type:${type}`));
}

/** Skill / server MCP yang sedang dipakai, untuk papan nama di atas karakter. */
export const KIT_MS = 20_000;
export const FAIL_MS = 30_000; // tanda ⚠ di karakter
export function kitOf(e) {
  if (e.tool === 'Skill' && e.detail) return { kind: 'skill', name: e.detail.split(/\s/)[0], ts: e.ts };
  const m = e.tool?.match(/^mcp__(.+?)__/);
  if (!m) return null;
  const key = m[1];
  const name = key.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '').replace(/_/g, ' ');
  return { kind: 'mcp', name, key, ts: e.ts };
}
// Waktu ikut dikirim: browser menyembunyikan papan setelah KIT_MS walau tidak ada event baru.
const kitView = (k, now) => (k && now - k.ts < KIT_MS ? { kind: k.kind, name: k.name, ts: k.ts } : null);

export function snapshot(state, team, now = Date.now()) {
  // Sesi yang sedang bekerja/menunggu didahulukan, baru yang terbaru.
  const busy = (s) => (waitingOf(s, s.lastTs, now) || s.status === 'working' ? 0 : 1);
  const live = [...state.sessions.values()]
    .filter((s) => isLive(s, now))
    .sort((a, b) => busy(a) - busy(b) || b.lastTs - a.lastTs);
  const primary = live[0] ?? null;
  const chars = [];

  // Pemimpin: sesi aktif terdepan memakai karakter utama, sesi lain jadi kembaran.
  if (primary) chars.push(leadChar(team, primary, false, now));
  else chars.push(restingChar(team, 'lead', 'lead'));
  live.slice(1).forEach((s) => chars.push(leadChar(team, s, true, now)));

  const visibleAgents = [...state.agents.values()].filter((a) => {
    const s = state.sessions.get(a.sid);
    return a.status !== 'completed' ? s && isLive(s, now) : now - a.endTs < CLONE_LINGER_MS;
  });

  if (team.slots?.length) slotChars(state, team, visibleAgents, chars, now);
  else typeChars(state, team, visibleAgents, chars, now);

  return {
    now,
    lightsOn: live.length > 0,
    project: primary?.project ?? null,
    sessions: live.map((s) => {
      const agents = [...state.agents.values()]
        .filter((a) => a.sid === s.sid && a.status !== 'completed')
        .map((a) => (team.types[a.type] ?? team.types['*']).name);
      return {
        sid: s.sid,
        project: s.project,
        title: s.title,
        branch: s.branch,
        mode: s.mode,
        status: waitingOf(s, s.lastTs, now) ? 'waiting' : s.status,
        waiting: waitingOf(s, s.lastTs, now),
        prompt: s.task,
        say: s.say,
        sayTs: s.sayTs,
        startTs: s.startTs,
        lastTs: s.lastTs,
        turnStart: s.turn?.start ?? null,
        tools: s.toolTotal,
        files: s.allFiles.size,
        agents,
      };
    }),
    notices: state.notices.slice(0, 40),
    chars,
    ticker: state.ticker.slice(0, 30),
    stats: statsOf(state),
  };
}

/** Buang agent dan sesi lama supaya state tidak tumbuh tanpa batas. */
export function prune(state, now = Date.now()) {
  for (const [id, a] of state.agents) {
    if (a.status === 'completed' && now - a.endTs > CLONE_LINGER_MS * 2) state.agents.delete(id);
    else if (now - a.heartbeat > LIVE_MS) state.agents.delete(id);
  }
  for (const [id, s] of state.sessions) if (now - s.lastTs > LIVE_MS * 4) state.sessions.delete(id);
}
