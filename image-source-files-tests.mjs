import test from 'node:test';
import assert from 'node:assert/strict';
import { readMarkdownFiles, readSourceFiles, validateSourceManifest, SOURCE_FILE_LIMITS } from './dist/source-files.js';
import { validateSourceImage, validateSourceImages, validateSourceImagePath, SOURCE_IMAGE_LIMITS } from './dist/source-images.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const WEBP = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v02aAA=';
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5/ooooA//2Q==';
const pngBytes = Buffer.from(PNG, 'base64');
const saved = (path = '책/그림.png') => ({ path, src: `data:image/png;base64,${PNG}`, mimeType: 'image/png', bytes: pngBytes.length });
const clone = value => JSON.parse(JSON.stringify(value));
function file(path, content = pngBytes, options = {}) {
  const value = new File([content], path.split('/').at(-1), { type: options.type ?? '' });
  if (path.includes('/') || options.relative) Object.defineProperty(value, 'webkitRelativePath', { value: path });
  if (options.size !== undefined) Object.defineProperty(value, 'size', { value: options.size });
  if (options.read) Object.defineProperty(value, 'arrayBuffer', { value: options.read });
  return value;
}
const manifest = result => ({ files: result.files, folderName: result.folderName, ignoredCount: result.ignoredCount });

