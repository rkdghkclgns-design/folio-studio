/** Node/Happy DOM and fake-indexeddb tests; these do not automate or render a browser. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { IDBFactory } from 'fake-indexeddb';
import { createWorkspaceStore, WORKSPACE_STORAGE_KEY as key } from './dist/storage.js';

const fixture = (content = '보존되어야 할 원고입니다.') => ({
  activeId: 'book-1', histories: {}, projects: [{ id: 'book-1', title: '원고 보존', author: '저자', subtitle: '', description: '', language: 'ko', theme: 'sage', updatedAt: '2026-01-01T00:00:00Z', chapters: [{ id: 'chapter-1', title: '첫 장', content }] }],
});
const valid = value => Array.isArray(value.projects) && value.projects.length > 0 && value.projects.every(project => Array.isArray(project.chapters) && project.chapters.length > 0);
function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[key, initial]]);
  return { getItem: name => values.has(name) ? values.get(name) : null, setItem: (name, value) => { values.set(name, String(value)); }, removeItem: name => values.delete(name) };
}
function store(options = {}) { return createWorkspaceStore({ localStorage: memoryStorage(), validateState: valid, ...options }); }
async function databaseRead(factory) {
  return await new Promise((resolve, reject) => {
    const request = factory.open('folio-studio', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('workspace', 'readonly');
      const get = transaction.objectStore('workspace').get('state');
      transaction.oncomplete = () => { resolve(get.result); database.close(); };
      transaction.onabort = () => { reject(transaction.error); database.close(); };
    };
  });
}

test('storage: fallback manuscripts migrate to a newly available IndexedDB without a sample overwrite', async t => {
  const saved = fixture('브라우저 대체 저장소의 유일한 원고');
  const fallback = memoryStorage(JSON.stringify(saved));
  const factory = new IDBFactory();
  const workspace = store({ indexedDB: factory, localStorage: fallback }); t.after(workspace.close);
  assert.deepEqual(await workspace.read(), saved);
  assert.equal(fallback.getItem(key), JSON.stringify(saved), 'read alone must not delete the fallback');
  await workspace.write(saved);
  assert.equal((await databaseRead(factory)).projects[0].chapters[0].content, saved.projects[0].chapters[0].content);
  assert.equal(fallback.getItem(key), null, 'remove redundant fallback only after the IDB commit');
});

test('storage: two IndexedDB tabs cannot overwrite a committed revision with stale state', async t => {
  const factory = new IDBFactory(), fallback = memoryStorage();
  const first = store({ indexedDB: factory, localStorage: fallback }); t.after(first.close);
  assert.equal(await first.read(), null);
  await first.write(fixture('초기 원고'));
  const second = store({ indexedDB: factory, localStorage: fallback }); t.after(second.close);
  const stale = await second.read();
  await first.write(fixture('첫 번째 탭이 확정한 새 원고'));
  stale.projects[0].chapters[0].content = '오래된 탭의 원고';
  await assert.rejects(second.write(stale), error => error.code === 'CONFLICT');
  assert.equal((await databaseRead(factory)).projects[0].chapters[0].content, '첫 번째 탭이 확정한 새 원고');
  await assert.rejects(second.write(stale), error => error.code === 'CONFLICT', 'conflict must remain locked until reload');
});

test('storage: simultaneous IndexedDB writers are resolved within one readwrite transaction', async t => {
  const factory = new IDBFactory(), fallback = memoryStorage();
  const first = store({ indexedDB: factory, localStorage: fallback }); t.after(first.close);
  await first.read(); await first.write(fixture());
  const second = store({ indexedDB: factory, localStorage: fallback }); t.after(second.close);
  await second.read();
  const outcomes = await Promise.allSettled([first.write(fixture('탭 A')), second.write(fixture('탭 B'))]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason.code === 'CONFLICT').length, 1);
});

test('storage: localStorage tabs preserve the newer saved manuscript on revision conflict', async t => {
  const fallback = memoryStorage(JSON.stringify(fixture('이전 원고')));
  const first = store({ localStorage: fallback }), second = store({ localStorage: fallback });
  t.after(first.close); t.after(second.close);
  await first.read(); await second.read();
  await first.write(fixture('새 원고'));
  await assert.rejects(second.write(fixture('오래된 탭 원고')), error => error.code === 'CONFLICT');
  assert.equal(JSON.parse(fallback.getItem(key)).projects[0].chapters[0].content, '새 원고');
});

test('storage: failed parsing preserves the exact recoverable source and prevents any write', async t => {
  const original = '{"projects":[{"title":"남은 원고","chapters":[{"content":"중요한 글"}]';
  const fallback = memoryStorage(original), workspace = store({ localStorage: fallback }); t.after(workspace.close);
  await assert.rejects(workspace.read(), error => error.code === 'CORRUPT');
  await assert.rejects(workspace.write(fixture()), error => error.code === 'CORRUPT');
  assert.equal(fallback.getItem(key), original);
  assert.equal(workspace.getRecoveryData().entries.localStorage, original);
});

test('storage: one damaged project cannot authorize replacing every other project with a sample', async t => {
  const saved = fixture('정상인 책의 원고'); saved.projects.push({ id: 'damaged-book', chapters: [] });
  const original = JSON.stringify(saved), fallback = memoryStorage(original);
  const workspace = store({ localStorage: fallback }); t.after(workspace.close);
  await assert.rejects(workspace.read(), error => error.code === 'CORRUPT');
  await assert.rejects(workspace.write(fixture('샘플 원고')), error => error.code === 'CORRUPT');
  assert.equal(fallback.getItem(key), original);
});

test('storage: two divergent backends are preserved for recovery instead of guessing a winner', async t => {
  const factory = new IDBFactory(), fallback = memoryStorage();
  const initial = store({ indexedDB: factory, localStorage: fallback }); t.after(initial.close);
  await initial.read(); await initial.write(fixture('IndexedDB의 책'));
  const original = JSON.stringify(fixture('localStorage의 다른 책')); fallback.setItem(key, original);
  const reopened = store({ indexedDB: factory, localStorage: fallback }); t.after(reopened.close);
  await assert.rejects(reopened.read(), error => error.code === 'CONFLICT');
  await assert.rejects(reopened.write(fixture()), error => error.code === 'CONFLICT');
  assert.equal(fallback.getItem(key), original);
  assert.equal(reopened.getRecoveryData().entries.indexedDB.projects[0].chapters[0].content, 'IndexedDB의 책');
  assert.equal(reopened.getRecoveryData().entries.localStorage, original);
});

test('storage: an unavailable database without a fallback is not treated as an empty workspace', async t => {
  const brokenFactory = { open() { throw new Error('SecurityError'); } };
  const fallback = memoryStorage(), workspace = store({ indexedDB: brokenFactory, localStorage: fallback }); t.after(workspace.close);
  await assert.rejects(workspace.read(), error => error.code === 'READ_FAILED');
  await assert.rejects(workspace.write(fixture('샘플')), error => error.code === 'READ_FAILED');
  assert.equal(fallback.getItem(key), null);
});

test('storage: failed write does not advance revision and a later retry can succeed', async t => {
  const original = JSON.stringify(fixture('저장된 원고')), fallback = memoryStorage(original);
  const workspace = store({ localStorage: fallback }); t.after(workspace.close); await workspace.read();
  const set = fallback.setItem; fallback.setItem = () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(workspace.write(fixture('새 원고')), error => error.code === 'WRITE_FAILED');
  assert.equal(fallback.getItem(key), original);
  fallback.setItem = set;
  await workspace.write(fixture('새 원고'));
  assert.equal(JSON.parse(fallback.getItem(key)).projects[0].chapters[0].content, '새 원고');
});

test('storage: an unreadable fallback cannot become a blank new IndexedDB workspace', async t => {
  const fallback = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('Unexpected write'); } };
  const factory = new IDBFactory(), workspace = store({ indexedDB: factory, localStorage: fallback }); t.after(workspace.close);
  await assert.rejects(workspace.read(), error => error.code === 'READ_FAILED');
  await assert.rejects(workspace.write(fixture('샘플')), error => error.code === 'READ_FAILED');
  assert.equal(await databaseRead(factory), undefined);
});

test('storage: failed migration commits retain the original fallback without deletion', async t => {
  const original = JSON.stringify(fixture('유일하게 보존된 원고'));
  const fallback = memoryStorage(original), factory = new IDBFactory();
  const controlledFactory = { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const database = request.result, transaction = database.transaction.bind(database);
      database.transaction = (...args) => {
        const result = transaction(...args);
        if (args[1] === 'readwrite') queueMicrotask(() => result.abort());
        return result;
      };
    });
    return request;
  } };
  const workspace = store({ indexedDB: controlledFactory, localStorage: fallback }); t.after(workspace.close);
  await workspace.read();
  await assert.rejects(workspace.write(fixture('이관할 원고')), error => error.code === 'WRITE_FAILED');
  assert.equal(fallback.getItem(key), original);
  assert.equal(await databaseRead(factory), undefined);
});

test('storage: fallback changed during migration is preserved and migration stops', async t => {
  const fallback = memoryStorage(JSON.stringify(fixture('최초 원고'))), factory = new IDBFactory();
  const workspace = store({ indexedDB: factory, localStorage: fallback }); t.after(workspace.close); await workspace.read();
  const newer = JSON.stringify(fixture('동시에 바뀐 대체 저장소 원고')); fallback.setItem(key, newer);
  await assert.rejects(workspace.write(fixture('낡은 원고')), error => error.code === 'CONFLICT');
  assert.equal(fallback.getItem(key), newer);
  assert.equal(await databaseRead(factory), undefined);
});

test('storage: explicit application corruption lock keeps a loaded original available for recovery', async t => {
  const original = JSON.stringify(fixture()), fallback = memoryStorage(original);
  const workspace = store({ localStorage: fallback }); t.after(workspace.close); await workspace.read();
  workspace.lock('CORRUPT');
  await assert.rejects(workspace.write(fixture('샘플')), error => error.code === 'CORRUPT');
  assert.equal(workspace.getRecoveryData().entries.localStorage, original);
  assert.equal(fallback.getItem(key), original);
});

/** Evaluate the real app source in an isolated lexical DOM environment; only ESM imports are injected. */
async function bootApp(saved = fixture(), environment = {}) {
  const win = new Window({ url: 'http://localhost:4173', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
  win.document.body.innerHTML = '<div id="app"></div><div id="toast-region"></div><div id="modal-root"></div>';
  const local = environment.localStorage || memoryStorage(typeof saved === 'string' ? saved : JSON.stringify(saved));
  Object.defineProperty(win, 'localStorage', { configurable: true, value: local });
  Object.defineProperty(win, 'indexedDB', { configurable: true, value: environment.indexedDB });
  const timers = new Set(), nativeSetTimeout = globalThis.setTimeout;
  const dependencies = [];
  let source = await readFile(new URL('./dist/app.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?$/gm)];
  for (const [statement, names, path] of imports) {
    dependencies.push(await import(new URL(path, new URL('./dist/app.js', import.meta.url)).href));
    source = source.replace(statement, `const {${names}} = __dependencies[${dependencies.length - 1}];`);
  }
  const globals = {
    __dependencies: dependencies, window: win, document: win.document, localStorage: local, indexedDB: undefined,
    navigator: win.navigator, sessionStorage: win.sessionStorage, HTMLElement: win.HTMLElement, HTMLAnchorElement: win.HTMLAnchorElement,
    FormData: win.FormData, File: win.File, FileReader: win.FileReader, Image: win.Image, DOMParser: win.DOMParser,
    setTimeout: (callback, delay, ...args) => { const timer = nativeSetTimeout(() => { timers.delete(timer); callback(...args); }, delay); timer.unref(); timers.add(timer); return timer; },
    clearTimeout: timer => { clearTimeout(timer); timers.delete(timer); }, ...environment,
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const hook = await new AsyncFunction(...Object.keys(globals), `${source}\nreturn {state:()=>state,persist,validateProject,uploadImage};`)(...Object.values(globals));
  const cleanup = async () => { for (const timer of timers) clearTimeout(timer); await win.happyDOM.close(); };
  return { win, hook, local, cleanup };
}

test('app: imported backup chapters are never silently truncated at 500,000 characters', async t => {
  const app = await bootApp(); t.after(app.cleanup);
  const original = fixture().projects[0]; original.chapters[0].content = '가'.repeat(500000) + '끝까지 보존할 문장';
  let imported;
  try { imported = app.hook.validateProject(original); }
  catch (error) { assert.match(error.message, /길|크|초과|자|나누|한도|지원/); return; }
  assert.ok(imported.chapters[0].content === original.chapters[0].content, 'import must retain every character or reject the file explicitly');
});

test('app: pending manuscript edits trigger an unload guard until a successful save', async t => {
  const app = await bootApp(); t.after(app.cleanup); await app.hook.persist(true);
  const editor = app.win.document.querySelector('#manuscript-text');
  editor.value = '종료 직전에 입력한 유일한 원고';
  editor.dispatchEvent(new app.win.Event('input', { bubbles: true }));
  const pending = new app.win.Event('beforeunload', { cancelable: true }); app.win.dispatchEvent(pending);
  assert.equal(pending.defaultPrevented, true, 'debounced edits must be protected from an immediate tab close');
  await app.hook.persist(true);
  const saved = new app.win.Event('beforeunload', { cancelable: true }); app.win.dispatchEvent(saved);
  assert.equal(saved.defaultPrevented, false);
});

test('app: a quota failure preserves the previous backup and keeps the unload guard active', async t => {
  const original = JSON.stringify(fixture('마지막 정상 저장 원고')), app = await bootApp(original); t.after(app.cleanup);
  const editor = app.win.document.querySelector('#manuscript-text'); editor.value = '아직 저장되지 않은 원고';
  editor.dispatchEvent(new app.win.Event('input', { bubbles: true }));
  app.local.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  assert.equal(await app.hook.persist(true), false);
  assert.equal(app.local.getItem(key), original);
  const unload = new app.win.Event('beforeunload', { cancelable: true }); app.win.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
  assert.match(app.win.document.querySelector('#save-state').textContent, /실패|중지/);
  assert.ok(app.win.document.querySelector('[data-action="backup-workspace"]'), 'unsaved work must have a whole-workspace backup action');
});

test('app: invalid stored state must not be automatically replaced by sample data', async t => {
  const damaged = fixture('남겨야 하는 정상 책'); damaged.projects.push({ id: 'bad', chapters: [] });
  const original = JSON.stringify(damaged), app = await bootApp(original); t.after(app.cleanup);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(app.local.getItem(key) === original, 'corrupt source must remain byte-for-byte available');
});

test('app: a fallback-only manuscript remains active when IndexedDB first becomes available', async t => {
  const factory = new IDBFactory(), original = fixture('대체 저장소에만 있는 원고');
  const app = await bootApp(original, { indexedDB: factory }); t.after(app.cleanup);
  assert.equal(app.win.document.querySelector('#manuscript-text').value, original.projects[0].chapters[0].content);
  await app.hook.persist(true);
  assert.equal((await databaseRead(factory)).projects[0].chapters[0].content, original.projects[0].chapters[0].content);
});

test('app: a stale second tab cannot replace the first tab manuscript through autosave', async t => {
  const factory = new IDBFactory(), local = memoryStorage(JSON.stringify(fixture('최초 원고')));
  const first = await bootApp(null, { indexedDB: factory, localStorage: local }); t.after(first.cleanup); await first.hook.persist(true);
  const second = await bootApp(null, { indexedDB: factory, localStorage: local }); t.after(second.cleanup);
  const editor = first.win.document.querySelector('#manuscript-text'); editor.value = '첫 번째 탭에서 보존할 원고';
  editor.dispatchEvent(new first.win.Event('input', { bubbles: true })); await first.hook.persist(true);
  const stale = second.win.document.querySelector('#manuscript-text'); stale.value = '두 번째 탭의 낡은 원고';
  stale.dispatchEvent(new second.win.Event('input', { bubbles: true }));
  assert.equal(await second.hook.persist(true), false, 'a stale tab must receive a failed save result');
  assert.equal((await databaseRead(factory)).projects[0].chapters[0].content, '첫 번째 탭에서 보존할 원고');
});

test('app: whole-workspace imports preserve every book, writing preferences, and restorable history', async t => {
  const app = await bootApp(); t.after(app.cleanup);
  const original = fixture('완전한 백업 원고');
  original.projects[0].audience = '독립을 앞둔 독자';
  original.projects[0].tone = '담백한 존댓말';
  original.projects[0].chapters[0].editorialNotes = ['숫자와 인용 유지'];
  original.projects[0].chapters[0].imagePrompt = '창가의 작은 화분';
  const previous = structuredClone(original.projects[0]); previous.chapters[0].content = '복원할 이전 원고';
  original.histories['book-1'] = [{ id: 'history-1', label: '집필 전', at: '2026-01-01T00:00:00Z', project: previous }];
  const other = structuredClone(original.projects[0]); other.id = 'book-2'; other.title = '둘째 책'; original.projects.push(other);
  app.win.document.querySelector('[data-action="library"]').click();
  app.win.document.querySelector('.modal [data-action="import"]').click();
  const input = app.win.document.querySelector('input[type="file"]');
  const backup = JSON.stringify({ format: 'folio-workspace', version: 1, workspace: original });
  Object.defineProperty(input, 'files', { value: [new app.win.File([backup], 'folio-workspace.json', { type: 'application/json' })] });
  input.dispatchEvent(new app.win.Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 5));
  const state = app.hook.state(); assert.equal(state.projects.length, 3);
  const imported = state.projects.find(project => project.id === state.activeId);
  assert.notEqual(imported.id, 'book-1'); assert.equal(imported.audience, original.projects[0].audience);
  assert.equal(imported.tone, original.projects[0].tone);
  assert.deepEqual(imported.chapters[0].editorialNotes, original.projects[0].chapters[0].editorialNotes);
  assert.equal(imported.chapters[0].imagePrompt, original.projects[0].chapters[0].imagePrompt);
  assert.equal(state.histories[imported.id][0].project.id, imported.id);
  app.win.document.querySelector('[data-action="history"]').click();
  app.win.document.querySelector('[data-action="restore"]').click();
  assert.equal(app.win.document.querySelector('#manuscript-text').value, '복원할 이전 원고');
  assert.equal(state.projects.length, 3, 'restoring a history must not append a duplicate book');
});

test('app: slow image decoding cannot attach an image to a different book', async t => {
  let finishRead;
  class DeferredReader {
    readAsDataURL() { finishRead = () => { this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='; this.onload(); }; }
  }
  class DecodedImage {
    width = 1; height = 1;
    set src(value) { queueMicrotask(() => this.onload()); }
  }
  const saved = fixture(); const second = fixture().projects[0]; second.id = 'book-2'; second.title = '다른 책'; second.chapters[0].id = 'second-chapter'; saved.projects.push(second);
  const app = await bootApp(saved, { FileReader: DeferredReader, Image: DecodedImage }); t.after(app.cleanup);
  app.hook.uploadImage('chapter');
  const fileInput = app.win.document.querySelector('input[type="file"]');
  Object.defineProperty(fileInput, 'files', { value: [new app.win.File(['synthetic file input'], 'original.png', { type: 'image/png' })] });
  fileInput.dispatchEvent(new app.win.Event('change', { bubbles: true }));
  app.win.document.querySelector('[data-action="library"]').click();
  app.win.document.querySelector('[data-action="open-project"][data-id="book-2"]').click();
  finishRead(); await new Promise(resolve => setTimeout(resolve, 5));
  const projects = app.hook.state().projects;
  assert.equal(projects.find(project => project.id === 'book-2').chapters[0].image, undefined, 'the newly selected book must never receive a previous book upload');
  assert.ok(projects.find(project => project.id === 'book-1').chapters[0].image, 'the upload belongs to its original target');
});

test('storage: aborted IndexedDB write retains the committed revision and permits a retry', async t => {
  const factory = new IDBFactory(), fallback = memoryStorage();
  let abortNext = false;
  const controlledFactory = { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const database = request.result, transaction = database.transaction.bind(database);
      database.transaction = (...args) => {
        const result = transaction(...args);
        if (args[1] === 'readwrite' && abortNext) { abortNext = false; queueMicrotask(() => result.abort()); }
        return result;
      };
    });
    return request;
  } };
  const workspace = store({ indexedDB: controlledFactory, localStorage: fallback }); t.after(workspace.close);
  await workspace.read(); await workspace.write(fixture('이미 저장된 원고'));
  abortNext = true;
  await assert.rejects(workspace.write(fixture('취소된 원고')), error => error.code === 'WRITE_FAILED');
  assert.equal((await databaseRead(factory)).projects[0].chapters[0].content, '이미 저장된 원고');
  await workspace.write(fixture('정상 재시도 원고'));
  assert.equal((await databaseRead(factory)).projects[0].chapters[0].content, '정상 재시도 원고');
});
