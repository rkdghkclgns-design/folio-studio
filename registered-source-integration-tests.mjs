/** Production workflow DOM integration with mocked providers. No browser layout or live API calls. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const workspaceKey = 'folio-studio-v1';
let bootNumber = 0;

async function boot(t, { workspace } = {}) {
  const originals = new Map(), timers = new Set(), downloads = [], blobs = new Map(), requests = [];
  let win;
  const install = (name, value) => {
    if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const setupWindow = entries => {
    win = new Window({ url: 'https://folio.test', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
    win.document.body.innerHTML = '<div id="app"></div><div id="toast-region" aria-live="polite"></div><div id="modal-root"></div>';
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
    ai.clearAI(); await import(`./dist/app.js?registered-source-ui=${bootNumber++}`); await settle();
  };
  await import(`./dist/app.js?registered-source-ui=${bootNumber++}`);
  await until(() => document.querySelector('[data-action=\"editor-tab\"][data-tab=\"read\"]') && localStorage.getItem(workspaceKey));
  return { ai, install, $, $$, settle, until, click, input, key, submit, saved, save, current, attach, restart, downloads, requests, get win() { return win; } };
}

async function newBook(app) {
  await app.click('[data-action="new-project"]');
  await app.input('#new-title', '원시 소스 검증');
  await app.input('#new-author', '기록자');
}

test('preview is the default and Markdown survives edit/preview switching safely', async t => {
  const app = await boot(t);
  assert.ok(!document.querySelector('#manuscript-text'));
  assert.ok(app.$('.read-content'));
  await app.click('[data-action="editor-tab"][data-tab="write"]');
  await app.input('#manuscript-text', '## 작은 기록\n\n**굵은 글씨**와 <script>window.injected=true</script>');
  await app.click('[data-action="editor-tab"][data-tab="read"]');
  assert.equal(app.$('.read-content h3').textContent, '작은 기록');
  assert.equal(app.$('.read-content strong').textContent, '굵은 글씨');
  assert.ok(!document.querySelector('.read-content script'));
  await app.click('[data-action="editor-tab"][data-tab="write"]');
  assert.match(app.$('#manuscript-text').value, /window.injected/);
});

test('new-book source is separate from manuscript and seeds a distinct approval-gated production book', async t => {
  const app = await boot(t);
  await newBook(app);
  await app.input('#new-source', '# 조사\n원본 수치는 12명입니다.');
  await app.input('#new-content', '# 첫 장\n이미 쓴 본문입니다.');
  await app.submit('#new-project-form');
  await app.until(() => app.current()?.title === '원시 소스 검증');
  const original = structuredClone(app.current());
  assert.equal(original.registeredSources.sourceMarkdown, '# 조사\n원본 수치는 12명입니다.');
  assert.equal(original.chapters[0].content, '이미 쓴 본문입니다.');
  assert.ok(!document.querySelector('#manuscript-text'));
  await app.click('[data-action="registered-source-production"]');
  assert.equal(app.$('#production-source').value, original.registeredSources.sourceMarkdown);
  await app.submit('#production-form');
  await app.until(() => app.current()?.production);
  assert.notEqual(app.current().id, original.id);
  assert.deepEqual(app.saved().projects.find(p => p.id === original.id), original);
  assert.equal(app.requests.length, 0);
});

test('raw file preserves BOM and CRLF through storage and reload without executing its HTML', async t => {
  const app = await boot(t), raw = '\ufeff# 원본\r\n\r\n<img src=x onerror=alert(1)>  \r\n';
  await newBook(app);
  await app.attach('#new-source-file', new app.win.File([raw], '원문.txt', {type:'text/plain'}));
  await app.until(() => !app.$('#new-project-form [type="submit"]').disabled);
  assert.equal(app.$('#new-source').value, raw);
  await app.submit('#new-project-form');
  await app.until(() => app.current()?.registeredSources);
  assert.equal(app.current().registeredSources.sourceMarkdown, raw);
  await app.restart();
  assert.equal(app.current().registeredSources.sourceMarkdown, raw);
  await app.click('[data-action="registered-sources"]');
  assert.equal(app.$('#registered-source-text').value, raw);
  assert.equal(document.querySelector('.modal img[src="x"]'), null);
  assert.equal(app.requests.length, 0);
});

test('pending source read cannot submit or overwrite newer manual input', async t => {
  const app = await boot(t);
  await newBook(app);
  let finish;
  const file = new app.win.File(['old'], 'slow.md');
  Object.defineProperty(file, 'arrayBuffer', {value:()=>new Promise(resolve => {finish=resolve;})});
  await app.attach('#new-source-file', file);
  assert.equal(app.$('#new-project-form [type="submit"]').disabled, true);
  await app.input('#new-source', '직접 고친 최신 원문');
  assert.equal(app.$('#new-project-form [type="submit"]').disabled, false);
  finish(new TextEncoder().encode('오래된 파일').buffer); await app.settle(); await app.settle();
  assert.equal(app.$('#new-source').value, '직접 고친 최신 원문');
  await app.submit('#new-project-form');
  await app.until(() => app.current()?.registeredSources);
  assert.equal(app.current().registeredSources.sourceMarkdown, '직접 고친 최신 원문');
});
