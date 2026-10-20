import test from 'node:test';
import assert from 'node:assert/strict';
import {addCitation,addReviewComment,approveChapterReview,citationState,reviewReport,reviewCandidates,validateReviewDesk,remapReviewDesk,validateSharedReviewSources,reviewSources} from './dist/review-desk.js';
import {createExchange,parseExchange,planExchangeMerge,resolveExchangeMerge,validateCollaboration,exchangeRevision} from './dist/collaboration.js';
const fixture=()=>({id:'book',title:'근거가 있는 책',author:'저자',language:'ko',chapters:[{id:'a',title:'첫 장',content:'2025년에 30명이 참여했다. 반드시 확인한다.'},{id:'b',title:'다음 장',content:'두 번째 본문'}],registeredSources:{sourceName:'조사 원문',sourceMarkdown:'조사 설명\n2025년 참여자는 30명이다.\n추가 조사'} });
const citation=p=>addCitation(p,{chapterId:'a',claim:'2025년에 30명이 참여했다.',sourceId:'registered',excerpt:'2025년 참여자는 30명이다.',by:'검토자'});
test('evidence binds an exact source location and becomes stale after source/manuscript edits',()=>{
 const p=fixture();p.reviewDesk=citation(p);const c=p.reviewDesk.citations[0];assert.deepEqual(citationState(p,c),{current:true,claimMatches:true,sourceMatches:true,sourceName:'조사 원문',line:2});
 assert.equal(reviewCandidates(p).length,1);p.registeredSources.sourceMarkdown='다른 원문';assert.equal(citationState(p,c).sourceMatches,false);
 assert.throws(()=>approveChapterReview(p,'a','저자'),/변경된 출처/);
 p.chapters[0].content='변경됨';assert.equal(citationState(p,c).claimMatches,false);
});
test('unmatched evidence, limits and duplicate records are rejected; repeated excerpts use chosen occurrence',()=>{
 const p=fixture();assert.throws(()=>addCitation(p,{chapterId:'a',claim:'없는 본문',excerpt:'x',by:'a'}),/본문/);
 assert.throws(()=>addCitation(p,{chapterId:'a',claim:'2025년에',sourceId:'registered',excerpt:'없는 원문',by:'a'}),/찾지 못/);
 p.registeredSources.sourceMarkdown='같은 원문\n같은 원문';const d=addCitation(p,{chapterId:'a',claim:'2025년에',sourceId:'registered',excerpt:'같은 원문',occurrence:2,by:'a'});assert.equal(citationState(p,d.citations[0]).line,2);
 d.citations.push(d.citations[0]);assert.throws(()=>validateReviewDesk(d),/중복/);
});
test('human approval blocks unresolved comments and expires on revised content',()=>{
 const p=fixture();p.reviewDesk=addReviewComment(p,{chapterId:'a',body:'수치를 확인하세요.',by:'편집자',role:'editor'});
 assert.throws(()=>approveChapterReview(p,'a','저자'),/미해결/);p.reviewDesk.comments[0].resolved=true;
 p.reviewDesk=approveChapterReview(p,'a','저자');assert.equal(reviewReport(p).chapters[0].reviewed,true);p.chapters[0].content+=' 수정';assert.equal(reviewReport(p).chapters[0].reviewed,false);
 const moved=remapReviewDesk(p.reviewDesk,new Map([['a','new']]));assert.equal(moved.comments[0].chapterId,'new');
});
test('exchange omits private execution state and source documents unless source inclusion is chosen',async()=>{
 const p=fixture();p.production={secret:'runtime'};p.documentSource={base64:'PRIVATE'};
 const first=await createExchange(p,{name:'저자'});assert.equal(first.exchange.project.registeredSources,undefined);assert.equal(first.exchange.project.documentSource,undefined);assert.equal(first.exchange.project.production,undefined);
 assert.equal(first.origin.base.every(r=>/^[a-f0-9]{64}$/.test(r[1])),true);
 const withSources=await createExchange(p,{name:'저자',includeSources:true});assert.equal(withSources.exchange.project.registeredSources.sourceMarkdown,p.registeredSources.sourceMarkdown);
 assert.throws(()=>validateCollaboration({...first.origin,base:[['x','bad']]}));
});
test('independent chapter edits merge and concurrent chapter edits require explicit choice',async()=>{
 const p=fixture(),base=await createExchange(p,{name:'저자'});p.collaboration=base.origin;
 const remote=structuredClone(base.exchange);remote.project.chapters[1].content='편집자의 다음 장';p.chapters[0].content='저자의 첫 장';
 const incoming=parseExchange(remote,structuredClone);let plan=await planExchangeMerge(p,incoming);assert.equal(plan.conflicts.length,0);
 let merged=await resolveExchangeMerge(plan);assert.equal(merged.chapters[0].content,'저자의 첫 장');assert.equal(merged.chapters[1].content,'편집자의 다음 장');assert.equal(merged.registeredSources.sourceMarkdown,fixture().registeredSources.sourceMarkdown);
 remote.project.chapters[0].content='편집자의 첫 장';plan=await planExchangeMerge(p,parseExchange(remote,structuredClone));assert.equal(plan.conflicts.length,1);
 await assert.rejects(resolveExchangeMerge(plan),/모든 충돌/);merged=await resolveExchangeMerge(plan,{'chapter:a':'remote'});assert.equal(merged.chapters[0].content,'편집자의 첫 장');
});
test('delete-versus-edit, reorder and unrelated book handling preserve user choices',async()=>{
 const p=fixture(),first=await createExchange(p,{name:'저자'});p.collaboration=first.origin;
 const remote=first.exchange;remote.project.chapters.shift();p.chapters[0].content='변경된 본문';
 const plan=await planExchangeMerge(p,parseExchange(remote,structuredClone));assert.equal(plan.conflicts[0].key,'chapter:a');
 const result=await resolveExchangeMerge(plan,{'chapter:a':'local'});assert.equal(result.chapters.some(c=>c.id==='a'),true);
 await assert.rejects(planExchangeMerge({...p,id:'other',collaboration:undefined},parseExchange(remote,structuredClone)),/다른 책/);
 const before=await exchangeRevision(p);p.chapters[0].content+='추가';assert.notEqual(await exchangeRevision(p),before);
});

