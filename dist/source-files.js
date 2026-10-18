/** Local Markdown collection. File contents never leave this module's caller. */
import { SOURCE_IMAGE_LIMITS, validateSourceImage, validateSourceImagePath } from './source-images.js';
export const SOURCE_FILE_LIMITS = Object.freeze({
  maxFiles: 500,
  maxBytes: 1024 * 1024,
  maxChars: 120000,
  maxPathChars: 2048,
});

export class SourceFilesError extends Error {
  constructor(message, code = 'INVALID_SOURCE_FILES') {
    super(message);
    this.name = 'SourceFilesError';
    this.code = code;
  }
}

const fail = (message, code) => { throw new SourceFilesError(message, code); };
const encoder = new TextEncoder();
const decoder = () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = value => Number.isSafeInteger(value) && value >= 0;
const markdownPath = value => /\.(md|markdown)$/i.test(value);

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('파일 불러오기를 취소했습니다.', 'AbortError');
}

function validatePath(value) {
  if (typeof value !== 'string' || !value || value.length > SOURCE_FILE_LIMITS.maxPathChars
      || value.startsWith('/') || /^[a-z]:/i.test(value) || /[\\\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/u.test(value)
      || value.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('파일의 상대 경로가 올바르지 않습니다. 경로에 제어 문자, 역슬래시 또는 상위 폴더 이동 표기를 사용할 수 없습니다.', 'UNSAFE_SOURCE_PATH');
  }
  if (!markdownPath(value)) fail('원시 자료에는 .md 또는 .markdown 파일만 사용할 수 있습니다.');
  return value;
}

// Numeric components sort naturally (2 before 10), with a binary tie-breaker.
// Avoid locale-dependent collation so a saved manifest is portable.
function comparePaths(left, right) {
  const a = left.split(/(\d+)/u), b = right.split(/(\d+)/u);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] === b[index]) continue;
    if (index % 2) {
      const x = a[index].replace(/^0+(?=\d)/u, ''), y = b[index].replace(/^0+(?=\d)/u, '');
      if (x.length !== y.length) return x.length - y.length;
      if (x !== y) return x < y ? -1 : 1;
      if (a[index].length !== b[index].length) return a[index].length - b[index].length;
    } else return a[index] < b[index] ? -1 : 1;
  }
  return a.length - b.length || (left < right ? -1 : left > right ? 1 : 0);
}

function escapePath(path) {
  return path.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~\-])/gu, '\\$1');
}

function boundary(path) {
  return `\n\n---\n\n원본 경로: ${escapePath(path)}\n\n`;
}

function limitError(kind) {
  if (kind === 'files') fail('Markdown 파일은 한 번에 최대 500개까지 불러올 수 있습니다. 폴더를 나누어 선택해 주세요.', 'SOURCE_FILE_LIMIT');
  if (kind === 'bytes') fail('Markdown 파일의 합계 크기는 1 MiB 이하여야 합니다. 파일을 나누어 선택해 주세요.', 'SOURCE_BYTE_LIMIT');
  fail('경로 안내를 포함한 원시 Markdown은 120,000자 이하여야 합니다. 파일을 나누어 선택해 주세요. 내용은 잘라서 저장하지 않습니다.', 'SOURCE_CHAR_LIMIT');
}

async function readBytes(file, signal) {
  checkAbort(signal);
  if (typeof file.arrayBuffer !== 'function') fail('이 브라우저에서 파일을 읽을 수 없습니다. 최신 브라우저에서 다시 시도해 주세요.', 'SOURCE_READ_FAILED');
  // File.arrayBuffer itself cannot be cancelled. Settle immediately on abort,
  // consume any late rejection, and never expose a partially read collection.
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new DOMException('파일 불러오기를 취소했습니다.', 'AbortError'));
    signal?.addEventListener('abort', aborted, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', aborted);
    Promise.resolve().then(() => { checkAbort(signal); return file.arrayBuffer(); }).then(
      value => { cleanup(); try { checkAbort(signal); resolve(value); } catch (error) { reject(error); } },
      error => { cleanup(); reject(error); },
    );
  });
}

function folderFor(entries) {
  if (!entries.every(entry => entry.relative && entry.path.includes('/'))) return '';
  const folder = entries[0].path.split('/')[0];
  return entries.every(entry => entry.path.startsWith(`${folder}/`)) ? folder : '';
}

