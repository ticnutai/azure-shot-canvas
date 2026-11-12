const test = require('node:test');
const assert = require('node:assert/strict');
const { captionsFromWords, normalizeTimelineProject } = require('../src/video-timeline-utils.cjs');

const say = (text, from, each = 0.4, gap = 0.05) => text.split(' ').map((word, index) => ({ word, start: from + index * (each + gap), end: from + index * (each + gap) + each }));

test('captions from speech: short lines, a new one after a sentence or a pause, no word left alone', () => {
  const words = [...say('בסרטון הזה נלמד איך מצלמים את המסך בתוכנה.', 0), ...say('קודם פותחים את הלוח.', 5), ...say('ואחרי הפסקה ממשיכים', 12)];
  const captions = captionsFromWords(words);
  assert.deepEqual(captions.map((caption) => caption.text), ['בסרטון הזה נלמד איך מצלמים את המסך בתוכנה.', 'קודם פותחים את הלוח.', 'ואחרי הפסקה ממשיכים']);
  // Each stays a moment after its last word, and never runs into the next one.
  for (const [index, caption] of captions.entries()) {
    assert.ok(caption.end > caption.start);
    if (captions[index + 1]) assert.ok(caption.end < captions[index + 1].start);
  }
  assert.ok(captions.every((caption) => caption.fromTranscript));
});

test('a long sentence is cut into lines of a few words', () => {
  const captions = captionsFromWords(say('אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר אחת עשרה שתים עשרה שלוש עשרה ארבע עשרה חמש עשרה שש עשרה', 0));
  assert.ok(captions.length >= 2);
  assert.ok(captions.every((caption) => caption.text.split(' ').length <= 9));
});

test('words without a time are passed over, and the timeline keeps where a caption came from', () => {
  assert.deepEqual(captionsFromWords([{ word: 'בלי זמן' }, { word: '', start: 0, end: 1 }]), []);
  const kept = normalizeTimelineProject({ captions: [...captionsFromWords(say('שלום לכולם', 0)), { text: 'ביד', start: 3, end: 4 }] }, 10).captions;
  assert.deepEqual(kept.map((caption) => Boolean(caption.fromTranscript)), [true, false]);
});
