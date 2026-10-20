/** Cover editor red-team DOM integration. Mocked decoders and providers; no browser layout or paid API calls. */
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
  install('fetch', async (url, options) => { requests.push({ url, options }); throw new Error('Unexpected network request in cover UI integration'); });
  const oldCreateObjectURL = URL.createObjectURL, oldRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = blob => { const url = `blob:folio-cover-test-${blobs.size + 1}`; blobs.set(url, blob); return url; };
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
    ai.clearAI(); await import(`./dist/app.js?cover-ui=${bootNumber++}`); await settle();
  };
  await import(`./dist/app.js?cover-ui=${bootNumber++}`);
  await until(() => document.querySelector('[data-tab="write"]') && localStorage.getItem(workspaceKey));
  await click('[data-action="editor-tab"][data-tab="write"]');
  return { ai, install, $, $$, settle, until, click, input, key, submit, saved, save, current, attach, restart, downloads, requests, get win() { return win; } };
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';

async function delayedImage(app, action, filename = 'my-background.png') {
  const pending = [];
  app.install('FileReader', class { readAsDataURL() { this.result = PNG; this.onload?.(); } });
  app.install('Image', class {
    constructor() { pending.push(this); this.width = 400; this.height = 600; }
    set src(value) { this.source = value; }
  });
  await app.click(`[data-action="${action}"]`);
  await app.attach('input[type="file"]', new app.win.File(['validated by mocked decoder'], filename, { type: 'image/png' }));
  assert.equal(pending.length, 1, 'The image decode should remain pending');
  return async () => { pending[0].onload(); await app.settle(); await app.settle(); await app.save(); };
}
async function upload(app, action, filename) { const finish = await delayedImage(app, action, filename); await finish(); }
async function design(app) { await app.click('.side-nav [data-view="design"]'); }
async function newBook(app, title = '다른 책') {
  await app.click('[data-action="library"]'); await app.click('.modal [data-action="new-project"]');
  await app.input('#new-title', title); await app.input('#new-author', '김작가'); await app.submit('#new-project-form'); await app.save();
}
async function importBook(app, project) {
  await app.click('[data-action="import"]');
  await app.attach('input[type="file"]', new app.win.File([JSON.stringify({ project })], 'cover-book.json', { type: 'application/json' }));
  await app.save();
}

// Data remains separate so a reader can move between uploaded photos and generated artwork.
test('uploading a background preserves existing cover art and switches the visible cover source', async t => {
  const app = await boot(t); await design(app);
  await upload(app, 'upload-cover', 'art.png');
  const artwork = structuredClone(app.current().coverImage);
  await upload(app, 'upload-background', 'background.png');
  let book = app.current();
  assert.deepEqual(book.coverImage, artwork);
  assert.equal(book.coverBackground.src, PNG);
  assert.equal(book.coverBackground.alt, 'background');
  assert.equal(book.coverDesign.source, 'background');
  assert.equal(app.$('.preview-column .cover-image-full').getAttribute('alt'), 'background');
  await app.input('#cover-source', 'art', true); await app.save();
  book = app.current();
  assert.equal(book.coverDesign.source, 'art');
  assert.equal(book.coverBackground.alt, 'background');
  assert.equal(app.$('.preview-column .cover-image-full').getAttribute('alt'), 'art');
  assert.equal(app.requests.length, 0, 'Local cover editing must not make provider requests');
});

