import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { VISUAL_WORKFLOW, createVisualBrief, visualChapterHash, visualProgress, planVisualImport, applyVisualImport, renderVisualInstructions } from './dist/visual-workflow.js';
import { renderProductionForm } from './dist/production-ui.js';
import { normalizeProductionBrief } from './dist/production.js';
import { serializeMediaClipboard, parseMediaClipboard } from './dist/book-editor.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300"><title>기획 검증</title><text x="30" y="50" font-size="24">가설 → 실험</text></svg>');
const clone = value => structuredClone(value);
function project() { return { id: 'book-id', title: '게임기획과 AI', author: '작가', coverImage: { src: PNG, alt: '기존 표지' }, bookMatter: { preface: { id: 'start', title: '시작말', content: '시작 문장' }, afterword: { id: 'end', title: '맺음말', content: '끝 문장' } }, chapters: [{ id: 'chapter-1', title: '기획의 정의', content: '첫째 문단.\n\n둘째 문단.', image: { src: PNG, alt: '기존 삽화' } }, { id: 'chapter-2', title: '협업 시나리오', content: '상황의 설명.' }] }; }
function image(kind='diagram', id='visual-1') { return { id, src: kind==='diagram'?SVG:PNG, alt: '가설과 실험의 연결', caption: '기획 검증 예시', provenance: { provider: kind==='diagram'?'claude-svg':'codex-imagegen', createdAt: '2026-10-21T00:00:00.000Z', prompt: '장 내용을 설명하는 예시' } }; }
async function bundle(p, pairs=[[0,'diagram']]) { return { format:'folio-visual-assets',version:1,book:{title:p.title,author:p.author},assets:await Promise.all(pairs.map(async([index,kind])=>({chapterId:p.chapters[index].id,chapterTitle:p.chapters[index].title,chapterHash:await visualChapterHash(p.chapters[index]),kind,figure:image(kind,'visual-'+(index+1))}))) }; }

test('visual brief binds exact manuscript, chapter identities and included-tool routing without mutating book', async () => {
  const p=project(),before=JSON.stringify(p),brief=await createVisualBrief(p);
  assert.equal(brief.format,'folio-visual-brief');
  assert.deepEqual(brief.workflow,VISUAL_WORKFLOW);
  assert.equal(brief.workflow.diagrams,'claude-svg');assert.equal(brief.workflow.illustrations,'codex-imagegen');assert.equal(brief.workflow.paidFallback,false);
  assert.equal(brief.chapters[0].chapterId,p.chapters[0].id);assert.equal(brief.chapters[0].content,p.chapters[0].content);
  assert.equal(brief.chapters[0].chapterHash,await visualChapterHash(p.chapters[0]));
  assert.equal(JSON.stringify(p),before);
});

test('new production forms choose hybrid visuals and defer diagram creation while retaining older explicit choices', t => {
  const win=new Window();t.after(()=>win.close());win.document.body.innerHTML=renderProductionForm();
  assert.equal(win.document.querySelector('[name=illustrations]').value,'hybrid');
  assert.equal(win.document.querySelector('[name=diagrams]').value,'none');
  const brief=normalizeProductionBrief({topic:'게임 기획',illustrations:'hybrid',diagrams:'none'});
  assert.equal(brief.illustrations,'hybrid');assert.equal(brief.diagrams,'none');
  for(const prior of ['design','ai','none']){const saved=new Window();t.after(()=>saved.close());saved.document.body.innerHTML=renderProductionForm({illustrations:prior});assert.equal(saved.document.querySelector('[name=illustrations] option[selected]').value,prior);}
});

test('visual application preserves text bytes, cover, existing art and book matter while adding each figure once', async () => {
  const p=project(),before=JSON.stringify(p),incoming=await bundle(p,[[0,'diagram'],[1,'illustration']]);
  const plan=await planVisualImport(p,incoming),next=applyVisualImport(p,plan);
  assert.equal(plan.added,2);assert.equal(plan.skipped,0);assert.equal(JSON.stringify(p),before);
  assert.deepEqual(next.coverImage,p.coverImage);assert.deepEqual(next.bookMatter,p.bookMatter);assert.deepEqual(next.chapters[0].image,p.chapters[0].image);
  for(let i=0;i<2;i++){assert.equal(next.chapters[i].content.slice(0,p.chapters[i].content.length),p.chapters[i].content);assert.equal(next.chapters[i].figures.length,1);assert.equal(next.chapters[i].figures[0].id,'visual-'+(i+1));}
  assert.deepEqual(visualProgress(next),{diagrams:1,illustrations:1,chapters:2,total:2});
  const again=await planVisualImport(next,incoming);assert.equal(again.added,0);assert.equal(again.skipped,2);assert.deepEqual(applyVisualImport(next,again),next);
});

