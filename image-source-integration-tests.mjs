/** Mixed image/Markdown folder DOM QA. Simulated FileLists and AI responses; no native picker or live API calls. */
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
    const element = $(selector); Object.defineProperty(element, 'files', { configurable: true, value: Array.isArray(file) ? file : [file] });
    element.dispatchEvent(new win.Event('change', { bubbles: true })); await settle(); await settle();
  };
  const restart = async () => {
    const entries = Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)]; }));
    for (const timer of timers) nativeClearTimeout(timer);
    timers.clear(); await win.happyDOM.close(); setupWindow(entries);
    ai.clearAI(); await import(`./dist/app.js?image-source-ui=${bootNumber++}`); await settle();
  };
  await import(`./dist/app.js?image-source-ui=${bootNumber++}`);
  await until(() => document.querySelector('[data-action="editor-tab"][data-tab="read"]') && localStorage.getItem(workspaceKey));
  await click('[data-action="editor-tab"][data-tab="write"]');
  return { ai, install, $, $$, settle, until, click, input, key, submit, saved, save, current, attach, restart, downloads, requests, get win() { return win; } };
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const PNG_BYTES = Uint8Array.from(Buffer.from(PNG, 'base64'));
const PNG_URI = `data:image/png;base64,${PNG}`;
const stableBooks = state => state.projects.map(({ updatedAt, ...project }) => project);
const testKey = 'AIza-image-source-integration-test-only';
const jsonResponse = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

async function newBrief(app, { topic = '자료 사진과 조사 메모를 바탕으로 쓰는 책', source = '' } = {}) {
  await app.click('[data-action="production-new"]');
  await app.input('#production-topic', topic);
  await app.input('#production-title', '사진 속 기록');
  await app.input('#production-author', '기록자');
  await app.input('#production-source', source);
  await app.input('#production-instructions', '자료에서 확인되는 사실만 사용하고 흐릿한 글씨나 수치는 추측하지 마세요.');
  await app.input('#production-target-value', '3000');
  await app.input('#production-chapters', '2');
  await app.input('#production-illustrations', 'none', true);
}

function file(app, path, bytes, { type, read } = {}) {
  const entry = new app.win.File([bytes ?? (/\.png$/i.test(path) ? PNG_BYTES : '# 조사 메모\n참고 자료입니다.')], path.split('/').at(-1), { type: type ?? (/\.png$/i.test(path) ? 'image/png' : 'text/markdown') });
  Object.defineProperty(entry, 'webkitRelativePath', { configurable: true, value: path });
  if (read) Object.defineProperty(entry, 'arrayBuffer', { value: read });
  return entry;
}

async function ingest(app, files, selector = '#production-source-folder') {
  await app.attach(selector, files);
  await app.until(() => !app.$('#production-form [type="submit"]').disabled, 'Source selection did not settle');
}

async function saveBrief(app) {
  await app.submit('#production-form');
  await app.until(() => app.current()?.production, 'Mixed-source brief did not save');
  return app.current().production.brief;
}

function mockedResult(payload) {
  if (payload.operation === 'production_source_digest') return { id: payload.rawSource.id, summary: '문서에 적힌 관찰 기록입니다.', facts: ['문서 자료가 존재합니다.'], quotes: [], unknowns: [] };
  if (payload.operation === 'production_image_digest') return { id: payload.rawSourceImage.id, summary: `자료 이미지 ${payload.rawSourceImage.path}의 관찰 내용입니다.`, facts: ['한 픽셀의 이미지입니다.'], quotes: [], unknowns: ['작은 이미지라 글씨를 판독할 수 없습니다.'] };
  if (payload.operation === 'production_book_plan') return { title: '사진 속 기록', subtitle: '', description: '문서와 사진의 자료를 바탕으로 씁니다.', chapters: Array.from({ length: payload.brief.chapterCount }, (_, i) => ({ title: `관찰 ${i + 1}`, purpose: '확인되는 내용을 설명합니다.', outline: ['자료의 내용', '관찰의 한계'], sourceRefs: payload.sourceSummary.map(source => source.id) })) };
  if (['production_section', 'production_revision'].includes(payload.operation)) return { content: (payload.index ? '나' : '가').repeat(payload.targetChars), notes: [], imagePrompt: '', sourceRefs: payload.sourceSummary.map(source => source.id) };
  throw new Error(`Unexpected mocked operation ${payload.operation}`);
}

