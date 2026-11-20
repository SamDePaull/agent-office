// Katalog: semua skill, slash command, subagent, MCP, dan plugin yang terpasang + pemakaiannya.
import { DICT } from './catalog-i18n.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const KIND_KEYS = ['all', 'skill', 'command', 'agent', 'mcp', 'plugin'];

let items = [];
let lastData = null;
let ui = { kind: 'all', source: 'all', fav: false, isNew: false, unused: false, sort: 'count', q: '', byOrigin: true, lang: 'id' };
try {
  ui = { ...ui, ...JSON.parse(localStorage.getItem('catalog.ui') || '{}'), q: '' };
} catch {}
const saveUi = () => {
  try {
    localStorage.setItem('catalog.ui', JSON.stringify({ ...ui, q: '' }));
  } catch {}
};
const t = () => DICT[ui.lang] ?? DICT.id;
const kindLabel = (k) => t().kinds[k] ?? k;

// Seksi asal yang dilipat (per penampil, hanya kenyamanan).
let collapsed = new Set();
try {
  collapsed = new Set(JSON.parse(localStorage.getItem('catalog.collapsed') || '[]'));
} catch {}
const saveCollapsed = () => {
  try {
    localStorage.setItem('catalog.collapsed', JSON.stringify([...collapsed]));
  } catch {}
};

/* ---------- teks per bahasa ---------- */
const descOf = (it) => (ui.lang === 'id' ? it.descId || it.desc : it.desc) || '';
const scopeText = (it) =>
  it.members ? t().projects(it.members.length) : (t().scope[it.scopeLabel] ?? it.scopeLabel);
const invokeOf = (it) =>
  it.kind === 'agent' ? t().invokeAgent(it.name) : it.kind === 'mcp' ? t().invokeMcp(it.name) : it.invoke;

/** Asal efektif: yang Anda isi manual di catatan menang atas hasil deteksi. */
function originFor(it) {
  const manual = it.note?.origin?.trim();
  if (!manual) {
    const o = it.origin ?? { key: 'self', label: '', via: '' };
    return { ...o, label: o.key === 'self' ? t().self : o.label, via: t().via(o.via) };
  }
  const owner = manual.split('/')[0].trim();
  return { key: owner.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'self', label: owner, via: t().manualVia(manual), manual: true };
}

/* ---------- waktu ---------- */
function ago(ts) {
  if (!ts) return '';
  const a = t().ago;
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return a.now;
  if (s < 3600) return `${Math.floor(s / 60)} ${a.m}`;
  if (s < 86400) return `${Math.floor(s / 3600)} ${a.h}`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} ${a.d}`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400 / 7)} ${a.w}`;
  return `${Math.floor(s / 86400 / 30)} ${a.mo}`;
}
const date = (ts) => (ts ? new Date(ts).toLocaleString(t().locale, { dateStyle: 'medium', timeStyle: 'short' }) : '-');

/* ---------- tema dari pengaturan kantor ---------- */
fetch('/api/config')
  .then((r) => r.json())
  .then(({ settings }) => {
    document.documentElement.style.setProperty('--gold', settings.theme.accent);
    document.documentElement.dataset.theme = settings.theme.panel;
  })
  .catch(() => {});

/* ---------- teks statis halaman ---------- */
function applyStatic() {
  const d = t();
  document.documentElement.lang = ui.lang;
  document.title = `${d.title} · Agent Office`;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = d[el.dataset.i18n];
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = d[el.dataset.i18nPh];
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = d[el.dataset.i18nTitle];
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', b.dataset.lang === ui.lang);
  $('dClose').setAttribute('aria-label', d.close);
}
for (const b of document.querySelectorAll('[data-lang]'))
  b.addEventListener('click', () => {
    if (ui.lang === b.dataset.lang) return;
    ui.lang = b.dataset.lang;
    saveUi();
    applyStatic();
    renderFilters();
    render();
    if (!$('dlg').hidden && openId) openId === CLEAN ? openClean() : openDetail(findItem(openId));
    if (askState) renderAsk();
  });

/* ---------- data ---------- */
let pollTimer;
async function load() {
  const res = await fetch('/api/catalog');
  const data = await res.json();
  lastData = data;
  items = groupProjects(data.items, data.notes ?? {});
  renderFilters();
  render();
  clearTimeout(pollTimer);
  // Riwayat pemakaian / terjemahan belum selesai (pertama kali): muat ulang sampai siap.
  if (!data.usageReady || data.translating) pollTimer = setTimeout(load, data.usageReady ? 5000 : 2500);
}

