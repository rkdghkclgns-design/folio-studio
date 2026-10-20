import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  renderBookEditor, mountBookEditor, listChapterMedia,
  serializeMediaClipboard, parseMediaClipboard, clipboardTableMarkdown,
} from './dist/book-editor.js';
import { serializeDiagram, parseDiagramBlocks } from './dist/diagrams.js';
import { renderMarkdown } from './dist/export.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const figure = extra => ({ id: 'original-image', src: PNG, alt: '원본 그림', caption: '', ...extra });
const diagram = extra => ({
  type: 'flow', title: '작업 순서', caption: '', columns: [], rows: [],
  labels: ['기획', '검수'], values: [], unit: '', evidence: [], ...extra,
});
const clone = value => JSON.parse(JSON.stringify(value));

function setup(t, options = {}) {
  const win = new Window({ url: 'https://folio.test/' });
  const chapter = options.chapter || { id: 'chapter-a', title: '본문', content: '처음 문장입니다.' };
  const errors = [], changes = [], checkpoints = [];
  let active = chapter;
  win.document.body.innerHTML = renderBookEditor(chapter, { textareaId: 'test-manuscript', titleId: 'test-title' });
  const host = win.document.querySelector('.book-editor');
  const controller = mountBookEditor(host, {
    getChapter: () => active, clipboard: options.clipboard || {},
    onBeforeChange: (value, label) => {
      checkpoints.push({ value: clone(value), label });
      return options.onBeforeChange?.(value, label);
    },
    onChange: (value, detail) => {
      changes.push({ value: clone(value), detail });
      return options.onChange?.(value, detail);
    },
    onError: error => errors.push(error),
  });
  t.after(() => { controller.destroy(); win.happyDOM.abort(); win.close(); });
  const $ = selector => host.querySelector(selector);
  const textarea = $('[data-book-editor-content]');
  const dispatch = (element, name) => element.dispatchEvent(new win.Event(name, { bubbles: true }));
  const input = (selector, value, event = 'input') => {
    const element = $(selector); element.value = value; dispatch(element, event);
  };
  const clipboardEvent = (type, values = {}, files = []) => {
    const data = new Map(Object.entries(values));
    const event = new win.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      files, items: [], getData: kind => data.get(kind) || '',
      setData: (kind, value) => data.set(kind, value),
    } });
    textarea.dispatchEvent(event);
    return { event, data };
  };
  return {
    win, chapter, host, controller, errors, changes, checkpoints, $, textarea, dispatch, input, clipboardEvent,
    click: action => $(`[data-book-edit-action="${action}"]`).click(),
    deactivate: () => { active = null; },
  };
}

test('editor markup escapes titles and manuscript while keeping scoped accessible controls', t => {
  const s = setup(t, { chapter: { title: '"><img src=x>', content: '</textarea><script>x()</script>' } });
  assert.equal(s.$('[data-book-editor-title]').value, '"><img src=x>');
  assert.equal(s.textarea.value, '</textarea><script>x()</script>');
  assert.equal(s.host.querySelector('script,img'), null);
  assert.equal(s.$('[data-book-editor-media]').disabled, true);
  assert.equal(s.$('[data-book-edit-action="copy"]').disabled, true);
});

test('content and title mutations checkpoint the original once and notify synchronously', t => {
  let notified = false;
  const s = setup(t, { onChange: () => { notified = true; } });
  s.input('[data-book-editor-content]', '변경 원고');
  assert.equal(notified, true);
  assert.equal(s.chapter.content, '변경 원고');
  assert.equal(s.checkpoints[0].value.content, '처음 문장입니다.');
  s.input('[data-book-editor-title]', '바뀐 제목');
  assert.equal(s.chapter.title, '바뀐 제목');
  assert.equal(s.checkpoints.length, 1);
  assert.deepEqual(s.changes.map(c => c.detail.kind), ['content', 'title']);
});

test('denied checkpoint restores field and avoids mutation or save', t => {
  const s = setup(t, { onBeforeChange: () => false });
  s.input('[data-book-editor-content]', '저장하면 안 됨');
  assert.equal(s.chapter.content, '처음 문장입니다.');
  assert.equal(s.textarea.value, s.chapter.content);
  assert.equal(s.changes.length, 0);
  assert.equal(s.errors.length, 1);
});