test('changed manuscript before planning and changed book after review refuse all mutations', async () => {
  const p=project(),incoming=await bundle(p);p.chapters[0].content+=' 새 문장.';const before=JSON.stringify(p);
  await assert.rejects(()=>planVisualImport(p,incoming),/바뀌었습니다/);assert.equal(JSON.stringify(p),before);
  const fresh=project(),plan=await planVisualImport(fresh,await bundle(fresh));fresh.author='다른 저자';const changed=JSON.stringify(fresh);
  assert.throws(()=>applyVisualImport(fresh,plan),/바뀌었습니다/);assert.equal(JSON.stringify(fresh),changed);
});

test('chapter-id remapping uses only an unambiguous exact title and unchanged manuscript hash', async () => {
  const p=project(),incoming=await bundle(p);incoming.assets[0].chapterId='old-id';const plan=await planVisualImport(p,incoming);assert.equal(plan.items[0].chapterId,p.chapters[0].id);
  p.chapters.push({...p.chapters[0],id:'duplicate-title'});await assert.rejects(()=>planVisualImport(p,incoming),/대상 장/);
  const wrong=project();incoming.assets[0].chapterId='chapter-2';await assert.rejects(()=>planVisualImport(wrong,incoming),/대상 장/);
});

test('corrupt book, asset and duplicate mappings fail before creating an application plan', async () => {
  const p=project(),good=await bundle(p,[[0,'diagram'],[1,'illustration']]);
  for(const alter of [x=>{x.version=2;},x=>{x.assets=[];},x=>{x.book.title='다른 책';},x=>{x.book.author='다른 저자';},x=>{x.assets[0].chapterHash='invalid';},x=>{x.assets[0].kind='script';},x=>{x.assets[0].figure.provenance.provider='openai-api';},x=>{delete x.assets[0].figure.provenance;},x=>{x.assets[1].figure.id=x.assets[0].figure.id;},x=>{x.assets.push(clone(x.assets[0]));}]) {
    const bad=clone(good),before=JSON.stringify(p);alter(bad);await assert.rejects(()=>planVisualImport(p,bad));assert.equal(JSON.stringify(p),before);
  }
});

test('provider and visual kind must agree with sanitized actual SVG or raster bytes', async () => {
  const p=project(),incoming=await bundle(p);
  for(const src of [PNG,'https://example.com/diagram.svg','data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')]){const bad=clone(incoming);bad.assets[0].figure.src=src;await assert.rejects(()=>planVisualImport(p,bad));}
  const raster=await bundle(p,[[0,'illustration']]);raster.assets[0].figure.src=SVG;await assert.rejects(()=>planVisualImport(p,raster),/SVG/);
});

test('an existing ID with different bytes or a missing displayed reference never silently replaces artwork', async () => {
  const p=project(),incoming=await bundle(p),next=applyVisualImport(p,await planVisualImport(p,incoming));
  const changed=clone(incoming);changed.assets[0].figure.caption='다른 그림 설명';await assert.rejects(()=>planVisualImport(next,changed),/같은 ID/);
  next.chapters[0].content=p.chapters[0].content;await assert.rejects(()=>planVisualImport(next,incoming),/같은 ID/);
});

test('per-chapter media and text limits are enforced without truncating manuscripts', async () => {
  const p=project();p.chapters[0].figures=Array.from({length:20},(_,i)=>image('diagram','old-'+i));await assert.rejects(()=>bundle(p).then(b=>planVisualImport(p,b)),/20/);
  delete p.chapters[0].figures;p.chapters[0].content='가'.repeat(500000);const before=p.chapters[0].content;await assert.rejects(()=>bundle(p).then(b=>planVisualImport(p,b)),/한도/);assert.equal(p.chapters[0].content,before);
});

test('progress counts displayed figures rather than examples inside fenced code or inline prose', () => {
  const p=project();p.chapters[0].figures=[image()];
  for(const content of ['\x60\x60\x60md\n![예시](folio-asset:visual-1)\n\x60\x60\x60','~~~markdown\n![예시](folio-asset:visual-1)\n~~~','문장 속 ![예시](folio-asset:visual-1) 문자열입니다.']){
    p.chapters[0].content=content;assert.deepEqual(visualProgress(p),{diagrams:0,illustrations:0,chapters:0,total:2});
  }
  p.chapters[0].content='![실제 도표](folio-asset:visual-1)';assert.equal(visualProgress(p).diagrams,1);
});

test('visual instructions escape book titles and disclose handoff without promising automatic subscription calls', t => {
  const p=project();p.title='<img src=x onerror=alert(1)>';const win=new Window();t.after(()=>win.close());win.document.body.innerHTML=renderVisualInstructions(p);
  assert.equal(win.document.querySelector('img'),null);assert.ok(win.document.body.textContent.includes(p.title));assert.match(win.document.body.textContent,/직접 호출하지 않습니다/);assert.match(win.document.body.textContent,/별도 요금 방식/);
  for(const link of win.document.querySelectorAll('a')){assert.equal(link.target,'_blank');assert.ok(link.rel.includes('noopener'));}
});

test('media clipboard roundtrip keeps SVG and raster creation records as bounded data', () => {
  for(const [kind,asset] of [['figure',image()],['figure',image('illustration')],['illustration',image()]]){
    const decoded=parseMediaClipboard(serializeMediaClipboard({kind,image:asset}));assert.deepEqual(decoded.image.provenance,asset.provenance);
  }
  assert.throws(()=>serializeMediaClipboard({kind:'illustration',image:{...image(),provenance:{provider:'fake'}}}),/제작/);
});