/**
 * Item proyek yang sama (jenis + nama) di beberapa proyek → satu kartu dengan `members`.
 * Pemakaian tiap anggota hanya dihitung di proyeknya sendiri, jadi menjumlahkannya tidak dobel.
 */
function groupProjects(list, notes) {
  const groups = new Map();
  const out = [];
  for (const it of list) {
    if (it.scope !== 'project' || it.kind === 'mcp') {
      out.push(it);
      continue;
    }
    const k = `${it.kind}|${it.name}`;
    if (!groups.has(k)) {
      groups.set(k, []);
      out.push(k); // tempat kartu grup di urutan asal
    }
    groups.get(k).push(it);
  }
  return out.map((x) => {
    if (typeof x !== 'string') return x;
    const members = groups.get(x).sort((a, b) => b.usage.count - a.usage.count || a.scopeLabel.localeCompare(b.scopeLabel));
    if (members.length === 1) return members[0];
    const first = members[0];
    const id = `group|${x}`;
    const projects = new Map();
    for (const m of members) for (const p of m.usage.projects) projects.set(p.name, (projects.get(p.name) ?? 0) + p.count);
    const withDesc = members.find((m) => m.desc) ?? first;
    return {
      ...first,
      id,
      members,
      desc: withDesc.desc || '',
      descId: withDesc.descId || null,
      variants: new Set(members.map((m) => m.contentHash ?? m.desc)).size,
      installedAt: Math.max(...members.map((m) => m.installedAt)),
      isNew: members.some((m) => m.isNew),
      hasDoc: members.some((m) => m.hasDoc),
      path: null,
      usage: {
        count: members.reduce((n, m) => n + m.usage.count, 0),
        last: Math.max(...members.map((m) => m.usage.last)),
        projects: [...projects].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        tools: [],
      },
      // Catatan grup memakai id grup; catatan lama milik salah satu anggota tetap terbaca.
      note: notes[id] ?? members.find((m) => m.note)?.note ?? null,
    };
  });
}
const findItem = (id) => items.find((i) => i.id === id) ?? items.flatMap((i) => i.members ?? []).find((m) => m.id === id);

function sources() {
  const m = new Map();
  for (const it of items.flatMap((i) => i.members ?? [i])) {
    const key = sourceKey(it);
    const label =
      it.scope === 'project' ? `${t().project}: ${it.scopeLabel}` : it.scope === 'plugin' ? `Plugin: ${it.plugin}` : scopeText(it);
    m.set(key, label);
  }
  const order = (k) => ['user', 'claudeai', 'builtin', 'seen'].indexOf(k) + 1 || (k.startsWith('plugin') ? 10 : 20);
  return [...m].sort((a, b) => order(a[0]) - order(b[0]) || a[1].localeCompare(b[1]));
}
const sourceKey = (it) => (it.scope === 'project' ? `project:${it.scopeLabel}` : it.scope === 'plugin' ? `plugin:${it.plugin}` : it.scope);

function renderFilters() {
  const opts = sources();
  if (ui.source !== 'all' && !opts.some(([k]) => k === ui.source)) ui.source = 'all';
  $('source').innerHTML =
    `<option value="all">${esc(t().allSources)}</option>` +
    opts.map(([k, l]) => `<option value="${esc(k)}"${k === ui.source ? ' selected' : ''}>${esc(l)}</option>`).join('');
  $('sort').value = ui.sort;
  $('fFav').setAttribute('aria-pressed', ui.fav);
  $('fNew').setAttribute('aria-pressed', ui.isNew);
  $('fUnused').setAttribute('aria-pressed', ui.unused);
  $('fGroup').setAttribute('aria-pressed', ui.byOrigin);
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

function matches(it, { skipKind = false } = {}) {
  if (!skipKind && ui.kind !== 'all' && it.kind !== ui.kind) return false;
  if (ui.source !== 'all' && !(it.members ?? [it]).some((m) => sourceKey(m) === ui.source)) return false;
  if (ui.fav && !it.note?.fav) return false;
  if (ui.isNew && !it.isNew) return false;
  if (ui.unused && it.usage.count) return false;
  if (ui.q) {
    const o = originFor(it);
    // Cari di kedua bahasa deskripsi, supaya kata Inggris tetap ketemu saat tampilan Indonesia.
    const hay = norm(
      [it.name, it.desc, it.descId, o.label, o.via, ...(it.members ?? [it]).map((m) => m.scopeLabel), it.invoke, it.note?.text, ...(it.note?.tags ?? [])].join(' '),
    );
    if (
      !norm(ui.q)
        .split(/\s+/)
        .every((w) => hay.includes(w))
    )
      return false;
  }
  return true;
}

const SORTS = {
  count: (a, b) => b.usage.count - a.usage.count || b.usage.last - a.usage.last || a.name.localeCompare(b.name),
  last: (a, b) => b.usage.last - a.usage.last || a.name.localeCompare(b.name),
  installed: (a, b) => b.installedAt - a.installedAt || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name) || a.scopeLabel.localeCompare(b.scopeLabel),
};