test('a newly opened comment invalidates an approved chapter without changing its text',()=>{
 const p=fixture();p.reviewDesk=approveChapterReview(p,'a','저자');
 assert.equal(reviewReport(p).chapters[0].reviewed,true);
 const original=p.chapters[0].content;
 p.reviewDesk=addReviewComment(p,{chapterId:'a',body:'출판 전에 다시 확인할 사항입니다.',by:'편집자',role:'editor'});
 assert.equal(p.chapters[0].content,original);
 assert.equal(reviewReport(p).chapters[0].reviewed,false);
 assert.throws(()=>approveChapterReview(p,'a','저자'),/미해결/);
 p.reviewDesk.comments[0].resolved=true;p.reviewDesk=approveChapterReview(p,'a','저자');
 assert.equal(reviewReport(p).chapters[0].reviewed,true);
 p.reviewDesk.comments[0].resolved=false;assert.equal(reviewReport(p).chapters[0].reviewed,false);
});

test('opted-in production and registered source IDs survive sharing and a return exchange',async()=>{
 const p=fixture();p.production={brief:{sourceName:'집필자료.md',sourceMarkdown:'집필 자료\n참여한 사람은 총 30명이다.'}};
 p.reviewDesk=addCitation(p,{chapterId:'a',claim:'2025년에 30명이 참여했다.',sourceId:'production',excerpt:'참여한 사람은 총 30명이다.',by:'검토자'});
 const first=await createExchange(p,{name:'저자',includeSources:true});
 assert.equal(first.exchange.project.production,undefined,'execution history remains private');
 const incoming=parseExchange(first.exchange,raw=>({...structuredClone(raw),sharedReviewSources:validateSharedReviewSources(raw.sharedReviewSources)}));
 assert.deepEqual(reviewSources(incoming.project).map(source=>source.id),['registered','production']);
 assert.equal(citationState(incoming.project,incoming.project.reviewDesk.citations[0]).current,true);
 const returned=await createExchange(incoming.project,{name:'편집자',role:'editor',includeSources:true});
 assert.equal(citationState(returned.exchange.project,returned.exchange.project.reviewDesk.citations[0]).current,true);
 const excluded=await createExchange(incoming.project,{name:'편집자',includeSources:false});
 assert.equal(excluded.exchange.project.sharedReviewSources,undefined);
 assert.equal(excluded.exchange.project.registeredSources,undefined);
});