function connectMock(app, handler = () => undefined) {
  app.ai.configureAI({ provider: 'google', apiKey: testKey });
  app.install('fetch', async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    const payload = body ? JSON.parse(body.contents[0].parts[0].text) : undefined;
    const call = { url, options, body, payload }; app.requests.push(call);
    if (!body) return jsonResponse({ name: `models/${app.ai.getAIConfig().textModel}`, supportedGenerationMethods: ['generateContent'] });
    const result = await handler(call);
    if (result instanceof Response) return result;
    return jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result ?? mockedResult(payload)) }] } }] });
  });
}

async function approveStart(app) {
 const before=app.requests.length;
 await app.click('.modal [data-action="production-start"]');
 assert.equal(app.requests.length,before,'Estimate must make no paid request');
 app.$('#production-approval-check').checked=true;
 app.$('#production-approval-check').dispatchEvent(new app.win.Event('change',{bubbles:true}));
 await app.click('[data-action="production-approve"]');
}

test('mixed folder controls accept Markdown and raster images and show every nested image before any API request', async t => {
  const app = await boot(t);
  await newBrief(app);
  const input = app.$('#production-source-files');
  assert.match(input.accept, /\.png/);
  assert.match(input.accept, /\.jpe?g/);
  assert.match(input.accept, /\.webp/);
  assert.match(input.accept, /\.md/);
  assert.equal(app.$('#production-source-folder').hasAttribute('webkitdirectory'), true);
  const paths = ['자료/2장/이미지.png', '자료/10장/깊은/이미지.png'];
  await ingest(app, [file(app, paths[1]), file(app, '자료/원고.md', '# 조사 원문'), file(app, paths[0])]);
  assert.ok(app.$('#production-source').value.includes('# 조사 원문'));
  const preview = app.$('#production-source-images');
  for (const path of paths) assert.ok(preview.textContent.includes(path));
  assert.equal(preview.querySelectorAll('img').length, 2);
  for (const img of preview.querySelectorAll('img')) assert.equal(img.getAttribute('src'), PNG_URI);
  const brief = await saveBrief(app);
  assert.deepEqual(brief.sourceImages.map(image => image.path), paths);
  assert.ok(brief.sourceImages.every(image => image.src === PNG_URI && image.mimeType === 'image/png' && image.bytes === PNG_BYTES.length));
  assert.equal(brief.sourceManifest.files.length, 1);
  assert.equal(app.requests.length, 0);
});

test('an image-only folder can become a book brief with an empty topic and empty Markdown', async t => {
  const app = await boot(t);
  await newBrief(app, { topic: '' });
  await ingest(app, [file(app, '사진/하위/다시하위/조사.png')]);
  assert.equal(app.$('#production-source').value, '');
  const brief = await saveBrief(app);
  assert.equal(brief.topic, '');
  assert.equal(brief.sourceMarkdown, '');
  assert.equal(brief.sourceImages.length, 1);
  assert.equal(brief.sourceImages[0].path, '사진/하위/다시하위/조사.png');
  assert.equal(brief.sourceManifest, undefined);
  assert.match(app.$('.production-summary').textContent, /이미지/);
  assert.equal(app.requests.length, 0);
});

test('manual Markdown edits and a single Markdown import preserve images, and image removal keeps remaining sources', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '원고/메모.md'), file(app, '원고/1.png'), file(app, '원고/깊은/2.png')]);
  await app.input('#production-source', '# 직접 수정한 원시 메모');
  assert.equal(app.$('#production-source-images').querySelectorAll('img').length, 2);
  await app.attach('#production-source-file', new app.win.File(['# 단일 원문으로 수정'], '단일.md', { type: 'text/markdown' }));
  await app.until(() => app.$('#production-source').value === '# 단일 원문으로 수정');
  assert.equal(app.$('#production-source-images').querySelectorAll('img').length, 2);
  await app.click('[data-action="production-source-image-remove"][data-index="0"]');
  assert.equal(app.$('#production-source-images').querySelectorAll('img').length, 1);
  const brief = await saveBrief(app);
  assert.equal(brief.sourceMarkdown, '# 단일 원문으로 수정');
  assert.equal(brief.sourceManifest, undefined);
  assert.deepEqual(brief.sourceImages.map(image => image.path), ['원고/깊은/2.png']);
  assert.equal(app.requests.length, 0);
});

