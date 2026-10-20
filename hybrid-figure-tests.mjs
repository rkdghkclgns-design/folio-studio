import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEpub, exportHTML, prepareBookPreview, renderMarkdown, validateChapterFigures, validateImageProvenance, validateImageSource } from './dist/export.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300" width="640" height="300" role="img" aria-labelledby="title"><title id="title">기획 검증 흐름</title><desc>가설에서 실험으로 이동하는 두 단계</desc><rect x="20" y="90" width="220" height="100" rx="12" fill="#e9f1e7"/><text x="130" y="148" text-anchor="middle" font-family="sans-serif" font-size="24">가설</text><path d="M260 140 L360 140" stroke="#46765b" stroke-width="4"/><polygon points="360,130 380,140 360,150" fill="#46765b"/><text x="480" y="148" text-anchor="middle" font-size="24">실험</text></svg>';
const svgData = value => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(value);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const provenance = { provider: 'claude-svg', createdAt: '2026-10-21T00:00:00.000Z', prompt: '기획 검증 흐름을 설명하세요.' };
const figure = (overrides = {}) => ({ id: 'chapter-01-flow', src: svgData(SVG), alt: '가설을 실험으로 검증하는 흐름', caption: '그림 1. 기획 검증 단계', provenance, ...overrides });
const book = chapters => ({ id: 'hybrid-visual-book', title: '도표와 삽화', author: '작가', updatedAt: '2026-10-21T00:00:00.000Z', chapters });
function entries(bytes) {
  const files = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + length));
    const start = offset + 30 + length + extra;
    files.set(name, new TextDecoder().decode(bytes.subarray(start, start + size))); offset = start + size;
  }
  return files;
}

test('safe SVG figures canonicalize and retain only bounded creation records', () => {
  const source = figure({ provenance: { ...provenance, prompt: '  첫째\r\n둘째\u0000  ', ignored: '<script />' } });
  const original = JSON.stringify(source), [result] = validateChapterFigures([source]);
  assert.equal(result.src, validateImageSource(svgData(SVG)));
  assert.equal(Buffer.from(result.src.split(',')[1], 'base64').toString('utf8'), SVG);
  assert.deepEqual(result.provenance, { ...provenance, prompt: '첫째\n둘째' });
  assert.notEqual(result.provenance, source.provenance);
  assert.equal(JSON.stringify(source), original);
  assert.deepEqual(validateChapterFigures([{ ...result, provenance: undefined }])[0].provenance, undefined);
  assert.deepEqual(validateImageProvenance({ provider: 'codex-imagegen', createdAt: '2026-10-21T00:00:00Z' }), { provider: 'codex-imagegen', createdAt: '2026-10-21T00:00:00Z' });
});

test('creation records reject false provider shapes, invalid dates and oversized prompts', () => {
  for (const value of [null, [], 'Claude', {}, { ...provenance, provider: 'paid-api' }, { ...provenance, createdAt: 'today' }, { ...provenance, createdAt: '2026-02-30T00:00:00.000Z' }, { ...provenance, createdAt: '2026-10-21' }, { ...provenance, prompt: {} }, { ...provenance, prompt: 'a'.repeat(12001) }]) {
    assert.throws(() => validateChapterFigures([figure({ provenance: value })]), /제작/);
  }
  assert.equal(validateImageProvenance({ ...provenance, prompt: 'a'.repeat(12000) }).prompt.length, 12000);
});

