import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { normalizePublication, validatePublication, isValidISBN, publicationFingerprint, publicationReadiness, preparePublicationProject, buildPublicationPackage, publicationFieldMap, recordPublicationVersion } from './dist/publication.js';
import { renderPublicationPanel, mountPublicationPanel } from './dist/publication-ui.js';

const fixture = extra => ({ id: 'publication-fixture', title: '출판할 책', author: '홍길동', description: '처음 만드는 책', language: 'ko', theme: 'sage', updatedAt: '2026-10-19T00:00:00Z', chapters: [{ id: 'one', title: '첫 장', content: '# 시작\n\n**완성된** 본문입니다.' }], ...extra });
const metadata = extra => normalizePublication({ channel: 'domestic', publisher: '작은 출판사', publicationDate: '2026-10-20', price: '5000', rightsHolder: '홍길동', aiDisclosure: 'none', ...extra });
const check = (report, id) => report.checks.find(item => item.id === id);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function unzipStored(bytes) {
  const files = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    assert.equal(view.getUint16(at + 8, true), 0, 'archive entries are uncompressed');
    const size = view.getUint32(at + 18, true), nameSize = view.getUint16(at + 26, true), extraSize = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameSize)), start = at + 30 + nameSize + extraSize;
    files.set(name, bytes.slice(start, start + size)); at = start + size;
  }
  return files;
}

test('publication metadata rejects malformed backups and validates ISBN checksums', () => {
  assert.equal(validatePublication(undefined), undefined);
  for (const value of [null, [], { channel: 'invalid' }, { price: 5000 }, { rightsConfirmed: 'yes' }, { publisher: 'x'.repeat(201) }]) assert.throws(() => validatePublication(value));
  assert.equal(normalizePublication({ publisher: '  출판사  ' }).publisher, '출판사');
  assert.ok(isValidISBN('978-0-306-40615-7'));
  for (const isbn of ['9780306406158', '1234567890123', '0306406152', '']) assert.equal(isValidISBN(isbn), false);
});

test('readiness distinguishes local checks, human review and unperformed external steps', () => {
  const p = fixture(), m = metadata({ isbn: '9780306406157', rightsConfirmed: true, proofreadConfirmed: true, deviceReviewConfirmed: true, reviewFingerprint: publicationFingerprint(p) });
  m.reviewFingerprint = publicationFingerprint(p, m);
  let report = publicationReadiness(p, m);
  assert.equal(report.blockers, 0); assert.equal(report.certification, 'not-run'); assert.equal(report.submitted, false);
  assert.equal(check(report, 'rights').state, 'pass'); assert.equal(check(report, 'epubcheck').state, 'external');
  p.chapters[0].content += '\n변경한 문장';
  report = publicationReadiness(p, m);
  assert.equal(report.staleReview, true);
  for (const id of ['rights', 'proofread', 'devices']) assert.equal(check(report, id).state, 'warning');
  assert.equal(check(publicationReadiness(fixture(), metadata({ publicationDate: '2026-02-30' })), 'publisher').state, 'warning');
});

test('readiness blocks missing content, unresolved figures, invalid ISBN and unsupported KDP Korean', () => {
  assert.equal(check(publicationReadiness(fixture({ chapters: [] })), 'manuscript').state, 'block');
  assert.equal(check(publicationReadiness(fixture({ chapters: [{ title: '장', content: '![그림](folio-asset:missing)' }] })), 'figures').state, 'block');
  assert.equal(check(publicationReadiness(fixture(), metadata({ isbn: '9780306406158' })), 'isbn').state, 'block');
  assert.equal(check(publicationReadiness(fixture(), metadata({ channel: 'kdp' })), 'language').state, 'block');
  assert.equal(check(publicationReadiness(fixture({ language: 'en' }), metadata({ channel: 'kdp' })), 'language').state, 'external');
});

test('preparation clones the manuscript and inserts exactly one updated colophon', () => {
  const original = fixture(), before = JSON.stringify(original);
  const prepared = preparePublicationProject(original, metadata());
  assert.equal(JSON.stringify(original), before);
  assert.equal(prepared.chapters.length, 2);
  assert.match(prepared.chapters[1].content, /발행처: 작은 출판사/);
  assert.match(prepared.chapters[1].content, /정가: 5000 KRW/);
  const revised = preparePublicationProject(prepared, metadata({ price: '7000' }));
  assert.equal(revised.chapters.length, 2); assert.match(revised.chapters[1].content, /7000 KRW/);
});

