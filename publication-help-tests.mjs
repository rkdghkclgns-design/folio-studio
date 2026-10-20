import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { normalizePublication, publicationFingerprint, publicationReadiness, publicationGuide } from './dist/publication.js';
import { publicationCheckHelp, PUBLISHING_HELP_LINKS, PUBLICATION_IMAGE_OPTIONS } from './dist/publication-help.js';
import { renderPublicationPanel, mountPublicationPanel } from './dist/publication-ui.js';

const fixture = () => ({ id: 'help-test', title: '처음 출판하는 책', author: '저자', description: '소개', language: 'ko', chapters: [{ id: 'one', title: '첫 장', content: '본문입니다.' }], publication: normalizePublication({ publisher: '출판사', publicationDate: '2026-10-21', price: '5000', aiDisclosure: 'none' }) });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('every generated publishing check has a plain-language definition and a concrete work location', () => {
  for (const channel of ['domestic', 'kdp', 'direct']) {
    const p = fixture();
    p.publication = normalizePublication({ channel, isbnStatus: 'issued', submissionDate: 'invalid', approvedDate: 'invalid', depositDate: 'invalid', referenceUrl: 'javascript:alert(1)' });
    for (const check of publicationReadiness(p).checks) {
      const info = publicationCheckHelp(check.id, channel);
      assert.ok(info, check.id);
      for (const field of ['term', 'meaning', 'where', 'action']) assert.ok(info[field].trim(), check.id + ':' + field);
    }
  }
});

test('ISBN and submission help follow the selected route without imposing direct-publisher steps on KDP ebooks', () => {
  const domestic = publicationCheckHelp('isbn', 'domestic');
  assert.match(domestic.action, /발행자번호.*개별 도서 ISBN/);
  assert.ok(domestic.links.some(link => link.url.endsWith('/S30201000000.do')));
  const kdp = publicationCheckHelp('isbn', 'kdp');
  assert.match(kdp.meaning, /필수가 아닙니다/);
  assert.ok(kdp.links.every(link => new URL(link.url).hostname === 'kdp.amazon.com'));
  assert.match(publicationCheckHelp('submission', 'direct').action, /무료 배포와 직접 판매/);
  assert.match(publicationCheckHelp('field-category', 'kdp').where, /분류/);
  assert.equal(publicationCheckHelp('not-a-check'), null);
});

test('published help destinations use explicit HTTPS links with readable labels', () => {
  for (const link of Object.values(PUBLISHING_HELP_LINKS)) {
    const url = new URL(link.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username + url.password, '');
    assert.ok(link.label.length > 3);
  }
  assert.match(PUBLISHING_HELP_LINKS.publisherReport.url, /CappBizCD=13700000045/);
  assert.match(PUBLISHING_HELP_LINKS.deposit.url, /S50102010000/);
});

test('checklist help uses accessible native disclosures and safe links outside confirmation labels', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
  try {
    win.document.body.innerHTML = renderPublicationPanel(fixture());
    const checks = win.document.querySelectorAll('.publication-check');
    assert.ok(checks.length > 10);
    for (const check of checks) {
      assert.equal(check.querySelector('details > summary').textContent, '뜻과 진행 방법');
      assert.match(check.textContent, /어디서.*할 일/s);
    }
    for (const link of win.document.querySelectorAll('.publication-check-help a, .publication-reference a')) {
      assert.equal(link.target, '_blank');
      assert.equal(link.rel, 'noopener noreferrer');
      assert.equal(link.closest('label,form'), null);
      assert.match(link.textContent, /새 탭/);
    }
    assert.equal(win.document.querySelectorAll('.publication-confirmations input[type="checkbox"]').length, 3);
  } finally { await win.happyDOM.close(); }
});

