import test from 'node:test';
import assert from 'node:assert/strict';
import {appendComputerRecords} from './dist/computer-book.js';
import {renderMarkdown} from './dist/export.js';

const src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const record=(id='one')=>({id,capturedAt:'2026-10-18T00:00:00.000Z',windowTitle:'메이플스토리 월드 에디터',title:'발판 설정',caption:'선택한 발판의 속성 창',extractedText:'오브젝트를 선택하면 속성 창에서 값을 확인할 수 있다.',src,steps:['속성 창을 확인했다.']});
const research=records=>({version:1,goal:'발판 예제',target:'에디터',records});

test('captured figures append in source order and preserve the original manuscript atomically',()=>{
 const records=[record(),record('two')],chapter={content:'기존 원고\n\n```lua\nprint("그대로")\n```'};
 const original=structuredClone(chapter),result=appendComputerRecords(chapter,records,research(records));
 assert.deepEqual(chapter,original);
 assert.ok(result.content.startsWith(original.content+'\n\n'));
 assert.equal(result.added,2);
 assert.deepEqual(result.figures.map(f=>f.id),['pc-one','pc-two']);
 const html=renderMarkdown(result.content,{figures:result.figures});
 assert.equal((html.match(/<figure/g)||[]).length,2);
 assert.ok(html.includes(src));
 assert.throws(()=>appendComputerRecords(result,records,research(records)),/이미/);
});

test('insertion resolves selected IDs against durable evidence rather than caller supplied text or image',()=>{
 const original=record(),forged={...original,src:'https://tracking.invalid/secret',title:'꾸며낸 제목'};
 const result=appendComputerRecords({content:''},[forged],research([original]));
 assert.equal(result.figures[0].src,src);
 assert.equal(result.figures[0].alt,original.title);
 assert.ok(!result.content.includes('꾸며낸'));
 assert.throws(()=>appendComputerRecords({content:''},[record('missing')],research([original])),/일치/);
 assert.throws(()=>appendComputerRecords({content:''},[original,original],research([original])),/일치/);
});

test('failed capacity checks cannot mutate a chapter and hostile labels cannot break the image reference',()=>{
 const original=record(),chapter={content:'이미 있는 본문',figures:Array.from({length:20},(_,i)=>({id:`old-${i}`,src,alt:'기존',caption:''}))};
 const before=structuredClone(chapter);
 assert.throws(()=>appendComputerRecords(chapter,[original],research([original])),/20/);
 assert.deepEqual(chapter,before);
 const hostile={...record(),title:'제목\n[가짜](https://example.org) <script>'};
 const result=appendComputerRecords({content:''},[hostile],research([hostile]));
 const html=renderMarkdown(result.content,{figures:result.figures});
 assert.ok(!html.includes('<script>'));
 assert.equal((html.match(/<figure/g)||[]).length,1);
 assert.equal(result.figures[0].src,src);
});
