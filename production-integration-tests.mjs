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
    ai.clearAI(); await import(`./dist/app.js?production-ui=${bootNumber++}`); await settle();
  };
  await import(`./dist/app.js?production-ui=${bootNumber++}`);
  await until(() => document.querySelector('[data-action=\"editor-tab\"][data-tab=\"read\"]') && localStorage.getItem(workspaceKey));
  await click('[data-action=\"editor-tab\"][data-tab=\"write\"]');
  return { ai, install, $, $$, settle, until, click, input, key, submit, saved, save, current, attach, restart, downloads, requests, get win() { return win; } };
}

const rawSource = '\ufeff\n# 조사 노트\r\n\r\n2024년 조사에서 12명이 답했다.  \r\n> “원문 인용은 그대로 둡니다.”\r\n\r\n```html\r\n<img src=x onerror=alert(1)>\r\n```\r\n';
const instructions = '처음 자취하는 독자에게 담백하게 설명해 주세요. 조사 수치와 인용은 유지하고, 확인되지 않은 경험담은 만들지 마세요.';

async function newBrief(app, { source = rawSource, topic = '처음 독립하는 사람의 생활 기록', title = '혼자 살며 배운 것', target = '3000' } = {}) {
  await app.click('[data-action="production-new"]');
  await app.input('#production-topic', topic);
  await app.input('#production-title', title);
  await app.input('#production-author', '김기록');
  await app.input('#production-source', source);
  await app.input('#production-instructions', instructions);
  await app.input('#production-audience', '첫 독립을 준비하는 성인');
  await app.input('#production-target-unit', 'chars', true);
  await app.input('#production-target-value', target);
  await app.input('#production-chapters', '2', true);
  await app.input('#production-illustrations', 'none', true);
}

async function approveStart(app, retry = false) {
  const before = app.requests.length;
  await app.click(retry ? '.modal [data-action="production-retry"]' : '.modal [data-action="production-start"]');
  assert.equal(app.requests.length, before, 'Showing the cost estimate must not send a paid request');
  assert.equal(app.$('[data-action="production-approve"]').disabled, true);
  app.$('#production-approval-check').checked = true;
  app.$('#production-approval-check').dispatchEvent(new app.win.Event('change', { bubbles: true }));
  await app.click('[data-action="production-approve"]');
}

function stableBooks(state) { return state.projects.map(({ updatedAt, ...project }) => project); }

// Source fixtures deliberately include BOM, leading LF, CRLF, trailing spaces, and HTML.
// happy-dom does not reproduce every browser textarea newline-normalization detail.
test('production brief creates a distinct saved book, preserves raw source and instructions, and makes no AI request', async t => {
  const app = await boot(t), before = stableBooks(app.saved());
  await newBrief(app);
  assert.equal(app.$('#production-source').value, rawSource);
  assert.equal(document.querySelector('.modal img[src="x"]'), null, 'Raw HTML must remain source text');
  await app.submit('#production-form');
  await app.until(() => app.saved().projects.length === before.length + 1);
  const created = app.current();
  assert.notEqual(created.id, before[0].id);
  assert.equal(created.production.brief.topic, '처음 독립하는 사람의 생활 기록');
  assert.equal(created.production.brief.sourceMarkdown, rawSource);
  assert.equal(created.production.brief.instructions, instructions);
  assert.equal(created.production.targetChars, 3000);
  assert.equal(created.production.brief.chapterCount, 2);
  assert.deepEqual(stableBooks(app.saved()).slice(0, before.length), before);
  assert.equal(app.requests.length, 0, 'Saving production conditions must not start paid generation');
  assert.ok(app.$('.modal [data-action="settings"]'));
  await app.key('Escape');
  await app.restart();
  assert.equal(app.current().production.brief.sourceMarkdown, rawSource);
  assert.equal(app.current().production.brief.instructions, instructions);
});

