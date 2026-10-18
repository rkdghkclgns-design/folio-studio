/** Workspace persistence. Failed reads and stale tabs never authorize overwriting saved work. */
export const WORKSPACE_STORAGE_KEY = 'folio-studio-v1';
const REVISION = '__folioRevision';
const absent = Symbol('absent');
const copy = value => structuredClone(value);
const revisionOf = value => value == null ? absent : JSON.stringify(value);
const contentOf = value => {
  if (value == null) return null;
  const content = { ...value };
  delete content[REVISION];
  return JSON.stringify(content);
};
function storageError(code, cause) {
  const messages = {
    CONFLICT: '다른 탭의 원고가 변경되어 덮어쓰기를 멈췄습니다. 현재 작업을 백업한 뒤 새로고침해 주세요.',
    CORRUPT: '저장된 작업을 정상적으로 읽을 수 없어 원본을 보호했습니다. 저장 데이터 복구 파일을 내려받아 주세요.',
    READ_FAILED: '기기 저장 공간을 읽지 못해 덮어쓰기를 멈췄습니다. 현재 작업을 백업해 주세요.',
    WRITE_FAILED: '기기 저장에 실패했습니다. 현재 작업을 백업해 주세요.',
  };
  const error = new Error(messages[code] || messages.WRITE_FAILED, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

export function createWorkspaceStore(options = {}) {
  const factory = options.indexedDB;
  const storage = options.localStorage;
  const validate = options.validateState;
  const locks = options.locks ?? globalThis.navigator?.locks;
  let database = null, backend = null, loaded = false, blocked = null;
  let expected = absent, originalLocal = null, migrationLocal = null;
  const recovery = { format: 'folio-storage-recovery', version: 1, entries: {} };

  const lock = (reason = 'CORRUPT') => { blocked = storageError(reason); };
  const fail = (code, cause) => { blocked = storageError(code, cause); throw blocked; };
  function check(value) {
    if (value == null) return null;
    try {
      if (typeof value !== 'object' || Array.isArray(value) || (validate && validate(value) === false)) throw new Error('Invalid workspace');
      return value;
    } catch (error) { return fail('CORRUPT', error); }
  }
  function localValue() {
    if (!storage) throw new Error('localStorage unavailable');
    return storage.getItem(WORKSPACE_STORAGE_KEY);
  }
  function parseLocal(raw) {
    if (raw === null) return null;
    try { return check(JSON.parse(raw)); }
    catch (error) { return fail('CORRUPT', error); }
  }
  function open() {
    return new Promise((resolve, reject) => {
      let settled = false, request;
      const finish = (error, result) => {
        if (settled) { result?.close(); return; }
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('IndexedDB open timed out')), options.openTimeoutMs ?? 4000);
      try { request = factory.open('folio-studio', 1); }
      catch (error) { finish(error); return; }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('workspace')) request.result.createObjectStore('workspace');
      };
      request.onerror = () => finish(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => finish(new Error('IndexedDB upgrade blocked'));
      request.onsuccess = () => finish(null, request.result);
    });
  }
  function readDatabase() {
    return new Promise((resolve, reject) => {
      let result;
      const transaction = database.transaction('workspace', 'readonly');
      const request = transaction.objectStore('workspace').get('state');
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || request.error || new Error('IndexedDB read failed'));
      transaction.onabort = () => reject(transaction.error || request.error || new Error('IndexedDB read aborted'));
    });
  }
  async function read() {
    if (blocked) throw blocked;
    if (loaded) throw storageError('READ_FAILED', new Error('Store already read'));
    let localError;
    try {
      originalLocal = localValue();
      if (originalLocal !== null) recovery.entries.localStorage = originalLocal;
    } catch (error) { localError = error; }
    let stored;
    if (factory) {
      try {
        database = await open();
        database.onversionchange = () => { database.close(); lock('READ_FAILED'); };
        stored = await readDatabase();
        if (stored != null) recovery.entries.indexedDB = copy(stored);
      } catch (error) {
        database?.close(); database = null;
        // An existing fallback can still be edited if IndexedDB is unavailable.
        // Without one, opening failure must not masquerade as an empty workspace.
        if (originalLocal === null) return fail('READ_FAILED', error);
      }
    }
    if (database) {
      const idbValue = check(stored);
      if (!idbValue && localError) return fail('READ_FAILED', localError);
      const fallbackValue = localError ? null : parseLocal(originalLocal);
      if (idbValue && fallbackValue && contentOf(idbValue) !== contentOf(fallbackValue)) return fail('CONFLICT');
      backend = 'indexedDB';
      expected = revisionOf(stored);
      migrationLocal = originalLocal;
      loaded = true;
      return copy(idbValue || fallbackValue);
    }
    if (localError) return fail('READ_FAILED', localError);
    const fallbackValue = parseLocal(originalLocal);
    backend = 'localStorage';
    expected = originalLocal;
    loaded = true;
    return copy(fallbackValue);
  }
  function writeDatabase(snapshot) {
    return new Promise((resolve, reject) => {
      let conflict = false, request;
      const transaction = database.transaction('workspace', 'readwrite');
      const objectStore = transaction.objectStore('workspace');
      request = objectStore.get('state');
      request.onsuccess = () => {
        if (revisionOf(request.result) !== expected) {
          if (request.result != null) recovery.entries.indexedDB = copy(request.result);
          conflict = true;
          transaction.abort();
          return;
        }
        objectStore.put(snapshot, 'state');
      };
      transaction.oncomplete = () => { expected = revisionOf(snapshot); resolve(); };
      transaction.onerror = () => reject(transaction.error || request.error || new Error('IndexedDB write failed'));
      transaction.onabort = () => reject(conflict ? storageError('CONFLICT') : transaction.error || request.error || new Error('IndexedDB write aborted'));
    });
  }
  async function write(value) {
    if (blocked) throw blocked;
    if (!loaded) throw storageError('READ_FAILED', new Error('Read before writing'));
    if (value == null) return fail('CORRUPT');
    check(value);
    const snapshot = copy(value);
    snapshot[REVISION] = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const perform = async () => {
      if (blocked) throw blocked;
      if (backend === 'indexedDB') {
        if (migrationLocal !== null) {
          const latestLocal = localValue();
          if (latestLocal !== migrationLocal) {
            if (latestLocal !== null) recovery.entries.localStorage = latestLocal;
            return fail('CONFLICT');
          }
        }
        await writeDatabase(snapshot);
        // Remove the fallback only after the equivalent workspace has committed.
        // A simultaneous fallback edit remains recoverable and is never deleted.
        if (migrationLocal !== null) {
          const latestLocal = localValue();
          if (latestLocal !== migrationLocal) {
            if (latestLocal !== null) recovery.entries.localStorage = latestLocal;
            return fail('CONFLICT');
          }
          // An older fallback beside this commit would conflict on reload.
          // Surface cleanup failures and retain the marker so a retry can finish.
          storage.removeItem(WORKSPACE_STORAGE_KEY);
          migrationLocal = null;
        }
      } else {
        const latestLocal = localValue();
        if (latestLocal !== expected) {
          if (latestLocal !== null) recovery.entries.localStorage = latestLocal;
          return fail('CONFLICT');
        }
        const raw = JSON.stringify(snapshot);
        storage.setItem(WORKSPACE_STORAGE_KEY, raw);
        expected = raw;
      }
    };
    try {
      if (locks?.request) await locks.request('folio-workspace-write', perform);
      else await perform();
    } catch (error) {
      if (error?.code === 'CONFLICT') { blocked = error; throw error; }
      if (typeof error?.code === 'string' && ['CONFLICT', 'CORRUPT', 'READ_FAILED', 'WRITE_FAILED'].includes(error.code)) throw error;
      throw storageError('WRITE_FAILED', error);
    }
  }
  return {
    read, write, lock,
    getRecoveryData: () => Object.keys(recovery.entries).length ? copy(recovery) : null,
    close: () => { database?.close(); lock('READ_FAILED'); },
  };
}