test('cover placement controls persist, update the preview, and survive reload', async t => {
  const app = await boot(t); await design(app); await upload(app, 'upload-background', 'positioned.png');
  await app.input('#cover-fit', 'contain', true);
  await app.input('#cover-position', 'bottom', true);
  await app.input('#cover-overlay', '63', true);
  await app.input('#cover-text-color', 'dark', true);
  await app.input('#cover-layout', 'bottom', true);
  await app.save();
  const expected = { source: 'background', fit: 'contain', position: 'bottom', overlay: 63, textColor: 'dark', layout: 'bottom' };
  assert.deepEqual(app.current().coverDesign, expected);
  assert.equal(app.$('.preview-column .cover-image-full').style.objectFit, 'contain');
  assert.match(app.$('.preview-column .cover-image-full').style.objectPosition, /bottom|100%/);
  assert.ok(app.$('.preview-column .cover-layout-bottom'));
  await app.restart(); await design(app);
  assert.deepEqual(app.current().coverDesign, expected);
  assert.equal(app.$('#cover-overlay').value, '63');
  assert.equal(app.$('#cover-text-color').value, 'dark');
  // happy-dom incorrectly reports the penultimate option's .value after parsing a selected last option.
  assert.equal(app.$('#cover-layout option[selected]').value, 'bottom');
  await app.click('.project-head-actions [data-action="preview"]');
  await app.until(() => document.querySelector('.modal .folio-book-stage .cover-heading'));
  assert.equal(app.$('.modal .folio-book-stage .cover-heading').style.justifyContent, 'flex-end');
  assert.equal(app.$('.modal .folio-book-stage .cover-frame > img').getAttribute('src'), PNG);
  assert.equal(app.$('.modal .folio-book-stage .cover-frame > img').style.objectFit, 'contain');
});

test('background data and cover layout survive backup/import while a separate project is created', async t => {
  const app = await boot(t); await design(app); await upload(app, 'upload-cover', 'art.png'); await upload(app, 'upload-background', 'backup-bg.png');
  await app.input('#cover-position', 'top', true); await app.input('#cover-layout', 'center', true); await app.save();
  const original = structuredClone(app.current());
  await app.click('[data-action="backup"]');
  const downloaded = app.downloads.at(-1), backup = JSON.parse(await downloaded.blob.text());
  assert.deepEqual(backup.project.coverBackground, original.coverBackground);
  assert.deepEqual(backup.project.coverDesign, original.coverDesign);
  await importBook(app, backup.project);
  const imported = app.current();
  assert.notEqual(imported.id, original.id);
  assert.deepEqual(imported.coverBackground, original.coverBackground);
  assert.deepEqual(imported.coverImage, original.coverImage);
  assert.deepEqual(imported.coverDesign, original.coverDesign);
});

test('removing a background keeps generated art and history can recover the full prior cover', async t => {
  const app = await boot(t); await design(app); await upload(app, 'upload-cover', 'art.png'); await upload(app, 'upload-background', 'recoverable-bg.png');
  await app.input('#cover-overlay', '51', true); await app.save();
  const before = structuredClone(app.current());
  await app.click('[data-action="remove-background"]'); await app.save();
  assert.equal(app.current().coverBackground, undefined);
  assert.deepEqual(app.current().coverImage, before.coverImage);
  assert.equal(app.current().coverDesign.source, 'art');
  await app.click('.side-nav [data-view="editor"]');
  await app.click('[data-action="history"]');
  await app.click('.modal [data-action="restore"]'); await app.save();
  assert.deepEqual(app.current().coverBackground, before.coverBackground);
  assert.deepEqual(app.current().coverDesign, before.coverDesign);
});

test('an older background decode cannot replace the newest selected image', async t => {
  const app = await boot(t); await design(app);
  const older = await delayedImage(app, 'upload-background', 'older.png');
  const newer = await delayedImage(app, 'upload-background', 'newer.png');
  await newer(); await older();
  assert.equal(app.current().coverBackground.alt, 'newer');
  assert.equal(app.current().coverDesign.source, 'background');
});

test('resetting a cover invalidates an unfinished upload and restores the default cover', async t => {
  const app = await boot(t); await design(app); await upload(app, 'upload-cover', 'old-art.png'); await upload(app, 'upload-background', 'old-bg.png');
  await app.input('#cover-layout', 'bottom', true);
  const pending = await delayedImage(app, 'upload-background', 'late-bg.png');
  await app.click('[data-action="reset-cover"]'); await pending();
  assert.equal(app.current().coverImage, undefined);
  assert.equal(app.current().coverBackground, undefined);
  assert.equal(app.current().coverDesign?.layout ?? 'top', 'top');
  assert.equal(document.querySelector('.preview-column .cover-image-full'), null);
});

