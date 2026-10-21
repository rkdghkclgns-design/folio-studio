import {validateChapterFigures} from './export.js';

/** The default is a handoff to included app tools, never a hidden paid API call. */
export const VISUAL_WORKFLOW = Object.freeze({version:1, diagrams:'claude-svg', illustrations:'codex-imagegen', paidFallback:false, selection:'content-first', perChapterQuota:false});
export const VISUAL_BUNDLE_LIMIT = 128 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const plain = (value, max, label) => {
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`${label} 형식을 확인해 주세요.`);
  return value;
};
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function visualChapterHash(chapter){
  const data=new TextEncoder().encode(JSON.stringify([chapter.title,chapter.content]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
}
function placementOffset(content,placement){
  if(placement===undefined)return content.length;
  if(!placement||typeof placement!=='object'||Array.isArray(placement))throw new Error('그림 배치 위치를 확인해 주세요.');
  const anchor=plain(placement.after,12000,'배치 기준 문단');
  const index=content.indexOf(anchor);
  if(index<0||content.indexOf(anchor,index+1)>=0)throw new Error('배치 기준 문단은 원고에 정확히 한 번 있어야 합니다.');
  const before=content.slice(0,index),after=content.slice(index+anchor.length);
  if((before&&!/\n\s*\n$/.test(before))||(after&&!/^\r?\n\s*\r?\n/.test(after)))throw new Error('그림은 완전한 문단이나 제목 뒤에 배치해 주세요.');
  if(/^ {0,3}(`{3,}|~{3,})/m.test(anchor))throw new Error('코드 블록에는 그림을 배치할 수 없습니다.');
  let fence=null;
  for(const line of before.replace(/\r\n?/g,'\n').split('\n')){
    if(fence){if(new RegExp('^ {0,3}'+fence.mark+'{'+fence.length+',}\\s*$').test(line))fence=null;continue;}
    const start=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if(start&&(start[1][0]!=='`'||!start[2].includes('`')))fence={mark:start[1][0],length:start[1].length};
  }
  if(fence||/^ {4}|^\t/m.test(anchor))throw new Error('코드 블록에는 그림을 배치할 수 없습니다.');
  return index+anchor.length;
}
function visibleFigureIds(content){
  const ids=new Set();let fence=null;
  for(const line of String(content||'').replace(/\r\n?/g,'\n').split('\n')){
    if(fence){if(new RegExp('^ {0,3}'+fence.mark+'{'+fence.length+',}\\s*$').test(line))fence=null;continue;}
    const start=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if(start&&(start[1][0]!=='`'||!start[2].includes('`'))){fence={mark:start[1][0],length:start[1].length};continue;}
    const reference=line.match(/^ {0,3}!\[[^\]\n]*\]\(folio-asset:([^\s)]+)\)[\t ]*$/);
    if(reference)ids.add(reference[1]);
  }
  return ids;
}
export function visualProgress(project){
  let diagrams=0,illustrations=0,chapters=0;
  for(const chapter of project.chapters||[]){
    const visible=visibleFigureIds(chapter.content);
    let has=false;
    for(const f of chapter.figures||[]){
      if(!visible.has(f.id))continue;
      if(f.provenance?.provider==='claude-svg'){diagrams++;has=true;}
      if(f.provenance?.provider==='codex-imagegen'){illustrations++;has=true;}
    }
    if(has)chapters++;
  }
  return {diagrams,illustrations,chapters,total:project.chapters?.length||0};
}
export async function createVisualBrief(project){
  project=structuredClone(project);
  return {format:'folio-visual-brief',version:1,workflow:{...VISUAL_WORKFLOW},book:{title:project.title,author:project.author||''},instructions:[
    '설명용 도표는 실제 Claude에서 SVG로 만들고, 상황 삽화는 ChatGPT·Codex 내장 이미지 생성으로 만드세요.',
    '먼저 설명할 문단과 독자가 이해해야 할 관계·차이·절차를 고르세요. 그림 없이 충분하면 넣지 마세요. 장마다 할당량이나 도표/삽화 비율을 맞추지 마세요. 필요한 장에는 SVG를 여러 개 넣을 수 있습니다.',
    '분위기만 보여 주는 장식 그림, 추상적인 미래 작업실, 본문에 없는 상황은 만들지 마세요. 생성 이미지는 형태·공간·상황을 실제로 설명할 때만 선택하며 실증 자료나 실제 게임 화면으로 제시하지 마세요.',
    '각 그림은 관련 문단을 placement.after에 원문 그대로 지정하여 바로 뒤에 배치하세요. 캡션은 독자가 그림에서 무엇을 확인해야 하는지 설명해야 합니다. 출처가 필요한 실제 참고 이미지는 상업적 재사용 권리와 출처를 확인하세요.',
    '별도 유료 API로 전환하지 마세요. 포함 사용량이 부족하면 완료된 파일을 보존하고 남은 작업을 알리세요.',
    '원문과 표지를 보존하세요. 완성 파일은 folio-visual-assets v1으로 반환하며 chapterHash를 바꾸지 마세요.',
    'SVG는 외부 참조·스크립트·foreignObject 없이 자체 완결형이어야 합니다. 글자는 충분히 크게 배치하세요.',
  ],chapters:await Promise.all(project.chapters.map(async(c,i)=>({number:i+1,chapterId:c.id,chapterTitle:c.title,chapterHash:await visualChapterHash(c),content:c.content}))),
  resultSchema:{format:'folio-visual-assets',version:1,book:{title:project.title,author:project.author||''},assets:[{chapterId:'요청서의 장 ID',chapterTitle:'요청서의 장 제목',chapterHash:'요청서의 SHA-256',kind:'diagram 또는 illustration',placement:{after:'그림으로 설명할 완전한 문단 또는 제목 원문'},figure:{id:'고유한 영문 숫자 ID',src:'data:image/svg+xml;base64,... 또는 PNG/JPEG/WebP data URI',alt:'그림을 보지 않고 이해할 수 있는 설명',caption:'본문에 맞는 예시 설명',provenance:{provider:'claude-svg 또는 codex-imagegen',createdAt:'ISO 8601',prompt:'실제 사용한 프롬프트'}}}]}};
}

export async function planVisualImport(project,bundle){
  const source=project,revision=JSON.stringify(project);
  project=structuredClone(project);
  if(!bundle||bundle.format!=='folio-visual-assets'||bundle.version!==1||!Array.isArray(bundle.assets)||!bundle.assets.length||bundle.assets.length>1000)throw new Error('도표·삽화 결과 파일 형식을 확인해 주세요.');
  if(bundle.book?.title!==project.title||(bundle.book.author||'')!==(project.author||''))throw new Error('현재 책의 제목·저자와 다른 결과 파일입니다. 해당 책을 먼저 여세요.');
  const ids=new Set(),pending=new Map(),hashes=new Map(),items=[];
  for(const item of bundle.assets){
    if(!item||!['diagram','illustration'].includes(item.kind))throw new Error('도표·삽화 종류를 확인해 주세요.');
    const title=plain(item.chapterTitle,200,'장 제목');
    if(typeof item.chapterHash!=='string'||!/^[a-f0-9]{64}$/.test(item.chapterHash))throw new Error('원문 확인값이 없는 결과는 적용할 수 없습니다.');
    let chapter=project.chapters.find(c=>c.id===item.chapterId);
    if(!chapter){const matches=project.chapters.filter(c=>c.title===title);if(matches.length===1)chapter=matches[0];}
    if(!chapter||chapter.title!==title)throw new Error('대상 장이 없거나 장 제목이 다릅니다.');
    const figure=validateChapterFigures([item.figure])[0];
    if(!ID.test(figure.id)||ids.has(figure.id))throw new Error('그림 ID가 중복되었습니다.');ids.add(figure.id);
    const provider=item.kind==='diagram'?'claude-svg':'codex-imagegen';
    if(figure.provenance?.provider!==provider)throw new Error('실제 제작 도구 기록이 없는 결과입니다.');
    const svg=figure.src.startsWith('data:image/svg+xml;');
    if(svg!==(item.kind==='diagram'))throw new Error('Claude 도표는 SVG, 내장 생성 삽화는 PNG·JPEG·WebP여야 합니다.');
    const existing=(chapter.figures||[]).find(f=>f.id===figure.id);
    // Re-importing the identical result is harmless; a different asset never replaces it silently.
    if(existing){
      if(JSON.stringify(validateChapterFigures([existing])[0])!==JSON.stringify(figure)||!visibleFigureIds(chapter.content).has(figure.id))throw new Error('같은 ID의 다른 그림이 이미 있습니다. 새 ID로 내보내 주세요.');
      items.push({chapterId:chapter.id,title,figure,skip:true});continue;
    }
    if(!hashes.has(chapter.id))hashes.set(chapter.id,await visualChapterHash(chapter));
    if(hashes.get(chapter.id)!==item.chapterHash)throw new Error(`‘${title}’ 원고가 제작 요청 후 바뀌었습니다. 최신 원고로 다시 요청해 주세요.`);
    const accumulated=pending.get(chapter.id)||{count:0,length:0};
    if((chapter.figures?.length||0)+accumulated.count>=20)throw new Error(`‘${title}’ 장의 그림 한도(20개)를 넘습니다.`);
    const alt=figure.alt.replace(/[\[\]\\\r\n]/g,' ');
    const addition=`\n\n![${alt}](folio-asset:${figure.id})`;
    if(chapter.content.length+accumulated.length+addition.length>500000)throw new Error('그림 표시를 추가하면 장의 본문 한도를 넘습니다.');
    const insertAt=placementOffset(chapter.content,item.placement);
    pending.set(chapter.id,{count:accumulated.count+1,length:accumulated.length+addition.length});
    items.push({chapterId:chapter.id,title,figure,addition,insertAt,skip:false});
  }
  if(JSON.stringify(source)!==revision)throw new Error('파일을 확인하는 동안 원고가 바뀌었습니다. 다시 가져와 주세요.');
  return {revision,items,added:items.filter(x=>!x.skip).length,skipped:items.filter(x=>x.skip).length};
}

export function applyVisualImport(project,plan){
  if(JSON.stringify(project)!==plan.revision)throw new Error('미리보기 후 원고가 바뀌었습니다. 결과 파일을 다시 확인해 주세요.');
  const next=structuredClone(project);
  for(const item of plan.items){
    if(item.skip)continue;
    const chapter=next.chapters.find(c=>c.id===item.chapterId);
    chapter.figures=[...(chapter.figures||[]),item.figure];
  }
  for(const chapter of next.chapters){
    const edits=plan.items.filter(item=>!item.skip&&item.chapterId===chapter.id).map((item,index)=>({...item,index})).sort((a,b)=>b.insertAt-a.insertAt||b.index-a.index);
    for(const item of edits)chapter.content=chapter.content.slice(0,item.insertAt)+item.addition+chapter.content.slice(item.insertAt);
  }
  return next;
}

export function renderVisualWorkflow(project,{actions=true}={}){
  const p=visualProgress(project);
  return `<section class="notice visual-workflow" aria-label="도표와 삽화 제작 방식"><b>본문에 필요한 시각 자료</b><p>설명 도표는 <strong>Claude SVG</strong>, 형태·공간·상황을 보여 줄 이미지가 필요할 때만 <strong>ChatGPT·Codex 내장 이미지 생성</strong>을 사용합니다. 그림이 없어도 되는 장은 그대로 두고, 설명에 필요하면 한 장에 여러 도표를 배치합니다.</p><p>제작 도구에서 결과를 만든 뒤 이 책에 가져옵니다. 포함 사용량 안에서는 별도 이미지 API 요금이 없으며, 한도는 각 서비스에서 확인합니다.</p><p role="status">${p.chapters}개 장에서 사용 · 도표 ${p.diagrams}개 · 설명 이미지 ${p.illustrations}개 · 장별 할당량 없음</p>${actions?'<button type="button" class="button secondary" data-action="visual-workflow">도표·삽화 제작 및 가져오기</button>':''}</section>`;
}

export function renderVisualInstructions(project){
  return `${renderVisualWorkflow(project,{actions:false})}<ol><li><b>제작 요청서 받기</b>로 현재 원문과 장 식별정보를 저장합니다.</li><li>요청서를 Codex에 전달하세요. 본문을 읽고 필요한 설명 자료만 선택합니다. SVG는 Claude로 만들고, 상황을 보여 줄 필요가 있을 때만 내장 이미지를 생성합니다.</li><li>완료된 <b>도표·삽화 결과 JSON</b>을 가져오고 적용 내용을 확인합니다. 원문·표지는 보존되며 그림은 지정한 문단 뒤에 추가됩니다. 위치를 지정하지 않은 이전 결과 파일은 장 끝에 추가됩니다.</li></ol><p>이 사이트에서 Claude·ChatGPT 구독을 직접 호출하지 않습니다. API 연결 메뉴의 생성은 별도 요금 방식입니다.</p><div class="inline-actions"><a href="https://claude.ai/" target="_blank" rel="noopener noreferrer">Claude 열기 ↗</a><a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">ChatGPT 열기 ↗</a></div><details><summary>별도 API 도표 기능</summary><p>연결한 글쓰기 API로 구조화 도표를 생성합니다. Claude 구독 SVG 제작과 별도이며 API 요금이 발생할 수 있습니다.</p><button class="button secondary" data-action="chapter-diagram-api">현재 장의 API 도표 검토</button></details><p class="help">현재 책: ${escape(project.title)}. 요청서에는 원문이 포함됩니다. 파일을 전달할 때 공유 대상을 확인하세요.</p><details><summary>결과 내용을 붙여 넣어 가져오기</summary><label for="visual-result-paste">완성된 결과 JSON</label><textarea id="visual-result-paste" rows="5" spellcheck="false" placeholder="결과 파일의 내용을 붙여 넣으세요."></textarea><button class="button secondary" data-action="visual-paste">붙여 넣은 결과 확인</button></details><div class="modal-actions"><button class="button secondary" data-action="visual-brief">제작 요청서 받기</button><button class="button primary" data-action="visual-import">도표·삽화 결과 가져오기</button></div>`;
}
