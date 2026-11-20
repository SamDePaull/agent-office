// Terjemahan ke Bahasa Indonesia lewat Claude Code CLI (`claude -p`, model Haiku) memakai langganan pengguna.
// Hook dimatikan (sesi penerjemah tidak muncul di kantor) dan tanpa tool. Hasil disimpan per hash teks,
// jadi tiap teks hanya diterjemahkan sekali.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

export const hashText = (t) => createHash('sha1').update(String(t)).digest('hex').slice(0, 16);

let claudeBin;
/** Cari biner claude: $CLAUDE_BIN, shell login, lalu lokasi umum (launchd punya PATH minim). */
export function findClaude() {
  if (claudeBin !== undefined) return claudeBin;
  const candidates = [process.env.CLAUDE_BIN];
  try {
    candidates.push(execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8', timeout: 8000 }).trim());
  } catch {}
  const home = homedir();
  candidates.push(join(home, '.local/bin/claude'), join(home, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude');
  for (const nvm of [join(home, 'Library/Application Support/Herd/config/nvm/versions/node'), join(home, '.nvm/versions/node')]) {
    try {
      for (const v of readdirSync(nvm).sort().reverse()) candidates.push(join(nvm, v, 'bin/claude'));
    } catch {}
  }
  claudeBin = null;
  for (const c of candidates)
    if (c && existsSync(c)) {
      claudeBin = realpathSync(c);
      break;
    }
  return claudeBin;
}

export function runClaude(prompt, { model = 'haiku', timeoutMs = 180_000, system = 'Anda asisten yang ringkas dan teliti. Ikuti format balasan yang diminta persis.' } = {}) {
  const bin = findClaude();
  if (!bin) return Promise.reject(new Error('Claude Code CLI tidak ditemukan (set CLAUDE_BIN)'));
  const user = userInfo().username;
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      [
        '-p',
        '--model',
        model,
        '--settings',
        '{"disableAllHooks":true}',
        '--no-session-persistence',
        '--disable-slash-commands',
        '--tools',
        '',
        // Tanpa server MCP Anda dan tanpa system prompt bawaan Claude Code yang besar: 51 dtk → ±5 dtk.
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--system-prompt',
        system,
      ],
      {
        // Lingkungan bersih: tanpa variabel sesi Claude Code induk; USER/LOGNAME perlu untuk login (keychain).
        env: { HOME: homedir(), USER: user, LOGNAME: user, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8', MAX_THINKING_TOKENS: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error((err || out || `claude keluar dengan kode ${code}`).trim().slice(0, 300)));
    });
    child.stdin.end(prompt);
  });
}

const RULES = `Aturan:
- Jangan terjemahkan: nama tool/skill/perintah, kode, path, URL, nama produk, dan contoh ucapan pengguna di dalam tanda kutip (itu kata pemicu, biarkan aslinya).
- Istilah teknis yang lazim dibiarkan Inggris (skill, prompt, commit, deploy, dll.) tetap Inggris.
- Kalau teks sudah Bahasa Indonesia, kembalikan apa adanya.
- Gaya: Bahasa Indonesia yang wajar dan ringkas, bukan terjemahan kata per kata.`;

/** Terjemahkan banyak deskripsi pendek sekaligus. Mengembalikan array dengan panjang yang sama. */
export async function translateMany(texts) {
  const input = JSON.stringify(texts.map((t, i) => ({ i, t })));
  const prompt = `Terjemahkan setiap "t" berikut ke Bahasa Indonesia. Ini deskripsi skill/tool Claude Code.
${RULES}
Balas HANYA dengan array JSON [{"i":0,"t":"…"}, …] untuk semua ${texts.length} item, tanpa teks lain dan tanpa blok kode.

${input}`;
  const raw = await runClaude(prompt);
  const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
  const arr = JSON.parse(json);
  const out = new Array(texts.length).fill(null);
  for (const r of arr) if (Number.isInteger(r?.i) && typeof r.t === 'string' && r.i < texts.length) out[r.i] = r.t;
  return out;
}

/** Terjemahkan satu dokumen markdown (SKILL.md / README). */
export async function translateDoc(markdown) {
  const prompt = `Terjemahkan dokumen markdown berikut ke Bahasa Indonesia.
${RULES}
- Pertahankan struktur markdown persis: judul, daftar, tabel, frontmatter (hanya nilai "description" yang diterjemahkan), dan blok kode TIDAK diterjemahkan.
Balas HANYA dengan dokumen hasil terjemahan.

<dokumen>
${markdown}
</dokumen>`;
  const out = await runClaude(prompt, { timeoutMs: 300_000 });
  // Model kadang membungkus seluruh hasil dalam <dokumen> atau blok ```markdown; buang pembungkusnya saja.
  let text = out.replace(/^<dokumen>\s*|\s*<\/dokumen>$/g, '').trim();
  const fenced = text.match(/^```[\w-]*\n([\s\S]*)\n```$/);
  if (fenced) text = fenced[1];
  return text;
}
