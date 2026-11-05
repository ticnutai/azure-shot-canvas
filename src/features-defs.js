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
    },
    {
      id: 'liveDraw', title: 'ציור על המסך בזמן הקלטה',
      help: 'בזמן הקלטה: כפתור "ציור" בסרגל ההקלטה (או קיצור מקשים שתבחרו) מאפשר לצייר על המסך עט, חץ ומלבן, והציור נכנס להקלטה. אסקייפ חוזר לעבודה רגילה והציור נשאר עד שמנקים אותו או עד סוף ההקלטה.',
      fields: [
        { key: 'color', label: 'צבע התחלתי', type: 'select', options: [['#f13c50', 'אדום'], ['#ffc929', 'צהוב'], ['#2f80ed', 'כחול'], ['#27ae60', 'ירוק'], ['#111111', 'שחור']], default: '#f13c50' }
      ]
    },
    {
      id: 'watermark', title: 'סימן מים',
      help: 'טקסט או לוגו בפינה של כל תמונה שנשמרת ושל כל הקלטה. על תמונה קטנה מאוד לא נוסף סימן, כדי שלא יסתיר אותה. תמונה שהועתקה ישירות ללוח נשארת בלי סימן.',
      fields: [
        { key: 'source', label: 'מה להוסיף', type: 'select', options: [['text', 'טקסט'], ['logo', 'לוגו']], default: 'text' },
        { key: 'text', label: 'הטקסט', type: 'text', default: '', max: 60 },
        { key: 'position', label: 'מיקום', type: 'select', options: [['bottom-right', 'ימין למטה'], ['bottom-left', 'שמאל למטה'], ['top-right', 'ימין למעלה'], ['top-left', 'שמאל למעלה'], ['center', 'במרכז']], default: 'bottom-right' },
        { key: 'size', label: 'גודל', type: 'select', options: [['small', 'קטן'], ['medium', 'בינוני'], ['large', 'גדול']], default: 'medium' },
        { key: 'opacity', label: 'אטימות (אחוזים)', type: 'number', min: 10, max: 100, step: 5, default: 60 },
        { key: 'apply', label: 'על מה', type: 'select', options: [['both', 'תמונות והקלטות'], ['images', 'תמונות בלבד'], ['videos', 'הקלטות בלבד']], default: 'both' }
      ],
      button: { id: 'watermark-logo', label: 'בחירת תמונת לוגו' }
    },
    {
      id: 'autoClean', title: 'ניקוי אוטומטי של צילומים ישנים',
      help: 'צילומים והקלטות ישנים עוברים לסל המיחזור, ומשם אפשר להחזיר אותם. פריט שסומן כמועדף לא נמחק. הניקוי הראשון רץ 10 דקות אחרי ההדלקה ובכל 6 שעות אחר כך; כדאי ללחוץ קודם על הבדיקה כדי לראות כמה קבצים יעברו.',
      fields: [
        { key: 'days', label: 'לשמור כמה ימים', type: 'number', min: 1, max: 3650, step: 1, default: 90 },
        { key: 'kind', label: 'מה לנקות', type: 'select', options: [['all', 'הכל'], ['images', 'תמונות בלבד'], ['videos', 'הקלטות בלבד']], default: 'all' }
      ],
      button: { id: 'auto-clean-preview', label: 'בדיקה: כמה קבצים יעברו לסל?' }
    },
    {
      id: 'recordSchedule', title: 'הקלטה מתוזמנת',
      help: 'הקלטה של המקור שנבחר באולפן מתחילה בשעה שקבעתם ונעצרת לבד. דקה לפני ההתחלה מופיעה הודעה. התוכנה צריכה לפעול באותה שעה; אם המחשב ישן או שכבר רצה הקלטה, ההקלטה לא תתחיל ותופיע הודעה.',
      fields: [
        { key: 'time', label: 'שעת ההתחלה', type: 'text', default: '09:00', max: 5 },
        { key: 'minutes', label: 'כמה דקות להקליט', type: 'number', min: 1, max: 600, step: 1, default: 30 },
        { key: 'repeat', label: 'חזרה', type: 'select', options: [['once', 'פעם אחת'], ['daily', 'כל יום']], default: 'once' }
      ],
      button: { id: 'record-schedule-next', label: 'מתי ההקלטה הבאה?' }
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

  // A time of day, always as HH:MM.
  function cleanTime(value) {
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
    return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
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
      if (field.key === 'time') return cleanTime(text) || fallback;
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

  const api = { FEATURES, AFTER_OPTIONS, DEFAULT_ENGINE, cleanTime, defaults, normalizeFeatures, loopbackAddress };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.aurumFeaturesDefs = api;
})();
