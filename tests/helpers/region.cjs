const { expect } = require('@playwright/test');

// Drives the frozen-screen region picker in tests (its windows stay hidden in test mode; events go to the page).
function regionOverlay(app) {
  const pages = () => app.windows().filter((candidate) => candidate.url().includes('region-overlay.html'));
  return {
    pages,
    // The overlay that received a fresh frozen picture after `since` (Date.now() before the trigger).
    async opened(since) {
      await expect.poll(() => pages().length, { timeout: 15_000 }).toBeGreaterThan(0);
      const started = Date.now();
      while (Date.now() - started < 20_000) {
        for (const candidate of pages()) {
          if (Number(await candidate.evaluate(() => document.documentElement.dataset.regionReady || 0).catch(() => 0)) > since) return candidate;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('the frozen screen never opened');
    },
    drag: (overlay, from, to) => overlay.evaluate(([a, b]) => {
      const fire = (type, point) => window.dispatchEvent(new PointerEvent(type, { clientX: point.x, clientY: point.y, button: 0, bubbles: true, pointerId: 1 }));
      fire('pointermove', a);
      fire('pointerdown', a);
      fire('pointermove', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      fire('pointermove', b);
      fire('pointerup', b);
    }, [from, to]),
    key: (overlay, init) => overlay.evaluate((value) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...value })), init)
  };
}

module.exports = { regionOverlay };