test('removing a background invalidates an unfinished replacement upload', async t => {
  const app = await boot(t); await design(app); await upload(app, 'upload-background', 'old-bg.png');
  const pending = await delayedImage(app, 'upload-background', 'late-bg.png');
  await app.click('[data-action="remove-background"]'); await pending();
  assert.equal(app.current().coverBackground, undefined);
  assert.equal(app.current().coverDesign.source, 'art');
});

test('a newer source choice stays selected when an earlier background upload finishes', async t => {
  const app = await boot(t); await design(app); await upload(app, 'upload-cover', 'keep-art.png'); await upload(app, 'upload-background', 'old-bg.png');
  const pending = await delayedImage(app, 'upload-background', 'late-bg.png');
  await app.input('#cover-source', 'art', true); await app.save(); await pending();
  assert.equal(app.current().coverDesign.source, 'art');
  assert.equal(app.$('.preview-column .cover-image-full').getAttribute('alt'), 'keep-art');
});

test('background upload completion stays with its initial book and never redirects the editor', async t => {
  const app = await boot(t); const originalId = app.current().id; await design(app);
  const pending = await delayedImage(app, 'upload-background', 'first-book-bg.png');
  await newBook(app, '새로 고른 책'); const newId = app.current().id;
  await app.click('[data-action="editor-tab"][data-tab="write"]');
  app.$('#manuscript-text').focus(); app.$('#manuscript-text').setSelectionRange(0, 0);
  await pending();
  assert.equal(app.saved().activeId, newId);
  assert.equal(app.current().coverBackground, undefined);
  assert.equal(app.saved().projects.find(p => p.id === originalId).coverBackground.alt, 'first-book-bg');
  assert.ok(app.$('#manuscript-text'));
  assert.equal(document.activeElement, app.$('#manuscript-text'));
});

test('unsafe background imports cannot replace the current workspace or fetch remote data', async t => {
  const app = await boot(t); const before = structuredClone(app.saved());
  for (const src of ['https://tracking.invalid/private-book', 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>'), 'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==']) {
    await importBook(app, { ...before.projects[0], coverBackground: { src }, coverDesign: { source: 'background' } });
    assert.equal(app.saved().activeId, before.activeId);
    assert.equal(app.saved().projects.length, before.projects.length);
    assert.equal(document.querySelector('img[src^="https:"]'), null);
  }
  assert.equal(app.requests.length, 0);
});

function jsonResponse(value) { return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }); }
const coverBrief = { concept: '해안 관측 기록에서 반복되는 조수와 등대의 관계', imagePrompt: '해 질 무렵의 낮은 등대와 층을 이루는 조수 흔적, 은회색 바위, 절제된 남색 수채화', alt: '해 질 무렵 해안의 낮은 등대와 조수 흔적' };
function connectCoverMock(app, handler = () => undefined) {
  app.ai.configureAI({ provider: 'google', apiKey: 'AIza-cover-integration-test-only' });
  app.install('fetch', async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    const payload = !body ? undefined : body.generationConfig?.responseModalities?.includes('IMAGE') ? { operation: 'cover_image', prompt: body.contents[0].parts[0].text } : JSON.parse(body.contents[0].parts[0].text);
    const call = { url, options, body, payload }; app.requests.push(call);
    if (!body) return jsonResponse({ name: `models/${app.ai.getAIConfig().textModel}`, supportedGenerationMethods: ['generateContent'] });
    const result = await handler(call);
    if (result instanceof Response) return result;
    if (payload.operation === 'book_cover_brief') return jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result ?? coverBrief) }] } }] });
    if (payload.operation === 'cover_image') return jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { data: PNG.split(',')[1], mimeType: 'image/png' } }] } }] });
    throw new Error(`Unexpected cover operation ${payload.operation}`);
  });
}
function coastalWorkspace() {
  const book = { id: 'coastal-book', title: '조수의 시간', subtitle: '바다를 관찰하는 날들', author: '정파도', description: '작은 해안 마을의 조수와 등대 관측 기록', language: 'ko', genre: '자연 에세이', audience: '바다를 관찰하는 독자', tone: '담담한 관찰 기록', theme: 'sage', updatedAt: new Date().toISOString(), chapters: [
    { id: 'ch-tides', title: '물결이 남긴 선', content: '첫 장 고유 내용: 어제의 만조선 아래에 납작한 자갈을 세 개 놓았다. 조수는 오후에 다시 돌아왔다.' },
    { id: 'ch-light', title: '낮은 등대의 불빛', content: '마지막 장 고유 내용: 낮은 등대에서 보낸 빛이 젖은 바위에 닿았다. 짙은 남색의 수평선이 오래 남았다.' },
  ] };
  return { projects: [book], activeId: book.id, histories: {} };
}

