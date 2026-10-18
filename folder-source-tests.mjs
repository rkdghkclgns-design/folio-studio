import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_FILE_LIMITS, readMarkdownFiles, validateSourceManifest } from './dist/source-files.js';
import { normalizeProductionBrief, createProductionProject, validateProductionData } from './dist/production.js';

const encoder = new TextEncoder();
function file(path, text = '# 자료\n본문', options = {}) {
  const entry = new File([options.bytes ?? text], path.split('/').at(-1));
  if (path.includes('/') || options.relative) Object.defineProperty(entry, 'webkitRelativePath', { value: path });
  if (options.read) Object.defineProperty(entry, 'arrayBuffer', { value: options.read });
  if (options.size !== undefined) Object.defineProperty(entry, 'size', { value: options.size });
  return entry;
}
const manifest = result => ({ files: result.files, ignoredCount: result.ignoredCount, folderName: result.folderName });
const copy = value => JSON.parse(JSON.stringify(value));

test('reads every nested Markdown descendant in natural path order, retaining exact raw bodies and provenance', async () => {
  const contents = new Map([
    ['책/10장/메모.markdown', '\ufeff# 열 번째\r\n\t따옴표 <script>는 원문의 일부  \r\n'],
    ['책/2장/세부/메모.MD', '# 두 번째\n😀 한글\n\n'],
    ['책/2장/메모.md', '# 둘째 장\r\n메모  '],
    ['책/1장.MARKDOWN', '# 첫 장\n'],
  ]);
  const progress = [];
  const result = await readMarkdownFiles([...contents].map(([path, content]) => file(path, content)), { onProgress: value => progress.push(value) });
  assert.deepEqual(result.files.map(entry => entry.path), ['책/1장.MARKDOWN', '책/2장/메모.md', '책/2장/세부/메모.MD', '책/10장/메모.markdown']);
  for (const entry of result.files) {
    assert.equal(result.sourceMarkdown.slice(entry.start, entry.end), contents.get(entry.path));
    assert.equal(entry.chars, contents.get(entry.path).length);
    assert.equal(entry.bytes, encoder.encode(contents.get(entry.path)).length);
  }
  assert.equal(result.folderName, '책');
  assert.match(result.sourceName, /책.*4/);
  assert.equal(result.ignoredCount, 0);
  assert.deepEqual(progress.map(value => value.completed), [0, 1, 2, 3, 4]);
  assert(progress.every(value => value.total === 4));
  assert.deepEqual(validateSourceManifest(manifest(result), result.sourceMarkdown), manifest(result));
});

test('non-Markdown descendants are counted and never opened', async () => {
  let ignoredReads = 0;
  const shouldNotRead = async () => { ignoredReads++; throw new Error('should not open'); };
  const result = await readMarkdownFiles([
    file('폴더/원고.md'), file('폴더/사진.png', '', { size: 100000000, read: shouldNotRead }),
    file('폴더/하위/메모.txt', '', { read: shouldNotRead }), file('폴더/문서.md.exe', '', { read: shouldNotRead }),
  ]);
  assert.equal(ignoredReads, 0);
  assert.equal(result.ignoredCount, 3);
  assert.equal(result.files.length, 1);
});

test('multi-file fallback keeps filenames and a stable order without inventing a root folder', async () => {
  const a = file('10.md', '# 열'), b = file('2.md', '# 둘'), c = file('02.md', '# 영둘');
  const first = await readMarkdownFiles([a, b, c]);
  const second = await readMarkdownFiles([c, a, b]);
  assert.equal(first.folderName, '');
  assert.equal(first.sourceMarkdown, second.sourceMarkdown);
  assert.deepEqual(first.files.map(value => value.path), ['2.md', '02.md', '10.md']);
});

test('same filenames in separate subfolders remain separate; duplicate full relative paths fail before reading', async () => {
  const result = await readMarkdownFiles([file('원고/가/메모.md', '# 가'), file('원고/나/메모.md', '# 나')]);
  assert.equal(result.files.length, 2);
  let reads = 0;
  const read = async () => { reads++; return encoder.encode('# 내용').buffer; };
  await assert.rejects(readMarkdownFiles([file('원고/가/메모.md', '# 내용', { read }), file('원고/가/메모.md', '# 내용', { read })]), error => error.code === 'DUPLICATE_SOURCE_PATH');
  assert.equal(reads, 0);
});

