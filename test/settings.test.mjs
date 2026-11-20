import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addCharacter, applyPatch, buildTeam, fromTeam, normalizeSettings, removeCharacter } from '../lib/settings.mjs';

const legacy = {
  lead: { name: 'Jensen', role: 'Orchestrator', sprite: 'lead', colour: '#76b900' },
  types: {
    Explore: { name: 'Coki', role: 'Explore', sprite: 'explore', colour: '#a78bfa' },
    '*': { name: 'Agent', role: 'Subagent', sprite: 'default', colour: '#a09cb3' },
  },
};

test('migrasi dari team.json lama menghasilkan team yang sama', () => {
  const s = normalizeSettings(fromTeam(legacy));
  const t = buildTeam(s);
  assert.equal(t.lead.name, 'Jensen');
  assert.equal(t.types.Explore.sprite, 'explore');
  assert.equal(t.types['*'].sprite, 'default');
  assert.equal(t.rules.bash, 'server');
});

test('tukar penugasan, karakter baru, validasi, dan hapus', () => {
  let s = normalizeSettings(fromTeam(legacy));
  s = applyPatch(s, { assign: { lead: 'explore', Explore: 'lead' } });
  assert.equal(buildTeam(s).lead.name, 'Coki');
  assert.throws(() => applyPatch(s, { characters: { lead: { colour: 'merah' } } }), /#rrggbb/);
  assert.throws(() => applyPatch(s, { assign: { lead: null } }), /tidak bisa dihapus/);
  assert.throws(() => applyPatch(s, { rooms: { rules: { bash: 'dapur' } } }), /tidak ada/);
  let id;
  [s, id] = addCharacter(s, { name: 'Dokter Tirta', colour: '#2dd4bf' });
  assert.equal(id, 'dokter-tirta');
  s = applyPatch(s, { assign: { 'code-reviewer': id } });
  assert.equal(buildTeam(s).types['code-reviewer'].name, 'Dokter Tirta');
  assert.throws(() => removeCharacter(s, id), /masih dipakai/);
  s = applyPatch(s, { assign: { 'code-reviewer': null } });
  s = removeCharacter(s, id);
  assert.equal(s.characters[id], undefined);
});

test('template: simpan, pasang, tolak kalau karakternya sudah dihapus, lindungi karakter yang dipakai template', async () => {
  const { saveTemplate, applyTemplate, removeTemplate } = await import('../lib/settings.mjs');
  let s = normalizeSettings(fromTeam(legacy));
  let id;
  [s, id] = saveTemplate(s, 'Awal');
  s = applyPatch(s, { assign: { lead: 'explore' }, theme: { accent: '#123456' } });
  assert.equal(buildTeam(s).lead.name, 'Coki');
  s = applyTemplate(s, id);
  assert.equal(buildTeam(s).lead.name, 'Jensen');
  assert.equal(s.theme.accent, '#f0b44c');
  let extra;
  [s, extra] = addCharacter(s, { name: 'Sementara' });
  s = applyPatch(s, { assign: { lead: extra } });
  let tid;
  [s, tid] = saveTemplate(s, 'Pakai sementara');
  s = applyPatch(s, { assign: { lead: 'lead' } });
  assert.throws(() => removeCharacter(s, extra), /template/);
  s = removeTemplate(s, tid);
  s = removeCharacter(s, extra);
  assert.equal(s.templates.length, 1);
});
