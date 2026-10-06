// One consistent line-icon set for the whole studio window (24×24 grid, 1.75 stroke, round joins — like Fluent / Office).
// The markup keeps short symbol characters (easy to read in the HTML); this file swaps each one for its drawn icon,
// also in text the renderer writes later. Characters used as plain text (✓ ● ○ ▶ ★ ← ≥ ≤) are never touched.
(() => {
  const PATHS = {
    record: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.2-1-1.5-1-2.6 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.1"/><circle cx="10" cy="7" r="1.1"/><circle cx="14.5" cy="7" r="1.1"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    library: '<rect x="3.5" y="4" width="4" height="16" rx="1"/><rect x="9.5" y="4" width="4" height="16" rx="1"/><path d="M15.6 5.4l3.7-1 3 14.7-3.7 1z"/>',
    apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><path d="M16.75 13.5v6.5M13.5 16.75H20"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
    camera: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3"/>',
    monitor: '<rect x="3" y="4" width="18" height="12.5" rx="1.8"/><path d="M8.5 20h7M12 16.5V20"/>',
    window: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9h18"/><path d="M6 6.8h.01M8.5 6.8h.01" stroke-width="2.2"/>',
    tab: '<path d="M3 19V7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9z"/>',
    document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4.5v4.3h-4.3"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4.5v4.3h4.3"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    chevronUp: '<path d="M6 15l6-6 6 6"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    crop: '<path d="M6 2.5V18h15.5"/><path d="M2.5 6H18v15.5"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    cursor: '<path d="M5.5 3.5v15l4-4 2.8 6 2.4-1.1-2.8-5.9h5.6z"/>',
    share: '<path d="M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6"/><path d="M12 15V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/>',
    folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
    pin: '<path d="M9 4h6l-1 5 4 4H6l4-4z"/><path d="M12 13v7"/>',
    sort: '<path d="M8 4v16M4.5 7.5L8 4l3.5 3.5M16 20V4M12.5 16.5L16 20l3.5-3.5"/>',
    spotlight: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/>',
    textScan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8.5 9h7M12 9v7"/>',
    captions: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 11h4M13 11h4M7 15h6"/>',
    gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 9.5h5v5h-5zM9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
    drive: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13l2.5-8h9L19 13"/><path d="M17 16.5h.01" stroke-width="2.4"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    play: '<path d="M7 4.5v15l12.5-7.5z"/>',
    maximize: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    arrow: '<path d="M5 19L19 5"/><path d="M10.5 5H19v8.5"/>',
    doubleArrow: '<path d="M3.5 12h17"/><path d="M7.5 8l-4 4 4 4M16.5 8l4 4-4 4"/>',
    line: '<path d="M5 19L19 5"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="7"/>',
    polygon: '<path d="M12 3l8 5.5-3 10H7l-3-10z"/>',
    counter: '<circle cx="12" cy="12" r="8.5"/><path d="M10.5 9l2-1.3v8.8"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
    blur: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2 2.6"/><circle cx="12" cy="12" r="4.2"/>',
    redact: '<rect x="3.5" y="8" width="17" height="8" rx="1.5" fill="currentColor"/>',
    smartRedact: '<rect x="3.5" y="10" width="11" height="6" rx="1.2" fill="currentColor"/><path d="M18 3.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    scissors: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8 8l12 10M8 16L20 6"/>',
    waveform: '<path d="M3 12h1.5M7 8v8M11 5v14M15 9v6M19 11v2"/>',
    more: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><path d="M7.5 7.5h.01" stroke-width="3"/>',
    rename: '<path d="M4 20h16"/><path d="M6 16l9-9 3 3-9 9H6z"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 17h.01" stroke-width="2.4"/>',
    scrollDown: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M12 8v7M9 12l3 3 3-3"/>'
  };

  // Symbol character in the markup → icon. Two-character keys come first.
  const GLYPHS = {
    '██': 'redact', '◉': 'record', '◐': 'palette', '◍': 'eye', '◌': 'eyeOff', '✎': 'pencil', '▥': 'library', '✣': 'apps',
    '☷': 'sliders', '⚙': 'sliders', '⌕': 'search', '♧': 'bell', '▦': 'grid', '▣': 'image', '◘': 'camera', '▰': 'monitor',
    '▤': 'window', '▭': 'tab', '▯': 'document', '↻': 'refresh', '↺': 'reset', '↶': 'undo', '↷': 'redo', '◷': 'clock',
    '▴': 'chevronUp', '▾': 'chevronDown', '⌗': 'crop', '↗': 'external', '♩': 'mic', '⌁': 'cursor', '⇪': 'share',
    '⌑': 'folder', '⊼': 'pin', '⇅': 'sort', '◎': 'spotlight', '¶': 'textScan', '◫': 'captions', '◴': 'gauge', '⚡': 'chip',
    '▱': 'drive', '⧉': 'copy', '⌫': 'trash', '▷': 'play', '⛶': 'maximize', '✦': 'sparkle', '⌖': 'cursor', '➜': 'arrow',
    '↔': 'doubleArrow', '╱': 'line', '⬭': 'ellipse', '⬡': 'polygon', '①': 'counter', '□': 'rect', '▧': 'blur',
    '✱': 'smartRedact', '⚑': 'flag', '✂': 'scissors', '≋': 'waveform', '⇣': 'scrollDown', '⍰': 'help'
  };
  const pattern = new RegExp(`(${Object.keys(GLYPHS).sort((a, b) => b.length - a.length).join('|')})[ \\u00a0]?`, 'u');
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'PRE', 'CODE', 'svg', 'TITLE']);

  function iconElement(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `ui-icon glyph-icon icon-${name}`);
    svg.innerHTML = PATHS[name];
    return svg;
  }

  function convertText(node) {
    let current = node;
    for (let guard = 0; guard < 8; guard += 1) {
      const match = pattern.exec(current.data);
      if (!match) return;
      const after = current.splitText(match.index);
      const rest = after.splitText(match[0].length);
      const icon = iconElement(GLYPHS[match[1]]);
      // Spacing only where the icon sits beside a label (icon-only buttons stay centred).
      const labelAfter = rest.data.trim() || rest.nextSibling?.textContent?.trim();
      const labelBefore = current.data.trim() || current.previousSibling?.textContent?.trim();
      if (labelAfter) icon.classList.add('icon-before-label');
      else if (labelBefore) icon.classList.add('icon-after-label');
      after.replaceWith(icon);
      current = rest;
    }
  }

  function convert(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement && !root.parentElement.closest('pre, textarea, select, svg, .workflow-log, #toast') && pattern.test(root.data)) convertText(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has(root.nodeName) || root.closest?.('pre, textarea, select, svg, .workflow-log, #toast')) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (text) => (SKIP.has(text.parentNode.nodeName) || text.parentElement.closest('pre, select, svg, .workflow-log, #toast') || !pattern.test(text.data) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const found = [];
    while (walker.nextNode()) found.push(walker.currentNode);
    found.forEach(convertText);
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') convert(record.target);
      else record.addedNodes.forEach(convert);
    }
  });

  function start() {
    convert(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  window.aurumIcons = { names: Object.keys(PATHS), element: iconElement, markup: (name) => iconElement(name).outerHTML, convert };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
