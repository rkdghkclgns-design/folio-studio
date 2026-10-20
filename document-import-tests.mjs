import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Window} from 'happy-dom';
import {zipSync,strToU8} from './dist/vendor/fflate-0.8.2.js';
import {importDocument,validateDocumentSource,documentSourceBlob,DOCUMENT_IMPORT_LIMITS} from './dist/document-import.js';
import {renderMarkdown,validateChapterFigures,buildEpub} from './dist/export.js';

const window=new Window();globalThis.DOMParser=window.DOMParser;
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64'));
const files=(map,level=6)=>zipSync(Object.fromEntries(Object.entries(map).map(([k,v])=>[k,typeof v==='string'?strToU8(v):v])),{level});
const file=(bytes,name='book.docx')=>({name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});
const word=body=>`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}</w:body></w:document>`;
const p=text=>`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const heading=text=>`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const docx=(body,extra={})=>({'word/document.xml':word(body),'docProps/core.xml':'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>가져온 책</dc:title><dc:creator>홍길동</dc:creator></cp:coreProperties>',...extra});
const xhtml=body=>`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>장</title></head><body>${body}</body></html>`;
const epub=(extra={},spine='<itemref idref="two"/><itemref idref="one"/>')=>({mimetype:'application/epub+zip','META-INF/container.xml':'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>','EPUB/package.opf':`<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB 제목</dc:title><dc:creator>작가</dc:creator><dc:language>ko</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="pic.png" media-type="image/png" properties="cover-image"/></manifest><spine>${spine}</spine></package>`,'EPUB/one.xhtml':xhtml('<h1>먼저 작성한 장</h1><p>첫 파일 본문</p>'),'EPUB/two.xhtml':xhtml('<h1>읽기 첫 장</h1><p><strong>강조</strong> 내용 <a href="#note">[1]</a></p><img src="pic.png" alt="작은 점"/><aside id="note"><p>[1] 각주 본문</p></aside>'),'EPUB/pic.png':png,...extra});

