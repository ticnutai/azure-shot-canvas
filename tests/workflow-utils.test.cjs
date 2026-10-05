const test = require('node:test');
const assert = require('node:assert/strict');
const { matchingWorkflows, normalizeWorkflow, normalizeWorkflows } = require('../src/workflow-utils.cjs');

test('workflow removes duplicate and unsafe actions and sanitizes client folder', () => {
  const workflow = normalizeWorkflow({ name: 'לקוח', trigger: 'screenshot', client: 'א/ב:*', actions: ['copy', 'copy', 'unknown', 'ocr'] });
  assert.deepEqual(workflow.actions, ['copy', 'ocr']); assert.equal(workflow.client, 'אב');
});

test('matching workflows returns only enabled rules for the event', () => {
  const rules = normalizeWorkflows([{ name: 'א', trigger: 'screenshot', actions: ['copy'] }, { name: 'ב', trigger: 'recording', actions: ['open-folder'] }, { name: 'ג', enabled: false, actions: ['ocr'] }]);
  assert.equal(matchingWorkflows(rules, 'screenshot').length, 1); assert.equal(matchingWorkflows(rules, 'recording').length, 1);
});
