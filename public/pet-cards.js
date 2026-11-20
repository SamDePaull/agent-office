// Kartu pesan pet: izin (Izinkan/Tolak), pertanyaan (pilihan), selesai, dan gagal.
// Menjawab memakai jalur yang sama dengan kartu di halaman kantor: POST /api/pending/:id.
import { esc } from './pet-view.js';
import { createQuestionStepper } from './question-stepper.js';

const FRESH_MS = 60_000; // pesan selesai/gagal yang lebih tua dari ini tidak dimunculkan lagi
// Kartu tanpa pilihan (selesai/gagal) hilang sendiri; berhenti menghitung selama kursor di atasnya.
export const MSG_LIFE_MS = 8_000;
const MAX_CARDS = 4;
// Kartu baru bisa muncul tepat di bawah kursor saat Anda sedang mengklik aplikasi lain:
// tombolnya baru aktif setelah jeda ini, supaya tidak ada izin yang tertekan tanpa sengaja.
const ARM_MS = 1000;
const armed = (el) => Date.now() - Number(el.dataset.born || 0) > ARM_MS;

/**
 * @param {HTMLElement} box  wadah kartu
 * @param {{ open?: (what: {sid?: string, kind: string}) => void, compact?: boolean }} opts
 */
export function createPetCards(box, opts = {}) {
  const cards = new Map(); // id → { el, kind, expiresAt }
  const dismissed = new Set();
  let lastSnap = null;

  async function send(id, body, el) {
    el.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const st = el.querySelector('.pc-state');
    try {
      const res = await fetch(`/api/pending/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'gagal mengirim');
      el.classList.add('sent');
      st.textContent = 'Terkirim ke Claude Code ✓';
      setTimeout(() => remove(id), 1500);
    } catch (err) {
      st.textContent = err.message;
      el.classList.add('err');
      el.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  function head(icon, who, what, ctx) {
    return `<header><span class="pc-ico">${icon}</span><b>${esc(who)}</b> ${esc(what)}<button class="pc-x" data-x title="Tutup">✕</button></header>${
      ctx ? `<div class="pc-ctx">${esc(ctx)}</div>` : ''
    }`;
  }

  function permissionCard(item) {
    const el = document.createElement('article');
    el.className = 'pc perm';
    el.innerHTML = `${head('🔐', item.who, 'minta izin', item.title || item.project)}
      <div class="pc-what"><span class="pc-tool">${esc(item.tool)}</span><code>${esc(item.summary)}</code></div>
      <div class="pc-acts"><button class="no" data-d="deny">Tolak</button><button class="ok" data-d="allow">Izinkan</button></div>
      <div class="pc-state"></div>`;
    el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => armed(el) && send(item.id, { decision: b.dataset.d }, el)));
    return el;
  }

  function questionCard(item) {
    const el = document.createElement('article');
    el.className = 'pc ask';
    el.innerHTML = `${head('❓', item.who, 'bertanya', item.title || item.project)}<div class="pc-q"></div><div class="pc-state"></div>`;
    el.querySelector('.pc-q').append(
      createQuestionStepper(item, { canClick: () => armed(el), onSubmit: (answers) => send(item.id, { answers }, el) }),
    );
    return el;
  }

  function messageCard(m) {
    const el = document.createElement('article');
    const fail = m.kind === 'fail';
    el.className = `pc msg ${fail ? 'fail' : 'done'}`;
    // Teks notifikasi sudah berisi nama; tampilkan sisanya.
    const text = m.text.startsWith(m.who) ? m.text.slice(m.who.length).trim() : m.text;
    el.innerHTML = `${head(fail ? '⚠️' : m.kind === 'agent' ? '🧩' : '✅', m.who, text, m.title)}
      ${m.say ? `<p class="pc-say">${esc(m.say)}</p>` : ''}
      <div class="pc-acts"><button data-open>${fail ? 'Lihat detail' : 'Buka sesi'}</button></div>
      <div class="pc-life"><i></i></div>`;
    el.querySelector('[data-open]').addEventListener('click', () => {
      opts.open?.({ sid: m.sid, kind: m.kind });
      remove(m.id);
    });
    return el;
  }

  function remove(id) {
    const c = cards.get(id);
    if (!c) return;
    dismissed.add(id);
    c.el.classList.add('gone');
    cards.delete(id);
    setTimeout(() => c.el.remove(), 250);
    opts.onChange?.(cards.size);
  }

  box.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    const id = [...cards].find(([, c]) => c.el.contains(x))?.[0];
    if (id) remove(id);
  });

  function update(snap) {
    lastSnap = snap;
    const now = Date.now();
    const pending = snap.pending ?? [];
    const feed = (snap.petFeed ?? []).filter((m) => now - m.ts < FRESH_MS || cards.has(m.id));
    const wanted = new Map();
    for (const p of pending) wanted.set(p.id, { kind: p.kind, data: p });
    for (const m of feed) if (!dismissed.has(m.id)) wanted.set(m.id, { kind: m.kind, data: m });
    // Yang sudah tidak relevan (dijawab di VS Code, waktunya habis, pesan lama) dilepas.
    for (const id of [...cards.keys()]) if (!wanted.has(id) && !cards.get(id).el.classList.contains('sent')) remove(id);
    let added = false;
    for (const [id, w] of wanted) {
      if (cards.has(id) || dismissed.has(id) || cards.size >= MAX_CARDS) continue;
      const el = w.kind === 'permission' ? permissionCard(w.data) : w.kind === 'question' ? questionCard(w.data) : messageCard(w.data);
      el.dataset.born = String(Date.now());
      el.classList.add('arming');
      setTimeout(() => el.classList.remove('arming'), ARM_MS);
      cards.set(id, { el, data: w.data, life: w.kind === 'permission' || w.kind === 'question' ? null : MSG_LIFE_MS });
      box.prepend(el); // terbaru di atas
      added = true;
    }
    tick();
    opts.onChange?.(cards.size);
    return added;
  }

  // Sudah berapa lama menunggu (ditahan sampai dijawab; batas aman 30 menit).
  function tick() {
    const now = Date.now();
    for (const [id, c] of [...cards]) {
      if (c.life != null) {
        if (!c.el.matches(':hover')) c.life -= 1000;
        const bar = c.el.querySelector('.pc-life i');
        if (bar) bar.style.width = `${Math.max(0, (c.life / MSG_LIFE_MS) * 100)}%`;
        if (c.life <= 0) remove(id);
        continue;
      }
      const d = c.data;
      if (!d.createdAt) continue;
      const st = c.el.querySelector('.pc-state');
      if (!st || c.el.classList.contains('sent') || c.el.classList.contains('err')) continue;
      const mins = Math.floor((now - d.createdAt) / 60_000);
      st.textContent = `menunggu jawaban Anda${mins ? ` · ${mins} mnt` : ''}`;
    }
  }
  setInterval(() => {
    tick();
    if (lastSnap) update(lastSnap); // pesan selesai/gagal kedaluwarsa tanpa event baru
  }, 1000);

  return { update, count: () => cards.size };
}
