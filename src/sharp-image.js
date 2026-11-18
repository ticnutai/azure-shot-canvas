// Sharp at every size: a capture tile starts with its small cached thumbnail (fast), and the moment it is shown wider
// than that thumbnail it switches to the original file, so enlarging it — up to full size — never blurs.
// The frame around the picture is what is measured: a 480-wide thumbnail never grows past its own width (max-width),
// so only the original lets the picture fill a bigger frame.
// Used by the captures window and by the floating bar's recent captures.
(() => {
  const THUMBNAIL_WIDTH = 480;
  const watched = new WeakMap(); // frame → { image, full }
  const upgrade = (frame) => {
    const entry = watched.get(frame);
    if (!entry) return;
    const { image, full } = entry;
    if (!full || image.dataset.sharp === 'full') return;
    if (frame.clientWidth * (window.devicePixelRatio || 1) <= THUMBNAIL_WIDTH) return;
    image.dataset.sharp = 'full';
    observer.unobserve(frame);
    const original = new Image();
    original.decoding = 'async';
    // Swapped only once the original is decoded: no blank frame, and a missing file leaves the thumbnail in place.
    original.onload = () => { image.src = full; };
    original.onerror = () => { image.dataset.sharp = 'thumbnail'; };
    original.src = full;
  };
  const observer = new ResizeObserver((entries) => entries.forEach((entry) => upgrade(entry.target)));
  window.aurumSharp = {
    // fullUrl: the original picture (file address). Videos keep their thumbnail.
    watch(image, fullUrl) {
      if (!image || !fullUrl) return;
      const frame = image.parentElement || image;
      watched.set(frame, { image, full: fullUrl });
      image.dataset.sharp = 'thumbnail';
      observer.observe(frame);
    },
    upgradeAll(scope = document) { scope.querySelectorAll('img[data-sharp="thumbnail"]').forEach((image) => upgrade(image.parentElement || image)); }
  };
})();
