// Pinned pictures, texts and colours: small windows that stay above everything. The page of a pin is built here, as
// plain text, so the pieces (what is on the clipboard, the colour, the escaping) can be checked without a window.
const COLOR_PATTERN = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// A CSS colour written in the text (and nothing else in it), or null.
function parseColor(text) {
  const value = String(text || '').trim();
  return COLOR_PATTERN.test(value) ? value : null;
}

// What to pin from the clipboard: a picture first, then a colour, then any text; or nothing.
function classifyClipboard({ hasImage = false, text = '' } = {}) {
  if (hasImage) return { kind: 'image' };
  const clean = String(text || '').trim();
  if (!clean) return { kind: 'none' };
  const color = parseColor(clean);
  if (color) return { kind: 'color', color };
  return { kind: 'text', text: clean.slice(0, 4000) };
}

// The size a new pin gets, in points.
function pinSize(kind, { width = 0, height = 0, text = '' } = {}) {
  if (kind === 'color') return { width: 240, height: 170 };
  if (kind === 'text') {
    const lines = Math.min(24, Math.max(3, Math.ceil(String(text).length / 38)));
    return { width: 380, height: Math.min(620, 90 + lines * 24) };
  }
  const scale = Math.min(1, 900 / Math.max(width, 1), 700 / Math.max(height, 1));
  return { width: Math.max(260, Math.round(width * scale)), height: Math.max(180, Math.round(height * scale)) };
}

const BASE_STYLE = 'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111;border-radius:12px;-webkit-app-region:drag;font-family:"Segoe UI",Arial,sans-serif}'
  + 'button{position:fixed;top:8px;left:8px;width:28px;height:28px;border:0;border-radius:50%;background:#000a;color:#fff;font:16px Segoe UI;cursor:pointer;opacity:0;transition:opacity .15s;-webkit-app-region:no-drag;z-index:2}'
  + 'body:hover button{opacity:1}';

// plus: the wheel changes the size, Control + wheel the opacity, a double click puts both back (through pinApi).
const PLUS_SCRIPT = '<script>addEventListener("wheel",(e)=>{e.preventDefault();if(e.ctrlKey)pinApi.opacity(e.deltaY<0?0.06:-0.06);else pinApi.resize(e.deltaY<0?1.08:1/1.08)},{passive:false});addEventListener("dblclick",()=>pinApi.reset());</script>';

function pinPage({ kind, dataUrl = '', text = '', color = '', plus = false } = {}) {
  let body;
  if (kind === 'text') {
    body = `<style>${BASE_STYLE}body{background:#fffdf6;color:#1d2430;-webkit-app-region:no-drag}pre{margin:0;padding:38px 16px 16px;height:100%;box-sizing:border-box;overflow:auto;white-space:pre-wrap;word-break:break-word;font:15px/1.6 "Segoe UI",Arial,sans-serif;user-select:text}.bar{position:fixed;top:0;left:0;right:0;height:30px;-webkit-app-region:drag;background:#f1e8cf}</style><div class="bar"></div><pre dir="auto">${escapeHtml(text)}</pre>`;
  } else if (kind === 'color') {
    const safe = parseColor(color) || '#cccccc';
    body = `<style>${BASE_STYLE}body{background:${escapeHtml(safe)}}span{position:fixed;bottom:10px;right:12px;padding:3px 10px;border-radius:8px;background:#000a;color:#fff;font:13px Consolas,monospace;direction:ltr}</style><span>${escapeHtml(safe)}</span>`;
  } else {
    body = `<style>${BASE_STYLE}img{width:100%;height:100%;object-fit:contain;display:block}</style><img draggable="false" src="${escapeHtml(dataUrl)}">`;
  }
  return `<!doctype html><meta charset="utf-8">${body}<button title="סגירה (Esc)" onclick="window.close()">×</button>${plus ? PLUS_SCRIPT : ''}`;
}

// New bounds when the wheel zooms a pin: the same centre, the same shape, never smaller than a small handle or
// bigger than the screen.
function zoomedBounds(bounds, factor, area) {
  const ratio = bounds.height / bounds.width;
  const maxWidth = Math.min(area.width, Math.round(area.height / ratio));
  const width = Math.round(Math.min(maxWidth, Math.max(120, bounds.width * factor)));
  const height = Math.round(width * ratio);
  const x = Math.round(Math.min(area.x + area.width - width, Math.max(area.x, bounds.x + bounds.width / 2 - width / 2)));
  const y = Math.round(Math.min(area.y + area.height - height, Math.max(area.y, bounds.y + bounds.height / 2 - height / 2)));
  return { x, y, width, height };
}

const clampOpacity = (value) => Math.round(Math.min(1, Math.max(0.2, value)) * 100) / 100;

module.exports = { classifyClipboard, clampOpacity, escapeHtml, parseColor, pinPage, pinSize, zoomedBounds };