test('native plain-text paste remains browser owned and does not manufacture a mutation', t => {
  const s = setup(t);
  const { event } = s.clipboardEvent('paste', { 'text/plain': '일반 문장' });
  assert.equal(event.defaultPrevented, false);
  assert.equal(s.changes.length, 0);
});

test('TSV and quoted spreadsheet cells become a safe Markdown table', t => {
  const s = setup(t);
  s.textarea.setSelectionRange(0, s.textarea.value.length);
  const { event } = s.clipboardEvent('paste', { 'text/plain': '이름\t설명\r\n가\t"두 줄\n설명"\r\n나\t"따옴표 ""포함"""' });
  assert.equal(event.defaultPrevented, true);
  assert.match(s.chapter.content, /\| 이름 \| 설명 \|/);
  assert.match(s.chapter.content, /\| 가 \| 두 줄 설명 \|/);
  assert.match(s.chapter.content, /\| 나 \| 따옴표 "포함" \|/);
  assert.equal(s.changes.length, 1);
  assert.equal(s.checkpoints.length, 1);
});

test('HTML table discards executable markup and rejects merged or nested cells', t => {
  const s = setup(t);
  const markdown = clipboardTableMarkdown({
    html: '<table><tr><th>항목</th><th>설명</th></tr><tr><td><script>BAD()</script><b>그림</b></td><td><img src=x onerror=BAD()>안전<br>내용</td></tr></table>',
  }, s.win.document);
  assert.match(markdown, /\| 그림 \| 안전 내용 \|/);
  assert.doesNotMatch(markdown, /BAD|script|onerror|<img/);
  assert.throws(() => clipboardTableMarkdown({ html: '<table><tr><td colspan=2>병합</td><td>값</td></tr></table>' }, s.win.document), /병합/);
  assert.throws(() => clipboardTableMarkdown({ html: '<table><tr><td><table><tr><td>A</td></tr></table></td><td>B</td></tr></table>' }, s.win.document), /중첩/);
});

test('table input rejects over-limit rows, columns, cells and malformed quoted data', () => {
  assert.throws(() => clipboardTableMarkdown({ text: Array(101).fill('A\tB').join('\n') }), /100행/);
  assert.throws(() => clipboardTableMarkdown({ text: Array(21).fill('A').join('\t') }), /20열/);
  assert.throws(() => clipboardTableMarkdown({ text: `${'A'.repeat(4001)}\tB` }), /4,000자/);
  assert.throws(() => clipboardTableMarkdown({ text: 'A\t"닫히지 않음' }), /따옴표/);
  assert.equal(clipboardTableMarkdown({ text: '표가 아닌 일반 문장' }), null);
});

test('portable media clipboard validates content and strips unsupported data', () => {
  const original = figure({ presentation: { width: 55, accent: 'blue' } });
  const copied = serializeMediaClipboard({ kind: 'figure', image: original, arbitrary: 'discard' });
  const parsed = parseMediaClipboard(copied);
  assert.deepEqual(parsed.image, original);
  assert.equal(parsed.arbitrary, undefined);
  assert.equal(parseMediaClipboard('일반 문장'), null);
  assert.throws(() => parseMediaClipboard('FOLIO_MEDIA_CLIPBOARD_V1\n{bad'), /손상/);
  assert.throws(() => serializeMediaClipboard({ kind: 'figure', image: figure({ src: 'https://example.test/a.png' }) }));
  assert.throws(() => serializeMediaClipboard({ kind: 'figure', image: figure({ presentation: { width: 200 } }) }));
});

test('cross-book image paste assigns a new id and retains image style', async t => {
  const s = setup(t);
  const source = figure({ presentation: { width: 55, accent: 'blue' } });
  const { event } = s.clipboardEvent('paste', { 'text/plain': serializeMediaClipboard({ kind: 'figure', image: source }) });
  await s.controller.flush();
  assert.equal(event.defaultPrevented, true);
  assert.equal(s.chapter.figures.length, 1);
  assert.notEqual(s.chapter.figures[0].id, source.id);
  assert.equal(s.chapter.figures[0].src, source.src);
  assert.deepEqual(s.chapter.figures[0].presentation, source.presentation);
  assert.ok(s.chapter.content.includes(`folio-asset:${s.chapter.figures[0].id}`));
  assert.equal(s.errors.length, 0);
});

