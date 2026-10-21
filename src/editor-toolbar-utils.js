// The image editor's tool bar, as data: which tools exist, how they group, and the user's view choices.
// Pure functions (no page access), shared by the editor page and the unit tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AurumEditorToolbar = api;
})(typeof self !== 'undefined' ? self : this, () => {
  // Every tool appears here exactly once; a group is a set of tools that do nearly the same job.
  const GROUPS = [
    { id: 'select', label: 'בחירה', tools: ['select'] },
    { id: 'lines', label: 'קווים, חיצים ומדידה', tools: ['arrow', 'double-arrow', 'line', 'measure'] },
    { id: 'shapes', label: 'צורות', tools: ['rect', 'ellipse', 'polygon'] },
    { id: 'draw', label: 'ציור חופשי', tools: ['pen', 'highlighter'] },
    { id: 'text', label: 'טקסט ומספור', tools: ['text', 'callout', 'counter'] },
    { id: 'hide', label: 'הסתרת מידע', tools: ['redact', 'smart-redact', 'blur', 'pixelate'] },
    { id: 'focus', label: 'הדגשה', tools: ['spotlight', 'magnify'] },
    { id: 'image', label: 'חיתוך ותמונה', tools: ['crop', 'image'] }
  ];
  const TOOLS = GROUPS.flatMap((group) => group.tools);
  const GROUP_OF = Object.fromEntries(GROUPS.flatMap((group) => group.tools.map((tool) => [tool, group.id])));
  // The selection tool can never be hidden: without it nothing on the picture can be moved or changed.
  const ALWAYS_SHOWN = new Set(['select']);

  const CHOICES = {
    position: ['left', 'right', 'top', 'bottom'],
    columns: [1, 2],
    iconStyle: ['line', 'duotone', 'tiles', 'solid'],
    iconColor: ['muted', 'accent', 'groups', 'custom'],
    size: ['small', 'medium', 'large']
  };

  const DEFAULTS = Object.freeze({
    position: 'left',
    columns: 2,
    grouped: true,
    labels: true,
    iconStyle: 'line',
    iconColor: 'muted',
    customColor: '#2f7de1',
    size: 'medium',
    propertiesPanel: true,
    order: TOOLS,
    hidden: [],
    current: {}
  });

  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

  // Any stored value becomes a valid set of choices: unknown tools dropped, each tool once in the order,
  // tools added in a later version appended in their default place.
  function normalize(stored) {
    const input = stored && typeof stored === 'object' ? stored : {};
    const seen = new Set();
    const order = [];
    for (const tool of Array.isArray(input.order) ? input.order : []) {
      if (TOOLS.includes(tool) && !seen.has(tool)) { seen.add(tool); order.push(tool); }
    }
    for (const tool of TOOLS) {
      if (seen.has(tool)) continue;
      // Missing tool: right after the closest earlier default neighbour that is already placed.
      const defaultIndex = TOOLS.indexOf(tool);
      let insertAt = 0;
      for (let index = defaultIndex - 1; index >= 0; index -= 1) {
        const at = order.indexOf(TOOLS[index]);
        if (at !== -1) { insertAt = at + 1; break; }
      }
      order.splice(insertAt, 0, tool);
      seen.add(tool);
    }
    const hidden = [...new Set((Array.isArray(input.hidden) ? input.hidden : []).filter((tool) => TOOLS.includes(tool) && !ALWAYS_SHOWN.has(tool)))];
    const current = {};
    for (const group of GROUPS) {
      const chosen = input.current?.[group.id];
      if (group.tools.includes(chosen)) current[group.id] = chosen;
    }
    const color = typeof input.customColor === 'string' && /^#[0-9a-f]{6}$/i.test(input.customColor) ? input.customColor.toLowerCase() : DEFAULTS.customColor;
    return {
      position: pick(input.position, CHOICES.position, DEFAULTS.position),
      columns: pick(Number(input.columns), CHOICES.columns, DEFAULTS.columns),
      grouped: typeof input.grouped === 'boolean' ? input.grouped : DEFAULTS.grouped,
      labels: typeof input.labels === 'boolean' ? input.labels : DEFAULTS.labels,
      iconStyle: pick(input.iconStyle, CHOICES.iconStyle, DEFAULTS.iconStyle),
      iconColor: pick(input.iconColor, CHOICES.iconColor, DEFAULTS.iconColor),
      customColor: color,
      size: pick(input.size, CHOICES.size, DEFAULTS.size),
      propertiesPanel: typeof input.propertiesPanel === 'boolean' ? input.propertiesPanel : DEFAULTS.propertiesPanel,
      order,
      hidden,
      current
    };
  }

  // What the bar shows, in order. `available` = tools usable right now (the quick mode hides advanced tools;
  // smart blackout needs the text reader). Grouped: one slot per group, at the place of its first tool.
  function slots(preferences, available = new Set(TOOLS)) {
    const prefs = normalize(preferences);
    const visible = prefs.order.filter((tool) => available.has(tool) && !prefs.hidden.includes(tool));
    if (!prefs.grouped) return visible.map((tool) => ({ kind: 'tool', tool }));
    const result = [];
    const placed = new Set();
    for (const tool of visible) {
      const groupId = GROUP_OF[tool];
      if (placed.has(groupId)) continue;
      placed.add(groupId);
      const members = visible.filter((candidate) => GROUP_OF[candidate] === groupId);
      const current = members.includes(prefs.current[groupId]) ? prefs.current[groupId] : members[0];
      result.push(members.length === 1 ? { kind: 'tool', tool: members[0] } : { kind: 'group', group: groupId, members, current });
    }
    return result;
  }

  // Moves one tool a step up or down in the order (the settings list's arrows).
  function move(preferences, tool, step) {
    const prefs = normalize(preferences);
    const from = prefs.order.indexOf(tool);
    const to = from + step;
    if (from === -1 || to < 0 || to >= prefs.order.length) return prefs;
    const order = [...prefs.order];
    order.splice(from, 1);
    order.splice(to, 0, tool);
    return { ...prefs, order };
  }

  // Dragging in the settings list: `tool` lands just before `before` (or last when `before` is null).
  function place(preferences, tool, before) {
    const prefs = normalize(preferences);
    if (!prefs.order.includes(tool) || tool === before) return prefs;
    const order = prefs.order.filter((item) => item !== tool);
    const at = before ? order.indexOf(before) : -1;
    order.splice(at === -1 ? order.length : at, 0, tool);
    return { ...prefs, order };
  }

  return { GROUPS, TOOLS, GROUP_OF, ALWAYS_SHOWN, CHOICES, DEFAULTS, normalize, slots, move, place };
});
