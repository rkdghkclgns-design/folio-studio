import {prepareBookPreview} from './export.js';
import {mountBookPreview} from './book-preview.js';
import {renderBookEditor, mountBookEditor} from './book-editor.js';
import {getReadingChapters} from './book-matter.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** A scoped, editable book view. Mutations always target the captured book. */
export function mountBookPreviewEditor(host, options) {
  const book = options.project;
  let mode = options.mode === 'edit' ? 'edit' : 'preview', selectedId = options.chapterId;
  let reader = null, editor = null, generation = 0, disposed = false, checkpointed = false;
  const sourceChapter = id => book.chapters.find(c => c.id === id) || Object.values(book.bookMatter || {}).find(c => c?.id === id);
  const chapters = () => getReadingChapters(book);
  const current = () => sourceChapter(selectedId) || sourceChapter(chapters()[0]?.id);
  selectedId = current()?.id;
  host.innerHTML = '<div class="book-workspace-toolbar"><div role="group" aria-label="책 보기 모드"><button type="button" class="button small secondary" data-book-mode="preview">프리뷰</button><button type="button" class="button small secondary" data-book-mode="edit">에디터</button></div><label>장 선택 <select data-book-section aria-label="책에서 편집할 장"></select></label><button type="button" class="button small secondary" data-book-save>변경 저장</button><span class="help" data-book-status role="status"></span></div><div data-book-content></div>';
  const content = host.querySelector('[data-book-content]'), select = host.querySelector('[data-book-section]'), status = host.querySelector('[data-book-status]');
  const updateSelect = () => { select.innerHTML = chapters().map(c => '<option value="'+esc(c.id)+'">'+esc(c.title)+'</option>').join(''); select.value = selectedId || ''; };
  const valid = () => !disposed && (!options.isCurrent || options.isCurrent());
  const failure = error => { if(disposed)return; status.textContent = error.message || '변경 내용을 확인해 주세요.'; options.onError?.(error); };
  const changed = (chapter, detail) => { if(!valid())throw new Error('책이 바뀌어 편집을 멈췄습니다.'); options.onChange?.(chapter, detail); updateSelect(); status.textContent='저장 중…'; };
  const save = async expectedGeneration => {
    const savingCurrent = () => valid() && (expectedGeneration === undefined || generation === expectedGeneration);
    if(!savingCurrent())return false;
    await editor?.flush();
    if(!savingCurrent())return false;
    const saved = await options.onSave?.();
    if(!savingCurrent())return false;
    if(saved === false){status.textContent='저장 실패 · 현재 탭의 원고를 백업해 주세요.';return false;}
    status.textContent='변경 내용 저장됨';return true;
  };
  async function show(nextMode, {followSelection = true, chapterId} = {}) {
    if(!valid())return;
    const token=++generation;
    if(editor && !await save(token)){if(generation===token)select.value=selectedId;return;}
    if(!valid()||generation!==token)return;
    if(chapterId && sourceChapter(chapterId))selectedId=chapterId;
    mode = nextMode;
    reader?.destroy(); reader=null; editor?.destroy(); editor=null;
    host.querySelectorAll('[data-book-mode]').forEach(button=>{const active=button.dataset.bookMode===mode;button.setAttribute('aria-pressed',String(active));button.classList.toggle('primary',active);button.classList.toggle('secondary',!active);});
    updateSelect();
    if(mode==='edit'){
      const chapter = current(); if(!chapter){content.textContent='편집할 원고가 없습니다.';return;}
      content.innerHTML=renderBookEditor(chapter,{textareaId:'book-modal-manuscript',titleId:'book-modal-title'});
      editor=mountBookEditor(content.querySelector('.book-editor'),{getChapter:()=>valid()&&(!options.canEdit||options.canEdit())?current():null,onBeforeChange:(c,label)=>{if(!checkpointed){options.onBeforeChange?.(c,label);checkpointed=true;}},onChange:changed,onError:failure});
      status.textContent='수정 내용은 자동 저장됩니다.';
      return;
    }
    content.innerHTML='<div class="book-reader-host"><p role="status">책을 조판하고 있습니다…</p></div>';
    try {
      const prepared = await prepareBookPreview(structuredClone(book));
      if(!valid()||generation!==token)return;
      const requestedChapterId=selectedId;
      reader=mountBookPreview(content.firstElementChild,{...prepared,title:book.title,onPageChange:state=>{const id=prepared.sections[state.section]?.chapterId;if(id&&sourceChapter(id)){selectedId=id;select.value=id;}}});
      const mounted=reader; await mounted.ready;
      if(!valid()||generation!==token||reader!==mounted)return;
      if(followSelection){const section=prepared.sections.find(s=>s.chapterId===requestedChapterId);if(section)mounted.goToSection(section.id);}
      status.textContent='책장을 넘기거나 에디터에서 수정하세요.';
    }catch(error){if(generation===token)failure(error);}
  }
  async function click(event){const button=event.target.closest('button');if(!button||!host.contains(button))return;try{if(button.dataset.bookMode)await show(button.dataset.bookMode);else if(button.hasAttribute('data-book-save'))await save();}catch(error){failure(error);}}
  async function change(event){if(event.target!==select||!valid())return;const requestedId=select.value;try{await show(mode,{chapterId:requestedId});}catch(error){failure(error);}}
  host.addEventListener('click',click);host.addEventListener('change',change);
  const ready=show(mode,{followSelection:Boolean(options.chapterId||mode==='edit')});
  return {ready,flush:save,getState:()=>({mode,chapterId:selectedId}),destroy(){disposed=true;generation++;reader?.destroy();editor?.destroy();host.removeEventListener('click',click);host.removeEventListener('change',change);}};
}
