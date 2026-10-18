import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEpub, exportHTML, exportMarkdown, renderMarkdown, validateChapterFigures } from './dist/export.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const screenshot = (id = 'step_1') => ({ id, src: PNG, alt: '에디터 실행 화면', caption: '그림 1. 엔티티 추가 후 확인한 화면' });
const book = (chapters = [{ title: '예시 만들기', content: '조작 전 설명\n\n![엔티티를 추가한 모습](folio-asset:step_1)\n\n조작 후 설명', figures: [screenshot()] }]) => ({
  id: 'screenshots-book', title: '직접 만들어 보는 월드', author: '작가', language: 'ko', updatedAt: '2026-10-18T00:00:00.000Z', chapters,
});
function entries(bytes) {
  const result = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true), extra = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + length));
    const start = offset + 30 + length + extra;
    result.set(name, bytes.subarray(start, start + size)); offset = start + size;
  }
  return result;
}
const text = bytes => new TextDecoder().decode(bytes);

test('chapter figures are bounded, canonical raster data with copied plain-text metadata', () => {
  assert.deepEqual(validateChapterFigures(undefined), []);
  const input = { ...screenshot(), alt: '  화면\u0000 설명  ', caption: '첫째\r\n둘째', ignored: { dangerous: true } };
  const result = validateChapterFigures([input]);
  assert.deepEqual(result, [{ id: 'step_1', src: PNG, alt: '화면 설명', caption: '첫째\n둘째' }]);
  assert.notEqual(result[0], input);
  assert.equal(validateChapterFigures(Array.from({ length: 20 }, (_, index) => screenshot(`step-${index}`))).length, 20);
  assert.throws(() => validateChapterFigures(Array.from({ length: 21 }, (_, index) => screenshot(`step-${index}`))), /20/);
  assert.throws(() => validateChapterFigures([screenshot(), screenshot()]), /중복/);
  for (const value of [null, {}, 'screenshots']) assert.throws(() => validateChapterFigures(value));
  for (const id of ['', '../step', 'https://example.org', 'bad id', '한글', 'x'.repeat(101), 'a\u0000b', '<img>']) {
    assert.throws(() => validateChapterFigures([screenshot(id)]), /식별자/);
  }
  for (const invalid of [{ alt: 2 }, { caption: {} }, { alt: 'a'.repeat(2001) }, { caption: 'a'.repeat(4001) }]) {
    assert.throws(() => validateChapterFigures([{ ...screenshot(), ...invalid }]), /설명/);
  }
});

