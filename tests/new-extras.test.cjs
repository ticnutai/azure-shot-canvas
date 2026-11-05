const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppJournal, MAX_SIZE } = require('../src/app-journal.cjs');
const { expiredCaptures, matchesKind } = require('../src/auto-clean.cjs');
const { RecordSchedule, nextOccurrence, parseTime } = require('../src/record-schedule.cjs');
const { drawWatermark, fontSizeFor, placement } = require('../src/watermark.js');
const { cleanTime, normalizeFeatures } = require('../src/features-defs.js');

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function tempFolder() { return fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-journal-')); }

test('the journal: a run that closed properly leaves no warning for the next one', () => {
  const directory = tempFolder();
  const first = new AppJournal({ directory, version: '1.0.0' });
  assert.equal(first.begin(), null);
  first.reason('יציאה מהסמל ליד השעון');
  first.reason('סיבה שנייה לא נרשמת');
  first.end();
  first.end();
  const second = new AppJournal({ directory, version: '1.0.0' });
  assert.equal(second.begin(), null);
  const log = fs.readFileSync(second.file, 'utf8');
  assert.match(log, /סגירה מסודרת: יציאה מהסמל ליד השעון/);
  assert.equal(log.match(/סגירה מסודרת/g).length, 1);
  assert.doesNotMatch(log, /סיבה שנייה/);
  assert.doesNotMatch(log, /לא נסגרה מסודר/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('the journal: a run that ended suddenly is reported at the next start, with when it was last alive', () => {
  const directory = tempFolder();
  let clock = new Date('2026-11-04T18:00:00.000Z');
  const first = new AppJournal({ directory, version: '1.0.0', now: () => clock });
  first.begin();
  clock = new Date('2026-11-04T18:35:00.000Z');
  first.beat();
  // no end(): the process died here
  const second = new AppJournal({ directory, version: '1.0.1', now: () => new Date('2026-11-04T22:00:00.000Z') });
  const previous = second.begin({ hidden: true });
  assert.equal(previous.seenAt, '2026-11-04T18:35:00.000Z');
  const log = fs.readFileSync(second.file, 'utf8');
  assert.match(log, /לא נסגרה מסודר: גרסה 1\.0\.0, נראתה פעילה לאחרונה ב־2026-11-04T18:35:00\.000Z/);
  assert.match(log, /הפעלה: גרסה 1\.0\.1, מוסתרת/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('the journal: never grows past two small files', () => {
  const directory = tempFolder();
  const journal = new AppJournal({ directory });
  fs.writeFileSync(journal.file, 'x'.repeat(MAX_SIZE + 1));
  journal.write('שורה חדשה');
  assert.ok(fs.statSync(journal.file).size < 1000);
  assert.ok(fs.existsSync(`${journal.file}.old`));
  fs.rmSync(directory, { recursive: true, force: true });
});

test('cleaning: only old files of the chosen kind, oldest first, never a favourite', () => {
  const now = 1000 * DAY;
  const old = (name, days, extra = {}) => ({ path: `C:/out/${name}`, at: now - days * DAY, size: 10, ...extra });
  const entries = [old('new.png', 5), old('old.png', 100), old('older.mp4', 200), old('saved.png', 300, { favorite: true }), old('notes.txt', 400), old('a.png.meta.json', 400)];
  assert.deepEqual(expiredCaptures(entries, { days: 90, now }).map((item) => path.basename(item.path)), ['older.mp4', 'old.png']);
  assert.deepEqual(expiredCaptures(entries, { days: 90, kind: 'images', now }).map((item) => path.basename(item.path)), ['old.png']);
  assert.deepEqual(expiredCaptures(entries, { days: 90, kind: 'videos', now }).map((item) => path.basename(item.path)), ['older.mp4']);
  assert.equal(expiredCaptures(entries, { days: 0, now }).length, 0);
  assert.equal(expiredCaptures(entries, { days: 'abc', now }).length, 0);
  assert.equal(expiredCaptures(Array.from({ length: 300 }, (_, i) => old(`${i}.png`, 100)), { days: 90, now }).length, 200);
  assert.equal(matchesKind('C:/x/a.exe', 'all'), false);
});

test('schedule: the time of day is read strictly, and the next time is always ahead', () => {
  assert.deepEqual(parseTime('9:05'), { hours: 9, minutes: 5 });
  for (const bad of ['25:00', '12:60', 'abc', '', null]) assert.equal(parseTime(bad), null);
  assert.equal(cleanTime('9:05'), '09:05');
  assert.equal(normalizeFeatures({ values: { recordSchedule: { time: '99:99' } } }).values.recordSchedule.time, '09:00');
  assert.equal(normalizeFeatures({ values: { recordSchedule: { time: '7:30' } } }).values.recordSchedule.time, '07:30');
  const morning = new Date(2026, 10, 5, 8, 0, 0).getTime();
  assert.equal(nextOccurrence('09:00', morning), new Date(2026, 10, 5, 9, 0, 0).getTime());
  assert.equal(nextOccurrence('07:00', morning), new Date(2026, 10, 6, 7, 0, 0).getTime());
  assert.equal(nextOccurrence('08:00', morning), new Date(2026, 10, 6, 8, 0, 0).getTime());
});

function schedule({ repeat = 'once', time = '09:00', minutes = 10 } = {}) {
  const log = [];
  const world = { at: new Date(2026, 10, 5, 8, 0, 0).getTime(), recording: false };
  const plan = new RecordSchedule({
    options: () => ({ time, minutes, repeat }),
    isRecording: () => world.recording,
    start: () => { log.push('start'); },
    stop: () => { log.push('stop'); world.recording = false; },
    onEvent: (name) => log.push(name),
    now: () => world.at
  });
  plan.arm();
  const goTo = (hour, minute, second = 0) => { world.at = new Date(2026, 10, 5, hour, minute, second).getTime(); plan.tick(); };
  return { log, world, plan, goTo };
}

test('schedule: warns, starts, stops by itself, and a one-time plan then ends', () => {
  const { log, world, plan, goTo } = schedule();
  goTo(8, 30);
  assert.deepEqual(log, []);
  goTo(8, 59, 30);
  goTo(8, 59, 45);
  assert.deepEqual(log, ['warn']);
  goTo(9, 0);
  assert.deepEqual(log, ['warn', 'start', 'started']);
  world.recording = true;
  goTo(9, 0, 15);
  goTo(9, 9, 59);
  assert.ok(!log.includes('stop'));
  goTo(9, 10);
  assert.deepEqual(log, ['warn', 'start', 'started', 'stop', 'stopped', 'finished-once']);
  assert.equal(plan.nextAt, null);
});

test('schedule: a daily plan comes back tomorrow', () => {
  const { world, plan, goTo } = schedule({ repeat: 'daily' });
  goTo(9, 0);
  world.recording = true;
  goTo(9, 0, 15);
  goTo(9, 10);
  assert.equal(plan.nextAt, new Date(2026, 10, 6, 9, 0, 0).getTime());
});

test('schedule: never starts over a running recording, nor late after sleep, and reports it', () => {
  const busy = schedule({ repeat: 'daily' });
  busy.world.recording = true;
  busy.goTo(9, 0);
  assert.deepEqual(busy.log, ['busy']);
  const asleep = schedule({ repeat: 'daily' });
  asleep.goTo(11, 0);
  assert.deepEqual(asleep.log, ['missed']);
  assert.equal(asleep.plan.nextAt, new Date(2026, 10, 6, 9, 0, 0).getTime());
});

test('schedule: a recording that did not start is reported; stopped by hand, a later recording is left alone', () => {
  const failed = schedule();
  failed.goTo(9, 0);
  failed.goTo(9, 0, 31);
  assert.deepEqual(failed.log, ['start', 'started', 'failed', 'finished-once']);
  const byHand = schedule({ repeat: 'daily' });
  byHand.goTo(9, 0);
  byHand.world.recording = true;
  byHand.goTo(9, 0, 15);
  byHand.world.recording = false;
  byHand.plan.recordingEnded();
  byHand.world.recording = true; // the user's own recording
  byHand.goTo(9, 10);
  assert.ok(!byHand.log.includes('stop'));
});

function fakeContext() {
  const calls = [];
  return {
    calls,
    measureText: (text) => ({ width: text.length * 10 }),
    save() {}, restore() {},
    strokeText: (text, x, y) => calls.push(['stroke', text, x, y]),
    fillText: (text, x, y) => calls.push(['fill', text, x, y]),
    drawImage: (image, x, y, width, height) => calls.push(['image', x, y, width, height])
  };
}

test('watermark: stays inside the picture in every corner', () => {
  for (const position of ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center']) {
    const { x, y } = placement(position, 1000, 600, 200, 40);
    assert.ok(x >= 0 && x + 200 <= 1000 && y >= 0 && y + 40 <= 600, position);
  }
  assert.ok(placement('top-left', 1000, 600, 200, 40).x < 100);
  assert.ok(placement('bottom-right', 1000, 600, 200, 40).x > 700);
  assert.equal(fontSizeFor(1920, 1080, 'medium'), 43);
  assert.equal(fontSizeFor(200, 100, 'small'), 12);
});

test('watermark: nothing without text or logo, and nothing on a tiny picture', () => {
  const none = fakeContext();
  assert.equal(drawWatermark(none, 1000, 600, { source: 'text', text: '  ' }), false);
  assert.equal(drawWatermark(none, 1000, 600, { source: 'logo' }, null), false);
  assert.equal(drawWatermark(none, 100, 50, { source: 'text', text: 'משרד' }), false);
  assert.equal(none.calls.length, 0);
  const text = fakeContext();
  assert.equal(drawWatermark(text, 1000, 600, { source: 'text', text: 'משרד', opacity: 60 }), true);
  assert.equal(text.calls.filter(([kind]) => kind === 'fill')[0][1], 'משרד');
  const logo = fakeContext();
  assert.equal(drawWatermark(logo, 1000, 600, { source: 'logo', opacity: 60 }, { width: 200, height: 100 }), true);
  const [, , , width, height] = logo.calls[0];
  assert.ok(Math.abs(width / height - 2) < 0.01, 'the logo keeps its shape');
});