function card(it) {
  const d = t();
  const used = it.usage.count
    ? `<span class="used"><b>${it.usage.count}×</b> · ${esc(ago(it.usage.last))}</span>`
    : it.kind === 'plugin'
      ? `<span>${esc(pluginContents(it))}</span>`
      : `<span>${esc(d.neverUsed)}</span>`;
  const tags = it.note?.tags?.length ? `<div class="tags">${it.note.tags.map((x) => `<span class="tag">#${esc(x)}</span>`).join('')}</div>` : '';
  const inv = invokeOf(it);
  return `<article class="item k-${it.kind}${it.usage.count || it.kind === 'plugin' ? '' : ' unused'}" tabindex="0" data-id="${esc(it.id)}">
    <div class="ihead">
      <span class="kbadge">${esc(kindLabel(it.kind))}</span>
      ${it.isNew ? `<span class="newb">${esc(d.newBadge)}</span>` : ''}
      <span class="iname">${esc(it.name)}</span>
    </div>
    <button class="star${it.note?.fav ? ' on' : ''}" data-star title="${esc(d.fav)}" aria-label="${esc(d.fav)}">${it.note?.fav ? '★' : '☆'}</button>
    <div class="isrc">${ui.byOrigin ? '' : `${esc(originFor(it).label)} · `}${esc(it.members ? `${scopeText(it)} · ${it.members.map((m) => m.scopeLabel).join(', ')}` : scopeText(it))}${it.version ? ` · v${esc(it.version)}` : ''}</div>
    <div class="idesc">${esc(descOf(it).replace(/\*\*|`/g, ''))}</div>
    ${it.note?.text ? `<div class="inote">${esc(it.note.text)}</div>` : ''}
    ${tags}
    <div class="ifoot">${used}<button class="copy" data-copy title="${esc(d.copyTitle(inv))}">${esc(inv.trim())}</button></div>
  </article>`;
}

function pluginContents(it) {
  const c = it.contents ?? {};
  const parts = [
    c.skill && `${c.skill} skill`,
    c.command && `${c.command} command`,
    c.agent && `${c.agent} agent`,
    c.mcp && `${c.mcp} MCP`,
    c.hooks && `${c.hooks} hook`,
  ].filter(Boolean);
  return parts.join(' · ') || t().noContents;
}

function render() {
  const d = t();
  // Hitungan per jenis mengikuti filter lain (bukan filter jenis itu sendiri).
  const base = items.filter((it) => matches(it, { skipKind: true }));
  $('kinds').innerHTML = KIND_KEYS.map((k) => {
    const n = k === 'all' ? base.length : base.filter((i) => i.kind === k).length;
    return `<button class="kind-tab${k === 'all' ? '' : ` k-${k}`}" role="tab" aria-selected="${ui.kind === k}" data-kind="${k}">${k === 'all' ? '' : '<span class="dot"></span>'}${esc(kindLabel(k))} <span class="n">${n}</span></button>`;
  }).join('');
  const list = base.filter((it) => matches(it)).sort(SORTS[ui.sort] ?? SORTS.count);
  $('grid').className = ui.byOrigin ? 'osecs' : 'grid';
  $('grid').innerHTML = ui.byOrigin ? sections(list) : list.map(card).join('');
  $('empty').hidden = list.length > 0;
  const used = list.filter((i) => i.usage.count).length;
  let status = '';
  if (lastData && !lastData.usageReady) status = ` · <span class="scanning">${esc(d.scanning(lastData.progress))}</span>`;
  else if (ui.lang === 'id' && lastData?.translating) status = ` · <span class="scanning">${esc(d.translating(lastData.translating))}</span>`;
  else if (ui.lang === 'id' && lastData?.translateError) status = ` · <span class="scanning" title="${esc(lastData.translateError)}">${esc(d.translateFailed)}</span>`;
  $('summary').innerHTML =
    d.summary(
      list.length,
      used,
      list.filter((i) => i.isNew).length,
      list.filter((i) => i.note?.fav).length,
    ) + status;
}

/** Daftar → seksi per asal; seksi diurutkan menurut total pemakaian, lalu jumlah item. */
function sections(list) {
  const map = new Map();
  for (const it of list) {
    const o = originFor(it);
    let sec = map.get(o.key);
    if (!sec) map.set(o.key, (sec = { key: o.key, labels: new Map(), vias: new Map(), items: [], uses: 0 }));
    // Label otomatis lebih diutamakan daripada ketikan manual untuk judul seksi.
    sec.labels.set(o.label, (sec.labels.get(o.label) ?? 0) + (o.manual ? 1 : 100));
    sec.vias.set(o.via, (sec.vias.get(o.via) ?? 0) + 1);
    sec.items.push(it);
    sec.uses += it.usage.count;
  }
  const top = (m) => [...m].sort((a, b) => b[1] - a[1])[0][0];
  return [...map.values()]
    .sort((a, b) => b.uses - a.uses || b.items.length - a.items.length || a.key.localeCompare(b.key))
    .map((sec) => {
      const open = ui.q || !collapsed.has(sec.key); // saat mencari, semua seksi terbuka
      const vias = [...sec.vias.keys()].slice(0, 3).join(' · ') + (sec.vias.size > 3 ? ` · +${sec.vias.size - 3}` : '');
      const kinds = Object.entries(sec.items.reduce((a, i) => ({ ...a, [i.kind]: (a[i.kind] ?? 0) + 1 }), {}))
        .map(([k, n]) => `${n} ${kindLabel(k).toLowerCase()}`)
        .join(' · ');
      return `<section class="osec${open ? '' : ' shut'}">
        <button class="osec-head" data-sec="${esc(sec.key)}" aria-expanded="${open}">
          <span class="caret" aria-hidden="true">▾</span>
          <span class="olabel">${esc(top(sec.labels))}</span>
          <span class="ovia">${esc(vias)}</span>
          <span class="ocount">${kinds}${sec.uses ? ` · <b>${sec.uses}×</b>` : ''}</span>
        </button>
        ${open ? `<div class="grid">${sec.items.map(card).join('')}</div>` : ''}
      </section>`;
    })
    .join('');
}

/* ---------- interaksi daftar ---------- */
$('q').addEventListener('input', (e) => {
  ui.q = e.target.value.trim();
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
    e.preventDefault();
    $('q').focus();
  }
  if (e.key === 'Escape' && !$('dlg').hidden) closeDetail();
});
$('kinds').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]');
  if (!b) return;
  ui.kind = b.dataset.kind;
  saveUi();
  render();
});
$('source').addEventListener('change', (e) => {
  ui.source = e.target.value;
  saveUi();
  render();
});
$('sort').addEventListener('change', (e) => {
  ui.sort = e.target.value;
  saveUi();
  render();
});
for (const [id, key] of [
  ['fGroup', 'byOrigin'],
  ['fFav', 'fav'],
  ['fNew', 'isNew'],
  ['fUnused', 'unused'],
])
  $(id).addEventListener('click', () => {
    ui[key] = !ui[key];
    $(id).setAttribute('aria-pressed', ui[key]);
    saveUi();
    render();
  });
$('rescan').addEventListener('click', async () => {
  $('rescan').disabled = true;
  try {
    await load();
    toast(t().updated);
  } finally {
    $('rescan').disabled = false;
  }
});

$('grid').addEventListener('click', (e) => {
  const head = e.target.closest('[data-sec]');
  if (head) {
    const k = head.dataset.sec;
    collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k);
    saveCollapsed();
    return render();
  }
  const el = e.target.closest('.item');
  if (!el) return;
  const it = items.find((i) => i.id === el.dataset.id);
  if (!it) return;
  if (e.target.closest('[data-copy]')) return copy(invokeOf(it));
  if (e.target.closest('[data-star]')) return saveNote(it, { ...noteOf(it), fav: !it.note?.fav });
  openDetail(it);
});
$('grid').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const el = e.target.closest('.item');
  const it = el && items.find((i) => i.id === el.dataset.id);
  if (it) openDetail(it);
});

let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 1600);
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t().copied(text.trim()));
  } catch {
    toast(t().copyFailed);
  }
}

/* ---------- catatan & favorit ---------- */
const noteOf = (it) => ({ fav: false, text: '', tags: [], origin: '', ...(it.note ?? {}) });
async function saveNote(it, note) {
  const res = await fetch(`/api/catalog/note?id=${encodeURIComponent(it.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(note),
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || t().saveFailed);
  it.note = data.note;
  render();
  return true;
}

