// Pengaturan yang bisa diubah dari panel Kustom: karakter, penugasan tipe agent, tema, ruangan.
// Disimpan di data/settings.json. Kalau belum ada, dibuat dari data/team.json lama.

export const ROOM_KEYS = ['briefing', 'meeting', 'approval', 'workspace', 'command', 'server', 'pantry', 'lounge'];

export const DEFAULT_LABELS = {
  briefing: 'Briefing Room',
  meeting: 'Meeting Room',
  approval: 'Approval Office',
  workspace: 'Workspace',
  command: 'Command Center',
  server: 'Server Room',
  pantry: 'Pantry',
  lounge: 'Lounge',
};

/** Kelompok tool yang ruangannya bisa diatur. 'stay' = tidak memindahkan karakter. */
export const TOOL_GROUPS = {
  read: { label: 'Membaca & mencari berkas', tools: ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'] },
  edit: { label: 'Mengedit & menulis berkas', tools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] },
  bash: { label: 'Terminal (Bash)', tools: ['Bash', 'BashOutput', 'KillShell'] },
  web: { label: 'Web (WebSearch, WebFetch)', tools: ['WebSearch', 'WebFetch'] },
  mcp: { label: 'Alat MCP (Figma, Notion, …)', tools: [] },
  other: { label: 'Tool lain', tools: [] },
};

export const DEFAULT_RULES = { read: 'workspace', edit: 'workspace', bash: 'server', web: 'meeting', mcp: 'meeting', other: 'workspace' };

export const DEFAULT_THEME = { office: 'malam', accent: '#f0b44c', panel: 'dark', dimIdle: true };

const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,29}$/;
const TYPE = /^(\*|lead|[A-Za-z0-9][\w:.-]{0,59})$/;

export function slug(text) {
  return (
    String(text ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'karakter'
  );
}

/** Pengaturan awal dari team.json format lama ({ lead, types }). */
export function fromTeam(team) {
  const characters = {};
  const assign = {};
  const add = (type, t) => {
    characters[t.sprite] ??= { name: t.name, role: t.role, colour: t.colour };
    assign[type] = t.sprite;
  };
  add('lead', team.lead);
  for (const [type, t] of Object.entries(team.types)) add(type, t);
  return {
    characters,
    assign,
    theme: { ...DEFAULT_THEME },
    offices: [{ id: 'malam', name: 'Kantor malam', file: 'office.png', time: 'night' }],
    rooms: { labels: { ...DEFAULT_LABELS }, rules: { ...DEFAULT_RULES } },
  };
}

/** Lengkapi pengaturan yang mungkin dibuat versi lama / diubah tangan. */
export function normalizeSettings(s) {
  s.characters ??= {};
  s.assign ??= {};
  s.theme = { ...DEFAULT_THEME, ...(s.theme ?? {}) };
  s.offices ??= [];
  s.rooms ??= {};
  s.rooms.labels = { ...DEFAULT_LABELS, ...(s.rooms.labels ?? {}) };
  s.rooms.rules = { ...DEFAULT_RULES, ...(s.rooms.rules ?? {}) };
  if (!s.characters.default) s.characters.default = { name: 'Agent', role: 'Subagent', colour: '#a09cb3' };
  s.assign.lead ??= Object.keys(s.characters)[0];
  s.assign['*'] ??= 'default';
  s.slots = (s.slots ?? []).filter((id) => s.characters[id]);
  s.templates ??= [];
  return s;
}

// ---------- template: penugasan karakter + tema yang bisa dipasang sekali klik ----------

export function saveTemplate(s, name) {
  const next = structuredClone(s);
  const base = slug(name);
  let id = base;
  for (let i = 2; next.templates.some((t) => t.id === id); i++) id = `${base}-${i}`;
  next.templates.push({
    id,
    name: text(name, 40),
    assign: structuredClone(s.assign),
    slots: [...(s.slots ?? [])],
    theme: structuredClone(s.theme),
  });
  return [next, id];
}

export function applyTemplate(s, id) {
  const t = s.templates.find((x) => x.id === id);
  if (!t) throw new Error('template tidak ditemukan');
  const missing = [...Object.values(t.assign), ...t.slots].filter((c) => !s.characters[c]);
  if (missing.length) throw new Error(`karakter di template sudah dihapus: ${[...new Set(missing)].join(', ')}`);
  const next = structuredClone(s);
  next.assign = structuredClone(t.assign);
  next.slots = [...t.slots];
  // Peta yang sudah dihapus tidak ikut dipasang; selebihnya tema template berlaku.
  const officeOk = t.theme.office === 'auto' || next.offices.some((o) => o.id === t.theme.office);
  next.theme = { ...next.theme, ...t.theme, office: officeOk ? t.theme.office : next.theme.office };
  return next;
}

export function removeTemplate(s, id) {
  const next = structuredClone(s);
  next.templates = next.templates.filter((t) => t.id !== id);
  return next;
}

/** Bentuk "team" yang dipakai lib/state.mjs. */
export function buildTeam(s) {
  const char = (id, fallbackRole) => {
    const c = s.characters[id] ?? s.characters.default;
    return { name: c.name, role: c.role || fallbackRole, sprite: s.characters[id] ? id : 'default', colour: c.colour };
  };
  const types = {};
  for (const [type, id] of Object.entries(s.assign)) if (type !== 'lead') types[type] = char(id, type);
  types['*'] ??= char('default', 'Subagent');
  const slots = (s.slots ?? []).map((id, i) => char(id, `Subagent ${i + 1}`));
  return { lead: char(s.assign.lead, 'Orchestrator'), types, slots, rules: s.rooms.rules };
}

// ---------- validasi perubahan dari panel ----------

function text(v, max) {
  if (typeof v !== 'string') throw new Error('teks tidak valid');
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t || t.length > max) throw new Error(`teks harus 1–${max} karakter`);
  return t;
}

