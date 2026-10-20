import {normalizeProductionBrief} from './production.js';
import {readSourceFiles} from './source-files.js';

/** Registered research stays separate from the editable manuscript. */
export function validateRegisteredSources(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('등록한 원시 소스 형식을 확인해 주세요.');
  const brief = normalizeProductionBrief({...value, topic:'원시 소스 보관', targetUnit:'chars', targetValue:30000, chapterCount:0});
  const result = {sourceMarkdown:brief.sourceMarkdown, sourceName:brief.sourceName};
  if (brief.sourceManifest) result.sourceManifest = brief.sourceManifest;
  if (brief.sourceImages?.length) result.sourceImages = brief.sourceImages;
  return result;
}

export function hasRegisteredSources(value) {
  return Boolean(value?.sourceMarkdown?.trim() || value?.sourceImages?.length);
}

export async function readRegisteredSources(files, {bundle=false, signal, onProgress} = {}) {
  if (bundle) {
    const result = await readSourceFiles(files, {signal, onProgress});
    return validateRegisteredSources({sourceMarkdown:result.sourceMarkdown, sourceName:result.sourceName,
      ...(result.files.length ? {sourceManifest:{files:result.files, ignoredCount:result.ignoredCount, folderName:result.folderName}} : {}),
      ...(result.sourceImages.length ? {sourceImages:result.sourceImages} : {})});
  }
  const file = files[0];
  if (!file || !/\.(md|markdown|txt)$/i.test(file.name)) throw new Error('Markdown(.md, .markdown) 또는 텍스트(.txt) 파일을 선택해 주세요.');
  if (file.size > 480000) throw new Error('원시 소스는 120,000자까지 지원합니다. 파일을 나누어 주세요.');
  signal?.throwIfAborted();
  const raw = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(await file.arrayBuffer());
  signal?.throwIfAborted();
  return validateRegisteredSources({sourceMarkdown:raw, sourceName:file.name.slice(0,255)});
}
