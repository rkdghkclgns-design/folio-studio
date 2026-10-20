import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Window } from 'happy-dom';
import { BOOK_PREVIEW_CSS, mountBookPreview } from './dist/book-preview.js';
import { prepareBookPreview, exportHTML, buildEpub, buildArchive, renderMarkdown } from './dist/export.js';

const fixture = extra => ({ id: 'reader-fixture', title: '문장이 머무는 책', author: '독자', language: 'ko', theme: 'sage', updatedAt: '2026-10-19T00:00:00.000Z', chapters: [
  { id: 'one', title: '첫 번째 장', content: '# 시작\n\n첫 **문장**입니다.\n\n|항목|수치|\n|---|---:|\n|기록|12|\n\n다음 문장.' },
  { id: 'two', title: '두 번째 장', content: '마지막 문장입니다.' },
], ...extra });

function setup(width = 900, layout = false) {
  const win = new Window({ url: 'https://folio.example/', settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableJavaScriptEvaluation: true } });
  const host = win.document.createElement('div'); win.document.body.append(host);
  host.getBoundingClientRect = () => ({ width });
  if (layout) {
    // Deterministic layout surrogate tests the split algorithm, not visual rendering.
    Object.defineProperty(win.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.classList.contains('folio-book-page-body') ? 100 : 0; } });
    Object.defineProperty(win.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return this.classList.contains('folio-book-page-body') ? Math.max(100, this.textContent.length + this.children.length * 3) : 0; } });
  }
  return { win, host };
}

test('viewer CSS file and inline standalone styles stay identical', async () => {
  assert.equal(await readFile(new URL('./dist/book-preview.css', import.meta.url), 'utf8'), BOOK_PREVIEW_CSS.trimStart());
  assert.match(BOOK_PREVIEW_CSS, /prefers-reduced-motion:reduce/);
  assert.match(BOOK_PREVIEW_CSS, /@media print/);
});

test('shared book preparation renders safe Markdown and preserves section order without mutations', async () => {
  const project = fixture({ title: '</script><script>alert(1)</script>', chapters: [{ title: '<img onerror=x>', content: '**굵게**\n\n<script>bad()</script>\n\n[공격](javascript:alert)' }] });
  const before = JSON.stringify(project), book = await prepareBookPreview(project);
  assert.deepEqual(book.sections.map(s => s.kind), ['cover', 'title', 'toc', 'chapter']);
  assert.equal(new Set(book.sections.map(s => s.id)).size, 4);
  assert.match(book.sections[3].html, /<strong>굵게<\/strong>/);
  assert.match(book.sections[3].html, /&lt;script&gt;bad/);
  assert.ok(!book.sections.some(s => s.html.includes('<script') || s.html.includes('href="javascript:')));
  assert.equal(JSON.stringify(project), before);
});

test('desktop reader supports cover, spreads, bookmark selection, links and keyboard without global key capture', async () => {
  const { win, host } = setup();
  const changes = [], prepared = await prepareBookPreview(fixture());
  const reader = mountBookPreview(host, { ...prepared, onPageChange: state => changes.push(state.page) });
  try {
    assert.equal(reader.getState().pageCount, 5);
    assert.equal(host.querySelectorAll('.folio-book-stage .folio-book-page').length, 1);
    assert.equal(host.querySelector('[data-book-prev]').disabled, true);
    host.querySelector('[data-book-next]').click();
    assert.equal(reader.getState().page, 1);
    assert.equal(host.querySelectorAll('.folio-book-stage .folio-book-page').length, 2);
    assert.match(host.querySelector('[data-book-position]').textContent, /2–3 \/ 5쪽/);
    host.querySelector('a[href="#chapter-2"]').click();
    assert.equal(reader.getState().page, 4);
    assert.equal(host.querySelector('[data-book-next]').disabled, true);
    host.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    assert.equal(reader.getState().page, 0);
    const select = host.querySelector('select'); select.value = '3'; select.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(reader.getState().section, 3);
    select.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    assert.equal(reader.getState().section, 3, 'select keyboard is untouched');
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assert.equal(reader.getState().section, 3, 'only reader-focused keys are captured');
    assert.ok(changes.includes(4));
    reader.destroy(); assert.equal(host.children.length, 0);
    reader.next(); assert.equal(host.children.length, 0);
  } finally { reader.destroy(); await win.happyDOM.close(); }
});

test('mobile reader advances one page and supports a horizontal swipe', () => {
  const { win, host } = setup(390);
  const reader = mountBookPreview(host, { title: '손안의 책', sections: Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, title: `${i}장`, html: `<p>${i}번째 원고</p>` })) });
  try {
    assert.equal(reader.getState().spread, 1);
    const stage = host.querySelector('[data-book-stage]');
    stage.dispatchEvent(new win.PointerEvent('pointerdown', { clientX: 240, clientY: 100, isPrimary: true, bubbles: true }));
    stage.dispatchEvent(new win.PointerEvent('pointerup', { clientX: 80, clientY: 110, isPrimary: true, bubbles: true }));
    assert.equal(reader.getState().page, 1);
    assert.equal(host.querySelectorAll('.folio-book-stage .folio-book-page').length, 1);
    reader.goTo(999); assert.equal(reader.getState().page, 3);
    reader.goTo(-1); assert.equal(reader.getState().page, 0);
  } finally { reader.destroy(); win.happyDOM.abort(); }
});

