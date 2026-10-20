/** Planning ranges, never a billing meter. Prices verified 2026-10-19. */
const GOOGLE_PRICING = 'https://ai.google.dev/gemini-api/docs/pricing';
const OPENAI_PRICING = 'https://developers.openai.com/api/docs/models/gpt-4.1';
export const ESTIMATE_REFERENCES = Object.freeze({
  verifiedAt: '2026-10-19', google: GOOGLE_PRICING, openai: OPENAI_PRICING,
  image: 'https://developers.openai.com/api/docs/models/gpt-image-1',
  fx: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html',
  fxDate: '2026-10-16', fxRate: Math.round(1499.01 / 1.1253 * 100) / 100,
});
const estimates = new WeakMap();
const approvals = new WeakMap();
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const chars = value => Array.from(String(value || '')).length;
const number = value => Math.round(value).toLocaleString('ko-KR');
const digest = value => {
  const input = JSON.stringify(value); let hash = 2166136261;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
};
const configuration = config => ({provider: config?.provider || 'google', textModel: String(config?.textModel || ''), imageModel: String(config?.imageModel || '')});
const configKey = config => JSON.stringify(configuration(config));
const snapshot = project => digest({id:project.id, brief:project.production?.briefFingerprint,
  manuscript:project.production?.manuscriptFingerprint, requests:project.production?.requestsStarted,
  stage:project.production?.stage, status:project.production?.status, artwork:project.production?.artwork,
  sourceProgress:project.production?.sources?.map(source=>Boolean(source.digest)),
  sections:project.production?.plan?.chapters?.flatMap(chapter=>chapter.sections.map(section=>[section.status,section.revisionAttempts])),
  planning:project.production?.planning?.chapters?.length,
});

export function describeBookLength(value) {
  const total = Math.max(0, finite(value));
  const low = Math.ceil(total / 1000), high = Math.ceil(total / 600);
  const ratio = Math.round(total / (200 * 800) * 100);
  const kind = total < 15000 ? '짧은 소책자' : total < 50000 ? '가벼운 소책자·짧은 실용서' : total < 120000 ? '중간 분량의 에세이·실용서' : '단행본 분량';
  return {chars:total, pagesLow:low, pagesHigh:high, referencePages:Math.ceil(total/800), kind,
    label:`본문 ${number(total)}자 · 일반 책 약 ${number(low)}~${number(high)}쪽 · ${kind}`,
    comparison:`200쪽 책의 약 ${number(ratio)}% 분량`,
    assumption:'글 중심 단행본을 쪽당 공백 제외 600~1,000자로 가정한 비교입니다. 200쪽 비교와 목표 쪽수는 800자/쪽 기준이며, 판형·글꼴·그림에 따라 실제 쪽수는 달라집니다.'};
}

