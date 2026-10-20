import {Inflate} from './vendor/fflate-0.8.2.js';
import {validateImageSource, validateChapterFigures} from './export.js';

/** Local, bounded conversion. Original package bytes never enter the DOM or a network request. */
export const DOCUMENT_IMPORT_LIMITS = Object.freeze({fileBytes:16*1024*1024,expandedBytes:48*1024*1024,entryBytes:12*1024*1024,xmlBytes:2*1024*1024,entries:1200,characters:1000000,chapters:1000,images:200});
const MIMES={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',epub:'application/epub+zip'};
const decoder=new TextDecoder('utf-8',{fatal:true});
const local=node=>(node.localName||node.nodeName||'').split(':').pop().toLowerCase();
const elements=node=>Array.from(node?.childNodes||[]).filter(n=>n.nodeType===1);
const all=(node,name)=>Array.from(node.getElementsByTagName('*')).filter(n=>name==='*'||local(n)===name.toLowerCase());
const first=(node,name)=>all(node,name)[0];
const attr=(node,name)=>Array.from(node?.attributes||[]).find(a=>local(a)===name.toLowerCase())?.value||'';
const plain=node=>String(node?.textContent||'').replace(/\s+/g,' ').trim();
const markdown=value=>String(value||'').replace(/[\\`*_[\]<>!|]/g,'\\$&');
const abort=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('가져오기를 취소했습니다.','AbortError');};
const breathe=async signal=>{await new Promise(resolve=>setTimeout(resolve,0));abort(signal);};
const fail=(message,code='DOCUMENT_IMPORT_INVALID')=>{const error=new Error(message);error.code=code;throw error;};
function warning(context,message){if(!context.warnings.includes(message))context.warnings.push(message);}
function b64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
function unb64(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
function path(value){
 if(typeof value!=='string'||!value||value.length>1024||/[\\\u0000-\u001f\u007f:#?%]/.test(value)||value.startsWith('/')||value.split('/').some(p=>p==='.'||p==='..'||p===''))fail('압축 파일에 안전하지 않은 경로가 있습니다.');
 return value;
}
function resolvePath(base,reference){
 if(typeof reference!=='string'||!reference||/^[a-z][a-z\d+.-]*:|^[/\\]/i.test(reference)||/[\\\u0000-\u001f]/.test(reference))fail('외부 파일 참조는 가져올 수 없습니다.');
 let decoded;try{decoded=decodeURIComponent(reference.split('#')[0]);}catch{fail('파일 참조 경로가 잘못되었습니다.');}
 const parts=base.split('/').slice(0,-1);for(const part of decoded.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)fail('압축 파일 밖을 참조하는 경로가 있습니다.');parts.pop();}else parts.push(part);}
 return path(parts.join('/'));
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}

/** Inspect central/local records BEFORE inflating. ZIP64, encryption and symlinks are deliberately unsupported. */
async function readZip(bytes,signal){
 const limits=DOCUMENT_IMPORT_LIMITS, view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), entries=new Map(),ranges=[];
 const u16=i=>view.getUint16(i,true),u32=i=>view.getUint32(i,true);
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break;}
 if(end<0)fail('DOCX/EPUB 압축 파일이 손상되었거나 완전하지 않습니다.');
 const count=u16(end+10),central=u32(end+16),centralSize=u32(end+12);
 if(u16(end+4)||u16(end+6)||count!==u16(end+8)||count===65535||count>limits.entries||central+centralSize!==end)fail('지원하지 않는 압축 형식이거나 파일 수 제한을 초과했습니다.');
 let cursor=central,total=0;
 for(let i=0;i<count;i++){
  abort(signal);if(cursor+46>end||u32(cursor)!==0x02014b50)fail('압축 파일의 목차가 손상되었습니다.');
  const flags=u16(cursor+8),method=u16(cursor+10),checksum=u32(cursor+16),compressed=u32(cursor+20),size=u32(cursor+24),nameLength=u16(cursor+28),extra=u16(cursor+30),comment=u16(cursor+32),offset=u32(cursor+42),mode=u32(cursor+38)>>>16;
  if(cursor+46+nameLength+extra+comment>end||flags&0x2041||![0,8].includes(method)||(mode&0xf000)===0xa000||u16(cursor+34))fail('암호화·링크·지원하지 않는 압축 파일은 가져올 수 없습니다.');
  let name;try{name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));}catch{fail('압축 파일 이름은 UTF-8이어야 합니다.');}
  const directory=name.endsWith('/');path(directory?name.slice(0,-1):name);
  if(entries.has(name))fail('같은 파일 경로가 중복된 압축 파일입니다.');
  if(size>limits.entryBytes||(total+=size)>limits.expandedBytes)fail('압축 해제 크기가 안전 제한(파일 12 MiB·합계 48 MiB)을 초과합니다.','DOCUMENT_IMPORT_LIMIT');
  if(offset+30>central||u32(offset)!==0x04034b50||u16(offset+6)!==flags||u16(offset+8)!==method)fail('압축 파일의 본문과 목차가 일치하지 않습니다.');
  const localNameLength=u16(offset+26),data=offset+30+localNameLength+u16(offset+28);
  if(data+compressed>central||decoder.decode(bytes.subarray(offset+30,offset+30+localNameLength))!==name)fail('압축 파일의 본문 경로 또는 크기가 잘못되었습니다.');
  if(!(flags&8)&&(u32(offset+14)!==checksum||u32(offset+18)!==compressed||u32(offset+22)!==size))fail('압축 파일의 크기 또는 체크섬이 일치하지 않습니다.');
  if(directory&&(size||compressed))fail('압축 폴더에 잘못된 데이터가 있습니다.');
  ranges.push([offset,data+compressed]);entries.set(name,{name,size,compressed,method,checksum,data,directory});cursor+=46+nameLength+extra+comment;
 }
 if(cursor!==end)fail('압축 파일의 목차 길이가 잘못되었습니다.');
 ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])fail('압축 데이터 영역이 겹쳐 있습니다.');
 let contextEntries=0;
 for(const entry of entries.values()){
  abort(signal);const compressed=bytes.subarray(entry.data,entry.data+entry.compressed);let output;
  try{
   if(entry.method===0)output=compressed;
   else{
    // Do not trust a forged central-directory size. Small compressed chunks bound each
    // allocation; stop at the declared limit before collecting any excess output.
    output=new Uint8Array(entry.size);let written=0;
    const stream=new Inflate(chunk=>{if(written+chunk.length>entry.size)fail('실제 압축 해제 크기가 선언된 제한을 초과합니다.');output.set(chunk,written);written+=chunk.length;});
    for(let start=0;start<compressed.length;start+=1024){abort(signal);if(start&&start%65536===0)await breathe(signal);stream.push(compressed.subarray(start,start+1024),start+1024>=compressed.length);}
    if(written!==entry.size)fail('실제 압축 해제 크기가 일치하지 않습니다.');
   }
  }catch(error){if(error?.name==='AbortError')throw error;fail(`압축 데이터를 읽을 수 없습니다: ${entry.name}`);}
  if(output.length!==entry.size||crc32(output)!==entry.checksum)fail(`압축 파일 검증에 실패했습니다: ${entry.name}`);
  entry.bytes=output;
  if(entries.size>32&&++contextEntries%32===0)await breathe(signal);
 }
 return entries;
}
function textFile(context,name,required=true){const entry=context.files.get(name);if(!entry){if(required)fail(`필수 파일이 없습니다: ${name}`);return '';}
 if(entry.size>DOCUMENT_IMPORT_LIMITS.xmlBytes)fail(`문서 구성 파일이 2 MiB를 초과합니다: ${name}`,'DOCUMENT_IMPORT_LIMIT');
 try{return decoder.decode(entry.bytes);}catch{fail(`UTF-8 문서를 읽을 수 없습니다: ${name}`);}}
function xml(context,name,required=true){let text=textFile(context,name,required);if(!text&&!required)return null;
 // EPUB 3 commonly includes the inert HTML5 doctype; external/subset DTDs stay forbidden.
 text=text.replace(/<!DOCTYPE\s+html\s*>/ig,'');
 if(/<!\s*(?:DOCTYPE|ENTITY)|<\?(?!xml\s)/i.test(text)||/\u0000/.test(text))fail(`외부 선언·실행 지시가 포함된 XML은 지원하지 않습니다: ${name}`);
 if(typeof DOMParser==='undefined')fail('이 브라우저는 XML 문서 가져오기를 지원하지 않습니다.');
 const doc=new DOMParser().parseFromString(text,'application/xml');if(!doc.documentElement||all(doc,'parsererror').length||local(doc.documentElement)==='parsererror')fail(`XML 문서가 올바르지 않습니다: ${name}`);
 const nodes=all(doc,'*');if(nodes.length>50000)fail('문서 구조가 너무 복잡합니다.');for(const node of nodes){let depth=0,parent=node;while(parent=parent.parentNode)if(++depth>128)fail('문서 구조가 너무 깊습니다.');}return doc;
}
function project(context,title,author='',language='ko',description=''){
 return {id:`import-${crypto.randomUUID()}`,title:(title||context.name.replace(/\.(docx|epub)$/i,'')).slice(0,200),author:author.slice(0,120),subtitle:'',description:description.slice(0,4000),language:language.slice(0,40)||'ko',theme:'sage',genre:'가져온 원고',updatedAt:new Date().toISOString(),chapters:[]};
}
function addChapter(context,book,title,content,figures=[]){
 if(book.chapters.length>=DOCUMENT_IMPORT_LIMITS.chapters)fail('장 수는 최대 1,000개까지 가져올 수 있습니다.','DOCUMENT_IMPORT_LIMIT');
 context.characters+=content.length;if(context.characters>DOCUMENT_IMPORT_LIMITS.characters)fail('가져온 본문이 100만자를 초과합니다.','DOCUMENT_IMPORT_LIMIT');
 const chapter={id:`import-chapter-${book.chapters.length+1}`,title:(title||`제${book.chapters.length+1}장`).slice(0,200),content:content.trim()};
 if(figures.length)chapter.figures=validateChapterFigures(figures);book.chapters.push(chapter);
}
function image(context,name,alt,figures){
 const mime=/\.png$/i.test(name)?'image/png':/\.jpe?g$/i.test(name)?'image/jpeg':/\.webp$/i.test(name)?'image/webp':null;
 if(!mime){warning(context,'PNG·JPEG·WebP 이외의 이미지(SVG·GIF·EMF 등)는 제외했습니다. 원본 파일에 보존되어 있습니다.');return `[이미지: ${markdown(alt||name.split('/').pop())}]`;}
 const entry=context.files.get(name);if(!entry)fail(`본문이 참조하는 이미지가 없습니다: ${name}`);
 if(figures.length>=20||context.images>=DOCUMENT_IMPORT_LIMITS.images)fail('이미지는 한 장당 20개, 책 전체 200개까지 가져올 수 있습니다.','DOCUMENT_IMPORT_LIMIT');
 let src;try{src=validateImageSource(`data:${mime};base64,${b64(entry.bytes)}`);}catch{fail(`이미지 형식이 올바르지 않습니다: ${name}`);}
 const id=`import-image-${++context.images}`,label=(alt||name.split('/').pop()).slice(0,2000);figures.push({id,src,alt:label,caption:''});return `![${markdown(label)}](folio-asset:${id})`;
}

function relationships(context,owner){
 const base=owner.split('/'),file=base.pop(),name=[...base,'_rels',file+'.rels'].join('/'),doc=xml(context,name,false),result=new Map();
 if(!doc)return result;
 for(const item of all(doc,'relationship')){const id=attr(item,'id'),target=attr(item,'target'),type=attr(item,'type'),external=attr(item,'targetmode').toLowerCase()==='external';
  if(!id||result.has(id))fail('문서 연결 ID가 중복되거나 없습니다.');
  if(external){if(/\/hyperlink$/.test(type)){warning(context,'외부 하이퍼링크는 링크 주소를 제외하고 표시 문구만 가져왔습니다.');result.set(id,{external:true,type});continue;}fail('외부 이미지·연결 문서는 가져올 수 없습니다.');}
  result.set(id,{path:resolvePath(owner,target),type});
 }return result;
}
function importDocx(context){
 if([...context.files.keys()].some(p=>/vbaProject|activeX|embeddings\//i.test(p)))fail('매크로·ActiveX·삽입 실행 객체가 있는 문서는 가져올 수 없습니다.');
 const doc=xml(context,'word/document.xml'),rels=relationships(context,'word/document.xml'),core=xml(context,'docProps/core.xml',false),styles=xml(context,'word/styles.xml',false),styleLevels=new Map();
 for(const style of styles?all(styles,'style'):[]){const id=attr(style,'styleId'),outline=first(style,'outlineLvl'),name=attr(first(style,'name'),'val');if(outline)styleLevels.set(id,Number(attr(outline,'val'))+1);else if(/^(?:heading|제목)\s*([1-6])$/i.test(name))styleLevels.set(id,Number(name.match(/([1-6])$/)[1]));}
 const book=project(context,plain(first(core||doc,'title')),plain(first(core||doc,'creator')),plain(first(core||doc,'language'))||'ko',plain(first(core||doc,'description')));
 const notes=new Map();for(const [file,tag] of [['word/footnotes.xml','footnote'],['word/endnotes.xml','endnote']]){const noteDoc=xml(context,file,false);if(noteDoc)for(const note of all(noteDoc,tag)){const id=attr(note,'id');if(Number(id)>=0&&plain(note))notes.set(`${tag}:${id}`,plain(note));}}
 let title=book.title,lines=[],figures=[],references=[];
 const flush=()=>{if(lines.join('').trim()||figures.length)addChapter(context,book,title,lines.join('\n\n')+(references.length?'\n\n### 주석\n\n'+references.map(([label,value])=>`[${label}] ${markdown(value)}`).join('\n\n'):''),figures);lines=[];figures=[];references=[];};
 function inline(node){const tag=local(node);if(tag==='t')return markdown(node.textContent||'');if(tag==='tab')return ' ';if(['br','cr'].includes(tag))return '\n';
  if(tag==='del') {warning(context,'변경 내용 추적의 삭제 문구는 제외하고 현재 본문을 가져왔습니다. 변경 이력은 원본에 남아 있습니다.');return '';}
  if(['footnotereference','endnotereference'].includes(tag)){const kind=tag==='footnotereference'?'footnote':'endnote',id=attr(node,'id'),value=notes.get(`${kind}:${id}`),label=`${kind==='footnote'?'각주':'미주'} ${id}`;if(value&&!references.some(n=>n[0]===label))references.push([label,value]);if(!value)warning(context,'일부 주석 본문을 찾지 못했습니다. 원본의 주석을 확인해 주세요.');return `[${label}]`;}
  if(tag==='drawing'||tag==='pict'){const reference=first(node,'blip')||first(node,'imagedata'),id=attr(reference,'embed')||attr(reference,'id'),relation=rels.get(id);if(!relation||relation.external)fail('삽화 연결을 읽을 수 없습니다.');const properties=first(node,'docpr');return image(context,relation.path,attr(properties,'descr')||attr(properties,'title'),figures);}
  if(['instrtext','fldchar','commentreference'].includes(tag)){warning(context,'필드 명령·댓글·변경 이력·페이지 머리말/꼬리말은 가져오지 않습니다. 본문 표시 결과와 원본을 확인해 주세요.');return '';}
  const value=elements(node).map(inline).join('');if(tag==='r'&&value.trim()){const properties=elements(node).find(n=>local(n)==='rpr'),bold=properties&&first(properties,'b'),italic=properties&&first(properties,'i');return bold&&attr(bold,'val')!=='0'?`**${value}**`:italic&&attr(italic,'val')!=='0'?`*${value}*`:value;}return value;
 }
 function block(node){const tag=local(node);if(tag==='p'){const properties=elements(node).find(n=>local(n)==='ppr'),style=attr(properties&&first(properties,'pstyle'),'val'),outline=properties&&first(properties,'outlinelvl'),level=outline?Number(attr(outline,'val'))+1:styleLevels.get(style)||Number(style.match(/^(?:heading|제목)\s*([1-6])$/i)?.[1]||0),value=inline(node).trim();if(!value)return;
   if(level===1){flush();title=plain(node)||`제${book.chapters.length+1}장`;return;}
   const numbered=properties&&first(properties,'numpr');if(numbered)warning(context,'목록은 글머리표로 통일했습니다. 번호 재시작·다단계 번호는 원본과 대조해 주세요.');lines.push(level>1?'#'.repeat(Math.min(6,level))+' '+value:numbered?'- '+value:value);
  }else if(tag==='tbl'){const rows=elements(node).filter(n=>local(n)==='tr').map(row=>elements(row).filter(n=>local(n)==='tc').map(cell=>elements(cell).map(inline).join(' ').replace(/\n/g,' ').trim()));if(rows.length){const width=Math.max(...rows.map(r=>r.length));lines.push(rows.map((r,i)=>'| '+Array.from({length:width},(_,j)=>r[j]||'').join(' | ')+' |'+(i===0?'\n| '+Array(width).fill('---').join(' | ')+' |':'')).join('\n'));warning(context,'표는 첫 행을 머리글로 사용하는 Markdown 표로 바꿨습니다. 셀 병합·테두리·너비는 유지되지 않습니다.');}}
  else if(tag==='altchunk')fail('외부/삽입 HTML 본문(altChunk)은 지원하지 않습니다.');else if(!['sectpr'].includes(tag))elements(node).forEach(block);
 }
 const body=first(doc,'body');if(!body)fail('Word 본문이 없습니다.');elements(body).forEach(block);flush();
 warning(context,'DOCX의 본문·제목·기본 강조·목록·표·래스터 이미지·텍스트 주석을 변환했습니다. 글꼴·여백·쪽 나눔·떠 있는 개체 배치는 새 책 스타일로 바뀝니다.');
 return book;
}

function validateXhtml(doc,name){
 for(const node of [doc.documentElement,...all(doc,'*')]){
  if(['script','iframe','object','embed','form','input','button','audio','video','foreignobject'].includes(local(node)))fail(`실행/미디어 콘텐츠가 있는 EPUB 본문은 지원하지 않습니다: ${name}`);
  for(const a of Array.from(node.attributes||[])){
   if(/^on/i.test(a.name)||local(a)==='base'||(/^(?:src|href)$/i.test(local(a))&&/^\s*(?:javascript|data):/i.test(a.value)))fail(`실행 가능한 속성이 있는 EPUB 본문입니다: ${name}`);
   if(local(node)!=='a'&&/^(?:src|href)$/i.test(local(a))&&/^\s*(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(a.value))fail(`외부 자료를 참조하는 EPUB 본문입니다: ${name}`);
  }
 }
}
function importEpub(context){
 if(textFile(context,'mimetype')!=='application/epub+zip')fail('EPUB 형식 식별자가 올바르지 않습니다.');
 if(context.files.has('META-INF/encryption.xml')||context.files.has('META-INF/rights.xml'))fail('DRM 또는 암호화된 EPUB은 가져올 수 없습니다.');
 const container=xml(context,'META-INF/container.xml'),rootfile=first(container,'rootfile'),opfName=path(attr(rootfile,'full-path')),opf=xml(context,opfName),metadata=first(opf,'metadata'),manifest=first(opf,'manifest'),spine=first(opf,'spine');
 if(!metadata||!manifest||!spine)fail('EPUB의 메타데이터·파일 목록·읽기 순서가 필요합니다.');
 const book=project(context,plain(first(metadata,'title')),plain(first(metadata,'creator')),plain(first(metadata,'language'))||'ko',plain(first(metadata,'description'))),items=new Map();
 for(const item of elements(manifest)){if(local(item)!=='item')continue;const id=attr(item,'id'),name=resolvePath(opfName,attr(item,'href')),media=attr(item,'media-type'),properties=attr(item,'properties').split(/\s+/);if(!id||items.has(id))fail('EPUB 파일 ID가 중복되거나 없습니다.');if(properties.includes('scripted')||properties.includes('remote-resources'))fail('스크립트·원격 자료를 사용하는 EPUB은 가져올 수 없습니다.');items.set(id,{name,media,properties});}
 const used=new Set();for(const ref of elements(spine)){
  if(local(ref)!=='itemref')continue;const item=items.get(attr(ref,'idref'));if(!item)fail('EPUB 읽기 순서가 없는 파일을 참조합니다.');if(used.has(item.name))fail('EPUB 읽기 순서에 같은 본문이 중복되어 있습니다.');used.add(item.name);
  if(item.media!=='application/xhtml+xml')fail('XHTML 형식의 EPUB 본문만 가져올 수 있습니다.');
  const doc=xml(context,item.name);validateXhtml(doc,item.name);const body=first(doc,'body');if(!body)fail(`EPUB 본문이 없습니다: ${item.name}`);const figures=[];
  if(attr(ref,'linear')==='no')warning(context,'보조 본문(linear=no)도 EPUB 읽기 순서에 따라 별도 장으로 가져왔습니다.');
  function convert(node){if(node.nodeType===3)return markdown(node.textContent||'').replace(/\s+/g,' ');if(node.nodeType!==1)return '';const tag=local(node);
   if(['head','style','link','title','meta'].includes(tag))return '';
   if(tag==='img'){const src=attr(node,'src');return '\n\n'+image(context,resolvePath(item.name,src),attr(node,'alt'),figures)+'\n\n';}
   if(tag==='svg'){warning(context,'SVG 삽화는 편집용 원고에서 제외했습니다. 원본 EPUB에 보존되어 있습니다.');return '\n\n[SVG 이미지]\n\n';}
   if(tag==='math'){warning(context,'수식은 텍스트로 변환했습니다. 수식 배치는 원본과 대조해 주세요.');return markdown(plain(node));}
   const value=Array.from(node.childNodes).map(convert).join('');
   if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+value.trim()+'\n\n';
   if(['strong','b'].includes(tag))return `**${value}**`;if(['em','i'].includes(tag))return `*${value}*`;if(tag==='br')return '\n';if(tag==='hr')return '\n\n---\n\n';
   if(tag==='li')return '\n- '+value.trim();if(['ul','ol'].includes(tag))return '\n'+value+'\n';if(tag==='blockquote')return '\n\n'+value.trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
   if(tag==='a'){const href=attr(node,'href');if(href&&!href.startsWith('#'))warning(context,'외부/문서 간 하이퍼링크는 표시 문구만 가져왔습니다. 각주 번호와 주석 본문은 유지합니다.');return value;}
   if(tag==='table'){warning(context,'EPUB 표는 셀 내용을 읽기 순서대로 텍스트로 변환했습니다. 표 배치는 원본과 대조해 주세요.');return '\n\n'+value+'\n\n';}if(['td','th'].includes(tag))return value.trim()+' · ';if(tag==='tr')return value.trim()+'\n';
   if(['p','div','section','article','aside','figure','figcaption','pre','dl','dt','dd'].includes(tag))return '\n\n'+value.trim()+'\n\n';return value;
  }
  const heading=first(body,'h1')||first(body,'h2'),title=plain(heading)||plain(first(doc,'title'))||`제${book.chapters.length+1}장`;
  let content=convert(body).replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if(heading&&content.startsWith('#'.repeat(Number(local(heading)[1]))+' '+markdown(plain(heading))))content=content.slice(content.indexOf('\n')+1).trim();
  addChapter(context,book,title,content,figures);
 }
 const cover=[...items.values()].find(item=>item.properties.includes('cover-image'));if(cover&&/image\/(png|jpeg|webp)/.test(cover.media)){const figures=[];image(context,cover.name,book.title,figures);book.coverImage={...figures[0]};delete book.coverImage.id;}
 warning(context,'EPUB의 읽기 순서·제목·본문·기본 강조·래스터 이미지를 가져왔습니다. 각주/미주는 본문 위치에 텍스트로 유지합니다. CSS·글꼴·정밀 조판·고정 레이아웃은 새 책 스타일로 바뀝니다.');return book;
}

export function validateDocumentSource(value){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||!Object.hasOwn(MIMES,value.format)||value.mimeType!==MIMES[value.format]||typeof value.name!=='string'||!value.name||value.name.length>255||/[\\/\u0000-\u001f]/.test(value.name)||!Number.isInteger(value.bytes)||value.bytes<1||value.bytes>DOCUMENT_IMPORT_LIMITS.fileBytes||typeof value.base64!=='string'||value.base64.length!==Math.ceil(value.bytes/3)*4||/[^A-Za-z0-9+/=]/.test(value.base64)||!/^={0,2}$/.test(value.base64.slice(value.base64.indexOf('=')<0?value.base64.length:value.base64.indexOf('=')))||typeof value.importedAt!=='string'||!Number.isFinite(Date.parse(value.importedAt))||!Array.isArray(value.warnings)||value.warnings.length>100||value.warnings.some(w=>typeof w!=='string'||w.length>2000))fail('보존된 원본 문서 정보가 올바르지 않습니다.');
 if(!value.name.toLowerCase().endsWith('.'+value.format))fail('보존된 원본 파일의 확장자가 형식과 일치하지 않습니다.');
 if(unb64(value.base64).length!==value.bytes)fail('보존된 원본 파일의 크기가 일치하지 않습니다.');return value;
}
export function documentSourceBlob(value){const source=validateDocumentSource(value);if(!source)fail('보관된 원본 문서가 없습니다.');return new Blob([unb64(source.base64)],{type:source.mimeType});}
export async function importDocument(file,{signal}={}){
 abort(signal);const name=file?.name,format=typeof name==='string'?name.match(/\.(docx|epub)$/i)?.[1].toLowerCase():null;
 if(!format||!Number.isInteger(file.size)||file.size<1||file.size>DOCUMENT_IMPORT_LIMITS.fileBytes||name.length>255||/[\\/\u0000-\u001f]/.test(name))fail('16 MiB 이하의 DOCX 또는 EPUB 파일을 선택해 주세요.','DOCUMENT_IMPORT_FILE');
 let buffer;try{buffer=await file.arrayBuffer();}catch{fail('파일을 읽지 못했습니다. 원본 파일을 다시 선택해 주세요.');}abort(signal);
 if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==file.size)fail('원본 파일 전체를 읽지 못했습니다.');
 const bytes=new Uint8Array(buffer),context={name,files:await readZip(bytes,signal),warnings:[],characters:0,images:0,signal};
 const book=format==='docx'?importDocx(context):importEpub(context);abort(signal);
 if(!book.chapters.length)fail('가져올 본문을 찾지 못했습니다. 원본 파일은 변경하지 않았습니다.');
 const source={version:1,name,format,mimeType:MIMES[format],bytes:file.size,base64:b64(bytes),importedAt:new Date().toISOString(),warnings:context.warnings};
 book.documentSource=source;return {project:book,warnings:context.warnings,source};
}
