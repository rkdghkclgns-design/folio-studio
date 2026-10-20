/** Adversarial local-only regression tests. happy-dom is a DOM model, not a browser. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Window } from 'happy-dom';
import { exportHTML, buildEpub } from './dist/export.js';
import { standaloneReaderScript } from './dist/book-preview.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const fixture = overrides => ({
  title: '안전하게 보관할 원고', author: '작가', language: 'ko', theme: 'sage',
  chapters: [{ title: '첫 장', content: '기존 원고를 보존해야 합니다.' }], ...overrides,
});
const svgURL = source => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

function isolatedExport(source) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: new URL('.', import.meta.url), encoding: 'utf8', timeout: 2500,
  });
  assert.equal(result.error?.code, undefined, `Adversarial input blocked the export worker: ${result.error?.code}`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test('malformed long SVG numeric attributes reject promptly instead of blocking the UI thread', () => {
  const stdout = isolatedExport(`
    import {exportHTML} from './dist/export.js';
    const svg='<svg xmlns="http://www.w3.org/2000/svg"><rect width="'+'1'.repeat(240000)+'X" height="1"/></svg>';
    try {
      await exportHTML({title:'adversarial SVG',chapters:[],coverImage:{src:'data:image/svg+xml,'+encodeURIComponent(svg)}});
      throw new Error('Unsafe SVG unexpectedly accepted');
    } catch (error) {
      if (!/SVG/.test(error.message)) throw error;
      process.stdout.write('rejected');
    }
  `);
  assert.equal(stdout, 'rejected');
});

test('long unmatched Markdown delimiters export without quadratic scans or manuscript loss', () => {
  const stdout = isolatedExport(`
    import assert from 'node:assert/strict';
    import {exportHTML} from './dist/export.js';
    for (const text of ['['.repeat(240000), '[a]('.repeat(60000)]) {
      const html=await exportHTML({title:'adversarial Markdown',chapters:[{title:'chapter',content:text}]});
      assert.ok(html.includes(text), 'Every literal bracket must survive');
    }
    process.stdout.write('preserved');
  `);
  assert.equal(stdout, 'preserved');
});

test('SVG active content and encoded external resources cannot survive publication', async () => {
  for (const payload of [
    '<g onload="globalThis.compromised=true"/>',
    '<image href="https://tracking.invalid/reader-id"/>',
    '<foreignObject><iframe src="https://tracking.invalid"/></foreignObject>',
    '<style>@import "https://tracking.invalid/style";</style>',
    '<rect fill="url(https://tracking.invalid/paint)"/>',
    '<rect fill="u&#x72;l(https://tracking.invalid/paint)"/>',
    '<animate attributeName="href" values="javascript:alert(1)"/>',
    '<use href="data:image/svg+xml,&lt;svg&gt;"/>',
  ]) {
    const coverImage = { src: svgURL(`<svg xmlns="http://www.w3.org/2000/svg">${payload}</svg>`) };
    await assert.rejects(() => exportHTML(fixture({ coverImage })), /SVG/);
    await assert.rejects(() => buildEpub(fixture({ coverImage })), /SVG/);
  }
});

test('untrusted Markdown schemes and HTML stay inert in the standalone book', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  try {
    const payload = '</textarea><img src="https://tracking.invalid" onerror="globalThis.compromised=true"><script>bad()</script>';
    const content = `${payload}\n\n[bad](javascript:alert) [bad](data:text/html,attack) [bad](file:///private/file)\n\n[safe](https://example.invalid/)`;
    const project = fixture({ title: payload, author: payload, chapters: [{ title: payload, content }] });
    const html = await exportHTML(project);
    win.document.write(html);
    const scripts = [...win.document.querySelectorAll('script')];
    assert.equal(scripts.length, 1, 'Only the audited page-turning runtime may execute');
    assert.equal(scripts[0].id, 'folio-book-runtime');
    assert.equal(scripts[0].hasAttribute('src'), false);
    assert.equal(scripts[0].textContent, standaloneReaderScript());
    assert.equal(scripts[0].textContent.includes(payload), false, 'No manuscript content enters executable code');
    const digest = createHash('sha256').update(scripts[0].textContent).digest('base64');
    const csp = win.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    assert.ok(csp.includes("script-src 'sha256-" + digest + "'"));
    assert.equal(/script-src[^;]*(?:unsafe-inline|unsafe-eval|https?:)/.test(csp), false);
    const printable = await exportHTML(project, { interactive: false });
    assert.equal(/<script\b/i.test(printable), false, 'Print/PDF output remains entirely script-free');
    assert.equal(win.document.querySelectorAll('iframe,object,embed').length, 0);
    assert.equal(win.document.querySelectorAll('img[src^="http"]').length, 0);
    for (const element of win.document.querySelectorAll('*')) {
      for (const attribute of element.attributes) assert.ok(!/^on/i.test(attribute.name));
    }
    const links = [...win.document.querySelectorAll('a')].map(link => link.getAttribute('href'));
    assert.ok(!links.some(link => /^(?:javascript|data|file):/i.test(link)));
    assert.ok(links.includes('https://example.invalid/'));
    assert.ok(win.document.body.textContent.includes(payload));
  } finally { await win.happyDOM.close(); }
});

test('import trust boundary blocks tracking and unsafe images while retaining escaped manuscript text', async t => {
  const previous = new Map(), timers = new Set();
  const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
  const win = new Window({ url: 'https://folio.test.invalid/', settings: {
    disableJavaScriptEvaluation: true, disableCSSFileLoading: true,
    disableJavaScriptFileLoading: true, disableIframePageLoading: true,
  } });
  const install = (name, value) => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  win.document.body.innerHTML = '<div id="app"></div><div id="toast-region"></div><div id="modal-root"></div>';
  for (const name of ['window', 'document', 'HTMLElement', 'HTMLAnchorElement', 'FormData', 'DOMParser', 'File', 'FileReader', 'Image', 'localStorage', 'sessionStorage', 'navigator']) {
    install(name, name === 'window' ? win : win[name]);
  }
  Object.defineProperty(win, 'indexedDB', { configurable: true, value: undefined });
  install('fetch', async () => { throw new Error('A local import must never make a network request'); });
  install('setTimeout', (callback, delay, ...args) => {
    const timer = nativeSetTimeout(() => { timers.delete(timer); callback(...args); }, delay);
    timers.add(timer); timer.unref?.(); return timer;
  });
  install('clearTimeout', timer => { timers.delete(timer); nativeClearTimeout(timer); });
  const settle = () => new Promise(resolve => nativeSetTimeout(resolve, 0));
  const click = async selector => { assert.ok(win.document.querySelector(selector), selector); win.document.querySelector(selector).click(); await settle(); };
  const save = async () => {
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    await settle(); return JSON.parse(win.localStorage.getItem('folio-studio-v1'));
  };
  const importBook = async book => {
    await click('[data-action="library"]'); await click('.modal [data-action="import"]');
    const input = win.document.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new win.File([JSON.stringify(book)], 'redteam.json', { type: 'application/json' })] });
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
    for (let i = 0; i < 8; i++) await settle();
  };
  t.after(async () => {
    for (const timer of timers) nativeClearTimeout(timer);
    await win.happyDOM.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  await import(`./dist/app.js?redteam-security=${Date.now()}`);
  await settle();

  for (const [label, src] of [
    ['external tracking pixel', 'https://tracking.invalid/open?recipient=private-author'],
    ['same-origin state-changing GET', 'https://folio.test.invalid/account/delete?confirm=yes'],
    ['active SVG', svgURL('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>')],
    ['HTML masquerading as PNG', 'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
  ]) {
    await t.test(`rejects ${label} without changing the active book or library`, async () => {
      const before = await save();
      await importBook(fixture({ coverImage: { src } }));
      const after = await save();
      assert.equal(after.activeId, before.activeId, `${label} crossed the import boundary`);
      assert.equal(after.projects.length, before.projects.length);
      assert.equal(win.document.querySelectorAll('img[src^="https:"]').length, 0);
      if (win.document.querySelector('.modal')) await click('.modal [data-action="close-modal"]');
    });
  }

  await t.test('text payloads import as text and valid embedded artwork survives', async () => {
    const payload = '</textarea><img src="https://tracking.invalid" onerror="bad()"><script>bad()</script>';
    await importBook(fixture({ title: payload, author: payload, coverImage: { src: PNG, alt: payload }, chapters: [{ title: payload, content: payload }] }));
    await click('[data-action="editor-tab"][data-tab="write"]');
    assert.equal(win.document.querySelector('#manuscript-text').value, payload);
    await click('[data-action="editor-tab"][data-tab="read"]');
    assert.ok(win.document.querySelector('.read-content').textContent.includes(payload));
    assert.equal(win.document.querySelectorAll('#app script,#app iframe,#app object,#app img[src^="https:"]').length, 0);
    assert.equal(win.document.querySelector('.cover-image-full').getAttribute('src'), PNG);
    for (const element of win.document.querySelectorAll('#app *')) {
      for (const attribute of element.attributes) assert.ok(!/^on/i.test(attribute.name));
    }
  });
});