test('figure validation and rendering reject remote, local-path, SVG and corrupt data without fetching', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No network is permitted for image export'); };
  try {
    for (const src of ['https://example.org/private.png', '//example.org/private.png', 'file:///secret.png', 'blob:https://example.org/id', 'images/image-1.png', 'javascript:alert(1)', 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'data:image/png;base64,aW52YWxpZA==']) {
      const figures = [{ ...screenshot(), src }];
      assert.throws(() => validateChapterFigures(figures));
      assert.throws(() => renderMarkdown('![화면](folio-asset:step_1)', { figures }));
      await assert.rejects(() => exportHTML(book([{ title: '장', content: '![화면](folio-asset:step_1)', figures }])));
      await assert.rejects(() => buildEpub(book([{ title: '장', content: '![화면](folio-asset:step_1)', figures }])));
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});

test('inline screenshots occupy the requested paragraph position with escaped alt and caption', () => {
  const result = renderMarkdown('앞 문단\n\n![<확인> & "화면"](folio-asset:step_1)\n\n뒤 문단', {
    figures: [{ ...screenshot(), caption: '<script>실행 금지</script> & 설명' }],
  });
  assert.ok(result.indexOf('<p>앞 문단</p>') < result.indexOf('<figure>'));
  assert.ok(result.indexOf('</figure>') < result.indexOf('<p>뒤 문단</p>'));
  assert.ok(result.includes(`src="${PNG}"`));
  assert.ok(result.includes('alt="&lt;확인&gt; &amp; &quot;화면&quot;"'));
  assert.ok(result.includes('<figcaption>&lt;script&gt;실행 금지&lt;/script&gt; &amp; 설명</figcaption>'));
  assert.ok(!result.includes('<script>'));
  assert.ok(renderMarkdown('![](folio-asset:step_1)', { figures: [screenshot()] }).includes('alt="에디터 실행 화면"'));
});

test('missing and hostile references stay readable and cannot use caller-supplied URL mappings', () => {
  const result = renderMarkdown('![없는 화면 <설명>](folio-asset:missing)\n\n![외부 화면](folio-asset:https://attacker.invalid/image.png)', {
    figures: [], paths: new Map([['missing', 'https://attacker.invalid/image.png']]),
  });
  assert.equal((result.match(/folio-missing-figure/g) || []).length, 2);
  assert.ok(result.includes('없는 화면 &lt;설명&gt;'));
  assert.ok(!result.includes('<img'));
  assert.ok(!result.includes('https://attacker'));
});

test('screenshot references in code fences remain literal across newline styles and fence types', () => {
  for (const newline of ['\n', '\r', '\r\n']) for (const fence of ['```', '~~~']) {
    const result = renderMarkdown([`${fence}md`, '![코드 예시](folio-asset:step_1)', fence, '', '![실제 예시](folio-asset:step_1)'].join(newline), { figures: [screenshot()] });
    assert.ok(result.includes('<pre><code>![코드 예시](folio-asset:step_1)</code></pre>'));
    assert.equal((result.match(/<figure>/g) || []).length, 1);
  }
});

test('a figure directly after a table remains a figure even when its alternative text contains pipes', () => {
  const result = renderMarkdown('항목 | 값\n--- | ---\n엔티티 | 1개\n![메뉴 | 화면](folio-asset:step_1)', { figures: [screenshot()] });
  assert.ok(result.includes('<table'));
  assert.ok(result.includes('<figure>'));
  assert.ok(result.indexOf('</table>') < result.indexOf('<figure>'));
  assert.ok(result.includes('alt="메뉴 | 화면"'));
});

test('HTML and printable PDF document preserve legacy artwork plus inline screenshot positions', async () => {
  const project = book(); project.chapters[0].image = { src: PNG, alt: '장 앞의 기존 삽화' };
  const result = await exportHTML(project);
  const chapter = result.slice(result.indexOf('<section class="chapter"'));
  assert.equal((chapter.match(/<figure>/g) || []).length, 2);
  assert.ok(chapter.indexOf('alt="장 앞의 기존 삽화"') < chapter.indexOf('<p>조작 전 설명</p>'));
  assert.ok(chapter.indexOf('<p>조작 전 설명</p>') < chapter.indexOf('alt="엔티티를 추가한 모습"'));
  assert.ok(chapter.indexOf('alt="엔티티를 추가한 모습"') < chapter.indexOf('<p>조작 후 설명</p>'));
  assert.ok(result.includes('@media print'));
  assert.ok(!chapter.includes('folio-asset:'));
});

test('EPUB deduplicates inline screenshot assets across chapters and legacy artwork in its manifest', async () => {
  const project = book();
  project.chapters[0].image = { src: PNG, alt: '기존 삽화' };
  project.chapters.push({ title: '다음 예시', content: '![다음 화면](folio-asset:other)\n\n![누락된 화면](folio-asset:missing)', figures: [screenshot('other')] });
  const files = entries(await buildEpub(project));
  const assets = [...files.keys()].filter(path => path.endsWith('.png'));
  assert.equal(assets.length, 1);
  const opf = text(files.get('OEBPS/package.opf'));
  assert.equal((opf.match(/media-type="image\/png"/g) || []).length, 1);
  for (const name of ['OEBPS/chapter-001.xhtml', 'OEBPS/chapter-002.xhtml']) {
    const chapter = text(files.get(name));
    assert.ok(chapter.includes('src="images/image-2.png"'));
    assert.ok(!chapter.includes('data:image'));
    assert.ok(!chapter.includes('folio-asset:'));
  }
  const first = text(files.get('OEBPS/chapter-001.xhtml'));
  assert.ok(first.indexOf('<p>조작 전 설명</p>') < first.indexOf('alt="엔티티를 추가한 모습"'));
  assert.ok(first.indexOf('alt="엔티티를 추가한 모습"') < first.indexOf('<p>조작 후 설명</p>'));
  assert.ok(text(files.get('OEBPS/chapter-002.xhtml')).includes('이미지를 찾을 수 없습니다: 누락된 화면'));
});

test('Markdown retains portable screenshot references without pretending to embed raster bytes', () => {
  const project = book(), before = JSON.stringify(project);
  const markdown = exportMarkdown(project);
  assert.ok(markdown.includes('![엔티티를 추가한 모습](folio-asset:step_1)'));
  assert.ok(!markdown.includes('data:image'));
  assert.equal(JSON.stringify(project), before);
});
