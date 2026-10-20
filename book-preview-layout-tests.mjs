/** Deterministic geometry tests; real browser layout is verified separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {BOOK_PREVIEW_CSS,mountBookPreview} from './dist/book-preview.js';
import {mountBookPreviewEditor} from './dist/book-preview-editor.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(check){for(let i=0;i<200&&!check();i++)await tick();assert.ok(check(),'Layout update should settle');}
async function modalFixture(t){
 const win=new Window({url:'https://folio.test/'}), observers=[];
 Object.defineProperty(win,'innerHeight',{configurable:true,value:950});
 win.ResizeObserver=class{constructor(callback){this.callback=callback;this.targets=[];observers.push(this);}observe(target){this.targets.push(target);}disconnect(){this.disconnected=true;}};
 win.document.head.innerHTML='<style>'+BOOK_PREVIEW_CSS+'.modal-backdrop{padding:25px}.book-preview-modal{max-height:90vh;padding:28px;box-sizing:border-box}</style>';
 win.document.body.innerHTML='<div class="modal-backdrop"><div class="book-preview-modal"><header class="modal-header">책 미리보기</header><div id="workspace"></div></div></div>';
 const host=win.document.querySelector('#workspace'),modal=host.closest('.book-preview-modal');
 let toolbarGrowth=0,hintGrowth=0;
 const rect=(top,height,width=1104)=>({x:0,y:top,left:0,right:width,top,bottom:top+height,width,height});
 win.HTMLElement.prototype.getBoundingClientRect=function(){
   if(this===modal)return rect(47.5,855,1160);
   if(this.classList.contains('book-reader-host'))return rect(47.5+148+toolbarGrowth-modal.scrollTop,0);
   if(this.classList.contains('folio-book-toolbar'))return rect(0,32);
   if(this.classList.contains('folio-book-navigation'))return rect(0,36);
   if(this.classList.contains('folio-book-progress'))return rect(0,5);
   if(this.classList.contains('folio-book-hint'))return rect(0,19+hintGrowth);
   return rect(0,0);
 };
 const book={id:'layout',title:'화면 안의 책',chapters:[{id:'one',title:'첫 장',content:'첫 본문'},{id:'two',title:'둘째 장',content:'다음 본문'}]};
 const editor=mountBookPreviewEditor(host,{project:book,chapterId:'one'});await editor.ready;
 const reader=host.querySelector('.folio-book-reader');
 const pageHeight=()=>parseFloat(reader.style.getPropertyValue('--book-page-height'));
 const occupied=()=>148+toolbarGrowth+pageHeight()+171+hintGrowth+28;
 const notify=()=>observers.forEach(observer=>!observer.disconnected&&observer.callback([]));
 t.after(async()=>{editor.destroy();await win.happyDOM.close();});
 return {win,host,modal,editor,reader,observers,pageHeight,occupied,notify,growToolbar(value){toolbarGrowth=value;},growHint(value){hintGrowth=value;}};
}
test('modal page size reserves header, editor toolbar and all bottom controls',async t=>{
 const s=await modalFixture(t);
 assert.ok(s.occupied()<=855,'book plus controls fits inside 90vh dialog');
 assert.ok(s.pageHeight()>400,'the page remains readable');
 assert.equal(s.editor.getState().chapterId,'one');
});
test('toolbar wrapping at unchanged width refits pages and preserves chapter',async t=>{
 const s=await modalFixture(t),before=s.pageHeight();
 const bookmark=s.reader.querySelector('[data-book-section]');bookmark.value=[...bookmark.options].find(option=>/둘째 장/.test(option.textContent)).value;bookmark.dispatchEvent(new s.win.Event('change',{bubbles:true}));
 s.growToolbar(54);s.notify();await until(()=>s.pageHeight()<before);
 assert.ok(s.occupied()<=855);
 assert.ok(s.observers.some(observer=>observer.targets.includes(s.host.querySelector('.book-workspace-toolbar'))));
 assert.equal(s.editor.getState().chapterId,'two');
});
test('wrapped reader hint refits the page even when the outer toolbar is unchanged',async t=>{
 const s=await modalFixture(t),before=s.pageHeight();
 s.growHint(38);s.notify();await until(()=>s.pageHeight()<before);
 assert.ok(s.occupied()<=855);
 assert.ok(s.observers.some(observer=>observer.targets.includes(s.reader.querySelector('.folio-book-hint'))));
});
test('scrolling the dialog does not increase the page budget during resize',async t=>{
 const s=await modalFixture(t),before=s.pageHeight();s.modal.scrollTop=90;
 s.win.dispatchEvent(new s.win.Event('resize'));
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(s.pageHeight(),before);assert.ok(s.occupied()<=855);
});
test('standalone readers retain viewport sizing without the editor height callback',async t=>{
 const win=new Window(),host=win.document.createElement('div');win.document.body.append(host);
 Object.defineProperty(win,'innerHeight',{configurable:true,value:950});host.getBoundingClientRect=()=>({width:1104});
 const reader=mountBookPreview(host,{sections:[{id:'one',title:'첫 장',html:'<p>본문</p>'}]});
 t.after(async()=>{reader.destroy();await win.happyDOM.close();});await reader.ready;
 assert.equal(host.style.getPropertyValue('--book-page-width'),'430px');
 assert.equal(host.style.getPropertyValue('--book-page-height'),'608px');
});