test('per-file production source positions remain resolvable when raw registered sources are absent',async()=>{
 const p=fixture();delete p.registeredSources;
 const sourceMarkdown='문서 머리\n첫 파일 원문\n\n다음 파일 원문';
 p.production={brief:{sourceMarkdown,sourceName:'폴더',sourceManifest:{files:[{path:'first.md',start:6,end:12},{path:'next.md',start:14,end:22}]}}};
 const originalSource=reviewSources(p).find(source=>source.id==='production:next.md');
 p.reviewDesk=addCitation(p,{chapterId:'a',claim:'2025년에 30명이 참여했다.',sourceId:originalSource.id,excerpt:originalSource.content,by:'검토자'});
 const {exchange}=await createExchange(p,{name:'저자',includeSources:true});
 assert.equal(citationState(exchange.project,exchange.project.reviewDesk.citations[0]).current,true);
 assert.equal(citationState(exchange.project,exchange.project.reviewDesk.citations[0]).sourceName,'next.md');
});

test('default fields added by project validation cannot turn unchanged remote chapters into conflicts',async()=>{
 const p=fixture(),base=await createExchange(p,{name:'저자'});p.collaboration=base.origin;
 p.chapters[0].content='저자가 공유 후 수정한 첫 장';
 const incoming=parseExchange(base.exchange,raw=>({...structuredClone(raw),subtitle:'',description:'',theme:'sage',genre:'',audience:'',tone:'',voiceSample:'',coverImage:undefined,coverBackground:undefined,chapters:raw.chapters.map(chapter=>({...chapter,kind:'',imagePrompt:'',editorialNotes:undefined,image:undefined,figures:undefined}))}));
 const plan=await planExchangeMerge(p,incoming);assert.deepEqual(plan.conflicts,[]);
 const merged=await resolveExchangeMerge(plan);assert.equal(merged.chapters[0].content,p.chapters[0].content);
 assert.equal(merged.chapters[1].content,p.chapters[1].content);
 incoming.project.chapters[0].content='편집자가 별도로 수정한 첫 장';
 const actualConflict=await planExchangeMerge(p,incoming);assert.deepEqual(actualConflict.conflicts.map(conflict=>conflict.key),['chapter:a']);
});

const paragraphBook=()=>({...fixture(),chapters:[{id:'a',title:'같이 편집할 장',content:['첫 문단 👩‍👩‍👧‍👦','중간 기준 문단','세 번째 문단','마지막 기준 문단'].join('\n\n')}]});
const shareParagraphBook=async()=>{const local=paragraphBook(),shared=await createExchange(local,{name:'저자'});local.collaboration=shared.origin;return {local,remote:structuredClone(shared.exchange),origin:shared.origin};};

test('different paragraphs in one chapter merge without copying baseline manuscript text',async()=>{
 const {local,remote,origin}=await shareParagraphBook();
 assert.equal(origin.version,1);assert.equal(origin.chapterBases.length,1);assert.equal(origin.chapterBases[0].paragraphs.length,4);
 assert.ok(!JSON.stringify(origin).includes('첫 문단'));assert.ok(origin.chapterBases[0].paragraphs.every(hash=>/^[a-f0-9]{64}$/.test(hash)));
 local.chapters[0].content=local.chapters[0].content.replace('첫 문단','저자가 수정한 문단');remote.project.chapters[0].content=remote.project.chapters[0].content.replace('세 번째 문단','편집자가 수정한 문단');
 const before=JSON.stringify(local),plan=await planExchangeMerge(local,parseExchange(remote,structuredClone));assert.deepEqual(plan.conflicts,[]);
 const merged=await resolveExchangeMerge(plan);assert.match(merged.chapters[0].content,/저자가 수정한 문단 👩‍👩‍👧‍👦/);assert.match(merged.chapters[0].content,/편집자가 수정한 문단/);assert.equal(JSON.stringify(local),before);
 assert.equal(merged.chapters[0].content.split('\n\n').length,4);assert.notDeepEqual(merged.collaboration.chapterBases,origin.chapterBases);
});

