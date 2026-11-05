// A small local record of how the program starts and ends: when it started, why it closed, which part of it crashed, and
// (through a small "still running" file) whether the previous run ended without closing at all, and when it was last alive.
// No pictures, no file names and no text the user typed. The file never grows past two small files.
// Writes are synchronous on purpose: the last line is written while the program is closing.
const fs = require('node:fs');
const path = require('node:path');

const MAX_SIZE = 256 * 1024;

class AppJournal {
  constructor({ directory, version = '', now = () => new Date() }) {
    this.file = path.join(directory, 'app-journal.log');
    this.marker = path.join(directory, 'app-running.json');
    this.version = version;
    this.now = now;
    this.quitReason = '';
    this.startedAt = null;
    this.ended = false;
    // On the very first run the data folder does not exist yet.
    try { fs.mkdirSync(directory, { recursive: true }); } catch {}
  }

  write(line) {
    try {
      const size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
      if (size > MAX_SIZE) fs.renameSync(this.file, `${this.file}.old`);
      fs.appendFileSync(this.file, `${this.now().toISOString()} ${String(line).slice(0, 500)}\n`, 'utf8');
    } catch {}
  }

  saveMarker() {
    try { fs.writeFileSync(this.marker, JSON.stringify({ startedAt: this.startedAt, seenAt: this.now().toISOString(), version: this.version }), 'utf8'); } catch {}
  }

  // Returns what is known about a previous run that never closed, or null.
  begin({ hidden = false } = {}) {
    let previous = null;
    try { previous = JSON.parse(fs.readFileSync(this.marker, 'utf8')); } catch {}
    if (previous) this.write(`הפעם הקודמת לא נסגרה מסודר: גרסה ${previous.version || 'לא ידועה'}, נראתה פעילה לאחרונה ב־${previous.seenAt || 'לא ידוע'}`);
    this.startedAt = this.now().toISOString();
    this.write(`הפעלה: גרסה ${this.version}${hidden ? ', מוסתרת' : ''}`);
    this.saveMarker();
    return previous;
  }

  // Called every few minutes: after a sudden end, this tells roughly when it happened.
  beat() { if (!this.ended) this.saveMarker(); }

  // Why the program is about to close; the first reason given is the one kept.
  reason(text) { if (!this.quitReason) this.quitReason = String(text); }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.write(`סגירה מסודרת: ${this.quitReason || 'סיבה לא ידועה'}`);
    try { fs.rmSync(this.marker, { force: true }); } catch {}
  }
}

module.exports = { AppJournal, MAX_SIZE };
