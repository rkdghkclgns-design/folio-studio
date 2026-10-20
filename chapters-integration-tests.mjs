/** 300-chapter and short AI test DOM integration with mocked providers. No browser layout or live API calls. */
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
    const element = $(selector); Object.defineProperty(element, 'files', { configurable: true, value: [file] });
    element.dispatchEvent(new win.Event('change', { bubbles: true })); await settle(); await settle();
  };
  const restart = async () => {
    const entries = Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)]; }));
    for (const timer of timers) nativeClearTimeout(timer);
    timers.clear(); await win.happyDOM.close(); setupWindow(entries);
    ai.clearAI(); await import(`./dist/app.js?chapters-ui=${bootNumber++}`); await settle();
  };
  await import(`./dist/app.js?chapters-ui=${bootNumber++}`);
  await until(() => document.querySelector('[data-action="editor-tab"][data-tab="read"]') && localStorage.getItem(workspaceKey));
  await click('[data-action="editor-tab"][data-tab="write"]');
  return { ai, install, $, $$, settle, until, click, input, key, submit, saved, save, current, attach, restart, downloads, requests, get win() { return win; } };
}


const keyForTest = 'AIza-chapters-integration-test-only';
const sourceMarkdown = '\ufeff# 원시 기록\r\n자료의 수치를 유지합니다.  \r\n';
const instructions = '매 장의 주제를 구별하고 원문에 없는 사실을 만들지 마세요.';
const stableBooks = state => state.projects.map(({ updatedAt, ...project }) => project);
const jsonResponse = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

async function newBrief(app, { chapters = '300', target = '150000', unit = 'chars', source = sourceMarkdown } = {}) {
  await app.click('[data-action="production-new"]');
  await app.input('#production-topic', '긴 책의 각 장에서 한 가지 생각을 구체적으로 설명하는 생활 안내서');
  await app.input('#production-title', '매일 한 장의 기록');
  await app.input('#production-author', '기록자');
  await app.input('#production-source', source);
  await app.input('#production-instructions', instructions);
  await app.input('#production-target-unit', unit, true);
  await app.input('#production-target-value', target);
  await app.input('#production-chapters', chapters, true);
  await app.input('#production-illustrations', 'none', true);
}

function connectMock(app, handler = () => undefined) {
  app.ai.configureAI({ provider: 'google', apiKey: keyForTest });
  app.install('fetch', async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    const payload = !body ? undefined : body.generationConfig?.responseModalities?.includes('IMAGE') ? { operation: 'image' } : JSON.parse(body.contents[0].parts[0].text);
    const call = { url, options, body, payload }; app.requests.push(call);
    if (!body) return jsonResponse({ name: `models/${app.ai.getAIConfig().textModel}`, supportedGenerationMethods: ['generateContent'] });
    const result = await handler(call);
    if (result instanceof Response) return result;
    return jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result ?? mockedResult(payload)) }] } }] });
  });
}

function mockedResult(payload) {
  if (payload.operation === 'connection_text_test') return { text: '책상 위에 놓인 노트를 펴고 오늘의 일을 한 줄씩 적었다.' };
  if (payload.operation === 'production_book_plan_batch') return { title: '매일 한 장의 기록', subtitle: '작은 생각을 구체적으로', description: '생활의 세부를 장마다 구분해 다룹니다.', chapters: Array.from({ length: payload.batchSize }, (_, offset) => ({ title: `기록 ${payload.startIndex + offset + 1}`, purpose: `${payload.startIndex + offset + 1}번째 생활 장면을 설명합니다.`, outline: ['첫 상황과 선택', '선택의 결과와 적용'], sourceRefs: payload.sourceSummary.map(source => source.id) })) };
  if (payload.operation === 'production_source_digest') return { id: payload.rawSource.id, summary: '자료의 수치를 유지하라는 원시 기록입니다.', facts: [], quotes: [], unknowns: [] };
  if (payload.operation === 'production_section' || payload.operation === 'production_revision') return { content: (payload.index % 2 ? '나' : '가').repeat(payload.targetChars), notes: [], imagePrompt: '', sourceRefs: payload.sourceSummary.map(source => source.id) };
  throw new Error(`Unimplemented mocked operation: ${payload.operation}`);
}

async function approveStart(app) {
 const before=app.requests.length;
 await app.click('.modal [data-action="production-start"]');
 assert.equal(app.requests.length,before,'Estimate must make no paid request');
 app.$('#production-approval-check').checked=true;
 app.$('#production-approval-check').dispatchEvent(new app.win.Event('change',{bubbles:true}));
 await app.click('[data-action="production-approve"]');
}