test('dangerous relative paths are rejected and path labels cannot introduce Markdown or HTML', async () => {
  for (const path of ['/outside.md', '../outside.md', '책/../outside.md', '책/./note.md', '책//note.md', 'C:/note.md', '책\\note.md', '책/줄\n바꿈.md', '책/\u202ename.md']) {
    await assert.rejects(readMarkdownFiles([file(path, '# 자료', { relative: true })]), error => error.code === 'UNSAFE_SOURCE_PATH', path);
  }
  const path = '책/<img src=x onerror=alert(1)>_[속임](링크)&~`.md';
  const result = await readMarkdownFiles([file(path, '# 진짜 원문')]);
  const label = result.sourceMarkdown.slice(0, result.files[0].start);
  assert.equal(result.files[0].path, path);
  assert(!label.includes('<img'));
  assert(label.includes('&lt;img'));
  assert(label.includes('\\_\\[속임\\]\\(링크\\)'));
  assert(label.includes('&amp;'));
  assert.deepEqual(validateSourceManifest(manifest(result), result.sourceMarkdown), manifest(result));
});

test('invalid UTF-8, binary NULs, unreadable files and mismatched byte lengths fail the entire collection', async () => {
  const invalid = [
    file('자료/깨짐.md', '', { bytes: new Uint8Array([0xc3, 0x28]) }),
    file('자료/바이너리.md', 'abc\u0000def'),
    file('자료/불가.md', 'abc', { read: async () => { throw new Error('Private filesystem detail'); } }),
    file('자료/짧음.md', 'abc', { read: async () => encoder.encode('ab').buffer }),
    file('자료/잘못됨.md', 'abc', { read: async () => 'abc' }),
  ];
  for (const entry of invalid) {
    await assert.rejects(readMarkdownFiles([file('자료/00-정상.md'), entry]), error => /파일|데이터/.test(error.message) && !error.message.includes('Private filesystem detail'));
  }
});

test('empty selection, no Markdown, and all-empty bodies fail while empty siblings remain represented', async () => {
  await assert.rejects(readMarkdownFiles([]), error => error.code === 'NO_MARKDOWN_FILES');
  await assert.rejects(readMarkdownFiles([file('책/내용.txt')]), error => error.code === 'NO_MARKDOWN_FILES');
  await assert.rejects(readMarkdownFiles([file('책/빈.md', ''), file('책/공백.md', '\ufeff\r\n\t  ')]), error => error.code === 'EMPTY_MARKDOWN_FILES');
  const result = await readMarkdownFiles([file('책/내용.md', '# 내용'), file('책/빈.md', '')]);
  assert.equal(result.files.length, 2);
  const empty = result.files.find(entry => entry.path.endsWith('/빈.md'));
  assert.equal(empty.start, empty.end);
  assert.deepEqual(validateSourceManifest(manifest(result), result.sourceMarkdown), manifest(result));
});

test('enforces file and byte limits before any read and accepts the maximum file count', async () => {
  let reads = 0;
  const entries = Array.from({ length: SOURCE_FILE_LIMITS.maxFiles + 1 }, (_, index) => file(`책/${index}.md`, 'a', { read: async () => { reads++; return encoder.encode('a').buffer; } }));
  await assert.rejects(readMarkdownFiles(entries), error => error.code === 'SOURCE_FILE_LIMIT');
  assert.equal(reads, 0);
  const maximum = await readMarkdownFiles(entries.slice(0, -1));
  assert.equal(maximum.files.length, 500);
  reads = 0;
  await assert.rejects(readMarkdownFiles([file('책/큰.md', '', { size: SOURCE_FILE_LIMITS.maxBytes + 1, read: async () => { reads++; return new ArrayBuffer(0); } })]), error => error.code === 'SOURCE_BYTE_LIMIT');
  assert.equal(reads, 0);
  await assert.rejects(readMarkdownFiles([file('책/a.md', '', { size: 600000 }), file('책/b.md', '', { size: 600000 })]), error => error.code === 'SOURCE_BYTE_LIMIT');
});

test('120000-character limit includes path boundaries and preserves the exact boundary value without truncation', async () => {
  const sample = await readMarkdownFiles([file('원고.md', 'x')]);
  const available = SOURCE_FILE_LIMITS.maxChars - sample.files[0].start;
  const result = await readMarkdownFiles([file('원고.md', '가'.repeat(available))]);
  assert.equal(result.sourceMarkdown.length, SOURCE_FILE_LIMITS.maxChars);
  assert.equal(result.files[0].chars, available);
  assert.equal(normalizeProductionBrief({ topic: '책', sourceMarkdown: result.sourceMarkdown }).sourceMarkdown, result.sourceMarkdown);
  await assert.rejects(readMarkdownFiles([file('원고.md', '가'.repeat(available + 1))]), error => error.code === 'SOURCE_CHAR_LIMIT');
});