/* ---------- detail ---------- */
function bars(list) {
  const max = Math.max(...list.map((x) => x.count), 1);
  return `<div class="bars">${list
    .map(
      (x) =>
        `<div class="bar"><span class="nm" title="${esc(x.name)}">${esc(x.name)}</span><span class="tr"><i style="width:${(x.count / max) * 100}%"></i></span><span class="ct">${x.count}</span></div>`,
    )
    .join('')}</div>`;
}

let openId = null;
function openDetail(it) {
  if (!it) return;
  openId = it.id;
  $('dBody').onclick = null;
  const d = t();
  const n = noteOf(it);
  const u = it.usage;
  const o = originFor(it);
  const inv = invokeOf(it);
  const sheet = $('dlg').querySelector('.sheet');
  sheet.className = `sheet cat-sheet k-${it.kind}`;
  const docLabel = it.kind === 'mcp' ? d.docMcp : it.kind === 'plugin' ? d.docReadme : it.path?.endsWith('SKILL.md') ? d.docSkill : d.docFile;
  let siblings = '';
  if (it.members) {
    siblings = `<div class="sec"><h3>${esc(d.inProjects(it.members.length, it.variants))}</h3><div class="bars">${it.members
      .map(
        (m) => `<div class="member">
          <span class="nm">${esc(m.scopeLabel)}</span>
          <span class="mu">${m.usage.count ? `${m.usage.count}× · ${esc(ago(m.usage.last))}` : esc(d.neverUsed)}</span>
          ${m.hasDoc ? `<button class="btn mini" data-doc="${esc(m.id)}">${esc(d.open)}</button>` : ''}
        </div>`,
      )
      .join('')}</div><div id="dDoc"></div></div>`;
  }
  if (it.kind === 'plugin') {
    const kids = items.filter((i) => i.plugin === it.plugin && i.kind !== 'plugin');
    siblings = `<div class="sec"><h3>${esc(d.pluginContents(pluginContents(it)))}</h3><div class="tags">${kids
      .map((k) => `<span class="tag" data-open="${esc(k.id)}" style="cursor:pointer">${esc(kindLabel(k.kind))}: ${esc(k.name)}${k.usage.count ? ` · ${k.usage.count}×` : ''}</span>`)
      .join('')}</div></div>`;
  }
  const desc = descOf(it);
  $('dBody').innerHTML = `
    <h2 id="dName">${esc(it.name)}</h2>
    <div class="meta"><span class="kbadge">${esc(kindLabel(it.kind))}</span>${it.isNew ? `<span class="newb">${esc(d.newBadge)}</span>` : ''}<span>${esc(scopeText(it))}</span><span title="${esc(o.via)}">${esc(d.origin)}: <b>${esc(o.label)}</b> · ${esc(o.via)}</span>${
      it.version ? `<span>v${esc(it.version)}</span>` : ''
    }${it.installedAt ? `<span>${esc(d.installed(date(it.installedAt)))}</span>` : ''}</div>
    ${it.path ? `<div class="path">${esc(it.path)}</div>` : ''}
    <p class="desc">${desc ? inline(desc) : esc(d.noDesc)}</p>

    <div class="sec"><h3>${esc(d.howToCall)}</h3>
      <div class="invoke"><code>${esc(inv)}</code><button class="btn" data-copy>${esc(d.copy)}</button></div>
      <p class="hint">${esc(d.hints[it.kind] ?? '')}</p>
    </div>

    ${
      it.kind === 'plugin'
        ? ''
        : `<div class="sec"><h3>${esc(d.usage)}</h3>${
            u.count
              ? `<div class="stats"><div class="stat"><b>${u.count}×</b><span>${esc(d.total)}</span></div><div class="stat"><b>${esc(ago(u.last))}</b><span>${esc(date(u.last))}</span></div></div>
                 ${!it.members && (u.projects.length > 1 || (u.projects[0] && it.scope !== 'project')) ? `<h3>${esc(d.perProject)}</h3>${bars(u.projects)}` : ''}
                 ${u.tools.length ? `<h3 style="margin-top:10px">${esc(d.toolsUsed)}</h3>${bars(u.tools)}` : ''}`
              : `<p class="hint">${esc(d.neverUsedLong)}</p>`
          }</div>`
    }
    ${siblings}

    <div class="sec"><h3>${esc(d.notes)}</h3>
      <form class="note-form" id="noteForm">
        <textarea id="nText" placeholder="${esc(d.notePh)}">${esc(n.text)}</textarea>
        <div class="note-row">
          <input id="nTags" placeholder="${esc(d.tagsPh)}" value="${esc(n.tags.join(', '))}" />
          <input id="nOrigin" placeholder="${esc(d.originPh(it.origin?.key === 'self' ? d.self : (it.origin?.label ?? '')))}" value="${esc(n.origin ?? '')}" />
          <button type="button" class="tog" id="nFav" aria-pressed="${n.fav}">${esc(d.fav)}</button>
          <button class="btn" type="submit">${esc(d.save)}</button>
        </div>
      </form>
    </div>

    ${it.hasDoc && !it.members ? `<div class="sec"><button class="btn" id="dDocBtn">${esc(docLabel)}</button><div id="dDoc"></div></div>` : ''}
  `;
  $('dlg').hidden = false;
  $('dClose').focus();

  $('dBody').querySelector('[data-copy]').onclick = () => copy(inv);
  $('nFav').onclick = () => $('nFav').setAttribute('aria-pressed', $('nFav').getAttribute('aria-pressed') !== 'true');
  $('noteForm').onsubmit = async (e) => {
    e.preventDefault();
    const ok = await saveNote(it, {
      fav: $('nFav').getAttribute('aria-pressed') === 'true',
      text: $('nText').value,
      tags: $('nTags').value,
      origin: $('nOrigin').value,
    });
    if (ok) toast(t().noteSaved);
  };
  $('dBody')
    .querySelectorAll('[data-open]')
    .forEach((el) => (el.onclick = () => openDetail(findItem(el.dataset.open))));
  if (it.hasDoc && !it.members)
    $('dDocBtn').onclick = async () => {
      $('dDocBtn').disabled = true;
      await showDoc(it.id);
      $('dDocBtn').remove();
    };
  $('dBody')
    .querySelectorAll('[data-doc]')
    .forEach((el) => (el.onclick = () => showDoc(el.dataset.doc, findItem(el.dataset.doc)?.scopeLabel)));
}