test('manual Google cover generation uses the title, actual chapters and direction while preserving an uploaded background', async t => {
  const app = await boot(t, { workspace: coastalWorkspace() });
  await design(app); await upload(app, 'upload-background', 'personal-photo.png');
  const originalBackground = structuredClone(app.current().coverBackground);
  await app.input('#cover-layout', 'bottom', true); await app.input('#cover-text-color', 'dark', true); await app.save();
  connectCoverMock(app);
  await app.click('[data-action="generate-cover"]');
  const direction = '남색 수채화로 그려 주세요. 인물 없이 등대와 조수 흔적을 보여 주세요.';
  await app.input('#image-prompt', direction); await app.submit('#image-form');
  await app.until(() => app.current().coverImage?.src, 'Generated cover should be saved');
  await app.until(() => !document.querySelector('.modal'), 'Generation should finish');
  assert.deepEqual(app.requests.map(request => request.payload.operation), ['book_cover_brief', 'cover_image']);
  const payload = app.requests[0].payload;
  assert.equal(payload.book.title, '조수의 시간');
  assert.equal(payload.userDirection, direction);
  assert.equal(payload.titlePlacement, 'bottom');
  assert.equal(payload.textColor, 'dark');
  assert.ok(JSON.stringify(payload.manuscriptSamples).includes('첫 장 고유 내용'));
  assert.ok(JSON.stringify(payload.manuscriptSamples).includes('마지막 장 고유 내용'));
  assert.match(app.requests[1].payload.prompt, /등대|조수/);
  assert.deepEqual(app.current().coverBackground, originalBackground);
  assert.equal(app.current().coverDesign.source, 'art');
  assert.equal(app.current().coverDesign.layout, 'bottom');
  assert.equal(app.current().coverImage.alt, coverBrief.alt);
  assert.equal(localStorage.getItem(workspaceKey).includes('AIza-cover-integration-test-only'), false);
  assert.equal(app.current().title, '조수의 시간', 'The rendered title remains text and must not be replaced by cover generation');
});

test('cancelling a cover briefing preserves current art and background and permits another try', async t => {
  const app = await boot(t, { workspace: coastalWorkspace() }); await design(app);
  await upload(app, 'upload-cover', 'keep-art.png'); await upload(app, 'upload-background', 'keep-background.png');
  const before = structuredClone(app.current());
  let stalledSignal;
  connectCoverMock(app, ({ options, payload }) => {
    if (payload.operation !== 'book_cover_brief') return;
    stalledSignal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  });
  await app.click('[data-action="generate-cover"]'); await app.input('#image-prompt', '은은한 수채화'); await app.submit('#image-form');
  await app.until(() => stalledSignal, 'Brief request should remain pending');
  await app.click('[data-action="generate-cover"]');
  assert.equal(app.requests.length, 1, 'Background actions must not launch another paid operation');
  await app.click('[data-action="cancel-operation"]');
  await app.until(() => document.querySelector('.modal [data-action="close-modal"]'));
  assert.equal(stalledSignal.aborted, true);
  assert.deepEqual(app.current().coverImage, before.coverImage);
  assert.deepEqual(app.current().coverBackground, before.coverBackground);
  assert.deepEqual(app.current().coverDesign, before.coverDesign);
  await app.click('.modal [data-action="close-modal"]');
  await app.click('[data-action="generate-cover"]');
  assert.ok(app.$('#image-form'));
});