function collectionName(folderName, files) {
  const suffix = ` · MD ${files.length}개`;
  if (folderName) {
    const label = Array.from(folderName).slice(0, 100).join('');
    return `${label}${label.length < folderName.length ? '…' : ''}${suffix}`;
  }
  if (files.length === 1 && files[0].path.length <= 255) return files[0].path;
  return `MD 파일 ${files.length}개`;
}

/** Read all Markdown descendants delivered by a directory picker, atomically. */
export async function readMarkdownFiles(files, { signal, onProgress, allowEmpty = false } = {}) {
  checkAbort(signal);
  let selected;
  try { selected = Array.from(files ?? []); } catch { fail('선택한 파일 목록을 읽을 수 없습니다.'); }
  const entries = [];
  let ignoredCount = 0, totalBytes = 0;
  const seen = new Set();
  for (const file of selected) {
    if (!file || typeof file.name !== 'string') fail('선택한 파일 정보를 읽을 수 없습니다.');
    const relative = typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.length > 0;
    const path = relative ? file.webkitRelativePath : file.name;
    if (!markdownPath(path)) { ignoredCount++; continue; }
    validatePath(path);
    if (seen.has(path)) fail(`같은 상대 경로가 두 번 선택되었습니다: ${path}`, 'DUPLICATE_SOURCE_PATH');
    seen.add(path);
    const size = file.size;
    if (!whole(size)) fail(`파일 크기를 확인할 수 없습니다: ${path}`, 'SOURCE_READ_FAILED');
    totalBytes += size;
    if (totalBytes > SOURCE_FILE_LIMITS.maxBytes) limitError('bytes');
    entries.push({ file, path, relative, size });
    if (entries.length > SOURCE_FILE_LIMITS.maxFiles) limitError('files');
  }
  if (!entries.length) fail('선택한 폴더나 파일에 .md 또는 .markdown 자료가 없습니다.', 'NO_MARKDOWN_FILES');
  entries.sort((a, b) => comparePaths(a.path, b.path));
  const folderName = folderFor(entries);
  let sourceMarkdown = '', meaningful = false;
  const manifestFiles = [];
  onProgress?.({ completed: 0, total: entries.length, path: '' });
  for (const { file, path, size } of entries) {
    checkAbort(signal);
    let buffer;
    try { buffer = await readBytes(file, signal); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      fail(`파일을 읽지 못했습니다. 다시 선택해 주세요: ${path}`, 'SOURCE_READ_FAILED');
    }
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== size) {
      fail(`파일을 완전히 읽지 못했습니다. 다시 선택해 주세요: ${path}`, 'SOURCE_READ_FAILED');
    }
    let content;
    try { content = decoder().decode(buffer); }
    catch { fail(`UTF-8로 저장된 Markdown 파일이 아닙니다. UTF-8로 다시 저장해 주세요: ${path}`, 'SOURCE_ENCODING'); }
    if (content.includes('\u0000')) fail(`텍스트가 아닌 데이터가 포함되어 있습니다: ${path}`, 'SOURCE_ENCODING');
    const prefix = boundary(path);
    if (sourceMarkdown.length + prefix.length + content.length > SOURCE_FILE_LIMITS.maxChars) limitError('chars');
    const start = sourceMarkdown.length + prefix.length;
    sourceMarkdown += prefix + content;
    manifestFiles.push({ path, chars: content.length, bytes: size, start, end: sourceMarkdown.length });
    meaningful ||= Boolean(content.trim());
    onProgress?.({ completed: manifestFiles.length, total: entries.length, path });
  }
  checkAbort(signal);
  if (!meaningful && !allowEmpty) fail('선택한 Markdown 파일에 원고 내용이 없습니다. 내용이 있는 파일을 선택해 주세요.', 'EMPTY_MARKDOWN_FILES');
  return { sourceMarkdown, sourceName: collectionName(folderName, manifestFiles), files: manifestFiles, ignoredCount, folderName };
}