test('mixed nested folder retains exact originals and natural ordering across all accepted files', async () => {
  const raw = '\ufeff# 원고 😀\r\n  줄 끝  \r\n';
  const progress = [];
  const result = await readSourceFiles([
    file('책/10/사진.png'), file('책/2/하위/원고.markdown', '# 두 번째'),
    file('책/2/사진.png'), file('책/1.md', raw), file('책/2/02.png'),
  ], { onProgress: value => progress.push(value) });
  assert.deepEqual(result.files.map(value => value.path), ['책/1.md', '책/2/하위/원고.markdown']);
  assert.deepEqual(result.sourceImages.map(value => value.path), ['책/2/02.png', '책/2/사진.png', '책/10/사진.png']);
  assert.equal(result.sourceMarkdown.slice(result.files[0].start, result.files[0].end), raw);
  assert.deepEqual(result.sourceImages.map(value => value.src), Array(3).fill(saved().src));
  for (const image of result.sourceImages) assert.deepEqual(Buffer.from(image.src.split(',')[1], 'base64'), pngBytes);
  assert.equal(result.folderName, '책');
  assert.match(result.sourceName, /MD 2개 · 이미지 3개/);
  assert.deepEqual(progress.map(value => value.completed), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(progress.slice(1).map(value => value.path), ['책/1.md', '책/2/02.png', '책/2/사진.png', '책/2/하위/원고.markdown', '책/10/사진.png']);
  assert(progress.every(value => value.total === 5));
  assert.deepEqual(validateSourceManifest(manifest(result), result.sourceMarkdown), manifest(result));
});

test('image-only folders and multi-file selection accept real PNG, JPEG and WebP files', async () => {
  const result = await readSourceFiles([
    file('사진/아래/10.webp', Buffer.from(WEBP, 'base64'), { type: 'image/webp' }),
    file('사진/2.JPG', Buffer.from(JPEG, 'base64'), { type: 'image/jpeg' }),
    file('사진/1.png', pngBytes, { type: 'image/png' }),
  ]);
  assert.equal(result.sourceMarkdown, '');
  assert.deepEqual(result.files, []);
  assert.equal(result.folderName, '사진');
  assert.match(result.sourceName, /이미지 3개/);
  assert.deepEqual(validateSourceImages(result.sourceImages), result.sourceImages);
  const fallback = await readSourceFiles([file('10.png'), file('2.png')]);
  assert.deepEqual(fallback.sourceImages.map(value => value.path), ['2.png', '10.png']);
  assert.equal(fallback.folderName, '');
});

test('unsupported descendants are counted without reading; legacy Markdown reader still ignores images', async () => {
  let reads = 0;
  const noRead = async () => { reads++; throw new Error('ignored bytes must not be read'); };
  const result = await readSourceFiles([
    file('책/원고.md', '# 내용'), file('책/그림.png'),
    ...['svg', 'gif', 'pdf', 'txt', 'heic', 'png.exe'].map(extension => file(`책/다른.${extension}`, '', { read: noRead })),
  ]);
  assert.equal(result.ignoredCount, 6);
  assert.equal(reads, 0);
  const legacy = await readMarkdownFiles([file('책/원고.md', '# 내용'), file('책/그림.png', pngBytes, { read: noRead })]);
  assert.equal(legacy.ignoredCount, 1);
  assert.equal(legacy.sourceImages, undefined);
  assert.equal(reads, 0);
});

test('blank Markdown remains represented beside images; blank Markdown alone is still rejected', async () => {
  const result = await readSourceFiles([file('책/빈.md', ''), file('책/공백.md', '\ufeff\r\n  '), file('책/자료.png')]);
  assert.equal(result.files.length, 2);
  assert.deepEqual(validateSourceManifest(manifest(result), result.sourceMarkdown, { allowEmpty: true }), manifest(result));
  assert.throws(() => validateSourceManifest(manifest(result), result.sourceMarkdown));
  await assert.rejects(readSourceFiles([file('책/빈.md', '')]), error => error.code === 'EMPTY_MARKDOWN_FILES');
  await assert.rejects(readMarkdownFiles([file('책/빈.md', '')]), error => error.code === 'EMPTY_MARKDOWN_FILES');
  await assert.rejects(readSourceFiles([]), error => error.code === 'NO_SOURCE_FILES');
});

test('unsafe paths fail and identical names in different subfolders stay separate', async () => {
  for (const path of ['../a.png', '/a.png', 'C:/a.png', '책/../a.png', '책//a.png', '책/./a.png', '책\\a.png', '책/\u202ea.png', '책/줄\n바꿈.png', 'x'.repeat(2049) + '.png']) {
    assert.throws(() => validateSourceImagePath(path));
    await assert.rejects(readSourceFiles([file(path, pngBytes, { relative: true })]));
  }
  assert.throws(() => validateSourceImagePath('a.svg'));
  const result = await readSourceFiles([file('책/a/사진.png'), file('책/b/사진.png')]);
  assert.equal(result.sourceImages.length, 2);
  const maliciousLookingName = '책/<img src=x onerror=alert(1)>_[이름].png';
  assert.equal(validateSourceImage(saved(maliciousLookingName)).path, maliciousLookingName);
});

test('duplicate relative paths fail before any file is opened', async () => {
  let reads = 0;
  const read = async () => { reads++; return pngBytes.buffer; };
  await assert.rejects(readSourceFiles([file('책/a.png', pngBytes, { read }), file('책/a.png', pngBytes, { read })]), error => error.code === 'DUPLICATE_SOURCE_PATH');
  assert.equal(reads, 0);
  assert.throws(() => validateSourceImages([saved(), saved()]), error => error.code === 'DUPLICATE_SOURCE_PATH');
});

test('declared browser MIME, filename extension, data MIME and actual bytes must agree', async () => {
  await assert.rejects(readSourceFiles([file('책/a.png', pngBytes, { type: 'image/jpeg' })]), error => error.code === 'SOURCE_IMAGE_MIME');
  await assert.rejects(readSourceFiles([file('책/a.jpg', pngBytes, { type: 'image/jpeg' })]), error => error.code === 'SOURCE_IMAGE_MIME');
  for (const overrides of [
    { mimeType: 'image/jpeg' }, { path: '책/a.jpg' },
    { src: saved().src.replace('image/png', 'image/jpeg') },
    { src: `data:image/png;base64,${WEBP}` },
  ]) assert.throws(() => validateSourceImage({ ...saved(), ...overrides }), error => error.code === 'SOURCE_IMAGE_MIME');
});

test('malformed, external, SVG, truncated and corrupted images reject the entire collection', async () => {
  const corrupt = Buffer.from(pngBytes); corrupt[45] ^= 1;
  for (const bytes of [Buffer.alloc(0), Buffer.from('not an image'), pngBytes.subarray(0, 20), corrupt]) {
    await assert.rejects(readSourceFiles([file('책/1.md', '# 원고'), file('책/2.png', bytes)]));
  }
  for (const src of ['https://example.com/secret.png', 'file:///private.png', 'blob:test', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'data:image/png;base64,@@@@', saved().src + '<script>']) {
    assert.throws(() => validateSourceImage({ ...saved(), src }));
  }
  for (const bytes of [0, -1, 0.5, NaN, pngBytes.length + 1]) assert.throws(() => validateSourceImage({ ...saved(), bytes }));
});

test('file count and image byte bounds are checked before any read; exact 50-image maximum works', async () => {
  let reads = 0;
  const noRead = async () => { reads++; throw new Error('preflight should prevent reading'); };
  const maximum = Array.from({ length: SOURCE_IMAGE_LIMITS.maxImages }, (_, index) => file(`책/${index}.png`));
  assert.equal((await readSourceFiles(maximum)).sourceImages.length, 50);
  await assert.rejects(readSourceFiles([...maximum, file('책/51.png', pngBytes, { read: noRead })]), error => error.code === 'SOURCE_IMAGE_COUNT_LIMIT');
  await assert.rejects(readSourceFiles([file('책/큰.png', pngBytes, { size: SOURCE_IMAGE_LIMITS.maxBytes + 1, read: noRead })]), error => error.code === 'SOURCE_IMAGE_BYTE_LIMIT');
  await assert.rejects(readSourceFiles(Array.from({ length: 5 }, (_, index) => file(`책/${index}.png`, pngBytes, { size: SOURCE_IMAGE_LIMITS.maxBytes, read: noRead }))), error => error.code === 'SOURCE_IMAGE_TOTAL_LIMIT');
  assert.equal(reads, 0);
  assert.throws(() => validateSourceImages(Array.from({ length: 51 }, (_, index) => saved(`${index}.png`))), error => error.code === 'SOURCE_IMAGE_COUNT_LIMIT');
  assert.throws(() => validateSourceImages(Array.from({ length: 5 }, (_, index) => ({ ...saved(`${index}.png`), bytes: SOURCE_IMAGE_LIMITS.maxBytes }))), error => error.code === 'SOURCE_IMAGE_TOTAL_LIMIT');
});

test('Markdown limits still apply independently inside a mixed collection', async () => {
  await assert.rejects(readSourceFiles([file('그림.png'), file('원고.md', '', { size: SOURCE_FILE_LIMITS.maxBytes + 1 })]), error => error.code === 'SOURCE_BYTE_LIMIT');
  await assert.rejects(readSourceFiles([file('그림.png'), ...Array.from({ length: 501 }, (_, index) => file(`${index}.md`, 'x'))]), error => error.code === 'SOURCE_FILE_LIMIT');
  await assert.rejects(readSourceFiles([file('그림.png'), file('원고.md', '가'.repeat(SOURCE_FILE_LIMITS.maxChars))]), error => error.code === 'SOURCE_CHAR_LIMIT');
  await assert.rejects(readSourceFiles([file('그림.png'), file('원고.md', Buffer.from([0xc3, 0x28]))]), error => error.code === 'SOURCE_ENCODING');
});

test('unreadable images and actual-size mismatches cannot return a partial result', async () => {
  for (const read of [async () => { throw new Error('private path'); }, async () => new ArrayBuffer(2), async () => 'invalid']) {
    await assert.rejects(readSourceFiles([file('책/1.md', '# 원고'), file('책/2.png', pngBytes, { read })]), error => error.code === 'SOURCE_READ_FAILED' && !error.message.includes('private path'));
  }
});

test('abort is atomic before reads, during pending image reads, and at a progress boundary', async () => {
  const before = new AbortController(); before.abort();
  let reads = 0;
  await assert.rejects(readSourceFiles([file('a.png', pngBytes, { read: async () => { reads++; } })], { signal: before.signal }), error => error.name === 'AbortError');
  assert.equal(reads, 0);
  const during = new AbortController(), progress = [];
  let finish;
  const pending = readSourceFiles([file('a.png', pngBytes, { read: () => new Promise(resolve => { finish = resolve; }) })], { signal: during.signal, onProgress: value => progress.push(value.completed) });
  await Promise.resolve(); during.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  finish(Uint8Array.from(pngBytes).buffer);
  await Promise.resolve();
  assert.deepEqual(progress, [0]);
  const boundary = new AbortController();
  await assert.rejects(readSourceFiles([file('a.png'), file('b.png', pngBytes, { read: async () => { reads++; } })], {
    signal: boundary.signal, onProgress: ({ completed }) => { if (completed === 1) boundary.abort(); },
  }), error => error.name === 'AbortError');
  assert.equal(reads, 0);
});

test('saved collections are sanitized independently and restore exact image bytes', () => {
  const input = [{ ...saved(), id: 'do-not-retain', secret: 'do-not-retain' }];
  const restored = validateSourceImages(clone(input));
  assert.deepEqual(Object.keys(restored[0]), ['path', 'src', 'mimeType', 'bytes']);
  assert.equal(restored[0].src, input[0].src);
  restored[0].path = 'changed.png';
  assert.equal(input[0].path, '책/그림.png');
  assert.deepEqual(validateSourceImages([]), []);
  for (const value of [null, {}, undefined, '[]']) assert.throws(() => validateSourceImages(value));
});

test('cached image validation rechecks every changed field and never trusts mutated returned objects', () => {
  const mutations = [
    image => { image.path = '../invalid.png'; },
    image => { image.src = 'https://example.com/image.png'; },
    image => { image.mimeType = 'image/jpeg'; },
    image => { image.bytes++; },
    image => { delete image.src; },
  ];
  for (const mutate of mutations) {
    const input = saved();
    const canonical = validateSourceImage(input);
    assert.deepEqual(validateSourceImage(input), canonical);
    mutate(input);
    assert.throws(() => validateSourceImage(input));
    assert.deepEqual(validateSourceImage(canonical), saved());
    mutate(canonical);
    assert.throws(() => validateSourceImage(canonical));
  }
  const input = saved(), first = validateSourceImage(input), second = validateSourceImage(input);
  assert.notEqual(first, second);
  first.path = 'different.png';
  assert.equal(validateSourceImage(first).path, 'different.png');
  assert.deepEqual(validateSourceImage(input), saved());
  assert.deepEqual(second, saved());
  const renamed = { ...saved(), path: 'valid-new-path.png' };
  input.path = renamed.path;
  assert.deepEqual(validateSourceImage(input), renamed);
});

test('collection checks still enforce edited arrays, duplicates and backup bytes after cache hits', () => {
  const entries = validateSourceImages([saved('a.png'), saved('b.png')]);
  assert.deepEqual(validateSourceImages(entries), entries);
  entries[1].path = 'a.png';
  assert.throws(() => validateSourceImages(entries), error => error.code === 'DUPLICATE_SOURCE_PATH');
  entries[1].path = 'b.png';
  entries.push({ ...saved('c.png'), src: 'data:image/png;base64,AAAA' });
  assert.throws(() => validateSourceImages(entries));
  const restored = clone(validateSourceImages([saved()]));
  restored[0].src = restored[0].src.replace(PNG, WEBP);
  assert.throws(() => validateSourceImages(restored), error => error.code === 'SOURCE_IMAGE_MIME');
});
