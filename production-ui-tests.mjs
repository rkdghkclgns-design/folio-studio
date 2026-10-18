import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {renderProductionForm,renderProductionSummary,renderProductionCard} from './dist/production-ui.js';

function documentFor(html) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}
function fixture(overrides = {}) {
  return {title:'작은 정원',author:'강예림',chapters:[{title:'씨앗',content:''},{title:'싹',content:''}],production:{brief:{topic:'첫 텃밭',author:'강예림',sourceMarkdown:'# 메모\n자료는 그대로.',sourceName:'정원.md',instructions:'자료에 없는 경험은 만들지 마세요.',targetUnit:'chars',targetValue:30000,chapterCount:0,illustrations:'design',language:'ko'},targetChars:30000,status:'ready',...overrides}};
}

test('production brief saves before API work and labels every editable input', () => {
  const doc = documentFor(renderProductionForm());
  const form = doc.querySelector('#production-form');
  assert.equal(form.querySelector('[type=submit]').textContent,'제작 조건 저장');
  assert.equal(form.querySelector('[data-action=production-start]'),null);
  for (const input of form.querySelectorAll('input,textarea,select')) {
    assert.ok(input.id, input.outerHTML);
    assert.ok(doc.querySelector(`label[for="${input.id}"]`),input.id);
  }
  assert.equal(form.querySelector('[name=topic]').required,false,'source-only books are validated when the conditions are saved');
  assert.equal(form.querySelector('[name=author]').required,true);
  assert.equal(form.querySelector('[name=title]').required,false);
  assert.equal(form.querySelector('[name=sourceMarkdown]').maxLength,120000);
  assert.equal(form.querySelector('[name=targetValue]').value,'30000');
  assert.equal(form.querySelector('[name=illustrations]').value,'design');
  assert.equal(doc.querySelector('#production-source-name').getAttribute('aria-live'),'polite');
  assert.equal(doc.querySelector('#production-feedback').getAttribute('role'),'alert');
  assert.match(doc.body.textContent,/다음 화면에서 제작 시작을 눌러야/);
});

test('page targets disclose conversion and actual pagination limits', () => {
  const doc = documentFor(renderProductionForm({targetUnit:'pages'}));
  assert.equal(doc.querySelector('[name=targetUnit]').value,'pages');
  assert.equal(doc.querySelector('[name=targetValue]').value,'40');
  assert.equal(doc.querySelector('[name=targetValue]').min,'4');
  assert.equal(doc.querySelector('[name=targetValue]').max,'375');
  assert.match(doc.querySelector('#production-target-estimate').textContent,/32,000자/);
  assert.match(doc.body.textContent,/±10%/);
  assert.match(doc.body.textContent,/실제 쪽수가 달라집니다/);
});

test('source and instructions remain literal text when they contain HTML or closing textareas', () => {
  const source = '# 원시 소스\n</textarea><img src="https://attacker.invalid" onerror="x()">\n<script>x()</script> & "quotes"';
  const draft = {sourceMarkdown:source,sourceName:'"><img src=x>',topic:'<svg onload=x()>',title:'" autofocus onfocus="x()',instructions:'</textarea><script>x()</script>'};
  const doc = documentFor(renderProductionForm(draft));
  assert.equal(doc.querySelector('[name=sourceMarkdown]').value,source);
  assert.equal(doc.querySelector('[name=instructions]').value,draft.instructions);
  assert.equal(doc.querySelector('[name=title]').value,draft.title);
  assert.equal(doc.querySelector('img,script,svg,[onerror],[onfocus],[autofocus]'),null);
  const p = fixture();Object.assign(p.production.brief,draft);
  const summary = documentFor(renderProductionSummary(p,{configured:true,minRequests:16,maxRequests:30}));
  assert.equal(summary.querySelector('.production-source-preview').textContent,source);
  assert.equal(summary.querySelector('img,script,svg,[onerror],[onfocus]'),null);
});

