// Erasing with artificial intelligence, in the studio page: the model (see ai-model.cjs) fills the erased place with what
// fits the picture around it — good where the plain ways cannot help: photos, textures, people. Everything runs on this
// computer. The engine (onnxruntime-web, copied into vendor/ort when the program is built) loads only when first needed.
(() => {
  // The studio page, or the frozen screen (which only uses a model already downloaded).
  const api = window.screenStudio || window.regionApi;
  const MAX_SIDE = 1024; // bigger places are worked on smaller and the result is enlarged back
  let session = null;
  let loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('לא ניתן לטעון את מנוע הבינה המלאכותית'));
      document.head.append(script);
    });
  }

  async function start() {
    if (session) return session;
    if (!loading) {
      loading = (async () => {
        if (!window.ort) await loadScript('vendor/ort/ort.wasm.min.js');
        const ort = window.ort;
        ort.env.wasm.wasmPaths = new URL('vendor/ort/', location.href).href;
        // Several threads need a page isolated from other sites, which a program page is not: one thread then.
        ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
        const bytes = await api.aiModel();
        session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
        return session;
      })().catch((error) => { loading = null; throw error; });
    }
    return loading;
  }

  // image: ImageData-like { width, height, data } (changed in place); mask: 1 = erase.
  async function inpaint(image, mask) {
    const model = await start();
    const ort = window.ort;
    const { width, height } = image;
    const factor = Math.min(1, MAX_SIDE / Math.max(width, height));
    const w = Math.max(8, Math.round(width * factor));
    const h = Math.max(8, Math.round(height * factor));
    // The picture and the mask at the size the model works on.
    const full = document.createElement('canvas');
    full.width = width;
    full.height = height;
    full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data), width, height), 0, 0);
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const smallContext = small.getContext('2d', { willReadFrequently: true });
    smallContext.drawImage(full, 0, 0, w, h);
    const pixels = smallContext.getImageData(0, 0, w, h).data;
    const holes = document.createElement('canvas');
    holes.width = width;
    holes.height = height;
    const holeData = new ImageData(width, height);
    for (let index = 0; index < mask.length; index += 1) if (mask[index]) holeData.data[index * 4 + 3] = 255;
    holes.getContext('2d').putImageData(holeData, 0, 0);
    const smallHoles = document.createElement('canvas');
    smallHoles.width = w;
    smallHoles.height = h;
    const smallHolesContext = smallHoles.getContext('2d', { willReadFrequently: true });
    smallHolesContext.drawImage(holes, 0, 0, w, h);
    const holeAlpha = smallHolesContext.getImageData(0, 0, w, h).data;
    const count = w * h;
    const planes = new Uint8Array(count * 3);
    // For this model 0 marks the place to fill and 255 what stays.
    const keep = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      planes[index] = pixels[index * 4];
      planes[count + index] = pixels[index * 4 + 1];
      planes[count * 2 + index] = pixels[index * 4 + 2];
      keep[index] = holeAlpha[index * 4 + 3] > 0 ? 0 : 255;
    }
    const output = (await model.run({
      [model.inputNames[0]]: new ort.Tensor('uint8', planes, [1, 3, h, w]),
      [model.inputNames[1]]: new ort.Tensor('uint8', keep, [1, 1, h, w])
    }))[model.outputNames[0]].data;
    // Back to full size; only the erased pixels are taken from the result.
    const result = new ImageData(w, h);
    for (let index = 0; index < count; index += 1) {
      result.data[index * 4] = output[index];
      result.data[index * 4 + 1] = output[count + index];
      result.data[index * 4 + 2] = output[count * 2 + index];
      result.data[index * 4 + 3] = 255;
    }
    smallContext.putImageData(result, 0, 0);
    const back = document.createElement('canvas');
    back.width = width;
    back.height = height;
    const backContext = back.getContext('2d', { willReadFrequently: true });
    backContext.imageSmoothingQuality = 'high';
    backContext.drawImage(small, 0, 0, width, height);
    const filled = backContext.getImageData(0, 0, width, height).data;
    for (let index = 0; index < mask.length; index += 1) {
      if (!mask[index]) continue;
      image.data[index * 4] = filled[index * 4];
      image.data[index * 4 + 1] = filled[index * 4 + 1];
      image.data[index * 4 + 2] = filled[index * 4 + 2];
      image.data[index * 4 + 3] = 255;
    }
    return { method: 'ai', hex: '' };
  }

  window.AurumAiErase = {
    status: () => api.aiModelStatus(),
    download: (onProgress) => (api.aiModelDownload ? api.aiModelDownload(onProgress) : Promise.reject(new Error('ההורדה נעשית מהעורך'))),
    inpaint,
    get loaded() { return Boolean(session); }
  };
})();
