// The "extras" tab of the settings: one card per extra (a switch, its few settings, its button), built from the one
// table in features-defs.js — and the backup of all settings. Every extra starts off.
(() => {
  const api = window.screenStudio;
  const defs = window.aurumFeaturesDefs;
  const root = document.querySelector('#features-list');
  if (!api || !defs || !root) return;
  const say = (text, duration) => (typeof showToast === 'function' ? showToast(text, duration) : undefined);
  let current = defs.defaults();

  const fieldId = (feature, field) => `feature-${feature.id}-${field.key}`;

  function fieldControl(feature, field) {
    let control;
    if (field.type === 'select') {
      control = document.createElement('select');
      for (const [value, label] of field.options) control.append(new Option(label, value));
    } else {
      control = document.createElement('input');
      control.type = field.type === 'number' ? 'number' : 'text';
      if (field.type === 'number') Object.assign(control, { min: field.min, max: field.max, step: field.step });
      if (field.type === 'text') control.maxLength = field.max || 80;
      if (field.key === 'address') control.dir = 'ltr';
    }
    control.id = fieldId(feature, field);
    control.dataset.featureField = `${feature.id}:${field.key}`;
    control.addEventListener('change', () => api.setFeatures({ values: { [feature.id]: { [field.key]: control.value } } }).then(show));
    const label = document.createElement('label');
    label.className = 'feature-field';
    const text = document.createElement('span');
    text.textContent = field.label;
    label.append(text, control);
    return label;
  }

  function card(feature) {
    const article = document.createElement('article');
    article.className = 'feature-card';
    article.dataset.feature = feature.id;
    const row = document.createElement('label');
    row.className = 'switch-row';
    const text = document.createElement('span');
    const title = document.createElement('b');
    title.textContent = feature.title;
    const help = document.createElement('small');
    help.textContent = feature.help;
    text.append(title, help);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.featureSwitch = feature.id;
    input.addEventListener('change', () => api.setFeatures({ enabled: { [feature.id]: input.checked } }).then(show));
    row.append(text, input, document.createElement('i'));
    article.append(row);
    if (feature.fields.length || feature.button) {
      const extra = document.createElement('div');
      extra.className = 'feature-fields';
      for (const field of feature.fields) extra.append(fieldControl(feature, field));
      if (feature.button) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ghost';
        button.id = `feature-button-${feature.button.id}`;
        button.dataset.featureButton = feature.button.id;
        button.textContent = feature.button.label;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try { const result = await api.featureAction(feature.button.id); if (result?.message) say(result.message, 7000); }
          catch (error) { say(error.message, 8000); }
          finally { button.disabled = false; }
        });
        extra.append(button);
      }
      article.append(extra);
    }
    return article;
  }

  // Shows the saved values; a box being typed in is left alone.
  function show(next) {
    if (next) current = next;
    for (const feature of defs.FEATURES) {
      const on = Boolean(current.enabled[feature.id]);
      const input = root.querySelector(`[data-feature-switch="${feature.id}"]`);
      if (input) input.checked = on;
      root.querySelector(`[data-feature="${feature.id}"]`)?.classList.toggle('on', on);
      for (const field of feature.fields) {
        const control = root.querySelector(`#${fieldId(feature, field)}`);
        if (!control) continue;
        if (document.activeElement !== control) control.value = String(current.values[feature.id][field.key] ?? '');
        control.disabled = !on;
      }
    }
  }

  root.replaceChildren(...defs.FEATURES.map(card));
  api.getFeatures().then(show);
  api.onFeatures?.(show);

  // ---- Backup of all the settings in one file ----
  const localSettings = () => {
    const local = {};
    try { for (let i = 0; i < localStorage.length; i += 1) { const key = localStorage.key(i); if (key.startsWith('aurum-')) local[key] = localStorage.getItem(key); } } catch {}
    return local;
  };
  document.querySelector('#settings-export')?.addEventListener('click', async () => {
    try {
      const result = await api.exportSettings(localSettings());
      if (!result.canceled) say(`הגיבוי נשמר: ${result.path}`, 7000);
    } catch (error) { say(`שמירת הגיבוי נכשלה: ${error.message}`, 8000); }
  });
  document.querySelector('#settings-import')?.addEventListener('click', async () => {
    try {
      const result = await api.importSettings();
      if (result.canceled) return;
      for (const [key, value] of Object.entries(result.local || {})) { try { localStorage.setItem(key, value); } catch {} }
      say('ההגדרות הוחזרו — טוענים מחדש את התוכנה…', 3000);
      setTimeout(() => location.reload(), 900);
    } catch (error) { say(`שחזור ההגדרות נכשל: ${error.message}`, 8000); }
  });
})();
