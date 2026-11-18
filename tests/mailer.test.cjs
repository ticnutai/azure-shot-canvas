const test = require('node:test');
const assert = require('node:assert/strict');
const { composeCommand, mailSubject, normalizeMailSettings, readSichaCompose, splitArgs } = require('../src/mailer.cjs');

test('Sicha opens a new message with a Hebrew subject and every file attached, after its own arguments', () => {
  const command = composeCommand({ client: 'sicha' }, { ComposeExe: 'C:\\Sicha\\sicha.exe', ComposeArgs: '--compose --profile "עבודה ראשית"' }, ['C:\\צילומים\\א.png', 'C:\\צילומים\\ב.mp4']);
  assert.equal(command.file, 'C:\\Sicha\\sicha.exe');
  assert.deepEqual(command.args, ['--compose', '--profile', 'עבודה ראשית', '--subject', '2 צילומים מאולפן צילום המסך', 'C:\\צילומים\\א.png', 'C:\\צילומים\\ב.mp4']);
});

test('without Sicha registered there is no command (the caller shows the files in their folder)', () => {
  assert.equal(composeCommand({ client: 'sicha' }, {}, ['C:\\a.png']), null);
  assert.equal(composeCommand({ client: 'sicha' }, { ComposeExe: '' }, ['C:\\a.png']), null);
  assert.equal(composeCommand({ client: 'sicha' }, { ComposeExe: 'C:\\s.exe' }, []), null);
});

test('another program gets the files as its arguments; the choice falls back to Sicha without a program', () => {
  assert.deepEqual(composeCommand({ client: 'custom', customPath: 'C:\\Mail\\mail.exe' }, {}, ['C:\\a.png']), { client: 'custom', file: 'C:\\Mail\\mail.exe', args: ['C:\\a.png'] });
  assert.deepEqual(normalizeMailSettings({ client: 'custom' }), { client: 'sicha', customPath: '' });
  assert.deepEqual(normalizeMailSettings({ client: 'other', customPath: 'C:\\x.bat' }), { client: 'sicha', customPath: '' });
  assert.deepEqual(normalizeMailSettings({}), { client: 'sicha', customPath: '' });
});

test('command-line arguments split like Windows: quotes group, \\" is a quote, extra spaces vanish', () => {
  assert.deepEqual(splitArgs('  --a   "b c"  d\\"e ""  '), ['--a', 'b c', 'd"e', '']);
  assert.deepEqual(splitArgs(''), []);
});

test('the subject names one file, or counts several', () => {
  assert.equal(mailSubject(['C:\\x\\צילום 1.png']), 'צילום מסך: צילום 1.png');
  assert.equal(mailSubject(['a', 'b', 'c']), '3 צילומים מאולפן צילום המסך');
  assert.equal(mailSubject([]), '');
});

test('test runs can stand in for the registry, and only test runs', async () => {
  assert.deepEqual(await readSichaCompose({ env: { SCREEN_STUDIO_QA: '1', SCREEN_STUDIO_SICHA_COMPOSE_EXE: 'C:\\stub.exe', SCREEN_STUDIO_SICHA_COMPOSE_ARGS: '--x' } }), { ComposeExe: 'C:\\stub.exe', ComposeArgs: '--x' });
  assert.deepEqual(await readSichaCompose({ env: { SCREEN_STUDIO_QA: '1', SCREEN_STUDIO_SICHA_COMPOSE_EXE: '' } }), {});
});