test('native copy of a selected image reference carries bytes across books', t => {
  const source = figure();
  const content = `![그림](folio-asset:${source.id})`;
  const s = setup(t, { chapter: { title: '장', content, figures: [source] } });
  s.textarea.setSelectionRange(0, content.length);
  const { event, data } = s.clipboardEvent('copy');
  assert.equal(event.defaultPrevented, true);
  assert.equal(parseMediaClipboard(data.get('text/plain')).image.src, PNG);
  assert.ok(data.get('application/x-folio-media+json'));
});

test('diagram copy and paste roundtrip preserves data and presentation', async t => {
  const value = diagram({ presentation: { width: 75, accent: 'rose' } });
  const content = serializeDiagram(value);
  const s = setup(t, { chapter: { title: '장', content } });
  s.textarea.setSelectionRange(0, content.length);
  const copied = s.clipboardEvent('copy');
  assert.deepEqual(parseMediaClipboard(copied.data.get('text/plain')).diagram, value);
  s.textarea.setSelectionRange(content.length, content.length);
  s.clipboardEvent('paste', { 'text/plain': copied.data.get('text/plain') });
  await s.controller.flush();
  assert.equal(parseDiagramBlocks(s.chapter.content, { strict: true }).length, 2);
  assert.equal(s.errors.length, 0);
});

test('image and diagram width and accent controls preserve surrounding manuscript', t => {
  const value = diagram();
  const source = figure();
  const s = setup(t, { chapter: { title: '장', content: `앞 문장\n\n${serializeDiagram(value)}\n\n뒤 문장`, figures: [source] } });
  s.input('[data-book-editor-width]', '50', 'change');
  s.input('[data-book-editor-accent]', 'amber', 'change');
  assert.deepEqual(source.presentation, { width: 50, accent: 'amber' });
  const item = listChapterMedia(s.chapter).find(item => item.kind === 'diagram');
  s.input('[data-book-editor-media]', item.key, 'change');
  s.input('[data-book-editor-width]', '65', 'change');
  s.input('[data-book-editor-accent]', 'blue', 'change');
  const blocks = parseDiagramBlocks(s.chapter.content, { strict: true });
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].diagram.presentation, { width: 65, accent: 'blue' });
  assert.ok(s.chapter.content.startsWith('앞 문장\n\n'));
  assert.ok(s.chapter.content.endsWith('뒤 문장'));
  assert.equal(s.errors.length, 0);
});

test('text emphasis applies the selected color and can be removed without changing words', t => {
  const s = setup(t);
  s.textarea.setSelectionRange(0, 5);
  s.input('[data-book-text-accent]', 'blue', 'change');
  s.click('highlight');
  assert.equal(s.chapter.content, '==처음 문장=={blue}입니다.');
  assert.match(renderMarkdown(s.chapter.content), /folio-text-accent-blue/);
  s.click('unhighlight');
  assert.equal(s.chapter.content, '처음 문장입니다.');
  assert.equal(s.checkpoints.length, 1);
});

test('clipboard permission denial has a manual copy fallback with complete media', async t => {
  const s = setup(t, {
    chapter: { title: '장', content: '', image: figure() },
    clipboard: { writeText: async () => { throw new Error('denied'); } },
  });
  s.click('copy');
  await s.controller.flush();
  assert.equal(s.$('[data-book-copy-fallback]').hidden, false, JSON.stringify({ errors: s.errors.map(e => e.message), media: s.$('[data-book-editor-media]').value, status: s.$('[data-book-editor-status]').textContent }));
  assert.equal(parseMediaClipboard(s.$('[data-book-copy-text]').value).image.src, PNG);
  s.click('close-copy');
  assert.equal(s.$('[data-book-copy-fallback]').hidden, true);
  assert.equal(s.$('[data-book-copy-text]').value, '');
});

test('paste toolbar uses readText fallback for tables and plain text', async t => {
  let clipboardText = '항목\t내용\nA\tB';
  const s = setup(t, { clipboard: { readText: async () => clipboardText } });
  s.click('paste');
  await s.controller.flush();
  assert.match(s.chapter.content, /\| 항목 \| 내용 \|/);
  clipboardText = '마지막 문장';
  s.click('paste');
  await s.controller.flush();
  assert.match(s.chapter.content, /마지막 문장/);
  assert.equal(s.errors.length, 0);
});

