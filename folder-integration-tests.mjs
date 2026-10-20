/** Recursive folder ingestion DOM QA. Simulated FileLists; no native picker, browser layout, or live API calls. */
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
    ai.clearAI(); await import(`./dist/app.js?folder-ui=${bootNumber++}`); await settle();
  };
  await import(`./dist/app.js?folder-ui=${bootNumber++}`);
  await until(() => document.querySelector('[data-action="editor-tab"][data-tab="read"]') && localStorage.getItem(workspaceKey));
  await click('[data-action="editor-tab"][data-tab="write"]');
  return { ai, install, $, $$, settle, until, click, input, key, submit, saved, save, current, attach, restart, downloads, requests, get win() { return win; } };
}

const initialSource = '# 직접 입력한 원시 자료\n기존 자료를 보관합니다.';
const stableBooks = state => state.projects.map(({ updatedAt, ...project }) => project);

async function newBrief(app, source = initialSource) {
  await app.click('[data-action="production-new"]');
  await app.input('#production-topic', '폴더의 조사 자료를 빠짐없이 바탕으로 삼는 책');
  await app.input('#production-title', '폴더 속 기록');
  await app.input('#production-author', '김기록');
  await app.input('#production-source', source);
  await app.input('#production-instructions', '파일 경로를 바탕으로 자료의 출처를 구별하고 원문에 없는 사실을 만들지 마세요.');
  await app.input('#production-target-value', '3000');
  await app.input('#production-chapters', '2');
  await app.input('#production-illustrations', 'none', true);
}

function file(app, path, content = '# 메모\n자료 본문', { bytes, read } = {}) {
  const entry = new app.win.File([bytes ?? content], path.split('/').at(-1), { type: /\.(md|markdown)$/i.test(path) ? 'text/markdown' : 'application/octet-stream' });
  Object.defineProperty(entry, 'webkitRelativePath', { configurable: true, value: path });
  if (read) Object.defineProperty(entry, 'arrayBuffer', { value: read });
  return entry;
}

async function ingest(app, files, selector = '#production-source-folder') {
  await app.attach(selector, files);
  await app.until(() => !app.$('#production-form [type="submit"]').disabled, 'Source file batch did not settle');
}

function storedManifest(app) { return app.current().production.brief.sourceManifest; }

async function saveBrief(app) {
  await app.submit('#production-form');
  await app.until(() => app.current()?.production);
  return app.current().production.brief;
}

async function approveStart(app) {
 const before=app.requests.length;
 await app.click('.modal [data-action="production-start"]');
 assert.equal(app.requests.length,before,'Estimate must make no paid request');
 app.$('#production-approval-check').checked=true;
 app.$('#production-approval-check').dispatchEvent(new app.win.Event('change',{bubbles:true}));
 await app.click('[data-action="production-approve"]');
}

test('folder picker covers descendants and offers a labelled multiple-file fallback without requesting network access', async t => {
  const app = await boot(t);
  await newBrief(app);
  const folder = app.$('#production-source-folder'), fallback = app.$('#production-source-files');
  assert.equal(folder.type, 'file');
  assert.equal(folder.hasAttribute('webkitdirectory'), true);
  assert.equal(folder.multiple, true);
  assert.equal(fallback.type, 'file');
  assert.equal(fallback.multiple, true);
  assert.equal(fallback.hasAttribute('webkitdirectory'), false);
  assert.ok(app.$('label[for="production-source-folder"]').textContent.trim());
  assert.ok(app.$('label[for="production-source-files"]').textContent.trim());
  assert.match(app.$('#production-form').textContent, /하위|폴더 속/);
  assert.match(app.$('#production-form').textContent, /120,000/);
  assert.equal(app.requests.length, 0);
});