test('300 chapters are explicitly accepted with sufficient length and preserve all book conditions without network', async t => {
  const app = await boot(t), before = stableBooks(app.saved());
  await newBrief(app);
  assert.equal(app.$('#production-chapters').max, '300');
  assert.match(app.$('#production-chapters-help').textContent, /300/);
  assert.equal(app.$('#production-target-value').max, '300000');
  await app.submit('#production-form');
  await app.until(() => app.current()?.production);
  const book = app.current();
  assert.equal(book.production.chapterCount, 300);
  assert.equal(book.production.targetChars, 150000);
  assert.equal(book.production.brief.sourceMarkdown, sourceMarkdown);
  assert.equal(book.production.brief.instructions, instructions);
  assert.deepEqual(stableBooks(app.saved()).slice(0, before.length), before);
  assert.match(app.$('.production-summary').textContent, /300/);
  assert.equal(app.requests.length, 0);
  await app.key('Escape'); await app.restart();
  assert.equal(app.current().production.chapterCount, 300);
  assert.equal(app.current().production.brief.sourceMarkdown, sourceMarkdown);
});

test('301 chapters and an underfunded 300-chapter length do not save or silently change the requested length', async t => {
  const app = await boot(t), before = stableBooks(app.saved());
  await newBrief(app, { chapters: '301' });
  await app.submit('#production-form');
  assert.ok(app.$('#production-form'));
  assert.deepEqual(stableBooks(app.saved()), before);
  assert.match(app.$('#production-feedback').textContent, /300/);
  await app.input('#production-chapters', '300', true);
  await app.input('#production-target-value', '30000');
  await app.submit('#production-form');
  assert.ok(app.$('#production-form'));
  assert.equal(app.$('#production-target-value').value, '30000');
  assert.deepEqual(stableBooks(app.saved()), before);
  assert.match(app.$('#production-feedback').textContent, /500|150,000|최소/);
  assert.ok(app.$('[data-action="production-fit-length"]'));
  await app.click('[data-action="production-fit-length"]');
  assert.equal(app.$('#production-target-value').value, '150000');
  await app.submit('#production-form');
  await app.until(() => app.current()?.production);
  assert.equal(app.current().production.targetChars, 150000);
  assert.equal(app.requests.length, 0);
});

test('estimated pages can describe 300 pages, and 300 chapters require an explicit 188-page minimum', async t => {
  const app = await boot(t);
  await newBrief(app, { chapters: '0', target: '300', unit: 'pages', source: '' });
  assert.equal(app.$('#production-target-value').max, '375');
  await app.submit('#production-form'); await app.until(() => app.current()?.production);
  assert.equal(app.current().production.targetChars, 240000);
  assert.equal(app.current().production.brief.targetValue, 300);
  await app.key('Escape');
  await newBrief(app, { chapters: '300', target: '187', unit: 'pages', source: '' });
  await app.submit('#production-form');
  assert.ok(app.$('#production-form'));
  assert.equal(app.$('#production-target-value').value, '187');
  await app.click('[data-action="production-fit-length"]');
  assert.equal(app.$('#production-target-value').value, '188');
  await app.submit('#production-form');
  await app.until(() => app.current()?.production?.brief.chapterCount === 300);
  assert.equal(app.current().production.targetChars, 150400);
  assert.equal(app.requests.length, 0);
});


test('settings exposes a paid one-request text test only after a provider is connected', async t => {
  const app = await boot(t);
  await app.click('[data-action="settings"]');
  assert.equal(app.$('.modal [data-action="test-ai-text"]').disabled, true);
  await app.click('.modal [data-action="test-ai-text"]');
  assert.equal(app.requests.length, 0);
  await app.key('Escape');
  connectMock(app);
  await app.click('[data-action="settings"]');
  assert.equal(app.$('.modal [data-action="test-ai-text"]').disabled, false);
  assert.match(app.$('.modal').textContent, /텍스트|문장/);
});