test('cancel and invalid requested length leave the existing library untouched', async t => {
  const app = await boot(t), before = stableBooks(app.saved());
  await newBrief(app, { target: '10' });
  await app.submit('#production-form');
  assert.ok(app.$('#production-form'), 'Invalid conditions must remain editable');
  assert.deepEqual(stableBooks(app.saved()), before);
  assert.ok(app.$('#production-feedback').textContent.trim().length > 0, 'Invalid length must have a visible explanation');
  await app.key('Escape');
  await newBrief(app);
  await app.click('#production-form [data-action="close-modal"]');
  assert.deepEqual(stableBooks(app.saved()), before);
  assert.equal(app.requests.length, 0);
});

test('requesting generation without an API connection preserves the saved brief while opening setup', async t => {
  const app = await boot(t);
  await newBrief(app); await app.submit('#production-form');
  await app.until(() => app.current()?.production);
  const before = structuredClone(app.current());
  await app.click('.modal [data-action="settings"]');
  assert.ok(app.$('#ai-form'));
  assert.equal(app.requests.length, 0);
  assert.deepEqual(app.current(), before);
  await app.key('Escape');
  await app.click('[data-action="production-summary"]');
  assert.ok(app.$('.modal [data-action="settings"]'));
  assert.equal(app.current().production.brief.instructions, instructions);
});

test('a Markdown source file is preserved exactly in saved conditions and can be downloaded unchanged', async t => {
  const app = await boot(t);
  await newBrief(app, { source: '바뀌기 전 자료' });
  await app.attach('#production-source-file', new app.win.File([rawSource], '조사 원문.md', { type: 'text/markdown' }));
  assert.equal(app.$('#production-source').value, rawSource);
  assert.match(app.$('#production-source-name').textContent, /조사 원문\.md/);
  await app.submit('#production-form');
  await app.until(() => app.current()?.production);
  assert.equal(app.current().production.brief.sourceMarkdown, rawSource);
  await app.click('.modal [data-action="production-source-download"]');
  assert.equal(app.downloads.length, 1);
  assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await app.downloads[0].blob.arrayBuffer()), rawSource);
  assert.match(app.downloads[0].filename, /\.md$/);
  assert.equal(app.requests.length, 0);
});

test('oversized and unreadable source files keep the previous source and do not create a book', async t => {
  const app = await boot(t), bookCount = app.saved().projects.length;
  const previous = '보존할 원시 자료입니다.';
  await newBrief(app, { source: previous });
  const oversized = new app.win.File(['x'], '큰 원문.md', { type: 'text/markdown' });
  Object.defineProperty(oversized, 'size', { value: 2 * 1024 * 1024 });
  await app.attach('#production-source-file', oversized);
  assert.equal(app.$('#production-source').value, previous);
  const broken = new app.win.File(['x'], '읽기 오류.md', { type: 'text/markdown' });
  Object.defineProperty(broken, 'arrayBuffer', { value: async () => { throw new Error('Private file reader detail'); } });
  await app.attach('#production-source-file', broken);
  assert.equal(app.$('#production-source').value, previous);
  assert.equal(app.saved().projects.length, bookCount);
  assert.equal(app.requests.length, 0);
});

test('a slower earlier source read cannot replace the most recently selected file', async t => {
  const app = await boot(t);
  await newBrief(app, { source: '기존 자료' });
  let finishOlder;
  const older = new app.win.File(['old'], '이전 자료.md', { type: 'text/markdown' });
  Object.defineProperty(older, 'arrayBuffer', { value: () => new Promise(resolve => { finishOlder = resolve; }) });
  await app.attach('#production-source-file', older);
  await app.attach('#production-source-file', new app.win.File(['# 최신 자료\n남겨야 할 새 내용.'], '최신 자료.md', { type: 'text/markdown' }));
  assert.equal(app.$('#production-source').value, '# 최신 자료\n남겨야 할 새 내용.');
  finishOlder(new TextEncoder().encode('# 이전 자료\n덮어쓰면 안 됩니다.').buffer); await app.settle(); await app.settle();
  assert.equal(app.$('#production-source').value, '# 최신 자료\n남겨야 할 새 내용.');
  assert.match(app.$('#production-source-name').textContent, /최신 자료\.md/);
  await app.submit('#production-form'); await app.until(() => app.current()?.production);
  assert.equal(app.current().production.brief.sourceMarkdown, '# 최신 자료\n남겨야 할 새 내용.');
});