test('publication ZIP packages complete local outputs without claiming submission or certification', async () => {
  const p = fixture(), before = JSON.stringify(p), result = await buildPublicationPackage(p, metadata());
  assert.equal(JSON.stringify(p), before);
  const files = unzipStored(result.bytes), text = name => new TextDecoder().decode(files.get(name));
  assert.equal(files.size, 14); assert.deepEqual([...files.keys()], result.files);
  assert.equal(new TextDecoder().decode(unzipStored(files.get('book.epub')).get('mimetype')), 'application/epub+zip');
  assert.match(text('book.html'), /folio-book-reader/); assert.match(text('book.html'), /<script/);
  assert.ok(!text('print.html').includes('<script')); assert.match(text('manuscript.md'), /판권 정보/);
  assert.equal(JSON.parse(text('metadata.json')).publisher, '작은 출판사');
  const report = JSON.parse(text('checklist.json'));
  assert.equal(report.certification, 'not-run'); assert.equal(report.submitted, false);
  assert.match(text('validate-epub.ps1'), /--json.*--failonwarnings/);
  assert.match(text('validate-epub.sh'), /--json.*--failonwarnings/);
  assert.match(text('PUBLISHING-GUIDE.md'), /EPUBCheck/);
  await assert.rejects(buildPublicationPackage(fixture({ author: '' }), metadata()), /필수 수정/);
});

test('open publication panel clears stale review flags before saving or exporting and requires rechecking', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  const p = fixture(); p.publication = metadata({ rightsConfirmed: true, proofreadConfirmed: true, deviceReviewConfirmed: true, reviewFingerprint: publicationFingerprint(p) });
  p.publication.reviewFingerprint = publicationFingerprint(p);
  win.document.body.innerHTML = renderPublicationPanel(p);
  const downloads = [], panel = win.document.querySelector('.publication-panel');
  const mounted = mountPublicationPanel(panel, { getProject: () => p, onSave: value => { p.publication = value; }, download: (...args) => downloads.push(args) });
  try {
    assert.equal(panel.querySelector('[name="rightsConfirmed"]').checked, true);
    p.chapters[0].content += '\n\n검토 뒤 바뀐 내용';
    panel.querySelector('[data-publication-action="guide"]').click();
    await settle();
    assert.equal(downloads.length, 0, 'the first stale action explains invalidated review');
    for (const name of ['rightsConfirmed', 'proofreadConfirmed', 'deviceReviewConfirmed']) {
      assert.equal(panel.querySelector(`[name="${name}"]`).checked, false); assert.equal(p.publication[name], false);
    }
    assert.match(panel.querySelector('.publication-message').textContent, /다시 검토/);
    const title = panel.querySelector('[name="publisher"]'); title.value = '수정 출판사'; title.dispatchEvent(new win.Event('change', { bubbles: true }));
    await settle();
    assert.equal(p.publication.rightsConfirmed, false, 'an unrelated edit cannot restore review flags');
    const checkbox = panel.querySelector('[name="rightsConfirmed"]'); checkbox.checked = true; checkbox.dispatchEvent(new win.Event('change', { bubbles: true }));
    await settle();
    assert.equal(p.publication.rightsConfirmed, true); assert.equal(p.publication.proofreadConfirmed, false);
    assert.equal(p.publication.reviewFingerprint, publicationFingerprint(p));
    panel.querySelector('[data-publication-action="guide"]').click();
    await settle();
    assert.equal(downloads.length, 1); assert.equal(downloads[0][1], 'folio-publishing-guide.md');
    mounted.dispose(); title.value = '저장하지 않음'; title.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(p.publication.publisher, '수정 출판사');
  } finally { mounted.dispose(); await win.happyDOM.close(); }
});