test('UTF-16 offsets also preserve astral characters, BOM and CRLF through production serialization', async () => {
  const raw = '\ufeff# 😀 제목\r\n  원문\t  \r\n';
  const result = await readMarkdownFiles([file('원고/1.md', raw), file('원고/하위/2.md', '# 다음')]);
  const entry = result.files[0];
  assert.equal(entry.chars, raw.length);
  assert.equal(result.sourceMarkdown.slice(entry.start, entry.end), raw);
  const project = createProductionProject({ topic: '책', sourceMarkdown: result.sourceMarkdown, sourceName: result.sourceName });
  const restored = validateProductionData(copy(project.production));
  assert.equal(restored.brief.sourceMarkdown, result.sourceMarkdown);
  assert.deepEqual(validateSourceManifest(copy(manifest(result)), restored.brief.sourceMarkdown), manifest(result));
});

test('an aborted selection never starts reading and cancellation settles while an uninterruptible read is pending', async () => {
  const before = new AbortController();
  before.abort();
  let reads = 0;
  await assert.rejects(readMarkdownFiles([file('a.md', 'x', { read: async () => { reads++; return encoder.encode('x').buffer; } })], { signal: before.signal }), error => error.name === 'AbortError');
  assert.equal(reads, 0);
  const during = new AbortController();
  let finish;
  const progress = [];
  const pending = readMarkdownFiles([file('a.md', 'x', { read: () => new Promise(resolve => { finish = resolve; }) })], { signal: during.signal, onProgress: value => progress.push(value) });
  await Promise.resolve();
  during.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  finish(encoder.encode('x').buffer);
  await Promise.resolve();
  assert.deepEqual(progress.map(value => value.completed), [0]);
});

test('abort from progress prevents the next file from being read and produces no completed result', async () => {
  const controller = new AbortController();
  let reads = 0;
  await assert.rejects(readMarkdownFiles([file('a.md', 'a'), file('b.md', 'b', { read: async () => { reads++; return encoder.encode('b').buffer; } })], {
    signal: controller.signal,
    onProgress: ({ completed }) => { if (completed === 1) controller.abort(); },
  }), error => error.name === 'AbortError');
  assert.equal(reads, 0);
});

test('saved manifests reject tampered paths, ranges, body sizes, order, duplicates and folder names', async () => {
  const result = await readMarkdownFiles([file('책/1.md', '# 하나'), file('책/2.md', '# 둘')]);
  const changes = [
    value => { value.files[0].path = '../1.md'; },
    value => { value.files[0].path = '책/가짜.md'; },
    value => { value.files[0].start++; },
    value => { value.files[0].end++; },
    value => { value.files[0].chars++; },
    value => { value.files[0].bytes++; },
    value => { value.files[0].start = -1; },
    value => { value.files[0].chars = 1.5; },
    value => { value.files.reverse(); },
    value => { value.files[1].path = value.files[0].path; },
    value => { value.folderName = '다른책'; },
    value => { value.ignoredCount = -1; },
    value => { value.files = []; },
  ];
  for (const change of changes) {
    const broken = copy(manifest(result));
    change(broken);
    assert.throws(() => validateSourceManifest(broken, result.sourceMarkdown));
  }
  assert.throws(() => validateSourceManifest(manifest(result), `${result.sourceMarkdown}extra`));
  assert.throws(() => validateSourceManifest(manifest(result), result.sourceMarkdown.replace('원본 경로', '수정 경로')));
});

test('saved manifests are sanitized and returned independently; long Unicode folder names keep compatible sourceName length', async () => {
  const folder = '😀'.repeat(120);
  const result = await readMarkdownFiles([file(`${folder}/원문.md`, '# 원고')]);
  assert(result.sourceName.length <= 255);
  assert(!/[\ud800-\udbff]…/u.test(result.sourceName));
  const raw = manifest(result);
  raw.extra = 'ignored';
  raw.files[0].extra = 'ignored';
  const clean = validateSourceManifest(raw, result.sourceMarkdown);
  assert.equal(clean.extra, undefined);
  assert.equal(clean.files[0].extra, undefined);
  clean.files[0].path = 'changed.md';
  assert.equal(result.files[0].path, `${folder}/원문.md`);
});
