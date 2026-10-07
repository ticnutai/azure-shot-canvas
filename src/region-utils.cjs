// Geometry for the full-screen region picker. Shared by the main process (require) and the overlay page
// (script tag → window.AurumRegion), so the picker and the crop always agree.
(function exposeRegion(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AurumRegion = api;
})(typeof window !== 'undefined' ? window : null, () => {

const MIN_DRAG = 4;
const MIN_SIZE = 8;

function rectFromPoints(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function clipRect(rect, bounds) {
  const x = Math.max(rect.x, bounds.x);
  const y = Math.max(rect.y, bounds.y);
  const right = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const bottom = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

// Front-to-back list: the first window under the point is the one the user sees.
function windowAt(windows, point) {
  return windows.find((rect) => point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height) || null;
}

// What a click would capture: the smallest visible part of the front window under the point (a panel, a list,
// a toolbar), or the whole window when it has no part there — or when wholeWindow is asked for (Shift held).
function targetAt(windows, point, { wholeWindow = false } = {}) {
  const window = windowAt(windows, point);
  if (!window) return null;
  if (wholeWindow || !window.parts?.length) return window;
  const area = (rect) => rect.width * rect.height;
  const part = window.parts
    .filter((rect) => area(rect) < area(window) * 0.95 && point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height)
    .sort((a, b) => area(a) - area(b))[0];
  return part ? { x: part.x, y: part.y, width: part.width, height: part.height } : window;
}

function isDrag(start, end) {
  return Math.abs(end.x - start.x) >= MIN_DRAG || Math.abs(end.y - start.y) >= MIN_DRAG;
}

function isUsable(rect) {
  return Boolean(rect && rect.width >= MIN_SIZE && rect.height >= MIN_SIZE);
}

// Screen-relative rectangle (screen points) → whole pixels of the frozen image, never outside it.
function toImagePixels(rect, scale, imageSize) {
  const x = Math.max(0, Math.floor(rect.x * scale));
  const y = Math.max(0, Math.floor(rect.y * scale));
  const right = Math.min(imageSize.width, Math.ceil((rect.x + rect.width) * scale));
  const bottom = Math.min(imageSize.height, Math.ceil((rect.y + rect.height) * scale));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

// The last region is kept per screen; on another screen (or a changed layout) it is clipped to fit.
function normalizeLastRegion(value, displays) {
  if (!value || !['x', 'y', 'width', 'height'].every((field) => Number.isFinite(value.rect?.[field]))) return null;
  const display = displays.find((item) => String(item.id) === String(value.displayId)) || displays[0];
  if (!display) return null;
  const rect = clipRect(value.rect, { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height });
  return isUsable(rect) ? { displayId: display.id, rect } : null;
}

return { MIN_DRAG, MIN_SIZE, clipRect, isDrag, isUsable, normalizeLastRegion, rectFromPoints, targetAt, toImagePixels, windowAt };
});
