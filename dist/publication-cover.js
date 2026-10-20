/** Local marketing-cover export. No remote image fetches or paid generation. */
import { getCoverPresentation } from './cover.js';
import { validateImageSource } from './export.js';

export const COVER_PROFILES = Object.freeze({
  kdp: { label: 'Amazon KDP 권장', width: 1600, height: 2560, source: 'https://kdp.amazon.com/en_US/help/topic/G200645690' },
  domestic: { label: '국내 유통 준비용 · 규격 직접 확인', width: 1600, height: 2400, source: 'https://help.upaper.kr/' },
  direct: { label: '웹 배포용', width: 1600, height: 2400, source: '' },
});
const MAX_BYTES = 12 * 1024 * 1024;
export function coverSettings(metadata = {}) {
  const channel = Object.hasOwn(COVER_PROFILES, metadata.channel) ? metadata.channel : 'domestic';
  const profile = COVER_PROFILES[channel];
  const width = channel === 'kdp' ? profile.width : Number(metadata.coverWidth || profile.width);
  const height = channel === 'kdp' ? profile.height : Number(metadata.coverHeight || profile.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 625 || height < 1000 || width > 4096 || height > 4096 || height <= width) throw new Error('표지는 가로 625~4096px, 세로 1000~4096px의 세로형으로 설정하세요.');
  return { channel, width, height, label: profile.label, source: profile.source };
}
export function coverFingerprint(project, metadata = {}) {
  const settings = coverSettings(metadata);
  const text = JSON.stringify([project.title, project.subtitle, project.author, project.theme, project.coverImage, project.coverBackground, project.coverDesign, metadata.publisher, settings]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return 'cover-v1-' + (hash >>> 0).toString(16) + '-' + text.length;
}
const b64 = bytes => { let value = ''; for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(value); };
/** Dimensions/components come from the JPEG frame, never from caller declarations. */
export function inspectCoverJPEG(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20 || bytes.length > MAX_BYTES || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('표지는 12MB 이하의 유효한 JPEG 파일이어야 합니다.');
  validateImageSource('data:image/jpeg;base64,' + b64(bytes));
  for (let i = 2; i + 4 < bytes.length;) {
    if (bytes[i++] !== 255) throw new Error('JPEG 표지 데이터가 손상되었습니다.');
    while (bytes[i] === 255) i++;
    const marker = bytes[i++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2 || i + length > bytes.length) throw new Error('JPEG 표지 데이터가 손상되었습니다.');
    if ([192, 193, 194].includes(marker)) return { width: (bytes[i + 5] << 8) | bytes[i + 6], height: (bytes[i + 3] << 8) | bytes[i + 4], components: bytes[i + 7], bytes: bytes.length, mime: 'image/jpeg' };
    i += length;
  }
  throw new Error('표지의 JPEG 크기를 확인할 수 없습니다.');
}
export function validatePreparedCover(cover, project, metadata = {}) {
  const settings = coverSettings(metadata);
  if (!cover || cover.fingerprint !== coverFingerprint(project, metadata)) throw new Error('표지 또는 도서정보가 변경되었습니다. JPG 표지를 다시 생성하세요.');
  const facts = inspectCoverJPEG(cover.bytes);
  if (facts.width !== settings.width || facts.height !== settings.height || facts.components !== 3) throw new Error('표지는 설정한 크기의 RGB JPEG여야 합니다. 다시 생성하세요.');
  return { ...facts, channel: settings.channel, fingerprint: cover.fingerprint, policyCheckedAt: '2026-10-20', source: settings.source, warnings: Array.isArray(cover.warnings) ? cover.warnings.filter(x => typeof x === 'string').slice(0, 5).map(x => x.slice(0, 500)) : [], scope: settings.channel === 'domestic' ? 'Folio 준비 규격. 제출할 유통사의 규격은 별도 확인.' : '픽셀·형식·용량 검사. 권리·시각적 품질·유통 승인 검사는 별도.' };
}
function linesFor(ctx, value, maxWidth) {
  const lines = []; let line = '';
  for (const c of Array.from(String(value || ''))) {
    if (c === '\n') { lines.push(line); line = ''; continue; }
    if (line && ctx.measureText(line + c).width > maxWidth) { lines.push(line); line = c; } else line += c;
  }
  if (line) lines.push(line);
  return lines;
}
function loadImage(src, window) {
  const safeSource = validateImageSource(src);
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const timeout = window.setTimeout(() => { img.onload = img.onerror = null; img.src = ''; reject(new Error('표지 이미지를 읽는 시간이 초과되었습니다. 다시 시도하세요.')); }, 15000);
    img.onload = () => { window.clearTimeout(timeout); resolve(img); };
    img.onerror = () => { window.clearTimeout(timeout); reject(new Error('표지 이미지를 읽을 수 없습니다. 이미지를 다시 등록하세요.')); };
    img.src = safeSource;
  });
}
export async function createPublicationCover(project, metadata = {}, { document: doc = globalThis.document } = {}) {
  if (!doc?.createElement || !doc.defaultView?.Image) throw new Error('JPG 표지 생성은 브라우저에서 실행하세요.');
  const settings = coverSettings(metadata), { width, height } = settings;
  const presentation = getCoverPresentation(project), { design, palette, ink, shade } = presentation;
  if (doc.fonts?.ready) await doc.fonts.ready;
  const canvas = doc.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
  if (!ctx) throw new Error('브라우저에서 표지 이미지를 만들 수 없습니다.');
  ctx.fillStyle = palette.background; ctx.fillRect(0, 0, width, height);
  const warnings = [];
  if (presentation.image) {
    const image = await loadImage(presentation.image.src, doc.defaultView);
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50000000) throw new Error('표지 이미지 해상도가 올바르지 않습니다.');
    const scale = (design.fit === 'contain' ? Math.min : Math.max)(width / image.naturalWidth, height / image.naturalHeight);
    const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
    const dy = design.position === 'top' ? 0 : design.position === 'bottom' ? height - dh : (height - dh) / 2;
    ctx.drawImage(image, (width - dw) / 2, dy, dw, dh);
    ctx.fillStyle = shade; ctx.globalAlpha = design.overlay / 100; ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 1;
    if (/^data:image\/(?:png|jpeg|jpg|webp)/i.test(presentation.image.src) && scale > 1.25) warnings.push('원본 이미지를 확대했습니다. 작은 글씨와 이미지 선명도를 직접 확인하세요.');
  } else {
    ctx.strokeStyle = palette.accent; ctx.lineWidth = Math.max(1, width / 1000); ctx.globalAlpha = .45;
    for (const ratio of [.24, .31]) { ctx.beginPath(); ctx.arc(width * .93, height * .09, width * ratio, 0, Math.PI * 2); ctx.stroke(); } ctx.globalAlpha = 1;
  }
  ctx.fillStyle = ink; ctx.textBaseline = 'top';
  const margin = width * .085, contentWidth = width - margin * 2;
  let titleSize = width * .08, subtitleSize, titleLines, subtitleLines, totalHeight;
  do {
    ctx.font = '500 ' + titleSize + 'px Georgia, "Noto Serif KR", serif'; titleLines = linesFor(ctx, String(project.title || '').slice(0, 1000), contentWidth);
    subtitleSize = Math.max(width * .018, titleSize * .39); ctx.font = subtitleSize + 'px "Noto Sans KR", sans-serif'; subtitleLines = linesFor(ctx, String(project.subtitle || '').slice(0, 1000), contentWidth);
    totalHeight = titleLines.length * titleSize * 1.4 + (subtitleLines.length ? height * .025 + subtitleLines.length * subtitleSize * 1.5 : 0);
    if (totalHeight <= height * .55) break;
    titleSize -= width * .003;
  } while (titleSize >= width * .018);
  if (totalHeight > height * .55) throw new Error('표지에 제목과 부제를 모두 담을 수 없습니다. 제목 또는 부제를 줄여 주세요.');
  let y = height * .19 + (design.layout === 'center' ? (height * .55 - totalHeight) / 2 : design.layout === 'bottom' ? height * .55 - totalHeight : 0);
  ctx.font = '500 ' + titleSize + 'px Georgia, "Noto Serif KR", serif';
  for (const line of titleLines) { ctx.fillText(line, margin, y); y += titleSize * 1.4; }
  y += height * .025; ctx.font = subtitleSize + 'px "Noto Sans KR", sans-serif';
  for (const line of subtitleLines) { ctx.fillText(line, margin, y); y += subtitleSize * 1.5; }
  for (const [value, baseY, maxHeight] of [[project.author, height * .85, height * .07], [metadata.publisher, height * .95, height * .035]]) {
    let size = width * .025, lines;
    do { ctx.font = size + 'px "Noto Sans KR", sans-serif'; lines = linesFor(ctx, value, contentWidth); if (lines.length * size * 1.35 <= maxHeight) break; size -= width * .001; } while (size >= width * .009);
    if (lines.length * size * 1.35 > maxHeight) throw new Error('표지 저자명 또는 발행처가 너무 깁니다.');
    lines.forEach((line, i) => ctx.fillText(line, margin, baseY + i * size * 1.35));
  }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .94));
  if (!blob || blob.type !== 'image/jpeg' || blob.size > MAX_BYTES) throw new Error('12MB 이하의 JPEG 표지를 만들 수 없습니다. 크기를 줄여 주세요.');
  const cover = { bytes: new Uint8Array(await blob.arrayBuffer()), fingerprint: coverFingerprint(project, metadata), warnings };
  cover.report = validatePreparedCover(cover, project, metadata);
  return cover;
}
