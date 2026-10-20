/** Opt-in real Vivliostyle PDF compilation. Normal npm test never downloads a browser. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { buildPublicationPackage, normalizePublication } from '../dist/publication.js';

const runFile = promisify(execFile);
export const TYPESETTING_CLI_VERSION = '11.4.0';
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pngChunk(name, bytes) {
  const type = Buffer.from(name), data = Buffer.concat([type, bytes]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, data, checksum]);
}

/** Deterministic original bitmap; no network images or extra graphics dependency. */
export function fixtureChart() {
  const width = 800, height = 360, scanlines = Buffer.alloc((width * 3 + 1) * height);
  const bars = [[100, 180, 210, [72, 100, 84]], [230, 310, 120, [132, 157, 118]], [360, 440, 170, [188, 153, 97]], [490, 570, 75, [96, 127, 150]]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgb = [246, 248, 243];
    if ((x >= 60 && x < 63 && y >= 60 && y <= 303) || (y >= 300 && y < 303 && x >= 60 && x <= 750)) rgb = [40, 70, 50];
    for (const [left, right, top, color] of bars) if (x >= left && x <= right && y >= top && y < 300) rgb = color;
    const index = y * (width * 3 + 1) + 1 + x * 3;
    scanlines.set(rgb, index);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(scanlines)), pngChunk('IEND', Buffer.alloc(0))]);
}

export function typesettingFixture() {
  const paragraphs = Array.from({ length: 14 }, (_, i) => `문단${String(i + 1).padStart(2, '0')} 한국어 조판 검증은 문장이 빠짐없이 출력되는지 확인하는 과정입니다. 책을 읽는 사람은 자연스러운 어절과 편안한 여백을 기대합니다. 한글과 English 2026이 함께 있어도 정확히 보존되어야 합니다. [KOREAN-${String(i + 1).padStart(2, '0')}]`);
  const rows = Array.from({ length: 48 }, (_, i) => `| 행${String(i + 1).padStart(2, '0')} | 긴 표의 내용과 열 너비를 확인하는 문장입니다. | TABLE-${String(i + 1).padStart(2, '0')} |`);
  return {
    id: 'typesetting-verification', title: '한국어 출판 조판 검증', author: 'Folio 검증', language: 'ko', theme: 'sage',
    description: '한국어, 여러 쪽 표, 그림과 코드의 보존을 확인하는 합성 검증 자료입니다.',
    chapters: [
      { id: 'korean', title: '한글 어절과 본문', content: '## 한국어 첫 소제목\n\n' + paragraphs.join('\n\n') + '\n\n[KOREAN-END]' },
      { id: 'table', title: '여러 쪽에 걸친 표', content: '아래 표는 모든 행이 차례대로 남아야 합니다.\n\n| 행 | 설명 | 확인 표식 |\n| --- | --- | --- |\n' + rows.join('\n') + '\n\n[TABLE-END]' },
      { id: 'image', title: '그림과 코드', content: '그림 전의 본문 [FIGURE-BEFORE]\n\n![검증 그림](folio-asset:validation-chart)\n\n그림 뒤의 본문 [FIGURE-AFTER]\n\n```text\nLONG-CODE-' + 'abcdefghijklmnopqrstuvwxyz'.repeat(8) + '\nCODE-END\n```\n\n[BOOK-END]', figures: [{ id: 'validation-chart', src: 'data:image/png;base64,' + fixtureChart().toString('base64'), alt: '조판 검증 그림', caption: '그림 1 - 이미지와 설명 보존' }] }
    ]
  };
}

export function expectedMarkers() {
  return [...Array.from({ length: 14 }, (_, i) => 'KOREAN-' + String(i + 1).padStart(2, '0')), ...Array.from({ length: 48 }, (_, i) => 'TABLE-' + String(i + 1).padStart(2, '0')), 'KOREAN-END', 'TABLE-END', 'FIGURE-BEFORE', 'FIGURE-AFTER', 'CODE-END', 'BOOK-END'];
}

/** Read only the stored ZIP format produced by buildPublicationPackage. */
export function packageEntries(bytes) {
  const entries = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    assert.equal(view.getUint16(at + 8, true), 0, 'Expected stored ZIP entries');
    const size = view.getUint32(at + 18, true), nameSize = view.getUint16(at + 26, true), extraSize = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameSize)), start = at + 30 + nameSize + extraSize;
    assert.match(name, /^[A-Za-z0-9_.-]+$/, 'Package entry must remain a single safe filename');
    assert.ok(start + size <= bytes.length && !entries.has(name), 'Invalid ZIP entry');
    entries.set(name, bytes.slice(start, start + size)); at = start + size;
  }
  assert.ok(entries.size > 0, 'No ZIP entries found');
  return entries;
}

const INSPECT_PDF = String.raw`
import json, re, sys
from pypdf import PdfReader
import pdfplumber
pdf, marker_file = sys.argv[1:3]
reader = PdfReader(pdf)
text = '\n'.join(page.extract_text() or '' for page in reader.pages)
compact = re.sub(r'\s+', '', text)
markers = json.load(open(marker_file, encoding='utf-8'))
images = []
for number, page in enumerate(reader.pages, 1):
    for image in page.images:
        images.append({'page': number, 'width': image.image.width, 'height': image.image.height})
overflow = []
with pdfplumber.open(pdf) as document:
    for number, page in enumerate(document.pages, 1):
        for char in page.chars:
            if char.get('text', '').strip() and (char['x0'] < -1 or char['x1'] > page.width + 1 or char['top'] < -1 or char['bottom'] > page.height + 1):
                overflow.append({'page': number, 'text': char['text'], 'box': [char['x0'], char['top'], char['x1'], char['bottom']]})
report = {
    'pages': len(reader.pages),
    'sizes': [[round(float(p.mediabox.width), 3), round(float(p.mediabox.height), 3)] for p in reader.pages],
    'markerCounts': {marker: compact.count(marker) for marker in markers},
    'missingKorean': [word for word in ['한국어', '출판', '조판', '본문', '판권정보'] if word not in compact],
    'images': images,
    'outOfPageCharacters': overflow,
    'characters': len(text)
}
print(json.dumps(report, ensure_ascii=True))
`;

