/** Contextual diagram DOM integration. Simulated provider responses; no browser layout or live API calls. */
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
  URL.createObjectURL = blob => { const url = `blob:folio-diagram-test-${blobs.size + 1}`; blobs.set(url, blob); return url; };
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
    ai.clearAI(); await import(`./dist/app.js?diagram-ui=${bootNumber++}`); await settle();
  };
  await import(`./dist/app.js?diagram-ui=${bootNumber++}`);
  await until(() => document.querySelector('[data-tab="write"]') && localStorage.getItem(workspaceKey));
  await click('[data-action="editor-tab"][data-tab="write"]');
  return { ai, install, $, $$, settle, until, click, input, key, submit, saved, save, current, attach, restart, downloads, requests, get win() { return win; } };
}

const testKey = 'AIza-diagram-integration-test-only';
const paragraph = '봄 매출 12만원, 여름 매출 20만원을 기록했다. 같은 단위로 적어 두 계절의 매출을 비교할 수 있다.';
const sourceContent = `매장의 기록을 펼쳤다.\n\n${paragraph}\n\n다음 해에도 같은 방식으로 기록할 예정이다.`;
const table = { type: 'table', title: '계절별 기록 방식', caption: '본문에 나온 두 기록을 비교합니다.', columns: ['항목', '기록'], rows: [['봄', '매출 기록'], ['여름', '매출 기록']], labels: [], values: [], unit: '', evidence: [] };
const bar = { type: 'bar', title: '계절별 매출', caption: '본문의 매출 기록', columns: [], rows: [], labels: ['봄', '여름'], values: [12, 20], unit: '만원', evidence: ['봄 매출 12만원', '여름 매출 20만원'] };
const block = diagram => `\`\`\`folio-diagram\n${JSON.stringify(diagram)}\n\`\`\``;
const jsonResponse = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

function manuscriptWorkspace(content = sourceContent) {
  const project = { id: 'diagram-book', title: '작은 가게의 기록', subtitle: '', author: '기록자', description: '계절마다 남긴 가게의 기록', language: 'ko', genre: '실용서', theme: 'sage', updatedAt: '2026-10-18T00:00:00.000Z', chapters: [{ id: 'chapter-1', title: '계절별 매출', content }, { id: 'chapter-2', title: '다음 기록', content: '다른 장의 원고는 그대로 남겨 둔다.' }] };
  return { projects: [project], activeId: project.id, histories: {} };
}

function mockedProduction(payload) {
  if (payload.operation === 'production_source_digest') return { id: payload.rawSource.id, summary: paragraph, facts: ['봄 매출 12만원', '여름 매출 20만원'], quotes: ['봄 매출 12만원', '여름 매출 20만원'], unknowns: [] };
  if (payload.operation === 'production_book_plan') return { title: '작은 가게의 기록', subtitle: '', description: '계절의 기록을 비교합니다.', chapters: Array.from({ length: payload.brief.chapterCount }, (_, i) => ({ title: `기록 ${i + 1}`, purpose: '기록의 의미를 설명합니다.', outline: ['자료의 내용', '활용 방법'], sourceRefs: payload.sourceSummary.map(source => source.id) })) };
  if (['production_section', 'production_revision'].includes(payload.operation)) return { content: (payload.index ? '나' : '가').repeat(payload.targetChars), notes: [], imagePrompt: '', sourceRefs: payload.sourceSummary.map(source => source.id) };
  throw new Error(`Unexpected mocked operation ${payload.operation}`);
}

function connectMock(app, handler = () => undefined) {
  app.ai.configureAI({ provider: 'google', apiKey: testKey });
  app.install('fetch', async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    assert.equal(body?.generationConfig?.responseModalities?.includes('IMAGE') ?? false, false, 'Diagrams must not call an image generator');
    const payload = body ? JSON.parse(body.contents[0].parts[0].text) : undefined;
    const call = { url, options, body, payload }; app.requests.push(call);
    if (!body) return jsonResponse({ name: `models/${app.ai.getAIConfig().textModel}`, supportedGenerationMethods: ['generateContent'] });
    const result = await handler(call);
    if (result instanceof Response) return result;
    return jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result ?? mockedProduction(payload)) }] } }] });
  });
}

