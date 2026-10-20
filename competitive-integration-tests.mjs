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
    ai.clearAI(); await import(`./dist/app.js?competitive-upgrade-ui=${bootNumber++}`); await settle();
  };
  await import(`./dist/app.js?competitive-upgrade-ui=${bootNumber++}`);
  await until(() => document.querySelector('[data-action=\"editor-tab\"][data-tab=\"read\"]') && localStorage.getItem(workspaceKey));
  return { ai, install, $, $$, settle, until, click, input, key, submit, saved, save, current, attach, restart, downloads, requests, failStorageWrites(value) { storageWritesFail = value; }, get win() { return win; } };
}

test('evidence workflow saves exact source, review comments and revision-scoped approval through reload',async t=>{
 const book={id:'b',title:'출처 검증',author:'저자',language:'ko',chapters:[{id:'c',title:'자료',content:'2025년 30명이 참여했다.'}],registeredSources:{sourceMarkdown:'조사 기록\n참여자는 30명이었다.',sourceName:'자료.md'}};
 const app=await boot(t,{workspace:{projects:[book],activeId:book.id,histories:{}}});
 await app.click('[data-action="quality"]');await app.click('[data-action="review-desk"]');
 await app.input('[name="reviewer"]','편집자');await app.input('[name="claim"]','2025년 30명이 참여했다.');await app.input('[name="excerpt"]','참여자는 30명이었다.');await app.submit('[data-review-form="citation"]');
 await app.until(()=>app.current().reviewDesk?.citations.length===1);assert.equal(app.current().reviewDesk.citations[0].start,6);
 await app.input('[name="body"]','수치 확인 완료');await app.submit('[data-review-form="comment"]');await app.until(()=>app.current().reviewDesk?.comments.length===1);
 await app.click('[data-review="approve"]');assert.match(app.$('[data-review-message]').textContent,/미해결/);
 await app.click('[data-review="toggle-comment"]');await app.click('[data-review="approve"]');await app.until(()=>app.current().reviewDesk?.approvals.length===1);
 await app.click('[data-action="close-modal"]');await app.restart();assert.equal(app.current().reviewDesk.citations[0].by,'편집자');
 assert.equal(app.requests.length,0);
});

test('exchange requires disclosure consent, downloads a safe file and compares incoming changed chapters',async t=>{
 const app=await boot(t);await app.click('[data-action="export"]');await app.click('[data-action="sharing"]');
 await app.click('[data-action="sharing-export"]');assert.equal(app.downloads.length,0);
 app.$('#sharing-consent').checked=true;await app.input('#sharing-name','편집자');await app.click('[data-action="sharing-export"]');await app.until(()=>app.downloads.length===1);
 const bundle=JSON.parse(await app.downloads[0].blob.text());assert.equal(bundle.format,'folio-exchange');assert.equal(bundle.project.documentSource,undefined);assert.equal(bundle.project.registeredSources,undefined);
 bundle.project.chapters[0].content='편집자가 고친 본문입니다.';
 await app.click('[data-action="sharing-import"]');await app.attach('.file-input',new app.win.File([JSON.stringify(bundle)],'returned.json',{type:'application/json'}));
 await app.until(()=>document.querySelector('#sharing-apply-consent'));assert.equal(app.current().chapters[0].content===bundle.project.chapters[0].content,false);
 app.$('#sharing-apply-consent').checked=true;await app.click('[data-action="sharing-apply"]');await app.until(()=>app.current().chapters[0].content===bundle.project.chapters[0].content);
 assert.equal(app.saved().histories[app.current().id][0].label,'공유 원고 병합 전');assert.equal(app.requests.length,0);
});

test('EPUB imports a separate book, keeps original bytes, and rejects a broken file without changing the library',async t=>{
 const app=await boot(t),{buildEpub}=await import('./dist/export.js');
 const bytes=await buildEpub({id:'source-book',title:'가져올 EPUB',author:'테스트',language:'ko',theme:'sage',chapters:[{id:'one',title:'첫 장',content:'## 보존할 제목\n\n그대로 보존할 **본문**입니다.'}]});
 await app.click('[data-action="import"]');await app.attach('.file-input',new app.win.File([bytes],'source.epub',{type:'application/epub+zip'}));
 await app.until(()=>app.saved().projects.length===2);const imported=app.current();assert.equal(imported.title,'가져올 EPUB');assert.equal(imported.documentSource.bytes,bytes.length);
 await app.click('[data-action="document-report"]');assert.match(app.$('.modal').textContent,/source.epub/);await app.click('.modal [data-action="document-original"]');assert.equal(app.downloads[0].filename,'source.epub');assert.equal(app.downloads[0].blob.size,bytes.length);
 await app.click('[data-action="close-modal"]');await app.click('[data-action="import"]');await app.attach('.file-input',new app.win.File(['broken'],'bad.epub',{type:'application/epub+zip'}));await app.settle(30);
 assert.equal(app.saved().projects.length,2);assert.equal(app.current().title,'가져올 EPUB');assert.equal(app.requests.length,0);
});

