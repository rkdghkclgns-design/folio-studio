/** AI/persistence DOM integration with mocked providers; this does not exercise browser layout. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
let bootNumber = 0;
async function boot(t) {
  const originals = new Map(), timers = new Set();
  const win = new Window({ url: 'http://localhost:4173', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
  const install = (name, value) => {
    if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  win.document.body.innerHTML = '<div id="app"></div><div id="toast-region"></div><div id="modal-root"></div>';
  Object.defineProperty(win, 'indexedDB', { configurable: true, value: undefined });
  let holdWrites = false;
  const pendingWrites = [];
  Object.defineProperty(win.navigator, 'locks', { configurable: true, value: {
    request: (_name, callback) => holdWrites ? new Promise((resolve, reject) => {
      pendingWrites.push(() => Promise.resolve().then(callback).then(resolve, reject));
    }) : Promise.resolve().then(callback),
  } });
  for (const name of ['window', 'document', 'HTMLElement', 'HTMLAnchorElement', 'FormData', 'DOMParser', 'File', 'FileReader', 'Image', 'CSS', 'localStorage', 'sessionStorage', 'navigator']) install(name, name === 'window' ? win : win[name]);
  install('setTimeout', (callback, delay, ...args) => {
    const timer = nativeSetTimeout(() => { timers.delete(timer); callback(...args); }, delay);
    timer.unref?.(); timers.add(timer); return timer;
  });
  install('clearTimeout', timer => { timers.delete(timer); nativeClearTimeout(timer); });
  install('fetch', async () => { throw new Error('Unexpected real network request'); });
  const ai = await import('./dist/ai.js');
  ai.clearAI();
  t.after(async () => {
    ai.clearAI();
    for (const timer of timers) nativeClearTimeout(timer);
    timers.clear();
    await win.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const $ = selector => { const element = document.querySelector(selector); assert.ok(element, `Missing ${selector}`); return element; };
  const settle = () => new Promise(resolve => nativeSetTimeout(resolve, 0));
  const until = async condition => { for (let i = 0; i < 100 && !condition(); i++) await settle(); assert.ok(condition(), 'Condition did not settle'); };
  const click = async selector => { $(selector).click(); await settle(); };
  const input = async (selector, value) => { const element = $(selector); element.value = value; element.dispatchEvent(new win.Event('input', { bubbles: true })); await settle(); };
  const saved = () => JSON.parse(localStorage.getItem('folio-studio-v1'));
  const persist = async () => { document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); await settle(); await settle(); };
  const provider = transform => {
    ai.configureAI({ provider: 'google', apiKey: 'AIza-ui-redteam-only-test-credential' });
    install('fetch', async (_url, options) => {
      const input = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
      const result = transform({ ...input.chapter, notes: ['문장 호흡을 검토했습니다.'], imagePrompt: '' });
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }] }), { headers: { 'Content-Type': 'application/json' } });
    });
  };
  await import(`./dist/app.js?red-ai-ui=${bootNumber++}`);
  await until(() => document.querySelector('[data-action="editor-tab"][data-tab="read"]') && localStorage.getItem('folio-studio-v1'));
  await click('[data-action="editor-tab"][data-tab="write"]');
  return { win, $, click, input, settle, until, provider, saved, persist, pauseWrites: () => { holdWrites = true; }, pendingWrites };
}

test('cancel during the final save cannot produce a normal AI success notice', async t => {
  const app = await boot(t);
  app.provider(result => ({ ...result, content: result.content.replace('한동안', '그동안') }));
  app.pauseWrites();
  await app.click('[data-action="rewrite"]');
  await app.until(() => app.pendingWrites.length === 1);
  await app.click('[data-action="cancel-operation"]');
  await app.pendingWrites.shift()();
  await app.until(() => /중지|작업을 마쳤/.test(app.$('#toast-region').textContent));
  assert.match(app.$('#toast-region').textContent, /중지/);
  assert.doesNotMatch(app.$('#toast-region').textContent, /작업을 마쳤습니다/);
  assert.equal(app.saved().projects[0].chapters[0].content.includes('그동안'), true, 'The completed save should remain preserved after cancellation');
});

test('AI persistence failure preserves source on disk and warns instead of announcing success', async t => {
  const app = await boot(t);
  const before = app.saved();
  const sourceText = before.projects[0].chapters[0].content;
  const changed = sourceText.replace('한동안', '그동안');
  app.provider(result => ({ ...result, content: changed }));
  Object.defineProperty(app.win.localStorage, 'setItem', { configurable: true, value: () => { throw new DOMException('Quota exhausted', 'QuotaExceededError'); } });
  await app.click('[data-action="rewrite"]');
  await app.until(() => /저장하지 못했습니다/.test(app.$('#toast-region').textContent));
  assert.equal(app.saved().projects[0].chapters[0].content, sourceText);
  assert.equal(app.$('#manuscript-text').value, changed, 'Unsaved generated work must remain available for backup');
  assert.match(app.$('#save-state').textContent, /저장 실패/);
  assert.ok(document.querySelector('.storage-recovery'));
  assert.doesNotMatch(app.$('#toast-region').textContent, /작업을 마쳤습니다/);
  const unload = new app.win.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true, 'Unsaved work must retain unload protection');
});

test('changed AI quantities and quotations are visible to the writer after applying the rewrite', async t => {
  const app = await boot(t);
  await app.input('#manuscript-text', '2025년의 작업 기록에는 “열 번 측정했다.”라는 문장이 있다.');
  await app.persist();
  app.provider(result => ({ ...result, content: '2026년의 작업 기록에는 “다섯 번 측정했다.”라는 문장이 있다.' }));
  await app.click('[data-action="rewrite"]');
  await app.until(() => !document.querySelector('.modal'));
  await app.click('.side-nav [data-view="quality"]');
  assert.match(app.$('#view-content').textContent, /수치 표기가 원문과 달라졌습니다/);
  assert.match(app.$('#view-content').textContent, /인용부호 안의 문장이 원문과 달라졌습니다/);
});