async function newBrief(app, diagrams = 'auto') {
  await app.click('[data-action="production-new"]');
  await app.input('#production-topic', '자료를 바탕으로 기록 방법을 설명하는 책');
  await app.input('#production-title', '작은 가게의 기록');
  await app.input('#production-author', '기록자');
  await app.input('#production-source', paragraph);
  await app.input('#production-instructions', '필요한 비교만 도표로 정리하고 근거 없는 수치는 쓰지 마세요.');
  await app.input('#production-target-value', '3000');
  await app.input('#production-chapters', '2');
  await app.input('#production-illustrations', 'none', true);
  await app.input('#production-diagrams', diagrams, true);
}

async function saveBrief(app) {
  await app.submit('#production-form');
  await app.until(() => app.current()?.production, 'Production brief did not save');
  return app.current().production.brief;
}

async function approveStart(app) {
  const before = app.requests.length;
  await app.click('.modal [data-action="production-start"]');
  await app.until(() => document.querySelector('#production-approval-check'));
  assert.equal(app.requests.length, before, 'Opening the estimate must not send paid requests');
  app.$('#production-approval-check').checked = true;
  app.$('#production-approval-check').dispatchEvent(new app.win.Event('change', { bubbles: true }));
  await app.click('[data-action="production-approve"]');
}

async function waitForTask(app) {
  await app.until(() => !document.querySelector('.modal'), 'Diagram task did not finish');
}

test('automatic diagram preference defaults on and persists off through editing, reload and backup without API requests', async t => {
  const app = await boot(t);
  await app.click('[data-action="production-new"]');
  assert.equal(app.$('#production-diagrams option[selected]').value, 'auto');
  assert.equal(app.$('#production-chapters').max, '300');
  await app.key('Escape');
  await newBrief(app, 'none');
  const brief = await saveBrief(app);
  assert.equal(brief.diagrams, 'none');
  await app.click('.modal [data-action="production-edit"]');
  assert.equal(app.$('#production-diagrams option[selected]').value, 'none');
  await app.submit('#production-form'); await app.until(() => document.querySelector('.production-summary'));
  await app.key('Escape'); await app.restart();
  assert.equal(app.current().production.brief.diagrams, 'none');
  await app.click('[data-action="backup"]');
  const backup = JSON.parse(await app.downloads.at(-1).blob.text());
  assert.equal(backup.project.production.brief.diagrams, 'none');
  assert.equal(app.requests.length, 0);
});

test('manual diagram action without an API key opens settings and preserves manuscript and history', async t => {
  const app = await boot(t, { workspace: manuscriptWorkspace() });
  const before = structuredClone(app.saved());
  await app.click('[data-action="chapter-diagram"]');
  assert.ok(app.$('#ai-form'));
  assert.equal(app.current().chapters[0].content, sourceContent);
  assert.deepEqual(app.saved().histories, before.histories);
  assert.equal(app.requests.length, 0);
});