/** Validate a saved collection without trusting its paths, offsets or counts. */
export function validateSourceManifest(manifest, sourceMarkdown, { allowEmpty = false } = {}) {
  if (!isObject(manifest) || !Array.isArray(manifest.files) || !manifest.files.length
      || !whole(manifest.ignoredCount) || typeof manifest.folderName !== 'string'
      || typeof sourceMarkdown !== 'string') fail('원시 파일 목록 형식이 올바르지 않습니다.');
  if (sourceMarkdown.length > SOURCE_FILE_LIMITS.maxChars) limitError('chars');
  if (manifest.files.length > SOURCE_FILE_LIMITS.maxFiles) limitError('files');
  const files = [], seen = new Set();
  let totalBytes = 0, end = 0, previousPath = '', meaningful = false;
  for (const entry of manifest.files) {
    if (!isObject(entry)) fail('원시 파일 목록 형식이 올바르지 않습니다.');
    const path = validatePath(entry.path);
    if (seen.has(path)) fail('원시 파일 목록에 중복된 경로가 있습니다.', 'DUPLICATE_SOURCE_PATH');
    if (files.length && comparePaths(previousPath, path) >= 0) fail('원시 파일 목록의 경로 순서가 올바르지 않습니다.');
    seen.add(path);
    if (![entry.chars, entry.bytes, entry.start, entry.end].every(whole)
        || entry.end > sourceMarkdown.length || entry.start > entry.end || entry.end - entry.start !== entry.chars
        || entry.start !== end + boundary(path).length || sourceMarkdown.slice(end, entry.start) !== boundary(path)) {
      fail('원시 파일 목록과 원문 범위가 일치하지 않습니다.');
    }
    const content = sourceMarkdown.slice(entry.start, entry.end), bytes = encoder.encode(content);
    if (bytes.length !== entry.bytes || decoder().decode(bytes) !== content || content.includes('\u0000')) {
      fail('원시 파일 목록과 원문의 UTF-8 크기가 일치하지 않습니다.');
    }
    totalBytes += entry.bytes;
    if (totalBytes > SOURCE_FILE_LIMITS.maxBytes) limitError('bytes');
    files.push({ path, chars: entry.chars, bytes: entry.bytes, start: entry.start, end: entry.end });
    previousPath = path;
    end = entry.end;
    meaningful ||= Boolean(content.trim());
  }
  if (end !== sourceMarkdown.length || (!meaningful && !allowEmpty)) fail('원시 파일 목록과 원문 내용이 일치하지 않습니다.');
  if (manifest.folderName && (manifest.folderName.includes('/') || !files.every(file => file.path.startsWith(`${manifest.folderName}/`)))) {
    fail('원시 파일 목록의 폴더 이름이 일치하지 않습니다.');
  }
  return { files, ignoredCount: manifest.ignoredCount, folderName: manifest.folderName };
}

function rasterMime(path) {
  const extension = path.split('.').at(-1).toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' })[extension];
}

