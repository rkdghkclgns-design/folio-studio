/** Toolbar and output regression coverage. No browser layout or live API calls. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { withoutPlaceholderHeadings } from './dist/manuscript.js';
import { renderMarkdown, prepareBookPreview, exportHTML, exportMarkdown } from './dist/export.js';

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const workspaceKey = 'folio-studio-v1';
let bootNumber = 0;

async function boot(t, { workspace } = {}) {
  const originals = new Map(), timers = new Set(), downloads = [], blobs = new Map(), requests = [];
  let win, storageWritesFail = false;
  const install = (name, value) => {
    if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const setupWindow = entries => {
    win = new Window({ url: 'https://folio.test', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
    win.document.body.innerHTML = '<div id="app"></div><div id="toast-region" aria-live="polite"></div><div id="modal-root"></div>';
    const storage = win.localStorage;
    // Happy DOM binds storage methods through a proxy, so prototype replacement
    // cannot simulate quota errors. Inject the standard Storage interface instead.
    Object.defineProperty(win, 'localStorage', { configurable: true, value: {
      get length() { return storage.length; },
      key: index => storage.key(index), getItem: key => storage.getItem(key),
      removeItem: key => storage.removeItem(key), clear: () => storage.clear(),
      setItem: (key, value) => {
        if (storageWritesFail) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        storage.setItem(key, value);
      },
    } });
    for (const name of ['window', 'document', 'HTMLElement', 'HTMLAnchorElement', 'FormData', 'DOMParser', 'File', 'FileReader', 'Image', 'CSS', 'localStorage', 'sessionStorage', 'navigator']) install(name, name === 'window' ? win : win[name]);
    Object.defineProperty(win, 'indexedDB', { configurable: true, value: undefined });
    for (const [key, value] of Object.entries(entries)) win.localStorage.setItem(key, value);
    win.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, href: this.href, blob: blobs.get(this.href) }); };
  };
  install('setTimeout', (callback, delay, ...args) => {
    const timer = nativeSetTimeout(() => { timers.delete(timer); callback(...args); }, delay);
    timer.unref?.(); timers.add(timer); return timer;
  });
  install('clearTimeout', timer => { timers.delete(timer); nativeClearTimeout(timer); });
  install('fetch', async (url, options) => { requests.push({ url, options }); throw new Error('Unexpected network request in production UI integration'); });
  const oldCreateObjectURL = URL.createObjectURL, oldRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = blob => { const url = `blob:folio-production-test-${blobs.size + 1}`; blobs.set(url, blob); return url; };
  URL.revokeObjectURL = () => {};
  setupWindow(workspace ? { [workspaceKey]: JSON.stringify(workspace) } : {});
  const ai = await import('./dist/ai.js'); ai.clearAI();
  t.after(async () => {
    ai.clearAI();
    for (const timer of timers) nativeClearTimeout(timer);
    timers.clear(); await win.happyDOM.close();
    URL.createObjectURL = oldCreateObjectURL; URL.revokeObjectURL = oldRevokeObjectURL;
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const $ = selector => { const element = document.querySelector(selector); assert.ok(element, `Missing ${selector}`); return element; };
  const $$ = selector => [...document.querySelectorAll(selector)];
  const settle = async (delay = 0) => { await new Promise(resolve => nativeSetTimeout(resolve, delay)); };
  const until = async (condition, message = 'Condition did not settle') => {
    for (let i = 0; i < 300 && !condition(); i++) await settle();
    assert.ok(condition(), `${message}: ${document.querySelector('#toast-region')?.textContent || ''}`);
  };
  const click = async selector => { $(selector).click(); await settle(); };
  const input = async (selector, value, change = false) => {
    const element = $(selector); element.value = value;
    element.dispatchEvent(new win.Event('input', { bubbles: true }));
    if (change) element.dispatchEvent(new win.Event('change', { bubbles: true }));
    await settle();
  };
  const key = async (key, options = {}) => { const event = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }); document.dispatchEvent(event); await settle(); return event; };
  const submit = async selector => { $(selector).dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); await settle(); };
  const saved = () => JSON.parse(localStorage.getItem(workspaceKey));
  const save = async () => { await key('s', { ctrlKey: true }); await settle(); return saved(); };
  const current = () => { const state = saved(); return state.projects.find(project => project.id === state.activeId); };
  const attach = async (selector, file) => {
    const element = $(selector); Object.defineProperty(element, 'files', { configurable: true, value: [file] });
    element.dispatchEvent(new win.Event('change', { bubbles: true })); await settle(); await settle();
  };
  const restart = async () => {
    const entries = Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)]; }));
    for (const timer of timers) nativeClearTimeout(timer);
    timers.clear(); await win.happyDOM.close(); setupWindow(entries);
    ai.clearAI(); await import(`./dist/app.js?heading-visibility-ui=${bootNumber++}`); await settle();
  };
  await import(`./dist/app.js?competitive-upgrade-ui=${bootNumber++}`);
  await until(() => document.querySelector('[data-action=\"editor-tab\"][data-tab=\"read\"]') && localStorage.getItem(workspaceKey));
  return { ai, install, $, $$, settle, until, click, input, key, submit, saved, save, current, attach, restart, downloads, requests, failStorageWrites(value) { storageWritesFail = value; }, get win() { return win; } };
}

const bookFixture = content => ({ id: 'format-book', title: '서식 검증', author: '저자', language: 'ko', theme: 'sage', chapters: [{ id: 'format-chapter', title: '실제 장 제목', content }] });
const workspaceFixture = book => ({ projects: [book], activeId: book.id, histories: {} });

test('preview toolbar switches to edit without inserting content; repeated unselected formatting stays inert', async t => {
  const content = '변경하면 안 되는 원고입니다.\n\n다음 문단도 그대로 보존합니다.';
  const app = await boot(t, { workspace: workspaceFixture(bookFixture(content)) });
  const initialHistories = structuredClone(app.saved().histories);
  assert.equal(app.$('[data-action="editor-tab"][data-tab="read"]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('#manuscript-text'), null);
  await app.click('[data-action="format"][data-format="heading"]');
  assert.equal(app.$('[data-action="editor-tab"][data-tab="write"]').getAttribute('aria-pressed'), 'true');
  assert.equal(app.$('#manuscript-text').value, content);
  assert.match(app.$('#toast-region').textContent, /선택/);
  for (let repeat = 0; repeat < 3; repeat++) for (const format of ['heading', 'bold', 'quote']) {
    const editor = app.$('#manuscript-text'); editor.setSelectionRange(0, 0);
    await app.click(`[data-action="format"][data-format="${format}"]`);
    assert.equal(editor.value, content, `${format} must not invent placeholder text`);
  }
  await app.save(); assert.equal(app.current().chapters[0].content, content);
  assert.deepEqual(app.saved().histories, initialHistories, 'empty selections must not create history entries beyond the initial migration checkpoint');
  assert.equal(app.requests.length, 0);
});

test('heading applies to selected text and paragraph removes only the current line heading at boundaries', async t => {
  const sentence = '직접 선택한 문장', content = sentence + '\n\n다음 본문입니다.';
  const app = await boot(t, { workspace: workspaceFixture(bookFixture(content)) });
  await app.click('[data-action="editor-tab"][data-tab="write"]');
  let editor = app.$('#manuscript-text'); editor.setSelectionRange(0, sentence.length);
  await app.click('[data-action="format"][data-format="heading"]');
  assert.ok(editor.value.startsWith('## ' + sentence + '\n\n'));
  assert.doesNotMatch(editor.value, /소제목/);
  editor.setSelectionRange(0, 0);
  await app.click('[data-action="format"][data-format="paragraph"]');
  assert.ok(editor.value.startsWith(sentence + '\n\n')); assert.ok(!editor.value.startsWith('#'));
  await app.input('#manuscript-text', '## 앞 제목\n## 뒤 제목\n보존할 본문');
  editor = app.$('#manuscript-text'); const secondStart = editor.value.indexOf('\n') + 1;
  editor.setSelectionRange(secondStart, secondStart);
  await app.click('[data-action="format"][data-format="paragraph"]');
  assert.equal(editor.value, '## 앞 제목\n뒤 제목\n보존할 본문', 'a cursor at the second line start must not strip the first line');
  await app.save(); assert.equal(app.current().chapters[0].content, editor.value);
  assert.equal(app.requests.length, 0);
});

test('legacy placeholder headings disappear in preview while editing and JSON backups retain the original manuscript', async t => {
  const content = '## 소제목\n\n## 소제목\n\n## 실제로 작성한 소제목\n\n이 문장에서 소제목이라는 단어는 필요합니다.';
  const app = await boot(t, { workspace: workspaceFixture(bookFixture(content)) });
  const headingText = app.$$('.read-content h1, .read-content h2, .read-content h3, .read-content h4, .read-content h5, .read-content h6').map(el => el.textContent);
  assert.deepEqual(headingText, ['실제로 작성한 소제목']);
  assert.match(app.$('.read-content').textContent, /소제목이라는 단어/);
  await app.click('[data-action="editor-tab"][data-tab="write"]');
  assert.equal(app.$('#manuscript-text').value, content);
  await app.save(); assert.equal(app.current().chapters[0].content, content);
  await app.click('[data-action="export"]'); await app.click('[data-action="backup"]');
  const backup = JSON.parse(await app.downloads.at(-1).blob.text());
  assert.equal(backup.format, 'folio-project'); assert.equal(backup.project.chapters[0].content, content);
  assert.equal(app.requests.length, 0);
});

test('placeholder cleanup removes only exact legacy template headings and preserves fences and genuine language', () => {
  const input = [
    '## 소제목', '   ##\t소제목  ', '## 소제목을 쓰는 방법', '### 소제목', '# 소제목', '## 소제목 ###',
    '소제목', '소제목이라는 단어가 포함된 문장.',
    '```markdown', '## 소제목', '```',
    '~~~~markdown', '## 소제목', '~~~', '## 소제목', '~~~~', '## 소제목',
    '    ## 소제목'
  ].join('\n');
  const expected = [
    '', '', '## 소제목을 쓰는 방법', '### 소제목', '# 소제목', '## 소제목 ###',
    '소제목', '소제목이라는 단어가 포함된 문장.',
    '```markdown', '## 소제목', '```',
    '~~~~markdown', '## 소제목', '~~~', '## 소제목', '~~~~', '',
    '    ## 소제목'
  ].join('\n');
  assert.equal(withoutPlaceholderHeadings(input), expected);
  assert.equal(withoutPlaceholderHeadings('## 소제목\r\n\r\n본문'), '\n\n본문');
  assert.equal(withoutPlaceholderHeadings('```\n## 소제목'), '```\n## 소제목', 'an unclosed code fence must retain its source');
});

test('reading, book preview, standalone HTML and Markdown exports filter placeholders without mutating source', async () => {
  const content = '## 소제목\n\n## 소제목\n\n## 소제목을 정확히 작성하기\n\n소제목이라는 단어를 설명합니다.\n\n```markdown\n## 소제목\n```';
  const book = bookFixture(content), original = JSON.stringify(book), cleaned = withoutPlaceholderHeadings(content);
  const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
  const checkHTML = html => {
    win.document.body.innerHTML = html;
    assert.equal([...win.document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(el => el.textContent === '소제목').length, 0);
    assert.ok([...win.document.querySelectorAll('h1,h2,h3,h4,h5,h6')].some(el => el.textContent === '소제목을 정확히 작성하기'));
    assert.match(win.document.querySelector('pre').textContent, /## 소제목/);
    assert.match(win.document.body.textContent, /소제목이라는 단어를 설명합니다/);
  };
  try {
    checkHTML(renderMarkdown(content));
    const preview = await prepareBookPreview(book);
    checkHTML(preview.sections.find(section => section.id === 'chapter-1').html);
    checkHTML(await exportHTML(book));
    checkHTML(await exportHTML(book, { interactive: false }));
    const markdown = exportMarkdown(book);
    assert.ok(markdown.includes(cleaned.trim()));
    assert.match(markdown, /```markdown\n## 소제목\n```/);
    assert.equal(JSON.stringify(book), original, 'all reading and export paths must leave the stored manuscript untouched');
  } finally { await win.happyDOM.close(); }
});