test('one explicit diagram request inserts a grounded chart after its paragraph and saves a recoverable original', async t => {
  const app = await boot(t, { workspace: manuscriptWorkspace() });
  connectMock(app, ({ payload }) => {
    assert.equal(payload.operation, 'chapter_diagram');
    assert.equal(payload.chapter.content, sourceContent);
    assert.equal(payload.book.title, '작은 가게의 기록');
    return { needed: true, reason: '같은 단위로 기록한 두 계절의 매출을 비교할 수 있습니다.', anchor: paragraph, diagram: bar };
  });
  await app.click('[data-action="chapter-diagram"]'); await waitForTask(app);
  const content = app.current().chapters[0].content;
  const { parseDiagramBlocks } = await import('./dist/diagrams.js');
  const diagrams = parseDiagramBlocks(content, { strict: true });
  assert.equal(diagrams.length, 1);
  assert.deepEqual(diagrams[0].diagram, bar);
  assert.ok(content.indexOf(paragraph) < diagrams[0].start);
  assert.ok(diagrams[0].end < content.indexOf('다음 해에도'));
  assert.equal(content.replace(diagrams[0].raw, '').replace(/\n{3,}/g, '\n\n'), sourceContent);
  assert.equal(app.current().chapters[1].content, '다른 장의 원고는 그대로 남겨 둔다.');
  assert.equal(app.saved().histories[app.current().id][0].project.chapters[0].content, sourceContent);
  assert.match(app.$('#chapter-diagram-status').textContent, /1/);
  assert.equal(app.requests.length, 1);
  assert.equal(localStorage.getItem(workspaceKey).includes(testKey), false);
  await app.click('[data-action="editor-tab"][data-tab="read"]');
  assert.ok(app.$('.read-content svg'));
  assert.ok(app.$('.read-content').textContent.includes('계절별 매출'));
  assert.ok(app.$('.read-content').textContent.includes('12'));
  assert.equal(app.$('.read-content').textContent.includes('folio-diagram'), false);
  await app.click('.project-head-actions [data-action="preview"]');
  await app.until(() => document.querySelector('[data-book-section]'));
  await app.input('[data-book-section]', '3', true);
  assert.ok(Boolean(app.$('.folio-book-stage svg')));
});

test('an unnecessary diagram returns its reason without editing or creating a history entry', async t => {
  const app = await boot(t, { workspace: manuscriptWorkspace() });
  const reason = '이 문단은 짧은 서술로 충분합니다. <img src=x onerror=alert(1)>';
  connectMock(app, () => ({ needed: false, reason, anchor: '', diagram: null }));
  const before = structuredClone(app.saved());
  await app.click('[data-action="chapter-diagram"]'); await waitForTask(app);
  assert.equal(app.current().chapters[0].content, sourceContent);
  assert.deepEqual(app.saved().histories, before.histories);
  assert.ok(app.$('#toast-region').textContent.includes(reason));
  assert.equal(document.querySelector('#toast-region img'), null);
  assert.equal(app.requests.length, 1);
});

test('unsupported chart data and missing insertion anchors cannot change a manuscript', async t => {
  const invalid = [
    { needed: true, reason: '비교', anchor: paragraph, diagram: { ...bar, values: [120, 20] } },
    { needed: true, reason: '비교', anchor: '본문에 없는 문단입니다.', diagram: bar },
    { needed: true, reason: '비교', anchor: paragraph, diagram: { ...bar, evidence: ['봄 매출 120만원', '여름 매출 20만원'] } },
    { needed: true, reason: '비교', anchor: paragraph, diagram: { ...bar, values: [20, 12], evidence: [paragraph, paragraph] } },
  ];
  const app = await boot(t, { workspace: manuscriptWorkspace() });
  let index = 0;
  connectMock(app, () => invalid[index++]);
  const before = structuredClone(app.saved());
  for (const _ of invalid) {
    await app.click('[data-action="chapter-diagram"]');
    await app.until(() => document.querySelector('.modal [data-action="close-modal"]'), 'Invalid response should fail visibly');
    assert.equal(app.current().chapters[0].content, sourceContent);
    assert.deepEqual(app.saved().histories, before.histories);
    await app.click('.modal [data-action="close-modal"]');
  }
  assert.equal(app.requests.length, invalid.length);
});

test('cancellation blocks duplicate requests and preserves the manuscript and history', async t => {
  const app = await boot(t, { workspace: manuscriptWorkspace() });
  let signal;
  connectMock(app, ({ options }) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  });
  const before = structuredClone(app.saved());
  await app.click('[data-action="chapter-diagram"]'); await app.until(() => signal);
  await app.click('[data-action="chapter-diagram"]');
  await app.input('#manuscript-text', '진행 중인 요청에 섞이면 안 되는 편집');
  assert.equal(app.requests.length, 1);
  await app.click('.modal [data-action="cancel-operation"]');
  await app.until(() => document.querySelector('.modal [data-action="close-modal"]'));
  assert.equal(signal.aborted, true);
  assert.equal(app.current().chapters[0].content, sourceContent);
  assert.deepEqual(app.saved().histories, before.histories);
});

