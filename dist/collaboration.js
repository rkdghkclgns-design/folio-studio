/** Portable three-way exchanges. No account, background upload, or implicit overwrite. */
import {normalizeCoverDesign} from './cover.js';
import {reviewSources} from './review-desk.js';
const clone=v=>structuredClone(v),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fields=['title','subtitle','author','description','language','theme','genre','audience','tone','voiceSample','coverImage','coverBackground','coverDesign'];
const MAX_UNITS=2500,MAX_BYTES=64*1024*1024;
const labelFor=key=>key.startsWith('chapter:')?'장 '+key.slice(8):key==='chapter-order'?'목차 순서':key.startsWith('comment:')?'검토 의견':key.startsWith('citation:')?'출처 연결':key.startsWith('approval:')?'검토 완료':key;
function units(project) {
  const entries=fields.map(k=>[k,k==='coverDesign'?normalizeCoverDesign(project[k]):['coverImage','coverBackground'].includes(k)?project[k]??null:project[k]??(k==='language'?'ko':k==='theme'?'sage':'')]);
  entries.push(['chapter-order',project.chapters.map(c=>c.id)]);
  for(const c of project.chapters)entries.push(['chapter:'+c.id,{id:c.id,title:c.title,content:c.content,kind:c.kind||'',editorialNotes:c.editorialNotes||[],imagePrompt:c.imagePrompt||'',image:c.image??null,figures:c.figures||[]}]);
  for(const [prefix,list] of [['citation',project.reviewDesk?.citations],['comment',project.reviewDesk?.comments],['approval',project.reviewDesk?.approvals]])for(const r of list||[])entries.push([prefix+':'+r.id,r]);
  return new Map(entries);
}
async function digest(value){const bytes=new TextEncoder().encode(JSON.stringify(value??null));const buffer=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function validateCollaboration(value) {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||typeof value.bookId!=='string'||!value.bookId||value.bookId.length>100||!Array.isArray(value.base)||value.base.length>MAX_UNITS)throw new Error('공유 기준 판본의 형식이 올바르지 않습니다.');
  const seen=new Set(),base=value.base.map(row=>{if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||row[0].length>210||!(/^[a-f0-9]{64}$/.test(row[1]))||seen.has(row[0]))throw new Error('공유 판본의 항목·해시 형식을 확인하세요.');seen.add(row[0]);return [...row];});
  return {version:1,bookId:value.bookId,base};
}
export async function createExchange(project,{name,role='author',includeSources=false}={}) {
  if(!name?.trim()||name.length>120||!['author','editor','reviewer'].includes(role))throw new Error('공유하는 사람의 이름과 역할을 입력하세요.');
  const content=Object.fromEntries(fields.filter(k=>project[k]!==undefined&&project[k]!==null).map(k=>[k,clone(project[k])]));
  content.id=project.id;content.chapters=clone(project.chapters);content.reviewDesk=clone(project.reviewDesk||{version:1,citations:[],comments:[],approvals:[]});
  if(includeSources){content.sharedReviewSources=clone(reviewSources(project));content.registeredSources=clone(project.registeredSources);if(!content.registeredSources&&project.production?.brief)content.registeredSources={sourceMarkdown:project.production.brief.sourceMarkdown||'',sourceName:project.production.brief.sourceName||'',sourceManifest:clone(project.production.brief.sourceManifest),sourceImages:clone(project.production.brief.sourceImages)};}
  const previous=validateCollaboration(project.collaboration);
  const base=previous?.base||await Promise.all([...units(content)].map(async([k,v])=>[k,await digest(v)]));
  const origin={version:1,bookId:previous?.bookId||project.id,base};
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
  const base=new Map(incoming.origin.base),left=units(local),right=units(incoming.project),merged=new Map(),conflicts=[];
  const all=new Set([...left.keys(),...right.keys(),...base.keys()]);
  if(all.size>MAX_UNITS)throw new Error('공유 항목 수가 한도를 넘었습니다.');
  for(const key of all){
    const l=left.get(key)??null,r=right.get(key)??null,b=base.get(key)||await digest(null);
    if(same(l,r)||await digest(r)===b)merged.set(key,clone(l));
    else if(await digest(l)===b)merged.set(key,clone(r));
    else {merged.set(key,clone(l));conflicts.push({key,label:labelFor(key),local:clone(l),remote:clone(r)});}
  }
  return {bookId:ownId,merged:[...merged],conflicts,local:clone(local),remote:clone(incoming.project),member:incoming.member};
}
export async function resolveExchangeMerge(plan,choices={}) {
  const selected=new Map(plan.merged);
  for(const c of plan.conflicts){if(!['local','remote'].includes(choices[c.key]))throw new Error('모든 충돌 항목에서 보관할 내용을 선택하세요.');selected.set(c.key,clone(c[choices[c.key]]));}
  const result=clone(plan.local);
  for(const field of fields){const value=selected.get(field);if(value===null)delete result[field];else result[field]=value;}
  const chapters=new Map([...selected].filter(([k,v])=>k.startsWith('chapter:')&&v).map(([k,v])=>[k.slice(8),v]));
  const order=selected.get('chapter-order')||[];
  result.chapters=[...new Set([...order,...chapters.keys()])].filter(id=>chapters.has(id)).map(id=>chapters.get(id));
  if(!result.chapters.length)throw new Error('모든 장을 삭제하는 병합은 적용할 수 없습니다.');
  result.reviewDesk={version:1,citations:[],comments:[],approvals:[]};
  for(const [prefix,field] of [['citation:','citations'],['comment:','comments'],['approval:','approvals']])result.reviewDesk[field]=[...selected].filter(([k,v])=>k.startsWith(prefix)&&v).map(([,v])=>v);
  result.collaboration={version:1,bookId:plan.bookId,base:await Promise.all([...units(result)].map(async([k,v])=>[k,await digest(v)]))};
  return result;
}
export async function exchangeRevision(project) {return digest([...units(project)]);}
export const EXCHANGE_LIMIT_BYTES=MAX_BYTES;
