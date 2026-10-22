// Automatic capture at a fixed interval: one picture, wait, the next — until the count is reached or it is stopped.
// The wait starts when a capture has finished, so two never overlap. A few failures in a row stop it, with the reason.
class IntervalCapture {
  // capture(index): takes one picture (may be slow). onChange(state): running / count changed. onStop(reason): ended.
  constructor({ capture, onChange = () => {}, onStop = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, maxFailures = 3 } = {}) {
    this.capture = capture;
    this.onChange = onChange;
    this.onStop = onStop;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.maxFailures = maxFailures;
    this.timer = null;
    this.running = false;
    this.taken = 0;
    this.failures = 0;
  }

  get state() { return { running: this.running, taken: this.taken, total: this.total }; }

  start({ seconds = 30, count = 0 } = {}) {
    if (this.running) return false;
    this.running = true;
    this.seconds = Math.max(1, Number(seconds) || 30);
    this.total = Math.max(0, Math.floor(Number(count) || 0));
    this.taken = 0;
    this.failures = 0;
    this.onChange(this.state);
    this.timer = this.setTimer(() => this.tick(), 0);
    return true;
  }

  stop(reason = 'stopped') {
    if (!this.running) return false;
    this.running = false;
    this.clearTimer(this.timer);
    this.timer = null;
    this.onChange(this.state);
    this.onStop(reason, this.taken);
    return true;
  }

  async tick() {
    if (!this.running) return;
    try {
      await this.capture(this.taken);
      this.taken += 1;
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.maxFailures) return this.stop(`failed: ${error.message}`);
    }
    if (!this.running) return;
    this.onChange(this.state);
    if (this.total && this.taken >= this.total) return this.stop('done');
    this.timer = this.setTimer(() => this.tick(), this.seconds * 1000);
  }
}

module.exports = { IntervalCapture };
