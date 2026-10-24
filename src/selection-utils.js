// Choosing several captures, the same everywhere (the library, the recent media, the captures window, the bar's
// history): a click on the small box (or Control + click) adds or removes one, Shift + click takes the whole range,
// and one button chooses everything that is shown — pressed again, it clears the choice. Used by plain pages and by
// the tests (CommonJS).
(() => {
  // Everything shown is chosen already -> nothing; otherwise everything shown (anything chosen but hidden by a filter
  // is let go too, so the button never leaves an invisible choice behind).
  function toggleAll(chosen, shown) {
    const all = shown.length > 0 && shown.every((key) => chosen.has(key));
    return new Set(all ? [] : shown);
  }

  function allChosen(chosen, shown) {
    return shown.length > 0 && shown.every((key) => chosen.has(key));
  }

  // The keys from the anchor to the target, in the order they are shown (either direction); just the target when the
  // anchor is not shown any more.
  function rangeOf(shown, anchor, target) {
    const from = shown.indexOf(anchor);
    const to = shown.indexOf(target);
    if (to < 0) return [];
    if (from < 0) return [target];
    return shown.slice(Math.min(from, to), Math.max(from, to) + 1);
  }

  // One click on an item: { chosen, anchor } after it. `adding` (the box or Control) adds or removes one; `range`
  // (Shift) adds everything from the anchor; a plain click with `plainChooses` chooses only this one.
  function clickItem({ chosen, anchor }, shown, key, { adding = false, range = false, plainChooses = false } = {}) {
    const next = new Set(chosen);
    if (range && anchor != null) {
      rangeOf(shown, anchor, key).forEach((item) => next.add(item));
      return { chosen: next, anchor };
    }
    if (adding) {
      if (next.has(key)) next.delete(key); else next.add(key);
      return { chosen: next, anchor: key };
    }
    if (plainChooses) return { chosen: new Set([key]), anchor: key };
    return { chosen: next, anchor };
  }

  // The words of the "choose all" button for the current state.
  const toggleLabel = (chosen, shown) => (allChosen(chosen, shown) ? 'ניקוי הבחירה' : 'בחירת הכל');
  const countLabel = (count) => (count === 1 ? 'פריט אחד נבחר' : `${count} נבחרו`);

  const api = { allChosen, clickItem, countLabel, rangeOf, toggleAll, toggleLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.aurumSelection = api;
})();
