/** Shared, data-only cover settings for the editor and portable exports. */
const DEFAULT_DESIGN = Object.freeze({
  source: 'art', fit: 'cover', position: 'center', overlay: 45,
  textColor: 'light', layout: 'top',
});

const OPTIONS = Object.freeze({
  source: ['art', 'background'], fit: ['cover', 'contain'],
  position: ['top', 'center', 'bottom'], textColor: ['light', 'dark'],
  layout: ['top', 'center', 'bottom'],
});

const PALETTES = Object.freeze({
  sage: Object.freeze({ background: '#e9eee5', ink: '#263c31', accent: '#8b9d81' }),
  ink: Object.freeze({ background: '#1f2b38', ink: '#f4f0e7', accent: '#9faeb8' }),
  sand: Object.freeze({ background: '#f2e7d5', ink: '#584635', accent: '#b99c78' }),
});

function invalidDesign() { throw new Error('표지 설정이 올바르지 않습니다. 배치, 색상, 배경 설정을 확인해 주세요.'); }

/** Unknown or malformed values cannot reach CSS. Strict mode protects imports. */
export function normalizeCoverDesign(value, { strict = false } = {}) {
  if (value === undefined) return { ...DEFAULT_DESIGN };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (strict) invalidDesign();
    return { ...DEFAULT_DESIGN };
  }
  if (strict && Object.keys(value).some(key => !Object.hasOwn(DEFAULT_DESIGN, key))) invalidDesign();
  const design = { ...DEFAULT_DESIGN };
  for (const [key, options] of Object.entries(OPTIONS)) {
    if (!Object.hasOwn(value, key)) continue;
    if (options.includes(value[key])) design[key] = value[key];
    else if (strict) invalidDesign();
  }
  if (Object.hasOwn(value, 'overlay')) {
    if (Number.isInteger(value.overlay) && value.overlay >= 0 && value.overlay <= 80) design.overlay = value.overlay;
    else if (strict) invalidDesign();
  }
  return design;
}

export function validateCoverDesign(value) {
  return normalizeCoverDesign(value, { strict: true });
}

/** Image validation remains at the existing import/preview/export boundary. */
export function getCoverPresentation(project = {}) {
  const design = normalizeCoverDesign(project.coverDesign);
  const primary = design.source === 'background' ? project.coverBackground : project.coverImage;
  const secondary = design.source === 'background' ? project.coverImage : project.coverBackground;
  const image = primary?.src ? primary : secondary?.src ? secondary : null;
  const source = image === primary ? design.source : image === secondary
    ? design.source === 'art' ? 'background' : 'art' : design.source;
  const hasImage = Boolean(image);
  const palette = { ...(Object.hasOwn(PALETTES, project.theme) ? PALETTES[project.theme] : PALETTES.sage) };
  return {
    design, image, source, hasImage, palette,
    ink: hasImage ? design.textColor === 'dark' ? '#17251d' : '#fff' : palette.ink,
    shade: design.textColor === 'dark' ? '#fff' : '#000',
    objectPosition: `center ${design.position}`,
    justifyContent: { top: 'flex-start', center: 'center', bottom: 'flex-end' }[design.layout],
  };
}