test('publication typing persists before blur and dispose removes input autosave', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
  const p = fixture(), snapshots = [];
  win.document.body.innerHTML = renderPublicationPanel(p);
  const panel = win.document.querySelector('.publication-panel');
  const mounted = mountPublicationPanel(panel, { getProject: () => p, onSave: value => {
    p.publication = value;
    snapshots.push(JSON.stringify(p));
  } });
  try {
    const publisher = panel.querySelector('[name="publisher"]');
    publisher.focus(); publisher.value = '입력 중인 출판사';
    publisher.setSelectionRange(3, 3);
    publisher.dispatchEvent(new win.Event('input', { bubbles: true }));
    await settle();
    assert.equal(p.publication.publisher, '입력 중인 출판사');
    assert.equal(win.document.activeElement === publisher, true, 'autosave must retain focus');
    assert.equal(publisher.selectionStart, 3, 'autosave must retain the caret');
    const biography = panel.querySelector('[name="authorBio"]');
    biography.focus(); biography.value = '저자 소개를 쓰는 중입니다.\n포커스를 옮기기 전에 저장합니다.';
    biography.dispatchEvent(new win.Event('input', { bubbles: true }));
    await settle();
    assert.equal(win.document.activeElement === biography, true);
    assert.equal(snapshots.length, 2, 'input events must save without waiting for change or blur');
    const restored = JSON.parse(snapshots.at(-1));
    assert.equal(restored.publication.publisher, publisher.value);
    assert.equal(restored.publication.authorBio, biography.value, 'the latest typed text must survive serialization');
    mounted.dispose();
    biography.value = '해제 후 입력';
    biography.dispatchEvent(new win.Event('input', { bubbles: true }));
    biography.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(snapshots.length, 2, 'disposed panels must not save either input or change events');
    assert.equal(p.publication.authorBio, restored.publication.authorBio);
  } finally { mounted.dispose(); await win.happyDOM.close(); }
});

test('publication form escapes metadata and renders old acknowledgements unchecked', async () => {
  const win = new Window();
  try {
    win.document.body.innerHTML = renderPublicationPanel(fixture({ publication: metadata({ publisher: '\"><img src=x onerror=alert(1)>', rightsStatement: '</textarea><script>alert(1)</script>', rightsConfirmed: true, reviewFingerprint: 'old' }) }));
    assert.equal(win.document.querySelectorAll('script,img').length, 0);
    assert.equal(win.document.querySelector('[name="rightsConfirmed"]').checked, false);
    assert.match(win.document.querySelector('.publication-warning').textContent, /変|바뀌/);
  } finally { await win.happyDOM.close(); }
});

test('publication actions stop when metadata cannot be saved', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
  const p = fixture(), downloads = [], notices = [];
  win.document.body.innerHTML = renderPublicationPanel(p);
  const panel = win.document.querySelector('.publication-panel');
  const mounted = mountPublicationPanel(panel, { getProject: () => p, onSave: () => { throw new Error('저장 충돌로 작업을 중지했습니다.'); }, download: (...args) => downloads.push(args), onNotify: (...args) => notices.push(args) });
  try {
    for (const action of ['guide', 'package']) {
      panel.querySelector('[data-publication-action="' + action + '"]').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(downloads.length, 0);
      assert.match(panel.querySelector('.publication-message').textContent, /저장 충돌/);
      assert.equal(panel.querySelector('[data-publication-action="package"]').disabled, false);
    }
    assert.equal(p.publication, undefined);
    assert.equal(notices.length, 2);
    assert.ok(notices.every(item => item[1] === true));
  } finally { mounted.dispose(); await win.happyDOM.close(); }
});