/**
 * Tampilkan dokumen. Mode Indonesia: pakai terjemahan tersimpan kalau ada; kalau belum, tampilkan aslinya
 * dengan tombol "Terjemahkan" (diterjemahkan Claude saat diminta, lalu disimpan).
 */
async function showDoc(id, label, mode = ui.lang === 'id' ? 'id' : 'en', translate = false) {
  const d = t();
  const box = $('dDoc');
  if (translate) box.innerHTML = `<p class="hint">${esc(d.docTranslating)}</p>`;
  const qs = new URLSearchParams({ id, lang: mode });
  if (translate) qs.set('translate', '1');
  const res = await fetch(`/api/catalog/doc?${qs}`);
  const doc = await res.json();
  if (!$('dDoc') || openId === null) return; // modal sudah ditutup
  const head = label ? `<h3 style="margin-top:12px">${esc(label)}${doc.path ? ` · <span class="path">${esc(doc.path)}</span>` : ''}</h3>` : '';
  let bar = '';
  if (ui.lang === 'id' && doc.format === 'md') {
    if (mode === 'id' && doc.translated) bar = `<div class="docbar"><span>${esc(d.docTranslated)}</span><button class="btn mini" data-docmode="en">${esc(d.docShowOriginal)}</button></div>`;
    else if (mode === 'id') bar = `<div class="docbar"><span>${esc(d.docTranslateHint)}</span><button class="btn mini" data-doctrans>${esc(d.docTranslate)}</button></div>`;
    else bar = `<div class="docbar"><span></span><button class="btn mini" data-docmode="id">${esc(d.docShowTranslated)}</button></div>`;
  }
  const body = res.ok ? (doc.format === 'md' ? markdown(doc.text) : `<pre>${esc(doc.text)}</pre>`) : esc(doc.error);
  $('dDoc').innerHTML = `${head}${bar}<div class="doc">${body}</div>`;
  $('dDoc').querySelector('[data-doctrans]')?.addEventListener('click', () => showDoc(id, label, 'id', true));
  $('dDoc').querySelector('[data-docmode]')?.addEventListener('click', (e) => showDoc(id, label, e.target.dataset.docmode));
}
function closeDetail() {
  $('dlg').hidden = true;
  openId = null;
}
$('dClose').onclick = closeDetail;
$('dlg').addEventListener('click', (e) => e.target === $('dlg') && closeDetail());