test('cover generation without a key preserves the cover and opens connection settings without requests', async t => {
  const app = await boot(t); await design(app); await upload(app, 'upload-background', 'offline-background.png');
  const before = structuredClone(app.current());
  await app.click('[data-action="generate-cover"]');
  assert.ok(app.$('#ai-form'));
  assert.deepEqual(app.current().coverBackground, before.coverBackground);
  assert.deepEqual(app.current().coverDesign, before.coverDesign);
  assert.equal(app.requests.length, 0);
});

test('automatic book production briefs its cover from the completed manuscript and retains the selected user background', async t => {
  const { createProductionProject } = await import('./dist/production.js');
  const project = createProductionProject({ topic: '해안 마을의 조수와 등대 관측', title: '조수의 시간', author: '정파도', sourceMarkdown: '', instructions: '관찰 가능한 해안 장면만 사용하고 인물은 넣지 마세요.', audience: '자연 에세이 독자', tone: '담담한 기록', targetUnit: 'chars', targetValue: 3000, chapterCount: 2, illustrations: 'ai', language: 'ko', genre: '에세이' });
  const app = await boot(t, { workspace: { projects: [project], activeId: project.id, histories: {} } });
  await design(app); await upload(app, 'upload-background', 'author-background.png');
  const background = structuredClone(app.current().coverBackground);
  connectCoverMock(app, ({ payload }) => {
    let result;
    if (payload.operation === 'production_book_plan') result = { title: '조수의 시간', subtitle: '물결을 기록한 두 장', description: '해안 관측을 바탕으로 만든 책', chapters: [
      { title: '조수의 흔적', purpose: '조수의 흔적을 관찰합니다.', outline: ['만조선의 변화', '자갈의 위치'], sourceRefs: [] },
      { title: '등대와 수평선', purpose: '등대의 빛을 기록합니다.', outline: ['물 위의 빛', '저녁 수평선'], sourceRefs: [] },
    ] };
    if (payload.operation === 'production_section') result = { content: (payload.index === 0 ? '조수의 흔적을 기록했다.' : '등대의 빛을 기록했다.').repeat(1500).slice(0, payload.targetChars), notes: [], imagePrompt: '', sourceRefs: [] };
    if (payload.operation === 'production_revision') result = { content: (payload.index === 0 ? '조수' : '등대').repeat(payload.targetChars).slice(0, payload.targetChars), notes: [], imagePrompt: '', sourceRefs: [] };
    if (result) return jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }] });
  });
  await app.click('[data-action="production-summary"]'); await app.click('.modal [data-action="production-start"]');
  assert.equal(app.requests.length, 0, 'Estimate must wait for approval');
  await app.until(() => document.querySelector('#production-approval-check'));
  app.$('#production-approval-check').checked = true;
  app.$('#production-approval-check').dispatchEvent(new app.win.Event('change', { bubbles: true }));
  await app.click('[data-action="production-approve"]');
  await app.until(() => app.current().production.artwork?.status === 'complete', 'Automatic artwork should finish');
  await app.until(() => document.querySelector('.production-summary'));
  const brief = app.requests.find(request => request.payload.operation === 'book_cover_brief').payload;
  assert.equal(brief.book.title, '조수의 시간');
  assert.equal(brief.book.topic, '해안 마을의 조수와 등대 관측');
  assert.equal(brief.book.instructions, '관찰 가능한 해안 장면만 사용하고 인물은 넣지 마세요.');
  assert.ok(JSON.stringify(brief.manuscriptSamples).includes('조수'));
  assert.ok(JSON.stringify(brief.manuscriptSamples).includes('등대'));
  assert.deepEqual(app.current().coverBackground, background);
  assert.equal(app.current().coverDesign.source, 'background', 'Automatic generation should preserve the author’s selected background');
  assert.equal(app.current().coverImage.src, PNG);
  assert.equal(app.requests.filter(request => request.payload.operation === 'book_cover_brief').length, 1);
  assert.equal(localStorage.getItem(workspaceKey).includes('AIza-cover-integration-test-only'), false);
});
