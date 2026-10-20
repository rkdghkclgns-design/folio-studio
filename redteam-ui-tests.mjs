/** Red-team DOM integration only. happy-dom does not render layouts or test a browser. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
let importNumber = 0;

async function boot(t) {
  const originals = new Map();
  const timers = new Set();
  const win = new Window({ url: 'http://localhost:4173', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
  function install(name, value) {
    if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  win.document.body.innerHTML = '<div id="app"></div><div id="toast-region" aria-live="polite"></div><div id="modal-root"></div>';
  for (const name of ['window', 'document', 'HTMLElement', 'HTMLAnchorElement', 'FormData', 'DOMParser', 'File', 'FileReader', 'Image', 'CSS', 'localStorage', 'sessionStorage', 'navigator']) install(name, name === 'window' ? win : win[name]);
  Object.defineProperty(win, 'indexedDB', { configurable: true, value: undefined });
  install('setTimeout', (callback, delay, ...args) => {
    const timer = nativeSetTimeout(() => { timers.delete(timer); callback(...args); }, delay);
    timer.unref?.(); timers.add(timer); return timer;
  });
  install('clearTimeout', timer => { timers.delete(timer); nativeClearTimeout(timer); });
  install('fetch', async () => { throw new Error('Unexpected real network request'); });
  let ai;
  t.after(async () => {
    ai?.clearAI();
    for (const timer of timers) nativeClearTimeout(timer);
    timers.clear();
    await win.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  ai = await import('./dist/ai.js');
  ai.clearAI();
  const $ = selector => { const element = win.document.querySelector(selector); assert.ok(element, `Missing ${selector}`); return element; };
  const settle = async (delay = 0) => { await new Promise(resolve => nativeSetTimeout(resolve, delay)); };
  const click = async selector => { $(selector).click(); await settle(); };
  const input = async (selector, value, change = false) => {
    const element = $(selector); element.value = value;
    element.dispatchEvent(new win.Event('input', { bubbles: true }));
    if (change) element.dispatchEvent(new win.Event('change', { bubbles: true }));
    await settle();
  };
  const navigate = view => click(`.side-nav [data-view="${view}"]`);
  const submit = async selector => { $(selector).dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); await settle(); };
  const save = async () => {
    document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    await settle(); await settle();
    return JSON.parse(localStorage.getItem('folio-studio-v1'));
  };
  const current = async () => { const state = await save(); return state.projects.find(project => project.id === state.activeId); };
  const delayedImage = async (action, filename = 'slow-illustration.png') => {
    const pending = [];
    install('FileReader', class {
      readAsDataURL() { this.result = PNG; this.onload?.(); }
    });
    install('Image', class {
      constructor() { pending.push(this); this.width = 400; this.height = 600; }
      set src(value) { this.source = value; }
    });
    await click(`[data-action="${action}"]`);
    const fileInput = $('input[type="file"]');
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [new win.File(['validity simulated by decoder'], filename, { type: 'image/png' })] });
    fileInput.dispatchEvent(new win.Event('change', { bubbles: true }));
    await settle();
    assert.equal(pending.length, 1, 'Decode must remain pending during the navigation race');
    return async () => { pending[0].onload(); await settle(); await settle(); };
  };
  await import(`./dist/app.js?red-ui=${Date.now()}-${importNumber++}`);
  await settle();
  await click("[data-action=\"editor-tab\"][data-tab=\"write\"]");
  return { win, ai, install, $, settle, click, input, navigate, submit, save, current, delayedImage };
}

test('delayed chapter upload never applies to a different selected chapter', async t => {
  const app = await boot(t);
  const before = await app.current();
  await app.navigate('design');
  const finishDecode = await app.delayedImage('upload-chapter');
  await app.click(`.chapter-link[data-id="${before.chapters[1].id}"]`);
  app.$('#manuscript-text').focus();
  app.$('#manuscript-text').setSelectionRange(4, 7);
  await finishDecode();
  const after = await app.current();
  assert.deepEqual(after.chapters[1].image, before.chapters[1].image, 'Background decode must not alter the newly selected chapter');
  assert.equal(after.chapters[0].image?.src, PNG, 'The upload belongs to the chapter selected when it was initiated');
  assert.equal(app.$('.chapter-link.active').dataset.id, before.chapters[1].id);
  assert.ok(document.querySelector('#manuscript-text'), 'Background completion must not navigate away from the current editor');
  assert.equal(document.activeElement === app.$('#manuscript-text'), true, 'Completing another chapter upload must not interrupt typing');
  assert.equal(app.$('#manuscript-text').selectionStart, 4);
  assert.equal(app.$('#manuscript-text').selectionEnd, 7);
});

test('delayed cover upload never applies to a different active book', async t => {
  const app = await boot(t);
  const original = await app.current();
  await app.navigate('design');
  const finishDecode = await app.delayedImage('upload-cover');
  await app.click('[data-action="library"]');
  await app.click('.modal [data-action="new-project"]');
  await app.input('#new-title', '다른 책');
  await app.input('#new-author', '다른 저자');
  await app.submit('#new-project-form');
  const second = await app.current();
  assert.notEqual(second.id, original.id);
  await finishDecode();
  const state = await app.save();
  const oldBook = state.projects.find(project => project.id === original.id);
  const newBook = state.projects.find(project => project.id === second.id);
  assert.equal(newBook.coverImage, undefined, 'Finishing an old upload must not overwrite another book cover');
  assert.equal(oldBook.coverImage?.src, PNG);
  assert.equal(state.activeId, second.id, 'Background completion must preserve the currently selected book');
});

test('a delayed upload is discarded when its chapter was deleted', async t => {
  const app = await boot(t);
  const before = await app.current();
  await app.navigate('design');
  const finishDecode = await app.delayedImage('upload-chapter');
  await app.navigate('editor');
  await app.click('[data-action="chapter-menu"]');
  await app.click('[data-action="confirm-delete-chapter"]');
  await app.click('[data-action="confirm-chapter"]');
  await finishDecode();
  const after = await app.current();
  assert.equal(after.chapters.length, before.chapters.length - 1);
  assert.equal(after.chapters.some(chapter => chapter.id === before.chapters[0].id), false);
  assert.equal(after.chapters.some(chapter => chapter.image?.src === PNG), false, 'Removed target must not redirect upload to the next chapter');
});

test('an older slow upload cannot overwrite a newer completed upload to the same target', async t => {
  const app = await boot(t);
  await app.navigate('design');
  const finishOlder = await app.delayedImage('upload-cover', 'older.png');
  const finishNewer = await app.delayedImage('upload-cover', 'newer.png');
  await finishNewer();
  assert.equal((await app.current()).coverImage?.alt, 'newer');
  await finishOlder();
  assert.equal((await app.current()).coverImage?.alt, 'newer', 'Completion order must not override the most recent upload choice');
});

test('closing paginated preview restores focus to its original opener', async t => {
  const app = await boot(t);
  const opener = app.$('.project-head-actions [data-action="preview"]');
  opener.focus();
  opener.click();
  await app.settle(15);
  const next = app.$('.modal [data-book-next]');
  next.focus(); next.click();
  await app.settle(15);
  document.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelector('.modal'), null);
  assert.equal(document.activeElement === opener, true, 'Repeated modal rendering must retain the original external focus target');
});

test('nested new-book modal restores keyboard focus to the external library opener', async t => {
  const app = await boot(t);
  const opener = app.$('.side-nav [data-action="library"]');
  opener.focus(); opener.click();
  await app.settle(15);
  const newBook = app.$('.modal [data-action="new-project"]');
  newBook.focus(); newBook.click();
  await app.settle(15);
  await app.click('#new-project-form [data-action="close-modal"]');
  assert.equal(document.activeElement === opener, true, 'Cancel must restore usable focus, not a removed modal button');
});

test('a modal isolates background editing and removes the isolation when closed', async t => {
  const app = await boot(t);
  await app.click('[data-action="settings"]');
  assert.ok(app.$('#app').inert || app.$('#app').hasAttribute('inert'), 'The editor behind an aria-modal dialog must be inert');
  await app.click('.modal [data-action="close-modal"]');
  assert.equal(Boolean(app.$('#app').inert || app.$('#app').hasAttribute('inert')), false);
});

test('editor language label follows the selected manuscript language', async t => {
  const app = await boot(t);
  for (const [code, label] of [['en', 'English'], ['ja', '日本語'], ['ko', '한국어']]) {
    await app.navigate('design');
    await app.input('#meta-language', code, true);
    await app.navigate('editor');
    assert.equal((await app.current()).language, code);
    assert.ok(app.$('.editor-footer').textContent.includes(label), `Editor must report ${label} for ${code} manuscript metadata`);
  }
});

test('pending generation ignores background edits and duplicate actions, then cancellation unlocks editing', async t => {
  const app = await boot(t);
  const before = await app.current();
  app.ai.configureAI({ provider: 'google', apiKey: 'AIza-redteam-local-test-key' });
  let requests = 0;
  let requestSignal;
  app.install('fetch', async (url, options) => {
    requests++;
    requestSignal = options.signal;
    return new Promise((resolve, reject) => {
      requestSignal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    });
  });
  await app.click('[data-action="rewrite"]');
  await app.settle(15);
  assert.equal(requests, 1);
  await app.click('[data-action="rewrite"]');
  assert.equal(requests, 1, 'Duplicate rewrite must not make a second paid request');
  await app.input('#manuscript-text', '생성 작업 중 배경에서 들어온 오래된 입력');
  const during = await app.current();
  assert.equal(during.chapters[0].content, before.chapters[0].content, 'Background input must not alter the manuscript during a modal AI operation');
  const unloading = new app.win.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unloading);
  assert.equal(unloading.defaultPrevented, true, 'Pending generation must warn before leaving');
  await app.click('[data-action="cancel-operation"]');
  assert.equal(requestSignal.aborted, true);
  await app.settle();
  await app.click('.modal [data-action="close-modal"]');
  assert.equal(Boolean(app.$('#app').inert || app.$('#app').hasAttribute('inert')), false);
  await app.input('#manuscript-text', '취소 뒤에는 새 문장을 쓸 수 있습니다.');
  assert.equal((await app.current()).chapters[0].content, '취소 뒤에는 새 문장을 쓸 수 있습니다.');
  const after = new app.win.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false, 'Cancelled generation must release unload protection after persistence settles');
});

test('successful rewrite restores keyboard focus after updating the editor', async t => {
  const app = await boot(t);
  const before = await app.current();
  const rewritten = {
    title: before.chapters[0].title,
    content: before.chapters[0].content.replace('한동안 아침은', '한동안 내 아침은'),
    notes: ['문장 한 곳의 호흡을 다듬었습니다.'],
    imagePrompt: '빛이 들어오는 창가',
  };
  app.ai.configureAI({ provider: 'google', apiKey: 'AIza-redteam-local-test-key' });
  app.install('fetch', async () => new Response(JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(rewritten) }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const opener = app.$('.toolbar [data-action="rewrite"]');
  opener.focus(); opener.click();
  for (let i = 0; i < 50 && app.$('#manuscript-text').value !== rewritten.content; i++) await app.settle();
  assert.equal(app.$('#manuscript-text').value, rewritten.content, 'Mocked successful rewrite must finish');
  assert.equal(document.querySelector('.modal'), null);
  assert.equal(document.activeElement === app.$('.toolbar [data-action="rewrite"]'), true, 'Rerendering the changed manuscript must retain the restored keyboard focus');
});