/** Terapkan perubahan sebagian; melempar Error dengan pesan yang bisa ditampilkan. */
export function applyPatch(s, patch) {
  const next = structuredClone(s);
  if (patch.characters) {
    for (const [id, c] of Object.entries(patch.characters)) {
      if (!next.characters[id]) throw new Error(`karakter "${id}" tidak ada`);
      if (c.name !== undefined) next.characters[id].name = text(c.name, 40);
      if (c.role !== undefined) next.characters[id].role = c.role === '' ? '' : text(c.role, 40);
      if (c.colour !== undefined) {
        if (!HEX.test(c.colour)) throw new Error('warna harus format #rrggbb');
        next.characters[id].colour = c.colour;
      }
    }
  }
  if (patch.assign) {
    for (const [type, id] of Object.entries(patch.assign)) {
      if (!TYPE.test(type)) throw new Error(`nama tipe "${type}" tidak valid`);
      if (id === null) {
        if (type === 'lead' || type === '*') throw new Error('Lead dan tipe lain (*) tidak bisa dihapus');
        delete next.assign[type];
        continue;
      }
      if (!next.characters[id]) throw new Error(`karakter "${id}" tidak ada`);
      next.assign[type] = id;
    }
  }
  if (patch.slots !== undefined) {
    if (!Array.isArray(patch.slots) || patch.slots.length > 6) throw new Error('slot subagent maksimal 6');
    for (const id of patch.slots) if (!next.characters[id]) throw new Error(`karakter "${id}" tidak ada`);
    next.slots = patch.slots;
  }
  if (patch.theme) {
    const t = patch.theme;
    if (t.office !== undefined) {
      if (t.office !== 'auto' && !next.offices.some((o) => o.id === t.office)) throw new Error('peta tidak ditemukan');
      next.theme.office = t.office;
    }
    if (t.accent !== undefined) {
      if (!HEX.test(t.accent)) throw new Error('warna aksen harus format #rrggbb');
      next.theme.accent = t.accent;
    }
    if (t.panel !== undefined) {
      if (!['dark', 'light'].includes(t.panel)) throw new Error('tema panel harus dark/light');
      next.theme.panel = t.panel;
    }
    if (t.dimIdle !== undefined) next.theme.dimIdle = Boolean(t.dimIdle);
  }
  if (patch.offices) {
    for (const [id, o] of Object.entries(patch.offices)) {
      const office = next.offices.find((x) => x.id === id);
      if (!office) throw new Error('peta tidak ditemukan');
      if (o.name !== undefined) office.name = text(o.name, 40);
      if (o.time !== undefined) {
        if (![null, 'day', 'night'].includes(o.time)) throw new Error('waktu peta harus day/night');
        office.time = o.time;
      }
    }
  }
  if (patch.rooms?.labels) {
    for (const [k, v] of Object.entries(patch.rooms.labels)) {
      if (!ROOM_KEYS.includes(k)) throw new Error(`ruangan "${k}" tidak ada`);
      next.rooms.labels[k] = text(v, 30);
    }
  }
  if (patch.rooms?.rules) {
    for (const [g, room] of Object.entries(patch.rooms.rules)) {
      if (!TOOL_GROUPS[g]) throw new Error(`kelompok tool "${g}" tidak ada`);
      if (room !== 'stay' && !ROOM_KEYS.includes(room)) throw new Error(`ruangan "${room}" tidak ada`);
      next.rooms.rules[g] = room;
    }
  }
  return next;
}

export function addCharacter(s, { name, role, colour }) {
  const next = structuredClone(s);
  const base = slug(name);
  let id = base;
  for (let i = 2; next.characters[id]; i++) id = `${base}-${i}`.slice(0, 30);
  if (!ID.test(id)) throw new Error('nama tidak valid');
  next.characters[id] = {
    name: text(name, 40),
    role: role ? text(role, 40) : '',
    colour: HEX.test(colour ?? '') ? colour : '#a09cb3',
  };
  return [next, id];
}

export function removeCharacter(s, id) {
  if (id === 'default') throw new Error('karakter bawaan untuk tipe lain tidak bisa dihapus');
  if (!s.characters[id]) throw new Error('karakter tidak ada');
  const used = Object.entries(s.assign).filter(([, v]) => v === id).map(([k]) => k);
  for (const t of s.templates ?? []) if (Object.values(t.assign).includes(id) || t.slots.includes(id)) used.push(`template "${t.name}"`);
  (s.slots ?? []).forEach((v, i) => v === id && used.push(`subagent ke-${i + 1}`));
  if (used.length) throw new Error(`masih dipakai untuk: ${used.join(', ')} — ganti dulu penugasannya`);
  const next = structuredClone(s);
  delete next.characters[id];
  return next;
}

export function addOffice(s, { name, file, time = null }) {
  const next = structuredClone(s);
  const base = slug(name);
  let id = base;
  for (let i = 2; next.offices.some((o) => o.id === id); i++) id = `${base}-${i}`;
  next.offices.push({ id, name: text(name, 40), file, time });
  return [next, id];
}

export const isCharacterId = (id) => ID.test(id);
