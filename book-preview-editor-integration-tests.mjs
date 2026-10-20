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


const bookFixture=()=>({id:'book-edit',title:'게임기획과 AI 검증',author:'저자',language:'ko',theme:'sage',chapters:[{id:'one',title:'첫 장',content:'보존할 첫 본문.'},{id:'two',title:'둘째 장',content:'보존할 둘째 본문.'}]});
const workspaceFixture=book=>({projects:[book],activeId:book.id,histories:{}});

test('legacy book migration preserves body and creates one restorable matter checkpoint',async t=>{
 const original=bookFixture();const app=await boot(t,{workspace:workspaceFixture(original)});
 await app.until(()=>Boolean(app.current().bookMatter));
 assert.deepEqual(app.current().chapters,original.chapters);
 assert.equal(app.current().bookMatter.preface.title,'시작말');
 assert.equal(app.current().bookMatter.afterword.title,'맺음말');
 assert.equal(app.saved().histories[original.id].length,1);
 assert.deepEqual(app.saved().histories[original.id][0].project.chapters,original.chapters);
 assert.equal(app.saved().histories[original.id][0].project.bookMatter,undefined);
 await app.restart();assert.equal(app.saved().histories[original.id].length,1);
 assert.equal(app.requests.length,0);
});

test('modal editor targets selected chapter and persists matter without editing background chapter',async t=>{
 const app=await boot(t,{workspace:workspaceFixture(bookFixture())});
 await app.click('[data-action="editor-tab"][data-tab="write"]');
 await app.click('[data-action="edit-book-matter"]');
 await app.until(()=>document.querySelector('#book-modal-manuscript'));
 assert.equal(app.$('#manuscript-text').value,'보존할 첫 본문.');
 await app.input('#book-modal-manuscript','새 시작말 **강조**');
 await app.click('[data-book-save]');await app.until(()=>app.current().bookMatter.preface.content==='새 시작말 **강조**');
 await app.input('[data-book-section]','two',true);
 await app.until(()=>app.$('#book-modal-title').value==='둘째 장');
 await app.input('#book-modal-manuscript','둘째 장 편집 내용');
 await app.click('[data-book-save]');await app.until(()=>app.current().chapters[1].content==='둘째 장 편집 내용');
 assert.equal(app.current().chapters[0].content,'보존할 첫 본문.');
 await app.click('[data-book-mode="preview"]');
 await app.until(()=>app.$('[data-book-mode="preview"]').getAttribute('aria-pressed')==='true');
 await app.click('[data-book-mode="edit"]');
 assert.equal(app.$('#book-modal-title').value,'둘째 장');
 assert.equal(app.$('#book-modal-manuscript').value,'둘째 장 편집 내용');
 await app.click('[data-action="close-modal"]');
 await app.input('#manuscript-text','다시 편집한 첫 본문');await app.save();
 assert.equal(app.current().chapters[0].content,'다시 편집한 첫 본문');
 assert.equal(app.current().chapters[1].content,'둘째 장 편집 내용');
 assert.equal(app.requests.length,0);
});

test('failed modal save retains edit mode and unload guard',async t=>{
 const app=await boot(t,{workspace:workspaceFixture(bookFixture())});
 await app.click('[data-action="edit-book-matter"]');
 await app.until(()=>document.querySelector('#book-modal-manuscript'));
 app.failStorageWrites(true);await app.input('#book-modal-manuscript','저장 전 보호할 원고');
 await app.click('[data-book-mode="preview"]');
 await app.until(()=>/저장 실패/.test(app.$('[data-book-status]').textContent));
 assert.equal(app.$('[data-book-mode="edit"]').getAttribute('aria-pressed'),'true');
 assert.equal(app.$('#book-modal-manuscript').value,'저장 전 보호할 원고');
 assert.notEqual(app.current().bookMatter.preface.content,'저장 전 보호할 원고');
 const unload=new app.win.Event('beforeunload',{cancelable:true});app.win.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
 app.failStorageWrites(false);await app.click('[data-book-save]');
 await app.until(()=>app.current().bookMatter.preface.content==='저장 전 보호할 원고');
});


test('backup import rejects body and matter ID collisions without replacing the saved book',async t=>{
 const app=await boot(t,{workspace:workspaceFixture(bookFixture())});
 const before=app.saved();const invalid=bookFixture();invalid.bookMatter={preface:{id:'one',title:'시작말',content:'잘못된 ID'}};
 await app.click('[data-action="import"]');
 const file=new app.win.File([JSON.stringify({project:invalid})],'invalid.folio.json',{type:'application/json'});
 await app.attach('body > input[type="file"]',file);
 await app.until(()=>/식별자가 중복/.test(app.$('#toast-region').textContent));
 assert.deepEqual(app.saved(),before);
});

test('closing a modal with failed edits keeps the editor open for recovery',async t=>{
 const app=await boot(t,{workspace:workspaceFixture(bookFixture())});
 await app.click('[data-action="edit-book-matter"]');await app.until(()=>document.querySelector('#book-modal-manuscript'));
 app.failStorageWrites(true);await app.input('#book-modal-manuscript','닫기 전에 보존할 시작말');
 await app.click('[data-action="close-modal"]');
 await app.until(()=>/저장 실패/.test(app.$('[data-book-status]').textContent));
 assert.equal(app.$('#book-modal-manuscript').value,'닫기 전에 보존할 시작말');
 app.failStorageWrites(false);await app.click('[data-action="close-modal"]');
 await app.until(()=>!document.querySelector('.modal'));assert.equal(app.current().bookMatter.preface.content,'닫기 전에 보존할 시작말');
});