/* ---------- ✦ tanya Claude: skill apa untuk tugas ini? ---------- */
let askState = null; // { q, loading, results, error }
function renderAsk() {
  const d = t();
  const box = $('askOut');
  if (!askState) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const head = `<div class="ask-head"><span>✦ ${esc(askState.q)}</span><button class="btn mini" data-askclose>${esc(d.askClose)}</button></div>`;
  if (askState.loading) return (box.innerHTML = `${head}<p class="ask-msg">${esc(d.asking)}</p>`);
  if (askState.error) return (box.innerHTML = `${head}<p class="ask-msg err">${esc(askState.error)}</p>`);
  const rows = askState.results
    .map((r, n) => ({ ...r, it: findItem(r.id) }))
    .filter((r) => r.it)
    .map(
      ({ it, why }, n) => `<div class="ask-row k-${it.kind}">
        <span class="rank">${n + 1}.</span>
        <div class="an"><span class="kbadge">${esc(kindLabel(it.kind))}</span><button data-askopen="${esc(it.id)}">${esc(it.name)}</button><span class="isrc">${esc(scopeText(it))}</span></div>
        <button class="copy" data-askcopy="${esc(it.id)}" title="${esc(d.copyTitle(invokeOf(it)))}">${esc(invokeOf(it).trim())}</button>
        <div class="why">${esc(why)}</div>
      </div>`,
    )
    .join('');
  box.innerHTML = head + (rows || `<p class="ask-msg">${esc(d.askNone)}</p>`);
}
$('askForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('askQ').value.trim();
  if (!q || askState?.loading) return;
  askState = { q, loading: true };
  $('askBtn').disabled = true;
  renderAsk();
  try {
    const res = await fetch('/api/catalog/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q, lang: ui.lang }),
    });
    const data = await res.json();
    askState = res.ok ? { q, results: data.results } : { q, error: data.error };
  } catch (err) {
    askState = { q, error: err.message };
  } finally {
    $('askBtn').disabled = false;
  }
  renderAsk();
});
$('askOut').addEventListener('click', (e) => {
  if (e.target.closest('[data-askclose]')) {
    askState = null;
    return renderAsk();
  }
  const open = e.target.closest('[data-askopen]');
  if (open) return openDetail(findItem(open.dataset.askopen));
  const c = e.target.closest('[data-askcopy]');
  if (c) copy(invokeOf(findItem(c.dataset.askcopy)));
});

