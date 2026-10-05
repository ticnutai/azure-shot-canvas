// Shared finishing steps for a captured image, used by the image editor and by automatic capture settings:
// - beautify: the image on a gradient with padding, rounded corners and a soft shadow (share-ready)
// - redact: solid black boxes burned into the pixels (OCR regions come from the main process)
(() => {
  const BACKGROUNDS = { ocean: ['#2b5876', '#4e4376'], sunset: ['#ee9ca7', '#ffdde1'], slate: ['#e2e8f0', '#94a3b8'] };

  const loadImage = (source) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('טעינת התמונה נכשלה'));
    image.src = source;
  });

  const toPng = async (canvas) => {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return { bytes: await blob.arrayBuffer(), width: canvas.width, height: canvas.height };
  };

  async function beautifyCanvas(dataUrl, style = 'ocean') {
    const image = await loadImage(dataUrl);
    const padding = Math.round(Math.max(image.width, image.height) * 0.06);
    const radius = Math.round(Math.min(image.width, image.height) * 0.025) + 6;
    const canvas = document.createElement('canvas');
    canvas.width = image.width + padding * 2;
    canvas.height = image.height + padding * 2;
    const context = canvas.getContext('2d');
    const [from, to] = BACKGROUNDS[style] || BACKGROUNDS.ocean;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.shadowColor = 'rgba(0, 0, 0, 0.35)';
    context.shadowBlur = padding * 0.6;
    context.shadowOffsetY = padding * 0.15;
    context.beginPath();
    context.roundRect(padding, padding, image.width, image.height, radius);
    context.fillStyle = '#ffffff';
    context.fill();
    context.restore();
    context.save();
    context.beginPath();
    context.roundRect(padding, padding, image.width, image.height, radius);
    context.clip();
    context.drawImage(image, padding, padding);
    context.restore();
    return canvas;
  }

  const beautify = async (dataUrl, style) => toPng(await beautifyCanvas(dataUrl, style));

  // Encodes the finished canvas in the chosen format. PDF pages embed a JPEG (the main process wraps it).
  const ENCODINGS = { png: ['image/png'], jpg: ['image/jpeg', 0.92], webp: ['image/webp', 0.92], pdf: ['image/jpeg', 0.92] };
  async function encode(canvas, format = 'png') {
    const [type, quality] = ENCODINGS[format] || ENCODINGS.png;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    return { bytes: await blob.arrayBuffer(), width: canvas.width, height: canvas.height };
  }

  // Burns black boxes into a copy of the source canvas; the original pixels under them are gone for good.
  function redact(sourceCanvas, regions) {
    const canvas = document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const context = canvas.getContext('2d');
    context.drawImage(sourceCanvas, 0, 0);
    context.fillStyle = '#000000';
    for (const region of regions) context.fillRect(Math.floor(region.left), Math.floor(region.top), Math.ceil(region.width), Math.ceil(region.height));
    return canvas;
  }

  window.aurumImageFinish = { backgrounds: Object.keys(BACKGROUNDS), formats: Object.keys(ENCODINGS), beautify, beautifyCanvas, encode, redact, toPng };
})();