test('native image paste validates file and attaches decoded raster', async t => {
  const s = setup(t);
  s.win.Image = class {
    naturalWidth = 1; naturalHeight = 1;
    set src(value) { this.value = value; queueMicrotask(() => this.onload?.()); }
  };
  const bytes = Buffer.from(PNG.split(',')[1], 'base64');
  s.clipboardEvent('paste', {}, [{ name: '붙여넣은 그림.png', type: 'image/png', size: bytes.length, arrayBuffer: async () => bytes }]);
  await s.controller.flush();
  assert.equal(s.chapter.figures.length, 1);
  assert.equal(s.chapter.figures[0].alt, '붙여넣은 그림');
  assert.equal(s.chapter.figures[0].src, PNG);
  assert.equal(s.errors.length, 0);
});

test('oversize or unsupported image paste leaves the manuscript unchanged', async t => {
  const s = setup(t);
  const original = s.chapter.content;
  for (const file of [
    { type: 'image/png', size: 9 * 1024 * 1024 },
    { type: 'image/gif', size: 10 },
  ]) {
    const { event } = s.clipboardEvent('paste', {}, [file]);
    assert.equal(event.defaultPrevented, true);
    await s.controller.flush();
  }
  assert.equal(s.chapter.content, original);
  assert.equal(s.chapter.figures, undefined);
  assert.equal(s.errors.length, 2);
});