test('chapter metadata and an independent paragraph use separate baseline fields',async()=>{
 const {local,remote}=await shareParagraphBook();local.chapters[0].title='저자의 제목';remote.project.chapters[0].content=remote.project.chapters[0].content.replace('세 번째 문단','편집자 문단');
 const plan=await planExchangeMerge(local,parseExchange(remote,raw=>({...structuredClone(raw),chapters:raw.chapters.map(chapter=>({...chapter,kind:'',imagePrompt:'',editorialNotes:undefined,image:undefined,figures:undefined}))})));
 assert.deepEqual(plan.conflicts,[]);const merged=await resolveExchangeMerge(plan);assert.equal(merged.chapters[0].title,'저자의 제목');assert.match(merged.chapters[0].content,/편집자 문단/);
 remote.project.chapters[0].title='다른 제목';const conflict=await planExchangeMerge(local,parseExchange(remote,structuredClone));assert.deepEqual(conflict.conflicts.map(c=>c.key),['chapter:a']);
});

for(const [name,change] of [
 ['same paragraph', (l,r)=>{l.content=l.content.replace('첫 문단','로컬');r.content=r.content.replace('첫 문단','원격');}],
 ['insertions at the same position', (l,r)=>{l.content='로컬 삽입\n\n'+l.content;r.content='원격 삽입\n\n'+r.content;}],
 ['delete versus edit', (l,r)=>{l.content=l.content.split('\n\n').slice(1).join('\n\n');r.content=r.content.replace('첫 문단','변경');}],
 ['moved paragraphs', (l,r)=>{const parts=l.content.split('\n\n');[parts[0],parts[1]]=[parts[1],parts[0]];l.content=parts.join('\n\n');r.content=r.content.replace('세 번째 문단','변경');}],
 ['ambiguous adjacent replacements', (l,r)=>{l.content=l.content.replace('첫 문단','첫 변경').replace('중간 기준 문단','둘째 변경');r.content=r.content.replace('마지막 기준 문단','마지막 변경');}],
 ])test(name+' remains an explicit whole-chapter conflict',async()=>{
 const {local,remote}=await shareParagraphBook();change(local.chapters[0],remote.project.chapters[0]);const plan=await planExchangeMerge(local,parseExchange(remote,structuredClone));assert.deepEqual(plan.conflicts.map(c=>c.key),['chapter:a']);
 await assert.rejects(resolveExchangeMerge(plan),/모든 충돌/);const result=await resolveExchangeMerge(plan,{'chapter:a':'remote'});assert.equal(result.chapters[0].content,remote.project.chapters[0].content);
});

test('repeated baseline paragraphs never invent alignment',async()=>{
 const local=paragraphBook();local.chapters[0].content='반복\n\n반복\n\n끝';const shared=await createExchange(local,{name:'저자'});local.collaboration=shared.origin;local.chapters[0].content='로컬\n\n반복\n\n끝';shared.exchange.project.chapters[0].content='반복\n\n원격\n\n끝';
 assert.equal((await planExchangeMerge(local,parseExchange(shared.exchange,structuredClone))).conflicts.length,1);
});

test('fenced code blank lines and CRLF stay exact while separate prose changes merge',async()=>{
 const local=paragraphBook(),fence=String.fromCharCode(96).repeat(3);local.chapters[0].content=['첫 문단',fence+'js\r\nconst a = 1;\r\n\r\nconst b = 2;\r\n'+fence,'셋째 문단','끝 문단'].join('\r\n\r\n');
 const shared=await createExchange(local,{name:'저자'});local.collaboration=shared.origin;assert.equal(shared.origin.chapterBases[0].paragraphs.length,4);
 const source=local.chapters[0].content;local.chapters[0].content=source.replace('첫 문단','첫 수정');shared.exchange.project.chapters[0].content=source.replace('셋째 문단','셋째 수정');
 const plan=await planExchangeMerge(local,parseExchange(shared.exchange,structuredClone));assert.deepEqual(plan.conflicts,[]);const result=await resolveExchangeMerge(plan);assert.equal(result.chapters[0].content,source.replace('첫 문단','첫 수정').replace('셋째 문단','셋째 수정'));
});

test('legacy version 1 and mismatched detailed baselines fall back without losing compatibility',async()=>{
 for(const mode of ['legacy','missing-local','altered-remote']){
  const {local,remote}=await shareParagraphBook();
  if(mode==='legacy'){delete local.collaboration.chapterBases;delete remote.origin.chapterBases;delete remote.project.collaboration.chapterBases;}
  if(mode==='missing-local')delete local.collaboration.chapterBases;
  if(mode==='altered-remote')remote.origin.chapterBases[0].paragraphs[0]='0'.repeat(64);
  local.chapters[0].content=local.chapters[0].content.replace('첫 문단','첫 수정');remote.project.chapters[0].content=remote.project.chapters[0].content.replace('세 번째 문단','셋째 수정');
  const incoming=parseExchange(remote,structuredClone);assert.equal(incoming.origin.version,1);assert.equal((await planExchangeMerge(local,incoming)).conflicts.length,1,mode);
 }
});

