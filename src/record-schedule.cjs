// Scheduled recording (an extra): starts at a chosen time and stops by itself after a chosen number of minutes.
// A clock check every few seconds rather than one long timer: a computer that slept past the time does not start a
// recording late and by surprise, it reports the miss. A recording the user started is never stopped from here.
const MINUTE = 60 * 1000;
const WARN_BEFORE = MINUTE;
const LATE_LIMIT = 2 * MINUTE;

function parseTime(text) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text || '').trim());
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

// The next moment this time of day comes, after `from`.
function nextOccurrence(text, from) {
  const time = parseTime(text);
  if (!time) return null;
  const next = new Date(from);
  next.setHours(time.hours, time.minutes, 0, 0);
  if (next.getTime() <= from) next.setDate(next.getDate() + 1);
  return next.getTime();
}

class RecordSchedule {
  // options(): { time, minutes, repeat }. isRecording(): is any recording running. start() / stop(): of a recording.
  // onEvent(name, details): warn, started, stopped, busy, missed, failed, finished-once.
  constructor({ options, isRecording, start, stop, onEvent = () => {}, now = () => Date.now() }) {
    Object.assign(this, { options, isRecording, start, stop, onEvent, now });
    this.nextAt = null;
    this.warned = false;
    this.run = null; // the recording this schedule started: { stopAt, confirmAt, confirmed }
  }

  arm() {
    const { time } = this.options();
    this.nextAt = nextOccurrence(time, this.now());
    this.warned = false;
    return this.nextAt;
  }

  disarm() { this.nextAt = null; this.warned = false; this.run = null; }

  // The recording ended, by any means: what this schedule started is over, so it must not stop a later one.
  recordingEnded() {
    if (!this.run?.confirmed) return;
    this.run = null;
    this.afterRun();
  }

  afterRun() {
    if (this.options().repeat === 'once') {
      this.nextAt = null;
      this.onEvent('finished-once');
    } else this.arm();
  }

  tick() {
    const time = this.now();
    if (this.run) {
      if (!this.run.confirmed) {
        if (this.isRecording()) this.run.confirmed = true;
        else if (time >= this.run.confirmAt) { this.run = null; this.onEvent('failed'); this.afterRun(); }
      } else if (time >= this.run.stopAt) {
        const { minutes } = this.options();
        this.run = null;
        this.stop();
        this.onEvent('stopped', { minutes });
        this.afterRun();
      }
      return;
    }
    if (this.nextAt === null) return;
    if (time >= this.nextAt) {
      const late = time - this.nextAt;
      if (late > LATE_LIMIT) { this.onEvent('missed'); this.afterRun(); return; }
      if (this.isRecording()) { this.onEvent('busy'); this.afterRun(); return; }
      const { minutes } = this.options();
      this.run = { stopAt: time + minutes * MINUTE, confirmAt: time + 30 * 1000, confirmed: false };
      this.start();
      this.onEvent('started', { minutes });
      return;
    }
    if (!this.warned && this.nextAt - time <= WARN_BEFORE) {
      this.warned = true;
      this.onEvent('warn');
    }
  }
}

module.exports = { LATE_LIMIT, RecordSchedule, WARN_BEFORE, nextOccurrence, parseTime };
