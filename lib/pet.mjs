// Pet pendamping (Kapten Meong mini): XP & level dari event nyata, mood dari keadaan kantor.
// Murni logika — penyimpanan (data/pet.json) diurus server.

export const MOODS = ['idle', 'sleep', 'work', 'happy', 'panic', 'sad'];
const HAPPY_MS = 8_000; // setelah tugas selesai / naik level
const SAD_MS = 45_000; // setelah ada yang gagal
const LEVELUP_MS = 10_000;

/** XP total yang dibutuhkan untuk mencapai level L (L2 = 50, L5 = 500, L10 = 2.250, L20 = 9.500). */
export const xpForLevel = (L) => 25 * L * (L - 1);
export function levelOf(xp) {
  let L = 1;
  while (xp >= xpForLevel(L + 1)) L++;
  return L;
}
/** Aksesori bertahap (digambar CSS di atas gambar ekspresi). */
export function gearOf(level) {
  return { scarf: level >= 5, crown: level >= 10, aura: level >= 20 };
}

export function createPet(saved = {}, seenSeed = []) {
  return {
    xp: Number(saved.xp) || 0,
    seen: new Set(saved.seen ?? seenSeed), // skill:<nama> / mcp:<server> yang sudah pernah dipakai
    born: saved.born || Date.now(),
    lastDone: 0,
    lastFail: 0,
    lastLevelUp: 0,
    gain: null, // { xp, why, ts } — untuk "+25 XP" di layar
    lastPat: 0,
    lastPatXp: 0,
    mutedUntil: Number(saved.mutedUntil) || 0, // kartu selesai/gagal disembunyikan sampai waktu ini
  };
}
export const petToJson = (p) => ({ xp: p.xp, seen: [...p.seen], born: p.born, mutedUntil: p.mutedUntil });

const PAT_MS = 2_500;
const PAT_LINES = ['Meong! ❤️', 'Prrr… 😽', 'Meong~', 'Lagi dong! 😸', 'Nyaa ❤️'];
/** Dielus: senang sebentar; +1 XP paling banyak sekali per menit. */
export function petPat(p, now = Date.now()) {
  p.lastPat = now;
  p.patLine = PAT_LINES[Math.floor(Math.random() * PAT_LINES.length)];
  if (now - p.lastPatXp < 60_000) return false;
  p.lastPatXp = now;
  p.xp += 1;
  p.gain = { xp: 1, why: 'dielus', ts: now };
  return true;
}

/** Terapkan satu event yang sudah dinormalisasi. Mengembalikan true kalau XP berubah. */
export function petOnEvent(p, e) {
  let gain = 0;
  let why = '';
  if (e.ev === 'PreToolUse' && e.tool) {
    gain += 1;
    why = 'tool';
    let first = null;
    if (e.tool === 'Skill' && e.detail) first = `skill:${e.detail.split(/\s/)[0]}`;
    const m = e.tool.match(/^mcp__(.+?)__/);
    if (m) first = `mcp:${m[1]}`;
    if (first && !p.seen.has(first)) {
      p.seen.add(first);
      gain += 25;
      why = `pertama kali: ${first.split(':').slice(1).join(':')}`;
    }
  } else if (e.ev === 'UserPromptSubmit' && e.cmd && !p.seen.has(`skill:${e.cmd}`)) {
    p.seen.add(`skill:${e.cmd}`);
    gain += 25;
    why = `pertama kali: /${e.cmd}`;
  } else if (e.ev === 'Stop') {
    gain += 10;
    why = 'tugas selesai';
    p.lastDone = e.ts;
  } else if (e.ev === 'SubagentStop') {
    gain += 5;
    why = 'subagent selesai';
    p.lastDone = e.ts;
  } else if (e.ev === 'PostToolUseFailure' || e.ev === 'StopFailure') {
    p.lastFail = e.ts;
  }
  if (!gain) return false;
  const before = levelOf(p.xp);
  p.xp += gain;
  if (gain > 1) p.gain = { xp: gain, why, ts: e.ts };
  if (levelOf(p.xp) > before) p.lastLevelUp = e.ts;
  return true;
}

/**
 * Tampilan pet dari snapshot kantor: mood + karakter yang diikuti.
 * Urutan prioritas: panik (ada yang menunggu Anda) → sedih (baru gagal) → senang → kerja → tidur.
 */
export function petView(p, snap, now = Date.now()) {
  const chars = snap.chars ?? [];
  const live = (snap.sessions ?? []).length > 0;
  const failing = chars.filter((c) => c.fail).sort((a, b) => b.fail.ts - a.fail.ts)[0];
  const waiting = chars.find((c) => c.status === 'waiting');
  const working = chars.filter((c) => c.status === 'working').sort((a, b) => (b.heartbeat ?? 0) - (a.heartbeat ?? 0))[0];
  let mood;
  let follow = null;
  let say = '';
  const patted = now - p.lastPat < PAT_MS;
  if (waiting) {
    mood = 'panic';
    follow = waiting.key;
    say = waiting.waiting === 'question' ? `${waiting.name} bertanya!` : `${waiting.name} minta izin!`;
  } else if (failing || now - p.lastFail < SAD_MS) {
    mood = 'sad';
    follow = failing?.key ?? null;
    say = failing ? `${failing.fail.tool || 'Claude'} gagal…` : 'ada yang gagal…';
  } else if (patted) {
    mood = 'happy';
    say = p.patLine;
  } else if (now - p.lastLevelUp < LEVELUP_MS) {
    mood = 'happy';
    say = `Naik ke level ${levelOf(p.xp)}!`;
  } else if (now - p.lastDone < HAPPY_MS) {
    mood = 'happy';
    say = 'Selesai!';
  } else if (working) {
    mood = 'work';
    follow = working.key;
  } else mood = live ? 'idle' : 'sleep';
  const level = levelOf(p.xp);
  return {
    mood,
    follow,
    say,
    level,
    xp: p.xp,
    xpLevel: xpForLevel(level),
    xpNext: xpForLevel(level + 1),
    gear: gearOf(level),
    gain: p.gain && now - p.gain.ts < 6_000 ? p.gain : null,
    levelUp: now - p.lastLevelUp < LEVELUP_MS,
    patted,
    mutedUntil: p.mutedUntil > now ? p.mutedUntil : 0,
  };
}

/** Wajah teks untuk status line Claude Code. */
export const FACES = {
  idle: '(=^･ω･^=)',
  sleep: '(=－ω－=) zZ',
  work: '(=•̀ω•́=)⌨',
  happy: '(=^▽^=)♪',
  panic: '(=⊙ω⊙=)!',
  sad: '(=;ω;=)',
};
