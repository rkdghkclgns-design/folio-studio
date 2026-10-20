import {emptyReviewDesk,validateReviewDesk,reviewSources,citationState,addCitation,addReviewComment,approveChapterReview,reviewReport} from './review-desk.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roleName={author:'저자',editor:'편집자',reviewer:'검토자'};
export function renderReviewDesk(project) {
  const sources=reviewSources(project),report=reviewReport(project);
  const chapters=project.chapters.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('');
  return `<section class="review-desk"><p class="modal-intro">원고 문장과 등록 원문의 위치를 연결하고 검토 의견을 남깁니다. 수치·인용 후보는 확인을 돕는 표시이며 사실 판정 결과가 아닙니다.</p>
  <div class="form-grid"><label class="field">검토자 이름<input name="reviewer" maxlength="120" autocomplete="off"></label><label class="field">역할<select name="review-role"><option value="author">저자</option><option value="editor">편집자</option><option value="reviewer">검토자</option></select></label><label class="field full">검토할 장<select name="review-chapter">${chapters}</select></label></div>
  <p class="help">역할은 검토 기록용입니다. 파일 공유 상대의 접근 권한을 제한하지 않습니다.</p>
  <details open><summary>출처 연결 추가</summary>${sources.length?'':'<p class="notice">새 책의 원시 소스 또는 집필 자료를 등록하면 원문 위치를 연결할 수 있습니다.</p>'}<form data-review-form="citation"><label class="field">확인할 본문 문장<textarea name="claim" rows="2" maxlength="3000" required></textarea></label><label class="field">등록 원문<select name="sourceId">${sources.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label><label class="field">원문 보기<textarea data-review-source readonly rows="5">${esc(sources[0]?.content||'')}</textarea></label><label class="field">원문에서 복사한 발췌<textarea name="excerpt" maxlength="6000" rows="2" required></textarea></label><div class="form-grid"><label class="field">동일 발췌의 출현 순서<input type="number" name="occurrence" value="1" min="1" max="1000"></label><label class="field">검토 메모<input name="note" maxlength="2000"></label></div><button class="button secondary" type="submit" ${sources.length?'':'disabled'}>출처 위치 연결</button></form></details>
  <details><summary>검토 의견 추가</summary><form data-review-form="comment"><label class="field">대상 문장 · 선택<textarea name="anchor" rows="2" maxlength="3000"></textarea></label><label class="field">검토 의견<textarea name="body" rows="3" maxlength="4000" required></textarea></label><button class="button secondary" type="submit">의견 남기기</button></form></details>
  <div class="inline-actions"><button type="button" class="button primary" data-review="approve">현재 장 검토 완료</button><button type="button" class="button secondary" data-review="download">검토 기록 받기</button></div><p class="help">미해결 의견이나 변경된 출처가 있으면 검토 완료를 기록할 수 없습니다. 원고·참고 자료가 바뀌면 완료 표시가 만료됩니다.</p><p data-review-message role="status"></p><div data-review-results>${renderResults(project,report)}</div></section>`;
}
function renderResults(project,report=reviewReport(project)) {
  return `<h3>검토 상태</h3><ul>${report.chapters.map(c=>`<li>${esc(c.title)} — ${c.reviewed?`${esc(c.reviewer)} 검토 완료`:'검토 필요'}</li>`).join('')}</ul><h3>출처 연결 ${report.citations.length}개</h3>${report.citations.map(c=>`<article class="review-record"><b>${c.current?'원문 위치 일치':'다시 확인 필요'}</b><p>${esc(c.claim)}</p><blockquote>${esc(c.excerpt)}</blockquote><p class="help">${esc(c.sourceName)} · ${c.line||'?'}행 · ${esc(c.by)} · ${esc(c.note)}</p><button class="button small secondary" type="button" data-review="remove-citation" data-id="${esc(c.id)}">연결 삭제</button></article>`).join('')||'<p class="help">아직 연결한 출처가 없습니다.</p>'}<h3>검토 의견</h3>${report.comments.map(c=>`<article class="review-record"><b>${esc(c.by)} · ${roleName[c.role]}</b>${c.anchor?`<blockquote>${esc(c.anchor)}</blockquote>`:''}<p>${esc(c.body)}</p><button type="button" class="button small secondary" data-review="toggle-comment" data-id="${esc(c.id)}">${c.resolved?'해결됨 · 다시 열기':'해결 처리'}</button></article>`).join('')||'<p class="help">검토 의견이 없습니다.</p>'}<h3>확인할 문장 후보 ${report.candidates.length}개</h3><p class="help">단순 표현 규칙으로 찾은 후보입니다. 출처가 없다는 이유만으로 틀린 문장으로 판단하지 않습니다.</p>${report.candidates.map((c,i)=>`<article class="review-record"><small>${esc(c.chapterTitle)} · ${c.reason}</small><p>${esc(c.text)}</p><button type="button" class="button small secondary" data-review="candidate" data-index="${i}">이 문장 연결</button></article>`).join('')}`;
}
export function mountReviewDesk(container,{getProject,onSave,onDownload,onError=()=>{}}) {
  const panel=container.querySelector('.review-desk');if(!panel)return {dispose(){}};
  let disposed=false,working=false;
  const status=panel.querySelector('[data-review-message]');
  const info=()=>({chapterId:panel.querySelector('[name="review-chapter"]').value,by:panel.querySelector('[name="reviewer"]').value,role:panel.querySelector('[name="review-role"]').value});
  async function save(value,message) {working=true;try{await onSave(value);if(!disposed){panel.querySelector('[data-review-results]').innerHTML=renderResults(getProject());status.textContent=message;}}finally{working=false;}}
  const submit=async event=>{const form=event.target.closest('[data-review-form]');if(!form)return;event.preventDefault();event.stopPropagation();if(working)return;try{const data=Object.fromEntries(new FormData(form));const p=getProject();const next=form.dataset.reviewForm==='citation'?addCitation(p,{...data,...info()}):addReviewComment(p,{...data,...info()});await save(next,'검토 기록을 저장했습니다.');if(!disposed)form.reset();}catch(e){status.textContent=e.message;onError(e);}};
  const clicked=async event=>{const b=event.target.closest('[data-review]');if(!b||working)return;event.preventDefault();try{
    const p=getProject(),action=b.dataset.review;
    if(action==='download'){onDownload(reviewReport(p));return;}
    if(action==='candidate'){const c=reviewReport(p).candidates[Number(b.dataset.index)];if(!c)return;panel.querySelector('[name="review-chapter"]').value=c.chapterId;panel.querySelector('[name="claim"]').value=c.text;panel.querySelector('[name="claim"]').focus();return;}
    let d=validateReviewDesk(p.reviewDesk)||emptyReviewDesk();
    if(action==='approve')d=approveChapterReview(p,info().chapterId,info().by);
    if(action==='remove-citation')d.citations=d.citations.filter(c=>c.id!==b.dataset.id);
    if(action==='toggle-comment'){const c=d.comments.find(c=>c.id===b.dataset.id);if(c)c.resolved=!c.resolved;}
    await save(d,'검토 기록을 저장했습니다.');
  }catch(e){status.textContent=e.message;onError(e);}};
  const changed=event=>{if(event.target.name==='sourceId')panel.querySelector('[data-review-source]').value=reviewSources(getProject()).find(s=>s.id===event.target.value)?.content||'';};
  panel.addEventListener('submit',submit);panel.addEventListener('click',clicked);panel.addEventListener('change',changed);
  return {dispose(){disposed=true;panel.removeEventListener('submit',submit);panel.removeEventListener('click',clicked);panel.removeEventListener('change',changed);}};
}
