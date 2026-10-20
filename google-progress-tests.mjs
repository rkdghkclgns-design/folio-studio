/** Progress recovery DOM tests; simulated provider responses, no browser or live API. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createProductionProject } from './dist/production.js';

const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
const workspaceKey = 'folio-studio-v1';
let serial = 0;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const completion = value => response({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }] });

async function boot(t) {
  const originals = new Map(), timers = new Set(), requests = [];
  const install = (name, value) => {
    if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const win = new Window({ url: 'https://folio.test', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  win.document.body.innerHTML = '<div id="app"></div><div id="toast-region" aria-live="polite"></div><div id="modal-root"></div>';
  for (const name of ['window','document','HTMLElement','HTMLAnchorElement','FormData','DOMParser','File','FileReader','Image','CSS','localStorage','sessionStorage','navigator']) install(name, name === 'window' ? win : win[name]);
  Object.defineProperty(win, 'indexedDB', { configurable: true, value: undefined });
  install('setTimeout', (callback, delay, ...args) => {
    const timer = nativeSetTimeout(() => { timers.delete(timer); callback(...args); }, delay);
    timer.unref?.(); timers.add(timer); return timer;
  });
  install('clearTimeout', timer => { timers.delete(timer); nativeClearTimeout(timer); });
  const p = createProductionProject({ topic: '첫 텃밭을 가꾸는 사람', author: '김정원', targetValue: 3000, chapterCount: 2, sourceMarkdown: '', instructions: '계절 순서로 설명해 주세요.', illustrations: 'none' });
  localStorage.setItem(workspaceKey, JSON.stringify({ projects: [p], activeId: p.id, histories: {} }));
  const ai = await import('./dist/ai.js'); ai.clearAI();
  t.after(async () => {
    ai.clearAI(); for (const timer of timers) nativeClearTimeout(timer); await win.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  const settle = () => new Promise(resolve => nativeSetTimeout(resolve, 0));
  const $ = selector => { const el = document.querySelector(selector); assert.ok(el, `Missing ${selector}`); return el; };
  const until = async condition => { for (let i = 0; i < 300 && !condition(); i++) await settle(); assert.ok(condition(), document.body.textContent); };
  const click = async selector => { $(selector).click(); await settle(); };
  const input = (selector, value) => { $(selector).value = value; $(selector).dispatchEvent(new win.Event('input', { bubbles: true })); };
  const current = () => JSON.parse(localStorage.getItem(workspaceKey)).projects[0];
  const mock = handler => {
    ai.configureAI({ provider: 'google', apiKey: 'AIza-progress-test-only' });
    install('fetch', async (url, options = {}) => {
      const body = options.body && JSON.parse(options.body), payload = body && JSON.parse(body.contents[0].parts[0].text);
      requests.push({ url, options, payload });
      if (!body) return response({ name: `models/${ai.getAIConfig().textModel}`, supportedGenerationMethods: ['generateContent'] });
      return handler(payload, options);
    });
  };
  await import(`./dist/app.js?google-progress=${serial++}`); await until(() => document.querySelector('[data-action=\"editor-tab\"][data-tab=\"read\"]'));
  await click('[data-action=\"editor-tab\"][data-tab=\"write\"]');
  return { $, click, input, current, requests, mock, until, win, initial: p };
}

async function approveStart(app) {
  const before=app.requests.length;
  await app.click('.modal [data-action="production-start"]');
  assert.equal(app.requests.length,before,'No generation before approval');
  assert.equal(app.$('[data-action="production-approve"]').disabled,true);
  app.$('#production-approval-check').checked=true;
  app.$('#production-approval-check').dispatchEvent(new app.win.Event('change',{bubbles:true}));
  await app.click('[data-action="production-approve"]');
}

test('planning rejection appears once and API settings return to the same saved production', async t => {
  const app = await boot(t);
  app.mock(() => response({ error: { status: 'INVALID_ARGUMENT', message: 'Untrusted <img src=x onerror=alert(1)> provider content' } }, 400));
  await app.click('[data-action="production-summary"]'); await approveStart(app);
  await app.until(() => document.querySelector('#task-error'));
  assert.equal(app.requests.length, 1, 'No automatic extra generation request');
  assert.equal([...document.querySelectorAll('.progress-line')].filter(el => el.textContent === '책의 목차를 구성하고 있습니다.').length, 1, 'Repeated planning notifications collapse');
  assert.doesNotMatch(app.$('#progress-log').textContent, /Google|Gemini/);
  assert.equal(app.$('#task-error').getAttribute('role'), 'alert');
  assert.match(app.$('#task-error').textContent, /Google|Gemini/);
  assert.equal(document.querySelector('#task-error img'), null);
  assert.equal(app.$('.modal-header h2').textContent, '제작이 멈췄습니다');
  assert.equal(app.$('#toast-region').textContent, '');
  assert.equal(document.querySelector('.spinner'), null);
  assert.deepEqual(app.current().production.brief, app.initial.production.brief);
  assert.deepEqual(app.current().chapters, app.initial.chapters);
  assert.equal(app.current().production.status, 'failed');
  await app.click('[data-action="production-error-settings"]');
  app.input('#api-key', 'AIza-progress-reconnect-test-only');
  app.$('#ai-form').dispatchEvent(new app.win.Event('submit', { bubbles: true, cancelable: true }));
  await app.until(() => document.querySelector('.production-summary'));
  assert.equal(app.current().id, app.initial.id);
  assert.deepEqual(app.current().production.brief, app.initial.production.brief);
  assert.equal(app.requests.filter(call => call.payload).length, 1, 'Reconnect never resumes generation without an action');
});

test('a mid-book failure preserves completed manuscript and distinct stages without repeated notices', async t => {
  const app = await boot(t); let written = 0;
  app.mock(payload => {
    if (payload.operation === 'production_book_plan') return completion({ title: '작은 텃밭', subtitle: '', description: '계절에 따라 가꾸는 텃밭', chapters: [1,2].map(n => ({ title: `계절 ${n}`, purpose: '돌보는 방법', outline: ['준비','돌보기'], sourceRefs: [] })) });
    if (payload.operation === 'production_section' && written++ === 0) return completion({ content: '가'.repeat(payload.targetChars), notes: [], imagePrompt: '', sourceRefs: [] });
    return response({ error: { status: 'PERMISSION_DENIED' } }, 403);
  });
  await app.click('[data-action="production-summary"]'); await approveStart(app); await app.until(() => document.querySelector('#task-error'));
  const stored = app.current(), lines = [...document.querySelectorAll('.progress-line')].map(el => el.textContent);
  assert.ok(stored.chapters[0].content.length >= 500);
  assert.equal(stored.chapters[1].content, '');
  assert.equal(stored.production.status, 'failed');
  assert.deepEqual(stored.production.brief, app.initial.production.brief);
  assert.ok(lines.some(line => line.includes('목차')) && lines.some(line => line.includes('집필')));
  assert.ok(lines.every((line, i) => !i || lines[i - 1] !== line));
  assert.equal(lines.filter(line => /권한|Google/.test(line)).length, 0);
  await app.click('.modal [data-action="production-summary"]');
  assert.ok(app.$('.production-summary [data-action="production-start"]'));
  assert.equal(app.current().chapters[0].content, stored.chapters[0].content);
});

test('cancellation has one status notice and keeps the saved production resumable', async t => {
  const app = await boot(t);
  app.mock((payload, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
  await app.click('[data-action="production-summary"]'); await approveStart(app); await app.until(() => app.requests.length > 0);
  await app.click('[data-action="cancel-operation"]'); await app.until(() => document.querySelector('#task-error'));
  assert.equal(app.current().production.status, 'paused');
  assert.equal(app.$('#task-error').getAttribute('role'), 'status');
  assert.match(app.$('#task-error').textContent, /중지/);
  const lines = [...document.querySelectorAll('.progress-line')].map(el => el.textContent);
  assert.ok(lines.every((line, i) => !i || lines[i - 1] !== line));
  assert.doesNotMatch(app.$('#progress-log').textContent, /중지|이어갈/);
  assert.equal(document.querySelector('[data-action="production-error-settings"]'), null);
  assert.ok(app.$('.modal [data-action="production-summary"]'));
  assert.deepEqual(app.current().production.brief, app.initial.production.brief);
  assert.equal(app.requests.length, 1);
});