test('new mixed file selections replace both Markdown and images instead of silently retaining earlier folder images', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '첫폴더/첫원문.md', '# 첫 폴더'), file(app, '첫폴더/첫.png')]);
  await ingest(app, [file(app, '둘째폴더/둘째.png')], '#production-source-files');
  assert.equal(app.$('#production-source').value, '');
  let preview = app.$('#production-source-images');
  assert.equal(preview.textContent.includes('첫폴더/첫.png'), false);
  assert.ok(preview.textContent.includes('둘째폴더/둘째.png'));
  await ingest(app, [file(app, '셋째폴더/셋째.md', '# 셋째 폴더')]);
  assert.equal(document.querySelectorAll('#production-source-images img').length, 0);
  const brief = await saveBrief(app);
  assert.ok(brief.sourceMarkdown.includes('# 셋째 폴더'));
  assert.equal(brief.sourceImages?.length ?? 0, 0);
  assert.equal(app.requests.length, 0);
});

test('an invalid or duplicate image makes a mixed selection fail atomically without replacing any previous source', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '보존/원문.md', '# 보존할 문서'), file(app, '보존/원본.png')]);
  const original = app.$('#production-source').value;
  const badSelections = [
    [file(app, '새자료/메모.md', '# 반영되면 안 되는 메모'), file(app, '새자료/가짜.png', '<script>alert(1)</script>')],
    [file(app, '새자료/동일.png'), file(app, '새자료/동일.png')],
    [file(app, '새자료/상위/../위험.png')],
  ];
  for (const selection of badSelections) {
    await ingest(app, selection);
    assert.equal(app.$('#production-source').value, original);
    assert.ok(app.$('#production-source-images').textContent.includes('보존/원본.png'));
    assert.equal(app.$('#production-source-images').querySelectorAll('img').length, 1);
    assert.equal(app.$('#production-feedback').hidden, false);
  }
  const brief = await saveBrief(app);
  assert.deepEqual(brief.sourceImages.map(image => image.path), ['보존/원본.png']);
  assert.equal(app.requests.length, 0);
});

test('image paths with HTML remain inert in preview, summary and reloaded book', async t => {
  const app = await boot(t);
  await newBrief(app);
  const path = '사진/<img src=x onerror=alert(1)>.png';
  await ingest(app, [file(app, path)]);
  const assertInert = () => {
    assert.equal(document.querySelector('.modal img[src="x"]'), null);
    assert.equal(document.querySelector('.modal script'), null);
    assert.equal(document.querySelector('.modal [onerror]'), null);
    assert.ok(app.$('#production-source-images').textContent.includes(path));
  };
  assertInert();
  await saveBrief(app); assertInert();
  await app.key('Escape'); await app.restart();
  await app.click('[data-action="production-summary"]'); assertInert();
  assert.equal(app.requests.length, 0);
});

test('image bytes and nested provenance survive editing, reload, backup and restore without credentials', async t => {
  const app = await boot(t);
  connectMock(app);
  await newBrief(app);
  await ingest(app, [file(app, '기록/메모.md', '# 원문'), file(app, '기록/하위/자료.png')]);
  const brief = structuredClone(await saveBrief(app));
  await app.click('.modal [data-action="production-edit"]');
  assert.equal(app.$('#production-source-images').querySelector('img').getAttribute('src'), PNG_URI);
  await app.input('#production-title', '제목 수정');
  await app.submit('#production-form'); await app.until(() => document.querySelector('.production-summary'));
  assert.deepEqual(app.current().production.brief.sourceImages, brief.sourceImages);
  await app.key('Escape'); await app.restart();
  assert.deepEqual(app.current().production.brief.sourceImages, brief.sourceImages);
  await app.click('[data-action="backup"]');
  const download = app.downloads.at(-1), backupText = await download.blob.text();
  assert.equal(backupText.includes(testKey), false);
  assert.deepEqual(JSON.parse(backupText).project.production.brief.sourceImages, brief.sourceImages);
  const previousId = app.current().id;
  await app.click('[data-action="import"]');
  await app.attach('input[type="file"]', new app.win.File([backupText], download.filename, { type: 'application/json' }));
  await app.until(() => app.current().id !== previousId);
  assert.deepEqual(app.current().production.brief.sourceImages, brief.sourceImages);
  assert.equal(app.requests.length, 0);
});