test('book backup and import retain raw source, instructions, and desired length in a distinct book', async t => {
  const app = await boot(t);
  await newBrief(app); await app.submit('#production-form');
  await app.until(() => app.current()?.production);
  const original = structuredClone(app.current());
  await app.key('Escape'); await app.click('[data-action="backup"]');
  const downloaded = app.downloads.at(-1), backupText = await downloaded.blob.text();
  const backup = JSON.parse(backupText);
  assert.deepEqual(backup.project.production, original.production);
  await app.click('[data-action="import"]');
  await app.attach('input[type="file"]', new app.win.File([backupText], downloaded.filename, { type: 'application/json' }));
  await app.save();
  const imported = app.current();
  assert.notEqual(imported.id, original.id);
  assert.deepEqual(imported.production, original.production);
  assert.notEqual(imported.chapters[0].id, original.chapters[0].id, 'Book import should allocate fresh local chapter IDs');
  assert.equal(app.requests.length, 0);
});

test('a source read in progress cannot save old conditions, and manual edits win over the pending file', async t => {
  const app = await boot(t), bookCount = app.saved().projects.length;
  await newBrief(app, { source: '읽기 전 자료' });
  let finishRead;
  const pending = new app.win.File(['pending'], '늦게 읽는 파일.md', { type: 'text/markdown' });
  Object.defineProperty(pending, 'arrayBuffer', { value: () => new Promise(resolve => { finishRead = resolve; }) });
  await app.attach('#production-source-file', pending);
  await app.submit('#production-form');
  assert.equal(app.saved().projects.length, bookCount, 'Submitting during a file read must not silently use the old source');
  assert.ok(app.$('#production-form'));
  await app.input('#production-source', '사용자가 직접 고친 최신 자료');
  finishRead(new TextEncoder().encode('뒤늦게 읽힌 예전 파일').buffer);
  await app.settle(); await app.settle();
  assert.equal(app.$('#production-source').value, '사용자가 직접 고친 최신 자료');
  await app.submit('#production-form'); await app.until(() => app.current()?.production);
  assert.equal(app.current().production.brief.sourceMarkdown, '사용자가 직접 고친 최신 자료');
});

