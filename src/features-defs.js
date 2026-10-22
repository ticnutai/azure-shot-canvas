// Optional extras: each one is a switch the user turns on (all start off) with its own few settings. One table drives
// the settings tab, the saved file and the checks — no extra is described twice. Used by the main process
// (CommonJS) and by the settings page (a plain script).
(() => {
  const AFTER_OPTIONS = [
    ['default', 'כמו ההגדרה הכללית'], ['save', 'שמירה בלבד'], ['quick', 'עריכה מהירה'], ['professional', 'עריכה מקצועית'],
    ['ocr', 'זיהוי טקסט'], ['pin', 'הצמדה מעל החלונות'], ['share', 'קישור פרטי מקומי']
  ];
  const LANGUAGES = [['עברית', 'עברית'], ['אנגלית', 'אנגלית'], ['ערבית', 'ערבית'], ['רוסית', 'רוסית'], ['צרפתית', 'צרפתית'], ['ספרדית', 'ספרדית'], ['גרמנית', 'גרמנית']];
  const DEFAULT_ENGINE = 'http://127.0.0.1:11434';

  // type: select (options), number (min, max, step), text. `help` is shown under the switch.
  const FEATURES = [
    {
      id: 'textIndex', title: 'חיפוש טקסט בתוך הצילומים',
      help: 'הטקסט שכתוב בכל תמונה מזוהה ברקע, פעם אחת, ונשמר במחשב. אחר כך החיפוש בלוח הצילומים מוצא גם מילים שכתובות בתוך התמונה. הזיהוי נעצר בזמן הקלטה ולא עובד בלי הפסקה.',
      fields: []
    },
    {
      id: 'perKeyAfter', title: 'פעולה נפרדת לכל קיצור',
      help: 'לכל סוג צילום פעולה משלו אחרי השמירה: למשל מסך מלא נפתח בעריכה, ואזור נשמר בלבד. "כמו ההגדרה הכללית" משאיר את ההתנהגות הרגילה.',
      fields: [
        { key: 'screenshot', label: 'מסך מלא', type: 'select', options: AFTER_OPTIONS, default: 'default' },
        { key: 'region', label: 'צילום אזור והאזור הקודם', type: 'select', options: AFTER_OPTIONS, default: 'default' },
        { key: 'scroll', label: 'עמוד גלילה', type: 'select', options: AFTER_OPTIONS, default: 'default' }
      ]
    },
    {
      id: 'pinPlus', title: 'הצמדה משופרת',
      help: 'בצילום מוצמד: גלגלת העכבר משנה את הגודל, קונטרול + גלגלת משנה שקיפות, ולחיצה כפולה מחזירה לגודל ולשקיפות המקוריים. אפשר להצמיד גם מה שנמצא בלוח עכשיו: תמונה, טקסט או צבע.',
      fields: [],
      button: { id: 'pin-clipboard', label: 'הצמדת מה שבלוח עכשיו' }
    },
    {
      id: 'clickRipple', title: 'אפקט לחיצה בהקלטה',
      help: 'בכל לחיצת עכבר בהקלטה מופיע עיגול שמתרחב סביב מקום הלחיצה, כדי שהצופה יבין איפה לחצו. עובד יחד עם "הדגשת סמן".',
      fields: [
        { key: 'color', label: 'צבע', type: 'select', options: [['gold', 'זהב'], ['red', 'אדום'], ['blue', 'כחול'], ['white', 'לבן']], default: 'gold' }
      ]
    },
    {
      id: 'intervalCapture', title: 'צילום אוטומטי במרווחים',
      help: 'צילום של המסך או של האזור האחרון כל כמה שניות, עד שעוצרים. מתאים למעקב אחרי תהליך ארוך. הצילומים נשמרים כמו כל צילום.',
      fields: [
        { key: 'seconds', label: 'שניות בין צילומים', type: 'number', min: 1, max: 86400, step: 1, default: 30 },
        { key: 'count', label: 'כמה צילומים (0 = עד שעוצרים)', type: 'number', min: 0, max: 10000, step: 1, default: 0 },
        { key: 'source', label: 'מה לצלם', type: 'select', options: [['screen', 'המסך כולו'], ['region', 'האזור האחרון']], default: 'screen' }
      ],
      button: { id: 'interval-toggle', label: 'התחלה / עצירה' }
    },
    {
      id: 'translate', title: 'תרגום טקסט מצילום',
      help: 'אחרי "העתקת טקסט מאזור" הטקסט מתורגם וההעתקה ללוח היא התרגום. התרגום נעשה כולו במחשב, במנוע השפה המקומי; שום דבר לא נשלח לרשת. אם המנוע לא פועל, הטקסט המקורי מועתק כרגיל.',
      fields: [
        { key: 'target', label: 'לשפה', type: 'select', options: LANGUAGES, default: 'עברית' },
        { key: 'model', label: 'שם המודל (ריק = הראשון שמותקן)', type: 'text', default: '', max: 80 },
        { key: 'address', label: 'כתובת המנוע (רק במחשב הזה)', type: 'text', default: DEFAULT_ENGINE, max: 80 }
      ],
      button: { id: 'translate-test', label: 'בדיקת חיבור למנוע' }
    }
  ];

  // The engine must run on this very computer: only a loopback address is accepted.
  function loopbackAddress(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
      return `http://${url.hostname}:${url.port || 80}`;
    } catch { return null; }
  }

  function defaults() {
    const enabled = {};
    const values = {};
    for (const feature of FEATURES) {
      enabled[feature.id] = false;
      values[feature.id] = Object.fromEntries(feature.fields.map((field) => [field.key, field.default]));
    }
    return { enabled, values };
  }

  function cleanField(field, value, fallback) {
    if (field.type === 'select') return field.options.some(([key]) => key === value) ? value : fallback;
    if (field.type === 'number') {
      const number = Number(value);
      if (value === '' || value === null || !Number.isFinite(number)) return fallback;
      return Math.round(Math.min(field.max, Math.max(field.min, number)) / field.step) * field.step;
    }
    if (field.type === 'text') {
      const text = String(value ?? '').trim().slice(0, field.max || 80);
      if (field.key === 'address') return loopbackAddress(text) || fallback;
      return text;
    }
    return fallback;
  }

  // `candidate`: { enabled: {id: bool}, values: {id: {key: value}} } — any part may be missing; the rest stays as it was.
  function normalizeFeatures(candidate = {}, current = defaults()) {
    const next = defaults();
    for (const feature of FEATURES) {
      next.enabled[feature.id] = Boolean(current.enabled?.[feature.id]);
      for (const field of feature.fields) next.values[feature.id][field.key] = cleanField(field, current.values?.[feature.id]?.[field.key], field.default);
      if (candidate.enabled && feature.id in candidate.enabled) next.enabled[feature.id] = Boolean(candidate.enabled[feature.id]);
      for (const field of feature.fields) {
        const given = candidate.values?.[feature.id];
        if (given && field.key in given) next.values[feature.id][field.key] = cleanField(field, given[field.key], next.values[feature.id][field.key]);
      }
    }
    return next;
  }

  const api = { FEATURES, AFTER_OPTIONS, DEFAULT_ENGINE, defaults, normalizeFeatures, loopbackAddress };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.aurumFeaturesDefs = api;
})();
