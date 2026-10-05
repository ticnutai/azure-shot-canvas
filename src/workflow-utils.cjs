const TRIGGERS = new Set(['screenshot', 'recording']);
const ACTIONS = new Set(['copy', 'ocr', 'client-copy', 'open-editor', 'share', 'open-folder']);

function normalizeWorkflow(candidate = {}, index = 0) {
  const actions = [];
  for (const action of Array.isArray(candidate.actions) ? candidate.actions : []) if (ACTIONS.has(action) && !actions.includes(action)) actions.push(action);
  return {
    id: String(candidate.id || `workflow-${Date.now()}-${index}`).slice(0, 100),
    name: String(candidate.name || `אוטומציה ${index + 1}`).trim().slice(0, 60),
    enabled: candidate.enabled !== false,
    trigger: TRIGGERS.has(candidate.trigger) ? candidate.trigger : 'screenshot',
    client: String(candidate.client || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 60),
    actions
  };
}

function normalizeWorkflows(candidate) {
  return (Array.isArray(candidate) ? candidate : []).slice(0, 30).map(normalizeWorkflow).filter((workflow) => workflow.name && workflow.actions.length);
}

function matchingWorkflows(workflows, trigger) {
  return normalizeWorkflows(workflows).filter((workflow) => workflow.enabled && workflow.trigger === trigger);
}

module.exports = { ACTIONS, TRIGGERS, matchingWorkflows, normalizeWorkflow, normalizeWorkflows };
