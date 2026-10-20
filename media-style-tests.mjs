import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { normalizeMediaPresentation, mediaPresentationAttributes, MEDIA_STYLE_CSS } from './dist/media-style.js';
import { validateDiagram, serializeDiagram, parseDiagramBlocks, renderDiagram } from './dist/diagrams.js';
import { renderImageFigure, renderMarkdown, validateChapterFigures, exportHTML, prepareBookPreview, buildEpub } from './dist/export.js';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const image = extra => ({ src: PNG, alt: '사용자가 설명한 그림', caption: '그림 1. 실제 단계', ...extra });
const chart = extra => ({ type: 'bar', title: '성장', caption: '변화 비교', columns: [], rows: [], labels: ['처음', '다음'], values: [12, -20], unit: '명', evidence: ['처음 12명', '다음 -20명'], ...extra });
const book = extra => ({ id: 'media-book', title: '편집 가능한 책', author: '작가', updatedAt: '2026-10-20T00:00:00.000Z', chapters: [{ id: 'body-one', title: '본문', content: '본문 내용' }], ...extra });
function zipEntries(bytes) {
  const result = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decode = new TextDecoder();
  for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
    const name = decode.decode(bytes.subarray(offset + 30, offset + 30 + length));
    const start = offset + 30 + length + extra;
    result.set(name, decode.decode(bytes.subarray(start, start + size))); offset = start + size;
  }
  return result;
}
test('presentation accepts bounded numbers and palette tokens without arbitrary CSS', () => {
  assert.deepEqual(normalizeMediaPresentation(), { width: 100, accent: 'none' });
  assert.deepEqual(normalizeMediaPresentation({ width: 45.55, accent: 'blue' }), { width: 45.6, accent: 'blue' });
  for (const width of [25, 100]) assert.equal(normalizeMediaPresentation({ width }).width, width);
  for (const value of [null, [], 50, { width: '50' }, { width: 24.9 }, { width: 100.1 }, { width: Infinity }, { width: NaN }, { accent: 'red' }, { accent: 'blue" onclick="x' }, { width: 50, style: 'url(https://evil.test)' }]) assert.throws(() => normalizeMediaPresentation(value));
  assert.equal(mediaPresentationAttributes(), '');
  assert.equal(mediaPresentationAttributes({ width: 65, accent: 'rose' }), ' data-media-width="65" data-media-accent="rose" style="width:65%;margin-left:auto;margin-right:auto"');
});
test('figure style survives canonicalization while legacy figures keep unchanged shape', () => {
  const old = { id: 'pic', ...image() };
  assert.deepEqual(validateChapterFigures([old]), [old]);
  const input = { ...old, presentation: { width: 50, accent: 'amber' } };
  const [output] = validateChapterFigures([input]);
  assert.deepEqual(output.presentation, input.presentation); assert.notEqual(output.presentation, input.presentation);
  assert.throws(() => validateChapterFigures([{ ...old, presentation: { width: '50%;background:red' } }]));
  const html = renderMarkdown('![원고의 설명](folio-asset:pic)', { figures: [input] });
  assert.match(html, /data-media-width="50"/); assert.match(html, /data-media-accent="amber"/); assert.match(html, /alt="원고의 설명"/); assert.match(html, /그림 1. 실제 단계/);
});
test('only exact automatic caption is hidden; custom captions and alt stay intact', () => {
  const automatic = image({ caption: '  AI 생성 삽화  ' }), before = JSON.stringify(automatic);
  assert.doesNotMatch(renderImageFigure(automatic), /figcaption|AI 생성 삽화/);
  assert.match(renderImageFigure(automatic), /alt="사용자가 설명한 그림"/); assert.equal(JSON.stringify(automatic), before);
  assert.match(renderImageFigure(image({ caption: 'AI 생성 삽화의 윤리에 대한 예시' })), /<figcaption>AI 생성 삽화의 윤리에 대한 예시/);
  assert.throws(() => renderImageFigure(image({ src: 'https://evil.test/image.png' })));
  assert.throws(() => renderImageFigure(image({ presentation: { width: 0 } })));
  assert.doesNotMatch(renderImageFigure(image({ caption: '<script>alert(1)</script>' })), /<script>/);
});
test('diagram presentation survives Markdown roundtrip without relaxing structure or grounding', () => {
  const input = chart({ presentation: { width: 75, accent: 'blue' } });
  const value = validateDiagram(input, { evidenceText: input.evidence.join('\n') });
  assert.notEqual(value.presentation, input.presentation); assert.deepEqual(parseDiagramBlocks(serializeDiagram(value), { strict: true })[0].diagram, value);
  const html = renderDiagram(value);
  assert.match(html, /data-media-width="75"/); assert.match(html, /data-media-accent="blue"/); assert.match(html, /fill="#2f6caa"/); assert.match(html, /fill="#996347"/); assert.match(html, /처음 12명/);
  assert.throws(() => validateDiagram(chart({ presentation: { accent: 'url(evil)' } })), error => error.code === 'INVALID_DIAGRAM');
  assert.throws(() => validateDiagram(chart({ presentation: { width: 50 }, onload: 'evil' })), error => error.code === 'INVALID_DIAGRAM');
  assert.equal(Object.hasOwn(validateDiagram(chart()), 'presentation'), false);
});
test('safe text emphasis supports inline Markdown without injecting styles or markup', () => {
  for (const accent of ['sage', 'blue', 'amber', 'rose']) {
    const html = renderMarkdown('앞 ==**중요** <img onerror=x>=={' + accent + '} 뒤');
    assert.match(html, new RegExp('<mark class="folio-text-accent-' + accent + '">')); assert.match(html, /<strong>중요<\/strong>/); assert.match(html, /&lt;img onerror=x&gt;/); assert.doesNotMatch(html, /<img|style=/); assert.ok(MEDIA_STYLE_CSS.includes('mark.folio-text-accent-' + accent));
  }
  const tick = String.fromCharCode(96);
  for (const content of ['==중요=={red}', '==중\n요=={blue}', '\\==중요=={blue}', tick + '==중요=={blue}' + tick]) assert.doesNotMatch(renderMarkdown(content), /<mark/);
});
test('preview, HTML, print and EPUB retain media styling and emphasis together', async () => {
  const diagram = chart({ presentation: { width: 70, accent: 'rose' } });
  const project = book({ chapters: [{ id: 'body-one', title: '본문', content: '==독자 안내=={blue}\n\n![본문 화면](folio-asset:shot)\n\n' + serializeDiagram(diagram), image: image({ caption: 'AI 생성 삽화', presentation: { width: 45, accent: 'sage' } }), figures: [{ id: 'shot', ...image({ presentation: { width: 60, accent: 'amber' } }) }] }] });
  const before = JSON.stringify(project), preview = await prepareBookPreview(project);
  assert.equal(preview.sections.find(section => section.id === 'chapter-1').chapterId, 'body-one');
  const entries = zipEntries(await buildEpub(project));
  const outputs = [preview.sections.find(section => section.chapterId === 'body-one').html, await exportHTML(project), await exportHTML(project, { interactive: false }), entries.get('OEBPS/chapter-001.xhtml')];
  for (const html of outputs) {
    for (const pair of [['45', 'sage'], ['60', 'amber'], ['70', 'rose']]) assert.match(html, new RegExp('data-media-width="' + pair[0] + '" data-media-accent="' + pair[1] + '"'));
    assert.match(html, /folio-text-accent-blue/); assert.doesNotMatch(html, /AI 생성 삽화/); assert.match(html, /그림 1. 실제 단계/);
  }
  assert.ok(entries.get('OEBPS/styles/book.css').includes(MEDIA_STYLE_CSS)); assert.match(entries.get('OEBPS/package.opf'), /properties="svg"/);
  const window = new Window(), xml = new window.DOMParser().parseFromString(entries.get('OEBPS/chapter-001.xhtml'), 'application/xml');
  assert.equal(xml.querySelectorAll('parsererror').length, 0); assert.equal(xml.querySelectorAll('figure[data-media-width]').length, 3); assert.equal(JSON.stringify(project), before);
});


test('EPUB body navigation skips the unnumbered preface and retains body numbering', async () => {
  const project = book({ bookMatter: { preface: { id: 'opening', title: '시작말', content: '여는 글', kind: 'preface' }, afterword: { id: 'ending', title: '맺음말', content: '닫는 글', kind: 'afterword' } } });
  const entries = zipEntries(await buildEpub(project));
  assert.match(entries.get('OEBPS/nav.xhtml'), /epub:type="bodymatter" href="chapter-002.xhtml"/);
  assert.doesNotMatch(entries.get('OEBPS/chapter-001.xhtml'), /class="chapter-number"/);
  assert.match(entries.get('OEBPS/chapter-002.xhtml'), /class="chapter-number">01<\/p>/);
  assert.doesNotMatch(entries.get('OEBPS/chapter-003.xhtml'), /class="chapter-number"/);
});
