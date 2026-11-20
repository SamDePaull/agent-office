import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCatalog, createUsage, frontmatter, projectOf } from '../lib/catalog.mjs';
import { hitsFromLine, usageFromHistory } from '../lib/history.mjs';

test('frontmatter: nilai biasa, berkutip, dan blok >', () => {
  const fm = frontmatter('---\nname: tdd\ndescription: >\n  Baris satu\n  baris dua.\nother: "x: y"\n---\n# isi');
  assert.equal(fm.name, 'tdd');
  assert.equal(fm.description, 'Baris satu baris dua.');
  assert.equal(fm.other, 'x: y');
  assert.deepEqual(frontmatter('tanpa frontmatter'), {});
});

test('hitsFromLine: Skill, Agent, MCP, dan slash command', () => {
  const ts = '2026-11-18T10:00:00.000Z';
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    cwd: '/Users/x/Developer/app',
    message: {
      content: [
        { type: 'tool_use', name: 'Skill', input: { skill: 'figma:figma-use' } },
        { type: 'tool_use', name: 'Agent', input: { subagent_type: 'Explore' } },
        { type: 'tool_use', name: 'mcp__claude_ai_Figma__get_screenshot', input: {} },
        { type: 'tool_use', name: 'Read', input: {} },
      ],
    },
  });
  const hits = hitsFromLine(line);
  assert.deepEqual(
    hits.map((h) => h.slice(0, 3)),
    [
      ['skill', 'figma:figma-use', ''],
      ['agent', 'Explore', ''],
      ['mcp', 'claude_ai_Figma', 'get_screenshot'],
    ],
  );
  const cmd = JSON.stringify({ type: 'user', timestamp: ts, cwd: '/a', message: { content: '<command-name>/tdd</command-name>' } });
  assert.deepEqual(hitsFromLine(cmd)[0].slice(0, 2), ['cmd', 'tdd']);
  assert.deepEqual(hitsFromLine('{"type":"user","message":{"content":"halo"}}'), []);
});

test('pemakaian skill proyek hanya dihitung di proyeknya; konektor claude.ai terdeteksi', () => {
  const history = {
    files: {
      a: {
        agg: {
          'skill|tdd||/Users/x/Developer/app/resources/js': [3, 100],
          'skill|tdd||/Users/x/Developer/lain': [5, 200],
          'cmd|tdd||/Users/x/Developer/app': [1, 300],
          'mcp|claude_ai_Figma|get_screenshot|/Users/x/Developer/app': [7, 400],
        },
      },
    },
  };
  const u = usageFromHistory(history, createUsage());
  const items = [
    { kind: 'skill', name: 'tdd', key: 'tdd', scope: 'project', scopeLabel: 'app', project: '/Users/x/Developer/app', id: 's', installedAt: 0 },
  ];
  const cat = buildCatalog(items, u, { s: { fav: true } }, {});
  const tdd = cat.find((i) => i.id === 's');
  assert.equal(tdd.usage.count, 4); // 3 (Skill) + 1 (slash), bukan yang dari proyek lain
  assert.equal(tdd.usage.last, 300);
  assert.equal(tdd.note.fav, true);
  const figma = cat.find((i) => i.kind === 'mcp');
  assert.equal(figma.scope, 'claudeai');
  assert.equal(figma.usage.tools[0].name, 'get_screenshot');
});

test('projectOf: subfolder dan worktree ikut proyek induk', () => {
  assert.equal(projectOf('/Users/x/Developer/my-app/resources/js'), 'my-app');
  assert.equal(projectOf('/Users/x/Developer/my-app/.claude/worktrees/wf_1'), 'my-app');
  assert.equal(projectOf('/Users/x/side-project'), 'side-project');
});