export function validatePdfReport(report) {
  assert.ok(report.pages >= 8 && report.pages <= 40, 'The multi-chapter fixture must span a reasonable number of pages');
  assert.equal(report.sizes.length, report.pages);
  for (const [width, height] of report.sizes) {
    assert.ok(Math.abs(width - 148 / 25.4 * 72) <= 0.6, 'PDF width must be A5 (148mm)');
    assert.ok(Math.abs(height - 210 / 25.4 * 72) <= 0.6, 'PDF height must be A5 (210mm)');
  }
  for (const marker of expectedMarkers()) assert.equal(report.markerCounts[marker], 1, `${marker} must appear once, without loss or duplication`);
  assert.deepEqual(report.missingKorean, [], 'Korean text must remain extractable');
  assert.ok(report.images.some(image => image.width === 800 && image.height === 360), 'The source figure must be embedded');
  assert.deepEqual(report.outOfPageCharacters, [], 'Text must remain within the physical PDF page');
}

async function npmCliPath(explicit) {
  const candidates = [explicit, process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  for (const path of candidates) try { await access(path); if (path.endsWith('.js')) return path; } catch {}
  throw new Error('npm-cli.js was not found. Pass --npm-cli /path/to/npm/bin/npm-cli.js.');
}

export async function runTypesettingValidation(options = {}) {
  const qaRoot = join(repository, '.qa'), output = resolve(qaRoot, options.output || 'typesetting-validation');
  const child = relative(qaRoot, output);
  assert.ok(child && !child.startsWith('..' + sep) && child !== '..' && !isAbsolute(child), 'Output must be a subdirectory of .qa');
  await mkdir(output, { recursive: true });
  const fixture = typesettingFixture(), metadata = normalizePublication({ channel: 'direct', publisher: 'Folio 검증', publicationDate: '2026-10-20', price: '0', aiDisclosure: 'none' });
  const kit = await buildPublicationPackage(fixture, metadata), entries = packageEntries(kit.bytes);
  for (const [name, content] of entries) await writeFile(join(output, name), content);
  await writeFile(join(output, 'fixture.json'), JSON.stringify(fixture, null, 2));
  await writeFile(join(output, 'expected-markers.json'), JSON.stringify(expectedMarkers()));
  const npm = await npmCliPath(options.npmCli);
  const argumentsBeforeCommand = [npm, '--registry=https://registry.npmjs.org', 'exec', '--yes', '--package=@vivliostyle/cli@' + TYPESETTING_CLI_VERSION, '--', 'vivliostyle'];
  const execute = async (name, executable, args) => {
    try {
      const result = await runFile(executable, args, { cwd: output, windowsHide: true, timeout: 300000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' });
      await writeFile(join(output, name + '.log'), result.stdout + result.stderr);
      return result;
    } catch (error) {
      await writeFile(join(output, name + '.log'), String(error.stdout || '') + String(error.stderr || '') + '\n' + error.message);
      throw error;
    }
  };
  const version = await execute('version', process.execPath, [...argumentsBeforeCommand, '--version']);
  assert.match(version.stdout, /cli: 11\.4\.0\b/);
  const build = [...argumentsBeforeCommand, 'build', '--config', 'vivliostyle.config.json', '--log-level', 'verbose'];
  if (options.browser) build.push('--executable-browser', options.browser);
  await execute('build', process.execPath, build);
  const inspected = await execute('inspect', options.python || 'python', ['-c', INSPECT_PDF, 'book-print.pdf', 'expected-markers.json']);
  const report = JSON.parse(inspected.stdout);
  validatePdfReport(report);
  if (options.pdftoppm) await execute('render', options.pdftoppm, ['-r', '100', '-png', 'book-print.pdf', 'page']);
  const pdf = join(output, 'book-print.pdf');
  const summary = { ...report, cli: TYPESETTING_CLI_VERSION, runtime: version.stdout.trim(), node: process.version, platform: process.platform, pdf, pdfSha256: createHash('sha256').update(await readFile(pdf)).digest('hex'), generatedAt: new Date().toISOString(), visualReview: options.pdftoppm ? 'PNG pages generated; human review required' : 'not-run', scope: 'Synthetic fixture only; not PDF/X, PDF/UA, accessibility certification or bookstore acceptance.' };
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ output, pages: report.pages, markers: expectedMarkers().length, outOfPageCharacters: report.outOfPageCharacters.length, pdfSha256: summary.pdfSha256, rendered: Boolean(options.pdftoppm) }, null, 2));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {}, names = { '--browser': 'browser', '--python': 'python', '--pdftoppm': 'pdftoppm', '--npm-cli': 'npmCli', '--output': 'output' };
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = names[process.argv[i]], value = process.argv[i + 1];
    if (!name || !value) throw new Error('Usage: node scripts/validate-typesetting.mjs [--browser path] [--python executable] [--pdftoppm executable] [--npm-cli path] [--output qa-subdirectory]');
    options[name] = value;
  }
  await runTypesettingValidation(options);
}
