/** Adversarial DOM state tests. No rendered browser layout or live API requests. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
let bootNumber = 0;
async function boot(t) {
  const originals = new Map(), timers = new Set();
  const win = new Window({ url: 'https://folio.test', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
  const install = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  win.document.body.innerHTML = '<div id="app"></div><div id="toast-region" aria-live="polite"></div><div id="modal-root"></div>';
  Object.defineProperty(win, 'indexedDB', { configurable: true, value: undefined });
  for (const name of ['window', 'document', 'HTMLElement', 'HTMLAnchorElement', 'FormData', 'DOMParser', 'File', 'FileReader', 'Image', 'CSS', 'localStorage', 'sessionStorage', 'navigator']) install(name, name === 'window' ? win : win[name]);
  install('setTimeout', (callback, delay, ...args) => {
    const timer = nativeSetTimeout(() => { timers.delete(timer); callback(...args); }, delay);
    timer.unref?.(); timers.add(timer); return timer;
  });
  install('clearTimeout', timer => { timers.delete(timer); nativeClearTimeout(timer); });
  install('fetch', async () => { throw new Error('Unexpected network request'); });
  const ai = await import('./dist/ai.js'); ai.clearAI();
  t.after(async () => {
    ai.clearAI(); for (const timer of timers) nativeClearTimeout(timer);
    await win.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const $ = selector => { const element = document.querySelector(selector); assert.ok(element, `Missing ${selector}`); return element; };
  const settle = () => new Promise(resolve => nativeSetTimeout(resolve, 0));
  const until = async condition => { for (let i = 0; i < 150 && !condition(); i++) await settle(); assert.ok(condition(), 'Condition did not settle'); };
  const click = async selector => { $(selector).click(); await settle(); };
  const input = async (selector, value) => { const element = $(selector); element.value = value; element.dispatchEvent(new win.Event('input', { bubbles: true })); await settle(); };
  const submit = async () => { $('#production-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); await settle(); };
  const saved = () => JSON.parse(localStorage.getItem('folio-studio-v1'));
  const persist = async () => { document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); await settle(); await settle(); };
  const setItem = win.localStorage.setItem.bind(win.localStorage);
  const failWrites = () => Object.defineProperty(win.localStorage, 'setItem', { configurable: true, value: () => { throw new DOMException('Quota exhausted', 'QuotaExceededError'); } });
  const restoreWrites = () => Object.defineProperty(win.localStorage, 'setItem', { configurable: true, value: setItem });
  await import(`./dist/app.js?audit-ux=${bootNumber++}`);
  await until(() => document.querySelector('#manuscript-text') && localStorage.getItem('folio-studio-v1'));
  const brief = async (title = '저장 복구를 확인할 책') => {
    await click('[data-action="production-new"]');
    await input('#production-topic', '저장 공간이 부족할 때 책을 복구하는 방법');
    await input('#production-title', title);
    await input('#production-author', '기록자');
    await input('#production-illustrations', 'none');
  };
  return { win, $, click, input, submit, saved, persist, until, brief, failWrites, restoreWrites };
}

test('a failed new-book save keeps the visible editor aligned with its active in-memory book', async t => {
  const app = await boot(t), original = app.saved().projects[0];
  await app.brief(); app.failWrites(); await app.submit();
  await app.until(() => /저장하지 못했습니다/.test(app.$('#production-feedback').textContent));
  assert.deepEqual(app.saved().projects, [original], 'Disk must retain the original book after quota failure');
  await app.click('.modal-header [data-action="close-modal"]');
  assert.equal(app.$('.project-head h1').textContent, '저장 복구를 확인할 책', 'The editor must not show the previous book while selecting the unsaved new book');
  assert.equal(app.$('#manuscript-text').value, '', 'A newly selected production book must not display an unrelated manuscript');
  assert.ok(document.querySelector('.storage-recovery'));
  const unload = new app.win.Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
  await app.input('#manuscript-text', '복구 후 새 책에 직접 입력한 원고입니다.');
  app.restoreWrites(); await app.persist();
  const state = app.saved(), current = state.projects.find(book => book.id === state.activeId);
  assert.equal(current.title, '저장 복구를 확인할 책');
  assert.equal(current.chapters[0].content, '복구 후 새 책에 직접 입력한 원고입니다.');
  assert.deepEqual(state.projects.find(book => book.id === original.id), original, 'Typing after a failed save must never mutate the previous book');
});

test('retrying a quota-failed production form saves the same draft without creating duplicate books', async t => {
  const app = await boot(t), before = app.saved();
  await app.brief(); app.failWrites(); await app.submit();
  await app.until(() => /저장하지 못했습니다/.test(app.$('#production-feedback').textContent));
  assert.equal(app.$('#production-title').value, '저장 복구를 확인할 책');
  app.restoreWrites(); await app.submit();
  await app.until(() => document.querySelector('.production-summary'));
  assert.equal(app.saved().projects.length, before.projects.length + 1);
  assert.equal(app.saved().projects.filter(book => book.title === '저장 복구를 확인할 책').length, 1);
  assert.equal(document.querySelector('.storage-recovery'), null);
});

test('a quota-failed condition edit shows the changed draft and keeps the disk copy recoverable', async t => {
  const app = await boot(t);
  await app.brief('기존 제작 조건'); await app.submit();
  await app.until(() => document.querySelector('.production-summary'));
  const previous = app.saved();
  await app.click('[data-action="production-edit"]');
  await app.input('#production-title', '수정한 제작 조건');
  app.failWrites(); await app.submit();
  await app.until(() => /저장하지 못했습니다/.test(app.$('#production-feedback').textContent));
  await app.click('.modal-header [data-action="close-modal"]');
  assert.equal(app.$('.project-head h1').textContent, '수정한 제작 조건');
  assert.equal(app.saved().projects.find(book => book.id === previous.activeId).title, '기존 제작 조건');
  app.restoreWrites(); await app.persist();
  assert.equal(app.saved().projects.length, previous.projects.length);
  assert.equal(app.saved().projects.find(book => book.id === previous.activeId).title, '수정한 제작 조건');
});