test('DOCX keeps chapter order, metadata, basic Markdown and retained original byte-for-byte',async()=>{
 const bytes=files(docx(heading('1장 시작')+p('안녕하세요 &amp; 반갑습니다')+heading('2장 마침')+'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>중요</w:t></w:r></w:p>'));
 const result=await importDocument(file(bytes));assert.equal(result.project.title,'가져온 책');assert.equal(result.project.author,'홍길동');assert.deepEqual(result.project.chapters.map(c=>c.title),['1장 시작','2장 마침']);assert.match(result.project.chapters[0].content,/안녕하세요 & 반갑습니다/);assert.match(result.project.chapters[1].content,/\*\*중요\*\*/);assert.equal(result.project.documentSource,result.source);assert.deepEqual(new Uint8Array(await documentSourceBlob(result.source).arrayBuffer()),bytes);assert.ok(result.warnings.length);
});
test('DOCX images become validated portable folio assets and notes become chapter endnotes',async()=>{
 const body=heading('본문')+'<w:p><w:r><w:t>문장</w:t><w:footnoteReference w:id="2"/></w:r></w:p><w:p><w:r><w:drawing><wp:docPr id="1" descr="대체 설명"/><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>';
 const result=await importDocument(file(files(docx(body,{'word/_rels/document.xml.rels':'<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pic.png"/></Relationships>','word/media/pic.png':png,'word/footnotes.xml':'<w:footnotes xmlns:w="urn:w"><w:footnote w:id="2"><w:p><w:r><w:t>보충 설명</w:t></w:r></w:p></w:footnote></w:footnotes>'}))));
 const chapter=result.project.chapters[0];assert.equal(validateChapterFigures(chapter.figures).length,1);assert.match(chapter.content,/folio-asset:import-image-1/);assert.match(chapter.content,/\[각주 2\] 보충 설명/);assert.match(renderMarkdown(chapter.content,{figures:chapter.figures}),/data:image\/png;base64/);
});
test('DOCX lists and tables convert with visible limitation warnings',async()=>{
 const result=await importDocument(file(files(docx('<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>목록</w:t></w:r></w:p><w:tbl><w:tr><w:tc>'+p('제목')+'</w:tc><w:tc>'+p('값')+'</w:tc></w:tr><w:tr><w:tc>'+p('A')+'</w:tc><w:tc>'+p('B')+'</w:tc></w:tr></w:tbl>'))));assert.match(result.project.chapters[0].content,/- 목록/);assert.match(result.project.chapters[0].content,/\| 제목 \| 값 \|/);assert.ok(result.warnings.some(s=>s.includes('셀 병합')));
});
test('EPUB uses spine ordering rather than ZIP names and preserves cover, images and notes',async()=>{
 const result=await importDocument(file(files(epub()),'book.epub'));assert.deepEqual(result.project.chapters.map(c=>c.title),['읽기 첫 장','먼저 작성한 장']);assert.match(result.project.chapters[0].content,/각주 본문/);assert.match(result.project.chapters[0].content,/\*\*강조\*\*/);assert.equal(result.project.chapters[0].figures.length,1);assert.ok(result.project.coverImage.src.startsWith('data:image/png'));assert.equal(result.project.language,'ko');assert.equal(result.source.format,'epub');
});
test('unsupported SVG and formula styling is reported, never injected as raw markup',async()=>{
 const result=await importDocument(file(files(epub({'EPUB/two.xhtml':xhtml('<h1>그림</h1><svg xmlns="http://www.w3.org/2000/svg"><text>그림</text></svg><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>')})),'book.epub'));assert.match(result.project.chapters[0].content,/SVG 이미지/);assert.ok(result.warnings.some(s=>s.includes('수식')));assert.doesNotMatch(result.project.chapters[0].content,/<svg|<math/);
});
test('ordinary external hyperlinks keep visible text without network addresses',async()=>{
 const result=await importDocument(file(files(epub({'EPUB/two.xhtml':xhtml('<p><a href="https://example.com/private">참고 문구</a></p>')})),'book.epub'));assert.match(result.project.chapters[0].content,/참고 문구/);assert.doesNotMatch(result.project.chapters[0].content,/https:/);assert.ok(result.warnings.some(s=>s.includes('하이퍼링크')));
});
for(const [label,map,name] of [
 ['ZIP traversal',docx(p('본문'),{'../escape.xml':'x'}),'book.docx'],
 ['ZIP absolute path',docx(p('본문'),{'/escape.xml':'x'}),'book.docx'],
 ['macro object',docx(p('본문'),{'word/vbaProject.bin':'macro'}),'book.docx'],
 ['external image relationship',docx(p('본문'),{'word/_rels/document.xml.rels':'<Relationships><Relationship Id="r1" Type="image" Target="https://example.com/a.png" TargetMode="External"/></Relationships>'}),'book.docx'],
 ['DTD and entity',{'word/document.xml':'<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///secret">]><x>&secret;</x>'},'book.docx'],
 ['EPUB script',epub({'EPUB/two.xhtml':xhtml('<script>alert(1)</script>')}),'book.epub'],
 ['EPUB event attribute',epub({'EPUB/two.xhtml':xhtml('<p onclick="evil()">본문</p>')}),'book.epub'],
 ['EPUB javascript link',epub({'EPUB/two.xhtml':xhtml('<a href="javascript:alert(1)">본문</a>')}),'book.epub'],
 ['EPUB remote image',epub({'EPUB/two.xhtml':xhtml('<img src="https://example.com/a.png"/>')}),'book.epub'],
 ['EPUB remote stylesheet',epub({'EPUB/two.xhtml':xhtml('<link rel="stylesheet" href="https://example.com/a.css"/>')}),'book.epub'],
 ['EPUB DRM',epub({'META-INF/encryption.xml':'<encryption/>'}),'book.epub'],
 ['EPUB invalid spine',epub({},'<itemref idref="missing"/>'),'book.epub'],
 ['EPUB duplicate spine',epub({},'<itemref idref="one"/><itemref idref="one"/>'),'book.epub'],
 ['DOCX altchunk',docx('<w:altChunk/>'),'book.docx'],
])test(`rejects ${label} without changing the selected original`,async()=>{const bytes=files(map),before=bytes.slice();await assert.rejects(()=>importDocument(file(bytes,name)));assert.deepEqual(bytes,before);});
test('ZIP CRC corruption, duplicate paths, overlapping entries and declared expansion bombs are rejected',async()=>{
 const original=files(docx(p('본문')),0),view=new DataView(original.buffer);let central=original.findIndex((_,i)=>i+4<original.length&&view.getUint32(i,true)===0x02014b50);
 const corrupt=original.slice();corrupt[40]^=1;await assert.rejects(()=>importDocument(file(corrupt)));
 const bomb=original.slice(),bombView=new DataView(bomb.buffer);bombView.setUint32(central+24,DOCUMENT_IMPORT_LIMITS.entryBytes+1,true);await assert.rejects(()=>importDocument(file(bomb)),/크기/);
 const overlap=original.slice(),overlapView=new DataView(overlap.buffer),next=central+46+view.getUint16(central+28,true)+view.getUint16(central+30,true)+view.getUint16(central+32,true);overlapView.setUint32(next+42,0,true);await assert.rejects(()=>importDocument(file(overlap)));
 const duplicate=files({'same1.xml':'a','same2.xml':'b','word/document.xml':word(p('x'))},0);let replacements=0;for(let i=0;i<duplicate.length-9;i++){if(new TextDecoder().decode(duplicate.slice(i,i+9))==='same2.xml'){duplicate.set(strToU8('same1.xml'),i);replacements++;}}assert.equal(replacements,2);await assert.rejects(()=>importDocument(file(duplicate)),/중복/);
});
test('file, XML and chapter-image budgets are enforced before constructing a project',async()=>{
 await assert.rejects(()=>importDocument({name:'large.docx',size:DOCUMENT_IMPORT_LIMITS.fileBytes+1,arrayBuffer(){throw Error('must not read');}}),/16 MiB/);
 await assert.rejects(()=>importDocument(file(files({'word/document.xml':word(p('x'.repeat(DOCUMENT_IMPORT_LIMITS.xmlBytes)))}))),/2 MiB/);
 const body='<h1>사진</h1>'+Array(21).fill('<img src="pic.png"/>').join('');await assert.rejects(()=>importDocument(file(files(epub({'EPUB/two.xhtml':xhtml(body)})),'book.epub')),/20개/);
});
test('abort before and after file read returns no project',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(()=>importDocument(file(files(docx(p('x')))),{signal:controller.signal}),{name:'AbortError'});
 const after=new AbortController(),bytes=files(docx(p('x')));await assert.rejects(()=>importDocument({name:'book.docx',size:bytes.length,async arrayBuffer(){after.abort();return bytes.buffer;}},{signal:after.signal}),{name:'AbortError'});
});
test('original source validator accepts JSON backup round trip and rejects malformed bytes or metadata',async()=>{
 const result=await importDocument(file(files(docx(p('본문')))));const copy=JSON.parse(JSON.stringify(result.source));assert.equal(validateDocumentSource(copy),copy);assert.equal(validateDocumentSource(undefined),undefined);
 for(const change of [{bytes:copy.bytes+1},{base64:'<script>'},{mimeType:'text/html'},{format:'html'},{name:'../book.docx'},{name:'file.html'},{warnings:['x'.repeat(2001)]},{importedAt:'invalid'}])assert.throws(()=>validateDocumentSource({...copy,...change}));
});
test('vendored ZIP library is exact pinned upstream version with license and small footprint',async()=>{
 const bytes=await readFile(new URL('./dist/vendor/fflate-0.8.2.js',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),'8cc1f687e0159e977addb6b85e274dbd11e622cf151f4fcb7b85d49622ea43e7');assert.ok(bytes.length<100000);assert.match(await readFile(new URL('./dist/vendor/fflate-LICENSE.txt',import.meta.url),'utf8'),/MIT License/);
});
test('Folio generated EPUB can be reimported with all chapter text and image data',async()=>{
 const project={id:'round-trip',title:'재가져오기',author:'작가',description:'설명',language:'ko',theme:'sage',chapters:[{id:'one',title:'장 하나',content:'본문 원문 **강조**',figures:[]},{id:'two',title:'장 둘',content:'마지막 문장'}]};
 const bytes=await buildEpub(project);const result=await importDocument(file(bytes,'folio.epub'));assert.equal(result.project.title,project.title);const text=result.project.chapters.map(c=>c.content).join('\n');assert.match(text,/본문 원문/);assert.match(text,/마지막 문장/);
});
test('forged small expansion size cannot silently truncate a much larger DEFLATE stream',async()=>{
 const bytes=files({'word/document.xml':word(p('압축폭탄'.repeat(100000)))}),view=new DataView(bytes.buffer);let central=bytes.findIndex((_,i)=>i+4<bytes.length&&view.getUint32(i,true)===0x02014b50);view.setUint32(22,1,true);view.setUint32(central+24,1,true);view.setUint32(14,0,true);view.setUint32(central+16,0,true);await assert.rejects(()=>importDocument(file(bytes)),/압축 데이터를/);
});
test('aborting during a multi-entry archive prevents project construction',async()=>{
 const map=docx(p('유지'));for(let i=0;i<100;i++)map[`unused/${i}.txt`]='x';const bytes=files(map),controller=new AbortController();setTimeout(()=>controller.abort(),0);await assert.rejects(()=>importDocument(file(bytes),{signal:controller.signal}),{name:'AbortError'});
});
test('percent encoded parent paths cannot escape the package and double encoded references are rejected',async()=>{
 await assert.rejects(()=>importDocument(file(files(epub({'EPUB/two.xhtml':xhtml('<img src="%2e%2e/%2e%2e/escape.png"/>')})),'book.epub')),/압축 파일 밖/);
 await assert.rejects(()=>importDocument(file(files(epub({'EPUB/two.xhtml':xhtml('<img src="%252e%252e/pic.png"/>')})),'book.epub')),/경로/);
});
test('declared image MIME mismatch and deeply nested XML fail without modifying originals',async()=>{
 await assert.rejects(()=>importDocument(file(files(epub({'EPUB/pic.png':strToU8('<svg/>')})),'book.epub')),/이미지 형식/);
 await assert.rejects(()=>importDocument(file(files(docx('<w:sdt>'.repeat(130)+p('본문')+'</w:sdt>'.repeat(130))))),/구조가 너무 깊/);
});
