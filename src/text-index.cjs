// Text search inside the captures (an extra): the text of every picture is recognised once, in the background, one
// picture at a time with a pause between them, and kept next to the picture. It waits while the computer is busy
// with a recording or a capture, and a picture that fails is skipped (not tried again until the program restarts).
class TextIndexer {
  // pending(): paths still without recognised text, newest first. index(path): recognises and keeps the text.
  // busy(): true while something more important is running. onIndexed(path): a picture is done.
  constructor({ pending, index, busy = () => false, onIndexed = () => {}, pauseMs = 2500, busyMs = 15_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    Object.assign(this, { pending, index, busy, onIndexed, pauseMs, busyMs, setTimer, clearTimer });
    this.active = false;
    this.timer = null;
    this.queue = null;
    this.working = false;
    this.skipped = new Set();
    this.done = 0;
  }

  start(afterMs = 0) {
    if (this.active) return;
    this.active = true;
    this.schedule(afterMs);
  }

  stop() {
    this.active = false;
    this.clearTimer(this.timer);
    this.timer = null;
    this.queue = null;
  }

  // A new picture was saved: look again (once the current one, if any, is finished).
  kick() {
    if (!this.active) return;
    this.queue = null;
    if (!this.working && !this.timer) this.schedule(1500);
  }

  schedule(ms) {
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.step(), ms);
    this.timer?.unref?.();
  }

  async step() {
    this.timer = null;
    if (!this.active || this.working) return;
    if (this.busy()) return this.schedule(this.busyMs);
    this.working = true;
    let path = null;
    try {
      if (!this.queue) this.queue = (await this.pending()).filter((item) => !this.skipped.has(item));
      path = this.queue.shift();
      if (!path) { this.queue = null; return; }
      try {
        await this.index(path);
        this.done += 1;
        this.onIndexed(path);
      } catch { this.skipped.add(path); }
    } catch { this.queue = null; }
    finally { this.working = false; }
    // After a picture: the pause, then the next. With nothing left it rests until the next capture.
    if (this.active && path) this.schedule(this.pauseMs);
  }
}

module.exports = { TextIndexer };
