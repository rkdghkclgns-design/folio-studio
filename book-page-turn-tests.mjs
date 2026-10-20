/** DOM contracts for the physical page-turn overlay; these do not assert browser rendering. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { BOOK_PREVIEW_CSS, mountBookPreview, standaloneReaderScript } from './dist/book-preview.js';
import { exportHTML } from './dist/export.js';

const sections = (count = 8) => Array.from({ length: count }, (_, index) => ({
  id: `section-${index}`,
  title: `SECTION_${index}`,
  kind: index === 0 ? 'cover' : 'chapter',
  html: `<p id="marker-${index}">BODY_${index} 한글 원고</p><a id="link-${index}" href="#section-${(index + 1) % count}">다음 장</a>`,
}));
const rect = (x, y, width, height) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON() { return { x, y, width, height }; } });

async function setup(t, { width = 900, layout = true, reduced = false, count = 8 } = {}) {
  const win = new Window({ url: 'https://folio.test/', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  const host = win.document.createElement('div');
  win.document.body.append(host);
  let hostWidth = width, reduceMotion = reduced, nextTimer = 0;
  const timers = new Map(), motionListeners = new Set(), changes = [];
  // Explicit geometry enables the animation path. Page-body heights stay zero,
  // so this harness tests turning existing pages rather than text pagination.
  host.getBoundingClientRect = () => rect(100, 20, hostWidth, 600);
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    if (!layout) return rect(0, 0, 0, 0);
    const pageWidth = parseFloat(host.style.getPropertyValue('--book-page-width')) || 360;
    const pageHeight = parseFloat(host.style.getPropertyValue('--book-page-height')) || 510;
    if (this.hasAttribute('data-book-stage')) return rect(100, 20, hostWidth, pageHeight + 36);
    if (this.classList.contains('folio-book-page') || this.classList.contains('folio-book-blank')) {
      const left = this.classList.contains('is-left') ? hostWidth / 2 - pageWidth : this.classList.contains('is-right') ? hostWidth / 2 + 1 : (hostWidth - pageWidth) / 2;
      return rect(100 + left, 36, pageWidth, pageHeight);
    }
    return rect(0, 0, 0, 0);
  };
  win.matchMedia = query => ({
    media: query,
    get matches() { return query.includes('prefers-reduced-motion') && reduceMotion; },
    addEventListener: (type, listener) => { if (type === 'change') motionListeners.add(listener); },
    removeEventListener: (type, listener) => { if (type === 'change') motionListeners.delete(listener); },
    addListener: listener => motionListeners.add(listener),
    removeListener: listener => motionListeners.delete(listener),
  });
  win.setTimeout = (callback, delay = 0) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  };
  win.clearTimeout = id => timers.delete(id);
  const reader = mountBookPreview(host, { title: '실제 책장 검증', sections: sections(count), onPageChange: state => changes.push({ ...state }) });
  await reader.ready;
  t.after(async () => { reader.destroy(); timers.clear(); await win.happyDOM.close(); });
  const runTimers = (maximumDelay = 1000) => {
    for (const [id, timer] of [...timers]) if (timer.delay <= maximumDelay && timers.delete(id)) timer.callback();
  };
  const finish = (overlay = host.querySelector('[data-book-turn]')) => {
    if (!overlay) return;
    const event = new win.Event('animationend', { bubbles: true });
    Object.defineProperty(event, 'animationName', { value: `folio-leaf-${overlay.dataset.direction}` });
    overlay.querySelector('.folio-book-leaf').dispatchEvent(event);
  };
  const setReduced = value => {
    reduceMotion = value;
    for (const listener of motionListeners) listener({ matches: value, media: '(prefers-reduced-motion: reduce)' });
  };
  return { win, host, reader, changes, timers, finish, runTimers, setReduced, resize: value => { hostWidth = value; win.dispatchEvent(new win.Event('resize')); } };
}

const overlay = s => s.host.querySelector('[data-book-turn]');
const stagePages = s => [...s.host.querySelectorAll('[data-book-stage] > .folio-book-page')];
const faceText = (s, face) => overlay(s).querySelector(`[data-book-face="${face}"]`).textContent;
const assertBody = (element, number) => assert.match(element.textContent, new RegExp(`BODY_${number}\\b`));

test('desktop next turns the outgoing right page onto the incoming left page while destination state is immediate', async t => {
  const s = await setup(t);
  s.reader.goTo(1); s.finish();
  const beforeEvents = s.changes.length;
  s.reader.next();
  assert.equal(s.reader.getState().page, 3);
  assert.equal(s.changes.length, beforeEvents + 1);
  assert.equal(s.changes.at(-1).page, 3);
  assert.equal(overlay(s).dataset.direction, 'next');
  assert.match(faceText(s, 'front'), /BODY_2\b/);
  assert.match(faceText(s, 'back'), /BODY_3\b/);
  assert.deepEqual([...overlay(s).querySelectorAll('.folio-book-underlay')].map(page => page.textContent.match(/BODY_\d/)[0]), ['BODY_1', 'BODY_4'], 'The stationary surfaces are the old left and new right pages');
  assert.deepEqual(stagePages(s).map(page => page.querySelector('.folio-book-page-body').textContent.match(/BODY_\d/)[0]), ['BODY_3', 'BODY_4']);
  s.finish();
  assert.equal(overlay(s), null);
  assert.equal(s.changes.length, beforeEvents + 1, 'Animation completion does not publish a duplicate navigation event');
  assert.equal(s.host.querySelector('[data-book-position]').textContent, '4–5 / 8쪽');
});

test('desktop previous turns the outgoing left page back onto the incoming right page', async t => {
  const s = await setup(t);
  s.reader.goTo(3); s.finish();
  s.reader.prev();
  assert.equal(s.reader.getState().page, 1);
  assert.equal(overlay(s).dataset.direction, 'prev');
  assert.match(faceText(s, 'front'), /BODY_3\b/);
  assert.match(faceText(s, 'back'), /BODY_2\b/);
  assert.deepEqual([...overlay(s).querySelectorAll('.folio-book-underlay')].map(page => page.textContent.match(/BODY_\d/)[0]), ['BODY_1', 'BODY_4'], 'Reverse motion keeps the new left and old right surfaces');
  assertBody(stagePages(s)[0], 1);
  assertBody(stagePages(s)[1], 2);
  s.finish();
  assert.equal(overlay(s), null);
});

test('cover opening and closing retain one cover and use real content on the moving leaf', async t => {
  const s = await setup(t);
  assert.equal(stagePages(s).length, 1);
  s.reader.next();
  assert.equal(s.reader.getState().page, 1);
  assert.match(faceText(s, 'front'), /BODY_0\b/);
  assert.match(faceText(s, 'back'), /BODY_1\b/);
  s.finish();
  s.reader.prev();
  assert.equal(s.reader.getState().page, 0);
  assert.equal(stagePages(s).length, 1);
  assert.match(faceText(s, 'back'), /BODY_0\b/);
  s.finish();
  const events = s.changes.length;
  s.reader.prev();
  assert.equal(overlay(s), null);
  assert.equal(s.changes.length, events, 'Previous at the first page is a no-op');
});

test('mobile turns reveal one complete destination page in both directions', async t => {
  const s = await setup(t, { width: 390 });
  s.reader.next(); s.finish();
  s.reader.next();
  assert.equal(s.reader.getState().spread, 1);
  assert.equal(s.reader.getState().page, 2);
  assert.equal(stagePages(s).length, 1);
  assertBody(stagePages(s)[0], 2);
  assert.match(faceText(s, 'front'), /BODY_1\b/);
  s.finish();
  s.reader.prev();
  assert.equal(s.reader.getState().page, 1);
  assert.equal(overlay(s).dataset.direction, 'prev');
  assert.equal(stagePages(s).length, 1);
  assertBody(stagePages(s)[0], 1);
  s.finish();
});

test('a final unpaired page has an inert blank companion and cannot turn beyond the end', async t => {
  const s = await setup(t, { count: 8 });
  s.reader.goTo(5); s.finish();
  s.reader.next();
  assert.equal(s.reader.getState().page, 7);
  assert.equal(stagePages(s).length, 1, 'The blank is not a numbered manuscript page');
  assertBody(stagePages(s)[0], 7);
  const blank = s.host.querySelector('[data-book-stage] > .folio-book-blank');
  assert.ok(blank);
  assert.equal(blank.getAttribute('aria-hidden'), 'true');
  assert.equal(Boolean(blank.inert || blank.hasAttribute('inert')), true);
  assert.ok(overlay(s), 'A real blank companion still permits the final leaf to turn');
  assert.match(faceText(s, 'front'), /BODY_6\b/);
  assert.match(faceText(s, 'back'), /BODY_7\b/);
  s.finish();
  const events = s.changes.length;
  s.reader.next();
  assert.equal(s.reader.getState().page, 7);
  assert.equal(s.changes.length, events);
  assert.equal(overlay(s), null);
  assert.equal(s.host.querySelector('[data-book-next]').disabled, true);
});

test('a complete final spread cannot advance to repeat only its right page', async t => {
  const s = await setup(t, { count: 5 });
  s.reader.goTo(1); s.finish();
  s.reader.next(); s.finish();
  assert.equal(s.reader.getState().page, 3);
  assert.equal(stagePages(s).length, 2);
  assert.equal(s.host.querySelector('[data-book-position]').textContent, '4–5 / 5쪽');
  assert.equal(s.host.querySelector('[data-book-next]').disabled, true);
  const events = s.changes.length;
  s.reader.next();
  s.host.dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(s.reader.getState().page, 3);
  assert.equal(stagePages(s).length, 2);
  assert.equal(s.changes.length, events);
  assert.equal(overlay(s), null);
});

test('animation-only copies are hidden, inert, do not repeat IDs, and do not steal focus', async t => {
  const s = await setup(t);
  s.reader.goTo(1); s.finish();
  const button = s.host.querySelector('[data-book-next]');
  button.focus(); button.click();
  const turn = overlay(s);
  assert.equal(turn.getAttribute('aria-hidden'), 'true');
  assert.equal(Boolean(turn.inert || turn.hasAttribute('inert')), true);
  assert.equal(turn.querySelectorAll('[id]').length, 0);
  assert.equal(turn.querySelectorAll('.folio-book-page').length, 0, 'Motion copies must not look like live pages to consumers');
  for (const element of turn.querySelectorAll('a,button,input,textarea,select,[tabindex]')) assert.equal(element.tabIndex, -1, element.outerHTML.slice(0, 180));
  const ids = [...s.host.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(s.win.document.activeElement, button);
  s.finish();
  assert.equal(s.win.document.activeElement, button);
});

test('keyboard focus stays inside the reader when a focused page link is replaced', async t => {
  const s = await setup(t);
  s.reader.goTo(1); s.finish();
  const link = stagePages(s)[0].querySelector('a');
  link.focus(); link.click();
  assert.equal(s.reader.getState().section, 2);
  assert.equal(s.win.document.activeElement, s.host);
  const event = new s.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  s.host.dispatchEvent(event);
  assert.equal(s.reader.getState().page, 4);
  assert.equal(event.defaultPrevented, true);
});

test('burst navigation replaces the prior overlay and stale animation completion cannot remove the latest leaf', async t => {
  const s = await setup(t);
  s.reader.goTo(1); s.finish();
  s.reader.next(); const first = overlay(s);
  s.reader.prev(); const second = overlay(s);
  assert.notEqual(first, second);
  assert.equal(first.isConnected, false);
  assert.equal(s.host.querySelectorAll('[data-book-turn]').length, 1);
  assert.equal(s.reader.getState().page, 1);
  assert.equal(second.dataset.direction, 'prev');
  s.finish(first);
  assert.equal(overlay(s), second);
  s.reader.goToSection('section-5');
  assert.equal(second.isConnected, false);
  assert.equal(s.host.querySelectorAll('[data-book-turn]').length, 1);
  assert.equal(s.reader.getState().page, 5);
  s.finish(second);
  assert.ok(overlay(s));
  s.finish();
  assert.equal(overlay(s), null);
});

test('turning a scrolled table preserves its position on both the moving face and stationary underlay', async t => {
  const s = await setup(t);
  s.reader.goTo(1); s.finish();
  const [left, right] = stagePages(s).map(page => page.querySelector('.folio-book-page-body'));
  for (const body of [left, right]) { body.classList.add('has-overflow'); body.tabIndex = 0; }
  left.scrollTop = 83; left.scrollLeft = 11;
  right.scrollTop = 137; right.scrollLeft = 29;
  s.reader.next();
  const front = overlay(s).querySelector('[data-book-face="front"] .has-overflow');
  const stationary = overlay(s).querySelector('.folio-book-underlay .has-overflow');
  assert.ok(front && stationary);
  assert.deepEqual([front.scrollTop, front.scrollLeft], [137, 29]);
  assert.deepEqual([stationary.scrollTop, stationary.scrollLeft], [83, 11]);
  assert.equal(front.tabIndex, -1);
  assert.equal(stationary.tabIndex, -1);
  s.finish();
});

test('only the leaf animation ends a turn; missing animation events still release the overlay', async t => {
  const s = await setup(t);
  s.reader.next();
  const turn = overlay(s), face = turn.querySelector('[data-book-face="front"]');
  const event = new s.win.Event('animationend', { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: 'folio-leaf-next' });
  face.dispatchEvent(event);
  assert.equal(overlay(s), turn, 'A descendant decoration must not finish the leaf');
  s.runTimers();
  assert.equal(overlay(s), null, 'Fallback releases the temporary layer without relying on animationend');
  assert.equal(s.reader.getState().page, 1);
});

test('refresh, resize, and destroy remove pending motion without delayed DOM resurrection', async t => {
  const s = await setup(t);
  s.reader.next(); assert.ok(overlay(s));
  s.reader.refresh(); assert.equal(overlay(s), null);
  s.runTimers();
  assert.equal(s.reader.getState().page, 1);
  s.reader.next(); assert.ok(overlay(s));
  s.resize(390); assert.equal(overlay(s), null);
  s.runTimers();
  assert.equal(s.reader.getState().page, 3);
  assert.equal(s.reader.getState().spread, 1);
  assert.equal(stagePages(s).length, 1);
  s.reader.next(); const turn = overlay(s); assert.ok(turn);
  s.reader.destroy();
  assert.equal(s.host.children.length, 0);
  s.finish(turn); s.runTimers();
  s.reader.next(); s.reader.refresh();
  assert.equal(s.host.children.length, 0);
});

test('reduced motion skips the leaf and changing the preference removes an active turn', async t => {
  const s = await setup(t, { reduced: true });
  s.reader.next();
  assert.equal(s.reader.getState().page, 1);
  assert.equal(overlay(s), null);
  s.setReduced(false); s.reader.next();
  assert.ok(overlay(s));
  s.setReduced(true);
  assert.equal(overlay(s), null);
  assert.equal(s.reader.getState().page, 3);
  s.reader.prev();
  assert.equal(s.reader.getState().page, 1);
  assert.equal(overlay(s), null);
});

test('layoutless DOM and hidden readers keep synchronous navigation without creating a motion layer', async t => {
  const s = await setup(t, { layout: false });
  s.reader.next();
  assert.equal(s.reader.getState().page, 1);
  assert.equal(overlay(s), null);
  assert.equal(stagePages(s).length, 2);
});

test('offline HTML embeds the exact two-sided runtime and CSS with a matching CSP digest', async () => {
  const html = await exportHTML({ title: '오프라인 책장', author: '저자', chapters: [{ id: 'one', title: '첫 장', content: '보존할 본문' }] });
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const script = scripts[0][1];
  assert.equal(script, standaloneReaderScript());
  assert.ok(html.includes(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`));
  assert.ok(html.includes(BOOK_PREVIEW_CSS));
  assert.equal(await readFile(new URL('./dist/book-preview.css', import.meta.url), 'utf8'), BOOK_PREVIEW_CSS.trimStart());
  assert.match(BOOK_PREVIEW_CSS, /rotateY\(-180deg\)/);
  assert.match(BOOK_PREVIEW_CSS, /rotateY\(180deg\)/);
  assert.match(BOOK_PREVIEW_CSS, /transform-style:preserve-3d/);
  assert.match(BOOK_PREVIEW_CSS, /backface-visibility:hidden/);
  assert.match(BOOK_PREVIEW_CSS, /prefers-reduced-motion:reduce/);
  assert.ok(!/<script[^>]+src=|<link[^>]+href=/.test(html));
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(script));
});

test('exported runtime creates a two-sided turn without importing application helpers', async () => {
  const html = await exportHTML({ title: '독립 실행 책장', author: '저자', chapters: [{ id: 'one', title: '첫 장', content: '단독 HTML 본문' }] });
  const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const win = new Window({ settings: { disableJavaScriptEvaluation: false, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  win.Image = class { complete = true; set src(value) { this.value = value; } };
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.id === 'folio-book-reader' || this.hasAttribute('data-book-stage')) return rect(0, 0, 900, 600);
    if (this.classList.contains('folio-book-page') || this.classList.contains('folio-book-blank')) return rect(this.classList.contains('is-right') ? 451 : 70, 16, 380, 537);
    return rect(0, 0, 0, 0);
  };
  try {
    win.document.write(html);
    win.eval(script);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    win.document.querySelector('[data-book-next]').click();
    const turn = win.document.querySelector('[data-book-turn]');
    assert.ok(turn, 'The embedded function must include all motion helpers');
    assert.equal(turn.querySelectorAll('[data-book-face]').length, 2);
    assert.equal(turn.dataset.direction, 'next');
    assert.ok(turn.querySelector('[data-book-face="front"] img[src^="data:"]'), 'The cover image remains on the outgoing leaf');
    assert.match(turn.querySelector('[data-book-face="back"]').textContent, /독립 실행 책장/);
    assert.ok(win.document.documentElement.classList.contains('folio-reader-enhanced'));
    assert.match(win.document.querySelector('#folio-book-source').textContent, /단독 HTML 본문/);
    const toc = win.document.querySelector('[data-book-stage] > .folio-book-page .folio-book-page-body.toc');
    assert.ok(toc);
    const expectedPadding = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(name => win.getComputedStyle(toc)[name]);
    win.document.querySelector('[data-book-next]').click();
    const turningToc = win.document.querySelector('[data-book-face="front"] .folio-book-turn-page-body.toc');
    assert.ok(turningToc, 'The contents page is now the outgoing right-hand page');
    const actualPadding = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(name => win.getComputedStyle(turningToc)[name]);
    assert.deepEqual(actualPadding, expectedPadding, 'Offline document .toc styles must not add padding to its animated copy');
    assert.ok(actualPadding.every(value => parseFloat(value) === 0), 'Both contents surfaces use the reader padding reset');
  } finally { await win.happyDOM.close(); }
});
