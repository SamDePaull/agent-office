// Panel Kustom: karakter (nama, peran, warna, gambar, penugasan tipe agent), tema (peta, warna,
// tampilan), dan ruangan (nama, aturan tool). Semua disimpan ke server lewat /api/*.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ROOMS = ['briefing', 'meeting', 'approval', 'workspace', 'command', 'server', 'pantry', 'lounge'];
const POSES = [
  ['front', 'Depan', 'wajib'],
  ['side', 'Samping', 'menghadap kiri'],
  ['back', 'Belakang', 'opsional'],
  ['portrait', 'Potret', 'opsional'],
];
const TYPE_LABEL = {
  lead: 'Sesi utama (Lead)',
  '*': 'Tipe lain',
  Explore: 'Explore',
  'general-purpose': 'general-purpose',
  Plan: 'Plan',
  'claude-code-guide': 'claude-code-guide',
  claude: 'claude',
  'statusline-setup': 'statusline-setup',
};
const BUILTIN = new Set(Object.keys(TYPE_LABEL));
const ACCENTS = ['#f0b44c', '#76b900', '#62b3ff', '#a78bfa', '#f87171', '#2dd4bf', '#fb923c'];

async function api(method, url, body, raw = false) {
  const res = await fetch(url, {
    method,
    headers: raw ? { 'content-type': body.type || 'application/octet-stream' } : { 'content-type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `gagal (${res.status})`);
  return data;
}

export function createCustomPanel({ reload, portraitSrc }) {
  let cfg = null;
  let lastKey = '';
  let unusedOpen = false;
  let tab = 'chars';
  const drawer = $('custom');
  const body = $('cBody');
  let toastTimer = 0;

  function toast(text, bad = false) {
    const el = $('cToast');
    el.textContent = text;
    el.className = `ctoast show${bad ? ' bad' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'ctoast'), bad ? 4000 : 1600);
  }

  async function run(label, fn) {
    try {
      const out = await fn();
      toast(label);
      await reload();
      return out;
    } catch (err) {
      toast(err.message, true);
      return null;
    }
  }
  const save = (patch, label = 'Tersimpan') => run(label, () => api('PUT', '/api/settings', patch));

  function open() {
    drawer.hidden = false;
    requestAnimationFrame(() => drawer.classList.add('open'));
    $('cogBtn').setAttribute('aria-expanded', 'true');
    render();
  }
  function close() {
    drawer.classList.remove('open');
    $('cogBtn').setAttribute('aria-expanded', 'false');
    setTimeout(() => (drawer.hidden = true), 200);
  }
  $('cogBtn').addEventListener('click', () => (drawer.hidden ? open() : close()));
  $('cClose').addEventListener('click', close);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !drawer.hidden && close());
  for (const b of drawer.querySelectorAll('[data-tab]'))
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      render();
    });

  // ---------- render ----------

  // Identitas elemen yang stabil antar-render, untuk mengembalikan fokus & isian.
  function keyOf(el) {
    const form = el.closest('form[data-form]')?.dataset.form;
    if (form) return `form:${form}:${el.name}`;
    const d = el.dataset;
    if (d.field) return `field:${d.id}:${d.field}`;
    if (d.label) return `label:${d.label}`;
    return null;
  }

  function render() {
    if (!cfg || drawer.hidden) return;
    // Simpan isian form yang belum dikirim + elemen yang sedang fokus, lalu kembalikan setelah render.
    const kept = new Map();
    for (const el of body.querySelectorAll('form[data-form] input:not([type=file]), form[data-form] select'))
      kept.set(keyOf(el), el.value);
    const active = body.contains(document.activeElement) ? document.activeElement : null;
    const activeKey = active && keyOf(active);
    if (activeKey) kept.set(activeKey, active.value);
    const caret = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = body.scrollTop;

    for (const b of drawer.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
    body.innerHTML = tab === 'chars' ? charsTab() : tab === 'theme' ? themeTab() : roomsTab();
    bind();

    for (const el of body.querySelectorAll('input:not([type=file]), select')) {
      const k = keyOf(el);
      if (k && kept.has(k) && el.type !== 'color') el.value = kept.get(k);
      if (k && k === activeKey) {
        el.focus();
        if (caret) {
          try {
            el.setSelectionRange(...caret);
          } catch {
            /* tidak semua input mendukung seleksi */
          }
        }
      }
    }
    body.scrollTop = scroll;
  }

  const charOptions = (selected) =>
    Object.entries(cfg.settings.characters)
      .map(([id, c]) => `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(c.name)}</option>`)
      .join('');

  function charsTab() {
    const { characters, assign } = cfg.settings;
    const types = cfg.knownTypes;
    const rows = types
      .map((t) => {
        const custom = !BUILTIN.has(t);
        return `<div class="crow">
          <span class="clabel">${esc(TYPE_LABEL[t] ?? t)}${custom ? ' <em>kustom</em>' : ''}</span>
          <select data-assign="${esc(t)}">${charOptions(assign[t] ?? 'default')}</select>
          ${custom && assign[t] ? `<button class="ibtn" data-unassign="${esc(t)}" title="Hapus tipe ini">✕</button>` : '<span></span>'}
        </div>`;
      })
      .join('');
    const usedIds = new Set([...Object.values(assign), ...(cfg.settings.slots ?? [])]);
    const card = ([id, c]) => [[id, c]]

      .map(([id, c]) => {
        const sample = { sprite: id, colour: c.colour };
        const used = Object.entries(assign)
          .filter(([, v]) => v === id)
          .map(([t]) => TYPE_LABEL[t] ?? t);
        const slots = POSES.map(
          ([pose, label, hint]) => `<label class="slot" title="${esc(label)} (${hint})">
            <input type="file" accept="image/png,image/jpeg,image/webp" data-upload="${esc(id)}" data-pose="${pose}" hidden>
            <span>${label}</span><small>${hint}</small></label>`,
        ).join('');
        return `<div class="ccard" style="--c:${esc(c.colour)}">
          <div class="chead">
            <img src="${portraitSrc(sample, 128)}" alt="">
            <div class="cfields">
              <input data-field="name" data-id="${esc(id)}" value="${esc(c.name)}" maxlength="40" aria-label="Nama">
              <input data-field="role" data-id="${esc(id)}" value="${esc(c.role)}" maxlength="40" placeholder="Peran" aria-label="Peran">
            </div>
            <input type="color" data-field="colour" data-id="${esc(id)}" value="${esc(c.colour)}" aria-label="Warna">
          </div>
          <div class="cused">${used.length ? `Dipakai untuk: ${esc(used.join(', '))}` : 'Belum dipakai tipe apa pun'}</div>
          <div class="slots">${slots}</div>
          ${id === 'default' ? '' : `<button class="lbtn danger" data-remove="${esc(id)}">Hapus karakter</button>`}
        </div>`;
      })
      .join('');
    const entries = Object.entries(characters);
    const cards = entries.filter(([id]) => usedIds.has(id)).map((e) => card(e)).join('');
    const unused = entries.filter(([id]) => !usedIds.has(id));
    const unusedCards = unused.map((e) => card(e)).join('');
    const slots = cfg.settings.slots ?? [];
    const slotRows = slots
      .map(
        (id, i) => `<div class="crow"><span class="clabel">Subagent ke-${i + 1}${i === slots.length - 1 ? ' <em>+ luapan</em>' : ''}</span>
          <select data-slot="${i}">${charOptions(id)}</select>
          <button class="ibtn" data-slot-del="${i}" title="Hapus slot">✕</button></div>`,
      )
      .join('');
    const templates = cfg.settings.templates ?? [];
    const tplRows = templates
      .map(
        (t) => `<div class="tpl"><button class="lbtn" data-tpl="${esc(t.id)}">${esc(t.name)}</button>
          <span class="tplmeta">${esc(characters[t.assign.lead]?.name ?? '?')} · ${t.slots.length ? `${t.slots.length} slot` : 'per tipe'}</span>
          <button class="ibtn" data-tpl-del="${esc(t.id)}" title="Hapus template">✕</button></div>`,
      )
      .join('');
    return `
      <section><h4>Template</h4>
        <p class="chint">Satu klik mengganti siapa memerankan apa + peta, warna, dan tampilan.</p>
        ${tplRows || '<p class="chint">Belum ada template.</p>'}
        <form class="cadd" data-form="tpl">
          <input name="name" placeholder="Simpan kondisi sekarang sebagai…" maxlength="40" required>
          <button class="lbtn">Simpan</button>
        </form>
      </section>
      <section><h4>Subagent berurutan</h4>
        <p class="chint">${slots.length ? 'Subagent pertama yang jalan memakai karakter ke-1, kedua ke-2, dst. Lebih dari jumlah slot → kembaran karakter terakhir. Karakter per tipe di bawah tetap tampil sebagai staf yang istirahat.' : 'Belum aktif: subagent dipetakan per tipe (bagian di bawah). Tambah slot untuk beralih ke mode berurutan.'}</p>
        ${slotRows}
        <button class="lbtn" data-slot-add ${slots.length >= 6 ? 'disabled' : ''}>Tambah slot</button>
      </section>
      <section><h4>Siapa memerankan apa</h4>
        <p class="chint">Tiap tipe agent Claude Code diwakili satu karakter. "Tipe lain" dipakai untuk tipe yang tidak ada di daftar.</p>
        ${rows}
        <form class="cadd" data-form="type">
          <input name="type" placeholder="Tipe subagent kustom, mis. code-reviewer" maxlength="60" required>
          <button class="lbtn">Tambah tipe</button>
        </form>
      </section>
      <section><h4>Karakter</h4>
        <p class="chint">Ubah nama/peran/warna langsung di kartu. Unggah gambar per pose (PNG/JPG, latar putih otomatis dibuang); pose yang kosong memakai gambar depan.</p>
        ${cards}
        ${unused.length ? `<details class="unused"><summary>Tidak dipakai (${unused.length})</summary>${unusedCards}</details>` : ''}
        <form class="cadd col" data-form="char">
          <h5>Karakter baru</h5>
          <input name="name" placeholder="Nama" maxlength="40" required>
          <input name="role" placeholder="Peran (opsional)" maxlength="40">
          <label class="inline">Warna <input type="color" name="colour" value="#62b3ff"></label>
          <button class="lbtn">Tambah karakter</button>
        </form>
      </section>`;
  }

  function themeTab() {
    const { offices, theme } = cfg.settings;
    const cards = offices
      .map(
        (o) => `<label class="ocard${theme.office === o.id ? ' on' : ''}">
          <input type="radio" name="office" value="${esc(o.id)}"${theme.office === o.id ? ' checked' : ''}>
          <img src="${esc(o.url)}" alt="">
          <span class="oname">${esc(o.name)}</span>
          <span class="ometa">
            <select data-office-time="${esc(o.id)}" aria-label="Waktu peta">
              <option value=""${!o.time ? ' selected' : ''}>—</option>
              <option value="day"${o.time === 'day' ? ' selected' : ''}>siang</option>
              <option value="night"${o.time === 'night' ? ' selected' : ''}>malam</option>
            </select>
            ${theme.office === o.id ? '' : `<button class="ibtn" type="button" data-office-del="${esc(o.id)}" title="Hapus peta">✕</button>`}
          </span>
        </label>`,
      )
      .join('');
    const hasDay = offices.some((o) => o.time === 'day');
    const hasNight = offices.some((o) => o.time === 'night');
    return `
      <section><h4>Peta kantor</h4>
        <label class="ocard auto${theme.office === 'auto' ? ' on' : ''}">
          <input type="radio" name="office" value="auto"${theme.office === 'auto' ? ' checked' : ''}${hasDay && hasNight ? '' : ' disabled'}>
          <span class="oname">Otomatis siang/malam</span>
          <span class="chint">${hasDay && hasNight ? 'Peta "siang" 06.00–18.00, peta "malam" selainnya, mengikuti jam komputer.' : 'Tandai satu peta "siang" dan satu "malam" dulu.'}</span>
        </label>
        <div class="ogrid">${cards}</div>
        <form class="cadd col" data-form="office">
          <h5>Unggah peta sendiri</h5>
          <input name="name" placeholder="Nama peta" maxlength="40" required>
          <select name="time"><option value="">Waktu: —</option><option value="day">siang</option><option value="night">malam</option></select>
          <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required>
          <p class="chint">Tampak atas 4:3 dengan tata letak 8 ruangan yang sama. Setelah diunggah, cek posisi kursi & pintunya di halaman Peta.</p>
          <button class="lbtn">Unggah peta</button>
        </form>
      </section>
      <section><h4>Warna aksen</h4>
        <div class="swatches">${ACCENTS.map((c) => `<button class="sw${theme.accent === c ? ' on' : ''}" data-accent="${c}" style="--s:${c}" aria-label="Aksen ${c}"></button>`).join('')}
          <input type="color" data-accent-custom value="${esc(theme.accent)}" aria-label="Warna aksen lain">
        </div>
      </section>
      <section><h4>Tampilan</h4>
        <div class="seg">
          <button data-panel="dark" class="${theme.panel === 'dark' ? 'on' : ''}">Panel gelap</button>
          <button data-panel="light" class="${theme.panel === 'light' ? 'on' : ''}">Panel terang</button>
        </div>
        <label class="inline"><input type="checkbox" data-dim${theme.dimIdle ? ' checked' : ''}> Redupkan kantor saat tidak ada sesi Claude</label>
      </section>`;
  }

  function roomsTab() {
    const { rooms } = cfg.settings;
    const labels = ROOMS.map(
      (k) => `<div class="crow"><span class="clabel">${k}</span><input data-label="${k}" value="${esc(rooms.labels[k])}" maxlength="30"></div>`,
    ).join('');
    const roomOpts = (sel) =>
      ROOMS.map((k) => `<option value="${k}"${sel === k ? ' selected' : ''}>${esc(rooms.labels[k])}</option>`).join('') +
      `<option value="stay"${sel === 'stay' ? ' selected' : ''}>Tetap di tempat</option>`;
    const rules = Object.entries(cfg.toolGroups)
      .map(([g, label]) => `<div class="crow"><span class="clabel">${esc(label)}</span><select data-rule="${g}">${roomOpts(rooms.rules[g])}</select></div>`)
      .join('');
    return `
      <section><h4>Nama ruangan</h4>${labels}</section>
      <section><h4>Ke mana karakter pergi saat memakai…</h4>
        <p class="chint">Memberi tugas ke subagent selalu ke Briefing; menunggu izin selalu ke Approval.</p>
        ${rules}
      </section>
      <section><a class="lbtn" href="/picker.html">Atur posisi kursi, pintu & jalur di halaman Peta →</a></section>`;
  }

  // ---------- interaksi ----------

  function bind() {
    const slots = () => [...(cfg.settings.slots ?? [])];
    for (const el of body.querySelectorAll('[data-slot]'))
      el.addEventListener('change', () => {
        const next = slots();
        next[Number(el.dataset.slot)] = el.value;
        save({ slots: next });
      });
    for (const el of body.querySelectorAll('[data-slot-del]'))
      el.addEventListener('click', () => save({ slots: slots().filter((_, i) => i !== Number(el.dataset.slotDel)) }, 'Slot dihapus'));
    body.querySelector('[data-slot-add]')?.addEventListener('click', () => save({ slots: [...slots(), 'default'] }, 'Slot ditambahkan'));
    for (const el of body.querySelectorAll('[data-tpl]'))
      el.addEventListener('click', () => run(`Template "${el.textContent}" dipasang`, () => api('POST', `/api/templates/${el.dataset.tpl}/apply`, {})));
    for (const el of body.querySelectorAll('[data-tpl-del]'))
      el.addEventListener('click', () => {
        if (!confirm('Hapus template ini? Karakternya tidak ikut terhapus.')) return;
        run('Template dihapus', () => api('DELETE', `/api/templates/${el.dataset.tplDel}`));
      });
    body.querySelector('[data-form=tpl]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      run('Template disimpan', () => api('POST', '/api/templates', { name: new FormData(e.target).get('name') }));
    });
    // Grup "Tidak dipakai" mengingat terbuka/terlipat antar-render.
    const det = body.querySelector('details.unused');
    if (det) {
      det.open = unusedOpen;
      det.addEventListener('toggle', () => (unusedOpen = det.open));
    }
    for (const el of body.querySelectorAll('[data-assign]'))
      el.addEventListener('change', () => save({ assign: { [el.dataset.assign]: el.value } }));
    for (const el of body.querySelectorAll('[data-unassign]'))
      el.addEventListener('click', () => save({ assign: { [el.dataset.unassign]: null } }, 'Tipe dihapus'));
    for (const el of body.querySelectorAll('[data-field]'))
      el.addEventListener('change', () => save({ characters: { [el.dataset.id]: { [el.dataset.field]: el.value } } }));
    for (const el of body.querySelectorAll('[data-remove]'))
      el.addEventListener('click', () => {
        const name = cfg.settings.characters[el.dataset.remove]?.name;
        if (!confirm(`Hapus karakter "${name}"? Gambar aslinya tetap tersimpan di folder raw/.`)) return;
        run('Karakter dihapus', () => api('DELETE', `/api/characters/${el.dataset.remove}`));
      });
    for (const el of body.querySelectorAll('[data-upload]'))
      el.addEventListener('change', async () => {
        const file = el.files[0];
        if (!file) return;
        el.closest('.slot').classList.add('busy');
        const out = await run('Gambar diproses', () => api('POST', `/api/upload/character/${el.dataset.upload}/${el.dataset.pose}`, file, true));
        if (out?.note) toast(out.note);
        el.closest('.slot')?.classList.remove('busy');
      });

    for (const el of body.querySelectorAll('input[name=office]'))
      el.addEventListener('change', () => save({ theme: { office: el.value } }, 'Peta diganti'));
    for (const el of body.querySelectorAll('[data-office-time]'))
      el.addEventListener('change', () => save({ offices: { [el.dataset.officeTime]: { time: el.value || null } } }));
    for (const el of body.querySelectorAll('[data-office-del]'))
      el.addEventListener('click', (e) => {
        e.preventDefault();
        if (!confirm('Hapus peta ini dari daftar? Berkas gambarnya tetap tersimpan.')) return;
        run('Peta dihapus', () => api('DELETE', `/api/offices/${el.dataset.officeDel}`));
      });
    for (const el of body.querySelectorAll('[data-accent]')) el.addEventListener('click', () => save({ theme: { accent: el.dataset.accent } }));
    body.querySelector('[data-accent-custom]')?.addEventListener('change', (e) => save({ theme: { accent: e.target.value } }));
    for (const el of body.querySelectorAll('[data-panel]')) el.addEventListener('click', () => save({ theme: { panel: el.dataset.panel } }));
    body.querySelector('[data-dim]')?.addEventListener('change', (e) => save({ theme: { dimIdle: e.target.checked } }));

    for (const el of body.querySelectorAll('[data-label]'))
      el.addEventListener('change', () => save({ rooms: { labels: { [el.dataset.label]: el.value } } }));
    for (const el of body.querySelectorAll('[data-rule]'))
      el.addEventListener('change', () => save({ rooms: { rules: { [el.dataset.rule]: el.value } } }));

    body.querySelector('[data-form=type]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const type = new FormData(e.target).get('type').trim();
      save({ assign: { [type]: 'default' } }, `Tipe "${type}" ditambahkan`);
    });
    body.querySelector('[data-form=char]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      run('Karakter ditambahkan — unggah gambarnya di kartunya', () => api('POST', '/api/characters', f));
    });
    body.querySelector('[data-form=office]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const file = f.get('file');
      const q = new URLSearchParams({ name: f.get('name'), time: f.get('time') });
      e.target.querySelector('button').textContent = 'Memproses…';
      await run('Peta ditambahkan — cek posisinya di halaman Peta', () => api('POST', `/api/upload/office?${q}`, file, true));
    });
  }

  return {
    /** Dipanggil setiap konfigurasi dimuat ulang; render hanya kalau isinya memang berubah. */
    refresh(next) {
      const key = JSON.stringify([next.settings, next.manifest, next.knownTypes]);
      cfg = next;
      if (key === lastKey) return;
      lastKey = key;
      render();
    },
  };
}