test('channel mapping blocks missing domestic colophon fields without treating all vendor rules as universal', () => {
  const p=fixture(), m=metadata({publisher:'',publicationDate:'',price:''});
  const map=publicationFieldMap(p,m);
  assert.equal(map.schema,'manual-entry-map');
  for(const key of ['publisher','publicationDate','price']) { assert.equal(map.fields.find(f=>f.key===key).required,true); assert.equal(check(publicationReadiness(p,m),'field-'+key).state,'block'); }
  const direct=publicationFieldMap(p,{...m,channel:'direct'});
  assert.equal(direct.fields.find(f=>f.key==='publisher').required,false);
  assert.equal(publicationFieldMap(p,{...m,channel:'kdp'}).fields.find(f=>f.key==='isbn').required,false);
});
test('edition history is snapshot bound, preserves manual states and rejects corrupt imported records', () => {
  const p=fixture(),m=metadata({edition:'초판 1.0',distributionStatus:'submitted',isbnStatus:'requested',depositStatus:'pending',workflowOwner:'유통 담당',submissionDate:'2026-10-20',recordNote:'접수 내역 확인',referenceUrl:'https://example.com/submission',rightsConfirmed:true});
  m.reviewFingerprint=publicationFingerprint(p,m);
  const recorded=recordPublicationVersion(p,m,new Date('2026-10-20T00:00:00Z'));
  assert.equal(recorded.history.length,1); assert.equal(m.history.length,0);
  assert.equal(recorded.history[0].review.rightsConfirmed,true); assert.equal(recorded.history[0].submissionDate,'2026-10-20');
  assert.equal(publicationFingerprint(p,recorded),m.reviewFingerprint,'adding history does not invalidate reviews');
  assert.equal(publicationFingerprint(p,{...recorded,distributionStatus:'live'}),m.reviewFingerprint,'external state is not book content');
  assert.notEqual(publicationFingerprint(p,{...recorded,price:'9000'}),m.reviewFingerprint,'changing colophon price invalidates reviews');
  const revised=recordPublicationVersion({...p,title:'개정 제목'},recorded,new Date('2026-10-21T00:00:00Z'));
  assert.equal(revised.history[1].review.rightsConfirmed,false);
  assert.equal(validatePublication(JSON.parse(JSON.stringify(revised))).history.length,2);
  let many=recorded;
  for(let i=0;i<103;i++) many=recordPublicationVersion(p,many,new Date(1792454400000+i*1000));
  assert.equal(many.history.length,100);
  for(const bad of [{...m,history:new Array(101).fill(recorded.history[0])},{...m,history:[{...recorded.history[0],referenceUrl:'javascript:alert(1)'}]},{...m,history:[{...recorded.history[0],review:{rightsConfirmed:'yes'}}]},{...m,history:[{...recorded.history[0],recordedAt:'bad'}]},{...m,distributionStatus:'fake'},{...m,coverWidth:99999}]) assert.throws(()=>validatePublication(bad));
  assert.throws(()=>recordPublicationVersion(p,metadata()),/판본/);
  assert.throws(()=>recordPublicationVersion(p,{...m,isbnStatus:'issued',isbn:''}),/ISBN/);
});
test('publication panel records history and retains it while later metadata changes invalidate review', async()=>{
  const win=new Window({settings:{disableJavaScriptEvaluation:true}}),p=fixture(); p.publication=metadata({edition:'초판',rightsConfirmed:true}); p.publication.reviewFingerprint=publicationFingerprint(p);
  win.document.body.innerHTML=renderPublicationPanel(p); const panel=win.document.querySelector('.publication-panel');
  const mounted=mountPublicationPanel(panel,{getProject:()=>p,onSave:m=>p.publication=m});
  try {
    panel.querySelector('[data-publication-action="record"]').click(); await new Promise(r=>setTimeout(r,0));
    assert.equal(p.publication.history.length,1,panel.querySelector('.publication-message').textContent); assert.equal(p.publication.history[0].review.rightsConfirmed,true);
    const price=panel.querySelector('[name="price"]'); price.value='7000'; price.dispatchEvent(new win.Event('input',{bubbles:true})); await settle();
    assert.equal(p.publication.rightsConfirmed,false); assert.equal(p.publication.history.length,1); assert.match(panel.querySelector('[data-publication-history]').textContent,/이전 내용/);
    const check=panel.querySelector('[name="rightsConfirmed"]');check.checked=true;check.dispatchEvent(new win.Event('change',{bubbles:true})); await settle();
    assert.equal(p.publication.rightsConfirmed,true);assert.equal(p.publication.reviewFingerprint,publicationFingerprint(p));
    assert.equal(validatePublication(JSON.parse(JSON.stringify(p.publication))).history.length,1);
  }finally{mounted.dispose();await win.happyDOM.close();}
});