test('backup import rejects remote images, spoofed raster payloads and mismatched metadata without altering books', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '원고/원본.png')]);
  await saveBrief(app); await app.key('Escape'); await app.click('[data-action="backup"]');
  const original = JSON.parse(await app.downloads.at(-1).blob.text());
  const before = stableBooks(app.saved());
  const tamper = [
    image => { image.src = 'https://tracking.invalid/private-book.png'; },
    image => { image.src = 'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='; },
    image => { image.mimeType = 'image/jpeg'; },
    image => { image.bytes += 1; },
    image => { image.path = '원고/../위험.png'; },
  ];
  for (const mutate of tamper) {
    const backup = structuredClone(original); mutate(backup.project.production.brief.sourceImages[0]);
    await app.click('[data-action="import"]');
    await app.attach('input[type="file"]', new app.win.File([JSON.stringify(backup)], '손상된-백업.json', { type: 'application/json' }));
    await app.settle(); await app.settle();
    assert.deepEqual(stableBooks(app.saved()), before);
  }
  assert.equal(app.requests.length, 0);
});

test('manual text editing cancels a pending image read and keeps previously selected images', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '보존/이미지.png')]);
  let finish;
  const pending = file(app, '새사진/느린.png', undefined, { read: () => new Promise(resolve => { finish = resolve; }) });
  await app.attach('#production-source-folder', [pending]); await app.until(() => Boolean(finish));
  assert.equal(app.$('#production-form [type="submit"]').disabled, true);
  await app.input('#production-source', '# 사용자가 고친 최신 메모');
  assert.equal(app.$('#production-form [type="submit"]').disabled, false);
  finish(PNG_BYTES.slice().buffer); await app.settle(); await app.settle();
  assert.equal(app.$('#production-source').value, '# 사용자가 고친 최신 메모');
  assert.ok(app.$('#production-source-images').textContent.includes('보존/이미지.png'));
  assert.equal(app.$('#production-source-images').textContent.includes('새사진/느린.png'), false);
  const brief = await saveBrief(app);
  assert.deepEqual(brief.sourceImages.map(image => image.path), ['보존/이미지.png']);
  assert.equal(app.requests.length, 0);
});

test('explicit production sends each nested image as multimodal input and uses all image digests in planning and writing', async t => {
  const app = await boot(t);
  connectMock(app);
  await newBrief(app);
  const paths = ['연구/1.png', '연구/하위/다시하위/2.png'];
  await ingest(app, [file(app, '연구/원문.md', '# 원시 기록'), ...paths.map(path => file(app, path))]);
  await saveBrief(app);
  assert.equal(app.requests.length, 0);
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'), 'Mixed source mocked production did not complete');
  const imageCalls = app.requests.filter(call => call.payload?.operation === 'production_image_digest');
  assert.equal(imageCalls.length, 2);
  assert.deepEqual(imageCalls.map(call => call.payload.rawSourceImage.path), paths);
  assert.deepEqual(imageCalls.map(call => call.payload.rawSourceImage.id), ['image-source-1', 'image-source-2']);
  for (const call of imageCalls) {
    assert.deepEqual(call.body.contents[0].parts[1].inlineData, { mimeType: 'image/png', data: PNG });
    assert.equal(call.body.contents[0].parts.length, 2);
    assert.equal(JSON.stringify(call.payload).includes(PNG), false, 'Binary data belongs only to the multimodal part');
  }
  const textCalls = app.requests.filter(call => ['production_book_plan', 'production_section'].includes(call.payload?.operation));
  assert.equal(textCalls.length, 3);
  for (const call of textCalls) {
    assert.deepEqual(call.payload.sourceSummary.map(source => source.id), ['source-1', 'image-source-1', 'image-source-2']);
    assert.deepEqual(call.payload.brief.sourceImageContext.map(image => image.path), paths);
    assert.equal(JSON.stringify(call.body).includes(PNG), false, 'Writing requests should not repeat image bytes');
  }
  assert.equal(app.current().production.status, 'complete');
  assert.equal(app.current().chapters.length, 2);
  assert.equal(app.requests.length, 6, 'One Markdown digest, two image digests, one plan, two chapter requests');
});

