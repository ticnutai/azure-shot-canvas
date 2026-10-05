// Finds CSS declarations that can never apply: the same property is set again by a LATER rule with the
// identical selector, in the identical @media/@supports context (stylesheet order = <link> order in index.html).
// Such a declaration always loses the cascade, so removing it cannot change rendering.
// Conservative: same-rule duplicates (often deliberate fallbacks) and vendor-prefixed values are left alone,
// and !important is respected. Usage: node scripts/css-dedupe.cjs [--apply]
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '..', 'src');
const apply = process.argv.includes('--apply');

function stylesheetOrder() {
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
}

// Skips a quoted string starting at index; returns the index after the closing quote.
function skipString(text, index) {
  const quote = text[index];
  for (let i = index + 1; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue; }
    if (text[i] === quote) return i + 1;
  }
  return text.length;
}

// Index of the brace that closes the block opened at `open`.
function matchingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' || char === "'") { i = skipString(text, i) - 1; continue; }
    if (char === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; continue; }
    if (char === '{') depth += 1;
    if (char === '}') { depth -= 1; if (depth === 0) return i; }
  }
  throw new Error('unbalanced braces');
}

function parseDeclarations(text, offset) {
  const declarations = [];
  let start = 0;
  let depth = 0;
  const flush = (end) => {
    const raw = text.slice(start, end);
    const colon = raw.indexOf(':');
    if (colon > 0 && raw.trim()) {
      const prop = raw.slice(0, colon).trim().toLowerCase();
      let value = raw.slice(colon + 1).trim();
      const important = /!\s*important\s*$/i.test(value);
      if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
      declarations.push({ prop, value, important, start: offset + start, end: offset + end });
    }
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' || char === "'") { i = skipString(text, i) - 1; continue; }
    if (char === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ';' && depth === 0) { flush(i); start = i + 1; }
  }
  flush(text.length);
  return declarations;
}

function parseRules(text, file, context, offset, out) {
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('/*', i)) { i = text.indexOf('*/', i + 2) + 2; continue; }
    if (/\s/.test(text[i])) { i += 1; continue; }
    const open = text.indexOf('{', i);
    const semicolon = text.indexOf(';', i);
    if (text[i] === '@' && semicolon !== -1 && (open === -1 || semicolon < open)) { i = semicolon + 1; continue; }
    if (open === -1) break;
    const close = matchingBrace(text, open);
    const prelude = text.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const body = text.slice(open + 1, close);
    if (/^@(media|supports|layer|container)\b/i.test(prelude)) {
      parseRules(body, file, `${context}|${prelude.replace(/\s+/g, ' ')}`, offset + open + 1, out);
    } else if (!prelude.startsWith('@')) {
      out.push({ file, context, selector: prelude.replace(/\s+/g, ' '), start: offset + i, end: offset + close + 1, declarations: parseDeclarations(body, offset + open + 1) });
    }
    i = close + 1;
  }
  return out;
}

const order = stylesheetOrder();
const rules = [];
for (const file of order) parseRules(fs.readFileSync(path.join(SRC, file), 'utf8'), file, '', 0, rules);
rules.forEach((rule, index) => { rule.order = index; });

const byKey = new Map();
for (const rule of rules) {
  const key = `${rule.context}§${rule.selector}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(rule);
}

const dead = [];
for (const group of byKey.values()) {
  if (group.length < 2) continue;
  for (let a = 0; a < group.length - 1; a += 1) {
    for (const declaration of group[a].declarations) {
      if (/-webkit-|-moz-|-ms-/.test(declaration.value)) continue;
      const winner = group.slice(a + 1).flatMap((rule) => rule.declarations).find((later) => later.prop === declaration.prop && !/-webkit-|-moz-|-ms-/.test(later.value) && (later.important || !declaration.important));
      if (winner) dead.push({ rule: group[a], declaration, winner });
    }
  }
}

const byFile = new Map();
for (const item of dead) {
  if (!byFile.has(item.rule.file)) byFile.set(item.rule.file, []);
  byFile.get(item.rule.file).push(item);
}
console.log(`stylesheets: ${order.length}, rules: ${rules.length}, never-applied declarations: ${dead.length}`);
for (const [file, items] of byFile) {
  console.log(`\n${file}: ${items.length}`);
  for (const item of items.slice(0, 12)) console.log(`  ${item.rule.selector.slice(0, 60)} { ${item.declaration.prop}: ${item.declaration.value.slice(0, 40)} }`);
  if (items.length > 12) console.log(`  … ${items.length - 12} more`);
}

if (apply) {
  for (const [file, items] of byFile) {
    const full = path.join(SRC, file);
    let text = fs.readFileSync(full, 'utf8');
    const deadSet = new Set(items.map((item) => item.declaration));
    const edits = [];
    for (const rule of rules.filter((candidate) => candidate.file === file)) {
      const removed = rule.declarations.filter((declaration) => deadSet.has(declaration));
      if (!removed.length) continue;
      // A rule left with nothing but dead declarations is removed whole.
      if (removed.length === rule.declarations.length) edits.push({ start: rule.start, end: rule.end });
      else for (const declaration of removed) edits.push({ start: declaration.start, end: text[declaration.end] === ';' ? declaration.end + 1 : declaration.end });
    }
    edits.sort((x, y) => y.start - x.start);
    const before = text.length;
    for (const edit of edits) {
      let { start, end } = edit;
      if (text[end - 1] !== ';' && text[end - 1] !== '}') {
        // Last declaration without a trailing semicolon: also drop the semicolon before it.
        const previous = text.lastIndexOf(';', start);
        if (previous !== -1 && !text.slice(previous + 1, start).trim()) start = previous;
      }
      text = text.slice(0, start) + text.slice(end);
    }
    fs.writeFileSync(full, text, 'utf8');
    console.log(`applied ${file}: ${edits.length} edits, ${before - text.length} bytes removed`);
  }
}