test('a claimed Claude source cannot bypass SVG sanitation or perform external requests', async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected network request'); };
  try {
    for (const markup of ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/private"/></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><style>*{fill:red}</style></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="url(https://example.com/x)"/></svg>', '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>', '<svg xmlns="http://www.w3.org/2000/svg"><text>&#60;script&#62;</text></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><text>' + 'x'.repeat(1024 * 1024) + '</text></svg>']) {
      const figures = [figure({ src: svgData(markup) })];
      assert.throws(() => validateChapterFigures(figures));
      await assert.rejects(() => buildEpub(book([{ title: '장', content: '![도표](folio-asset:chapter-01-flow)', figures }])));
    }
    for (const src of ['https://example.com/a.svg', 'file:///a.svg', 'blob:https://example.com/a', 'javascript:alert(1)', 'data:image/png;base64,aW52YWxpZA==']) assert.throws(() => validateChapterFigures([figure({ src })]));
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});

test('SVG figures occupy their paragraph anchor with escaped labels and presentation controls', () => {
  const html = renderMarkdown('앞 문단\n\n![<도표> & 설명](folio-asset:chapter-01-flow)\n\n뒤 문단', { figures: [figure({ caption: '<script>도표 설명</script>', presentation: { width: 80, accent: 'blue' } })] });
  assert.ok(html.indexOf('<p>앞 문단</p>') < html.indexOf('<figure'));
  assert.ok(html.indexOf('</figure>') < html.indexOf('<p>뒤 문단</p>'));
  assert.ok(html.includes('data:image/svg+xml;base64,'));
  assert.ok(html.includes('alt="&lt;도표&gt; &amp; 설명"'));
  assert.ok(html.includes('data-media-width="80"'));
  assert.ok(html.includes('data-media-accent="blue"'));
  assert.ok(html.includes('&lt;script&gt;도표 설명&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes(provenance.prompt));
});

test('preview and standalone HTML retain original text, existing artwork and new SVG figures', async () => {
  const project = book([{ id: 'first', title: '기획 검증', image: { src: PNG, alt: '기존 상황 삽화' }, content: '검증 앞 설명\n\n![검증 도표](folio-asset:chapter-01-flow)\n\n검증 뒤 설명', figures: [figure()] }]);
  const before = JSON.stringify(project), preview = await prepareBookPreview(project);
  const chapter = preview.sections.find(section => section.chapterId === 'first');
  assert.ok(chapter.html.includes('기존 상황 삽화'));
  assert.ok(chapter.html.includes('data:image/svg+xml;base64,'));
  assert.ok(chapter.html.indexOf('검증 앞 설명') < chapter.html.indexOf('alt="검증 도표"'));
  assert.ok(chapter.html.indexOf('alt="검증 도표"') < chapter.html.indexOf('검증 뒤 설명'));
  const html = await exportHTML(project);
  assert.ok(html.includes('data:image/svg+xml;base64,'));
  assert.equal(JSON.stringify(project), before);
});

test('EPUB embeds SVG once and declares SVG on actual chapter image references', async () => {
  const project = book([
    { title: '본문 도표', content: '![도표](folio-asset:chapter-01-flow)', figures: [figure()] },
    { title: '상황 삽화', content: '![장면](folio-asset:scene)', figures: [figure({ id: 'scene', src: PNG, provenance: { ...provenance, provider: 'codex-imagegen' } })] },
    { title: '기존 SVG 삽화', content: '설명', image: { src: validateImageSource(svgData(SVG)), alt: '장 도표' } },
    { title: '미사용 도표', content: '그림을 아직 배치하지 않았습니다.', figures: [figure()] },
  ]);
  const files = entries(await buildEpub(project)), opf = files.get('OEBPS/package.opf');
  const svgs = [...files].filter(([name, body]) => name.endsWith('.svg') && body.includes('기획 검증 흐름'));
  assert.equal(svgs.length, 1);
  assert.ok(opf.includes('media-type="image/svg+xml"'));
  for (const index of [1, 3]) assert.match(opf, new RegExp('<item id="chapter-' + index + '"[^>]*properties="svg"'));
  for (const index of [2, 4]) assert.doesNotMatch(opf, new RegExp('<item id="chapter-' + index + '"[^>]*properties="svg"'));
  const first = files.get('OEBPS/chapter-001.xhtml');
  assert.ok(first.includes('src="' + svgs[0][0].slice('OEBPS/'.length) + '"'));
  assert.ok(!first.includes('data:image'));
  assert.ok(!first.includes('folio-asset:'));
  assert.ok(!first.includes('Claude'));
});

test('legacy raster limits and duplicate identifiers remain enforced for mixed figures', () => {
  const figures = Array.from({ length: 20 }, (_, i) => figure({ id: 'asset-' + i, ...(i % 2 ? { src: PNG } : {}) }));
  assert.equal(validateChapterFigures(figures).length, 20);
  assert.throws(() => validateChapterFigures([...figures, figure()]), /20/);
  assert.throws(() => validateChapterFigures([figure(), figure({ src: PNG })]), /중복/);
});