test('shared source edits expire all publication acknowledgements', () => {
  const p = fixture({ sharedReviewSources: [{ id: 'production:source.md', name: 'source.md', content: '효과는 30%입니다.' }] });
  p.publication = metadata({ rightsConfirmed: true, proofreadConfirmed: true, deviceReviewConfirmed: true });
  p.publication.reviewFingerprint = publicationFingerprint(p);
  assert.equal(publicationReadiness(p).staleReview, false);
  p.sharedReviewSources[0].content = '효과는 3%입니다.';
  const report = publicationReadiness(p);
  assert.equal(report.staleReview, true);
  for (const id of ['rights', 'proofread', 'devices']) assert.equal(check(report, id).state, 'warning');
});

test('publication actions reject async storage errors and false results before exporting or claiming success', async () => {
  for (const failure of ['reject', 'false']) for (const action of ['guide', 'package', 'cover', 'record', 'check']) {
    const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
    const p = fixture({ publication: metadata({ edition: '초판' }) }), downloads = [], notices = [];
    let coverCalls = 0;
    win.document.body.innerHTML = renderPublicationPanel(p);
    const panel = win.document.querySelector('.publication-panel');
    const mounted = mountPublicationPanel(panel, {
      getProject: () => p,
      onSave: async () => { await settle(); if (failure === 'reject') throw new Error('저장 공간이 부족합니다.'); return false; },
      download: (...args) => downloads.push(args), onNotify: (...args) => notices.push(args),
      makeCover: async () => { ++coverCalls; throw new Error('저장 실패 후 표지를 만들면 안 됩니다.'); }
    });
    try {
      panel.querySelector(`[data-publication-action="${action}"]`).click();
      assert.match(panel.querySelector('.publication-message').textContent, /저장.*확인/);
      assert.equal(panel.querySelector('[data-publication-action="package"]').disabled, true);
      await settle(); await settle();
      assert.equal(downloads.length, 0, `${action}/${failure} must not download`);
      assert.equal(coverCalls, 0);
      assert.match(panel.querySelector('.publication-message').textContent, /저장.*(?:부족|못했습니다)/);
      assert.equal(notices.length, 1); assert.equal(notices[0][1], true);
      assert.equal(panel.querySelector('[data-publication-action="package"]').disabled, false);
      assert.equal(p.publication.history.length, 0);
    } finally { mounted.dispose(); await win.happyDOM.close(); }
  }
});

test('publication exports wait for storage completion and ignore duplicate clicks', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
  const p = fixture({ publication: metadata() }), downloads = [];
  let complete, saves = 0;
  win.document.body.innerHTML = renderPublicationPanel(p);
  const panel = win.document.querySelector('.publication-panel');
  const mounted = mountPublicationPanel(panel, { getProject: () => p, onSave: value => {
    ++saves;
    return new Promise(resolve => { complete = () => { p.publication = value; resolve(true); }; });
  }, download: (...args) => downloads.push(args) });
  try {
    const button = panel.querySelector('[data-publication-action="guide"]'); button.click(); button.click();
    await settle(); assert.equal(saves, 1); assert.equal(downloads.length, 0);
    assert.doesNotMatch(panel.querySelector('.publication-message').textContent, /준비했습니다/);
    complete(); await settle();
    assert.equal(downloads.length, 1); assert.equal(downloads[0][1], 'folio-publishing-guide.md');
    assert.equal(button.disabled, false);
  } finally { mounted.dispose(); await win.happyDOM.close(); }
});

