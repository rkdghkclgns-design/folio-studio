/** Safe shared presentation for images, diagrams and reader text emphasis. */
export const MEDIA_ACCENTS = Object.freeze(['none', 'sage', 'blue', 'amber', 'rose']);
const PALETTES = Object.freeze({
  none: Object.freeze({ ink: '#263c31', line: '#46765b', negative: '#967264', border: '#dbe4dc', background: '#fbfcf9' }),
  sage: Object.freeze({ ink: '#244434', line: '#46765b', negative: '#967264', border: '#6c927a', background: '#e9f1e7' }),
  blue: Object.freeze({ ink: '#173e67', line: '#2f6caa', negative: '#996347', border: '#7298be', background: '#e7effa' }),
  amber: Object.freeze({ ink: '#654514', line: '#9a6b17', negative: '#916778', border: '#b49854', background: '#fbf0d2' }),
  rose: Object.freeze({ ink: '#683246', line: '#a34566', negative: '#427c7d', border: '#bb8195', background: '#f8e7ed' }),
});

/** Never interpolate arbitrary CSS or coerce imported strings into layout values. */
export function normalizeMediaPresentation(value) {
  if (value === undefined) return { width: 100, accent: 'none' };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['width', 'accent'].includes(key))) {
    throw new Error('이미지·도표의 크기와 강조 설정이 올바르지 않습니다.');
  }
  const width = value.width === undefined ? 100 : value.width;
  const accent = value.accent === undefined ? 'none' : value.accent;
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 25 || width > 100 || !MEDIA_ACCENTS.includes(accent)) {
    throw new Error('이미지·도표의 너비는 25~100%, 강조색은 제공된 색상만 사용할 수 있습니다.');
  }
  return { width: Math.round(width * 10) / 10, accent };
}

export function mediaAccentPalette(value) {
  return PALETTES[normalizeMediaPresentation(value).accent];
}

/** Attributes contain only validated numbers and enum tokens, including in EPUB XHTML. */
export function mediaPresentationAttributes(value) {
  if (value === undefined) return '';
  const { width, accent } = normalizeMediaPresentation(value);
  return ' data-media-width="' + width + '" data-media-accent="' + accent + '" style="width:' + width + '%;margin-left:auto;margin-right:auto"';
}

export const MEDIA_STYLE_CSS =
  'figure[data-media-width]{max-width:100%;box-sizing:border-box}figure[data-media-width] img{display:block;width:100%;height:auto;object-fit:contain}' +
  Object.entries(PALETTES).filter(([name]) => name !== 'none').map(([name, palette]) =>
    'figure[data-media-accent="' + name + '"]{padding:.85em;border:2px solid ' + palette.border + ';background:' + palette.background + ';color:' + palette.ink + ';border-radius:8px}' +
    'figure[data-media-accent="' + name + '"] figcaption,figure[data-media-accent="' + name + '"] .folio-diagram-title{color:' + palette.ink + '}' +
    'figure[data-media-accent="' + name + '"] .folio-diagram-table thead th,figure[data-media-accent="' + name + '"] .folio-diagram-step{background:' + palette.background + ';color:' + palette.ink + ';border-color:' + palette.border + '}' +
    'mark.folio-text-accent-' + name + '{background:' + palette.background + ';color:' + palette.ink + ';padding:.08em .12em;border-radius:.15em}'
  ).join('');