test('a late response after cancellation cannot insert a chart or checkpoint', async t => {
  const app = await boot(t, { workspace: manuscriptWorkspace() });
  let finish;
  connectMock(app, () => new Promise(resolve => { finish = resolve; }));
  const before = structuredClone(app.saved());
  await app.click('[data-action="chapter-diagram"]'); await app.until(() => finish);
  await app.click('.modal [data-action="cancel-operation"]');
  finish({ needed: true, reason: '비교', anchor: paragraph, diagram: bar });
  await app.until(() => document.querySelector('.modal [data-action="close-modal"]'));
  assert.equal(app.current().chapters[0].content, sourceContent);
  assert.deepEqual(app.saved().histories, before.histories);
  assert.equal(app.requests.length, 1);
});

test('diagram source survives reload, backup/import and Markdown export while HTML renders safe visual content', async t => {
  const unsafe = '<img src=x onerror=alert(1)><script>globalThis.diagramInjected=true</script>';
  const hostileTable = { ...table, title: unsafe, rows: [['봄', unsafe], ['여름', '기록']] };
  const content = `${sourceContent}\n\n${block(hostileTable)}`;
  const app = await boot(t, { workspace: manuscriptWorkspace(content) });
  await app.click('[data-action="editor-tab"][data-tab="read"]');
  assert.ok(app.$('.read-content table'));
  assert.ok(app.$('.read-content').textContent.includes(unsafe));
  assert.equal(document.querySelector('.read-content script'), null);
  assert.equal(document.querySelector('.read-content img'), null);
  assert.equal(document.querySelector('.read-content [onerror]'), null);
  assert.equal(globalThis.diagramInjected, undefined);
  await app.restart();
  assert.equal(app.current().chapters[0].content, content);
  await app.click('[data-action="backup"]');
  const downloaded = app.downloads.at(-1), backupText = await downloaded.blob.text();
  assert.equal(JSON.parse(backupText).project.chapters[0].content, content);
  const previousId = app.current().id;
  await app.click('[data-action="import"]');
  await app.attach('input[type="file"]', new app.win.File([backupText], downloaded.filename, { type: 'application/json' }));
  await app.until(() => app.current().id !== previousId);
  assert.equal(app.current().chapters[0].content, content);
  const { exportHTML, exportMarkdown } = await import('./dist/export.js');
  assert.ok(exportMarkdown(app.current()).includes(block(hostileTable)));
  const html = await exportHTML(app.current());
  assert.ok(html.includes('<table'));
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img src=x'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(app.requests.length, 0);
});

test('automatic production adds a contextual table inside the existing writing request with no extra generation calls', async t => {
  const app = await boot(t);
  connectMock(app, ({ payload }) => {
    if (payload.operation !== 'production_section') return;
    assert.equal(payload.brief.diagrams, 'auto');
    const result = mockedProduction(payload);
    if (payload.index === 0) result.content += `\n\n${block(table)}`;
    return result;
  });
  await newBrief(app); await saveBrief(app);
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'), 'Production with diagrams should complete');
  const { parseDiagramBlocks } = await import('./dist/diagrams.js');
  assert.equal(parseDiagramBlocks(app.current().chapters[0].content, { strict: true }).length, 1);
  assert.equal(parseDiagramBlocks(app.current().chapters[1].content, { strict: true }).length, 0);
  assert.deepEqual(app.requests.map(call => call.payload.operation), ['production_source_digest', 'production_book_plan', 'production_section', 'production_section']);
  assert.equal(app.current().production.status, 'complete');
});

test('automatic diagrams can be turned off without changing source analysis or chapter generation', async t => {
  const app = await boot(t);
  connectMock(app, ({ payload }) => {
    if (payload.operation === 'production_section') assert.equal(payload.brief.diagrams, 'none');
  });
  await newBrief(app, 'none'); await saveBrief(app);
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'));
  assert.ok(app.current().chapters.every(chapter => !chapter.content.includes('folio-diagram')));
  assert.equal(app.current().production.brief.diagrams, 'none');
  assert.deepEqual(app.requests.map(call => call.payload.operation), ['production_source_digest', 'production_book_plan', 'production_section', 'production_section']);
});