test('a resolved baseline survives normalized import and re-sharing for the next independent edit',async()=>{
 const {local,remote}=await shareParagraphBook();local.chapters[0].content=local.chapters[0].content.replace('첫 문단','첫 변경');remote.project.chapters[0].content=remote.project.chapters[0].content.replace('세 번째 문단','셋째 변경');
 const merged=await resolveExchangeMerge(await planExchangeMerge(local,parseExchange(remote,structuredClone))),shared=await createExchange(merged,{name:'저자'});
 assert.deepEqual(shared.origin,merged.collaboration);const imported=parseExchange(shared.exchange,raw=>({...structuredClone(raw),chapters:raw.chapters.map(chapter=>({...chapter,figures:chapter.figures||[],kind:chapter.kind||''}))})).project;
 imported.chapters[0].content=imported.chapters[0].content.replace('마지막 기준 문단','마지막 원격 변경');const returned=await createExchange(imported,{name:'편집자'});
 assert.deepEqual(returned.origin,shared.origin);merged.chapters[0].content=merged.chapters[0].content.replace('중간 기준 문단','중간 로컬 변경');
 const plan=await planExchangeMerge(merged,parseExchange(returned.exchange,structuredClone));assert.deepEqual(plan.conflicts,[]);const final=await resolveExchangeMerge(plan);assert.match(final.chapters[0].content,/중간 로컬 변경/);assert.match(final.chapters[0].content,/마지막 원격 변경/);
});

test('detailed baseline validation rejects hostile shapes and enforces bounded paragraph work',async()=>{
 const {origin}=await shareParagraphBook();
 for(const mutate of [d=>{d.chapterBases[0].paragraphs[0]='raw manuscript';},d=>{d.chapterBases.push(d.chapterBases[0]);},d=>{d.chapterBases[0].fields[0][0]='__proto__';},d=>{d.chapterBases[0].fields[0][1]=['0'.repeat(64)];},d=>{d.chapterBases[0].paragraphs=Array(201).fill('0'.repeat(64));},d=>{d.chapterBases[0].id='missing';}]){const invalid=structuredClone(origin);mutate(invalid);assert.throws(()=>validateCollaboration(invalid),/공유/);}
 const local=paragraphBook();local.chapters[0].content=Array.from({length:201},(_,i)=>'문단 '+i).join('\n\n');const shared=await createExchange(local,{name:'저자'});assert.equal(shared.origin.chapterBases,undefined);local.collaboration=shared.origin;local.chapters[0].content+=' 로컬';shared.exchange.project.chapters[0].content+=' 원격';assert.equal((await planExchangeMerge(local,parseExchange(shared.exchange,structuredClone))).conflicts.length,1);
 local.collaboration=undefined;local.chapters[0].content='가'.repeat(100001)+'\n\n끝';assert.equal((await createExchange(local,{name:'저자'})).origin.chapterBases,undefined);
});

for(const [name,content] of [['first and last repeated text','반복\n\n중간\n\n반복'],['whitespace-equivalent repeated text','  반복  \n\n중간\n\n\t반복\t']])test(name+' omits paragraph baselines and requires explicit conflict resolution',async()=>{
 const local=paragraphBook();local.chapters[0].content=content;const shared=await createExchange(local,{name:'저자'});assert.equal(shared.origin.chapterBases,undefined);
 local.collaboration=shared.origin;local.chapters[0].content=content.replace('반복','저자 수정');
 const last=content.lastIndexOf('반복');shared.exchange.project.chapters[0].content=content.slice(0,last)+'편집자 수정'+content.slice(last+'반복'.length);
 const plan=await planExchangeMerge(local,parseExchange(shared.exchange,structuredClone));assert.deepEqual(plan.conflicts.map(c=>c.key),['chapter:a']);await assert.rejects(resolveExchangeMerge(plan),/모든 충돌/);
 const resolved=await resolveExchangeMerge(plan,{'chapter:a':'remote'});assert.equal(resolved.chapters[0].content,shared.exchange.project.chapters[0].content);
});