test('recursive Markdown files with repeated basenames retain all bodies, relative paths and deterministic order', async t => {
  const app = await boot(t), before = stableBooks(app.saved());
  await newBrief(app);
  const bodies = new Map([
    ['원고/01-서론/메모.md', '\ufeff\n# 첫 노트\r\n첫째 근거입니다.  \r\n'],
    ['원고/02-본론/깊은 폴더/메모.MD', '# 깊은 노트\n둘째 근거입니다.\n'],
    ['원고/03-부록/보충.markdown', '# 부록\n셋째 근거입니다.\n'],
  ]);
  const attachments = [...bodies].reverse().map(([path, body]) => file(app, path, body));
  const ignored = file(app, '원고/02-본론/읽지 않을 문서.pdf', 'not an image', { read: async () => { throw new Error('Non-Markdown data must never be opened'); } });
  await ingest(app, [attachments[0], ignored, ...attachments.slice(1)]);
  const merged = app.$('#production-source').value;
  for (const body of bodies.values()) assert.ok(merged.includes(body), 'Each raw body must be preserved, including BOM and CRLF');
  assert.ok(merged.indexOf([...bodies.values()][0]) < merged.indexOf([...bodies.values()][1]));
  const list = app.$('#production-source-files-list').textContent;
  for (const path of bodies.keys()) assert.ok(list.includes(path), `Missing path ${path}`);
  assert.match(app.$('#production-form').textContent, /제외|건너뛰/);
  const brief = await saveBrief(app), manifest = storedManifest(app);
  assert.equal(brief.sourceMarkdown, merged);
  assert.deepEqual(manifest.files.map(entry => entry.path), [...bodies.keys()]);
  assert.equal(manifest.ignoredCount, 1);
  assert.equal(manifest.folderName, '원고');
  for (const entry of manifest.files) {
    assert.equal(brief.sourceMarkdown.slice(entry.start, entry.end), bodies.get(entry.path));
    assert.equal(entry.chars, bodies.get(entry.path).length);
    assert.equal(entry.bytes, new TextEncoder().encode(bodies.get(entry.path)).length);
  }
  assert.deepEqual(stableBooks(app.saved()).slice(0, before.length), before);
  assert.equal(app.requests.length, 0);
});

test('folder source provenance and contents survive edit, reload, backup, import and raw Markdown download', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '책/2장/메모.md', '# 둘째\n두 번째 원문'), file(app, '책/1장/메모.md', '# 첫째\n첫 번째 원문')]);
  const original = structuredClone(await saveBrief(app));
  await app.click('.modal [data-action="production-edit"]');
  assert.equal(app.$('#production-source').value, original.sourceMarkdown);
  assert.ok(app.$('#production-source-files-list').textContent.includes('책/2장/메모.md'));
  await app.input('#production-title', '폴더 자료 제목 수정');
  await app.submit('#production-form');
  await app.until(() => document.querySelector('.production-summary'));
  const edited = app.current().production.brief;
  assert.equal(edited.sourceMarkdown, original.sourceMarkdown);
  assert.deepEqual(edited.sourceManifest, original.sourceManifest);
  await app.click('.modal [data-action="production-source-download"]');
  assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await app.downloads.at(-1).blob.arrayBuffer()), original.sourceMarkdown);
  await app.key('Escape');
  await app.restart();
  assert.deepEqual(storedManifest(app), original.sourceManifest);
  await app.click('[data-action="backup"]');
  const backup = app.downloads.at(-1), backupText = await backup.blob.text();
  assert.deepEqual(JSON.parse(backupText).project.production.brief.sourceManifest, original.sourceManifest);
  const originalId = app.current().id;
  await app.click('[data-action="import"]');
  await app.attach('input[type="file"]', new app.win.File([backupText], backup.filename, { type: 'application/json' }));
  await app.save();
  assert.notEqual(app.current().id, originalId);
  assert.equal(app.current().production.brief.sourceMarkdown, original.sourceMarkdown);
  assert.deepEqual(storedManifest(app), original.sourceManifest);
  assert.equal(app.requests.length, 0);
});

test('multiple-file fallback works without directory paths and a new selection replaces the previous source', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '옛폴더/old.md', '# 이전 폴더 내용')]);
  const second = [new app.win.File(['# 둘째 내용'], '02.md'), new app.win.File(['# 첫째 내용'], '01.markdown')];
  await ingest(app, second, '#production-source-files');
  const merged = app.$('#production-source').value;
  assert.equal(merged.includes('# 이전 폴더 내용'), false);
  assert.ok(merged.indexOf('# 첫째 내용') < merged.indexOf('# 둘째 내용'));
  const brief = await saveBrief(app);
  assert.deepEqual(brief.sourceManifest.files.map(entry => entry.path), ['01.markdown', '02.md']);
  assert.equal(app.requests.length, 0);
});

test('unsafe UTF-8, duplicate paths and excess aggregate content fail atomically without overwriting an earlier folder', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '남길자료/원문.md', '# 보존할 자료\n이전 파일 내용')]);
  const previous = app.$('#production-source').value;
  const scenarios = [
    [file(app, '새폴더/a.md', '# 일부만 반영하면 안 되는 파일'), file(app, '새폴더/b.md', '', { bytes: new Uint8Array([0xc3, 0x28]) })],
    [file(app, '새폴더/중복.md', '# 첫 파일'), file(app, '새폴더/중복.md', '# 경로가 중복되는 둘째 파일')],
    [file(app, '새폴더/큰파일.md', '가'.repeat(120000)), file(app, '새폴더/작은파일.md', '# 마지막 파일')],
  ];
  for (const selection of scenarios) {
    await ingest(app, selection);
    assert.equal(app.$('#production-source').value, previous);
    assert.ok(app.$('#production-source-files-list').textContent.includes('남길자료/원문.md'));
    assert.equal(app.$('#production-feedback').hidden, false);
    assert.ok(app.$('#production-feedback').textContent.trim());
  }
  const brief = await saveBrief(app);
  assert.equal(brief.sourceMarkdown, previous);
  assert.deepEqual(brief.sourceManifest.files.map(entry => entry.path), ['남길자료/원문.md']);
  assert.equal(app.requests.length, 0);
});

