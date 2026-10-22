const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// The optional extras (settings tab "תוספות"): each one is a switch, off at first, and does its job only while on.
//   1  the tab: six extras, all off, their settings greyed; a switch saves at once and turns its settings on
//   2  backup of all settings to a file and back
//   3  a separate action per shortcut: armed by the shortcut, taken once by the capture
//   4  the improved pin: from the clipboard (text, colour, picture); wheel resizes, Control + wheel fades, double click resets
//   5  interval capture: pictures every few seconds until the count is reached or it is stopped
//   6  translation of recognised text with a local engine (a stand-in engine here); down engine = original text kept
//   7  text search inside the captures: recognised once in the background, found by the captures window search
//   8  click rings: clicks reach the recording only while the extra is on
test.describe.serial('optional extras', () => {
  let app;
  let page;
  let outputDir;
  let runtimeErrors;
  const userData = () => path.join(outputDir, 'electron-user-data');

  test.beforeAll(async () => { ({ app, page, outputDir, runtimeErrors } = await launchStudio('extras')); });
  test.afterAll(async () => closeStudio(app));

  const features = () => page.evaluate(() => window.screenStudio.getFeatures());
  const setFeatures = (patch) => page.evaluate((value) => window.screenStudio.setFeatures(value), patch);
  const openTab = async () => {
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-preference-tab="features"]').click();
  };
  // A picture with big plain letters, for the text recognition.
  const textPicture = (text) => page.evaluate(async (words) => {
    const canvas = document.createElement('canvas');
    canvas.width = 900; canvas.height = 220;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 900, 220);
    context.fillStyle = '#000'; context.font = 'bold 110px Arial'; context.fillText(words, 40, 150);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, text);
  const pngs = async () => (await fs.readdir(outputDir)).filter((name) => /\.png$/.test(name));
  const closePins = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((win) => win.webContents.getURL().startsWith('data:text/html')).forEach((win) => win.destroy()));
  const pinWindows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((win) => win.webContents.getURL().startsWith('data:text/html')).length);

  test('1 · the tab: six extras, all off at first; a switch saves at once and turns its settings on', async () => {
    await openTab();
    await expect(page.locator('.feature-card[data-feature]')).toHaveCount(6);
    const off = await page.locator('[data-feature-switch]').evaluateAll((inputs) => inputs.map((input) => input.checked));
    expect(off).toEqual([false, false, false, false, false, false]);
    expect(await page.locator('#feature-intervalCapture-seconds').isDisabled()).toBe(true);
    await page.locator('[data-feature="intervalCapture"] .switch-row').click();
    await expect(page.locator('#feature-intervalCapture-seconds')).toBeEnabled();
    expect((await features()).enabled.intervalCapture).toBe(true);
    await page.locator('#feature-intervalCapture-seconds').fill('7');
    await page.locator('#feature-intervalCapture-seconds').blur();
    await expect.poll(async () => (await features()).values.intervalCapture.seconds).toBe(7);
    // Numbers stay in range; the translation engine stays on this computer.
    await setFeatures({ values: { intervalCapture: { seconds: 0 }, translate: { address: 'http://evil.example:11434' } } });
    expect((await features()).values.intervalCapture.seconds).toBe(1);
    expect((await features()).values.translate.address).toBe('http://127.0.0.1:11434');
    const saved = JSON.parse(await fs.readFile(path.join(userData(), 'features.json'), 'utf8'));
    expect(saved.enabled.intervalCapture).toBe(true);
    await setFeatures({ enabled: { intervalCapture: false } });
  });

  test('2 · the backup holds every setting in one file and brings them back', async () => {
    await page.evaluate(() => localStorage.setItem('aurum-capture-delay', '5'));
    await setFeatures({ enabled: { clickRipple: true }, values: { clickRipple: { color: 'red' } } });
    const file = path.join(outputDir, 'backup.json');
    const exported = await app.evaluate(async (_electron, [target, local]) => globalThis.__aurumQa.exportSettings(local, target), [file, await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith('aurum-')).map((key) => [key, localStorage.getItem(key)])))]);
    expect(exported.files).toBeGreaterThanOrEqual(1);
    const backup = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(backup.format).toBe('aurum-settings');
    expect(backup.local['aurum-capture-delay']).toBe('5');
    expect(backup.files['features.json'].enabled.clickRipple).toBe(true);
    // Change things, bring the backup back.
    await setFeatures({ enabled: { clickRipple: false }, values: { clickRipple: { color: 'blue' } } });
    const imported = await app.evaluate(async (_electron, source) => globalThis.__aurumQa.importSettings(source), file);
    expect(imported.local['aurum-capture-delay']).toBe('5');
    expect((await features()).enabled.clickRipple).toBe(true);
    expect((await features()).values.clickRipple.color).toBe('red');
    // A file that is not a backup is refused and changes nothing.
    await fs.writeFile(path.join(outputDir, 'not-backup.json'), '{"hello":1}');
    await expect(app.evaluate(async (_electron, source) => globalThis.__aurumQa.importSettings(source), path.join(outputDir, 'not-backup.json'))).rejects.toThrow(/לא קובץ גיבוי/);
    expect((await features()).enabled.clickRipple).toBe(true);
    await setFeatures({ enabled: { clickRipple: false } });
  });

  test('3 · a separate action per shortcut: armed by the shortcut, taken once, never when the extra is off', async () => {
    const arm = () => page.evaluate(() => { armAfterAction('screenshot'); return [takeAfterOverride(), takeAfterOverride()]; });
    await setFeatures({ values: { perKeyAfter: { screenshot: 'pin' } } });
    expect(await arm()).toEqual([null, null]);
    await setFeatures({ enabled: { perKeyAfter: true } });
    await expect.poll(() => page.evaluate(() => state.features?.enabled?.perKeyAfter)).toBe(true);
    expect(await arm()).toEqual(['pin', null]);
    await setFeatures({ values: { perKeyAfter: { screenshot: 'default' } } });
    await expect.poll(() => page.evaluate(() => state.features?.values?.perKeyAfter?.screenshot)).toBe('default');
    expect(await arm()).toEqual([null, null]);
    // A capture handed over with its own action (region / scroll): the action travels with it and is used instead of the general one.
    await setFeatures({ values: { perKeyAfter: { region: 'pin' } } });
    const before = await pinWindows();
    await app.evaluate(async (_electron, bytes) => globalThis.__aurumQa.deliverCapture({ png: Buffer.from(bytes), width: 900, height: 220, after: 'save', afterAction: 'pin' }), await textPicture('Per key'));
    await expect.poll(async () => (await pngs()).length, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(pinWindows, { timeout: 20_000 }).toBe(before + 1);
    await closePins();
    await setFeatures({ enabled: { perKeyAfter: false } });
  });

  test('4 · the improved pin: text, colour and picture from the clipboard; wheel, Control + wheel and double click', async () => {
    // Off: the action refuses and nothing opens.
    const refused = await page.evaluate(() => window.screenStudio.featureAction('pin-clipboard'));
    expect(refused.message).toContain('הדליקו קודם');
    await setFeatures({ enabled: { pinPlus: true } });
    const open = async (text) => { await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text); const before = await pinWindows(); await page.evaluate(() => window.screenStudio.featureAction('pin-clipboard')); await expect.poll(pinWindows, { timeout: 15_000 }).toBe(before + 1); };
    await app.evaluate(({ clipboard }) => clipboard.clear());
    expect((await page.evaluate(() => window.screenStudio.featureAction('pin-clipboard'))).message).toContain('אין כרגע');
    await open('טקסט להצמדה <b>לא נדלק</b>');
    await open('#336699');
    const pins = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((win) => win.webContents.getURL().startsWith('data:text/html')).map((win) => ({ id: win.id, html: decodeURIComponent(win.webContents.getURL().split(',')[1]), bounds: win.getBounds() })));
    const all = await pins();
    const textPin = all.find((pin) => pin.html.includes('טקסט להצמדה'));
    const colorPin = all.find((pin) => pin.html.includes('#336699'));
    expect(textPin.html).toContain('טקסט להצמדה &lt;b&gt;לא נדלק&lt;/b&gt;');
    expect(textPin.html).not.toContain('<b>לא נדלק</b>');
    expect(colorPin.html).toContain('background:#336699');
    // The wheel pieces, on the colour pin: bigger, fainter, and back.
    const act = (id, code) => app.evaluate(async ({ BrowserWindow }, [windowId, js]) => { const win = BrowserWindow.fromId(windowId); await win.webContents.executeJavaScript(js); return { bounds: win.getBounds(), opacity: win.getOpacity() }; }, [id, code]);
    const start = colorPin.bounds;
    const bigger = await act(colorPin.id, 'pinApi.resize(1.5)');
    await expect.poll(async () => (await act(colorPin.id, '0')).bounds.width).toBeGreaterThan(start.width);
    const faint = await act(colorPin.id, 'pinApi.opacity(-0.5)');
    await expect.poll(async () => (await act(colorPin.id, '0')).opacity).toBeLessThan(0.7);
    await act(colorPin.id, 'pinApi.reset()');
    await expect.poll(async () => (await act(colorPin.id, '0')).opacity).toBe(1);
    await expect.poll(async () => (await act(colorPin.id, '0')).bounds.width).toBe(start.width);
    expect(bigger.bounds.width).toBeGreaterThan(start.width);
    expect(faint.opacity).toBeLessThan(1);
    // A real wheel event on the page does the same as the call.
    await act(colorPin.id, 'dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }))');
    await expect.poll(async () => (await act(colorPin.id, '0')).bounds.width).toBeGreaterThan(start.width);
    // A picture on the clipboard is pinned as a picture.
    await app.evaluate(({ clipboard, nativeImage }, bytes) => clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(bytes))), await textPicture('Pin'));
    const before = await pinWindows();
    await page.evaluate(() => window.screenStudio.featureAction('pin-clipboard'));
    await expect.poll(pinWindows, { timeout: 15_000 }).toBe(before + 1);
    expect((await pins()).some((pin) => pin.html.includes('<img'))).toBe(true);
    // Switched off again: a pin of a saved picture is the plain window, without the wheel and opacity calls.
    await setFeatures({ enabled: { pinPlus: false } });
    await closePins();
    const saved = path.join(outputDir, (await pngs())[0]);
    await page.evaluate((file) => window.screenStudio.pinImage(file), saved);
    await expect.poll(pinWindows, { timeout: 15_000 }).toBe(1);
    const plainKind = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().startsWith('data:text/html')).webContents.executeJavaScript('typeof pinApi'));
    expect(plainKind).toBe('undefined');
    await closePins();
  });

  test('5 · interval capture: pictures every few seconds, until the count is reached or it is stopped', async () => {
    test.setTimeout(90_000);
    expect((await page.evaluate(() => window.screenStudio.featureAction('interval-toggle'))).message).toContain('הדליקו קודם');
    await setFeatures({ enabled: { intervalCapture: true }, values: { intervalCapture: { seconds: 1, count: 2, source: 'screen' } } });
    const before = (await pngs()).length;
    const started = await page.evaluate(() => window.screenStudio.featureAction('interval-toggle'));
    expect(started.running).toBe(true);
    await expect.poll(async () => (await pngs()).length, { timeout: 40_000 }).toBeGreaterThanOrEqual(before + 2);
    await expect.poll(() => app.evaluate(() => globalThis.__aurumQa.intervalCapture.running), { timeout: 10_000 }).toBe(false);
    expect(await app.evaluate(() => globalThis.__aurumQa.intervalCapture.taken)).toBe(2);
    // Without a count it goes on until stopped; stopping works from the same button.
    await setFeatures({ values: { intervalCapture: { seconds: 60, count: 0 } } });
    await page.evaluate(() => window.screenStudio.featureAction('interval-toggle'));
    await expect.poll(() => app.evaluate(() => globalThis.__aurumQa.intervalCapture.taken), { timeout: 30_000 }).toBe(1);
    expect((await page.evaluate(() => window.screenStudio.featureAction('interval-toggle'))).message).toContain('נעצר');
    expect(await app.evaluate(() => globalThis.__aurumQa.intervalCapture.running)).toBe(false);
    // Switching the extra off stops it too.
    await page.evaluate(() => window.screenStudio.featureAction('interval-toggle'));
    await setFeatures({ enabled: { intervalCapture: false } });
    await expect.poll(() => app.evaluate(() => globalThis.__aurumQa.intervalCapture.running)).toBe(false);
  });

  test('6 · translation of recognised text with a local engine; a missing engine keeps the original text', async () => {
    test.setTimeout(120_000);
    const requests = [];
    const engine = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requests.push({ url: request.url, body: body ? JSON.parse(body) : null });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(request.url === '/api/tags' ? { models: [{ name: 'stand-in:1b' }] } : { response: 'שלום מהמנוע המקומי' }));
      });
    });
    await new Promise((resolve) => engine.listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${engine.address().port}`;
    try {
      const picture = await textPicture('Hello World');
      const recognise = () => app.evaluate(async ({ clipboard }, bytes) => { clipboard.writeText('before'); const outcome = await globalThis.__aurumQa.copyTextFromImage(Buffer.from(bytes)); return { outcome, clipboard: clipboard.readText() }; }, picture);
      // Off: the text is copied as it was recognised, the engine is never asked.
      const plain = await recognise();
      expect(plain.outcome.translated).toBeUndefined();
      expect(requests.length).toBe(0);
      await setFeatures({ enabled: { translate: true }, values: { translate: { address, target: 'עברית' } } });
      const test1 = await page.evaluate(() => window.screenStudio.featureAction('translate-test'));
      expect(test1.message).toContain('stand-in:1b');
      const translated = await recognise();
      // The recognition itself must work on this machine for the rest to mean anything.
      expect(plain.outcome.characters).toBeGreaterThan(0);
      {
        expect(translated.outcome.translated).toBe(true);
        expect(translated.clipboard).toBe('שלום מהמנוע המקומי');
        const generate = requests.find((item) => item.url === '/api/generate');
        expect(generate.body.model).toBe('stand-in:1b');
        expect(generate.body.prompt).toContain('into Hebrew');
        expect(generate.body.prompt).toMatch(/Hello|World/i);
      }
    } finally { await new Promise((resolve) => engine.close(resolve)); }
    // Engine down: the original text is copied and the notice says why.
    const down = await app.evaluate(async ({ clipboard }, bytes) => { const outcome = await globalThis.__aurumQa.copyTextFromImage(Buffer.from(bytes)); return { outcome, clipboard: clipboard.readText(), notice: globalThis.__aurumQa.lastNotice }; }, await textPicture('Hello World'));
    {
      expect(down.outcome.translated).toBe(false);
      expect(down.clipboard).not.toBe('שלום מהמנוע המקומי');
      expect(down.notice.title).toContain('הטקסט המקורי הועתק');
    }
    expect((await page.evaluate(() => window.screenStudio.featureAction('translate-test'))).message).toContain('לא פועל');
    await setFeatures({ enabled: { translate: false } });
  });

  test('7 · text search inside the captures: recognised once in the background and found by the search', async () => {
    test.setTimeout(120_000);
    await fs.writeFile(path.join(outputDir, 'צילום_2026-10-22_10-00-00-000.png'), Buffer.from(await textPicture('Zebra Crossing')));
    await fs.writeFile(path.join(outputDir, 'צילום_2026-10-22_10-00-01-000.png'), Buffer.from(await textPicture('Blue Apple')));
    // Off: the captures window gets no recognised text and nothing is read.
    await expect.poll(async () => (await app.evaluate(() => globalThis.__aurumQa.textIndexState())).active).toBe(false);
    await setFeatures({ enabled: { textIndex: true } });
    await expect.poll(async () => (await app.evaluate(() => globalThis.__aurumQa.textIndexState())).active).toBe(true);
    await expect.poll(async () => (await app.evaluate(() => globalThis.__aurumQa.textIndexState())).done + (await app.evaluate(() => globalThis.__aurumQa.textIndexState())).skipped, { timeout: 90_000 }).toBeGreaterThanOrEqual(2);
    const metadata = JSON.parse(await fs.readFile(path.join(outputDir, 'צילום_2026-10-22_10-00-00-000.png.meta.json'), 'utf8').catch(() => '{}'));
    expect(metadata.ocrAt).toBeTruthy();
    {
      expect(String(metadata.ocrText).toLowerCase()).toMatch(/zebra|crossing/);
      // The captures window search finds it by the words inside the picture.
      await app.windows().find((candidate) => candidate.url().includes('quickbar.html'))?.evaluate(() => window.quickbarApi.openWorkspace());
      await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('workspace.html')), { timeout: 15_000 }).toBe(true);
      const workspace = app.windows().find((candidate) => candidate.url().includes('workspace.html'));
      await workspace.waitForFunction(() => document.documentElement.dataset.ready === 'true');
      const total = await workspace.locator('.item').count();
      await workspace.locator('#search').fill('zebra');
      await expect(workspace.locator('.item')).toHaveCount(1);
      await workspace.locator('#search').fill('apple');
      await expect(workspace.locator('.item')).toHaveCount(1);
      await workspace.locator('#search').fill('');
      await expect(workspace.locator('.item')).toHaveCount(total);
    }
    // Switched off: it rests again and the captures window search is back to names only.
    await setFeatures({ enabled: { textIndex: false } });
    await expect.poll(async () => (await app.evaluate(() => globalThis.__aurumQa.textIndexState())).active).toBe(false);
  });

  test('8 · click rings: a click reaches the recording only while the extra is on and a recording runs', async () => {
    await page.evaluate(() => { window.__clicks = []; window.screenStudio.onRecordingClick((click) => window.__clicks.push(click)); });
    // Extra off: the helper is not asked for clicks.
    await app.evaluate(async () => globalThis.__aurumQa.setClickEcho(false));
    await app.evaluate(() => globalThis.__aurumQa.pressKey('click 100 100 l'));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__clicks.length)).toBe(0);
    await setFeatures({ enabled: { clickRipple: true } });
    await app.evaluate(async () => globalThis.__aurumQa.setClickEcho(true));
    expect(await app.evaluate(() => globalThis.__aurumQa.clickEchoActive())).toBe(true);
    await app.evaluate(() => globalThis.__aurumQa.pressKey('click 100 100 l'));
    await expect.poll(() => page.evaluate(() => window.__clicks.length)).toBe(1);
    const click = await page.evaluate(() => window.__clicks[0]);
    expect(click.button).toBe('left');
    expect(click.bounds.width).toBeGreaterThan(0);
    // A line that is not a click is ignored.
    await app.evaluate(() => globalThis.__aurumQa.pressKey('click abc'));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__clicks.length)).toBe(1);
    // The ring is drawn on the recording picture where the click happened, in the chosen colour; the cursor halo uses the
    // same mapping, which says null outside the recorded area and for a window source.
    const drawn = await page.evaluate(() => {
      const saved = { source: state.selectedSource, region: state.region, features: state.features, clicks: state.clicks, width: recordingCanvas.width, height: recordingCanvas.height };
      state.selectedSource = { type: 'screen' };
      state.region = { x: 0, y: 0, width: 1, height: 1 };
      recordingCanvas.width = 640; recordingCanvas.height = 360;
      recordingContext.clearRect(0, 0, 640, 360);
      state.features = { enabled: { clickRipple: true }, values: { clickRipple: { color: 'red' } } };
      const screenInfo = { point: { x: 50, y: 50 }, bounds: { x: 0, y: 0, width: 100, height: 100 } };
      const mapped = canvasPointFor(screenInfo);
      const outside = canvasPointFor({ point: { x: 150, y: 50 }, bounds: screenInfo.bounds });
      state.clicks = [{ ...screenInfo, at: performance.now() }];
      drawClickRipples();
      const centre = recordingContext.getImageData(320, 180, 1, 1).data;
      const ring = recordingContext.getImageData(330, 180, 1, 1).data;
      const kept = state.clicks.length;
      state.clicks = [{ ...screenInfo, at: performance.now() - 5000 }];
      drawClickRipples();
      const expired = state.clicks.length;
      state.selectedSource = { type: 'window' };
      const windowSource = canvasPointFor(screenInfo);
      Object.assign(state, { selectedSource: saved.source, region: saved.region, features: saved.features, clicks: saved.clicks });
      recordingCanvas.width = saved.width; recordingCanvas.height = saved.height;
      return { mapped, outside, centre: [...centre], ring: [...ring], kept, expired, windowSource };
    });
    expect(drawn.mapped).toEqual({ x: 320, y: 180 });
    expect(drawn.outside).toBeNull();
    expect(drawn.windowSource).toBeNull();
    expect(drawn.centre[3]).toBeGreaterThan(10);
    expect(drawn.ring[3]).toBeGreaterThan(100);
    expect(drawn.ring[0]).toBeGreaterThan(drawn.ring[1]);
    expect(drawn.kept).toBe(1);
    expect(drawn.expired).toBe(0);
    // Switching the extra off puts the helper back to silence.
    await setFeatures({ enabled: { clickRipple: false } });
    await expect.poll(() => app.evaluate(() => globalThis.__aurumQa.clickEchoActive())).toBe(false);
    expect(runtimeErrors).toEqual([]);
  });
});
