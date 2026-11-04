// The keys of the marking tools on the frozen screen. They work only while that screen is open, so a single key is
// enough and no other program is disturbed. Keys are physical places, the same in Hebrew and English keyboard layouts.
(function (root) {
  const TOOLS = Object.freeze([
    { tool: 'move', label: 'הזזה', title: 'בחירה, הזזה ושינוי גודל', key: 'KeyV' },
    { tool: 'arrow', label: 'חץ', title: 'חץ', key: 'KeyA' },
    { tool: 'rect', label: 'מלבן', title: 'מלבן', key: 'KeyR' },
    { tool: 'pen', label: 'עט', title: 'עט', key: 'KeyP' },
    { tool: 'text', label: 'טקסט', title: 'טקסט', key: 'KeyT' },
    { tool: 'blur', label: 'טשטוש', title: 'טשטוש מידע', key: 'KeyB' },
    { tool: 'number', label: 'מספור', title: 'מספור שלבים', key: 'KeyN' }
  ]);
  const USABLE = /^(?:Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2])$/;
  const defaults = () => Object.fromEntries(TOOLS.map(({ tool, key }) => [tool, key]));
  const labelOf = (tool) => TOOLS.find((item) => item.tool === tool)?.label || '';
  const keyLabel = (code) => (code ? code.replace(/^Key|^Digit/, '') : '');
  const toolForKey = (keys, code) => Object.keys(keys).find((tool) => keys[tool] === code) || null;

  // A saved map, trusted only as far as it is sound: a tool keeps a usable key of its own, or an empty one by choice;
  // anything else takes the default, and a key two tools claim stays with the first.
  function normalize(saved) {
    const given = saved && typeof saved === 'object' ? saved : {};
    const keys = {};
    for (const { tool, key } of TOOLS) {
      const wanted = Object.hasOwn(given, tool) && (given[tool] === '' || USABLE.test(given[tool])) ? given[tool] : key;
      keys[tool] = wanted && toolForKey(keys, wanted) ? '' : wanted;
    }
    return keys;
  }
  // Whether a key can go to a tool, and in Hebrew why not.
  function check(keys, tool, code) {
    if (!USABLE.test(code)) return { ok: false, message: 'אפשר לבחור אות, ספרה או מקש פונקציה' };
    const owner = toolForKey(keys, code);
    if (owner && owner !== tool) return { ok: false, message: `המקש ${keyLabel(code)} כבר משמש את "${labelOf(owner)}"` };
    return { ok: true, message: '' };
  }

  const api = { TOOLS, check, defaults, keyLabel, labelOf, normalize, toolForKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AurumToolKeys = api;
})(typeof window !== 'undefined' ? window : globalThis);