test('a manuscript mutation during asynchronous hashing cannot be approved against a later revision', async () => {
  const p=project(),incoming=await bundle(p),original=crypto.subtle.digest;
  let release;const gate=new Promise(resolve=>{release=resolve;});
  crypto.subtle.digest=async function(...args){await gate;return original.apply(this,args);};
  try {
    const pending=planVisualImport(p,incoming);p.chapters[0].content+=' 집필 중 추가 문장';release();
    await assert.rejects(()=>pending,/바뀌|변경/);
  } finally {crypto.subtle.digest=original;release();}
});

test('a brief remains internally consistent if editing occurs while its chapter hashes are computed', async () => {
  const p=project(),original=crypto.subtle.digest;
  let release;const gate=new Promise(resolve=>{release=resolve;});
  crypto.subtle.digest=async function(...args){await gate;return original.apply(this,args);};
  try {
    const pending=createVisualBrief(p);p.chapters[0].content+=' 집필 중 추가 문장';release();
    const result=await Promise.allSettled([pending]);
    if(result[0].status==='rejected')assert.match(result[0].reason.message,/바뀌|변경/);
    else {const chapter=result[0].value.chapters[0];assert.equal(chapter.chapterHash,await visualChapterHash({title:chapter.chapterTitle,content:chapter.content}));}
  } finally {crypto.subtle.digest=original;release();}
});

test('multiple figures in one chapter follow their explanatory paragraphs and keep order at a shared anchor', async () => {
  const p=project(),incoming=await bundle(p);const first=incoming.assets[0];
  first.placement={after:'첫째 문단.'};
  incoming.assets.push({...clone(first),figure:image('diagram','visual-second')});
  incoming.assets.push({...clone(first),placement:{after:'둘째 문단.'},figure:image('diagram','visual-third')});
  const plan=await planVisualImport(p,incoming),next=applyVisualImport(p,plan),text=next.chapters[0].content;
  assert.equal(plan.added,3);assert.equal(next.chapters[0].figures.length,3);
  assert.ok(text.indexOf('첫째 문단.')<text.indexOf('folio-asset:visual-1'));
  assert.ok(text.indexOf('folio-asset:visual-1')<text.indexOf('folio-asset:visual-second'));
  assert.ok(text.indexOf('folio-asset:visual-second')<text.indexOf('둘째 문단.'));
  assert.ok(text.indexOf('둘째 문단.')<text.indexOf('folio-asset:visual-third'));
  const again=await planVisualImport(next,incoming);assert.equal(again.skipped,3);assert.deepEqual(applyVisualImport(next,again),next);
});

test('placement rejects missing, repeated, partial and fenced anchors before changing the book', async () => {
  for(const [content,anchor] of [['첫째 문단.\n\n둘째 문단.','없음'],['반복\n\n반복','반복'],['긴 문단 중간입니다.','문단 중간입니다.'],['도입\n\n```md\n\n코드 문단\n\n```','코드 문단'],['도입\n\n    코드 문단\n\n끝','    코드 문단']]){
    const p=project();p.chapters[0].content=content;const incoming=await bundle(p);incoming.assets[0].placement={after:anchor};
    const before=JSON.stringify(p);await assert.rejects(()=>planVisualImport(p,incoming));assert.equal(JSON.stringify(p),before);
  }
  const p=project();p.chapters[0].content='```\ncode\n```\n\n설명 문단\n\n끝';const incoming=await bundle(p);incoming.assets[0].placement={after:'설명 문단'};
  assert.equal((await planVisualImport(p,incoming)).added,1);
});

test('multiple incoming figures share cumulative per-chapter media and manuscript limits', async () => {
  const p=project();p.chapters[0].figures=Array.from({length:19},(_,i)=>image('diagram','old-'+i));
  const incoming=await bundle(p);incoming.assets.push({...clone(incoming.assets[0]),figure:image('diagram','another')});
  await assert.rejects(()=>planVisualImport(p,incoming),/20/);
  const long=project();long.chapters[0].content='가'.repeat(499950);const b=await bundle(long);
  b.assets[0].figure.alt='설명';b.assets.push({...clone(b.assets[0]),figure:{...image('diagram','another'),alt:'설명'}});
  await assert.rejects(()=>planVisualImport(long,b),/한도/);
});

test('brief and visible guidance prioritize explanation rather than filling every chapter with pictures', async t => {
  const p=project(),brief=await createVisualBrief(p);assert.equal(brief.workflow.perChapterQuota,false);
  assert.match(brief.instructions.join(' '),/그림 없이 충분하면 넣지/);assert.match(brief.instructions.join(' '),/여러 개/);
  const win=new Window();t.after(()=>win.close());win.document.body.innerHTML=renderVisualInstructions(p);
  assert.equal(win.document.querySelector('progress'),null);assert.match(win.document.body.textContent,/장별 할당량 없음/);
});