test('a new unresolved review comment removes the completion label and persists after reload',async t=>{
 const book={id:'review-regression',title:'검토 완료 회귀',author:'저자',language:'ko',chapters:[{id:'one',title:'첫 장',content:'검토한 원고입니다.'}]};
 const app=await boot(t,{workspace:{projects:[book],activeId:book.id,histories:{}}});
 await app.click('[data-action="quality"]');await app.click('[data-action="review-desk"]');
 await app.input('[name="reviewer"]','편집자');await app.click('[data-review="approve"]');
 await app.until(()=>app.current().reviewDesk?.approvals.length===1);
 assert.match(app.$('[data-review-results] ul').textContent,/검토 완료/);
 await app.input('[name="body"]','최종 확인할 문장이 남았습니다.');await app.submit('[data-review-form="comment"]');
 await app.until(()=>app.current().reviewDesk.comments.length===1);
 assert.match(app.$('[data-review-results] ul').textContent,/검토 필요/);
 assert.doesNotMatch(app.$('[data-review-results] ul').textContent,/검토 완료/);
 await app.click('[data-action="close-modal"]');await app.restart();
 await app.click('[data-action="quality"]');await app.click('[data-action="review-desk"]');
 assert.match(app.$('[data-review-results] ul').textContent,/검토 필요/);
 assert.equal(app.current().chapters[0].content,book.chapters[0].content);
 assert.equal(app.requests.length,0);
});

test('ordinary JSON backup creates an independent book instead of keeping obsolete collaboration IDs',async t=>{
 const app=await boot(t),{createExchange}=await import('./dist/collaboration.js');
 const source={id:'original-book',title:'독립 복사본',author:'저자',language:'ko',chapters:[{id:'original-chapter',title:'원고',content:'보존할 본문'}]};
 source.collaboration=(await createExchange(source,{name:'저자'})).origin;
 const backup={format:'folio-project',version:1,project:source};
 await app.click('[data-action="import"]');await app.attach('.file-input',new app.win.File([JSON.stringify(backup)],'backup.folio.json',{type:'application/json'}));
 await app.save();await app.until(()=>app.saved().projects.length===2);
 const imported=app.current();assert.notEqual(imported.id,source.id);assert.notEqual(imported.chapters[0].id,source.chapters[0].id);
 assert.equal(imported.collaboration,undefined);assert.equal(imported.chapters[0].content,source.chapters[0].content);
 const next=await createExchange(imported,{name:'새 저자'});assert.equal(next.origin.bookId,imported.id);
 assert.ok(next.origin.base.some(([key])=>key==='chapter:'+imported.chapters[0].id));
 assert.ok(!next.origin.base.some(([key])=>key==='chapter:original-chapter'));
});

test('closing sharing while a file is still reading prevents a stale comparison dialog',async t=>{
 const app=await boot(t),{createExchange}=await import('./dist/collaboration.js');
 const {exchange}=await createExchange(app.current(),{name:'편집자'});
 await app.click('[data-action="export"]');await app.click('[data-action="sharing"]');await app.click('[data-action="sharing-import"]');
 const file=new app.win.File([JSON.stringify(exchange)],'delayed.exchange.json',{type:'application/json'});
 let finish;Object.defineProperty(file,'text',{value:()=>new Promise(resolve=>{finish=resolve;})});
 await app.attach('.file-input',file);assert.equal(typeof finish,'function');
 await app.click('[data-action="close-modal"]');finish(JSON.stringify(exchange));await app.settle(30);
 assert.equal(Boolean(document.querySelector('.modal')),false);
 assert.equal(app.saved().projects.length,1);assert.equal(app.requests.length,0);
});

test('failed shared-book saves keep the import dialog open and retry cannot duplicate the book',async t=>{
 const app=await boot(t),{createExchange}=await import('./dist/collaboration.js');
 const {exchange}=await createExchange({id:'another-book',title:'저장 오류 회귀',author:'저자',language:'ko',chapters:[{id:'c',title:'원고',content:'손실 없이 보존할 문장'}]},{name:'편집자'});
 await app.click('[data-action="export"]');await app.click('[data-action="sharing"]');await app.click('[data-action="sharing-import"]');
 await app.attach('.file-input',new app.win.File([JSON.stringify(exchange)],'shared.exchange.json',{type:'application/json'}));
 await app.until(()=>document.querySelector('[data-action="sharing-new"]'));
 app.failStorageWrites(true);
 try {
   await app.click('[data-action="sharing-new"]');await app.until(()=>document.querySelector('#toast-region')?.textContent.includes('현재 탭'));
   assert.ok(document.querySelector('[data-action="sharing-new"]'));assert.equal(app.saved().projects.length,1);
   assert.doesNotMatch(app.$('#toast-region').textContent,/새 책으로 가져왔습니다/);
   await app.click('[data-action="sharing-new"]');await app.settle();
 } finally {app.failStorageWrites(false);}
 await app.click('[data-action="sharing-new"]');await app.until(()=>app.saved().projects.length===2);
 assert.equal(app.saved().projects.filter(project=>project.title==='저장 오류 회귀').length,1);
 assert.equal(app.current().chapters[0].content,'손실 없이 보존할 문장');
 assert.equal(Boolean(document.querySelector('.modal')),false);
});
