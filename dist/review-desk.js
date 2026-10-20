/** Evidence links are author-reviewed references, never automatic fact certification. */
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, field) => { if (typeof value !== 'string' || value.length > max) throw new Error(`${field} 형식을 확인해 주세요.`); return value; };
const uid = () => globalThis.crypto?.randomUUID?.() || `review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const roles = ['author', 'editor', 'reviewer'];
export const REVIEW_LIMIT = 300;
export function validateReviewDesk(value) {
  if (value === undefined) return undefined;
  if (!plain(value) || value.version !== 1) throw new Error('출처 검토 기록 형식을 확인해 주세요.');
  const list = (name, clean) => {
    if (!Array.isArray(value[name]) || value[name].length > REVIEW_LIMIT) throw new Error('출처·의견 기록은 종류별 300개까지 지원합니다.');
    const result = value[name].map(row => { if (!plain(row)) throw new Error('검토 기록 형식 오류'); return clean(row); });
    if (new Set(result.map(r => r.id)).size !== result.length) throw new Error('중복된 검토 기록입니다.');
    return result;
  };
  const common = r => ({id:text(r.id,100,'기록 ID'),chapterId:text(r.chapterId,100,'장 ID'),by:text(r.by,120,'검토자'),at:text(r.at,40,'기록일')});
  return {version:1,
    citations:list('citations',r=>{ if (!Number.isSafeInteger(r.start) || r.start<0 || !Number.isSafeInteger(r.end) || r.end<r.start) throw new Error('원문 위치 형식 오류'); return {...common(r),claim:text(r.claim,3000,'본문 인용'),sourceId:text(r.sourceId,2300,'출처'),excerpt:text(r.excerpt,6000,'원문 발췌'),start:r.start,end:r.end,note:text(r.note,2000,'메모')}; }),
    comments:list('comments',r=>{if(!roles.includes(r.role)||typeof r.resolved!=='boolean')throw new Error('의견 역할·상태 오류');return {...common(r),body:text(r.body,4000,'검토 의견'),anchor:text(r.anchor,3000,'대상 문장'),role:r.role,resolved:r.resolved};}),
    approvals:list('approvals',r=>({...common(r),signature:text(r.signature,100,'검토 판본')}))};
}
export const emptyReviewDesk = () => ({version:1,citations:[],comments:[],approvals:[]});
export function validateSharedReviewSources(value) {
  if(value===undefined)return undefined;
  if(!Array.isArray(value)||value.length>1000)throw new Error('공유 참고 원문 목록을 확인해 주세요.');
  let total=0;const seen=new Set();return value.map(s=>{if(!plain(s))throw new Error('공유 참고 원문 형식 오류');const result={id:text(s.id,2300,'원문 ID'),name:text(s.name,2300,'원문 이름'),content:text(s.content,120000,'원문')};total+=result.content.length;if(total>240000||seen.has(result.id))throw new Error('공유 원문 한도 또는 중복 오류');seen.add(result.id);return result;});
}
export function reviewSources(project) {
  const sources=[];
  for (const [origin,data] of [['registered',project.registeredSources],['production',project.production?.brief]]) {
    if (!data?.sourceMarkdown) continue;
    if (data.sourceManifest?.files?.length) for (const f of data.sourceManifest.files) sources.push({id:`${origin}:${f.path}`,name:f.path,content:data.sourceMarkdown.slice(f.start,f.end)});
    else sources.push({id:origin,name:data.sourceName|| (origin==='registered'?'등록한 원문':'집필 참고 원문'),content:data.sourceMarkdown});
  }
  for(const source of validateSharedReviewSources(project.sharedReviewSources)||[])if(!sources.some(s=>s.id===source.id))sources.push(source);
  return sources;
}
// Change detection only. This value is not a digital signature or permission mechanism.
export function reviewSignature(project, chapterId) {
  const c=project.chapters.find(c=>c.id===chapterId);
  const value=JSON.stringify([c?.title,c?.content,c?.image,c?.figures,reviewSources(project)]);
  let hash=2166136261;for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);
  return `review-v1-${hash>>>0}-${value.length}`;
}
export function citationState(project, citation) {
  const chapter=project.chapters.find(c=>c.id===citation.chapterId),source=reviewSources(project).find(s=>s.id===citation.sourceId);
  const claimMatches=Boolean(chapter?.content.includes(citation.claim));
  const sourceMatches=Boolean(source&&source.content.slice(citation.start,citation.end)===citation.excerpt);
  return {current:claimMatches&&sourceMatches,claimMatches,sourceMatches,sourceName:source?.name||'삭제된 원문',line:source?source.content.slice(0,citation.start).split('\n').length:null};
}
export function addCitation(project, input) {
  const desk=validateReviewDesk(project.reviewDesk)||emptyReviewDesk(),source=reviewSources(project).find(s=>s.id===input.sourceId);
  const claim=String(input.claim||'').trim(),excerpt=String(input.excerpt||'').trim(),by=String(input.by||'').trim();
  if(!claim||!excerpt||!by)throw new Error('대상 문장·원문 발췌·검토자 이름을 입력하세요.');
  if(!project.chapters.find(c=>c.id===input.chapterId)?.content.includes(claim))throw new Error('대상 문장이 현재 장에 없습니다. 본문의 문장을 그대로 붙여 넣으세요.');
  const occurrence=Number(input.occurrence||1);if(!Number.isInteger(occurrence)||occurrence<1||occurrence>1000)throw new Error('출현 순서는 1~1000 사이여야 합니다.');
  let start=-1;for(let n=0;n<occurrence;n++){start=source?.content.indexOf(excerpt,start+1)??-1;if(start<0)break;}
  if(start<0)throw new Error('선택한 원문에서 해당 발췌를 찾지 못했습니다. 원문을 그대로 복사해 주세요.');
  desk.citations.push({id:uid(),chapterId:input.chapterId,claim,sourceId:input.sourceId,excerpt,start,end:start+excerpt.length,note:String(input.note||''),by,at:new Date().toISOString()});
  return validateReviewDesk(desk);
}
export function addReviewComment(project,input) {
  const desk=validateReviewDesk(project.reviewDesk)||emptyReviewDesk();
  if(!String(input.body||'').trim()||!String(input.by||'').trim())throw new Error('검토자와 의견을 입력하세요.');
  const chapter=project.chapters.find(c=>c.id===input.chapterId);if(!chapter)throw new Error('검토할 장을 선택하세요.');
  if(input.anchor&&!chapter.content.includes(input.anchor))throw new Error('대상 문장이 현재 장에 없습니다.');
  desk.comments.push({id:uid(),chapterId:chapter.id,body:input.body.trim(),anchor:input.anchor||'',by:input.by.trim(),role:input.role||'reviewer',resolved:false,at:new Date().toISOString()});
  return validateReviewDesk(desk);
}
export function approveChapterReview(project,chapterId,by) {
  if(!by?.trim()||!project.chapters.some(c=>c.id===chapterId))throw new Error('장과 검토자를 선택하세요.');
  const desk=validateReviewDesk(project.reviewDesk)||emptyReviewDesk();
  if(desk.citations.some(c=>c.chapterId===chapterId&&!citationState(project,c).current))throw new Error('변경된 출처 연결을 먼저 다시 등록하세요.');
  if(desk.comments.some(c=>c.chapterId===chapterId&&!c.resolved))throw new Error('미해결 검토 의견을 먼저 확인하세요.');
  desk.approvals=desk.approvals.filter(a=>a.chapterId!==chapterId);
  desk.approvals.push({id:uid(),chapterId,by:by.trim(),signature:reviewSignature(project,chapterId),at:new Date().toISOString()});
  return validateReviewDesk(desk);
}
export function reviewCandidates(project) {
  const citations=project.reviewDesk?.citations||[],rows=[];
  for(const chapter of project.chapters) {
    const sentences=chapter.content.split(/(?<=[.!?。])\s+|\n+/u);
    for(const sentence of sentences) {
      const value=sentence.trim();if(value.length<8||value.length>3000||!/\d|[“”「」]|반드시|항상|절대로|모든 사람|연구에 따르면/u.test(value))continue;
      if(citations.some(c=>c.chapterId===chapter.id&&c.claim===value&&citationState(project,c).current))continue;
      rows.push({chapterId:chapter.id,chapterTitle:chapter.title,text:value,reason:/\d/u.test(value)?'수치·날짜 확인':'인용·단정 표현 확인'});
      if(rows.length===100)return rows;
    }
  }
  return rows;
}
export function remapReviewDesk(value,ids) {const d=validateReviewDesk(value);if(!d)return undefined;for(const key of ['citations','comments','approvals'])d[key]=d[key].map(r=>({...r,chapterId:ids.get(r.chapterId)||r.chapterId}));return d;}
export function reviewReport(project) {
  const d=validateReviewDesk(project.reviewDesk)||emptyReviewDesk();
  return {version:1,title:project.title,generatedAt:new Date().toISOString(),certification:'human-review-only',citations:d.citations.map(c=>({...c,...citationState(project,c)})),comments:d.comments,chapters:project.chapters.map(c=>{const a=d.approvals.find(a=>a.chapterId===c.id);return {id:c.id,title:c.title,reviewed:Boolean(a&&a.signature===reviewSignature(project,c.id)&&!d.comments.some(r=>r.chapterId===c.id&&!r.resolved)&&!d.citations.some(r=>r.chapterId===c.id&&!citationState(project,r).current)),reviewer:a?.by||''};}),candidates:reviewCandidates(project)};
}
