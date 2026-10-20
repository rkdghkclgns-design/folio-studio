import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createProductionProject,runProduction,getProductionProgress} from './dist/production.js';
import {describeBookLength,estimateProduction,createProductionApproval,assertProductionApproval,closeProductionApproval,ESTIMATE_REFERENCES} from './dist/production-estimate.js';
import {renderProductionApproval,renderProductionLiveProgress} from './dist/production-ui.js';
const config={provider:'google',textModel:'gemini-3.8-flash',imageModel:'gemini-nano-banana-2.1',configured:true};
const book=(extra={})=>createProductionProject({topic:'도시 정원',targetValue:3000,chapterCount:2,illustrations:'none',...extra});
const estimate=p=>estimateProduction(p,config,{}, {date:'2026-10-19'});
const plan=request=>({title:'정원',subtitle:'',description:'',chapters:Array.from({length:request.brief.chapterCount},(_,i)=>({title:`정원 ${i+1}`,purpose:'식물 돌보기',outline:['준비','실천'],sourceRefs:[]}))});
function apiFor(calls){return {planBook:async request=>{calls.push('plan');return plan(request);},writeSection:async request=>{calls.push('write');return {content:'가'.repeat(request.targetChars),notes:[],imagePrompt:'',sourceRefs:[]};}};}

test('30,000 characters is explained with physical-book range and explicit assumptions',()=>{
  const value=describeBookLength(30000);
  assert.equal(value.pagesLow,30);assert.equal(value.pagesHigh,50);assert.equal(value.referencePages,38);
  assert.match(value.label,/소책자/);assert.match(value.comparison,/19%/);assert.match(value.assumption,/600~1,000/);
});
test('published model and FX rates produce positive dual-currency ranges, with promotional expiry',()=>{
  const p=book({targetValue:30000,chapterCount:0,illustrations:'ai'}),e=estimate(p);
  assert.equal(e.work.draftCount,15);assert.equal(e.work.minRequests,17);assert.equal(e.work.imageCount,3);
  assert.equal(e.rates.input,.75);assert.equal(e.rates.output,3.75);assert.equal(e.fx,ESTIMATE_REFERENCES.fxRate);
  assert.ok(e.usd.low>0&&e.usd.high>e.usd.low);assert.equal(e.krw.high,e.usd.high*e.fx);
  assert.ok(e.minutes.high>e.minutes.low);
  const next=estimateProduction(p,config,{}, {date:'2027-01-01'});assert.equal(next.rates.input,1.5);
});
test('unknown model never borrows a different model price and requires user input for approval',()=>{
  const p=book({illustrations:'ai'}),unknown={...config,textModel:'unknown-model',imageModel:'unknown-image'};
  const e=estimateProduction(p,unknown);assert.equal(e.usd,null);assert.equal(e.completePricing,false);
  assert.throws(()=>createProductionApproval(p,e),/단가/);
  const priced=estimateProduction(p,unknown,{inputPerMillion:2,outputPerMillion:8,imagePerImage:.1,usdKrw:1400});
  assert.equal(priced.completePricing,true);assert.equal(priced.fx,1400);assert.equal(priced.rates.custom,true);
  assert.doesNotThrow(()=>createProductionApproval(p,priced));
  assert.throws(()=>estimateProduction(p,config,{usdKrw:-1}),/환율/);
  assert.throws(()=>estimateProduction(p,config,{inputPerMillion:'NaN'}),/단가/);
});
test('approval UI includes amounts and leaves both consent and start inactive',()=>{
  const win=new Window(),p=book();win.document.body.innerHTML=renderProductionApproval(p,estimate(p));
  const d=win.document;
  assert.match(d.body.textContent,/\$/);assert.match(d.body.textContent,/₩/);assert.match(d.body.textContent,/분/);
  assert.equal(d.querySelector('#production-approval-check').checked,false);
  assert.equal(d.querySelector('[data-action=production-approve]').disabled,true);
  for(const input of d.querySelectorAll('input'))assert.ok(d.querySelector(`label[for="${input.id}"]`));
  assert.match(d.body.textContent,/결제 한도가 아닙니다/);
});
test('approval rejects stale progress, model changes, estimate tampering and imported tokens',()=>{
  const p=book(),e=estimate(p),token=createProductionApproval(p,e);
  assert.doesNotThrow(()=>assertProductionApproval(p,token,config));
  assert.throws(()=>assertProductionApproval(p,token,{...config,textModel:'other'}),/승인/);
  assert.throws(()=>assertProductionApproval(p,structuredClone(token),config),/승인/);
  e.usd.high=0;assert.throws(()=>createProductionApproval(p,e),/바뀌었/);
  p.production.requestsStarted++;assert.throws(()=>assertProductionApproval(p,token,config),/다시/);
});
test('enforced engine sends zero calls without approval and stops on a connection change between checkpoints',async()=>{
  const p=book(),calls=[],api=apiFor(calls);
  await assert.rejects(runProduction(p,{api,approvalContext:{config}}),{code:'APPROVAL_REQUIRED'});
  assert.deepEqual(calls,[]);assert.equal(p.production.status,'ready');
  const token=createProductionApproval(p,estimate(p));let current=config;
  await assert.rejects(runProduction(p,{api,approvalContext:{approval:token,config,getConfig:()=>current},onSave:async()=>{if(p.production.requestsStarted)current={...config,textModel:'changed'};}}),{code:'APPROVAL_REQUIRED'});
  assert.deepEqual(calls,[]);assert.equal(p.production.status,'failed');
});
test('one approval covers legitimate progress but cannot be replayed on resume; remaining estimates shrink',async()=>{
  const p=book(),calls=[],controller=new AbortController(),start=estimate(p),token=createProductionApproval(p,start);
  await assert.rejects(runProduction(p,{api:apiFor(calls),signal:controller.signal,approvalContext:{approval:token,config},onSave:async()=>{if(p.chapters[0]?.content)controller.abort();}}),{name:'AbortError'});
  assert.deepEqual(calls,['plan','write']);assert.equal(p.production.status,'paused');
  const rest=estimate(p);assert.equal(rest.work.minRequests,1);assert.ok(rest.usd.high<start.usd.high);
  await assert.rejects(runProduction(p,{api:apiFor(calls),approvalContext:{approval:token,config}}),{code:'APPROVAL_REQUIRED'});
  const resumed=createProductionApproval(p,rest);
  await runProduction(p,{api:apiFor(calls),approvalContext:{approval:resumed,config}});
  assert.deepEqual(calls,['plan','write','write']);assert.equal(p.production.status,'complete');
  closeProductionApproval(resumed);assert.throws(()=>assertProductionApproval(p,resumed,config,{running:true}),/승인/);
  assert.equal(estimate(p).usd.high,0);
});
test('live bar uses saved work and reserves visible progress for unfinished artwork',()=>{
  const p=book({illustrations:'ai'}),progress={...getProductionProgress(p),percent:100,completedChapters:2,actualChars:3000};
  p.production.stage='complete';p.production.status='complete';
  const win=new Window();win.document.body.innerHTML=renderProductionLiveProgress(p,progress,estimate(p),{elapsedMs:65000});
  assert.equal(win.document.querySelector('progress').value,90);
  assert.match(win.document.body.textContent,/1분 5초/);assert.match(win.document.body.textContent,/남은 비용/);
  p.production.artwork.status='complete';win.document.body.innerHTML=renderProductionLiveProgress(p,progress,estimate(p));
  assert.equal(win.document.querySelector('progress').value,100);
});