test('a folder with no Markdown files does not erase existing raw source', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '빈자료/문서.pdf', 'document'), file(app, '빈자료/일반텍스트.txt', 'text')]);
  assert.equal(app.$('#production-source').value, initialSource);
  assert.equal(app.$('#production-feedback').hidden, false);
  assert.match(app.$('#production-feedback').textContent, /Markdown|MD|마크다운/i);
  assert.equal(app.requests.length, 0);
});

function deferredFile(app, path) {
  let finish;
  const pending = file(app, path, '# 대기 중인 원문', { read: () => new Promise(resolve => { finish = resolve; }) });
  return { pending, resolve: body => finish(new TextEncoder().encode(body).buffer), ready: () => Boolean(finish) };
}

test('newer folder selections beat a pending older read and submitting during a read is blocked', async t => {
  const app = await boot(t), before = stableBooks(app.saved());
  await newBrief(app);
  const older = deferredFile(app, '이전폴더/느린파일.md');
  await app.attach('#production-source-folder', [older.pending]);
  await app.until(older.ready);
  assert.equal(app.$('#production-form [type="submit"]').disabled, true);
  await app.submit('#production-form');
  assert.deepEqual(stableBooks(app.saved()), before);
  await ingest(app, [file(app, '최신폴더/최신.md', '# 최신 파일\n최신 내용만 남습니다.')]);
  const latest = app.$('#production-source').value;
  older.resolve('# 오래된 결과가 덮어쓰면 안 됩니다.');
  await app.settle(); await app.settle();
  assert.equal(app.$('#production-source').value, latest);
  assert.ok(app.$('#production-source-files-list').textContent.includes('최신폴더/최신.md'));
  assert.equal(app.$('#production-form [type="submit"]').disabled, false);
  assert.equal(app.requests.length, 0);
});

test('manual source editing cancels a pending folder read and removes obsolete provenance', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '기존/자료.md', '# 기존 폴더 자료')]);
  const pending = deferredFile(app, '늦은폴더/자료.md');
  await app.attach('#production-source-folder', [pending.pending]);
  await app.until(pending.ready);
  await app.input('#production-source', '# 사용자가 직접 수정한 최종 자료');
  assert.equal(app.$('#production-form [type="submit"]').disabled, false);
  pending.resolve('# 늦게 온 파일 내용'); await app.settle(); await app.settle();
  assert.equal(app.$('#production-source').value, '# 사용자가 직접 수정한 최종 자료');
  const brief = await saveBrief(app);
  assert.equal(brief.sourceMarkdown, '# 사용자가 직접 수정한 최종 자료');
  assert.equal(brief.sourceManifest, undefined);
  assert.equal(app.requests.length, 0);
});

test('cancelling a folder read preserves previous input and closing its form prevents a later update', async t => {
  const app = await boot(t);
  await newBrief(app);
  const cancelled = deferredFile(app, '취소한폴더/느린파일.md');
  await app.attach('#production-source-folder', [cancelled.pending]);
  await app.until(cancelled.ready);
  await app.click('[data-action="production-source-cancel"]');
  assert.equal(app.$('#production-source').value, initialSource);
  assert.equal(app.$('#production-form [type="submit"]').disabled, false);
  cancelled.resolve('# 취소 이후 도착한 파일'); await app.settle(); await app.settle();
  assert.equal(app.$('#production-source').value, initialSource);
  const abandoned = deferredFile(app, '닫힌폼/느린파일.md');
  await app.attach('#production-source-folder', [abandoned.pending]);
  await app.until(abandoned.ready);
  await app.key('Escape');
  await newBrief(app, '# 새 폼에만 남을 자료');
  abandoned.resolve('# 닫힌 폼의 결과'); await app.settle(); await app.settle();
  assert.equal(app.$('#production-source').value, '# 새 폼에만 남을 자료');
  assert.equal(app.requests.length, 0);
});

test('a single-file import replaces a folder bundle and clears folder provenance', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '폴더/원문.md', '# 폴더 내용')]);
  const single = '\ufeff# 단일 파일\r\n이 내용으로 교체합니다.  \r\n';
  await app.attach('#production-source-file', new app.win.File([single], '단일.md'));
  await app.until(() => app.$('#production-source').value === single);
  const brief = await saveBrief(app);
  assert.equal(brief.sourceMarkdown, single);
  assert.equal(brief.sourceName, '단일.md');
  assert.equal(brief.sourceManifest, undefined);
  assert.equal(app.requests.length, 0);
});

