/** Computer capture DOM integration. Simulated provider responses; no browser layout or live API calls. */
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
  install('fetch', async (url, options) => { requests.push({ url, options }); throw new Error('Unexpected network request in diagram UI integration'); });
  const oldCreateObjectURL = URL.createObjectURL, oldRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = blob => { const url = `blob:folio-computer-test-${blobs.size + 1}`; blobs.set(url, blob); return url; };
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
    for (let i = 0; i < 1500 && !condition(); i++) await settle();
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
    const element = $(selector); Object.defineProperty(element, 'files', { configurable: true, value: Array.isArray(file) ? file : [file] });
    element.dispatchEvent(new win.Event('change', { bubbles: true })); await settle(); await settle();
  };
  const restart = async () => {
    const entries = Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)]; }));
    for (const timer of timers) nativeClearTimeout(timer);
    timers.clear(); await win.happyDOM.close(); setupWindow(entries);
    ai.clearAI(); await import(`./dist/app.js?computer-book-ui=${bootNumber++}`); await settle();
  };
  await import(`./dist/app.js?computer-book-ui=${bootNumber++}`);
  await until(() => document.querySelector('#manuscript-text') && localStorage.getItem(workspaceKey));
  return { ai, install, $, $$, settle, until, click, input, key, submit, saved, save, current, attach, restart, downloads, requests, get win() { return win; } };
}

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
function captureWorkspace(){
 const record={id:'screen-one',capturedAt:'2026-10-18T00:00:00.000Z',windowTitle:'MapleStory Worlds',title:'발판 속성',caption:'선택한 발판의 속성',extractedText:'오브젝트를 선택한 뒤 속성 창에서 값을 확인한다.',src:PNG,steps:['속성 창을 촬영했다.']};
 const book={id:'computer-book',title:'월드 만들기',author:'집필자',language:'ko',theme:'sage',chapters:[{id:'one',title:'첫 예제',content:'이미 작성한 원고'},{id:'two',title:'다음 예제',content:'다음 장 원고'}],computerResearch:{version:1,goal:'발판 배치 예제',target:'MapleStory Worlds',records:[record]}};
 return {projects:[book],activeId:book.id,histories:{}};
}

test('computer workshop inserts saved evidence into its original chapter and restores inline figures after reload',async t=>{
 const app=await boot(t,{workspace:captureWorkspace()});
 await app.click('[data-action="computer-studio"]');
 assert.equal(app.$('#computer-record-title-0').value,'발판 속성');
 await app.click('[data-computer-select="screen-one"]');
 await app.click('[data-computer-action="insert"]');
 await app.until(()=>app.current().chapters[0].figures?.length===1);
 await app.until(()=>!app.$('[data-computer-action="insert"]').disabled||/넣었습니다/.test(app.$('#computer-feedback').textContent));
 assert.ok(app.current().chapters[0].content.startsWith('이미 작성한 원고\n\n'));
 assert.equal(app.current().chapters[1].content,'다음 장 원고');
 await app.click('.modal [data-action="close-modal"]');
 assert.equal(app.$('.read-content figure img').getAttribute('src'),PNG);
 await app.click('[data-action="backup"]');
 const backup=JSON.parse(await app.downloads.at(-1).blob.text());
 assert.equal(backup.project.computerResearch.records[0].src,PNG);
 assert.equal(backup.project.chapters[0].figures[0].src,PNG);
 assert.ok(!JSON.stringify(backup).includes('sessionId'));
 await app.restart();
 await app.click('[data-action="editor-tab"][data-tab="read"]');
 assert.equal(app.$('.read-content figure img').getAttribute('src'),PNG);
 assert.equal(app.requests.length,0);
});

test('closing the workshop retains edited captions and no pairing credentials in project backup',async t=>{
 const app=await boot(t,{workspace:captureWorkspace()});
 await app.click('[data-action="computer-studio"]');
 await app.input('#computer-record-caption-0','직접 검토하여 수정한 캡션');
 await app.input('#computer-token','a'.repeat(64));
 await app.click('.modal [data-action="close-modal"]');
 await app.until(()=>app.current().computerResearch.records[0].caption==='직접 검토하여 수정한 캡션');
 assert.ok(!JSON.stringify(app.saved()).includes('a'.repeat(64)));
 await app.click('[data-action="computer-studio"]');
 assert.equal(app.$('#computer-record-caption-0').value,'직접 검토하여 수정한 캡션');
 assert.equal(app.$('#computer-token').value,'');
 assert.equal(app.requests.length,0);
});

test('JSON import keeps research originals and inline figures instead of stripping new book fields',async t=>{
 const workspace=captureWorkspace(),book=workspace.projects[0];
 book.chapters[0].figures=[{id:'pc-screen-one',src:PNG,alt:'발판 속성',caption:'속성'}];
 book.chapters[0].content+='\n\n![발판 속성](folio-asset:pc-screen-one)';
 const app=await boot(t,{workspace});
 let picked;
 app.win.HTMLInputElement.prototype.click=function(){if(this.type==='file')picked=this;};
 await app.click('[data-action="import"]');
 assert.ok(picked);
 const file=new app.win.File([JSON.stringify({project:book})],'practice.json',{type:'application/json'});
 Object.defineProperty(picked,'files',{value:[file],configurable:true});
 picked.dispatchEvent(new app.win.Event('change',{bubbles:true}));
 await app.until(()=>app.$('.project-head h1').textContent==='월드 만들기'&&app.$('#manuscript-text').value.includes('folio-asset'));
 await app.save();
 await app.until(()=>app.saved().projects.length===2);
 assert.notEqual(app.current().id,book.id);
 assert.deepEqual(app.current().computerResearch,book.computerResearch);
 assert.deepEqual(app.current().chapters[0].figures,book.chapters[0].figures);
});