test('closing the form invalidates a pending source read and preserves the next form', async t => {
  const app = await boot(t), bookCount = app.saved().projects.length;
  await newBrief(app, { source: '첫 번째 폼의 자료' });
  let finishRead;
  const pending = new app.win.File(['pending'], '이전 폼 자료.md', { type: 'text/markdown' });
  Object.defineProperty(pending, 'arrayBuffer', { value: () => new Promise(resolve => { finishRead = resolve; }) });
  await app.attach('#production-source-file', pending);
  await app.key('Escape');
  await newBrief(app, { source: '두 번째 폼에만 남겨야 할 자료' });
  finishRead(new TextEncoder().encode('닫힌 폼에서 늦게 온 자료').buffer);
  await app.settle(); await app.settle();
  assert.equal(app.$('#production-source').value, '두 번째 폼에만 남겨야 할 자료');
  assert.equal(app.saved().projects.length, bookCount);
  assert.equal(app.requests.length, 0);
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}
function productionResult(payload, { short = false } = {}) {
  if (payload.operation === 'book_cover_brief') return { concept: '독립 생활의 실제 장면을 절제된 소품으로 표현합니다.', imagePrompt: '햇살이 비치는 작은 방과 나무 책상, 간결한 출판 수채화, 제목 여백', alt: '작은 방의 책상과 부드러운 햇살' };
  if (payload.operation === 'production_source_digest') return {
    id: payload.rawSource.id, summary: '독립 생활을 준비하기 위한 조사 메모입니다.',
    facts: ['2024년 조사에서 12명이 답했다.'], quotes: [], unknowns: [],
  };
  if (payload.operation === 'production_book_plan') return {
    title: '자료를 바탕으로 만든 책', subtitle: '생활의 작은 선택', description: '처음 독립하는 사람을 위한 구체적인 생활 기록입니다.',
    chapters: Array.from({ length: payload.brief.chapterCount }, (_, index) => ({
      title: `생활 기록 ${index + 1}`, purpose: `${index + 1}번째 생활 주제의 준비와 실천을 설명합니다.`,
      outline: [`${index + 1}번째 주제의 준비`, `${index + 1}번째 주제의 실천`],
      sourceRefs: payload.sourceSummary.map(source => source.id),
    })),
  };
  if (['production_section', 'production_revision'].includes(payload.operation)) return {
    content: (payload.index % 2 ? '나' : '가').repeat(short ? Math.floor(payload.targetChars * 0.3) : payload.targetChars),
    notes: short ? ['목표 분량에 못 미쳐 검토가 필요합니다.'] : [], imagePrompt: '', sourceRefs: payload.sourceSummary.map(source => source.id),
  };
  throw new Error(`Unknown mocked production operation: ${payload.operation}`);
}
function connectMock(app, handler = () => undefined) {
  app.ai.configureAI({ provider: 'google', apiKey: 'AIza-production-integration-test-only' });
  app.install('fetch', async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    const payload = !body ? undefined : body.generationConfig?.responseModalities?.includes('IMAGE') ? { operation: 'production_image', prompt: body.contents[0].parts[0].text } : JSON.parse(body.contents[0].parts[0].text);
    const call = { url, options, body, payload }; app.requests.push(call);
    if (!body) return jsonResponse({ name: `models/${app.ai.getAIConfig().textModel}`, supportedGenerationMethods: ['generateContent'] });
    const result = await handler(call);
    if (result instanceof Response) return result;
    return jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result ?? productionResult(payload)) }] } }] });
  });
}

test('validating a Google key returns to the saved conditions without starting production', async t => {
  const app = await boot(t);
  await newBrief(app); await app.submit('#production-form'); await app.until(() => app.current()?.production);
  const before = structuredClone(app.current().production.brief);
  await app.click('.modal [data-action="settings"]');
  connectMock(app); app.ai.clearAI();
  await app.input('#api-key', 'AIza-production-integration-test-only');
  await app.submit('#ai-form');
  await app.until(() => document.querySelector('.production-summary'));
  assert.deepEqual(app.current().production.brief, before);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].options.method, 'GET');
  assert.ok(app.$('.modal [data-action="production-start"]'));
  assert.equal(localStorage.getItem(workspaceKey).includes('AIza-production-integration-test-only'), false);
});

test('explicit production follows source, plan and chapter stages and saves the requested length', async t => {
  const app = await boot(t), original = stableBooks(app.saved());
  connectMock(app);
  await newBrief(app); await app.submit('#production-form'); await app.until(() => app.current()?.production);
  assert.equal(app.requests.length, 0);
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'), 'Completed summary should appear');
  const book = app.current();
  assert.deepEqual(app.requests.map(request => request.payload.operation), ['production_source_digest', 'production_book_plan', 'production_section', 'production_section']);
  assert.equal(book.production.status, 'complete');
  assert.equal(book.chapters.length, 2);
  assert.equal(book.chapters[0].content, '가'.repeat(1500));
  assert.equal(book.chapters[1].content, '나'.repeat(1500));
  assert.equal(book.production.brief.sourceMarkdown, rawSource);
  assert.deepEqual(stableBooks(app.saved()).slice(0, original.length), original);
  assert.equal(app.requests[0].payload.rawSource.text, rawSource);
  assert.ok(app.requests.every(request => request.payload.brief.instructions === instructions));
  assert.ok(app.requests.filter(request => request.payload.operation === 'production_section').every(request => request.payload.sourceExcerpt === rawSource));
  assert.equal(document.querySelector('.modal [data-action="production-start"]'), null, 'A completed book must not offer another paid run');
  assert.match(app.$('.production-summary').textContent, /3,000/);
});

