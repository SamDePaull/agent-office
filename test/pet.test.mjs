import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPet, gearOf, levelOf, petOnEvent, petView, xpForLevel } from '../lib/pet.mjs';

test('level & aksesori', () => {
  assert.equal(levelOf(0), 1);
  assert.equal(levelOf(49), 1);
  assert.equal(levelOf(50), 2);
  assert.equal(levelOf(xpForLevel(10)), 10);
  assert.deepEqual(gearOf(4), { scarf: false, crown: false, aura: false });
  assert.deepEqual(gearOf(10), { scarf: true, crown: true, aura: false });
});

test('XP: tool +1, skill pertama +25 (sekali), selesai +10, subagent +5', () => {
  const p = createPet({}, ['skill:lama']);
  petOnEvent(p, { ev: 'PreToolUse', tool: 'Read', ts: 1 });
  petOnEvent(p, { ev: 'PreToolUse', tool: 'Skill', detail: 'tdd', ts: 2 });
  petOnEvent(p, { ev: 'PreToolUse', tool: 'Skill', detail: 'tdd', ts: 3 });
  petOnEvent(p, { ev: 'PreToolUse', tool: 'Skill', detail: 'lama', ts: 4 });
  petOnEvent(p, { ev: 'Stop', ts: 5 });
  petOnEvent(p, { ev: 'SubagentStop', ts: 6 });
  assert.equal(p.xp, 1 + 26 + 1 + 1 + 10 + 5);
});

test('mood: panik > sedih > senang > kerja > tidur', () => {
  const p = createPet();
  const now = 1_000_000;
  assert.equal(petView(p, { chars: [], sessions: [] }, now).mood, 'sleep');
  const work = { key: 'lead', name: 'Meong', status: 'working', heartbeat: now };
  assert.equal(petView(p, { chars: [work], sessions: [{}] }, now).follow, 'lead');
  p.lastDone = now - 1000;
  assert.equal(petView(p, { chars: [work], sessions: [{}] }, now).mood, 'happy');
  const failed = { ...work, fail: { tool: 'Bash', ts: now - 500 } };
  assert.equal(petView(p, { chars: [failed], sessions: [{}] }, now).mood, 'sad');
  const wait = { key: 'a', name: 'X', status: 'waiting', waiting: 'permission' };
  assert.equal(petView(p, { chars: [failed, wait], sessions: [{}] }, now).mood, 'panic');
});
