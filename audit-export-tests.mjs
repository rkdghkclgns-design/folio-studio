import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { parseDiagramBlocks, serializeDiagram, stripDiagramBlocks, validateDiagram } from './dist/diagrams.js';
import { renderMarkdown, validateImageSource, exportHTML } from './dist/export.js';

const chart = extra => ({ type: 'bar', title: '계절별 매출', caption: '', columns: [], rows: [], labels: ['봄', '여름'], values: [12, 20], unit: '만원', evidence: ['봄 12만원', '여름 20만원'], ...extra });
const ground = value => value.evidence.join('\n');
const project = extra => ({ title: '검증용 책', author: '작가', chapters: [{ title: '본문', content: '자료' }], ...extra });

test('CR-only and mixed newline fences retain raw offsets and cannot bypass numeric grounding', () => {
  const source = serializeDiagram(chart());
  for (const fence of [source.replaceAll('\n', '\r'), source.replace('\n', '\r\n').replace('\n```', '\r```')]) {
    const content = `앞 문단\r${fence}\r뒤 문단`;
    const blocks = parseDiagramBlocks(content, { strict: true, evidenceText: ground(chart()) });
    assert.equal(blocks.length, 1);
    assert.equal(content.slice(blocks[0].start, blocks[0].end), `${fence}\r`);
    assert.equal(content.slice(blocks[0].end), '뒤 문단');
    assert.throws(() => parseDiagramBlocks(content, { strict: true, evidenceText: '자료 없음' }), /원문 근거/);
    assert.match(renderMarkdown(content), /<svg\b/);
    assert.ok(!stripDiagramBlocks(content).includes('12만원'));
  }
});

test('all XML control characters removed by rendering are recognized by the strict fence parser', () => {
  const controls = [0, 1, 8, 11, 12, 14, 31, 0xfffe, 0xffff].map(value => String.fromCharCode(value));
  for (const control of controls) {
    for (const opener of [`${control}\`\`\`folio-diagram`, `\`\`\`fol${control}io-diagram`, `\`\`\`folio-diagram${control}`]) {
      const content = serializeDiagram(chart()).replace('```folio-diagram', opener).replace(/```$/, `\`\`${control}\``);
      assert.match(renderMarkdown(content), /<svg\b/);
      assert.throws(() => parseDiagramBlocks(content, { strict: true, evidenceText: '수치 없음' }), /원문 근거/);
      assert.equal(parseDiagramBlocks(content, { strict: true, evidenceText: ground(chart()) }).length, 1);
    }
  }
});

test('ordinary outer fences remain literal across CR and invisible XML cleanup', () => {
  const inner = serializeDiagram(chart()).replaceAll('\n', '\r');
  const content = `\u0000\`\`\`\`markdown\r${inner}\r\`\`\`\u0000\``;
  assert.deepEqual(parseDiagramBlocks(content, { strict: true, evidenceText: '' }), []);
  assert.ok(!renderMarkdown(content).includes('<svg'));
});

test('typographic negative signs cannot supply evidence for a positive chart value', () => {
  for (const minus of ['−', '﹣', '－']) {
    const positive = chart({ evidence: [`봄 ${minus}12만원`, '여름 20만원'] });
    assert.throws(() => validateDiagram(positive, { evidenceText: ground(positive) }), /원문 근거/);
    const negative = { ...positive, values: [-12, 20] };
    assert.deepEqual(validateDiagram(negative, { evidenceText: ground(negative) }), negative);
  }
});

test('compound units cannot be truncated to a different metric', () => {
  for (const [unit, actual] of [['만원', '만원/인'], ['m', 'm²'], ['m', 'm³'], ['m', 'm / s'], ['kg', 'kg·m']]) {
    const value = chart({ unit, evidence: [`봄 12${actual}`, `여름 20${actual}`] });
    assert.throws(() => validateDiagram(value, { evidenceText: ground(value) }), /원문 근거/);
    const complete = { ...value, unit: actual };
    assert.deepEqual(validateDiagram(complete, { evidenceText: ground(complete) }), complete);
  }
});

