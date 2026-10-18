/** Original raster files used as writing references, never fetched by URL. */
import { validateImageSource } from './export.js';

export const SOURCE_IMAGE_LIMITS = Object.freeze({
  maxImages: 50,
  maxBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxPathChars: 2048,
});

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = value => Number.isSafeInteger(value) && value >= 0;
const MIME_BY_EXTENSION = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' });
// The cache lives only as long as each input object. Every relevant primitive
// must still match, so changing a saved image always forces full validation.
const validatedImages = new WeakMap();

function freshValidatedImage(canonical) {
  const result = { ...canonical };
  validatedImages.set(result, { snapshot: canonical, canonical });
  return result;
}

function fail(message, code = 'INVALID_SOURCE_IMAGE') {
  const error = new Error(message);
  error.name = 'SourceImageError';
  error.code = code;
  throw error;
}

export function validateSourceImagePath(value) {
  if (typeof value !== 'string' || !value || value.length > SOURCE_IMAGE_LIMITS.maxPathChars
      || value.startsWith('/') || /^[a-z]:/i.test(value) || /[\\\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/u.test(value)
      || value.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('이미지의 상대 경로가 올바르지 않습니다. 제어 문자, 역슬래시 또는 상위 폴더 이동 표기를 사용할 수 없습니다.', 'UNSAFE_SOURCE_PATH');
  }
  if (!/\.(png|jpe?g|webp)$/i.test(value)) fail('원시 이미지는 PNG, JPEG, WebP 파일만 사용할 수 있습니다.');
  return value;
}

function validateSize(value) {
  if (!whole(value) || value === 0) fail('원시 이미지의 파일 크기가 올바르지 않습니다.');
  if (value > SOURCE_IMAGE_LIMITS.maxBytes) fail('원시 이미지 한 장은 8 MiB 이하여야 합니다.', 'SOURCE_IMAGE_BYTE_LIMIT');
}

/** Validate and sanitize a saved original; MIME labels never override actual bytes. */
export function validateSourceImage(image) {
  if (!isObject(image)) fail('원시 이미지 정보가 올바르지 않습니다.');
  const snapshot = { path: image.path, src: image.src, mimeType: image.mimeType, bytes: image.bytes };
  const cached = validatedImages.get(image);
  if (cached && snapshot.path === cached.snapshot.path && snapshot.src === cached.snapshot.src
      && snapshot.mimeType === cached.snapshot.mimeType && snapshot.bytes === cached.snapshot.bytes) {
    return freshValidatedImage(cached.canonical);
  }
  const path = validateSourceImagePath(snapshot.path);
  validateSize(snapshot.bytes);
  const expectedMime = MIME_BY_EXTENSION[path.split('.').at(-1).toLowerCase()];
  if (snapshot.mimeType !== expectedMime) fail(`원시 이미지의 확장자와 형식이 일치하지 않습니다: ${path}`, 'SOURCE_IMAGE_MIME');
  if (typeof snapshot.src !== 'string'
      || snapshot.src.length > Math.ceil(SOURCE_IMAGE_LIMITS.maxBytes / 3) * 4 + 256) {
    fail('원시 이미지 데이터가 올바르지 않거나 8 MiB를 초과합니다.', 'SOURCE_IMAGE_BYTE_LIMIT');
  }
  const header = snapshot.src.match(/^data:(image\/(?:png|jpeg|webp));base64,/);
  if (!header || header[1] !== expectedMime) fail('원시 이미지에는 형식이 일치하는 PNG, JPEG, WebP 파일 데이터만 사용할 수 있습니다.', 'SOURCE_IMAGE_MIME');
  let src;
  try { src = validateImageSource(snapshot.src); }
  catch { fail(`원시 이미지가 손상되었거나 지원되지 않는 형식입니다: ${path}`, 'SOURCE_IMAGE_CORRUPT'); }
  if (!src.startsWith(`data:${expectedMime};base64,`)) fail(`원시 이미지의 실제 형식과 확장자가 일치하지 않습니다: ${path}`, 'SOURCE_IMAGE_MIME');
  const data = src.slice(src.indexOf(',') + 1);
  const bytes = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  validateSize(bytes);
  if (bytes !== snapshot.bytes) fail(`원시 이미지의 저장된 크기와 실제 데이터가 일치하지 않습니다: ${path}`, 'SOURCE_IMAGE_SIZE');
  const canonical = { path, src, mimeType: expectedMime, bytes };
  validatedImages.set(image, { snapshot, canonical });
  return freshValidatedImage(canonical);
}

/** Validate a collection before it can reach storage or an AI request. */
export function validateSourceImages(images) {
  if (!Array.isArray(images)) fail('원시 이미지 목록 형식이 올바르지 않습니다.');
  if (images.length > SOURCE_IMAGE_LIMITS.maxImages) fail('원시 이미지는 한 번에 최대 50개까지 불러올 수 있습니다.', 'SOURCE_IMAGE_COUNT_LIMIT');
  let totalBytes = 0;
  const seen = new Set();
  // Bound the whole collection before decoding any base64 data.
  for (const image of images) {
    if (!isObject(image)) fail('원시 이미지 정보가 올바르지 않습니다.');
    validateSize(image.bytes);
    totalBytes += image.bytes;
    if (totalBytes > SOURCE_IMAGE_LIMITS.maxTotalBytes) fail('원시 이미지의 합계 크기는 32 MiB 이하여야 합니다.', 'SOURCE_IMAGE_TOTAL_LIMIT');
    const path = validateSourceImagePath(image.path);
    if (seen.has(path)) fail(`원시 이미지에 같은 상대 경로가 두 번 포함되어 있습니다: ${path}`, 'DUPLICATE_SOURCE_PATH');
    seen.add(path);
  }
  return images.map(validateSourceImage);
}
