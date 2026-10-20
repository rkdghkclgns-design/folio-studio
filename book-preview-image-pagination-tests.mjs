/** Fresh DOM images deliberately have no synchronous intrinsic layout size. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {mountBookPreview} from './dist/book-preview.js';
const source='data:image/png;base64,fixture';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(check){for(let i=0;i<200&&!check();i++)await tick();assert.ok(check(),'Asset repagination should settle');}
function setup(t,{late=false,fonts}={}){
 const win=new Window(),preloads=[];let deadline,loaded=false;
 if(fonts)Object.defineProperty(win.document,'fonts',{configurable:true,value:{ready:fonts}});
 const set=win.setTimeout.bind(win);
 if(late)win.setTimeout=(fn,delay,...args)=>{if(delay===1600){deadline=fn;return 987654;}return set(fn,delay,...args);};
 win.Image=class{complete=false;naturalWidth=0;naturalHeight=0;constructor(){preloads.push(this);}set src(value){this.source=value;}};
 const host=win.document.createElement('div');win.document.body.append(host);host.getBoundingClientRect=()=>({width:390});
 const height=node=>{
   if(node.nodeType!==1)return 0;
   if(node.tagName==='IMG'){
     const ratio=node.style.aspectRatio.split('/').map(Number);
     if(ratio.length===2&&ratio.every(n=>n>0))return Math.min(70,60*ratio[1]/ratio[0]);
     // A preload cache does not make freshly parsed measuring images synchronous.
     return loaded&&node.closest('.folio-book-stage')?70:0;
   }
   if(node.tagName==='FIGURE')return [...node.children].reduce((sum,child)=>sum+height(child),0);
   if(/^H[1-6]$/.test(node.tagName))return 20;
   return Math.ceil(node.textContent.length/10)*10;
 };
 Object.defineProperty(win.HTMLElement.prototype,'clientHeight',{configurable:true,get(){return this.classList.contains('folio-book-page-body')?100:0;}});
 Object.defineProperty(win.HTMLElement.prototype,'scrollHeight',{configurable:true,get(){return this.classList.contains('folio-book-page-body')?Math.max(100,[...this.children].reduce((sum,child)=>sum+height(child),0)):height(this);}});
 const text='사진 아래 내용도 모두 읽혀야 합니다. '.repeat(6);
 const reader=mountBookPreview(host,{sections:[{id:'first',title:'첫 장',html:'<h1>장 제목</h1><figure><img src="'+source+'" alt="예시"/></figure><p>'+text+'</p>'},{id:'second',title:'둘째 장',html:'<p>다음 장</p>'}]});
 t.after(async()=>{reader.destroy();await win.happyDOM.close();});
 const load=()=>{loaded=true;const image=preloads[0];image.naturalWidth=100;image.naturalHeight=400;image.complete=true;image.onload?.();};
 return {win,host,reader,text,preloads,load,deadline:()=>deadline(),height};
}
test('cached intrinsic ratios reserve image height in every freshly parsed measurement and visible page',async t=>{
 const s=setup(t);s.load();await s.reader.ready;
 let restored='',imageCount=0;
 for(let i=0;i<s.reader.getState().pageCount;i++){
   s.reader.goTo(i);const body=s.host.querySelector('.folio-book-stage .folio-book-page-body');
   assert.ok(body.scrollHeight<=body.clientHeight+1||body.classList.contains('has-overflow'),'no body can be silently clipped');
   for(const image of body.querySelectorAll('img')){imageCount++;assert.equal(image.style.aspectRatio,'100 / 400');assert.equal(s.height(image),70,'max-height caps measured and visible geometry identically');}
   restored+=body.textContent;
 }
 assert.equal(imageCount,1);assert.equal(restored,'장 제목'+s.text+'다음 장');
});
test('an image arriving after the readiness deadline repaginates and preserves the selected chapter',async t=>{
 const s=setup(t,{late:true});s.deadline();await s.reader.ready;
 s.reader.goToSection('second');s.load();await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(s.reader.getState().section,1);
 s.reader.goToSection('first');
 await until(()=>s.host.querySelector('.folio-book-stage img')?.style.aspectRatio==='100 / 400');
 const body=s.host.querySelector('.folio-book-stage .folio-book-page-body');assert.ok(body.scrollHeight<=body.clientHeight+1);
});
test('late fonts trigger another pagination pass after the readiness deadline',async t=>{
 let release;const fonts=new Promise(resolve=>release=resolve);const s=setup(t,{late:true,fonts});
 s.load();s.deadline();await s.reader.ready;
 const first=s.host.querySelector('.folio-book-stage .folio-book-page');release();
 await until(()=>s.host.querySelector('.folio-book-stage .folio-book-page')!==first);
});
test('failed image loading retains the caption and text without rejecting readiness',async t=>{
 const s=setup(t);s.preloads[0].onerror();await s.reader.ready;
 assert.ok(s.reader.getState().pageCount>1);assert.equal(s.preloads[0].onload,null);assert.equal(s.preloads[0].onerror,null);
});
test('destroying the reader disconnects pending image handlers and prevents late redraw',async t=>{
 const s=setup(t,{late:true});s.deadline();await s.reader.ready;
 const late=s.preloads[0].onload;s.reader.destroy();
 assert.equal(s.preloads[0].onload,null);assert.equal(s.preloads[0].onerror,null);
 late();await tick();assert.equal(s.host.children.length,0);
});

test('destroy before readiness settles the pending caller without waiting for images or fonts',async t=>{
 const s=setup(t,{late:true,fonts:new Promise(()=>{})});
 const late=s.preloads[0].onload;s.reader.destroy();
 let timer;const settled=await Promise.race([s.reader.ready.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),100);})]);
 clearTimeout(timer);assert.equal(settled,true,'destroy must release callers awaiting ready');
 assert.equal(s.preloads[0].onload,null);assert.equal(s.preloads[0].onerror,null);
 late();await tick();assert.equal(s.host.children.length,0);
});
