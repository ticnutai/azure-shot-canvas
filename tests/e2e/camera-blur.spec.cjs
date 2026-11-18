const { test, expect } = require('@playwright/test');
const { closeStudio, launchStudio } = require('../helpers/electron-app.cjs');

// Background blur through a camera that already blurs (the graphics card maker's broadcast program):
//   1  with such a camera present, a switch appears next to the camera choice and picks it
//   2  switched off, the ordinary camera comes back; the choice is remembered
//   3  without such a camera there is no switch
test.describe.serial('camera background blur through a program already on the computer', () => {
  let app;
  let page;
  const devices = (withBlur) => page.evaluate((blur) => {
    const list = [
      { kind: 'videoinput', deviceId: 'plain-camera', label: 'Integrated Camera', groupId: 'a' },
      ...(blur ? [{ kind: 'videoinput', deviceId: 'blur-camera', label: 'Camera (NVIDIA Broadcast)', groupId: 'b' }] : []),
      { kind: 'audioinput', deviceId: 'mic', label: 'Microphone', groupId: 'c' }
    ];
    navigator.mediaDevices.enumerateDevices = async () => list.map((item) => ({ ...item, toJSON: () => item }));
  }, withBlur);
  const showCameraChoice = async () => {
    await page.evaluate(() => { const box = document.querySelector('#camera'); box.checked = true; return refreshDevices(); });
  };

  test.beforeAll(async () => {
    ({ app, page } = await launchStudio('camera-blur'));
    await page.evaluate(() => localStorage.removeItem('aurum-camera-blur'));
  });
  test.afterAll(async () => { await closeStudio(app); });

  test('1 · the switch appears and picks the blurring camera', async () => {
    await devices(true);
    await showCameraChoice();
    await expect(page.locator('#camera-blur')).toHaveCount(1);
    await expect(page.locator('.camera-blur')).toContainText('תוכנת השידור של אנבידיה');
    await expect(page.locator('#camera-blur')).not.toBeChecked();
    await page.locator('#camera-blur').evaluate((box) => { box.checked = true; box.dispatchEvent(new Event('change')); });
    await expect(page.locator('#camera-device')).toHaveValue('blur-camera');
  });

  test('2 · off brings back the ordinary camera; the choice is remembered', async () => {
    await showCameraChoice();
    await expect(page.locator('#camera-device')).toHaveValue('blur-camera');
    await expect(page.locator('#camera-blur')).toBeChecked();
    await page.locator('#camera-blur').evaluate((box) => { box.checked = false; box.dispatchEvent(new Event('change')); });
    await expect(page.locator('#camera-device')).toHaveValue('plain-camera');
    expect(await page.evaluate(() => localStorage.getItem('aurum-camera-blur'))).toBe('off');
  });

  test('3 · no blurring camera, no switch', async () => {
    await devices(false);
    await showCameraChoice();
    await expect(page.locator('#camera-blur')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-camera-blur-available', 'false');
    await page.evaluate(() => { document.querySelector('#camera').checked = false; return refreshDevices(); });
  });
});