test('reading help and following links neither save the book nor mark a review complete', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  const p = fixture(); p.publication.rightsConfirmed = true; p.publication.reviewFingerprint = publicationFingerprint(p);
  const before = JSON.stringify(p); let saves = 0;
  win.document.body.innerHTML = renderPublicationPanel(p);
  const panel = win.document.querySelector('.publication-panel');
  const mounted = mountPublicationPanel(panel, { getProject: () => p, onSave: () => { ++saves; } });
  try {
    panel.querySelector('[data-publication-help="rights"] summary').click();
    const link = panel.querySelector('[data-publication-help="rights"] a');
    link.addEventListener('click', event => event.preventDefault()); link.click();
    await settle();
    assert.equal(saves, 0);
    assert.equal(JSON.stringify(p), before);
    assert.equal(panel.querySelector('[name="rightsConfirmed"]').checked, true);
    assert.equal(panel.querySelector('[name="proofreadConfirmed"]').checked, false);
  } finally { mounted.dispose(); await win.happyDOM.close(); }
});

test('open help survives autosave and its route-specific destination updates after switching channels', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
  const p = fixture();
  win.document.body.innerHTML = renderPublicationPanel(p);
  const panel = win.document.querySelector('.publication-panel');
  const mounted = mountPublicationPanel(panel, { getProject: () => p, onSave: value => { p.publication = value; } });
  try {
    panel.querySelector('[data-publication-help="isbn"]').open = true;
    const publisher = panel.querySelector('[name="publisher"]'); publisher.value = '개정 발행처'; publisher.dispatchEvent(new win.Event('input', { bubbles: true }));
    await settle();
    assert.equal(panel.querySelector('[data-publication-help="isbn"]').open, true);
    const channel = panel.querySelector('[name="channel"]'); channel.value = 'kdp'; channel.dispatchEvent(new win.Event('change', { bubbles: true }));
    await settle();
    const info = panel.querySelector('[data-publication-help="isbn"]');
    assert.equal(info.open, true);
    assert.match(info.textContent, /필수가 아닙니다/);
    assert.equal(new URL(info.querySelector('a').href).hostname, 'kdp.amazon.com');
  } finally { mounted.dispose(); await win.happyDOM.close(); }
});

test('downloaded guide includes the same destinations, glossary, business distinction and no-extra-image-cost alternatives', () => {
  const guide = publicationGuide(fixture());
  assert.match(guide, /점검 항목별 뜻과 진행 위치/);
  assert.match(guide, /진행 위치:.*EPUBCheck|진행 위치:.*validate-epub/);
  assert.ok(guide.includes(PUBLISHING_HELP_LINKS.bookISBN.url));
  assert.ok(guide.includes(PUBLISHING_HELP_LINKS.publisherReport.url));
  assert.match(guide, /출판업 추가만으로.*자동으로 일반과세자.*아닙니다/);
  assert.match(guide, /모든 PDF가 자동으로 면세/);
  assert.match(guide, /출처 표기만으로 이용 허락이 생기지는 않습니다/);
  assert.match(guide, /추가 \$0 \/ 0원/);
  assert.match(guide, /구독료.*별도/);
  assert.match(guide, /API 요금 체계/);
  assert.equal(PUBLICATION_IMAGE_OPTIONS.length, 3);
});

test('rendering new reference help preserves existing publication state and escapes untrusted metadata', async () => {
  const p = fixture(); p.title = '<img src=x onerror=alert(1)>';
  p.publication.edition = '초판'; p.publication.history = [{ id: 'record', edition: '초판', distributionStatus: 'submitted', isbnStatus: 'requested', depositStatus: 'pending', recordedAt: '2026-10-20T00:00:00Z', fingerprint: 'old', review: {}, note: '기존 기록' }];
  const before = JSON.stringify(p), win = new Window();
  try {
    win.document.body.innerHTML = renderPublicationPanel(p);
    assert.equal(JSON.stringify(p), before);
    assert.match(win.document.querySelector('[data-publication-history]').textContent, /기존 기록/);
    assert.equal(win.document.querySelectorAll('script, img').length, 0);
  } finally { await win.happyDOM.close(); }
});
