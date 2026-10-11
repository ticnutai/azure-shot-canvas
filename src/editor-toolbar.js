// The image editor's tool bar on screen: where it sits (each side, upright or across), which tools show and in what
// order, similar tools folded into one button, icon look and colour — and the editor filling the free screen
// next to the studio's own menu, whatever the layout. The rules live in editor-toolbar-utils.js.
(() => {
  const shell = document.querySelector('#image-editor-shell');
  const logic = window.AurumEditorToolbar;
  if (!shell || !logic) return;
  const nav = shell.querySelector('.editor-tools');
  const STORAGE_KEY = 'aurum-editor-toolbar';
  const store = {
    read() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } },
    write(value) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {} }
  };
  let prefs = logic.normalize(store.read());

  // ---- The tool buttons (made once in the page; only moved around, never copied) ----------------------------
  const buttons = new Map();
  for (const button of nav.querySelectorAll('[data-editor-tool], [data-toolbar-item]')) {
    const id = button.dataset.editorTool || button.dataset.toolbarItem;
    button.dataset.toolGroup = logic.GROUP_OF[id];
    buttons.set(id, button);
  }
  const labelOf = (id) => buttons.get(id)?.querySelector('small')?.textContent.trim() || id;
  const holder = document.createElement('div');
  holder.className = 'editor-tool-holder';
  holder.hidden = true;

  // Tools that can be used right now: the quick mode leaves out the advanced ones; smart blackout needs the reader.
  const available = () => new Set(logic.TOOLS.filter((id) => {
    const button = buttons.get(id);
    if (!button || button.classList.contains('hidden')) return false;
    return !(shell.dataset.editorMode === 'quick' && button.hasAttribute('data-editor-advanced'));
  }));

  function closeFlyouts(except = null) {
    nav.querySelectorAll('.tool-group.open').forEach((group) => { if (group !== except) group.classList.remove('open'); });
  }

  function render() {
    closeFlyouts();
    const slots = logic.slots(prefs, available());
    const placed = new Set();
    const items = slots.map((slot) => {
      if (slot.kind === 'tool') { placed.add(slot.tool); return buttons.get(slot.tool); }
      const group = logic.GROUPS.find((item) => item.id === slot.group);
      const wrapper = document.createElement('div');
      wrapper.className = 'tool-group';
      wrapper.dataset.group = slot.group;
      wrapper.dataset.toolGroup = slot.group;
      const members = document.createElement('div');
      members.className = 'group-members';
      members.setAttribute('role', 'group');
      members.setAttribute('aria-label', group.label);
      for (const id of slot.members) {
        const button = buttons.get(id);
        button.classList.toggle('group-current', id === slot.current);
        members.append(button);
        placed.add(id);
      }
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'group-more';
      more.title = `עוד ב${group.label}: ${slot.members.map(labelOf).join(', ')}`;
      more.setAttribute('aria-label', more.title);
      more.setAttribute('aria-expanded', 'false');
      wrapper.append(members, more);
      return wrapper;
    });
    for (const [id, button] of buttons) {
      if (!placed.has(id)) { button.classList.remove('group-current'); holder.append(button); }
    }
    if (!prefs.grouped) buttons.forEach((button) => button.classList.remove('group-current'));
    nav.replaceChildren(...items, holder);
    applyLook();
    shell.dataset.toolbarSlots = String(slots.length);
  }

  function applyLook() {
    shell.dataset.toolsPosition = prefs.position;
    shell.dataset.toolsColumns = String(prefs.columns);
    shell.dataset.toolsGrouped = String(prefs.grouped);
    shell.dataset.toolLabels = String(prefs.labels);
    shell.dataset.iconStyle = prefs.iconStyle;
    shell.dataset.iconColor = prefs.iconColor;
    shell.dataset.toolSize = prefs.size;
    shell.dataset.propertiesPanel = String(prefs.propertiesPanel);
    shell.style.setProperty('--tool-custom', prefs.customColor);
    nav.setAttribute('aria-orientation', prefs.position === 'top' || prefs.position === 'bottom' ? 'horizontal' : 'vertical');
  }

  function update(patch, { rerender = true } = {}) {
    prefs = logic.normalize({ ...prefs, ...patch });
    store.write(prefs);
    if (rerender) render(); else applyLook();
    syncPanel();
  }

  // A group opens a small floating row with all its tools; it floats above everything (the bar itself scrolls).
  nav.addEventListener('click', (event) => {
    const more = event.target.closest('.group-more');
    if (!more) return;
    const group = more.closest('.tool-group');
    const opening = !group.classList.contains('open');
    closeFlyouts(group);
    group.classList.toggle('open', opening);
    more.setAttribute('aria-expanded', String(opening));
    if (!opening) return;
    // Opens just outside the bar (never over its other column), level with the group's button.
    const box = group.getBoundingClientRect();
    const bar = nav.getBoundingClientRect();
    const flyout = group.querySelector('.group-members');
    const across = prefs.position === 'top' || prefs.position === 'bottom';
    flyout.style.left = across ? `${box.left}px` : prefs.position === 'left' ? `${bar.right + 6}px` : '';
    flyout.style.right = !across && prefs.position === 'right' ? `${document.documentElement.clientWidth - bar.left + 6}px` : '';
    flyout.style.top = across ? (prefs.position === 'top' ? `${bar.bottom + 6}px` : '') : `${box.top}px`;
    flyout.style.bottom = across && prefs.position === 'bottom' ? `${window.innerHeight - bar.top + 6}px` : '';
  });
  document.addEventListener('pointerdown', (event) => { if (!event.target.closest?.('.tool-group')) closeFlyouts(); }, true);

  // The chosen tool (button, flyout or keyboard key) becomes its group's face.
  shell.addEventListener('aurum:editor-tool', (event) => {
    const tool = event.detail;
    const groupId = logic.GROUP_OF[tool];
    if (!groupId) return;
    if (prefs.grouped && prefs.current[groupId] !== tool && logic.GROUPS.find((group) => group.id === groupId).tools.length > 1) {
      update({ current: { ...prefs.current, [groupId]: tool } });
    } else closeFlyouts();
  });
  // Smart blackout is a one-click action, not a drawing tool: it still counts as the hide group's last choice.
  buttons.get('smart-redact')?.addEventListener('click', () => shell.dispatchEvent(new CustomEvent('aurum:editor-tool', { detail: 'smart-redact' })));
  new MutationObserver(() => render()).observe(shell, { attributes: true, attributeFilter: ['data-editor-mode'] });

  // ---- The editor fills the screen beside the studio menu, wherever the layout puts that menu ---------------
  function place() {
    const menu = document.querySelector('.sidebar');
    const box = menu?.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const inset = { top: 0, right: 0, bottom: 0, left: 0 };
    if (box && box.width > 0 && box.height > 0 && getComputedStyle(menu).visibility !== 'hidden') {
      if (box.height >= box.width) {
        if (box.left + box.width / 2 > width / 2) inset.right = Math.max(0, Math.round(width - box.left));
        else inset.left = Math.max(0, Math.round(box.right));
      } else if (box.top + box.height / 2 < height / 2) inset.top = Math.max(0, Math.round(box.bottom));
      else inset.bottom = Math.max(0, Math.round(height - box.top));
    }
    shell.style.inset = `${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px`;
    shell.dataset.editorInset = `${inset.top},${inset.right},${inset.bottom},${inset.left}`;
  }
  window.addEventListener('resize', place);
  new MutationObserver(place).observe(document.documentElement, { attributes: true, attributeFilter: ['data-layout', 'data-editor-open', 'data-kit'] });
  const menu = document.querySelector('.sidebar');
  if (menu && 'ResizeObserver' in window) new ResizeObserver(place).observe(menu);

  // ---- Focus on the picture: both side panels out of the way (F, or the button; again to bring them back) --
  const focusButton = shell.querySelector('#editor-focus');
  const setFocus = (on) => {
    shell.dataset.focus = String(on);
    focusButton?.setAttribute('aria-pressed', String(on));
    closeFlyouts();
  };
  focusButton?.addEventListener('click', () => setFocus(shell.dataset.focus !== 'true'));
  document.addEventListener('keydown', (event) => {
    if (shell.classList.contains('hidden') || event.ctrlKey || event.altKey || event.metaKey) return;
    if (/input|textarea|select/i.test(event.target.tagName) || event.target.isContentEditable || window.aurumEditor?.isEditingText?.()) return;
    if (event.code === 'KeyF') { event.preventDefault(); setFocus(shell.dataset.focus !== 'true'); }
    if (event.key === 'Escape') { closeFlyouts(); if (!panel.hidden) closePanel(); }
  });

  // ---- The "tool view" window: every choice lives here, once -------------------------------------------------
  const panel = document.createElement('div');
  panel.className = 'editor-view-panel';
  panel.id = 'editor-view-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'תצוגת כלים');
  const segmented = (name, label, options) => `<div class="view-row"><span>${label}</span><div class="view-segmented" data-view-choice="${name}">${options.map(([value, text]) => `<button type="button" data-value="${value}">${text}</button>`).join('')}</div></div>`;
  const toggle = (name, label) => `<label class="view-toggle"><input type="checkbox" data-view-toggle="${name}"><span>${label}</span></label>`;
  panel.innerHTML = `
    <header><b>תצוגת כלים</b><button type="button" class="editor-icon" data-view-close title="סגירה" aria-label="סגירה">✕</button></header>
    <div class="view-body">
      <section>
        <h4>מיקום וכיוון</h4>
        ${segmented('position', 'מיקום הסרגל', [['right', 'ימין'], ['left', 'שמאל'], ['top', 'למעלה'], ['bottom', 'למטה']])}
        <p class="view-hint">בצד — סרגל אנכי · למעלה או למטה — סרגל אופקי</p>
        ${segmented('columns', 'עמודות בסרגל אנכי', [['1', 'אחת'], ['2', 'שתיים']])}
        ${toggle('grouped', 'קיבוץ כלים דומים לכפתור אחד')}
        ${toggle('labels', 'שמות מתחת לסמלים')}
        ${toggle('propertiesPanel', 'לוח עיצוב הכלי בצד')}
      </section>
      <section>
        <h4>סמלים וצבעים</h4>
        ${segmented('iconStyle', 'סגנון', [['line', 'קו'], ['duotone', 'דו־גוני'], ['tiles', 'אריח בהיר'], ['solid', 'אריח מלא']])}
        ${segmented('iconColor', 'צבע', [['muted', 'אפור'], ['accent', 'צבע העיצוב'], ['groups', 'לפי קבוצה'], ['custom', 'צבע שלי']])}
        <label class="view-row view-custom-color"><span>הצבע שלי</span><input type="color" data-view-color></label>
        ${segmented('size', 'גודל', [['small', 'קטן'], ['medium', 'בינוני'], ['large', 'גדול']])}
      </section>
      <section>
        <h4>הכלים והסדר שלהם</h4>
        <p class="view-hint">סימון — מוצג בסרגל · גרירה או חיצים — שינוי הסדר. "בחירה" תמיד מוצג.</p>
        <ol class="view-tools" data-view-tools></ol>
      </section>
    </div>
    <footer><button type="button" class="ghost" data-view-reset>↺ חזרה לברירת המחדל</button></footer>`;
  shell.append(panel);
  const openButton = shell.querySelector('#editor-view-settings');
  function openPanel() { panel.hidden = false; openButton?.setAttribute('aria-expanded', 'true'); syncPanel(); }
  function closePanel() { panel.hidden = true; openButton?.setAttribute('aria-expanded', 'false'); }
  openButton?.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
  panel.querySelector('[data-view-close]').addEventListener('click', closePanel);

  const toolList = panel.querySelector('[data-view-tools]');
  function syncPanel() {
    panel.querySelectorAll('[data-view-choice]').forEach((row) => {
      row.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(String(prefs[row.dataset.viewChoice]) === button.dataset.value)));
    });
    panel.querySelectorAll('[data-view-toggle]').forEach((input) => { input.checked = Boolean(prefs[input.dataset.viewToggle]); });
    panel.querySelector('[data-view-color]').value = prefs.customColor;
    panel.dataset.across = String(prefs.position === 'top' || prefs.position === 'bottom');
    panel.dataset.customColor = String(prefs.iconColor === 'custom');
    if (panel.hidden) return;
    const usable = available();
    toolList.replaceChildren(...prefs.order.map((id, index) => {
      const row = document.createElement('li');
      row.dataset.tool = id;
      row.dataset.toolGroup = logic.GROUP_OF[id];
      row.draggable = true;
      const locked = logic.ALWAYS_SHOWN.has(id);
      const group = logic.GROUPS.find((item) => item.id === logic.GROUP_OF[id]);
      const icon = buttons.get(id)?.querySelector('span')?.cloneNode(true);
      row.innerHTML = `<span class="view-grip" aria-hidden="true"></span><label><input type="checkbox" ${prefs.hidden.includes(id) ? '' : 'checked'} ${locked ? 'disabled' : ''}><i></i><b></b><small></small></label><button type="button" class="view-step" data-step="-1" aria-label="למעלה" ${index === 0 ? 'disabled' : ''}>▲</button><button type="button" class="view-step" data-step="1" aria-label="למטה" ${index === prefs.order.length - 1 ? 'disabled' : ''}>▼</button>`;
      if (icon) row.querySelector('i').replaceWith(icon);
      row.querySelector('b').textContent = labelOf(id);
      // The group name only where it adds something (a one-tool group is named like its tool).
      const groupName = group.tools.length > 1 ? group.label : '';
      row.querySelector('small').textContent = usable.has(id) ? groupName : [groupName, 'רק בעריכה מקצועית'].filter(Boolean).join(' · ');
      return row;
    }));
  }
  panel.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-view-choice] button');
    if (choice) {
      const name = choice.closest('[data-view-choice]').dataset.viewChoice;
      const value = name === 'columns' ? Number(choice.dataset.value) : choice.dataset.value;
      return update({ [name]: value }, { rerender: name === 'position' || name === 'columns' });
    }
    const step = event.target.closest('.view-step');
    if (step) return update(logic.move(prefs, step.closest('li').dataset.tool, Number(step.dataset.step)));
    if (event.target.closest('[data-view-reset]')) {
      prefs = logic.normalize(null);
      store.write(prefs);
      render();
      syncPanel();
    }
  });
  panel.addEventListener('change', (event) => {
    const toggleInput = event.target.closest('[data-view-toggle]');
    if (toggleInput) return update({ [toggleInput.dataset.viewToggle]: toggleInput.checked }, { rerender: toggleInput.dataset.viewToggle === 'grouped' });
    const shown = event.target.closest('.view-tools input[type="checkbox"]');
    if (shown) {
      const id = shown.closest('li').dataset.tool;
      return update({ hidden: shown.checked ? prefs.hidden.filter((tool) => tool !== id) : [...prefs.hidden, id] });
    }
  });
  panel.querySelector('[data-view-color]').addEventListener('input', (event) => update({ customColor: event.target.value, iconColor: 'custom' }, { rerender: false }));
  let dragged = null;
  toolList.addEventListener('dragstart', (event) => { dragged = event.target.closest('li')?.dataset.tool || null; event.dataTransfer.effectAllowed = 'move'; });
  toolList.addEventListener('dragover', (event) => { if (dragged) event.preventDefault(); });
  toolList.addEventListener('drop', (event) => {
    event.preventDefault();
    const target = event.target.closest('li');
    if (!dragged) return;
    const box = target?.getBoundingClientRect();
    const after = box && event.clientY > box.top + box.height / 2;
    const before = target ? (after ? target.nextElementSibling?.dataset.tool || null : target.dataset.tool) : null;
    update(logic.place(prefs, dragged, before));
    dragged = null;
  });

  window.aurumEditorToolbar = {
    place,
    render,
    preferences: () => JSON.parse(JSON.stringify(prefs)),
    set: (patch) => update(patch),
    reset: () => { prefs = logic.normalize(null); store.write(prefs); render(); syncPanel(); },
    open: openPanel,
    close: closePanel
  };
  render();
  place();
})();