test('a complete mocked 300-chapter run uses 15 planning batches and backs up every chapter intact', async t => {
  const app = await boot(t), before = stableBooks(app.saved());
  connectMock(app);
  await newBrief(app);
  await app.submit('#production-form'); await app.until(() => app.current()?.production);
  assert.equal(app.requests.length, 0);
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'), '300-chapter mocked production did not complete');
  const book = app.current();
  assert.equal(book.chapters.length, 300);
  assert.equal(book.production.status, 'complete');
  assert.equal(book.production.plan.chapters.length, 300);
  assert.equal(book.production.planning, null);
  assert.equal(book.chapters.reduce((sum, chapter) => sum + chapter.content.length, 0), 150000);
  assert.ok(book.chapters.every((chapter, i) => chapter.title === `기록 ${i + 1}` && chapter.content === (i % 2 ? '나' : '가').repeat(500)));
  const planning = app.requests.filter(request => request.payload.operation === 'production_book_plan_batch');
  assert.equal(planning.length, 15);
  assert.deepEqual(planning.map(request => request.payload.startIndex), Array.from({ length: 15 }, (_, i) => i * 20));
  assert.ok(planning.every(request => request.payload.batchSize === 20));
  const writing = app.requests.filter(request => request.payload.operation === 'production_section');
  assert.equal(writing.length, 300);
  assert.deepEqual(writing.map(request => request.payload.index), Array.from({ length: 300 }, (_, i) => i));
  assert.ok(writing.every(request => request.payload.plan.chapterCount === 300 && request.payload.plan.chapters.length === 300));
  assert.ok(writing.every(request => request.payload.brief.instructions === instructions));
  assert.equal(app.requests.length, 316, 'One source digest, fifteen outline batches and three hundred small writing requests; no images');
  assert.deepEqual(stableBooks(app.saved()).slice(0, before.length), before);
  await app.key('Escape'); await app.click('[data-action="backup"]');
  const savedDownload = app.downloads.at(-1), backupText = await savedDownload.blob.text();
  assert.equal(backupText.includes(keyForTest), false);
  await app.click('[data-action="import"]');
  await app.attach('input[type="file"]', new app.win.File([backupText], savedDownload.filename, { type: 'application/json' }));
  await app.save();
  const imported = app.current();
  assert.notEqual(imported.id, book.id);
  const { validateProductionData } = await import('./dist/production.js');
  assert.deepEqual(imported.production, validateProductionData(book.production));
  assert.deepEqual(imported.chapters.map(chapter => ({ title: chapter.title, content: chapter.content })), book.chapters.map(chapter => ({ title: chapter.title, content: chapter.content })));
  await app.restart();
  assert.equal(app.current().chapters.length, 300);
  assert.equal(app.current().production.status, 'complete');
});

test('interrupted outline batches survive backup/import and resume at the first missing batch', async t => {
  const app = await boot(t);
  let stalledSignal;
  connectMock(app, ({ payload, options }) => {
    if (payload.operation === 'production_book_plan_batch' && payload.startIndex === 40) {
      stalledSignal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
    }
  });
  await newBrief(app, { source: '' }); await app.submit('#production-form');
  await app.until(() => app.current()?.production);
  await approveStart(app); await app.until(() => stalledSignal);
  assert.equal(app.current().production.planning.chapters.length, 40);
  assert.equal(app.current().production.plan, null);
  assert.equal(app.current().chapters.length, 1, 'An unfinished outline must not replace the working manuscript');
  assert.equal(app.current().chapters[0].content, '');
  await app.click('[data-action="cancel-operation"]');
  await app.until(() => app.current().production.status === 'paused');
  assert.equal(stalledSignal.aborted, true);
  await app.click('.modal [data-action="close-modal"]');
  await app.click('[data-action="backup"]');
  const downloaded = app.downloads.at(-1), backupText = await downloaded.blob.text();
  await app.click('[data-action="import"]');
  await app.attach('input[type="file"]', new app.win.File([backupText], downloaded.filename, { type: 'application/json' }));
  await app.save(); await app.restart();
  assert.equal(app.current().production.planning.chapters.length, 40);
  const firstRequests = app.requests.length;
  connectMock(app, ({ payload, options }) => {
    if (payload.operation === 'production_section') {
      stalledSignal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
    }
  });
  stalledSignal = undefined;
  await app.click('[data-action="production-summary"]');
  await approveStart(app);
  await app.until(() => stalledSignal);
  const resumedPlans = app.requests.slice(firstRequests).filter(request => request.payload.operation === 'production_book_plan_batch');
  assert.deepEqual(resumedPlans.map(request => request.payload.startIndex), Array.from({ length: 13 }, (_, i) => 40 + i * 20));
  assert.equal(app.current().production.plan.chapters.length, 300);
  assert.equal(app.current().production.planning, null);
  await app.click('[data-action="cancel-operation"]');
  await app.until(() => app.current().production.status === 'paused');
});

test('a real-text request test shows its response and selected model without editing or transmitting the book', async t => {
  const app = await boot(t), before = stableBooks(app.saved());
  const syntheticResult = '책상 위에 놓인 노트를 펴고 오늘의 일을 한 줄씩 적었다.';
  connectMock(app);
  await app.click('[data-action="settings"]');
  await app.click('.modal [data-action="test-ai-text"]');
  await app.until(() => document.querySelector('#ai-test-result'));
  assert.equal(app.$('#ai-test-result').textContent.trim(), syntheticResult);
  assert.match(app.$('#ai-test-meta').textContent, /Google|Gemini|google/);
  assert.ok(app.$('#ai-test-meta').textContent.includes(app.ai.getAIConfig().textModel));
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].payload.operation, 'connection_text_test');
  assert.equal(app.requests[0].body.generationConfig.responseModalities?.includes('IMAGE') || false, false);
  assert.equal(JSON.stringify(app.requests[0].payload).includes(before[0].chapters[0].content), false);
  assert.deepEqual(stableBooks(app.saved()), before);
  assert.equal(localStorage.getItem(workspaceKey).includes(keyForTest), false);
  assert.equal(sessionStorage.length, 0);
  assert.equal(app.ai.isAIConfigured(), true);
});

