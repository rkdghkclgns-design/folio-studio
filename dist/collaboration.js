/** Portable three-way exchanges. No account, background upload, or implicit overwrite. */
import {normalizeCoverDesign} from './cover.js';
import {reviewSources} from './review-desk.js';
const clone=v=>structuredClone(v),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fields=['title','subtitle','author','description','language','theme','genre','audience','tone','voiceSample','coverImage','coverBackground','coverDesign'];
const MAX_UNITS=2500,MAX_BYTES=64*1024*1024;
const CHAPTER_FIELDS=['title','kind','editorialNotes','imagePrompt','image','figures'];
const MAX_DETAIL_CHAPTERS=100,MAX_PARAGRAPHS=200,MAX_DETAIL_PARAGRAPHS=2000,MAX_PARAGRAPH_TEXT=100000;
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const labelFor=key=>key==='matter:preface'?'시작말':key==='matter:afterword'?'맺음말':key.startsWith('chapter:')?'장 '+key.slice(8):key==='chapter-order'?'목차 순서':key.startsWith('comment:')?'검토 의견':key.startsWith('citation:')?'출처 연결':key.startsWith('approval:')?'검토 완료':key;
function units(project) {
  const entries=fields.map(k=>[k,k==='coverDesign'?normalizeCoverDesign(project[k]):['coverImage','coverBackground'].includes(k)?project[k]??null:project[k]??(k==='language'?'ko':k==='theme'?'sage':'')]);
  for(const role of ['preface','afterword'])entries.push(['matter:'+role,project.bookMatter?.[role]??null]);
  entries.push(['chapter-order',project.chapters.map(c=>c.id)]);
  for(const c of project.chapters)entries.push(['chapter:'+c.id,{id:c.id,title:c.title,content:c.content,kind:c.kind||'',editorialNotes:c.editorialNotes||[],imagePrompt:c.imagePrompt||'',image:c.image??null,figures:c.figures||[]}]);
  for(const [prefix,list] of [['citation',project.reviewDesk?.citations],['comment',project.reviewDesk?.comments],['approval',project.reviewDesk?.approvals]])for(const r of list||[])entries.push([prefix+':'+r.id,r]);
  return new Map(entries);
}
async function digest(value){const bytes=new TextEncoder().encode(JSON.stringify(value??null));const buffer=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');}

// Paragraph units keep their original separators; blank lines inside fenced code
// belong to the same block. No baseline manuscript text is stored in the exchange.
function paragraphBlocks(content) {
  if(typeof content!=='string'||content.length>MAX_PARAGRAPH_TEXT)return null;
  const blocks=[];let block='',separating=false,fence=null;
  for(const line of content.match(/[^\n]*\n|[^\n]+$/g)||[]) {
    const text=line.replace(/\r?\n$/,''),blank=/^[ \t]*$/.test(text);
    if(separating&&!blank){blocks.push(block);block='';separating=false;if(blocks.length>=MAX_PARAGRAPHS)return null;}
    block+=line;
    const marker=text.match(/^ {0,3}(\x60{3,}|~{3,})(.*)$/);
    if(fence){if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim())fence=null;}
    else if(marker)fence=marker[1];
    else if(blank&&block.trim())separating=true;
  }
  if(block||!blocks.length)blocks.push(block);
  return blocks.length<=MAX_PARAGRAPHS?blocks:null;
}
async function createOrigin(project,bookId) {
  const all=units(project),base=await Promise.all([...all].map(async([key,value])=>[key,await digest(value)]));
  const chapterBases=[];let total=0;
  for(const [key,chapter] of all) {
    if(!key.startsWith('chapter:')||chapterBases.length>=MAX_DETAIL_CHAPTERS)continue;
    const blocks=paragraphBlocks(chapter.content);
    if(!blocks||blocks.length<2||total+blocks.length>MAX_DETAIL_PARAGRAPHS||new Set(blocks.map(block=>block.trim())).size!==blocks.length)continue;
    total+=blocks.length;
    chapterBases.push({id:chapter.id,fields:await Promise.all(CHAPTER_FIELDS.map(async field=>[field,await digest(chapter[field])])),paragraphs:await Promise.all(blocks.map(digest))});
  }
  return {version:1,bookId,base,...(chapterBases.length?{chapterBases}: {})};
}
async function mergeChapterParagraphs(local,remote,detail) {
  if(!local||!remote||!detail)return null;
  const merged=clone(local),fieldBase=new Map(detail.fields);
  for(const field of CHAPTER_FIELDS){
    if(same(local[field],remote[field]))continue;
    if(await digest(remote[field])===fieldBase.get(field))continue;
    if(await digest(local[field])===fieldBase.get(field))merged[field]=clone(remote[field]);
    else return null;
  }
  if(local.content===remote.content)return merged;
  const left=paragraphBlocks(local.content),right=paragraphBlocks(remote.content),base=detail.paragraphs;
  if(!left||!right||left.length!==base.length||right.length!==base.length||new Set(base).size!==base.length)return null;
  const lh=await Promise.all(left.map(digest)),rh=await Promise.all(right.map(digest)),positions=new Map(base.map((hash,index)=>[hash,index]));
  // Repeated or moved anchors and adjacent replacement runs do not establish a
  // unique paragraph alignment. Keep the existing explicit chapter conflict.
  const ambiguous=hashes=>{let changedRun=0;for(let index=0;index<hashes.length;index++){
    const hash=hashes[index];if(positions.has(hash)&&positions.get(hash)!==index)return true;
    changedRun=hash===base[index]?0:changedRun+1;if(changedRun>1)return true;
  }return new Set(hashes).size!==hashes.length;};
  if(ambiguous(lh)||ambiguous(rh))return null;
  const blocks=[];
  for(let index=0;index<base.length;index++){
    if(lh[index]===rh[index]||rh[index]===base[index])blocks.push(left[index]);
    else if(lh[index]===base[index])blocks.push(right[index]);
    else return null;
  }
  merged.content=blocks.join('');return merged;
}