test('review estimates requests and requires a configured provider before presenting start', () => {
  const p = fixture();
  const original = structuredClone(p);
  const doc = documentFor(renderProductionSummary(p,{status:'ready',configured:false,totalChapters:5,minRequests:17,maxRequests:32}));
  assert.equal(doc.querySelector('[data-action=production-start]'),null);
  assert.ok(doc.querySelector('[data-action=settings][data-production-return=true]'));
  assert.ok(doc.querySelector('[data-action=production-edit]'));
  assert.ok(doc.querySelector('[data-action=production-source-download]'));
  assert.match(doc.body.textContent,/집필·자료 분석 약 17~32회/);
  assert.match(doc.body.textContent,/API 비용/);
  const connected = documentFor(renderProductionSummary(p,{configured:true}));
  assert.ok(connected.querySelector('[data-action=production-start]'));
  assert.deepEqual(p,original,'rendering must not change the saved brief');
});

test('completed text with unfinished paid illustrations remains resumable and visible', () => {
  const p = fixture({status:'complete',artwork:{status:'failed',completed:['cover'],error:'이미지 권한을 확인해 주세요.'}});
  p.production.brief.illustrations='ai';
  const progress = {status:'complete',configured:true,percent:100,actualChars:29900,completedChapters:5,totalChapters:5};
  const doc = documentFor(renderProductionSummary(p,progress));
  assert.equal(doc.querySelector('[data-action=production-start]').textContent,'남은 삽화 제작');
  assert.match(doc.querySelector('.production-artwork-status').textContent,/1 \/ 3개 배치/);
  assert.match(doc.querySelector('.production-artwork-status').textContent,/이미지 권한/);
  const card = documentFor(renderProductionCard(p,progress));
  assert.equal(card.querySelector('[data-action=production-summary]').textContent,'남은 삽화 확인');
  p.production.artwork.status='complete';
  assert.equal(documentFor(renderProductionSummary(p,progress)).querySelector('[data-action=production-start]'),null);
});

test('integrity problems suppress all retry and start actions while retaining the manuscript path', () => {
  const p = fixture({status:'needs_review',artwork:{status:'failed',completed:[]}});
  const progress = {status:'needs_review',canRetry:true,canResume:true,configured:true,integrityError:'원고가 변경되었습니다.',message:'원고가 변경되었습니다.'};
  const doc = documentFor(renderProductionSummary(p,progress));
  assert.equal(doc.querySelector('[data-action=production-start],[data-action=production-retry]'),null);
  assert.ok(doc.querySelector('[data-action=close-modal]'));
  assert.ok(doc.querySelector('[data-action=production-copy-config]'));
  assert.match(doc.body.textContent,/원고가 변경되었습니다/);
  assert.equal(documentFor(renderProductionCard(p,progress)).querySelector('[data-action=production-retry]'),null);
});

test('review-required progress distinguishes actual length and exposes only explicit rework', () => {
  const p = fixture({status:'needs_review',artwork:{status:'complete',completed:['chapter:0','chapter:2']}});
  const progress = {status:'needs_review',canRetry:true,configured:true,percent:120,actualChars:14000,completedChapters:3,totalChapters:5,message:'목표와 분량 차이가 있습니다.'};
  const doc = documentFor(renderProductionSummary(p,progress));
  assert.equal(doc.querySelector('progress').value,100);
  assert.match(doc.querySelector('.production-metrics').textContent,/30,000/);
  assert.match(doc.querySelector('.production-metrics').textContent,/14,000/);
  assert.ok(doc.querySelector('[data-action=production-retry]'));
  assert.equal(doc.querySelector('[data-action=production-start]'),null);
  assert.equal(doc.querySelector('.production-status-badge').textContent,'검토 필요');
  assert.equal(renderProductionCard({title:'일반 책'},{}),'');
});

test('paused progress can resume but errors cannot add markup or unbounded text', () => {
  const p = fixture({status:'paused'});
  const doc = documentFor(renderProductionSummary(p,{status:'paused',configured:true,canResume:true,error:'<script>x()</script>'+ 'x'.repeat(3000),percent:NaN}));
  assert.equal(doc.querySelector('[data-action=production-start]').textContent,'이어서 제작');
  assert.equal(doc.querySelector('progress').value,0);
  assert.equal(doc.querySelector('script'),null);
  assert.equal(doc.querySelector('.production-feedback').textContent.length,1800);
});
