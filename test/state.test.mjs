import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEvent, createState, normalize, snapshot } from '../lib/state.mjs';

const team = {
  lead: { name: 'Lead', role: 'Orchestrator', sprite: 'lead', colour: '#f0b44c' },
  types: {
    Explore: { name: 'Scout', role: 'Explore', sprite: 'explore', colour: '#62b3ff' },
    '*': { name: 'Agent', role: 'Subagent', sprite: 'default', colour: '#a09cb3' },
  },
};

const T0 = 1_800_000_000_000;
function feed(state, list) {
  list.forEach(([ms, payload]) => applyEvent(state, normalize({ session_id: 's1', cwd: '/x/proj', ...payload }, T0 + ms), team));
}
const char = (snap, key) => snap.chars.find((c) => c.key === key);

test('spawn → briefing → ruang kerja sesuai tool → selesai ke ruang istirahat', () => {
  const st = createState();
  feed(st, [
    [0, { hook_event_name: 'UserPromptSubmit', prompt: 'cari banner' }],
    [10, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'Cari PageBanner' } }],
    [20, { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }],
    [30, { hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Grep', tool_input: { pattern: 'PageBanner' } }],
  ]);
  let s = snapshot(st, team, T0 + 1000);
  assert.equal(char(s, 'lead').room, 'briefing');
  assert.equal(char(s, 'type:Explore').room, 'briefing');
  assert.equal(char(s, 'type:Explore').task, 'Cari PageBanner');

  s = snapshot(st, team, T0 + 8000);
  assert.equal(char(s, 'lead').room, 'command');
  assert.equal(char(s, 'type:Explore').room, 'workspace');

  feed(st, [[9000, { hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Bash', tool_input: { command: 'ls' } }]]);
  assert.equal(char(snapshot(st, team, T0 + 9500), 'type:Explore').room, 'server');

  feed(st, [[12000, { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'Explore', say: 'Ketemu 3 file.' }]]);
  s = snapshot(st, team, T0 + 12500);
  assert.equal(char(s, 'type:Explore').status, 'completed');
  assert.equal(char(s, 'type:Explore').room, 'break');
  assert.equal(char(s, 'type:Explore').say, 'Ketemu 3 file.');
});

test('agent tidak pindah ruang lebih cepat dari 4 detik (tidak mondar-mandir)', () => {
  const st = createState();
  feed(st, [
    [0, { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }],
    [6000, { hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Read', tool_input: {} }],
    [7000, { hook_event_name: 'PreToolUse', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Bash', tool_input: {} }],
  ]);
  assert.equal(char(snapshot(st, team, T0 + 7100), 'type:Explore').room, 'workspace');
});

test('phantom SubagentStop (agent_type kosong) tidak mengubah state siapa pun', () => {
  const st = createState();
  feed(st, [
    [0, { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }],
    [100, { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: '' }],
  ]);
  assert.equal(char(snapshot(st, team, T0 + 200), 'type:Explore').status, 'working');
});

test('permintaan izin membawa agent ke ruang approval dengan badge', () => {
  const st = createState();
  feed(st, [
    [0, { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }],
    [100, { hook_event_name: 'PermissionRequest', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Bash' }],
  ]);
  const c = char(snapshot(st, team, T0 + 200), 'type:Explore');
  assert.equal(c.room, 'approval');
  assert.equal(c.badge, '!');
  feed(st, [[300, { hook_event_name: 'PostToolUse', agent_id: 'a1', agent_type: 'Explore', tool_name: 'Bash' }]]);
  assert.notEqual(char(snapshot(st, team, T0 + 400), 'type:Explore').room, 'approval');
});

test('dua agent bertipe sama: karakter tetap + kembaran bernomor; tipe tak dikenal memakai "*"', () => {
  const st = createState();
  feed(st, [
    [0, { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' }],
    [10, { hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'Explore' }],
    [20, { hook_event_name: 'SubagentStart', agent_id: 'a3', agent_type: 'my-custom' }],
  ]);
  const s = snapshot(st, team, T0 + 100);
  assert.equal(char(s, 'type:Explore').name, 'Scout');
  assert.equal(char(s, 'agent:a2').name, 'Scout #1');
  assert.equal(char(s, 'agent:a3').name, 'Agent #1');
});

test('rahasia dimasking sebelum disimpan', () => {
  const e = normalize(
    { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'pakai token=abc123 dan sk-ant-api03-ZZZZdummyKEYforTEST0000' },
    T0,
  );
  assert.ok(!e.prompt.includes('abc123'));
  assert.ok(!e.prompt.includes('sk-ant'));
});

test('lampu mati tanpa sesi aktif; sesi lama dianggap offline', () => {
  const st = createState();
  assert.equal(snapshot(st, team, T0).lightsOn, false);
  feed(st, [[0, { hook_event_name: 'SessionStart' }]]);
  assert.equal(snapshot(st, team, T0 + 1000).lightsOn, true);
  assert.equal(snapshot(st, team, T0 + 60 * 60_000).lightsOn, false);
  feed(st, [[2000, { hook_event_name: 'SessionEnd', reason: 'exit' }]]);
  assert.equal(snapshot(st, team, T0 + 3000).lightsOn, false);
});

test('Lead berpindah ruangan sesuai tool, kembali ke Command saat prompt baru/selesai', () => {
  const st = createState();
  feed(st, [
    [0, { hook_event_name: 'UserPromptSubmit', prompt: 'x' }],
    [100, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/a/app.tsx' } }],
  ]);
  assert.equal(char(snapshot(st, team, T0 + 200), 'lead').room, 'workspace');
  feed(st, [[5000, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run build' } }]]);
  assert.equal(char(snapshot(st, team, T0 + 5100), 'lead').room, 'server');
  // Tool administratif tidak memindahkan.
  feed(st, [[9500, { hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_input: {} }]]);
  assert.equal(char(snapshot(st, team, T0 + 9600), 'lead').room, 'server');
  feed(st, [[10000, { hook_event_name: 'Stop' }]]);
  assert.equal(char(snapshot(st, team, T0 + 10100), 'lead').room, 'command');
});

test('AskUserQuestion membawa Lead ke Approval dengan badge "?"', () => {
  const st = createState();
  feed(st, [
    [0, { hook_event_name: 'UserPromptSubmit', prompt: 'x' }],
    [100, { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: {} }],
  ]);
  const c = char(snapshot(st, team, T0 + 200), 'lead');
  assert.equal(c.room, 'approval');
  assert.equal(c.badge, '?');
  assert.equal(c.waiting, 'question');
});

test('statistik harian, ringkasan Stop, riwayat & berkas per karakter', () => {
  const st = createState();
  feed(st, [
    [0, { hook_event_name: 'UserPromptSubmit', prompt: 'x' }],
    [100, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/a/app.tsx' } }],
    [200, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a/b.ts' } }],
    [65_000, { hook_event_name: 'Stop' }],
  ]);
  const s = snapshot(st, team, T0 + 66_000);
  assert.deepEqual([s.stats.prompts, s.stats.tools, s.stats.files], [1, 2, 1]);
  assert.equal(s.stats.activeMs, 65_000);
  assert.equal(s.stats.projects[0].name, 'proj');
  assert.match(s.ticker[0].text, /selesai menjawab \(proj\) · 2 tool · 1 berkas diubah · 1 mnt/);
  const lead = char(s, 'lead');
  assert.deepEqual(lead.files, ['app.tsx']);
  assert.match(lead.recent[1].text, /membaca b\.ts/);
});

test('aturan ruangan per tool dari pengaturan (termasuk "tetap di tempat")', () => {
  const st = createState();
  const custom = { ...team, rules: { read: 'workspace', edit: 'workspace', bash: 'workspace', web: 'stay', mcp: 'meeting', other: 'workspace' } };
  const go = (ms, p) => applyEvent(st, normalize({ session_id: 's1', cwd: '/x/proj', ...p }, T0 + ms), custom);
  go(0, { hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  go(100, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(char(snapshot(st, custom, T0 + 200), 'lead').room, 'workspace');
  go(5000, { hook_event_name: 'PreToolUse', tool_name: 'WebSearch', tool_input: { query: 'q' } });
  assert.equal(char(snapshot(st, custom, T0 + 5100), 'lead').room, 'workspace');
  go(10000, { hook_event_name: 'PreToolUse', tool_name: 'mcp__figma__x', tool_input: {} });
  assert.equal(char(snapshot(st, custom, T0 + 10100), 'lead').room, 'meeting');
});

test('status menunggu yang basi (>10 mnt tanpa event) tidak menahan karakter di Approval', () => {
  const st = createState();
  feed(st, [
    [0, { hook_event_name: 'UserPromptSubmit', prompt: '<agent-message from="x">halo</agent-message>' }],
    [100, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }],
  ]);
  assert.equal(char(snapshot(st, team, T0 + 1000), 'lead').room, 'approval');
  assert.notEqual(char(snapshot(st, team, T0 + 11 * 60_000), 'lead').room, 'approval');
  assert.equal(snapshot(st, team, T0 + 1000).sessions[0].prompt, 'halo');
  assert.equal(snapshot(st, team, T0 + 1000).notices[0].kind, 'permission');
});

test('mode berurutan: subagent ke-1/2/3 = slot, luapan = kembaran, slot dilepas saat selesai', () => {
  const spec = (name) => ({ name, role: 'Sub', sprite: name.toLowerCase(), colour: '#fff' });
  const t = { ...team, slots: [spec('Volt'), spec('Ember'), spec('Ripple')] };
  const st = createState();
  const go = (ms, p) => applyEvent(st, normalize({ session_id: 's1', cwd: '/x/proj', ...p }, T0 + ms), t);
  go(0, { hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  ['a1', 'a2', 'a3', 'a4'].forEach((id, i) => go(10 + i, { hook_event_name: 'SubagentStart', agent_id: id, agent_type: i % 2 ? 'Explore' : 'Plan' }));
  let s = snapshot(st, t, T0 + 100);
  assert.deepEqual(['slot:0', 'slot:1', 'slot:2'].map((k) => char(s, k).name), ['Volt', 'Ember', 'Ripple']);
  assert.equal(char(s, 'agent:a4').name, 'Ripple #1');
  assert.equal(char(s, 'type:Explore').status, 'resting'); // staf manusia tetap istirahat
  go(200, { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'Plan', say: 'ok' });
  go(300, { hook_event_name: 'SubagentStart', agent_id: 'a5', agent_type: 'Plan' });
  s = snapshot(st, t, T0 + 400);
  assert.equal(char(s, 'slot:0').status, 'working'); // a5 mengambil slot 1 yang dilepas a1
  assert.equal(char(s, 'agent:a1').status, 'completed');
});

test('kitOf: skill dan server MCP untuk papan nama', async () => {
  const { kitOf } = await import('../lib/state.mjs');
  assert.deepEqual(kitOf({ tool: 'Skill', detail: 'figma:figma-use', ts: 1 }), { kind: 'skill', name: 'figma:figma-use', ts: 1 });
  assert.equal(kitOf({ tool: 'mcp__claude_ai_Figma__get_screenshot', ts: 1 }).name, 'Figma');
  assert.equal(kitOf({ tool: 'mcp__plugin_figma_figma__x', ts: 1 }).name, 'figma');
  assert.equal(kitOf({ tool: 'mcp__laravel-boost__database-query', ts: 1 }).name, 'laravel-boost');
  assert.equal(kitOf({ tool: 'Read', ts: 1 }), null);
});

test('tool gagal: tanda ⚠, notifikasi, statistik; dibatalkan tidak dihitung', () => {
  const st = createState();
  const t0 = 1_800_000_000_000;
  applyEvent(st, normalize({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/x/app', prompt: 'build' }, t0), team);
  applyEvent(st, normalize({ hook_event_name: 'PostToolUseFailure', session_id: 's1', cwd: '/x/app', tool_name: 'Bash', tool_input: { command: 'npm run build', description: 'Build' }, error: 'exit 1' }, t0 + 1000), team);
  applyEvent(st, normalize({ hook_event_name: 'PostToolUseFailure', session_id: 's1', cwd: '/x/app', tool_name: 'Bash', tool_input: {}, is_interrupt: true }, t0 + 2000), team);
  const snap = snapshot(st, team, t0 + 3000);
  const lead = snap.chars.find((c) => c.sid === 's1');
  assert.equal(lead.fail.tool, 'Bash');
  assert.equal(lead.fail.text, 'exit 1');
  assert.equal(snap.stats.fails, 1);
  assert.equal(snap.notices[0].kind, 'fail');
  assert.equal(snapshot(st, team, t0 + 60_000).chars.find((c) => c.sid === 's1').fail, null);
});