/* ---------- 🧹 saran bersih-bersih (hanya saran; tidak ada yang dihapus dari sini) ---------- */
const CLEAN = '__clean';
const DAY = 86_400_000;
const shq = (p) => (p.startsWith('~/') ? `"$HOME/${p.slice(2)}"` : `"${p}"`);
const dirOf = (it) => (it.kind === 'skill' ? it.path.replace(/\/SKILL\.md$/, '') : it.path);
const pluginUsage = (it) => {
  const kids = items.filter((i) => i.plugin === it.plugin && i.kind !== 'plugin');
  return { count: kids.reduce((n, k) => n + k.usage.count, 0), last: Math.max(0, ...kids.map((k) => k.usage.last)) };
};
const removable = (it) =>
  it.kind === 'plugin' || (it.kind === 'mcp' ? ['user', 'project', 'local'].includes(it.mcpScope) : ['user', 'project'].includes(it.scope) && it.path);

function removeCmd(it) {
  if (it.kind === 'plugin') return `claude plugin uninstall ${it.plugin}${it.marketplace ? `@${it.marketplace}` : ''}`;
  if (it.kind === 'mcp')
    return it.mcpScope === 'user'
      ? `claude mcp remove ${it.name} -s user`
      : `cd ${shq(it.project)} && claude mcp remove ${it.name} -s ${it.mcpScope}`;
  const lock = it.origin?.via?.startsWith('GitHub') && it.scope === 'project' ? `\n${t().lockNote(it.name)}` : '';
  return `trash ${shq(dirOf(it))}${lock}`;
}