test('file paths and source HTML remain inert text in the form, saved summary and reloaded workspace', async t => {
  const app = await boot(t);
  await newBrief(app);
  const path = '자료/<img src=x onerror=alert(1)>.md';
  const body = '# 원시 HTML\n<img src=x onerror=alert(2)>\n<script>globalThis.folderInjected=true</script>';
  await ingest(app, [file(app, path, body)]);
  assert.ok(app.$('#production-source-files-list').textContent.includes(path));
  assert.equal(document.querySelector('.modal img[src="x"]'), null);
  assert.equal(document.querySelector('.modal script'), null);
  assert.equal(globalThis.folderInjected, undefined);
  await saveBrief(app);
  assert.ok(app.$('.production-source-preview').textContent.includes(body));
  assert.equal(document.querySelector('.modal img[src="x"]'), null);
  assert.equal(document.querySelector('.modal script'), null);
  await app.key('Escape'); await app.restart();
  await app.click('[data-action="production-summary"]');
  assert.ok(app.$('#production-source-files-list').textContent.includes(path));
  assert.equal(document.querySelector('.modal img[src="x"]'), null);
  assert.equal(app.requests.length, 0);
});

test('explicit production receives every nested source body after folder ingestion itself makes no API request', async t => {
  const app = await boot(t);
  app.ai.configureAI({ provider: 'google', apiKey: 'AIza-folder-integration-test-only' });
  app.install('fetch', async (url, options) => {
    const body = JSON.parse(options.body), payload = JSON.parse(body.contents[0].parts[0].text);
    app.requests.push({ url, options, payload });
    let result;
    if (payload.operation === 'production_source_digest') result = { id: payload.rawSource.id, summary: '상위와 하위 폴더의 관찰 자료입니다.', facts: [], quotes: [], unknowns: [] };
    else if (payload.operation === 'production_book_plan') result = { title: '폴더 속 기록', subtitle: '', description: '폴더에 모인 관찰을 다룹니다.', chapters: Array.from({ length: payload.brief.chapterCount }, (_, i) => ({ title: `관찰 기록 ${i + 1}`, purpose: '관찰을 바탕으로 구체적으로 설명합니다.', outline: ['상황', '적용'], sourceRefs: payload.sourceSummary.map(source => source.id) })) };
    else if (['production_section', 'production_revision'].includes(payload.operation)) result = { content: (payload.index ? '나' : '가').repeat(payload.targetChars), notes: [], imagePrompt: '', sourceRefs: payload.sourceSummary.map(source => source.id) };
    else throw new Error(`Unexpected mocked operation ${payload.operation}`);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }] }), { headers: { 'Content-Type': 'application/json' } });
  });
  await newBrief(app);
  const upper = '# 상위 폴더 관찰\n첫 관찰 기록입니다.', nested = '# 깊은 하위 관찰\n두 번째 관찰 기록입니다.';
  await ingest(app, [file(app, '조사/첫째.md', upper), file(app, '조사/하위/다시하위/둘째.md', nested)]);
  const brief = await saveBrief(app);
  assert.equal(app.requests.length, 0);
  await approveStart(app);
  await app.until(() => document.querySelector('.production-summary[data-production-status="complete"]'));
  const sourceRequests = app.requests.filter(call => call.payload.operation === 'production_source_digest');
  assert.equal(sourceRequests.length, 1);
  assert.equal(sourceRequests[0].payload.rawSource.text, brief.sourceMarkdown);
  assert.ok(sourceRequests[0].payload.rawSource.text.includes(upper));
  assert.ok(sourceRequests[0].payload.rawSource.text.includes(nested));
  assert.equal(app.current().production.brief.sourceMarkdown, brief.sourceMarkdown);
  assert.deepEqual(storedManifest(app), brief.sourceManifest);
  assert.equal(app.requests.some(call => call.payload.operation === 'image'), false);
});

test('backup import rejects tampered source provenance without changing the saved library', async t => {
  const app = await boot(t);
  await newBrief(app);
  await ingest(app, [file(app, '자료/원문.md', '# 보존할 원문\n자료 본문')]);
  await saveBrief(app);
  await app.key('Escape'); await app.click('[data-action="backup"]');
  const backup = JSON.parse(await app.downloads.at(-1).blob.text());
  backup.project.production.brief.sourceManifest.files[0].end += 1;
  const before = stableBooks(app.saved());
  await app.click('[data-action="import"]');
  await app.attach('input[type="file"]', new app.win.File([JSON.stringify(backup)], '손상된-백업.json', { type: 'application/json' }));
  await app.settle(); await app.settle();
  assert.deepEqual(stableBooks(app.saved()), before);
  assert.equal(app.requests.length, 0);
});
