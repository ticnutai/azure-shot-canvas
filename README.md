# אולפן צילום מסך

אפליקציית Windows מקומית לצילום תמונות ולהקלטת מסך באיכות גבוהה. הממשק בעברית והקבצים נשמרים במחשב בלבד.

## יכולות MVP

- צילום מסך, חלון או אזור נבחר ל-PNG.
- הקלטת מסך או חלון ל-WebM וייצוא MP4 אוטומטי כש-FFmpeg זמין.
- קול מערכת, מיקרופון ומצלמה כאפשרויות נפרדות.
- בחירת איכות: מסמכים, רגיל או תנועה חלקה.
- בחירת אזור מתוך תצוגה מקדימה לפני צילום או הקלטה.
- השהיה, המשך ועצירה של הקלטה.
- ספריית קבצים מקומית ופתיחת תיקיית הפלט.
- קיצורים גלובליים: `Ctrl+Shift+1` לצילום, `Ctrl+Shift+2` להקלטה ו-`Ctrl+Shift+Q` לעצירה.
- קיצורי פיתוח: `Ctrl+Shift+R` לרענון מלא ו-`Ctrl+Shift+I` או `F12` לפתיחת כלי המפתחים.

## מצבי הפעלה

```powershell
npm install
```

| פקודה | מה נפתח |
|---|---|
| `npm run dev` או `npm run localhost` | שרת localhost בלבד, בלי לפתוח חלון |
| `npm run dev:stop` | סגירה מאומתת של שרתי Aurum המקומיים בלבד |
| `npm run localhost:open` | localhost בלבד ופתיחת הדפדפן |
| `npm run electron` או `npm run electron:start` | Electron בלבד מתוך הקבצים המקומיים |
| `npm start` או `npm run electron:dev` | Electron המחובר ל-localhost עם live reload |
| `npm run electron:pack` | תיקיית Electron לא ארוזה ב-`dist/win-unpacked` |
| `npm run electron:dist` או `npm run build` | מתקין Windows מלא |

שרת הפיתוח מאזין כברירת מחדל ב-`http://127.0.0.1:4173`. אם הפורט תפוס הוא מחפש פורט פנוי; אם כבר פועל עליו שרת Aurum תקין הוא משתמש בו ולא יוצר כפילות. ממשק הדפדפן שומר צילומים לתיקיית ההורדות, ואילו Electron משתמש בספרייה המקומית המלאה.

במצב `electron:dev`, שינוי בקובצי הממשק גורם לרענון אוטומטי אמיתי דרך SSE ללא cache. שינוי ב-`main.cjs`, ב-preload או בקוד הראשי מפעיל מחדש את תהליך Electron. `Ctrl+Shift+R` מבצע רענון מלא ידני.

## בדיקות ובניית מתקין

```powershell
npm test
npm run test:qa
npm run electron:dist
```

`npm run test:qa` מפעיל בדיקות יחידה ובדיקות Playwright מול Electron אמיתי, מודד זמני תגובה, מאמת PNG/MP4 ואודיו באמצעות FFprobe/FFmpeg, וכותב דוחות מספריים אל `artifacts/qa/latest-report.html` ו-`latest-report.json`.

ברירת המחדל לשמירה היא התיקייה `Videos\אולפן צילום מסך` של המשתמש.