test('image-only production reaches planning and writing with image references and no empty Markdown digest', async t => {
  const app = await boot(t);
  connectMock(app);
  await newBrief(app, { topic: '' });
  await ingest(app, [file(app, '사진집/안쪽/관찰.png')]);
  await saveBrief(app);
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'), 'Image-only mocked production did not complete');
  assert.equal(app.requests.filter(call => call.payload?.operation === 'production_source_digest').length, 0);
  const plan = app.requests.find(call => call.payload?.operation === 'production_book_plan');
  assert.equal(plan.payload.brief.topic, '');
  assert.deepEqual(plan.payload.sourceSummary.map(source => source.id), ['image-source-1']);
  assert.equal(app.current().production.brief.sourceImages[0].src, PNG_URI);
});

test('cancelling during a later image analysis saves earlier analyses and resume does not request them again', async t => {
  const app = await boot(t);
  let blocked = false;
  connectMock(app, ({ payload, options }) => {
    if (payload?.operation === 'production_image_digest' && payload.rawSourceImage.id === 'image-source-2' && !blocked) {
      blocked = true;
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Test cancellation', 'AbortError')), { once: true }));
    }
  });
  await newBrief(app, { topic: '' });
  await ingest(app, [file(app, '사진/1.png'), file(app, '사진/2.png')]);
  await saveBrief(app);
  await approveStart(app); await app.until(() => blocked);
  await app.click('.modal [data-action="cancel-operation"]');
  await app.until(() => app.current().production.status === 'paused');
  await app.until(() => document.querySelector('.modal [data-action="close-modal"]'));
  await app.key('Escape');
  await app.click('[data-action="production-summary"]');
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'), 'Paused image-only production did not resume');
  const calls = app.requests.filter(call => call.payload?.operation === 'production_image_digest');
  assert.deepEqual(calls.map(call => call.payload.rawSourceImage.id), ['image-source-1', 'image-source-2', 'image-source-2']);
  assert.equal(app.current().production.status, 'complete');
});

test('removing all images leaves Markdown intact and an otherwise empty brief cannot be saved', async t => {
  const app = await boot(t);
  await newBrief(app, { topic: '' });
  await ingest(app, [file(app, '자료/원고.md', '# 유지할 원문'), file(app, '자료/사진.png')]);
  const source = app.$('#production-source').value;
  await app.click('[data-action="production-source-images-clear"]');
  assert.equal(app.$('#production-source').value, source);
  assert.equal(document.querySelectorAll('#production-source-images img').length, 0);
  await app.input('#production-source', '');
  const before = stableBooks(app.saved());
  await app.submit('#production-form');
  assert.ok(app.$('#production-form'));
  assert.deepEqual(stableBooks(app.saved()), before);
  assert.equal(app.$('#production-feedback').hidden, false);
  assert.equal(app.requests.length, 0);
});

test('provider image-analysis text is escaped in saved summaries and unverified observations remain visible', async t => {
  const app = await boot(t);
  const unsafe = '<img src=x onerror=alert(1)><script>globalThis.imageAnalysisInjected=true</script>';
  connectMock(app, ({ payload }) => payload?.operation === 'production_image_digest' ? {
    id: payload.rawSourceImage.id, summary: unsafe, facts: ['<iframe src="https://example.invalid">관찰</iframe>'], quotes: [], unknowns: ['글자가 흐려 읽을 수 없습니다.'],
  } : undefined);
  await newBrief(app, { topic: '' });
  await ingest(app, [file(app, '사진/관찰.png')]);
  await saveBrief(app);
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'));
  const summary = app.$('.production-image-digest');
  assert.ok(summary.textContent.includes(unsafe));
  assert.ok(summary.textContent.includes('글자가 흐려 읽을 수 없습니다.'));
  assert.equal(summary.querySelector('script'), null);
  assert.equal(summary.querySelector('iframe'), null);
  assert.equal(summary.querySelector('[onerror]'), null);
  assert.equal(globalThis.imageAnalysisInjected, undefined);
});