test('image decoding cannot overwrite manuscript edited during the asynchronous read', async t => {
  const s = setup(t);
  let finish;
  s.win.Image = class {
    naturalWidth = 1; naturalHeight = 1;
    set src(value) { finish = () => this.onload?.(); }
  };
  const bytes = Buffer.from(PNG.split(',')[1], 'base64');
  s.clipboardEvent('paste', {}, [{ type: 'image/png', size: bytes.length, arrayBuffer: async () => bytes }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finish, 'function');
  s.input('[data-book-editor-content]', '이미지를 기다리는 동안 바꾼 원고');
  finish();
  await s.controller.flush();
  assert.equal(s.chapter.content, '이미지를 기다리는 동안 바꾼 원고');
  assert.equal(s.chapter.figures, undefined);
  assert.match(s.errors[0].message, /원고가 변경/);
});

test('destroyed or detached editor ignores delayed clipboard completion', async t => {
  let finish;
  const s = setup(t, { clipboard: { readText: () => new Promise(resolve => { finish = resolve; }) } });
  const before = clone(s.chapter);
  s.click('paste');
  s.controller.destroy();
  s.host.remove();
  finish('뒤늦은 원고');
  await s.controller.flush();
  assert.deepEqual(s.chapter, before);
  assert.equal(s.errors.length, 0);
  assert.equal(s.changes.length, 0);
});

test('changed project prevents delayed image insertion and stale controls from mutating', async t => {
  let finish;
  const s = setup(t, { clipboard: { readText: () => new Promise(resolve => { finish = resolve; }) } });
  const before = clone(s.chapter);
  s.click('paste');
  s.deactivate();
  finish(serializeMediaClipboard({ kind: 'figure', image: figure() }));
  await s.controller.flush();
  s.click('table');
  s.input('[data-book-editor-content]', '잘못된 장 변경');
  assert.deepEqual(s.chapter, before);
  assert.equal(s.changes.length, 0);
});

test('synchronous save errors are reported without discarding current edits', async t => {
  const s = setup(t, { onChange: () => { throw new Error('저장 실패'); } });
  s.input('[data-book-editor-content]', '복구할 원고');
  assert.equal(s.chapter.content, '복구할 원고');
  assert.equal(s.errors[0].message, '저장 실패');
  await s.controller.flush();
});

test('asynchronous save errors are awaited and reported by flush', async t => {
  const s = setup(t, { onChange: async () => { throw new Error('비동기 저장 실패'); } });
  s.input('[data-book-editor-content]', '보존할 원고');
  await s.controller.flush();
  assert.equal(s.chapter.content, '보존할 원고');
  assert.equal(s.errors[0].message, '비동기 저장 실패');
});

test('body and book-matter title edits accept 200 characters and reject 201 without truncation', t => {
  for (const kind of ['', 'preface', 'afterword']) {
    const s = setup(t, { chapter: { id: `title-${kind}`, kind, title: '원래 제목', content: '원래 원고' } });
    const accepted = '가'.repeat(200);
    s.input('[data-book-editor-title]', accepted);
    assert.equal(s.chapter.title, accepted);
    s.input('[data-book-editor-title]', `${accepted}나`);
    assert.equal(s.chapter.title, accepted);
    assert.equal(s.$('[data-book-editor-title]').value, accepted);
    assert.equal(s.changes.length, 1);
    assert.match(s.errors[0].message, /200자.*변경을 적용하지 않았/);
    // Browser maxlength would silently truncate a pasted value before the handler can report it.
    assert.equal(s.$('[data-book-editor-title]').hasAttribute('maxlength'), false);
  }
});

test('500000-character manuscript survives editing but oversize changes are rejected atomically', t => {
  const original = '가'.repeat(499999) + '나';
  const s = setup(t, { chapter: { id: 'boundary', title: '본문', content: original } });
  const accepted = '다' + original.slice(1);
  s.input('[data-book-editor-content]', accepted);
  assert.equal(s.chapter.content, accepted);
  s.input('[data-book-editor-content]', `${accepted}라`);
  assert.equal(s.chapter.content, accepted);
  assert.equal(s.textarea.value, accepted);
  assert.equal(s.changes.length, 1);
  assert.match(s.errors[0].message, /500,000자.*기존 내용을 보존/);
});

test('over-limit image insertion retains source text and attaches no orphan media', async t => {
  const original = '가'.repeat(500000);
  const s = setup(t, { chapter: { id: 'image-boundary', kind: 'preface', title: '시작말', content: original } });
  s.textarea.setSelectionRange(original.length, original.length);
  s.clipboardEvent('paste', { 'text/plain': serializeMediaClipboard({ kind: 'figure', image: figure() }) });
  await s.controller.flush();
  assert.equal(s.chapter.content, original);
  assert.equal(s.chapter.figures, undefined);
  assert.equal(s.checkpoints.length, 0);
  assert.equal(s.changes.length, 0);
  assert.match(s.errors[0].message, /500,000자/);
});

test('table insertion and text emphasis cannot bypass the manuscript limit', async t => {
  const original = '가'.repeat(500000);
  const s = setup(t, { chapter: { id: 'toolbar-boundary', kind: 'afterword', title: '맺음말', content: original } });
  s.textarea.setSelectionRange(original.length, original.length);
  s.click('table');
  assert.equal(s.chapter.content, original);
  s.textarea.setSelectionRange(0, 1);
  s.click('highlight');
  assert.equal(s.chapter.content, original);
  assert.equal(s.changes.length, 0);
  assert.equal(s.checkpoints.length, 0);
  assert.equal(s.errors.length, 2);
});

test('diagram styling rejects serialized growth above limit and restores controls', t => {
  const block = serializeDiagram(diagram());
  const original = '가'.repeat(500000 - block.length - 2) + '\n\n' + block;
  const s = setup(t, { chapter: { id: 'diagram-boundary', title: '본문', content: original } });
  s.input('[data-book-editor-accent]', 'blue', 'change');
  assert.equal(s.chapter.content, original);
  assert.equal(s.$('[data-book-editor-accent]').value, 'none');
  assert.equal(s.changes.length, 0);
  assert.equal(s.checkpoints.length, 0);
  assert.match(s.errors[0].message, /500,000자/);
});

test('legacy over-limit text is displayed intact and can be reduced to legal limits', t => {
  const originalTitle = '가'.repeat(250);
  const originalContent = '나'.repeat(500001);
  const s = setup(t, { chapter: { id: 'legacy', title: originalTitle, content: originalContent } });
  assert.equal(s.$('[data-book-editor-title]').value, originalTitle);
  assert.equal(s.textarea.value, originalContent);
  assert.equal(s.changes.length, 0);
  s.input('[data-book-editor-title]', '수정한 제목');
  assert.equal(s.chapter.content, originalContent);
  s.input('[data-book-editor-content]', originalContent.slice(0, 500000));
  assert.equal(s.chapter.title, '수정한 제목');
  assert.equal(s.chapter.content.length, 500000);
  assert.equal(s.errors.length, 0);
  assert.equal(s.checkpoints[0].value.title, originalTitle);
  assert.equal(s.checkpoints[0].value.content, originalContent);
});
