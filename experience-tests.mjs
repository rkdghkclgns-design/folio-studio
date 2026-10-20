/** Interaction/accessibility integration in happy-dom. This does not render or automate a browser. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
let importNumber = 0;
const workspaceKey = 'folio-studio-v1';
const preferenceKey = 'folio-experience-v1';

async function boot(t, { workspace, preferences } = {}) {
  const originals = new Map(), timers = new Set(), downloads = [];
  let win, requests = 0;
  const install = (name, value) => {
    if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const installWindow = storage => {
    win = new Window({ url: 'https://folio.test', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
    win.document.body.innerHTML = '<div id="app"></div><div id="toast-region" aria-live="polite"></div><div id="modal-root"></div>';
    for (const name of ['window', 'document', 'HTMLElement', 'HTMLAnchorElement', 'FormData', 'DOMParser', 'File', 'FileReader', 'Image', 'CSS', 'localStorage', 'sessionStorage', 'navigator']) install(name, name === 'window' ? win : win[name]);
    Object.defineProperty(win, 'indexedDB', { configurable: true, value: undefined });
    for (const [key, value] of Object.entries(storage)) win.localStorage.setItem(key, value);
    win.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, href: this.href }); };
  };
  install('setTimeout', (callback, delay, ...args) => {
    const timer = nativeSetTimeout(() => { timers.delete(timer); callback(...args); }, delay);
    timer.unref?.(); timers.add(timer); return timer;
  });
  install('clearTimeout', timer => { timers.delete(timer); nativeClearTimeout(timer); });
  install('fetch', async () => { requests++; throw new Error('An experience interaction unexpectedly made a network request'); });
  const initial = {};
  if (workspace) initial[workspaceKey] = JSON.stringify(workspace);
  if (preferences !== undefined) initial[preferenceKey] = typeof preferences === 'string' ? preferences : JSON.stringify(preferences);
  installWindow(initial);
  const ai = await import('./dist/ai.js'); ai.clearAI();
  t.after(async () => {
    ai.clearAI();
    for (const timer of timers) nativeClearTimeout(timer);
    timers.clear(); await win.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const $ = selector => { const element = document.querySelector(selector); assert.ok(element, `Missing ${selector}`); return element; };
  const $$ = selector => [...document.querySelectorAll(selector)];
  const settle = async (delay = 0) => { await new Promise(resolve => nativeSetTimeout(resolve, delay)); };
  const click = async selector => { $(selector).click(); await settle(); };
  const input = async (selector, value) => { const element = $(selector); element.value = value; element.dispatchEvent(new win.Event('input', { bubbles: true })); await settle(element.id === 'workspace-search' ? 150 : 0); };
  const key = async (key, options = {}, target = document) => { const event = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }); target.dispatchEvent(event); await settle(); return event; };
  const saved = () => JSON.parse(localStorage.getItem(workspaceKey));
  const save = async () => { await key('s', { ctrlKey: true }); await settle(); return saved(); };
  const restart = async () => {
    const storage = Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)]; }));
    for (const timer of timers) nativeClearTimeout(timer);
    timers.clear(); await win.happyDOM.close(); installWindow(storage);
    await import(`./dist/app.js?experience=${Date.now()}-${importNumber++}`); await settle();
  };
  await import(`./dist/app.js?experience=${Date.now()}-${importNumber++}`); await settle();
  await click('[data-action="editor-tab"][data-tab="write"]');
  return { $, $$, click, input, key, save, saved, restart, settle, downloads, get win() { return win; }, get requests() { return requests; }, preferences: () => JSON.parse(localStorage.getItem(preferenceKey)) };
}

function manuscripts(state) {
  return state.projects.map(({ updatedAt, ...project }) => project);
}

test('first visit offers a nonblocking start card; dismissal survives reload and help reopens the guide', async t => {
  const app = await boot(t);
  assert.ok(app.$('.start-card'));
  assert.equal(document.querySelector('.modal'), null, 'First visit must keep the manuscript usable');
  assert.equal(Boolean(app.$('#app').inert), false);
  const manuscript = app.$('#manuscript-text'), before = manuscript.value;
  await app.click('.start-card [data-action="dismiss-intro"]');
  assert.equal(document.querySelector('.start-card'), null);
  assert.equal(app.$('#manuscript-text'), manuscript, 'Dismissing help must not rebuild an active editor');
  await app.restart();
  assert.equal(app.$('[data-action="editor-tab"][data-tab="read"]').getAttribute('aria-pressed'), 'true');
  await app.click('[data-action="editor-tab"][data-tab="write"]');
  assert.equal(document.querySelector('.start-card'), null, 'A dismissed introduction must stay dismissed');
  assert.equal(app.$('#manuscript-text').value, before);
  await app.click('[data-action="help"]');
  assert.ok(app.$('.modal [data-action="tutorial-start"]'));
  await app.click('.modal [data-action="tutorial-start"]');
  assert.ok(app.$('.modal [data-action="tutorial-next"]'));
});

test('the six-step guide navigates backward and forward without changing books or calling paid services', async t => {
  const app = await boot(t), before = manuscripts(app.saved());
  await app.click('[data-action="tutorial-start"]');
  const titles = [];
  for (let i = 0; i < 6; i++) {
    titles.push(app.$('.modal').textContent);
    assert.ok(app.$(`.modal [data-action="tutorial-try"][data-index="${i}"]`));
    if (i < 5) await app.click('.modal [data-action="tutorial-next"]');
  }
  assert.equal(new Set(titles).size, 6, 'Each guide page must contain distinct instructions');
  await app.click('.modal [data-action="tutorial-prev"]');
  assert.equal(app.$('.modal').textContent, titles[4]);
  await app.click('.modal [data-action="tutorial-next"]');
  await app.click('.modal [data-action="tutorial-finish"]');
  assert.equal(document.querySelector('.modal'), null);
  assert.deepEqual(manuscripts(app.saved()), before);
  assert.equal(app.requests, 0);
  assert.equal(app.downloads.length, 0);
  assert.equal(document.querySelector('body > input[type="file"]'), null, 'Reading instructions must not open a transient file picker');
  assert.equal(document.querySelector('iframe'), null, 'Reading instructions must not launch printing');
});

test('guide progress resumes at the saved step after closing and reloading', async t => {
  const app = await boot(t);
  await app.click('[data-action="tutorial-start"]');
  await app.click('.modal [data-action="tutorial-next"]');
  await app.click('.modal [data-action="tutorial-next"]');
  const title = app.$('.modal').textContent;
  await app.key('Escape');
  await app.restart();
  await app.click('[data-action="help"]');
  await app.click('.modal [data-action="tutorial-resume"]');
  assert.equal(app.$('.modal').textContent, title);
  assert.ok(app.$('.modal [data-action="tutorial-try"][data-index="2"]'));
  await app.key('Escape');
  await app.click('[data-action="help"]');
  await app.click('.modal [data-action="tutorial-start"]');
  assert.ok(app.$('.modal [data-action="tutorial-try"][data-index="0"]'), 'Replay should begin at the first step');
});

test('focus and type-size controls retain the editor node, text and selection; type size persists independently', async t => {
  const app = await boot(t);
  await app.input('#manuscript-text', '손으로 쓴 문장을 끝까지 이어 갑니다.');
  const editor = app.$('#manuscript-text'); editor.focus(); editor.setSelectionRange(3, 8);
  for (const size of [20, 15, 17]) {
    await app.click(`[data-action="font-size"][data-size="${size}"]`);
    assert.equal(app.$('#manuscript-text'), editor);
    assert.equal(editor.selectionStart, 3); assert.equal(editor.selectionEnd, 8);
    assert.equal(app.$(`[data-action="font-size"][data-size="${size}"]`).getAttribute('aria-pressed'), 'true');
  }
  await app.click('[data-action="toggle-focus"]');
  assert.equal(app.$('#manuscript-text'), editor);
  assert.equal(editor.selectionStart, 3); assert.equal(editor.selectionEnd, 8);
  assert.equal(app.$('[data-action="toggle-focus"]').getAttribute('aria-pressed'), 'true');
  editor.setRangeText('이어 쓰는 ', editor.value.length, editor.value.length, 'end');
  editor.dispatchEvent(new app.win.Event('input', { bubbles: true }));
  const saved = await app.save(), text = editor.value;
  assert.equal(saved.projects[0].chapters[0].content, text);
  assert.ok(app.preferences(), 'Display preferences should have their own stored record');
  assert.equal(JSON.stringify(saved).includes('fontSize'), false, 'Display preferences must not pollute manuscript backups');
  await app.restart();
  await app.click('[data-action="editor-tab"][data-tab="write"]');
  assert.equal(app.$('#manuscript-text').value, text);
  assert.equal(app.$('[data-action="font-size"][data-size="17"]').getAttribute('aria-pressed'), 'true');
  assert.equal(app.$('[data-action="toggle-focus"]').getAttribute('aria-pressed'), 'false', 'A new session should show the full workspace');
  await app.click('[data-action="toggle-focus"]');
  assert.equal(app.$('[data-action="toggle-focus"]').getAttribute('aria-pressed'), 'true');
  await app.key('Escape');
  assert.equal(app.$('[data-action="toggle-focus"]').getAttribute('aria-pressed'), 'false', 'Escape should provide a clear exit from focus mode');
});

test('each tutorial try action opens its named workspace target without editing, generating, or downloading', async t => {
  const targets = ['#new-title', '#manuscript-text', '.writing-preferences summary', '#api-key', '#meta-title', '.export-options'];
  const app = await boot(t), before = manuscripts(app.saved());
  for (let index = 0; index < targets.length; index++) {
    if (document.querySelector('.modal')) await app.key('Escape');
    await app.click('[data-action="help"]');
    await app.click('.modal [data-action="tutorial-start"]');
    await app.click(`.modal [data-action="tutorial-jump"][data-index="${index}"]`);
    await app.click(`.modal [data-action="tutorial-try"][data-index="${index}"]`);
    assert.ok(app.$(targets[index]), `Guide step ${index + 1} must lead to its named control`);
    await app.settle(15);
    assert.equal(document.activeElement, app.$(targets[index]), `Guide step ${index + 1} must place keyboard focus on its named control`);
    if (index === 2) assert.equal(app.$('.writing-preferences').open, true, 'The destination preferences must be expanded for a beginner');
    assert.deepEqual(manuscripts(app.saved()), before);
    assert.equal(app.requests, 0); assert.equal(app.downloads.length, 0);
    assert.equal(document.querySelector('body > input[type="file"]'), null, 'Guide navigation must not create a transient upload picker');
    assert.equal(document.querySelector('iframe'), null);
  }
});

test('chapter previous and next controls stop at boundaries and keep edits when navigating', async t => {
  const app = await boot(t), chapters = app.saved().projects[0].chapters;
  assert.equal(app.$('[data-action="chapter-prev"]').disabled, true);
  const text = '다음 장에 가기 전에 남겨 둔 문장.';
  await app.input('#manuscript-text', text);
  await app.click('[data-action="chapter-next"]');
  assert.equal(app.$('#chapter-title').value, chapters[1].title);
  await app.click('[data-action="chapter-prev"]');
  assert.equal(app.$('#manuscript-text').value, text);
  for (let i = 1; i < chapters.length; i++) await app.click('[data-action="chapter-next"]');
  assert.equal(app.$('[data-action="chapter-next"]').disabled, true);
  assert.equal(app.$('#chapter-title').value, chapters.at(-1).title);
  assert.equal((await app.save()).projects[0].chapters[0].content, text);
});

test('search finds titles and body text across books, escapes snippets, and opens the chosen chapter', async t => {
  const book = (id, title, chapters) => ({ id, title, author: '저자', subtitle: '', description: '', language: 'ko', theme: 'sage', updatedAt: '2026-10-18T00:00:00Z', chapters });
  const workspace = { activeId: 'book-a', histories: {}, projects: [
    book('book-a', '초록의 기록', [{ id: 'a1', title: '첫 문장', content: '이 내용은 유지됩니다.' }]),
    book('book-b', '창가의 책', [{ id: 'b1', title: '깊은 바다', content: '바다를 보고 돌아왔습니다.' }, { id: 'b2', title: '둘째 이야기', content: '여기에 검색단어 <img src=x onerror=alert(1)> 가 있습니다.' }]),
  ] };
  const app = await boot(t, { workspace });
  const before = manuscripts(app.saved());
  const event = await app.key('k', { ctrlKey: true });
  assert.equal(event.defaultPrevented, true);
  await app.input('#workspace-search', '깊은 바다');
  assert.ok(app.$('[data-action="search-open"][data-project-id="book-b"][data-chapter-id="b1"]'));
  await app.input('#workspace-search', '창가의 책');
  assert.ok(app.$$('[data-action="search-open"][data-project-id="book-b"]').length > 0);
  await app.input('#workspace-search', '검색단어');
  const result = app.$('[data-action="search-open"][data-project-id="book-b"][data-chapter-id="b2"]');
  assert.match(result.textContent, /검색단어/);
  assert.equal(result.querySelector('img'), null);
  assert.equal(result.querySelector('script'), null);
  result.click(); await app.settle();
  assert.equal(document.querySelector('.modal'), null);
  assert.equal(app.$('.project-head h1').textContent, '창가의 책');
  assert.equal(app.$('#chapter-title').value, '둘째 이야기');
  assert.equal(app.$('#manuscript-text').value, workspace.projects[1].chapters[1].content);
  assert.deepEqual(manuscripts(await app.save()), before);
});

test('search has an empty state and Escape returns to the original editor focus and selection', async t => {
  const app = await boot(t), editor = app.$('#manuscript-text'); editor.focus(); editor.setSelectionRange(7, 11);
  await app.key('k', { metaKey: true }, editor);
  await app.input('#workspace-search', '존재하지않는결과-742739');
  assert.equal(app.$$('[data-action="search-open"]').length, 0);
  assert.ok(app.$('.modal').textContent.length > 15, 'The zero-result state must retain explanatory text');
  await app.key('Escape');
  assert.equal(document.querySelector('.modal'), null);
  assert.equal(document.activeElement, editor);
  assert.equal(editor.selectionStart, 7); assert.equal(editor.selectionEnd, 11);
});

test('pressing Enter immediately after a search change opens the current query rather than stale results', async t => {
  const app = await boot(t), wanted = app.saved().projects[0].chapters.at(-1);
  await app.key('k', { ctrlKey: true });
  const search = app.$('#workspace-search');
  search.value = wanted.title;
  search.dispatchEvent(new app.win.Event('input', { bubbles: true }));
  await app.key('Enter', {}, search);
  assert.equal(document.querySelector('.modal'), null);
  assert.equal(app.$('#chapter-title').value, wanted.title, 'Fast Enter must flush the debounced search');
  assert.equal(app.$('#manuscript-text').value, wanted.content);
});

test('search shortcuts respect IME composition and an already open form modal', async t => {
  const app = await boot(t);
  await app.key('k', { ctrlKey: true, isComposing: true });
  assert.equal(document.querySelector('.modal'), null, 'An active IME composition must not trigger navigation');
  await app.click('[data-action="new-project"]');
  const title = app.$('#new-title'); title.focus();
  await app.input('#new-title', '아직 작성 중인 제목');
  await app.key('k', { ctrlKey: true }, title);
  assert.equal(app.$('#new-title'), title, 'The search shortcut must not replace another modal and discard form input');
  assert.equal(title.value, '아직 작성 중인 제목');
  assert.equal(document.querySelector('#workspace-search'), null);
  await app.key('Escape', { isComposing: true }, title);
  assert.equal(app.$('#new-title'), title, 'IME cancel must not close the form');
  await app.key('Escape', {}, title);
  assert.equal(document.querySelector('.modal'), null);
});

test('navigation and editor controls expose state and quick actions without hiding save status from assistive technology', async t => {
  const app = await boot(t);
  assert.equal(app.$('[data-action="editor-tab"][data-tab="write"]').getAttribute('aria-pressed'), 'true');
  await app.click('[data-action="editor-tab"][data-tab="read"]');
  assert.equal(app.$('[data-action="editor-tab"][data-tab="read"]').getAttribute('aria-pressed'), 'true');
  assert.equal(app.$('[data-action="editor-tab"][data-tab="write"]').getAttribute('aria-pressed'), 'false');
  assert.equal(app.$('.flow-step.active').getAttribute('aria-current'), 'step');
  for (const action of ['new-project', 'import', 'backup', 'help']) assert.ok(app.$(`#app [data-action="${action}"]`));
  assert.notEqual(app.$('#save-state').getAttribute('aria-hidden'), 'true');
  assert.match(app.$('#save-state').textContent, /저장/);
  await app.click('[data-action="open-mobile"]');
  assert.ok(app.$('.sidebar').classList.contains('is-open'));
  await app.click('[data-action="close-mobile"]');
  assert.equal(app.$('.sidebar').classList.contains('is-open'), false);
});

test('malformed experience preferences do not block reading or saving manuscripts', async t => {
  const app = await boot(t, { preferences: '{broken-preferences' });
  const editor = app.$('#manuscript-text'); assert.ok(editor.value.length > 0);
  await app.input('#manuscript-text', '설정 데이터가 손상되어도 원고는 보관합니다.');
  assert.equal((await app.save()).projects[0].chapters[0].content, editor.value);
  await app.click('[data-action="font-size"][data-size="20"]');
  assert.ok(app.preferences(), 'Changing a preference should replace only the malformed experience record');
});

test('mobile menu isolates its navigation, traps focus, and returns usable editor focus after closing a drawer modal', async t => {
  const app = await boot(t);
  app.win.happyDOM.setWindowSize({ width: 390, height: 844 });
  await app.settle();
  assert.equal(app.win.matchMedia('(max-width:700px)').matches, true);
  const assertClosed = () => {
    assert.equal(app.$('.sidebar').inert, true, 'The offscreen mobile menu must not receive keyboard focus');
    assert.equal(app.$('.workspace').inert, false, 'The closed drawer must leave the editor usable');
    assert.equal(app.$('[data-action="open-mobile"]').getAttribute('aria-expanded'), 'false');
  };
  assertClosed();
  await app.click('[data-action="open-mobile"]');
  assert.equal(app.$('.sidebar').inert, false);
  assert.equal(app.$('.workspace').inert, true, 'An open mobile drawer must isolate background controls');
  assert.equal(app.$('[data-action="open-mobile"]').getAttribute('aria-expanded'), 'true');
  assert.equal(app.$('[data-action="open-mobile"]').getAttribute('aria-controls'), app.$('.sidebar').id);
  assert.equal(document.activeElement, app.$('.sidebar-close'));
  const controls = app.$$('.sidebar button:not(:disabled),.sidebar a[href]');
  await app.key('Tab', { shiftKey: true }, document.activeElement);
  assert.equal(document.activeElement, controls.at(-1), 'Reverse tab must stay inside the open drawer');
  await app.key('Tab', {}, document.activeElement);
  assert.equal(document.activeElement, app.$('.sidebar-close'), 'Forward tab must wrap to the drawer close button');
  await app.click('.sidebar-close');
  assertClosed();
  assert.equal(document.activeElement, app.$('[data-action="open-mobile"]'));
  await app.click('[data-action="open-mobile"]');
  await app.key('Escape', {}, document.activeElement);
  assertClosed();
  assert.equal(document.activeElement, app.$('[data-action="open-mobile"]'), 'Escape must return focus to the menu opener');
  await app.click('[data-action="open-mobile"]');
  const settings = app.$('.sidebar [data-action="settings"]'); settings.focus(); settings.click();
  await app.settle(15);
  assert.ok(app.$('#ai-form'));
  assert.equal(app.$('#app').inert, true);
  await app.key('Escape', {}, document.activeElement);
  assert.equal(document.querySelector('.modal'), null);
  assert.equal(app.$('#app').inert, false);
  assertClosed();
  assert.equal(document.activeElement, app.$('[data-action="open-mobile"]'), 'Closing a drawer-launched dialog must not restore focus into the hidden drawer');
  const editor = app.$('#manuscript-text'); editor.focus();
  assert.equal(document.activeElement, editor);
  await app.input('#manuscript-text', '메뉴와 설정을 닫은 뒤 이어 쓰는 문장.');
  assert.equal((await app.save()).projects[0].chapters[0].content, editor.value);
});