function customRate(value) {
  if (value === undefined || value === null || value === '') return null;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100000) throw new Error('단가는 0~100,000 사이의 숫자로 입력해 주세요.');
  return rate;
}
function textRates(config, preferences, date) {
  const input = customRate(preferences.inputPerMillion), output = customRate(preferences.outputPerMillion);
  if (input !== null || output !== null) {
    if (input === null || output === null) return null;
    return {input, output, label:'직접 입력한 단가', source:'', custom:true};
  }
  if (config.provider === 'google') {
    const rates = {
      'gemini-3.8-flash': date < '2027-01-01' ? [0.75,3.75] : [1.5,7.5],
      'gemini-4-argon': date < '2026-12-01' ? [2,10] : [4,20],
      'gemini-2.5-flash': [0.3,2.5], 'gemini-2.5-flash-lite': [0.1,0.4],
    }[config.textModel];
    if (rates) return {input:rates[0],output:rates[1],label:'Google Standard 유료 구간',source:GOOGLE_PRICING};
  }
  if (config.provider === 'openai' && ['gpt-4.1','gpt-4.1-2025-04-14'].includes(config.textModel)) {
    return {input:2,output:8,label:'OpenAI Standard',source:OPENAI_PRICING};
  }
  return null;
}
function imageRates(config, preferences) {
  const custom = customRate(preferences.imagePerImage);
  if (custom !== null) return {low:custom,high:custom,input:0,text:0,label:'직접 입력한 이미지 1장 총액',custom:true,source:''};
  if (config.provider === 'google' && config.imageModel === 'gemini-nano-banana-2.1') return {low:0.0336,high:0.113,input:1.5,text:7.5,label:'1K~4K 해상도 범위',source:GOOGLE_PRICING};
  if (config.provider === 'google' && config.imageModel === 'gemini-3.1-flash-image') return {low:0.045,high:0.151,input:0.5,text:3,label:'0.5K~4K 해상도 범위',source:GOOGLE_PRICING};
  if (config.provider === 'openai' && config.imageModel === 'gpt-image-1') return {low:0.063,high:0.063,input:5,text:0,label:'1024×1536 · medium',source:ESTIMATE_REFERENCES.image};
  return null;
}
function remaining(project, retry) {
  const p = project.production || {}, brief = p.brief || {};
  const target = finite(p.targetChars, finite(brief.targetValue,30000) * (brief.targetUnit === 'pages' ? 800 : 1));
  const count = finite(p.chapterCount) || finite(brief.chapterCount) || Math.min(40,Math.max(2,Math.ceil(target/6000)));
  const sections = p.plan?.chapters?.flatMap(chapter=>chapter.sections) || [];
  const done = new Set(['complete','needs_review']);
  let draftCount = 0, reviseCount = 0, outputChars = 0;
  if (sections.length) {
    for (const section of sections) {
      if (retry) { if(section.status==='needs_review'){reviseCount++;outputChars+=section.targetChars;} }
      else if (!done.has(section.status)) {
        outputChars += section.targetChars;
        if (section.status==='pending') draftCount++;
        else if(section.revisionAttempts<1) reviseCount++;
      }
    }
  } else if (!retry) {
    const perChapter = Math.floor(target/count), extra = target % count;
    draftCount = Array.from({length:count},(_,i)=>Math.ceil((perChapter+(i<extra?1:0))/2500)).reduce((a,b)=>a+b,0);
    outputChars = target;
  }
  const sources = retry ? [] : (p.sources || []).filter(source=>!source.digest && (source.kind==='image' || String(brief.sourceMarkdown || '').slice(source.start,source.end).trim()));
  const sourceChars = sources.filter(source=>source.kind!=='image').reduce((sum,source)=>sum+source.end-source.start,0);
  const sourceImages = sources.filter(source=>source.kind==='image').length;
  const plans = retry || p.plan ? 0 : Math.max(0,Math.ceil(count/20) * Number(count>40) + Number(count<=40) - Math.ceil((p.planning?.chapters?.length||0)/20));
  const artwork = p.artwork || {}, completed = new Set(artwork.completed || []);
  let imageCount = 0, coverPlan = 0;
  if (brief.illustrations==='ai' && artwork.status!=='complete') {
    if (!completed.has('cover')&&!project.coverImage) {imageCount++;coverPlan=1;}
    for(const index of [...new Set([0,Math.floor(count/2)])]) if (!completed.has(`chapter:${index}`)&&!project.chapters?.[index]?.image) imageCount++;
  }
  const minimum = sources.length+plans+draftCount+reviseCount+coverPlan;
  return {target,count,sourceChars,sourceImages,sourceCount:sources.length,plans,draftCount,reviseCount,outputChars,imageCount,coverPlan,minRequests:minimum,maxRequests:minimum+draftCount};
}

