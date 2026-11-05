// The drawing window's page: the marks are drawn by the same code as the marks on the frozen screen.
(() => {
  const api = window.liveDraw;
  const { drawShape, isMeaningful } = window.AurumMarkup;
  const board = document.querySelector('#board');
  const context = board.getContext('2d');
  const root = document.documentElement;
  let state = { drawing: false, tool: 'pen', color: '#f13c50' };
  let shapes = [];
  let current = null;
  let painting = false;

  function paint() {
    painting = false;
    const scale = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * scale);
    const height = Math.round(window.innerHeight * scale);
    if (board.width !== width || board.height !== height) { board.width = width; board.height = height; }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const shape of shapes) drawShape(context, shape, { scale });
    if (current) drawShape(context, current, { scale });
    root.dataset.marks = String(shapes.length);
  }
  const schedule = () => { if (!painting) { painting = true; requestAnimationFrame(paint); } };

  const pointOf = (event) => ({ x: event.clientX, y: event.clientY });

  function endMark() {
    if (!current) return;
    if (isMeaningful(current)) shapes.push(current);
    current = null;
    schedule();
  }

  window.addEventListener('pointerdown', (event) => {
    if (!state.drawing || event.button !== 0) return;
    document.body.setPointerCapture?.(event.pointerId);
    const point = pointOf(event);
    current = state.tool === 'pen'
      ? { type: 'pen', color: state.color, points: [point] }
      : { type: state.tool, color: state.color, from: point, to: point };
    schedule();
  });
  window.addEventListener('pointermove', (event) => {
    if (!current) return;
    // The release never arrived (Windows took the pointer away): this is the release, or the mark would follow the mouse.
    if (event.isTrusted && !(event.buttons & 1)) return endMark();
    const point = pointOf(event);
    if (current.type === 'pen') current.points.push(point);
    else current.to = point;
    schedule();
  });
  window.addEventListener('pointerup', endMark);
  window.addEventListener('pointercancel', endMark);
  window.addEventListener('blur', endMark);
  window.addEventListener('resize', schedule);

  api.onState((next) => {
    state = next;
    document.body.dataset.drawing = String(Boolean(state.drawing));
    root.dataset.tool = state.tool;
    root.dataset.color = state.color;
    if (!state.drawing) endMark();
  });
  api.onCommand((name) => {
    if (name === 'undo') shapes.pop();
    if (name === 'clear') shapes = [];
    current = null;
    schedule();
  });
  root.dataset.ready = 'true';
  schedule();
  api.ready();
})();