function sourceDataURL(buffer, mimeType) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunk conversion avoids a call-stack overflow for large original images.
  for (let index = 0; index < bytes.length; index += 32768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function mixedCollectionName(folderName, files, images) {
  if (!images.length) return collectionName(folderName, files);
  const counts = [files.length ? `MD ${files.length}개` : '', `이미지 ${images.length}개`].filter(Boolean).join(' · ');
  if (folderName) {
    const label = Array.from(folderName).slice(0, 100).join('');
    return `${label}${label.length < folderName.length ? '…' : ''} · ${counts}`;
  }
  if (!files.length && images.length === 1 && images[0].path.length <= 255) return images[0].path;
  return counts;
}

/** Read every supported Markdown and raster descendant as one atomic collection. */
export async function readSourceFiles(files, { signal, onProgress } = {}) {
  checkAbort(signal);
  let selected;
  try { selected = Array.from(files ?? []); } catch { fail('선택한 파일 목록을 읽을 수 없습니다.'); }
  const entries = [], seen = new Set();
  let ignoredCount = 0, markdownBytes = 0, imageBytes = 0, markdownCount = 0, imageCount = 0;
  for (const file of selected) {
    if (!file || typeof file.name !== 'string') fail('선택한 파일 정보를 읽을 수 없습니다.');
    const relative = typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.length > 0;
    const path = relative ? file.webkitRelativePath : file.name;
    const markdown = markdownPath(path), image = /\.(png|jpe?g|webp)$/i.test(path);
    if (!markdown && !image) { ignoredCount++; continue; }
    if (markdown) validatePath(path); else validateSourceImagePath(path);
    if (seen.has(path)) fail(`같은 상대 경로가 두 번 선택되었습니다: ${path}`, 'DUPLICATE_SOURCE_PATH');
    seen.add(path);
    const size = file.size;
    if (!whole(size)) fail(`파일 크기를 확인할 수 없습니다: ${path}`, 'SOURCE_READ_FAILED');
    if (markdown) {
      markdownBytes += size;
      if (++markdownCount > SOURCE_FILE_LIMITS.maxFiles) limitError('files');
      if (markdownBytes > SOURCE_FILE_LIMITS.maxBytes) limitError('bytes');
    } else {
      if (++imageCount > SOURCE_IMAGE_LIMITS.maxImages) fail('원시 이미지는 한 번에 최대 50개까지 불러올 수 있습니다.', 'SOURCE_IMAGE_COUNT_LIMIT');
      if (!size) fail(`이미지 파일이 비어 있습니다: ${path}`, 'SOURCE_IMAGE_CORRUPT');
      if (size > SOURCE_IMAGE_LIMITS.maxBytes) fail('원시 이미지 한 장은 8 MiB 이하여야 합니다.', 'SOURCE_IMAGE_BYTE_LIMIT');
      imageBytes += size;
      if (imageBytes > SOURCE_IMAGE_LIMITS.maxTotalBytes) fail('원시 이미지의 합계 크기는 32 MiB 이하여야 합니다.', 'SOURCE_IMAGE_TOTAL_LIMIT');
      if (file.type && String(file.type).toLowerCase() !== rasterMime(path)) fail(`이미지 파일의 확장자와 형식이 일치하지 않습니다: ${path}`, 'SOURCE_IMAGE_MIME');
    }
    entries.push({ file, path, relative, size, markdown });
  }
  if (!entries.length) fail('선택한 폴더나 파일에 Markdown 또는 PNG·JPEG·WebP 이미지 자료가 없습니다.', 'NO_SOURCE_FILES');
  entries.sort((a, b) => comparePaths(a.path, b.path));
  const folderName = folderFor(entries), manifestFiles = [], sourceImages = [];
  let sourceMarkdown = '', meaningful = false, completed = 0;
  onProgress?.({ completed: 0, total: entries.length, path: '' });
  for (const { file, path, size, markdown } of entries) {
    checkAbort(signal);
    let buffer;
    try { buffer = await readBytes(file, signal); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      fail(`파일을 읽지 못했습니다. 다시 선택해 주세요: ${path}`, 'SOURCE_READ_FAILED');
    }
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== size) fail(`파일을 완전히 읽지 못했습니다. 다시 선택해 주세요: ${path}`, 'SOURCE_READ_FAILED');
    if (markdown) {
      let content;
      try { content = decoder().decode(buffer); }
      catch { fail(`UTF-8로 저장된 Markdown 파일이 아닙니다. UTF-8로 다시 저장해 주세요: ${path}`, 'SOURCE_ENCODING'); }
      if (content.includes('\u0000')) fail(`텍스트가 아닌 데이터가 포함되어 있습니다: ${path}`, 'SOURCE_ENCODING');
      const prefix = boundary(path);
      if (sourceMarkdown.length + prefix.length + content.length > SOURCE_FILE_LIMITS.maxChars) limitError('chars');
      const start = sourceMarkdown.length + prefix.length;
      sourceMarkdown += prefix + content;
      manifestFiles.push({ path, chars: content.length, bytes: size, start, end: sourceMarkdown.length });
      meaningful ||= Boolean(content.trim());
    } else {
      const mimeType = rasterMime(path);
      sourceImages.push(validateSourceImage({ path, src: sourceDataURL(buffer, mimeType), mimeType, bytes: size }));
    }
    checkAbort(signal);
    onProgress?.({ completed: ++completed, total: entries.length, path });
  }
  checkAbort(signal);
  if (!meaningful && !sourceImages.length) fail('선택한 Markdown 파일에 원고 내용이 없습니다. 내용이 있는 파일을 선택해 주세요.', 'EMPTY_MARKDOWN_FILES');
  return { sourceMarkdown, sourceName: mixedCollectionName(folderName, manifestFiles, sourceImages), files: manifestFiles, sourceImages, ignoredCount, folderName };
}
