import test from 'node:test';
import assert from 'node:assert/strict';
import {localCopyedit,analyzeProject,applyEditorialSuggestion,splitManuscript} from './dist/editorial.js';
import {exportMarkdown} from './dist/export.js';

test('CR-only and mixed-newline fenced examples survive copyediting and targeted suggestions',()=>{
 for(const marker of ['~~~','```']) for(const separator of ['\r','\r\n','\n']){
  const code=`${marker}text${separator}안되요 몇일${separator}${marker}`;
  const input=`${code}${separator}${separator}본문은 안되요.`;
  const expected=`${code}${separator}${separator}본문은 안 돼요.`;
  assert.equal(localCopyedit(input).text,expected);
  const result=analyzeProject({chapters:[{id:'one',title:'장',content:input}]});
  assert.equal(result.suggestions.length,1);
  assert.equal(result.suggestions[0].start,input.lastIndexOf('안되요'));
  assert.equal(applyEditorialSuggestion(input,result.suggestions[0]),expected);
  assert.throws(()=>applyEditorialSuggestion(input,{start:input.indexOf('안되요'),end:input.indexOf('안되요')+3,before:'안되요',after:'안 돼요'}),/자동으로 수정하지/);
 }
 const mixed='~~~text\r안되요\n몇일\r\n~~~\r본문 안되요.';
 assert.equal(localCopyedit(mixed).text,'~~~text\r안되요\n몇일\r\n~~~\r본문 안 돼요.');
});

test('unclosed CR-only fenced examples remain entirely literal',()=>{
 const source='첫 문장은 안되요.\r\r~~~text\r몇일 안되요\r다음 줄도 안되요.';
 assert.equal(localCopyedit(source).text,'첫 문장은 안 돼요.\r\r~~~text\r몇일 안되요\r다음 줄도 안되요.');
});

test('a 300-chapter Markdown manuscript preserves every chapter instead of folding chapter51 onward into chapter50',()=>{
 const sections=Array.from({length:300},(_,index)=>({title:`제${index+1}장`,content:`${index+1}번째 장의 고유한 내용입니다.`}));
 const source=sections.map(section=>`## ${section.title}\n\n${section.content}`).join('\n\n');
 const chapters=splitManuscript(source,'긴 원고');
 assert.equal(chapters.length,300);
 assert.deepEqual(chapters.map(({title,content})=>({title,content})),sections);
 assert.equal(new Set(chapters.map(chapter=>chapter.id)).size,300);
});

test('exported 300-chapter Markdown keeps all chapter headings when imported with its front matter',()=>{
 const book={title:'긴 원고',author:'저자',chapters:Array.from({length:300},(_,index)=>({title:`제${index+1}장`,content:`${index+1}번째 장의 고유한 내용입니다.`}))};
 const chapters=splitManuscript(exportMarkdown(book),book.title);
 for(const original of book.chapters){
  const matches=chapters.filter(chapter=>chapter.title===original.title);
  assert.equal(matches.length,1,original.title);
  assert.ok(matches[0].content.includes(original.content));
 }
 assert.ok(chapters.some(chapter=>chapter.content.includes('지은이: 저자')));
});