export function validateCollaboration(value) {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||typeof value.bookId!=='string'||!value.bookId||value.bookId.length>100||!Array.isArray(value.base)||value.base.length>MAX_UNITS)throw new Error('공유 기준 판본의 형식이 올바르지 않습니다.');
  const seen=new Set(),base=value.base.map(row=>{if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||row[0].length>210||!validHash(row[1])||seen.has(row[0]))throw new Error('공유 판본의 항목·해시 형식을 확인하세요.');seen.add(row[0]);return [...row];});
  let chapterBases;
  if(value.chapterBases!==undefined){
    if(!Array.isArray(value.chapterBases)||value.chapterBases.length>MAX_DETAIL_CHAPTERS)throw new Error('공유 문단 기준의 한도를 확인하세요.');
    const ids=new Set();let total=0;
    chapterBases=value.chapterBases.map(detail=>{
      if(!detail||typeof detail!=='object'||Array.isArray(detail)||typeof detail.id!=='string'||!detail.id||detail.id.length>200||ids.has(detail.id)||!seen.has('chapter:'+detail.id)||!Array.isArray(detail.fields)||detail.fields.length!==CHAPTER_FIELDS.length||!Array.isArray(detail.paragraphs)||detail.paragraphs.length<2||detail.paragraphs.length>MAX_PARAGRAPHS)throw new Error('공유 문단 기준의 형식이 올바르지 않습니다.');
      ids.add(detail.id);total+=detail.paragraphs.length;if(total>MAX_DETAIL_PARAGRAPHS)throw new Error('공유 문단 기준의 한도를 넘었습니다.');
      const fieldNames=new Set(),fields=detail.fields.map(row=>{if(!Array.isArray(row)||row.length!==2||!CHAPTER_FIELDS.includes(row[0])||fieldNames.has(row[0])||!validHash(row[1]))throw new Error('공유 문단 기준의 필드 해시를 확인하세요.');fieldNames.add(row[0]);return [...row];});
      if(!detail.paragraphs.every(validHash))throw new Error('공유 문단 기준의 해시를 확인하세요.');
      return {id:detail.id,fields,paragraphs:[...detail.paragraphs]};
    });
  }
  return {version:1,bookId:value.bookId,base,...(chapterBases?{chapterBases}: {})};
}
export async function createExchange(project,{name,role='author',includeSources=false}={}) {
  if(!name?.trim()||name.length>120||!['author','editor','reviewer'].includes(role))throw new Error('공유하는 사람의 이름과 역할을 입력하세요.');
  const content=Object.fromEntries(fields.filter(k=>project[k]!==undefined&&project[k]!==null).map(k=>[k,clone(project[k])]));
  content.id=project.id;content.chapters=clone(project.chapters);content.reviewDesk=clone(project.reviewDesk||{version:1,citations:[],comments:[],approvals:[]});
  if(project.bookMatter!==undefined)content.bookMatter=clone(project.bookMatter);
  if(includeSources){content.sharedReviewSources=clone(reviewSources(project));content.registeredSources=clone(project.registeredSources);if(!content.registeredSources&&project.production?.brief)content.registeredSources={sourceMarkdown:project.production.brief.sourceMarkdown||'',sourceName:project.production.brief.sourceName||'',sourceManifest:clone(project.production.brief.sourceManifest),sourceImages:clone(project.production.brief.sourceImages)};}
  const previous=validateCollaboration(project.collaboration);
  const origin=previous||await createOrigin(content,project.id);
  content.collaboration=origin;
  const exchange={format:'folio-exchange',version:1,origin,member:{name:name.trim(),role},exportedAt:new Date().toISOString(),project:content};
  if(new TextEncoder().encode(JSON.stringify(exchange)).byteLength>MAX_BYTES)throw new Error('공유 파일은 64 MiB까지 지원합니다. 그림 크기와 원시 자료를 줄여 주세요.');
  return {exchange,origin};
}
export function parseExchange(raw,validateProject) {
  if(!raw||raw.format!=='folio-exchange'||raw.version!==1||!raw.member||typeof raw.member.name!=='string'||raw.member.name.length>120||!['author','editor','reviewer'].includes(raw.member.role))throw new Error('Folio 공유 작업 파일이 아닙니다.');
  const origin=validateCollaboration(raw.origin);if(!origin)throw new Error('공유 기준 판본이 없습니다.');
  const project=validateProject(raw.project);
  project.collaboration=origin;
  if(!Array.isArray(project.chapters)||new Set(project.chapters.map(c=>c.id)).size!==project.chapters.length)throw new Error('공유 파일의 장 ID가 중복되었습니다.');
  return {origin,project,member:{name:raw.member.name,role:raw.member.role}};
}
export async function planExchangeMerge(local,incoming) {
  const ownId=local.collaboration?.bookId||local.id;
  if(ownId!==incoming.origin.bookId)throw new Error('다른 책의 공유 파일입니다. 별도 책으로 가져와 주세요.');
  const origin=validateCollaboration(incoming.origin),recorded=validateCollaboration(local.collaboration);
  const base=new Map(origin.base),ownBase=new Map(recorded?.base||[]),left=units(local),right=units(incoming.project),merged=new Map(),conflicts=[];
  const incomingDetails=new Map((origin.chapterBases||[]).map(detail=>[detail.id,detail])),ownDetails=new Map((recorded?.chapterBases||[]).map(detail=>[detail.id,detail]));
  const all=new Set([...left.keys(),...right.keys(),...base.keys()]);
  if(all.size>MAX_UNITS)throw new Error('공유 항목 수가 한도를 넘었습니다.');
  for(const key of all){
    const l=left.get(key)??null,r=right.get(key)??null,b=base.get(key)||await digest(null);
    if(same(l,r)||await digest(r)===b)merged.set(key,clone(l));
    else if(await digest(l)===b)merged.set(key,clone(r));
    else {
      const detail=key.startsWith('chapter:')?incomingDetails.get(key.slice(8)):null;
      const matchingBaseline=detail&&ownBase.get(key)===b&&same(detail,ownDetails.get(key.slice(8)));
      const combined=matchingBaseline?await mergeChapterParagraphs(l,r,detail):null;
      if(combined)merged.set(key,combined);
      else {merged.set(key,clone(l));conflicts.push({key,label:labelFor(key),local:clone(l),remote:clone(r)});}
    }
  }
  return {bookId:ownId,merged:[...merged],conflicts,local:clone(local),remote:clone(incoming.project),member:incoming.member};
}
export async function resolveExchangeMerge(plan,choices={}) {
  const selected=new Map(plan.merged);
  for(const c of plan.conflicts){if(!['local','remote'].includes(choices[c.key]))throw new Error('모든 충돌 항목에서 보관할 내용을 선택하세요.');selected.set(c.key,clone(c[choices[c.key]]));}
  const result=clone(plan.local);
  for(const field of fields){const value=selected.get(field);if(value===null)delete result[field];else result[field]=value;}
  const matter=Object.fromEntries(['preface','afterword'].filter(role=>selected.get('matter:'+role)).map(role=>[role,clone(selected.get('matter:'+role))]));
  if(Object.keys(matter).length)result.bookMatter=matter;else delete result.bookMatter;
  const chapters=new Map([...selected].filter(([k,v])=>k.startsWith('chapter:')&&v).map(([k,v])=>[k.slice(8),v]));
  const order=selected.get('chapter-order')||[];
  result.chapters=[...new Set([...order,...chapters.keys()])].filter(id=>chapters.has(id)).map(id=>chapters.get(id));
  if(!result.chapters.length)throw new Error('모든 장을 삭제하는 병합은 적용할 수 없습니다.');
  result.reviewDesk={version:1,citations:[],comments:[],approvals:[]};
  for(const [prefix,field] of [['citation:','citations'],['comment:','comments'],['approval:','approvals']])result.reviewDesk[field]=[...selected].filter(([k,v])=>k.startsWith(prefix)&&v).map(([,v])=>v);
  result.collaboration=await createOrigin(result,plan.bookId);
  return result;
}
export async function exchangeRevision(project) {return digest([...units(project)]);}
export const EXCHANGE_LIMIT_BYTES=MAX_BYTES;
