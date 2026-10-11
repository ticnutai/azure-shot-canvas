const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bar = require('../src/editor-toolbar-utils.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const editorTools = [...html.matchAll(/data-editor-tool="([^"]+)"/g)].map((match) => match[1]);

test('1 · every tool belongs to exactly one group, with no tool listed twice', () => {
  assert.equal(new Set(bar.TOOLS).size, bar.TOOLS.length);
  for (const tool of bar.TOOLS) assert.equal(bar.GROUPS.filter((group) => group.tools.includes(tool)).length, 1, tool);
  assert.equal(new Set(bar.GROUPS.map((group) => group.id)).size, bar.GROUPS.length);
  assert.equal(new Set(bar.GROUPS.map((group) => group.label)).size, bar.GROUPS.length);
});

test('2 · the list matches the editor page exactly: no missing tool, no extra tool, no duplicate button', () => {
  assert.equal(new Set(editorTools).size, editorTools.length, 'a tool button appears twice in the page');
  assert.deepEqual([...editorTools, 'smart-redact'].sort(), [...bar.TOOLS].sort());
  assert.equal((html.match(/data-toolbar-item="smart-redact"/g) || []).length, 1);
});

test('3 · stored order with duplicates and unknown tools is repaired: each tool once, new tools in place', () => {
  const prefs = bar.normalize({ order: ['pen', 'pen', 'unknown', 'select', 'arrow', 'select'], hidden: ['select', 'blur', 'blur', 'nothing'] });
  assert.equal(prefs.order.length, bar.TOOLS.length);
  assert.equal(new Set(prefs.order).size, bar.TOOLS.length);
  // The stored tools keep their order; each missing tool goes back next to its default neighbour.
  assert.deepEqual(prefs.order.filter((tool) => ['pen', 'select', 'arrow'].includes(tool)), ['pen', 'select', 'arrow']);
  assert.equal(prefs.order.indexOf('highlighter'), prefs.order.indexOf('pen') + 1);
  assert.equal(prefs.order.indexOf('double-arrow'), prefs.order.indexOf('arrow') + 1);
  assert.deepEqual(prefs.hidden, ['blur'], 'the selection tool can never be hidden, and nothing hidden twice');
});

test('4 · bad stored values fall back to the defaults', () => {
  const prefs = bar.normalize({ position: 'middle', columns: 7, iconStyle: 'neon', iconColor: 'rainbow', customColor: 'red', size: 'huge', grouped: 'yes', labels: 1 });
  assert.equal(prefs.position, 'left');
  assert.equal(prefs.columns, 2);
  assert.equal(prefs.iconStyle, 'line');
  assert.equal(prefs.iconColor, 'muted');
  assert.equal(prefs.customColor, bar.DEFAULTS.customColor);
  assert.equal(prefs.size, 'medium');
  assert.equal(prefs.grouped, true);
  assert.equal(prefs.labels, true);
  assert.deepEqual(bar.normalize(null).order, bar.TOOLS);
});

test('5 · grouped: one slot per group, each tool shown in one place only', () => {
  const slots = bar.slots({ grouped: true });
  assert.equal(slots.length, bar.GROUPS.length);
  const shown = slots.flatMap((slot) => (slot.kind === 'group' ? slot.members : [slot.tool]));
  assert.equal(new Set(shown).size, shown.length);
  assert.deepEqual([...shown].sort(), [...bar.TOOLS].sort());
  const hide = slots.find((slot) => slot.group === 'hide');
  assert.equal(hide.current, 'redact');
});

test('6 · separate: every visible tool once, hidden tools left out, unavailable tools left out', () => {
  const slots = bar.slots({ grouped: false, hidden: ['pen', 'blur'] }, new Set(bar.TOOLS.filter((tool) => tool !== 'crop')));
  const tools = slots.map((slot) => slot.tool);
  assert.equal(new Set(tools).size, tools.length);
  assert.ok(!tools.includes('pen') && !tools.includes('blur') && !tools.includes('crop'));
  assert.equal(tools.length, bar.TOOLS.length - 3);
});

test('7 · a group keeps the last chosen tool on its button, and falls back when that tool is hidden', () => {
  let slots = bar.slots({ current: { shapes: 'ellipse' } });
  assert.equal(slots.find((slot) => slot.group === 'shapes').current, 'ellipse');
  slots = bar.slots({ current: { shapes: 'ellipse' }, hidden: ['ellipse'] });
  assert.equal(slots.find((slot) => slot.group === 'shapes').current, 'rect');
  // A group left with one visible tool becomes a plain button.
  slots = bar.slots({ hidden: ['spotlight'] });
  assert.ok(slots.some((slot) => slot.kind === 'tool' && slot.tool === 'magnify'));
});

test('8 · moving and dragging keep every tool exactly once', () => {
  let prefs = bar.move({}, 'pen', -1);
  assert.equal(prefs.order.indexOf('pen'), bar.TOOLS.indexOf('pen') - 1);
  prefs = bar.move(prefs, 'select', -1);
  assert.equal(prefs.order[0], 'select', 'cannot move past the start');
  prefs = bar.place(prefs, 'image', 'select');
  assert.equal(prefs.order[0], 'image');
  prefs = bar.place(prefs, 'select', null);
  assert.equal(prefs.order.at(-1), 'select');
  assert.equal(new Set(prefs.order).size, bar.TOOLS.length);
  assert.equal(prefs.order.length, bar.TOOLS.length);
});
