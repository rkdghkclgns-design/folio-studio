/** Persistence fault injection uses fake IndexedDB, not a real browser storage implementation. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createWorkspaceStore, WORKSPACE_STORAGE_KEY as key } from './dist/storage.js';

const fixture = content => ({ activeId: 'book', histories: {}, projects: [{ id: 'book', chapters: [{ id: 'chapter', content }] }] });
const valid = value => Array.isArray(value.projects) && value.projects.length > 0;
function memoryStorage(value) {
  const entries = new Map([[key, JSON.stringify(value)]]);
  return {
    getItem: name => entries.get(name) ?? null,
    setItem: (name, value) => entries.set(name, String(value)),
    removeItem: name => entries.delete(name),
  };
}
function store(factory, localStorage) {
  return createWorkspaceStore({ indexedDB: factory, localStorage, validateState: valid });
}
async function readRecord(factory) {
  return new Promise((resolve, reject) => {
    const request = factory.open('folio-studio', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('workspace', 'readonly');
      const get = transaction.objectStore('workspace').get('state');
      transaction.oncomplete = () => { database.close(); resolve(get.result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  });
}

test('storage audit: cleanup failure must not claim success for a migration that cannot reload', async t => {
  const original = fixture('이전 저장 원고'), edited = fixture('이관하며 수정한 새 원고');
  const local = memoryStorage(original), factory = new IDBFactory(), workspace = store(factory, local);
  t.after(workspace.close);
  await workspace.read();
  const remove = local.removeItem;
  local.removeItem = () => { throw new DOMException('Storage is temporarily unavailable', 'SecurityError'); };
  await assert.rejects(workspace.write(edited), error => error.code === 'WRITE_FAILED');
  assert.deepEqual(JSON.parse(local.getItem(key)), original, 'the sole fallback original remains recoverable');
  assert.equal((await readRecord(factory)).projects[0].chapters[0].content, edited.projects[0].chapters[0].content, 'the committed new manuscript is also retained');
  local.removeItem = remove;
  await workspace.write(edited);
  assert.equal(local.getItem(key), null, 'a successful retry must finish the pending cleanup');
  const reopened = store(factory, local); t.after(reopened.close);
  assert.equal((await reopened.read()).projects[0].chapters[0].content, edited.projects[0].chapters[0].content);
});

test('storage audit: a fallback changed after failed cleanup must survive the next retry', async t => {
  const local = memoryStorage(fixture('최초 원고')), factory = new IDBFactory(), workspace = store(factory, local);
  t.after(workspace.close);
  await workspace.read();
  const remove = local.removeItem;
  local.removeItem = () => { throw new Error('Cleanup blocked'); };
  await assert.rejects(workspace.write(fixture('이관한 원고')), error => error.code === 'WRITE_FAILED');
  const concurrent = JSON.stringify(fixture('다른 탭의 새로운 대체 저장 원고'));
  local.setItem(key, concurrent); local.removeItem = remove;
  await assert.rejects(workspace.write(fixture('충돌한 재시도 원고')), error => error.code === 'CONFLICT');
  assert.equal(local.getItem(key), concurrent);
  assert.equal(workspace.getRecoveryData().entries.localStorage, concurrent);
  assert.equal((await readRecord(factory)).projects[0].chapters[0].content, '이관한 원고', 'the conflicting retry never replaces the last committed revision');
});

test('storage audit: a fallback changed during the IDB commit is captured in recovery', async t => {
  const local = memoryStorage(fixture('이관 시작 원고')), factory = new IDBFactory();
  const concurrent = JSON.stringify(fixture('커밋 도중 다른 탭이 쓴 원고'));
  const controlledFactory = {
    open(...args) {
      const request = factory.open(...args);
      request.addEventListener('success', () => {
        const database = request.result, transaction = database.transaction.bind(database);
        database.transaction = (...args) => {
          const result = transaction(...args);
          if (args[1] === 'readwrite') result.addEventListener('complete', () => local.setItem(key, concurrent), { once: true });
          return result;
        };
      });
      return request;
    },
  };
  const workspace = store(controlledFactory, local); t.after(workspace.close);
  await workspace.read();
  await assert.rejects(workspace.write(fixture('IDB에 커밋한 원고')), error => error.code === 'CONFLICT');
  assert.equal(local.getItem(key), concurrent, 'a concurrent fallback must never be removed');
  assert.equal(workspace.getRecoveryData().entries.localStorage, concurrent, 'recovery must include the actual conflicting revision');
  assert.equal((await readRecord(factory)).projects[0].chapters[0].content, 'IDB에 커밋한 원고');
  await assert.rejects(workspace.write(fixture('충돌 후 쓰기')), error => error.code === 'CONFLICT');
});