/** Remaining work only. The upper range is a scenario estimate, not a spend cap. */
export function estimateProduction(project, config = {}, preferences = {}, {retry=false, date=new Date().toISOString().slice(0,10)} = {}) {
  const selected = configuration(config), work = remaining(project,retry), brief = project.production?.brief || {};
  const rates = textRates(selected,preferences,date), images = imageRates(selected,preferences);
  const fx = preferences.usdKrw === undefined || preferences.usdKrw === '' ? ESTIMATE_REFERENCES.fxRate : Number(preferences.usdKrw);
  if (!Number.isFinite(fx)||fx<=0||fx>100000) throw new Error('환율은 0보다 크고 100,000 이하인 숫자로 입력해 주세요.');
  const briefChars = chars(brief.topic)+chars(brief.instructions)+chars(brief.audience)+chars(brief.tone)+chars(brief.voiceSample);
  // Heuristic includes repeated instructions, source digests/excerpts, generated
  // plans and previous paragraphs; it is deliberately disclosed in the view.
  const contextChars = 3500+briefChars+Math.min(18000,chars(brief.sourceMarkdown));
  const inputLow = Math.ceil((work.sourceChars+work.minRequests*contextChars)*0.5+work.sourceImages*1000);
  const inputHigh = Math.ceil((work.sourceChars+work.maxRequests*(contextChars+10000))*1.8+work.sourceImages*8000);
  const outputLow = Math.ceil((work.outputChars+work.sourceCount*1200+work.plans*work.count*400+work.coverPlan*1500)*0.5);
  const outputHigh = Math.ceil((work.outputChars*(work.draftCount?2:1)+work.sourceCount*3000+work.plans*work.count*700+work.coverPlan*3000)*1.8+work.maxRequests*8192);
  const textCost = rates ? {low:(inputLow*rates.input+outputLow*rates.output)/1e6,high:(inputHigh*rates.input+outputHigh*rates.output)/1e6} : work.maxRequests===0 ? {low:0,high:0} : null;
  const imageCost = work.imageCount===0 ? {low:0,high:0} : images ? {low:work.imageCount*(images.low+1000*images.input/1e6),high:work.imageCount*(images.high+(12000*images.input+8192*images.text)/1e6)} : null;
  const usd = textCost&&imageCost ? {low:textCost.low+imageCost.low,high:textCost.high+imageCost.high} : null;
  const minMinutes = Math.ceil((Math.max(work.minRequests*20,outputLow/80)+work.imageCount*30)/60);
  const maxMinutes = Math.max(minMinutes,Math.ceil((Math.max(work.maxRequests*150,outputHigh/20)+work.imageCount*180)/60));
  const result = {version:1,config:selected,retry,work,rates,imageRates:images,preferences:{...preferences},date,
    fx,fxDate:preferences.usdKrw!==undefined&&preferences.usdKrw!==''?'사용자 입력':ESTIMATE_REFERENCES.fxDate,
    tokens:{inputLow,inputHigh,outputLow,outputHigh},textCost,imageCost,usd,
    krw:usd?{low:usd.low*fx,high:usd.high*fx}:null,minutes:{low:minMinutes,high:maxMinutes},completePricing:Boolean(usd),
    length:describeBookLength(work.target),fingerprint:snapshot(project)};
  estimates.set(result,{project,snapshot:result.fingerprint,config:selected,preferences:{...preferences},retry,date,signature:JSON.stringify(result)});
  return result;
}

export function formatMoneyRange(range, currency='USD') {
  if(!range)return '단가 입력 필요';
  const format = value => currency==='KRW' ? `₩${Math.ceil(value).toLocaleString('ko-KR')}` : `$${(Math.ceil(value*100)/100).toFixed(2)}`;
  return `${format(range.low)}–${format(range.high)}`;
}
export function formatDurationRange(range) {
  if(!range||!range.high)return '추가 요청 없음';
  return `약 ${number(range.low)}~${number(range.high)}분`;
}
function approvalError(message) { const error=new Error(message);error.name='ProductionError';error.code='APPROVAL_REQUIRED';throw error; }

/** Call only from the explicit approval UI event; nothing is persisted. */
export function createProductionApproval(project, estimate) {
  const record=estimates.get(estimate);
  if(!record||record.project!==project||record.signature!==JSON.stringify(estimate)||record.snapshot!==snapshot(project)) approvalError('제작 조건이나 진행 상황이 바뀌었습니다. 예상 비용을 다시 확인하고 승인해 주세요.');
  if(!estimate.completePricing) approvalError('확인되지 않은 모델의 단가를 입력한 후 승인해 주세요.');
  const token=Object.freeze({approvedAt:new Date().toISOString(),fingerprint:record.snapshot});
  approvals.set(token,{...record,briefFingerprint:project.production?.briefFingerprint,used:false,closed:false});
  return token;
}
/** Start checks saved work too; running checks allow legitimate manuscript growth. */
export function assertProductionApproval(project, token, config, {retry=false,running=false}={}) {
  const record=approvals.get(token);
  if(!record||record.closed||record.project!==project||record.retry!==retry||record.briefFingerprint!==project.production?.briefFingerprint||configKey(record.config)!==configKey(config)||config?.configured===false) approvalError('제작 조건 또는 AI 연결이 바뀌었습니다. 비용을 다시 확인하고 집필을 승인해 주세요.');
  if(!running&&(record.used||record.snapshot!==snapshot(project))) approvalError('이어 쓰기와 재시도는 남은 비용을 다시 확인하고 승인해 주세요.');
  return true;
}
export function consumeProductionApproval(project, token, config, options={}) {
  assertProductionApproval(project,token,config,options);
  approvals.get(token).used=true;
}
export function closeProductionApproval(token) {const record=approvals.get(token);if(record)record.closed=true;}
