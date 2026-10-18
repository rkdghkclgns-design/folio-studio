import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {TUTORIAL_STEPS, renderTutorialStep, renderHelpOverview} from './dist/tutorial.js';

function documentFor(html) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

test('tutorial gives six distinct steps that only open views or forms', () => {
  assert.equal(TUTORIAL_STEPS.length, 6);
  assert.equal(new Set(TUTORIAL_STEPS.map(step => step.id)).size, 6);
  assert.ok(Object.isFrozen(TUTORIAL_STEPS));
  for (const step of TUTORIAL_STEPS) {
    assert.ok(['editor', 'quality', 'design', 'export'].includes(step.view));
    assert.ok([null, 'new-project', 'settings'].includes(step.action));
    assert.ok(step.instructions.length >= 2 && step.instructions.length <= 3);
    assert.ok(step.selector);
    assert.ok(Object.isFrozen(step));
    assert.ok(Object.isFrozen(step.instructions));
  }
});

test('all steps expose current progress and keyboard reachable controls', () => {
  TUTORIAL_STEPS.forEach((step, index) => {
    const doc = documentFor(renderTutorialStep(index));
    assert.equal(doc.querySelector('[data-tutorial-step]').dataset.tutorialStep, step.id);
    assert.equal(doc.querySelector('progress').getAttribute('value'), String(index + 1));
    assert.equal(doc.querySelector('progress').getAttribute('max'), '6');
    assert.ok(doc.querySelector('progress').getAttribute('aria-label'));
    assert.equal(doc.querySelectorAll('[aria-current=step]').length, 1);
    assert.equal(doc.querySelector('[aria-current=step]').dataset.index, String(index));
    assert.equal(doc.querySelectorAll('.tutorial-instructions li').length, 3);
    assert.equal(doc.querySelector('[data-action=tutorial-prev]').disabled, index === 0);
    assert.equal(doc.querySelector('[data-action=tutorial-try]').dataset.index, String(index));
    assert.equal(Boolean(doc.querySelector('[data-action=tutorial-finish]')), index === 5);
    assert.equal(Boolean(doc.querySelector('[data-action=tutorial-next]')), index < 5);
    assert.equal(doc.querySelector('.tutorial-visual').getAttribute('aria-hidden'), 'true');
    assert.ok([...doc.querySelectorAll('button')].every(button => button.type === 'button'));
  });
});

test('invalid tutorial positions are clamped and cannot inject markup', () => {
  const inputs = [[-1, 'book'], [500, 'export'], [2.9, 'polish'], [NaN, 'book'], [Infinity, 'book'], ['<img src=x onerror=alert(1)>', 'book'], [Symbol('step'), 'book']];
  for (const [input, expected] of inputs) {
    const doc = documentFor(renderTutorialStep(input));
    assert.equal(doc.querySelector('[data-tutorial-step]').dataset.tutorialStep, expected);
    assert.equal(doc.querySelector('script,img,[onerror]'), null);
  }
});

test('guidance has no action that edits, generates or downloads', () => {
  const allowed = new Set(['tutorial-start', 'tutorial-jump', 'tutorial-prev', 'tutorial-next', 'tutorial-try', 'tutorial-finish', 'tutorial-resume', 'computer-studio']);
  const doc = documentFor(TUTORIAL_STEPS.map((_, index) => renderTutorialStep(index)).join('') + renderHelpOverview());
  for (const button of doc.querySelectorAll('[data-action]')) assert.ok(allowed.has(button.dataset.action), button.dataset.action);
  assert.equal(doc.querySelector('form,input,textarea,iframe,script,img'), null);
  assert.equal(doc.querySelectorAll('a[href]').length, 1);
  assert.equal(doc.querySelector('a').href, 'https://aistudio.google.com/apikey');
});

test('help explains actual shortcuts, local saves, restoration and export choices', () => {
  const doc = documentFor(renderHelpOverview());
  assert.equal(doc.querySelectorAll('.help-step').length, 6);
  assert.deepEqual([...doc.querySelectorAll('.help-step')].map(button => button.dataset.index), ['0', '1', '2', '3', '4', '5']);
  assert.equal(doc.querySelectorAll('.shortcut-list div').length, 3);
  assert.equal(doc.querySelectorAll('.help-faq details').length, 8);
  const text = doc.body.textContent;
  for (const phrase of ['서재의 모든 책에서 원고 검색', '다른 기기로 자동 동기화되지는 않습니다', '최근 8개', '현재 탭에만', 'PDF로 저장', '현재 책 백업 · JSON', '생성은 중지 버튼 사용', '도표 보강', '자료 자체의 정확성', '컴퓨터로 예제 만들기', 'Windows PC', 'F8', 'PNG']) assert.ok(text.includes(phrase), phrase);
  const link = doc.querySelector('a');
  assert.equal(link.target, '_blank');
  assert.match(link.rel, /noopener/);
});
