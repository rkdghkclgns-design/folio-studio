import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPERIENCE_KEY,DEFAULT_PREFERENCES,loadPreferences,savePreferences,searchLibrary} from './dist/experience.js';

test('interface preferences whitelist fields and never overwrite manuscript storage',()=>{
  const values=new Map([['folio-studio-v1','original manuscript']]);
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  assert.equal(savePreferences(storage,{fontSize:20,tutorialStep:4,tutorialStarted:true,apiKey:'not-to-be-stored',projects:['not-a-preference']}),true);
  assert.equal(values.get('folio-studio-v1'),'original manuscript');
  const saved=JSON.parse(values.get(EXPERIENCE_KEY));
  assert.equal(saved.fontSize,20);assert.equal(saved.tutorialStep,4);assert.equal(saved.tutorialStarted,true);
  assert.equal('apiKey' in saved,false);assert.equal('projects' in saved,false);
  assert.deepEqual(loadPreferences(storage),saved);
});

test('corrupt and unavailable preference storage falls back without blocking the writer',()=>{
  assert.deepEqual(loadPreferences({getItem:()=>'{broken'}),DEFAULT_PREFERENCES);
  const unavailable={getItem(){throw new Error('unavailable');},setItem(){throw new Error('full');}};
  assert.deepEqual(loadPreferences(unavailable),DEFAULT_PREFERENCES);
  assert.equal(savePreferences(unavailable,{fontSize:20}),false);
  const unusual={getItem:()=>JSON.stringify({fontSize:100000,tutorialStep:-50,tutorialStarted:'true'})};
  assert.deepEqual(loadPreferences(unusual),DEFAULT_PREFERENCES);
});

test('library search treats punctuation literally, caps results and leaves manuscripts intact',()=>{
  const books=[{id:'book',title:'문장 기록',chapters:Array.from({length:60},(_,i)=>({id:'c'+i,title:'제'+i+'장',content:'기호 [a]+.*와 고유한 문장을 보관합니다.'}))}];
  const source=structuredClone(books);
  assert.equal(searchLibrary(books,'[a]+.*').length,40);
  assert.equal(searchLibrary(books,'').length,12);
  assert.equal(searchLibrary(books,'없는 문장').length,0);
  const result=searchLibrary(books,'제59장');
  assert.equal(result.length,1);assert.equal(result[0].chapterId,'c59');assert.equal(result[0].projectId,'book');
  assert.deepEqual(books,source);
});
