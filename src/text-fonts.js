// The fonts offered for text on captures, shared by the image editor and the frozen screen. Only fonts this computer
// really has are offered (some Hebrew fonts are an optional part of Windows), and each place remembers its own choice.
(() => {
  const FONTS = [
    ['Segoe UI', 'סגואי'], ['Arial', 'אריאל'], ['David', 'דוד'], ['Miriam', 'מרים'], ['FrankRuehl', 'פרנק רוהל'], ['Gisha', 'גישה'],
    ['Narkisim', 'נרקיסים'], ['Tahoma', 'טהומה'], ['Times New Roman', 'טיימס'], ['Calibri', 'קליברי'], ['Courier New', 'קוריר']
  ];
  const SAMPLE = 'אבגדהו שלום abcdefg 123';
  let found = null;
  // A font that is missing falls back to the general one, so its width is the same as the general font's.
  function available() {
    if (found) return found;
    const context = document.createElement('canvas').getContext('2d');
    const width = (font) => { context.font = `72px ${font}`; return context.measureText(SAMPLE).width; };
    const generals = ['monospace', 'serif', 'sans-serif'].map((general) => [general, width(general)]);
    found = FONTS.filter(([name]) => generals.some(([general, base]) => width(`"${name}", ${general}`) !== base)).map(([name, label]) => ({ name, label }));
    return found;
  }
  function load(key, defaults) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && FONTS.some(([name]) => name === saved.font)) return { font: saved.font, bold: Boolean(saved.bold) };
    } catch {}
    return { ...defaults };
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  window.AurumTextFonts = { available, load, save };
})();
