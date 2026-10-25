// Records a new key combination for one action: the keys pressed show at once, with a warning when they are taken by
// another action, kept by Windows, or used by many programs; Enter saves, Escape cancels. The catalog, the reading of
// the keys and the labels are the shared ones (shortcut-utils), the same the settings page uses.
(() => {
  const api = window.shortcutEditorApi;
  const shortcuts = window.AurumShortcuts;
  const $ = (selector) => document.querySelector(selector);
  let info = null;
  let chosen = undefined;

  const show = (binding) => {
    $('#keys').textContent = binding ? shortcuts.bindingLabel(binding) : 'ממתין למקשים…';
    $('#keys').classList.toggle('ready', Boolean(binding));
  };
  const note = (text, kind = '') => { $('#note').textContent = text; $('#note').className = `note ${kind}`; };

  async function consider(binding) {
    chosen = binding;
    show(binding);
    const verdict = await api.check(binding);
    $('#save').disabled = !verdict.ok;
    if (verdict.takenBy) note(`הצירוף כבר משמש את "${verdict.takenBy}" — בחרו צירוף אחר`, 'bad');
    else if (verdict.reserved) note(`הצירוף שמור ל${verdict.reserved} — בחרו צירוף אחר`, 'bad');
    else if (verdict.common) note(`שימו לב: ${verdict.common}. הקיצור של האולפן יקבל עדיפות`, 'warn');
    else if (verdict.focusedOnly) note('מקש בודד של אות או ספרה פועל רק כשהאולפן פתוח מולכם', 'warn');
    else note('אנטר לשמירה · אסקייפ לביטול');
  }

  // A key with its held modifiers; the modifier keys alone wait for the rest of the combination. Print Screen arrives
  // only when it is let go, so it is read on key up.
  function read(event) {
    if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(event.code)) return;
    if (event.type === 'keyup' && event.code !== 'PrintScreen') return;
    event.preventDefault();
    if (event.type === 'keydown' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (event.key === 'Escape') return api.close();
      if (event.key === 'Enter' && chosen !== undefined && !$('#save').disabled) return save(chosen);
    }
    const modifiers = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
    const binding = shortcuts.bindingFromInput({ type: 'keyDown', code: event.code, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey }, { kind: modifiers ? 'chord' : 'single' });
    if (!binding) return note('המקש הזה לא יכול לשמש קיצור', 'bad');
    consider(binding);
  }
  window.addEventListener('keydown', read);
  window.addEventListener('keyup', read);

  async function save(binding) {
    const result = await api.save(binding);
    if (result.ok) return api.close();
    note(result.message || 'השמירה נכשלה', 'bad');
  }
  $('#save').addEventListener('click', () => save(chosen));
  $('#none').addEventListener('click', () => save(null));
  $('#default').addEventListener('click', () => save('default'));
  $('#cancel').addEventListener('click', () => api.close());

  api.info().then((value) => {
    info = value;
    $('#action-label').textContent = info.label;
    $('#current').textContent = info.current ? shortcuts.bindingLabel(info.current) : 'ללא קיצור';
    document.documentElement.dataset.ready = 'true';
  });
})();