test('cancellation preserves completed sections and resumes without duplicating content or repeating planning', async t => {
  const app = await boot(t);
  let stalledSignal, stalled = false;
  connectMock(app, ({ payload, options }) => {
    if (payload.operation === 'production_section' && payload.index === 1 && !stalled) {
      stalled = true; stalledSignal = options.signal;
      return new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }); });
    }
  });
  await newBrief(app, { source: '' }); await app.submit('#production-form'); await app.until(() => app.current()?.production);
  await app.key('Escape'); await app.click('[data-action="editor-tab"][data-tab="write"]');
  await app.click('[data-action="production-summary"]');
  await approveStart(app);
  await app.until(() => stalledSignal, 'Second chapter should wait in the mocked provider');
  assert.equal(app.current().chapters[0].content, '가'.repeat(1500));
  assert.equal(app.current().chapters[1].content, '');
  assert.ok(app.$('#production-live-progress'));
  assert.equal(Boolean(app.$('#app').inert), true);
  const callsBeforeDuplicate = app.requests.length;
  await app.click('[data-action="production-new"]');
  await app.input('#manuscript-text', '생성 도중 배경에서 들어온 입력');
  assert.equal(app.requests.length, callsBeforeDuplicate);
  assert.equal(app.current().chapters[0].content, '가'.repeat(1500));
  await app.click('[data-action="cancel-operation"]');
  await app.until(() => app.current().production.status === 'paused');
  assert.equal(stalledSignal.aborted, true);
  await app.click('.modal [data-action="close-modal"]');
  await app.click('[data-action="production-summary"]');
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'));
  const book = app.current();
  assert.equal(book.chapters[0].content, '가'.repeat(1500));
  assert.equal(book.chapters[1].content, '나'.repeat(1500));
  assert.equal(app.requests.filter(request => request.payload.operation === 'production_book_plan').length, 1);
  assert.equal(app.requests.filter(request => request.payload.operation === 'production_section' && request.payload.index === 0).length, 1);
  assert.equal(app.requests.filter(request => request.payload.operation === 'production_section' && request.payload.index === 1).length, 2, 'Only the cancelled second chapter may be requested again');
});

test('short generated results receive bounded revision and an honest target-length review state', async t => {
  const app = await boot(t);
  connectMock(app, ({ payload }) => productionResult(payload, { short: true }));
  await newBrief(app, { source: '' }); await app.submit('#production-form'); await app.until(() => app.current()?.production);
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="needs_review"]'), 'Undersized chapters need a review summary');
  const book = app.current();
  assert.equal(book.production.status, 'needs_review');
  assert.equal(book.chapters.reduce((sum, chapter) => sum + chapter.content.length, 0), 900);
  assert.equal(app.requests.filter(request => request.payload.operation === 'production_revision').length, 2, 'Automatic length correction must be bounded to one attempt per section');
  assert.match(app.$('.production-summary').textContent, /검토 필요|목표 분량/);
  assert.match(app.$('.production-summary').textContent, /900/);
  assert.match(app.$('#toast-region').textContent, /차이|검토/);
  assert.doesNotMatch(app.$('#toast-region').textContent, /제작을 마쳤습니다/);
  assert.ok(app.$('.modal [data-action="production-retry"]'), 'Further paid corrections must require an explicit action');
  const beforeRetry = app.requests.length;
  connectMock(app);
  await approveStart(app, true);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'));
  assert.deepEqual(app.requests.slice(beforeRetry).map(request => request.payload.operation), ['production_revision', 'production_revision'], 'An explicit retry must revise only the flagged sections');
  assert.equal(app.current().chapters.reduce((sum, chapter) => sum + chapter.content.length, 0), 3000);
});

