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
