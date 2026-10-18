/** Local interface preferences and literal manuscript search; no manuscript writes. */
export const EXPERIENCE_KEY = 'folio-experience-v1';
export const DEFAULT_PREFERENCES = Object.freeze({introDismissed:false,tutorialStarted:false,tutorialStep:0,tutorialComplete:false,fontSize:17});
function normalize(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    introDismissed:source.introDismissed===true,
    tutorialStarted:source.tutorialStarted===true,
    tutorialStep:Number.isInteger(source.tutorialStep)&&source.tutorialStep>=0&&source.tutorialStep<6?source.tutorialStep:0,
    tutorialComplete:source.tutorialComplete===true,
    fontSize:[15,17,20].includes(source.fontSize)?source.fontSize:17,
  };
}
export function loadPreferences(storage) {
  try { return normalize(JSON.parse(storage?.getItem(EXPERIENCE_KEY)||'null')); }
  catch { return {...DEFAULT_PREFERENCES}; }
}
export function savePreferences(storage, preferences) {
  try { storage.setItem(EXPERIENCE_KEY,JSON.stringify(normalize(preferences)));return true; }
  catch { return false; }
}
export function searchLibrary(projects, query, limit=40) {
  const needle=String(query||'').trim().toLocaleLowerCase();
  const results=[];
  const cap=needle?limit:Math.min(limit,12);
  for(const book of projects) {
    const bookTitle=String(book.title||'제목 없는 책');
    const bookMatch=needle&&bookTitle.toLocaleLowerCase().includes(needle);
    for(const chapter of book.chapters||[]) {
      const title=String(chapter.title||'제목 없는 장');
      const content=String(chapter.content||'');
      const contentIndex=needle?content.toLocaleLowerCase().indexOf(needle):-1;
      if(needle&&!bookMatch&&!title.toLocaleLowerCase().includes(needle)&&contentIndex<0)continue;
      const start=contentIndex>35?contentIndex-35:0;
      const excerpt=content.slice(start,start+145).replace(/\s+/g,' ').trim();
      results.push({projectId:book.id,chapterId:chapter.id,bookTitle,title,snippet:(start?'…':'')+excerpt+(content.length>start+145?'…':'')});
      if(results.length>=cap)return results;
    }
  }
  return results;
}