test('switching to estimated pages updates labels and derived length before saving', async t => {
  const app = await boot(t);
  await newBrief(app);
  await app.input('#production-target-unit', 'pages', true);
  await app.input('#production-target-value', '12');
  assert.match(app.$('#production-target-label').textContent, /쪽/);
  assert.match(app.$('#production-target-help').textContent, /800/);
  assert.match(app.$('#production-target-estimate').textContent, /9,600/);
  assert.equal(app.$('#production-target-value').min, '4');
  assert.equal(app.$('#production-target-value').max, '375');
  await app.submit('#production-form'); await app.until(() => app.current()?.production);
  assert.equal(app.current().production.brief.targetUnit, 'pages');
  assert.equal(app.current().production.brief.targetValue, 12);
  assert.equal(app.current().production.targetChars, 9600);
  assert.match(app.$('.production-summary').textContent, /실제 쪽수|참고값/);
  assert.equal(app.requests.length, 0);
});

test('decoded source overflow and invalid UTF-8 reject the file without truncating existing data', async t => {
  const app = await boot(t), original = '원래 자료는 그대로 보존됩니다.';
  await newBrief(app, { source: original });
  await app.attach('#production-source-file', new app.win.File(['a'.repeat(120001)], '한도 초과.md', { type: 'text/markdown' }));
  assert.equal(app.$('#production-source').value, original);
  assert.match(app.$('#production-feedback').textContent, /120,000|자르지/);
  await app.attach('#production-source-file', new app.win.File([new Uint8Array([0xc3, 0x28])], '문자 오류.md', { type: 'text/markdown' }));
  assert.equal(app.$('#production-source').value, original);
  assert.match(app.$('#production-feedback').textContent, /UTF-8|텍스트/);
  assert.equal(app.requests.length, 0);
});

test('a reloaded partial book resumes from saved sections after connecting again', async t => {
  const app = await boot(t);
  let stalledSignal;
  connectMock(app, ({ payload, options }) => {
    if (payload.operation === 'production_section' && payload.index === 1) {
      stalledSignal = options.signal;
      return new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }); });
    }
  });
  await newBrief(app, { source: '' }); await app.submit('#production-form'); await app.until(() => app.current()?.production);
  await approveStart(app); await app.until(() => stalledSignal);
  await app.click('[data-action="cancel-operation"]'); await app.until(() => app.current().production.status === 'paused');
  const bookId = app.current().id;
  await app.click('.modal [data-action="close-modal"]');
  await app.restart();
  assert.equal(app.current().id, bookId);
  assert.equal(app.current().chapters[0].content, '가'.repeat(1500));
  connectMock(app);
  await app.click('[data-action="production-summary"]');
  const requestsBefore = app.requests.length;
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'));
  assert.equal(app.requests.length, requestsBefore + 1, 'Only the unfinished chapter should be generated after reload');
  assert.equal(app.requests.at(-1).payload.index, 1);
  assert.equal(app.current().chapters[0].content, '가'.repeat(1500));
  assert.equal(app.current().chapters[1].content, '나'.repeat(1500));
});

test('production stops before an AI call when the saved workspace can no longer be written', async t => {
  const app = await boot(t);
  connectMock(app);
  await newBrief(app, { source: '' }); await app.submit('#production-form'); await app.until(() => app.current()?.production);
  const before = structuredClone(app.current());
  Object.defineProperty(app.win.localStorage, 'setItem', { configurable: true, value: () => { throw new DOMException('Quota exhausted', 'QuotaExceededError'); } });
  await approveStart(app);
  await app.until(() => document.querySelector('.storage-recovery'));
  assert.equal(app.requests.length, 0, 'A production checkpoint must be durable before the first paid call');
  assert.deepEqual(app.current(), before);
  assert.match(app.$('#save-state').textContent, /저장 실패/);
  assert.doesNotMatch(app.$('#toast-region').textContent, /제작을 마쳤습니다/);
});