test('a rejected text test reports the failure without a false success or changes to the book', async t => {
  const app = await boot(t), before = stableBooks(app.saved());
  connectMock(app, () => new Response('{"error":{"message":"PRIVATE DETAIL"}}', { status: 403, headers: { 'Content-Type': 'application/json' } }));
  await app.click('[data-action="settings"]');
  await app.click('.modal [data-action="test-ai-text"]');
  await app.until(() => document.querySelector('.modal [data-action="close-modal"]'));
  assert.equal(app.requests.length, 1);
  assert.equal(document.querySelector('#ai-test-result'), null);
  assert.doesNotMatch(app.$('.modal').textContent, /PRIVATE DETAIL|테스트를 마쳤습니다|테스트 성공/);
  assert.match(app.$('.modal').textContent, /권한|거부|확인|연결/);
  assert.deepEqual(stableBooks(app.saved()), before);
  assert.equal(localStorage.getItem(workspaceKey).includes(keyForTest), false);
});

test('text-test cancellation aborts the single request and ignores duplicate actions and background editing', async t => {
  const app = await boot(t), before = stableBooks(app.saved());
  let stalledSignal;
  connectMock(app, ({ options }) => {
    stalledSignal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  });
  await app.click('[data-action="settings"]');
  await app.click('.modal [data-action="test-ai-text"]');
  await app.until(() => stalledSignal);
  const rogue = document.createElement('button'); rogue.dataset.action = 'test-ai-text'; app.$('.modal').append(rogue); rogue.click();
  await app.input('#manuscript-text', '테스트가 원고를 바꾸면 안 됩니다.');
  await app.settle();
  assert.equal(app.requests.length, 1);
  assert.equal(Boolean(app.$('#app').inert), true);
  await app.click('[data-action="cancel-operation"]');
  await app.until(() => stalledSignal.aborted && document.querySelector('.modal [data-action="close-modal"]'));
  assert.equal(document.querySelector('#ai-test-result'), null);
  assert.deepEqual(stableBooks(app.saved()), before);
  assert.equal(localStorage.getItem(workspaceKey).includes(keyForTest), false);
});


test('pending key validation disables paid text tests and a provider switch leaves them disabled', async t => {
  const app = await boot(t), before = stableBooks(app.saved());
  connectMock(app);
  await app.click('[data-action="settings"]');
  assert.match(app.$('#ai-test-connection').textContent, /Google Gemini/);
  assert.ok(app.$('#ai-test-connection').textContent.includes(app.ai.getAIConfig().textModel));
  let finishValidation;
  app.install('fetch', async (url, options) => {
    app.requests.push({ url, options });
    return new Promise(resolve => { finishValidation = () => resolve(jsonResponse({ name: `models/${app.ai.getAIConfig().textModel}`, supportedGenerationMethods: ['generateContent'] })); });
  });
  await app.input('#api-key', keyForTest);
  await app.submit('#ai-form');
  await app.until(() => finishValidation);
  assert.match(app.$('#ai-test-connection').textContent, /연결 확인이 끝나면/);
  assert.doesNotMatch(app.$('#ai-test-connection').textContent, /연결되어 있습니다/);
  assert.equal(app.$('.modal [data-action="test-ai-text"]').disabled, true);
  await app.click('.modal [data-action="test-ai-text"]');
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].options.method, 'GET');
  assert.equal(app.requests[0].options.body, undefined);
  finishValidation();
  await app.until(() => !document.querySelector('#ai-form'));
  await app.click('[data-action="settings"]');
  assert.equal(app.$('.modal [data-action="test-ai-text"]').disabled, false);
  assert.match(app.$('#ai-test-connection').textContent, /Google Gemini/);
  assert.ok(app.$('#ai-test-connection').textContent.includes(app.ai.getAIConfig().textModel));
  await app.input('#ai-provider', 'openai', true);
  assert.match(app.$('#ai-test-connection').textContent, /먼저 API 키를 연결/);
  assert.doesNotMatch(app.$('#ai-test-connection').textContent, /Google|Gemini|연결되어 있습니다/);
  assert.equal(app.$('.modal [data-action="test-ai-text"]').disabled, true);
  assert.equal(app.ai.isAIConfigured(), false);
  await app.click('.modal [data-action="test-ai-text"]');
  assert.equal(app.requests.length, 1);
  assert.deepEqual(stableBooks(app.saved()), before);
  assert.equal(localStorage.getItem(workspaceKey).includes(keyForTest), false);
});