test('a provider adding a diagram against the disabled preference cannot apply that section', async t => {
  const app = await boot(t);
  connectMock(app, ({ payload }) => payload.operation === 'production_section' ? { ...mockedProduction(payload), content: `${'가'.repeat(payload.targetChars)}\n\n${block(table)}` } : undefined);
  await newBrief(app, 'none'); await saveBrief(app);
  await approveStart(app);
  await app.until(() => document.querySelector('.modal [data-action="close-modal"]'), 'Disabled diagram response should fail');
  assert.ok(app.current().chapters.every(chapter => !chapter.content.includes('folio-diagram')));
  assert.notEqual(app.current().production.status, 'complete');
  assert.equal(app.requests.filter(call => call.payload.operation === 'production_section').length, 1);
});

test('local copyediting preserves diagram data and the editor counts visible table text instead of serialized JSON', async t => {
  const exactTable = { ...table, caption: '몇일 동안 기록한  두 가지 항목', rows: [['봄', '몇일 동안 기록'], ['여름', '할수있어요']] };
  const raw = block(exactTable), content = `몇일 뒤면 할수있어요.\n\n${raw}`;
  const app = await boot(t, { workspace: manuscriptWorkspace(content) });
  const visible = '몇일 뒤면 할수있어요.\n계절별 기록 방식\n몇일 동안 기록한  두 가지 항목\n항목 · 기록\n봄 · 몇일 동안 기록\n여름 · 할수있어요';
  const expected = Array.from(visible.replace(/\s/g, '')).length;
  assert.ok(app.$('#editor-count').textContent.trim().startsWith(`${expected}자`));
  assert.ok(expected < content.length - 100);
  await app.click('.side-nav [data-view="quality"]');
  await app.click('[data-action="copyedit"]'); await app.save();
  assert.equal(app.current().chapters[0].content, `며칠 뒤면 할 수 있어요.\n\n${raw}`);
  assert.equal(app.requests.length, 0);
});

test('an explicit current-chapter request remains available when automatic diagram generation is off', async t => {
  const { createProductionProject } = await import('./dist/production.js');
  const project = createProductionProject({ topic: '계절별 가게 기록', title: '작은 가게의 기록', author: '기록자', sourceMarkdown: paragraph, instructions: '', targetUnit: 'chars', targetValue: 3000, chapterCount: 2, illustrations: 'none', diagrams: 'none' });
  project.chapters[0].content = sourceContent;
  const app = await boot(t, { workspace: { projects: [project], activeId: project.id, histories: {} } });
  connectMock(app, ({ payload }) => {
    assert.equal(payload.book.diagrams, 'none');
    return { needed: true, reason: '직접 요청한 비교표', anchor: paragraph, diagram: table };
  });
  await app.click('[data-action="chapter-diagram"]'); await waitForTask(app);
  assert.ok(app.current().chapters[0].content.includes('folio-diagram'));
  assert.equal(app.current().production.brief.diagrams, 'none');
  assert.equal(app.requests.length, 1);
});

test('malformed saved diagram data remains visible as inert source and blocks paid additions until corrected', async t => {
  const content = `${sourceContent}\n\n\`\`\`folio-diagram\n{"title":"<script>alert(1)</script>"}\n\`\`\``;
  const app = await boot(t, { workspace: manuscriptWorkspace(content) });
  assert.match(app.$('#chapter-diagram-status').textContent, /확인.*1/);
  await app.click('[data-action="editor-tab"][data-tab="read"]');
  assert.ok(app.$('.read-content pre code').textContent.includes('<script>alert(1)</script>'));
  assert.equal(document.querySelector('.read-content script'), null);
  assert.ok(app.$('.read-content').textContent.includes('원본 데이터'));
  connectMock(app);
  await app.click('[data-action="chapter-diagram"]');
  await app.until(() => app.$('#toast-region').textContent.includes('도표 형식'));
  assert.equal(app.current().chapters[0].content, content);
  assert.equal(app.requests.length, 0);
});
