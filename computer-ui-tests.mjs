/** DOM behavior only: these tests do not control Windows or render a browser. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { mountComputerStudio } from './dist/computer-ui.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const TOKEN = 'a'.repeat(64);
const copy = value => JSON.parse(JSON.stringify(value));
const record = (changes = {}) => ({ id: 'screen-existing', capturedAt: '2026-10-18T12:00:00.000Z', windowTitle: '연습 에디터', title: '기존 화면', caption: '기존 설명', extractedText: '', src: PNG, steps: [], ...changes });
const notebook = records => ({ version: 1, goal: '발판 오브젝트 예제를 만들고 결과를 담기', target: '연습 에디터', records });
const decision = type => ({ action: { type, x: 0, y: 0, text: '', key: '', amount: 0 }, summary: '실습 결과를 확인했습니다.', title: '발판 실습', caption: '발판의 속성을 설정한 화면입니다.', extractedText: '속성 창에서 값을 확인합니다.' });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(check) { for (let i = 0; i < 70 && !check(); i++) await tick(); assert.ok(check(), 'Expected UI state did not settle'); }

function boot(t, options = {}) {
  const win = new Window({ url: 'https://folio-book-studio.goofycamel128.chatgpt.site', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  win.document.body.innerHTML = '<main id="studio"></main>';
  const root = win.document.querySelector('#studio');
  let saved = options.research ? copy(options.research) : undefined;
  const writes = [], inserts = [], activity = [], notices = [], operations = [];
  const frame = { sessionId: 'session-1', frameId: 'frame-1', window: { id: 'window-1', title: '연습 에디터' }, image: { src: PNG, width: 1, height: 1 } };
  const client = {
    status: async () => ({ version: 1, platform: 'windows' }),
    windows: async () => ({ windows: [{ id: 'window-1', title: options.windowTitle || '연습 에디터' }] }),
    select: async id => { operations.push(['select', id]); return { sessionId: 'session-1' }; },
    observe: async () => { operations.push(['observe']); return copy(frame); },
    act: async (...args) => { operations.push(['act', ...args]); return { ok: true }; },
    stop: async () => { operations.push(['stop']); return { ok: true }; },
  };
  const api = mountComputerStudio(root, {
    getResearch: () => saved, context: { bookTitle: '에디터 실습책', chapterTitle: '발판 만들기', excerpt: '오브젝트 속성을 설정해 봅니다.' },
    isAIConfigured: () => Boolean(options.ai),
    saveResearch: async value => { writes.push(copy(value)); if (options.save) await options.save(value); saved = copy(value); },
    insertRecords: async values => { if (options.insert) await options.insert(values); inserts.push(copy(values)); },
    onBusy: value => activity.push(value), notify: (...args) => notices.push(args),
    services: { createClient: ({ token }) => { assert.equal(token, TOKEN); return client; }, decide: options.decide || (async () => decision('finish')), ...(options.runTask ? { runTask: options.runTask } : {}) },
  });
  const $ = selector => { const node = root.querySelector(selector); assert.ok(node, `Missing ${selector}`); return node; };
  const input = (selector, value) => { const node = $(selector); node.value = value; node.dispatchEvent(new win.Event('input', { bubbles: true })); };
  const click = async action => { $(`[data-computer-action="${action}"]`).click(); await tick(); };
  const select = () => { $('#computer-window').value = 'window-1'; $('#computer-window').dispatchEvent(new win.Event('change', { bubbles: true })); };
  async function connect() {
    $('#computer-token').value = TOKEN;
    $('#computer-connect-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => /도우미 연결됨/.test($('#computer-connection').textContent) && !$('#computer-window').disabled);
    select();
  }
  async function upload(files) {
    Object.defineProperty($('#computer-upload'), 'files', { configurable: true, value: files });
    $('#computer-upload').dispatchEvent(new win.Event('change', { bubbles: true }));
    await tick();
  }
  t.after(async () => { await api.dispose(); await win.happyDOM.close(); });
  return { win, root, api, $, input, click, connect, upload, writes, inserts, activity, notices, operations, saved: () => saved, file: (name, bytes = Buffer.from(PNG.split(',')[1], 'base64'), type = 'image/png') => new win.File([bytes], name, { type }) };
}

test('manual PNG import works without AI or a companion and escapes editable filenames', async t => {
  const app = boot(t);
  assert.equal(app.$('[data-computer-action="start"]').disabled, true);
  assert.match(app.root.textContent, /start-windows.cmd/);
  assert.match(app.root.textContent, /같은 Windows PC/);
  await app.upload([app.file('<img src=x onerror=alert(1)>.png')]);
  await until(() => app.saved()?.records.length === 1);
  assert.equal(app.saved().records[0].title, '<img src=x onerror=alert(1)>');
  assert.equal(app.root.querySelectorAll('#computer-gallery img').length, 1);
  assert.equal(app.root.querySelector('[onerror]'), null);
  assert.equal(app.operations.length, 0);
  assert.equal(JSON.stringify(app.saved()).includes(TOKEN), false);
  assert.equal(app.$('[data-computer-action="insert"]').disabled, false);
});

test('connecting clears the token input; each manual capture explicitly selects its window', async t => {
  const app = boot(t, { windowTitle: '<script>alert(1)</script>' });
  await app.connect();
  assert.equal(app.$('#computer-token').value, '');
  assert.equal(app.root.querySelector('script'), null);
  assert.equal(app.operations.length, 0, 'Connecting must not activate a window');
  await app.click('capture'); await until(() => app.saved()?.records.length === 1 && app.activity.at(-1) === false);
  await app.click('capture'); await until(() => app.saved()?.records.length === 2 && app.activity.at(-1) === false);
  assert.deepEqual(app.operations.map(item => item[0]), ['select', 'observe', 'stop', 'select', 'observe', 'stop']);
  assert.equal(JSON.stringify(app.writes).includes(TOKEN), false);
  assert.equal(app.saved().records[0].extractedText, '');
});

test('edited captions are marked unsaved and are durably saved before insertion', async t => {
  const app = boot(t, { research: notebook([record()]) });
  app.input('[data-computer-field="caption"]', '고친 그림 설명');
  app.input('[data-computer-field="extractedText"]', '설정값을 2로 바꿉니다.');
  assert.match(app.$('#computer-save-state').textContent, /아직 저장하지/);
  app.$('[data-computer-select]').click();
  await app.click('insert'); await until(() => app.inserts.length === 1 && app.activity.at(-1) === false);
  assert.equal(app.saved().records[0].caption, '고친 그림 설명');
  assert.equal(app.inserts[0][0].extractedText, '설정값을 2로 바꿉니다.');
  assert.equal(app.$('[data-computer-select]').checked, false);
  assert.match(app.$('#computer-feedback').textContent, /발판 만들기.*넣었습니다/);
});

test('closing flushes unsaved goal and caption changes and clears connection fields', async t => {
  const app = boot(t, { research: notebook([record()]) });
  app.input('[data-computer-field="caption"]', '닫아도 보관할 설명');
  app.input('#computer-goal', '새 예제 목표');
  app.$('#computer-token').value = TOKEN;
  await app.api.dispose();
  assert.equal(app.saved().records[0].caption, '닫아도 보관할 설명');
  assert.equal(app.saved().goal, '새 예제 목표');
  assert.equal(app.$('#computer-token').value, '');
  assert.equal(app.activity.at(-1), false);
});

test('unsaved captions protect against page exit until their save completes', async t => {
  const app = boot(t, { research: notebook([record()]) });
  app.input('[data-computer-field="caption"]', '작성 중인 설명');
  const unsaved = new app.win.Event('beforeunload', { cancelable: true }); app.win.dispatchEvent(unsaved);
  assert.equal(unsaved.defaultPrevented, true);
  await app.click('save'); await until(() => app.activity.at(-1) === false);
  const saved = new app.win.Event('beforeunload', { cancelable: true }); app.win.dispatchEvent(saved);
  assert.equal(saved.defaultPrevented, false);
});

test('a failed capture save halts the automatic loop, retains its image and can be retried', async t => {
  let fail = true;
  const app = boot(t, { ai: true, research: notebook([]), save: async value => { if (value.records.length && fail) throw new Error('저장 공간이 부족합니다.'); } });
  await app.connect(); await app.click('start');
  await until(() => app.notices.length === 1 && app.activity.at(-1) === false);
  assert.equal(app.saved().records.length, 0);
  assert.equal(app.root.querySelectorAll('[data-computer-record]').length, 1);
  assert.match(app.$('#computer-save-state').textContent, /저장되지 않은 자료/);
  assert.equal(app.$('[data-computer-action="retry-save"]').hidden, false);
  assert.ok(app.operations.some(item => item[0] === 'stop'));
  assert.doesNotMatch(app.$('#computer-feedback').textContent, /작업을 마쳤|확인했습니다/);
  fail = false; await app.click('retry-save');
  await until(() => app.saved().records.length === 1 && app.activity.at(-1) === false);
  assert.equal(app.saved().records[0].title, '발판 실습');
  assert.equal(app.$('[data-computer-action="retry-save"]').hidden, true);
});

test('stop during an awaited save prevents subsequent chapter insertion', async t => {
  let release, saving = false;
  const app = boot(t, { research: notebook([record()]), save: async () => { saving = true; await new Promise(resolve => { release = resolve; }); } });
  app.$('[data-computer-select]').click(); await app.click('insert');
  await until(() => saving);
  assert.equal(app.$('[data-computer-action="stop"]').disabled, false);
  await app.click('stop'); release();
  await until(() => app.activity.at(-1) === false);
  assert.equal(app.inserts.length, 0);
  assert.match(app.$('#computer-feedback').textContent, /중지했습니다/);
  assert.equal(app.$('[data-computer-select]').checked, true);
});

test('local stop aborts an active AI loop even while all other controls are disabled', async t => {
  let running = false;
  const app = boot(t, { ai: true, research: notebook([]), runTask: async ({ signal, onProgress }) => {
    running = true; onProgress({ step: 1, type: 'action', message: '속성 창을 확인하고 있습니다.' });
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('중지', 'AbortError')), { once: true }));
  } });
  await app.connect(); await app.click('start'); await until(() => running);
  assert.equal(app.$('[data-computer-action="capture"]').disabled, true);
  assert.equal(app.$('#computer-goal').disabled, true);
  await app.click('stop'); await until(() => app.activity.at(-1) === false);
  assert.ok(app.operations.some(item => item[0] === 'stop'));
  assert.equal(app.$('#computer-goal').disabled, false);
  assert.match(app.$('#computer-feedback').textContent, /중지했습니다/);
  assert.equal(app.notices.length, 0);
});

test('manual capture keeps the screenshot when AI cannot read it', async t => {
  for (const decide of [async () => { throw new Error('AI quota'); }, async () => ({ ...decision('ask_user'), summary: '이 창의 용도를 설명해 주세요.' })]) {
    const app = boot(t, { ai: true, decide });
    await app.connect(); await app.click('capture');
    await until(() => app.saved()?.records.length === 1 && app.activity.at(-1) === false);
    assert.equal(app.saved().records[0].src, PNG);
    assert.equal(app.saved().records[0].extractedText, '');
    assert.match(app.$('#computer-feedback').textContent, /설명/);
  }
});

test('a mixed upload containing a corrupt image leaves existing records intact', async t => {
  const original = notebook([record()]);
  const app = boot(t, { research: original });
  await app.upload([app.file('정상.png'), app.file('손상.png', Buffer.from('not a PNG'))]);
  await until(() => app.notices.length === 1 && app.activity.at(-1) === false);
  assert.deepEqual(app.saved(), original);
  assert.equal(app.root.querySelectorAll('[data-computer-record]').length, 1);
  assert.equal(app.writes.length, 0);
});

test('twenty stored records prevent starting a new native action', async t => {
  const app = boot(t, { ai: true, research: notebook(Array.from({ length: 20 }, (_, index) => record({ id: `screen-${index}` }))) });
  await app.connect(); await app.click('start'); await until(() => app.notices.length === 1);
  assert.match(app.$('#computer-feedback').textContent, /최대 20장/);
  assert.equal(app.operations.length, 0);
});

test('disposing during a pending AI decision revokes the session and stores no late capture', async t => {
  let release, thinking = false;
  const app = boot(t, { ai: true, research: notebook([]), decide: async () => { thinking = true; return new Promise(resolve => { release = resolve; }); } });
  await app.connect(); await app.click('start'); await until(() => thinking);
  await app.api.dispose(); release(decision('finish')); await tick(); await tick();
  assert.equal(app.saved().records.length, 0);
  assert.ok(app.operations.some(item => item[0] === 'stop'));
  assert.equal(app.activity.at(-1), false);
});