// Independently encoded with Pillow/libwebp: two 2x2 frames, red then blue.
const WEBP = 'UklGRoQAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAAEAAAEAAGQAAAJWUDhMDwAAAC8BQAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAEAAAEAAGQAAABWUDhMDwAAAC8BQAAABxDR//4HIqL/AQA=';
const webpURL = bytes => `data:image/webp;base64,${bytes.toString('base64')}`;
function webpChunk(kind, data) {
  const bytes = Buffer.alloc(8 + data.length + data.length % 2);
  bytes.write(kind); bytes.writeUInt32LE(data.length, 4); data.copy(bytes, 8); return bytes;
}
function webpFile(parts) {
  const body = Buffer.concat(parts), bytes = Buffer.alloc(12 + body.length);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WEBP', 8); body.copy(bytes, 12); return bytes;
}

test('genuine animated WebP stays accepted and printable export remains offline', async () => {
  const src = `data:image/webp;base64,${WEBP}`, originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected request'); };
  try {
    assert.equal(validateImageSource(src), src);
    assert.ok((await exportHTML(project({ coverImage: { src } }))).includes(src));
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('animated WebP checks frame bounds, pixel dimensions, nested chunks and flags before browser decoding', () => {
  const original = Buffer.from(WEBP, 'base64');
  const frame = original.indexOf('ANMF') + 8;
  const corruptions = [
    bytes => bytes.writeUIntLE(16777214, frame + 6, 3),
    bytes => bytes.writeUIntLE(2, frame + 6, 3),
    bytes => bytes.writeUIntLE(1, frame, 3),
    bytes => bytes.writeUIntLE(0, frame + 6, 3),
    bytes => bytes.write('JUNK', frame + 16),
    bytes => bytes.writeUInt32LE(1000, frame + 20),
    bytes => { bytes[frame + 15] = 4; },
    bytes => { bytes[20] = 0; },
    bytes => bytes.write('JUNK', original.indexOf('ANIM')),
  ];
  for (const mutate of corruptions) {
    const bytes = Buffer.from(original); mutate(bytes);
    assert.throws(() => validateImageSource(webpURL(bytes)), /손상|화소/);
  }
});

test('header-only animated frames cannot pretend to contain raster pixels', () => {
  const extended = Buffer.alloc(10); extended[0] = 2;
  for (const huge of [false, true]) {
    const frame = Buffer.alloc(24);
    if (huge) { frame.writeUIntLE(16777214, 6, 3); frame.writeUIntLE(16777214, 9, 3); }
    const src = webpURL(webpFile([webpChunk('VP8X', extended), webpChunk('ANIM', Buffer.alloc(6)), webpChunk('ANMF', frame)]));
    assert.throws(() => validateImageSource(src), /손상|화소/);
  }
});

test('VP8 and VP8L still images require bytes beyond their dimension headers', () => {
  for (const [kind, header] of [['VP8 ', '3001009d012a01000100'], ['VP8L', '2f00000000']]) {
    const source = webpURL(webpFile([webpChunk(kind, Buffer.from(header, 'hex'))]));
    assert.throws(() => validateImageSource(source), /손상/);
  }
});

function pngChunk(kind, data) {
  const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(kind, 4); data.copy(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4); return bytes;
}
function indexedPNG({ color = 3, depth = 8, before = [], after = [] } = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = depth; ihdr[9] = color;
  return `data:image/png;base64,${Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr), ...before, pngChunk('IDAT', deflateSync(Buffer.from([0, 0]))), ...after, pngChunk('IEND', Buffer.alloc(0))]).toString('base64')}`;
}

test('indexed PNG requires one correctly sized palette before pixels', () => {
  const palette = pngChunk('PLTE', Buffer.from([255, 0, 0]));
  assert.equal(validateImageSource(indexedPNG({ before: [palette] })), indexedPNG({ before: [palette] }));
  for (const options of [
    {}, { after: [palette] }, { before: [palette, palette] },
    { before: [pngChunk('PLTE', Buffer.alloc(0))] },
    { before: [pngChunk('PLTE', Buffer.alloc(4))] },
    { before: [pngChunk('PLTE', Buffer.alloc(771))] },
    { depth: 1, before: [pngChunk('PLTE', Buffer.alloc(9))] },
    { color: 0, before: [palette] },
  ]) assert.throws(() => validateImageSource(indexedPNG(options)), /손상/);
});

test('PNG does not accept nonconsecutive image data chunks', () => {
  const palette = pngChunk('PLTE', Buffer.from([255, 0, 0]));
  const trailingData = pngChunk('IDAT', Buffer.from([0]));
  assert.throws(() => validateImageSource(indexedPNG({ before: [palette], after: [pngChunk('tEXt', Buffer.from('key\0value')), trailingData] })), /손상/);
});