test('long prose pagination retains every Unicode character and inline formatting', () => {
  const { win, host } = setup(390, true);
  const content = '한글 문장과 😀 기호를 읽습니다. '.repeat(35);
  const html = `<p><strong>${content.slice(0, 100)}</strong>${content.slice(100)}</p>`;
  const reader = mountBookPreview(host, { title: '긴 문단', sections: [{ id: 'long', title: '본문', html }] });
  try {
    assert.ok(reader.getState().pageCount > 5);
    let restored = '', bold = '';
    for (let i = 0; i < reader.getState().pageCount; i++) {
      reader.goTo(i);
      const body = host.querySelector('.folio-book-stage .folio-book-page-body');
      restored += body.textContent;
      bold += [...body.querySelectorAll('strong')].map(n => n.textContent).join('');
      assert.ok(!body.classList.contains('has-overflow'));
    }
    assert.equal(restored, content);
    assert.equal(bold, content.slice(0, 100));
  } finally { reader.destroy(); win.happyDOM.abort(); }
});

test('oversized tables retain complete data in a keyboard-accessible scroll region', () => {
  const { win, host } = setup(390, true);
  const markdown = '|항목|설명|\n|---|---|\n' + Array.from({ length: 24 }, (_, i) => `|항목 ${i}|설명 ${i}|`).join('\n');
  const reader = mountBookPreview(host, { sections: [{ title: '표', html: renderMarkdown(markdown) }] });
  try {
    const body = host.querySelector('.folio-book-stage .has-overflow');
    assert.ok(body); assert.equal(body.tabIndex, 0); assert.equal(body.getAttribute('role'), 'region');
    assert.equal(body.querySelectorAll('tbody tr').length, 24);
    assert.match(body.textContent, /항목 23/);
  } finally { reader.destroy(); win.happyDOM.abort(); }
});

test('standalone reader has one exact CSP-authorized script and no embedded user code or remote dependencies', async () => {
  const html = await exportHTML(fixture({ title: '</script><script>window.pwned=1</script>' }));
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const script = scripts[0][1], hash = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${hash}'`));
  assert.ok(!script.includes('window.pwned'));
  assert.ok(!/<script[^>]+src=|<link[^>]+href=/.test(html));
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(script));
  assert.match(html, /folio-reader-enhanced #folio-book-source\{display:block!important\}/);
  const win = new Window({ settings: { disableJavaScriptEvaluation: false, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  try {
    win.document.write(html);
    // The DOM harness disables automatic script loading; execute only the
    // hash-verified reader. CSP execution itself is checked in a real browser.
    win.eval(script);
    assert.ok(win.document.documentElement.classList.contains('folio-reader-enhanced'));
    assert.equal(win.pwned, undefined);
    assert.ok(win.document.querySelector('.folio-book-page'));
    win.document.querySelector('[data-book-next]').click();
    assert.match(win.document.querySelector('[data-book-position]').textContent, /^2/);
    assert.match(win.document.querySelector('#folio-book-source').textContent, /마지막 문장/);
  } finally { await win.happyDOM.close(); }
});

test('print/PDF opt-out is script-free and EPUB remains free of reader scripts', async () => {
  const html = await exportHTML(fixture(), { interactive: false });
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('id="folio-book-reader"'));
  assert.match(html, /@page\{size:A5/);
  assert.match(html, /마지막 문장/);
  const epub = new TextDecoder().decode(await buildEpub(fixture()));
  assert.ok(!epub.includes('folio-book-runtime'));
  assert.ok(!epub.includes('<script'));
  assert.match(epub, /application\/epub\+zip/);
});

test('EPUB publishing metadata escapes values and includes only valid ISBN and dates', async () => {
  const publication = { publisher: '출판사 & <태그>', isbn: '978-89-5533-264-8', publicationDate: '2026-10-19', rightsStatement: '© 독자 & 저자' };
  // Use a known checksum-valid ISBN13.
  publication.isbn = '978-0-306-40615-7';
  const epub = new TextDecoder().decode(await buildEpub(fixture({ publication })));
  assert.match(epub, /<dc:publisher>출판사 &amp; &lt;태그&gt;<\/dc:publisher>/);
  assert.match(epub, /<dc:identifier>urn:isbn:9780306406157<\/dc:identifier>/);
  assert.match(epub, /<dc:date>2026-10-19<\/dc:date>/);
  assert.match(epub, /<dc:rights>© 독자 &amp; 저자<\/dc:rights>/);
  const invalid = new TextDecoder().decode(await buildEpub(fixture({ publication: { isbn: '9780306406158', publicationDate: '2026-02-30' } })));
  assert.ok(!invalid.includes('urn:isbn:')); assert.ok(!invalid.includes('<dc:date>'));
});

test('publication archives reject unsafe paths and duplicate entries', () => {
  const zip = buildArchive([['book/readme.txt', '전자책 배포']]);
  assert.equal(new DataView(zip.buffer).getUint32(0, true), 0x04034b50);
  for (const path of ['../secret', '/absolute', 'book/../../secret', 'book\\secret']) assert.throws(() => buildArchive([[path, 'text']]), /파일 목록/);
  assert.throws(() => buildArchive([['a', 'one'], ['a', 'two']]), /중복/);
});