test('publication autosaves serialize rapid edits before a requested export', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
  const p = fixture({ publication: metadata() }), pending = [], saved = [], downloads = [];
  win.document.body.innerHTML = renderPublicationPanel(p);
  const panel = win.document.querySelector('.publication-panel');
  const mounted = mountPublicationPanel(panel, { getProject: () => p, onSave: value => new Promise(resolve => {
    pending.push(() => { p.publication = value; saved.push(value.publisher); resolve(true); });
  }), download: (...args) => downloads.push(args) });
  try {
    const publisher = panel.querySelector('[name="publisher"]');
    publisher.value = '첫 입력'; publisher.dispatchEvent(new win.Event('input', { bubbles: true }));
    publisher.value = '최종 입력'; publisher.dispatchEvent(new win.Event('input', { bubbles: true }));
    panel.querySelector('[data-publication-action="guide"]').click();
    assert.equal(pending.length, 1, 'only one write may be active');
    assert.equal(downloads.length, 0);
    pending.shift()(); await settle(); assert.deepEqual(saved, ['첫 입력']); assert.equal(pending.length, 1);
    pending.shift()(); await settle(); assert.deepEqual(saved, ['첫 입력', '최종 입력']); assert.equal(pending.length, 1);
    pending.shift()(); await settle();
    assert.equal(p.publication.publisher, '최종 입력'); assert.equal(downloads.length, 1);
    assert.deepEqual(saved, ['첫 입력', '최종 입력', '최종 입력']);
    assert.equal(downloads[0][1], 'folio-publishing-guide.md');
  } finally { mounted.dispose(); await win.happyDOM.close(); }
});

test('publication pending saves cannot download or update a disposed panel', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
  const p = fixture({ publication: metadata() }), downloads = [], notices = [];
  let complete;
  win.document.body.innerHTML = renderPublicationPanel(p);
  const panel = win.document.querySelector('.publication-panel');
  const mounted = mountPublicationPanel(panel, { getProject: () => p, onSave: value => new Promise(resolve => {
    complete = () => { p.publication = value; resolve(true); };
  }), download: (...args) => downloads.push(args), onNotify: (...args) => notices.push(args) });
  try {
    panel.querySelector('[data-publication-action="guide"]').click();
    const message = panel.querySelector('.publication-message').textContent;
    mounted.dispose(); complete(); await settle();
    assert.equal(downloads.length, 0); assert.equal(notices.length, 0);
    assert.equal(panel.querySelector('.publication-message').textContent, message);
  } finally { mounted.dispose(); await win.happyDOM.close(); }
});

test('publication history reports failure when its second asynchronous save fails', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
  const p = fixture({ publication: metadata({ edition: '초판' }) }), notices = [];
  let saves = 0;
  win.document.body.innerHTML = renderPublicationPanel(p);
  const panel = win.document.querySelector('.publication-panel');
  const mounted = mountPublicationPanel(panel, { getProject: () => p, onSave: async value => {
    await settle(); if (++saves === 2) return false; p.publication = value; return true;
  }, onNotify: (...args) => notices.push(args) });
  try {
    panel.querySelector('[data-publication-action="record"]').click();
    await settle(); await settle(); await settle();
    assert.equal(saves, 2); assert.equal(p.publication.history.length, 0);
    assert.match(panel.querySelector('.publication-message').textContent, /저장하지 못했습니다/);
    assert.equal(notices.length, 1); assert.equal(notices[0][1], true);
    assert.doesNotMatch(panel.querySelector('[data-publication-history]').textContent, /현재 판본과 일치/);
  } finally { mounted.dispose(); await win.happyDOM.close(); }
});

test('publication typing does not announce save success after an asynchronous storage failure', async () => {
  const win = new Window({ settings: { disableJavaScriptEvaluation: true } });
  const p = fixture({ publication: metadata() }), notices = [];
  let fail;
  win.document.body.innerHTML = renderPublicationPanel(p);
  const panel = win.document.querySelector('.publication-panel');
  const mounted = mountPublicationPanel(panel, { getProject: () => p, onSave: () => new Promise((resolve, reject) => {
    fail = () => reject(new Error('저장 공간이 부족합니다.'));
  }), onNotify: (...args) => notices.push(args) });
  try {
    const publisher = panel.querySelector('[name="publisher"]');
    publisher.value = '수정한 출판사'; publisher.dispatchEvent(new win.Event('input', { bubbles: true }));
    await settle();
    assert.match(panel.querySelector('.publication-message').textContent, /저장하고 있습니다/);
    fail(); await settle();
    assert.match(panel.querySelector('.publication-message').textContent, /저장 공간이 부족/);
    assert.equal(notices.length, 1); assert.equal(notices[0][1], true);
    assert.equal(p.publication.publisher, '작은 출판사');
  } finally { mounted.dispose(); await win.happyDOM.close(); }
});
