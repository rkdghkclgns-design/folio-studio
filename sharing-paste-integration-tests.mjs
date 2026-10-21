/** Shared exchange paste/file DOM integration; no network or live providers. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

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
    ai.clearAI(); await import(`./dist/app.js?sharing-paste-ui=${bootNumber++}`); await settle();
  };
  await import(`./dist/app.js?sharing-paste-ui=${bootNumber++}`);
  await until(() => document.querySelector('[data-action=\"editor-tab\"][data-tab=\"read\"]') && localStorage.getItem(workspaceKey));
  return { ai, install, $, $$, settle, until, click, input, key, submit, saved, save, current, attach, restart, downloads, requests, failStorageWrites(value) { storageWritesFail = value; }, get win() { return win; } };
}

async function openPaste(app){await app.click('[data-action="export"]');await app.click('[data-action="sharing"]');await app.click('[data-action="sharing-paste"]');}
async function returned(app,content='편집자가 다듬은 새 원고.'){
 const {createExchange}=await import('./dist/collaboration.js');
 const {exchange}=await createExchange(app.current(),{name:'편집자',role:'editor'});
 exchange.project.chapters[0].content=content;return exchange;
}
// Simulate a delayed editor update landing after a comparison has already opened.
// Use the real input delegate, without exposing or changing application state internals.
async function delayedEditorInput(app,value){
 const root=app.$('#modal-root'),nodes=[...root.childNodes];root.replaceChildren();
 const field=app.win.document.createElement('textarea');field.id='manuscript-text';document.body.append(field);
 field.value=value;field.dispatchEvent(new app.win.Event('input',{bubbles:true}));field.remove();root.append(...nodes);
 await app.save();
}

test('malformed pasted exchange keeps the input and manuscript for correction',async t=>{
 const app=await boot(t),before=app.current();
 await openPaste(app);const malformed='{"format":"folio-exchange", invalid';
 await app.input('#sharing-result-paste',malformed);await app.click('[data-action="sharing-paste-compare"]');
 assert.equal(app.$('#sharing-result-paste').value,malformed);
 assert.match(app.$('#toast-region').textContent,/JSON 형식/);
 assert.equal(Boolean(document.querySelector('#sharing-apply-consent')),false);
 assert.deepEqual(app.current().chapters,before.chapters);assert.equal(app.saved().projects.length,1);
 assert.equal(app.requests.length,0);
});

test('pasted exchange only merges after consent and keeps existing book and chapter IDs',async t=>{
 const app=await boot(t),before=app.current(),exchange=await returned(app);
 await openPaste(app);await app.input('#sharing-result-paste',JSON.stringify(exchange));
 await app.click('[data-action="sharing-paste-compare"]');await app.until(()=>document.querySelector('#sharing-apply-consent'));
 assert.deepEqual(app.current().chapters,before.chapters);
 await app.click('[data-action="sharing-apply"]');
 assert.match(app.$('#toast-region').textContent,/적용에 동의/);assert.deepEqual(app.current().chapters,before.chapters);
 app.$('#sharing-apply-consent').checked=true;await app.click('[data-action="sharing-apply"]');
 await app.until(()=>app.current().chapters[0].content===exchange.project.chapters[0].content);
 assert.equal(app.current().id,before.id);
 assert.deepEqual(app.current().chapters.map(c=>c.id),before.chapters.map(c=>c.id));
 assert.equal(app.saved().histories[before.id][0].label,'공유 원고 병합 전');
 assert.equal(app.saved().projects.length,1);assert.equal(app.requests.length,0);
});

test('pasted exchange refuses to apply when the manuscript changed after comparison',async t=>{
 const app=await boot(t),before=app.current(),exchange=await returned(app);
 await openPaste(app);await app.input('#sharing-result-paste',JSON.stringify(exchange));
 await app.click('[data-action="sharing-paste-compare"]');await app.until(()=>document.querySelector('#sharing-apply-consent'));
 const newer='비교 뒤에 저장한 현재 원고.';await delayedEditorInput(app,newer);
 app.$('#sharing-apply-consent').checked=true;await app.click('[data-action="sharing-apply"]');
 assert.match(app.$('#toast-region').textContent,/비교 후 원고가 바뀌었습니다/);
 assert.equal(app.current().chapters[0].content,newer);assert.equal(app.current().id,before.id);
 assert.equal(app.saved().histories[before.id]?.some(h=>h.label==='공유 원고 병합 전')||false,false);
});

test('pasted exchange for another book uses the explicit separate-book branch',async t=>{
 const app=await boot(t),before=app.current(),{createExchange}=await import('./dist/collaboration.js');
 const {exchange}=await createExchange({id:'separate',title:'다른 공유 도서',author:'저자',language:'ko',chapters:[{id:'shared-chapter',title:'공유 장',content:'별도 원고'}]},{name:'검토자'});
 await openPaste(app);await app.input('#sharing-result-paste',JSON.stringify(exchange));await app.click('[data-action="sharing-paste-compare"]');
 await app.until(()=>document.querySelector('[data-action="sharing-new"]'));
 assert.equal(app.saved().projects.length,1);assert.equal(app.current().id,before.id);
 await app.click('[data-action="sharing-new"]');await app.until(()=>app.saved().projects.length===2);
 assert.equal(app.current().title,'다른 공유 도서');assert.equal(app.current().chapters[0].id,'shared-chapter');
 assert.equal(app.saved().projects.find(p=>p.id===before.id).chapters[0].content,before.chapters[0].content);
});

test('shared file comparison rejects an original manuscript change while file text is reading',async t=>{
 const app=await boot(t),exchange=await returned(app);
 await app.click('[data-action="export"]');await app.click('[data-action="sharing"]');await app.click('[data-action="sharing-import"]');
 const file=new app.win.File([JSON.stringify(exchange)],'returned.json',{type:'application/json'});
 let finish;Object.defineProperty(file,'text',{value:()=>new Promise(resolve=>{finish=resolve;})});
 await app.attach('.file-input',file);assert.equal(typeof finish,'function');
 await delayedEditorInput(app,'파일을 읽는 동안 바뀐 원고.');
 finish(JSON.stringify(exchange));await app.until(()=>app.$('#toast-region').textContent.includes('비교 중 원고'));
 assert.equal(Boolean(document.querySelector('#sharing-apply-consent')),false);
 assert.equal(app.current().chapters[0].content,'파일을 읽는 동안 바뀐 원고.');
});
