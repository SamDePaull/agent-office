// Panel mini pet desktop (klik dua kali pada pet): sesi berjalan, statistik singkat, bisukan sementara.
import { MOOD_LABEL, esc } from './pet-view.js';

const STATUS = { working: ['bekerja', 'work'], waiting: ['menunggu Anda', 'wait'], idle: ['selesai', 'idle'] };
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
const fmtDur = (ms) => {
  const m = Math.round((ms || 0) / 60_000);
  return m < 60 ? `${m} mnt` : `${Math.floor(m / 60)} j ${m % 60} mnt`;
};
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

/** @param {HTMLElement} box @param {{ copy: (text: string) => void, open: (url: string) => void }} io */
export function createPetPanel(box, io) {
  let snap = null;
  let open = false;
  let note = ''; // umpan balik singkat (mis. "Disalin")

  function render() {
    box.hidden = !open;
    if (!open || !snap) return;
    const v = snap.pet;
    const st = snap.stats ?? {};
    const span = Math.max(1, v.xpNext - v.xpLevel);
    const pending = snap.pending ?? [];
    const leads = new Map((snap.chars ?? []).filter((c) => c.key.startsWith('lead')).map((c) => [c.sid, c]));
    const sessions = (snap.sessions ?? [])
      .map((s) => {
        const lead = leads.get(s.sid);
        const waiting = pending.filter((p) => p.sid === s.sid).length;
        const [label, cls] = waiting ? STATUS.waiting : (STATUS[s.status] ?? STATUS.idle);
        let line = '';
        if (waiting) line = `❓ ${waiting} pertanyaan/izin menunggu — jawab di kartu atas`;
        else if (lead?.fail) line = `⚠ ${lead.fail.tool || 'gagal'}${lead.fail.detail ? `: ${lead.fail.detail}` : ''}`;
        else if (s.status === 'working') line = lead?.kit ? `${lead.kit.kind === 'mcp' ? '🔌' : '📚'} ${lead.kit.name}` : `⌨ ${[lead?.tool, lead?.detail].filter(Boolean).join(' · ') || 'berpikir…'}`;
        else if (s.say) line = `“${clip(s.say.replace(/\s+/g, ' '), 110)}”`;
        return `<li class="pp-sess">
          <div class="pp-row"><span class="pp-dot ${cls}"></span><b title="${esc(s.title || s.project)}">${esc(clip(s.title || s.project, 34))}</b><span class="pp-st">${label}</span></div>
          <div class="pp-meta">${esc(s.project)}${s.branch ? ` ⎇ ${esc(clip(s.branch, 24))}` : ''}</div>
          ${line ? `<div class="pp-line">${esc(line)}</div>` : ''}
          <div class="pp-acts"><button data-focus="${esc(s.sid)}">Sorot di office</button><button data-copy="${esc(s.sid)}" ${s.say ? '' : 'disabled'}>Salin pesan terakhir</button></div>
        </li>`;
      })
      .join('');
    const muted = v.mutedUntil > Date.now();
    box.innerHTML = `
      <div class="pp-head">
        <div><b>Kapten Meong</b> · Lv${v.level} <span class="pp-mood">${esc(MOOD_LABEL[v.mood] ?? v.mood)}</span></div>
        <button class="pp-x" data-close title="Tutup">✕</button>
      </div>
      <div class="pp-xp"><i style="width:${Math.min(100, ((v.xp - v.xpLevel) / span) * 100)}%"></i></div>
      <div class="pp-xptext">${v.xp - v.xpLevel}/${span} XP ke Lv${v.level + 1}</div>
      <div class="pp-stats">
        <span><b>${st.tools ?? 0}</b> tool</span><span><b>${fmtDur(st.activeMs)}</b> aktif</span><span><b>${st.prompts ?? 0}</b> prompt</span>
        <span class="${st.fails ? 'bad' : ''}"><b>${st.fails ?? 0}</b> gagal</span>
      </div>
      <h4>Sesi berjalan</h4>
      <ul class="pp-list">${sessions || '<li class="pp-empty">Tidak ada sesi aktif — Kapten Meong tidur 💤</li>'}</ul>
      <div class="pp-mute">${
        muted
          ? `🔕 Kartu selesai/gagal dibisukan sampai ${fmtTime(v.mutedUntil)} <button data-mute="0">Aktifkan</button>`
          : `🔔 Bisukan kartu selesai/gagal: <button data-mute="30">30 mnt</button><button data-mute="60">1 jam</button>`
      }</div>
      <div class="pp-foot"><button data-office>Buka Agent Office</button><span class="pp-note">${esc(note)}</span></div>`;
  }

  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.close !== undefined) return toggle(false);
    if (b.dataset.office !== undefined) return io.open('http://127.0.0.1:4316/');
    if (b.dataset.mute !== undefined) {
      await fetch('/api/pet/mute', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ minutes: Number(b.dataset.mute) }) });
      return;
    }
    if (b.dataset.focus) {
      await fetch('/api/focus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: b.dataset.focus }) });
      flash('Disorot di office ✓');
      return;
    }
    if (b.dataset.copy) {
      const res = await fetch(`/api/session/${encodeURIComponent(b.dataset.copy)}/last`);
      const data = await res.json().catch(() => ({}));
      if (data.text) {
        io.copy(data.text);
        flash('Pesan terakhir disalin ✓');
      } else flash('Belum ada pesan');
    }
  });

  function flash(text) {
    note = text;
    render();
    setTimeout(() => {
      note = '';
      render();
    }, 2000);
  }

  function toggle(force) {
    open = force ?? !open;
    render();
  }

  return {
    update(s) {
      snap = s;
      render();
    },
    toggle,
    isOpen: () => open,
  };
}