function cleanupGroups() {
  const now = Date.now();
  const unused = [];
  for (const it of items) {
    for (const m of it.members ?? [it]) {
      if (!removable(m) || m.detected) continue;
      const u = m.kind === 'plugin' ? pluginUsage(m) : m.usage;
      if (m.installedAt && now - m.installedAt < 14 * DAY) continue;
      if (u.count && now - u.last < 30 * DAY) continue;
      unused.push({ it: m, reason: u.count ? t().reasonOld(ago(u.last)) : t().reasonNever(m.installedAt ? date(m.installedAt) : ''), cmd: removeCmd(m) });
    }
  }
  unused.sort((a, b) => (a.it.usage.last || 0) - (b.it.usage.last || 0) || a.it.name.localeCompare(b.it.name));
  const grouped = items.filter((i) => i.members?.length > 1);
  const dup = grouped
    .filter((g) => g.variants === 1)
    .map((g) => ({
      it: g,
      reason: g.members.map((m) => m.scopeLabel).join(', '),
      cmd:
        `mkdir -p "$HOME/.claude/skills" && cp -R ${shq(dirOf(g.members[0]))} "$HOME/.claude/skills/"\n` +
        g.members.map((m) => `trash ${shq(dirOf(m))}`).join('\n'),
    }));
  const ver = grouped
    .filter((g) => g.variants > 1)
    .map((g) => {
      const ms = [...g.members].sort((a, b) => b.modifiedAt - a.modifiedAt);
      return {
        it: g,
        reason: ms.map((m, n) => `${m.scopeLabel} (${n === 0 ? t().newest : t().modified(date(m.modifiedAt))})`).join(' · '),
        cmd: ms.slice(1).map((m) => `diff -ru ${shq(dirOf(ms[0]))} ${shq(dirOf(m))}`).join('\n'),
      };
    });
  return { unused, dup, ver };
}

function openClean() {
  const d = t();
  openId = CLEAN;
  const { unused, dup, ver } = cleanupGroups();
  const rows = (list) =>
    list
      .map(
        ({ it, reason, cmd }, n) => `<div class="clean-row">
          <div class="cn">${esc(it.name)} <span class="kbadge k-${it.kind}" style="--kc:var(--k-${it.kind})">${esc(kindLabel(it.kind))}</span><small>${esc(scopeText(it))} · ${esc(reason)}</small></div>
          <button class="btn mini" data-cview="${esc(it.id)}">${esc(d.view)}</button>
          <button class="btn mini" data-ccopy="${n}">${esc(d.copyCmd)}</button>
          <pre>${esc(cmd)}</pre>
        </div>`,
      )
      .join('');
  const sec = (title, hint, list, key) =>
    list.length
      ? `<div class="clean-sec" data-csec="${key}"><h3>${esc(title)} · ${list.length}</h3><p class="hint">${esc(hint)}</p>${rows(list)}</div>`
      : '';
  const body = sec(d.cleanVer, d.cleanVerHint, ver, 'ver') + sec(d.cleanDup, d.cleanDupHint, dup, 'dup') + sec(d.cleanUnused, d.cleanUnusedHint, unused, 'unused');
  $('dlg').querySelector('.sheet').className = 'sheet cat-sheet';
  $('dBody').innerHTML = `<h2 id="dName">${esc(d.cleanTitle)}</h2><p class="hint">${esc(d.cleanIntro)}</p>${body || `<p class="ask-msg">${esc(d.cleanNone)}</p>`}`;
  $('dlg').hidden = false;
  $('dClose').focus();
  const lists = { ver, dup, unused };
  $('dBody').onclick = (e) => {
    const v = e.target.closest('[data-cview]');
    if (v) return openDetail(findItem(v.dataset.cview));
    const c = e.target.closest('[data-ccopy]');
    if (c) copy(lists[c.closest('[data-csec]').dataset.csec][Number(c.dataset.ccopy)].cmd);
  };
}
$('cleanBtn').addEventListener('click', openClean);

/* ---------- markdown sederhana (semua teks di-escape dulu) ---------- */
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function markdown(src) {
  const out = [];
  let text = String(src);
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    out.push(`<pre class="fm">${esc(fm[1])}</pre>`);
    text = text.slice(fm[0].length);
  }
  const lines = text.split('\n');
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      flushList();
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    const li = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const type = li[1] ? 'ul' : 'ol';
      if (list !== type) {
        flushList();
        out.push(`<${type}>`);
        list = type;
      }
      out.push(`<li>${inline(li[3])}</li>`);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flushPara();
      flushList();
      const rows = [line];
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) rows.push(lines[++i]);
      out.push(`<pre>${esc(rows.join('\n'))}</pre>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out.join('');
}

applyStatic();
// Dari papan nama di kantor: /catalog.html?q=figma-use
const initialQ = new URLSearchParams(location.search).get('q');
if (initialQ) {
  ui.q = initialQ;
  $('q').value = initialQ;
}
load().catch((err) => {
  $('summary').textContent = t().loadFailed(err.message);
});