test('failed artwork resumes after completed text without regenerating any chapter', async t => {
  const app = await boot(t);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
  let rejectFirstImage = true;
  connectMock(app, ({ payload }) => {
    if (payload.operation !== 'production_image') return;
    if (rejectFirstImage) { rejectFirstImage = false; return new Response('{}', { status: 403, headers: { 'Content-Type': 'application/json' } }); }
    return jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { data: png, mimeType: 'image/png' } }] } }] });
  });
  await newBrief(app, { source: '' });
  await app.input('#production-illustrations', 'ai', true);
  await app.submit('#production-form'); await app.until(() => app.current()?.production);
  await approveStart(app);
  await app.until(() => app.current().production.artwork.status === 'failed', 'Denied image access should retain completed text');
  assert.equal(app.current().production.status, 'complete');
  const completeChapters = structuredClone(app.current().chapters);
  assert.equal(completeChapters[0].content, '가'.repeat(1500));
  assert.equal(completeChapters[1].content, '나'.repeat(1500));
  await app.until(() => document.querySelector('.modal [data-action="close-modal"]'));
  await app.click('.modal [data-action="close-modal"]');
  await app.click('[data-action="production-summary"]');
  assert.match(app.$('.production-summary').textContent, /삽화|그림/);
  assert.ok(app.$('.modal [data-action="production-start"]'), 'An artwork failure needs an explicit resume action');
  const textRequestsBefore = app.requests.filter(request => !['production_image', 'book_cover_brief'].includes(request.payload.operation)).length;
  await approveStart(app);
  await app.until(() => app.current().production.artwork.status === 'complete');
  await app.until(() => document.querySelector('.production-summary'));
  assert.equal(app.requests.filter(request => !['production_image', 'book_cover_brief'].includes(request.payload.operation)).length, textRequestsBefore, 'Artwork resume must not repeat source, planning, or text generation');
  assert.deepEqual(app.current().chapters.map(chapter => chapter.content), completeChapters.map(chapter => chapter.content));
  assert.equal(app.requests.filter(request => request.payload.operation === 'production_image').length, 4, 'One denied cover plus a successful cover and two chapter illustrations');
  assert.ok(app.current().coverImage?.src.startsWith('data:image/png;base64,'));
  assert.ok(app.current().chapters.every(chapter => chapter.image?.src.startsWith('data:image/png;base64,')));
  assert.equal(document.querySelector('.modal [data-action="production-start"]'), null, 'Fully completed artwork should not offer redundant generation');
});

test('manual edits after a pause remain intact and prevent automatic resume from overwriting them', async t => {
  const app = await boot(t);
  let stalledSignal;
  connectMock(app, ({ payload, options }) => {
    if (payload.operation === 'production_section' && payload.index === 1) {
      stalledSignal = options.signal;
      return new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }); });
    }
  });
  await newBrief(app); await app.submit('#production-form'); await app.until(() => app.current()?.production);
  await approveStart(app); await app.until(() => stalledSignal);
  await app.click('[data-action="cancel-operation"]'); await app.until(() => app.current().production.status === 'paused');
  await app.click('.modal [data-action="close-modal"]');
  await app.click('[data-action="editor-tab"][data-tab="write"]');
  const userText = '직접 확인한 내용으로 고친 원고입니다. 이 문장은 자동 재개가 덮어쓰면 안 됩니다.';
  await app.input('#manuscript-text', userText); await app.save();
  const requestsBefore = app.requests.length;
  await app.click('[data-action="production-summary"]');
  assert.match(app.$('.production-summary').textContent, /직접 수정|수정한 원고|덮어쓰/);
  assert.equal(document.querySelector('.modal [data-action="production-start"]'), null, 'Resume should not be offered for a manually modified manuscript');
  assert.equal(app.current().chapters[0].content, userText);
  assert.equal(app.current().production.brief.sourceMarkdown, rawSource);
  assert.equal(app.requests.length, requestsBefore);
  await app.key('Escape'); await app.restart();
  assert.equal(app.current().chapters[0].content, userText);
  assert.equal(app.current().production.brief.sourceMarkdown, rawSource);
});
