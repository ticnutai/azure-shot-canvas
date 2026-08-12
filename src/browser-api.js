(() => {
  if (window.screenStudio) return;
  const demoThumbnail = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#071a34"/><rect x="35" y="28" width="250" height="124" rx="10" fill="#102a4b" stroke="#f4bc3f"/><text x="160" y="96" fill="#f4bc3f" font-size="18" text-anchor="middle" font-family="Arial">בחירת מסך בדפדפן</text></svg>')}`;
  const download = (bytes, type, extension) => {
    const blob = new Blob([bytes], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = url; anchor.download = `aurum-${stamp}.${extension}`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { path: anchor.download, converted: false };
  };
  window.screenStudio = {
    browserMode: true, qaEnabled: false,
    listSources: async () => [{ id: 'browser-picker', name: 'בחירה באמצעות הדפדפן', type: 'screen', thumbnail: demoThumbnail }],
    prepareCapture: async () => true,
    saveScreenshot: async (bytes) => download(bytes, 'image/png', 'png'),
    saveRecording: async (bytes) => download(bytes, 'video/webm', 'webm'),
    beginRecordingFile: async () => ({ id: 'browser-recording', path: 'הורדות הדפדפן' }),
    appendRecordingChunk: async (_id, bytes) => ({ bytes: bytes.byteLength || 0, chunks: 1 }),
    finishRecordingFile: async () => ({ path: 'הורדות הדפדפן', converted: false }),
    getStorageStatus: async () => ({ directory: 'הורדות הדפדפן', freeBytes: null, totalBytes: null, level: 'unknown', recovered: 0 }),
    getCursorPosition: async () => ({ point: { x: 0, y: 0 }, displayId: '', bounds: { x: 0, y: 0, width: 1, height: 1 } }),
    listLibrary: async () => [], openFile: async () => '', showFile: async () => '', renameFile: async () => { throw new Error('שינוי שם זמין במצב Electron'); },
    saveLibraryMetadata: async () => ({}), shareLocal: async () => ({ private: true }), editVideo: async () => { throw new Error('עריכת וידאו זמינה במצב Electron'); },
    loadEditorImage: async () => { throw new Error('עריכה מהספרייה זמינה במצב Electron'); },
    saveEditorImage: async () => { throw new Error('שמירת פרויקט עריכה זמינה במצב Electron'); },
    copyEditorImage: async (dataUrl) => navigator.clipboard.write([new ClipboardItem({ 'image/png': await (await fetch(dataUrl)).blob() })]),
    openOutput: async () => '', chooseOutput: async () => 'הורדות הדפדפן', getOutput: async () => 'הורדות הדפדפן',
    getQaStatus: async () => ({ available: false, running: false, report: null, comparisons: [], console: 'QA זמין במצב Electron לפיתוח.' }),
    runQa: async () => { throw new Error('QA זמין במצב Electron לפיתוח'); },
    copyText: async (text) => navigator.clipboard.writeText(String(text)), openQaReport: async () => '',
    getShortcuts: async () => ({ shortcuts: {}, registration: {} }),
    setShortcuts: async (shortcuts) => ({ ok: true, shortcuts, registration: Object.fromEntries(Object.keys(shortcuts).map((key) => [key, true])) }),
    testShortcut: async () => true,
    onQaOutput: () => {}, onShortcut: () => {}
  };
})();
