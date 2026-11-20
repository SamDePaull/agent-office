import { createQuestionStepper } from './question-stepper.js';
// Daftar sesi, kartu izin/pertanyaan yang bisa dijawab dari web, kartu notifikasi, dan riwayat lonceng.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const MODE = { default: 'default', acceptEdits: 'auto-edit', plan: 'plan', auto: 'auto', bypassPermissions: 'bypass', dontAsk: 'dontAsk' };
const KIND_ICON = { permission: '🔐', question: '❓', done: '✅', agent: '🧩', fail: '⚠️' };

function since(ts) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return 'baru saja';
  return m < 60 ? `${m} mnt` : `${Math.floor(m / 60)}j ${m % 60}m`;
}

function readSeen() {
  try {
    return Number(localStorage.getItem('agent-office:seenNotice') || 0);
  } catch {
    return 0;
  }
}
function writeSeen(ts) {
  try {
    localStorage.setItem('agent-office:seenNotice', String(ts));
  } catch {
    /* penyimpanan diblokir */
  }
}

export function createInbox({ onSelect, getSelected, notify }) {
  const cards = new Map(); // id pending → { el, item }
  const shownToasts = new Set();
  let seen = readSeen();
  let primed = false;
  let lastSnap = null;

  // ---------- sesi ----------

  function renderSessions(sessions) {
    const sel = getSelected();
    const rows = sessions
      .map((s) => {
        const on = s.sid === sel;
        const title = s.title || s.project || s.sid.slice(0, 8);
        const meta = [s.project, s.branch && `⎇ ${s.branch}`, s.mode && (MODE[s.mode] ?? s.mode)].filter(Boolean);
        const status = s.waiting === 'question' ? 'bertanya' : s.waiting ? 'minta izin' : s.status === 'working' ? 'bekerja' : 'idle';
        const extra = on
          ? `${s.say ? `<div class="sx say">“${esc(s.say.length > 220 ? s.say.slice(0, 219) + '…' : s.say)}”</div>` : ''}
             <div class="sx nums">${s.tools} tool · ${s.files} berkas diubah · aktif ${since(s.startTs)}${s.agents.length ? ` · agent: ${esc(s.agents.join(', '))}` : ''}</div>`
          : '';
        return `<button class="sess s-${s.status === 'working' ? 'working' : s.waiting ? 'waiting' : 'idle'}${on ? ' on' : ''}" data-sid="${esc(s.sid)}" aria-pressed="${on}">
          <div class="st"><span class="sdot"></span><b>${esc(title)}</b><span class="sstat">${status}</span></div>
          <div class="sx meta">${esc(meta.join(' · '))}</div>
          ${s.prompt ? `<div class="sx prompt">› ${esc(s.prompt)}</div>` : ''}
          ${extra}
        </button>`;
      })
      .join('');
    $('sessions').innerHTML = sessions.length
      ? `<button class="sess all${sel ? '' : ' on'}" data-sid="" aria-pressed="${!sel}"><div class="st"><b>Semua sesi</b><span class="sstat">${sessions.length}</span></div></button>${rows}`
      : '<p class="empty">Belum ada sesi Claude Code yang aktif.</p>';
  }
  $('sessions').addEventListener('click', (e) => {
    const b = e.target.closest('.sess');
    if (!b) return;
    const sid = b.dataset.sid || null;
    onSelect(sid === getSelected() ? null : sid);
  });

  // ---------- kartu izin / pertanyaan ----------

  async function send(id, body, card) {
    card.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const res = await fetch(`/api/pending/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'gagal mengirim');
      card.classList.add('sent');
      card.querySelector('.cstate').textContent = 'Terkirim ke Claude Code ✓';
    } catch (err) {
      card.querySelector('.cstate').textContent = err.message;
      card.classList.add('err');
      card.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  function permissionCard(item) {
    const el = document.createElement('article');
    el.className = 'icard perm';
    el.innerHTML = `<header>🔐 <b>${esc(item.who)}</b> minta izin</header>
      <div class="ctx">${esc(item.title || item.project)}</div>
      <div class="what"><span class="tool">${esc(item.tool)}</span><code>${esc(item.summary)}</code></div>
      <div class="acts"><button class="ok" data-d="allow">Izinkan</button><button class="no" data-d="deny">Tolak</button></div>
      <div class="cstate"></div>`;
    el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => send(item.id, { decision: b.dataset.d }, el)));
    return el;
  }

  function questionCard(item) {
    const el = document.createElement('article');
    el.className = 'icard ask';
    el.innerHTML = `<header>❓ <b>${esc(item.who)}</b> bertanya</header>
      <div class="ctx">${esc(item.title || item.project)}</div><div class="qwrap"></div><div class="cstate"></div>`;
    el.querySelector('.qwrap').append(createQuestionStepper(item, { onSubmit: (answers) => send(item.id, { answers }, el) }));
    return el;
  }

  function renderCards(pendingItems) {
    const ids = new Set(pendingItems.map((p) => p.id));
    for (const [id, c] of cards) {
      if (ids.has(id)) continue;
      // Sudah dijawab (di sini atau di VS Code) / waktunya habis.
      if (!c.el.classList.contains('sent')) {
        c.el.classList.add('gone');
        c.el.querySelector('.cstate').textContent = 'Dijawab di VS Code atau waktunya habis.';
      }
      setTimeout(() => c.el.remove(), 2500);
      cards.delete(id);
    }
    for (const item of pendingItems) {
      if (cards.has(item.id)) continue;
      const el = item.kind === 'permission' ? permissionCard(item) : questionCard(item);
      $('inbox').prepend(el);
      cards.set(item.id, { el, item });
      if (primed) notify(item);
    }
  }

  // Ditahan sampai dijawab (batas aman 30 menit): tampilkan sudah berapa lama menunggu.
  setInterval(() => {
    for (const { el, item } of cards.values()) {
      if (el.classList.contains('sent') || el.classList.contains('err')) continue;
      const mins = Math.floor((Date.now() - item.createdAt) / 60_000);
      el.querySelector('.cstate').textContent = `menunggu jawaban Anda${mins ? ` · ${mins} mnt` : ''}`;
    }
  }, 1000);

  // ---------- kartu notifikasi singkat + riwayat ----------

  function renderToasts(notices) {
    for (const n of [...notices].reverse()) {
      if (shownToasts.has(n.id)) continue;
      shownToasts.add(n.id);
      if (!primed || n.kind === 'permission' || n.kind === 'question') continue; // izin/pertanyaan punya kartunya sendiri
      const el = document.createElement('article');
      el.className = `icard note k-${n.kind}`;
      el.innerHTML = `<header>${KIND_ICON[n.kind] ?? '•'} ${esc(n.text)}</header><div class="ctx">${esc(titleOf(n.sid))}</div><button class="icard-x" title="Tutup" aria-label="Tutup">✕</button>`;
      el.addEventListener('click', (e) => {
        // ✕ hanya menutup; klik di bagian lain kartu = sorot sesinya.
        if (!e.target.closest('.icard-x')) onSelect(n.sid);
        el.remove();
      });
      $('inbox').append(el);
      // Hilang sendiri setelah 8 dtk; berhenti menghitung selama kursor di atasnya.
      let life = 8000;
      const t = setInterval(() => {
        if (!el.isConnected) return clearInterval(t);
        if (!el.matches(':hover')) life -= 500;
        if (life > 0) return;
        clearInterval(t);
        el.classList.add('gone');
        setTimeout(() => el.remove(), 600);
      }, 500);
    }
  }

  function titleOf(sid) {
    const s = lastSnap?.sessions?.find((x) => x.sid === sid);
    return s ? s.title || s.project : '';
  }

  function renderHistory(notices) {
    const unread = notices.filter((n) => n.ts > seen).length;
    $('bellCount').hidden = !unread;
    $('bellCount').textContent = unread > 9 ? '9+' : String(unread);
    $('history').innerHTML = notices.length
      ? notices
          .map(
            (n) => `<li class="${n.ts > seen ? 'unread' : ''}" data-sid="${esc(n.sid)}">
              <time>${fmtTime(n.ts)}</time><span>${KIND_ICON[n.kind] ?? '•'} ${esc(n.text)}<small>${esc(titleOf(n.sid))}</small></span></li>`,
          )
          .join('')
      : '<li class="empty">Belum ada notifikasi hari ini.</li>';
  }
  $('history').addEventListener('click', (e) => {
    const sid = e.target.closest('li[data-sid]')?.dataset.sid;
    if (sid) onSelect(sid);
  });
  const markRead = () => {
    seen = Math.max(seen, ...(lastSnap?.notices ?? []).map((n) => n.ts), 0);
    writeSeen(seen);
    if (lastSnap) renderHistory(lastSnap.notices ?? []);
  };
  $('markRead').addEventListener('click', markRead);

  return {
    update(snap) {
      lastSnap = snap;
      renderSessions(snap.sessions ?? []);
      renderCards(snap.pending ?? []);
      renderToasts(snap.notices ?? []);
      renderHistory(snap.notices ?? []);
      primed = true;
    },
    markRead,
  };
}
