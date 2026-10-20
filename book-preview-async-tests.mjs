/** Scoped DOM integration: delayed decoding and persisted transitions, without browser automation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {mountBookPreviewEditor} from './dist/book-preview-editor.js';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(check){for(let i=0;i<100&&!check();i++)await tick();assert.ok(check(),'Asynchronous state should settle');}
async function setup(t,{onSave}={}){
 const win=new Window({url:'https://folio.test/'});
 const book={id:'book',title:'비동기 편집',author:'저자',language:'ko',chapters:[{id:'first',title:'첫 장',content:'기존 첫 문장'},{id:'second',title:'둘째 장',content:'기존 둘째 문장'},{id:'third',title:'셋째 장',content:'기존 셋째 문장'}]};
 win.document.body.innerHTML='<div id="book"></div>';
 const host=win.document.querySelector('#book'),errors=[],saves=[],decodes=[];let valid=true;
 win.Image=class{naturalWidth=1;naturalHeight=1;complete=false;set src(value){this.value=value;if(!decodes.length)decodes.push(this);else{this.complete=true;queueMicrotask(()=>this.onload?.());}}};
 const control=mountBookPreviewEditor(host,{project:book,mode:'edit',chapterId:'first',isCurrent:()=>valid,onSave:async()=>{saves.push(structuredClone(book));return onSave?onSave():true;},onError:error=>errors.push(error)});
 await control.ready;
 const $=selector=>host.querySelector(selector);
 const click=selector=>$(selector).click();
 const select=id=>{const element=$('.book-workspace-toolbar [data-book-section]');element.value=id;element.dispatchEvent(new win.Event('change',{bubbles:true}));};
 const paste=()=>{
   const bytes=Buffer.from(PNG.split(',')[1],'base64');
   const event=new win.Event('paste',{bubbles:true,cancelable:true});
   Object.defineProperty(event,'clipboardData',{value:{files:[{name:'늦은 이미지.png',type:'image/png',size:bytes.length,arrayBuffer:async()=>bytes}],items:[],getData:()=>''}});
   $('[data-book-editor-content]').dispatchEvent(event);
 };
 t.after(async()=>{control.destroy();await win.happyDOM.close();});
 return {win,book,control,host,errors,saves,decodes,$,click,select,paste,invalidate:()=>valid=false};
}
test('preview transition waits for image decoding before persisting and destroying editor',async t=>{
 const s=await setup(t);s.paste();await until(()=>s.decodes.length===1);
 const editor=s.$('[data-book-editor-content]');s.click('[data-book-mode="preview"]');await tick();
 assert.equal(s.control.getState().mode,'edit');assert.equal(s.saves.length,0);assert.ok(editor.isConnected);
 s.decodes[0].onload();await until(()=>s.control.getState().mode==='preview');
 assert.equal(s.book.chapters[0].figures.length,1);assert.equal(s.saves.length,1);
 assert.equal(s.saves[0].chapters[0].figures[0].src,PNG);assert.equal(s.book.chapters[1].figures,undefined);assert.equal(s.errors.length,0);
});
test('changing chapter waits for the image and attaches it to the original chapter',async t=>{
 const s=await setup(t);s.paste();await until(()=>s.decodes.length===1);s.select('second');await tick();
 assert.equal(s.control.getState().chapterId,'first');assert.equal(s.saves.length,0);
 s.decodes[0].onload();await until(()=>s.control.getState().chapterId==='second');
 assert.equal(s.book.chapters[0].figures[0].src,PNG);assert.equal(s.book.chapters[1].figures,undefined);
 assert.equal(s.$('[data-book-editor-content]').value,'기존 둘째 문장');assert.equal(s.saves.length,1);
});
test('latest chapter selection wins when several transitions wait on the same image',async t=>{
 const s=await setup(t);s.paste();await until(()=>s.decodes.length===1);s.select('second');s.select('third');
 s.decodes[0].onload();await until(()=>s.control.getState().chapterId==='third');
 assert.equal(s.book.chapters[0].figures.length,1);assert.equal(s.saves.length,1);assert.equal(s.$('[data-book-editor-title]').value,'셋째 장');
});
test('newer editor request supersedes a pending preview without losing inserted image',async t=>{
 const s=await setup(t);s.paste();await until(()=>s.decodes.length===1);s.click('[data-book-mode="preview"]');s.click('[data-book-mode="edit"]');
 s.decodes[0].onload();await until(()=>s.saves.length===1);await tick();
 assert.equal(s.control.getState().mode,'edit');assert.equal(s.book.chapters[0].figures.length,1);assert.match(s.$('[data-book-editor-content]').value,/folio-asset:/);
});
test('failed save retains the decoded image and original chapter in the editor',async t=>{
 const s=await setup(t,{onSave:()=>false});s.paste();await until(()=>s.decodes.length===1);s.select('second');
 s.decodes[0].onload();await until(()=>/저장 실패/.test(s.$('[data-book-status]').textContent));
 assert.equal(s.control.getState().mode,'edit');assert.equal(s.control.getState().chapterId,'first');assert.equal(s.$('.book-workspace-toolbar [data-book-section]').value,'first');assert.equal(s.book.chapters[0].figures.length,1);
});
test('invalidated book cannot persist a delayed decode or finish its transition',async t=>{
 const s=await setup(t);s.paste();await until(()=>s.decodes.length===1);s.click('[data-book-mode="preview"]');s.invalidate();s.decodes[0].onload();await tick();await tick();
 assert.equal(s.saves.length,0);assert.equal(s.book.chapters[0].figures,undefined);assert.equal(s.control.getState().mode,'edit');
});
