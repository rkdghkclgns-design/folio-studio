import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageStatic } from './scripts/package-static.mjs';

const repo = dirname(fileURLToPath(import.meta.url));
async function workspace(t) {
  const path = await mkdtemp(join(tmpdir(), 'folio-static-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function put(directory, files) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, name)), { recursive: true });
    await writeFile(join(directory, name), content);
  }
}
const fixtures = {
  'index.html': '<link rel="icon" href="./favicon.svg"><link rel="stylesheet" href="./style.css"><link rel="stylesheet" href="https://example.com/font.css"><script type="module" src="./app.js"></script><a href="./downloads/helper.zip" download>Helper</a><a href="https://example.com/">External</a>',
  'app.js': "import {value} from './nested/dependency.js'; export {value};",
  'nested/dependency.js': "import {value} from '../shared.js'; export {value};",
  'shared.js': 'export const value=1;',
  'style.css': "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR'); body { background:url('./favicon.svg'); }",
  'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  'downloads/helper.zip': 'fixture-download',
};

test('static packaging versions the complete module graph and leaves source and unrelated links unchanged', async t => {
  const path=await workspace(t), source=join(path,'source'), output=join(path,'site');
  await put(source, fixtures);
  const result=await packageStatic({sourceDir:source,outputDir:output});
  const html=await readFile(join(output,'index.html'),'utf8');
  assert.match(html,new RegExp('src="\\./assets/' + result.version + '/app\\.js"'));
  assert.ok(html.includes('href="./assets/'+result.version+'/style.css"'));
  for(const unchanged of ['href="./favicon.svg"','href="https://example.com/font.css"','href="./downloads/helper.zip"','href="https://example.com/"'])assert.ok(html.includes(unchanged));
  const documentURL=new URL('https://example.test/folio-studio/?release=latest');
  const entryURL=new URL(result.assetBase+'app.js',documentURL);
  const nestedURL=new URL('./nested/dependency.js',entryURL), sharedURL=new URL('../shared.js',nestedURL);
  assert.equal(sharedURL.pathname,'/folio-studio/assets/'+result.version+'/shared.js');
  for(const [name,bytes] of Object.entries(fixtures)){
    assert.equal(await readFile(join(source,name),'utf8'),bytes,'source changed: '+name);
    assert.equal(await readFile(join(output,'assets',result.version,name),'utf8'),bytes,'versioned bytes changed: '+name);
    if(name!=='index.html')assert.equal(await readFile(join(output,name),'utf8'),bytes,'legacy path changed: '+name);
  }
  const record=JSON.parse(await readFile(join(output,'release.json'),'utf8'));
  assert.equal(record.version,result.version);
  assert.equal(record.fileCount,Object.keys(fixtures).length);
});

test('static release identity is deterministic and changes for a transitive dependency or CSS',async t=>{
  const path=await workspace(t),source=join(path,'source');await put(source,fixtures);
  const first=await packageStatic({sourceDir:source,outputDir:join(path,'one')});
  const same=await packageStatic({sourceDir:source,outputDir:join(path,'two')});
  assert.equal(same.version,first.version);
  await writeFile(join(source,'shared.js'),'export const value=2;');
  const moduleChange=await packageStatic({sourceDir:source,outputDir:join(path,'three')});
  assert.notEqual(moduleChange.version,first.version);
  await writeFile(join(source,'style.css'),'body{color:green}');
  const styleChange=await packageStatic({sourceDir:source,outputDir:join(path,'four')});
  assert.notEqual(styleChange.version,moduleChange.version);
});

test('static packager rejects source overwrites, occupied output and missing entry assets',async t=>{
  const path=await workspace(t),source=join(path,'source');await put(source,fixtures);
  await assert.rejects(packageStatic({sourceDir:source,outputDir:source}),/outside/);
  await assert.rejects(packageStatic({sourceDir:source,outputDir:join(source,'out')}),/outside/);
  await put(join(path,'occupied'),{'keep.txt':'untouched'});
  await assert.rejects(packageStatic({sourceDir:source,outputDir:join(path,'occupied')}),/absent or empty/);
  assert.equal(await readFile(join(path,'occupied','keep.txt'),'utf8'),'untouched');
  await writeFile(join(source,'index.html'),'<script type="module" src="./missing.js"></script>');
  await assert.rejects(packageStatic({sourceDir:source,outputDir:join(path,'invalid')}),/Missing local entry asset/);
});

test('real Folio module imports all resolve inside the versioned tree while companion stays document-relative',async t=>{
  const path=await workspace(t),source=join(repo,'dist');
  const result=await packageStatic({sourceDir:source,outputDir:join(path,'site')});
  const html=await readFile(join(path,'site','index.html'),'utf8');
  assert.equal([...html.matchAll(/href="\.\/assets\//g)].length,9);
  assert.ok(html.includes('src="'+result.assetBase+'app.js"'));
  const names=(await readdir(source)).filter(name=>name.endsWith('.js'));
  const base=new URL('https://example.test/folio-studio/assets/'+result.version+'/');
  let importCount=0;
  for(const name of names){
    const original=await readFile(join(source,name),'utf8');
    const packaged=await readFile(join(path,'site','assets',result.version,name),'utf8');
    assert.equal(packaged,original);
    for(const match of packaged.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){
      const target=new URL(match[1],new URL(name,base));
      assert.ok(target.href.startsWith(base.href),name+' leaves the versioned tree');
      await readFile(join(path,'site','assets',result.version,decodeURIComponent(target.href.slice(base.href.length))));
      importCount++;
    }
  }
  assert.ok(importCount>60);
  assert.ok((await readFile(join(path,'site','assets',result.version,'computer-ui.js'),'utf8')).includes('href="./downloads/folio-computer-companion.zip"'));
  assert.ok((await readFile(join(path,'site','assets',result.version,'styles.css'),'utf8')).includes("@import url('https://fonts.googleapis.com/"));
});

test('Pages workflow invokes fingerprinted packager before adding the companion download',async()=>{
  const yaml=await readFile(join(repo,'.github/workflows/pages.yml'),'utf8');
  const packaging=yaml.indexOf('node scripts/package-static.mjs');
  assert.ok(packaging>=0);
  assert.ok(yaml.indexOf('python3 companion/package.py',packaging)>packaging);
  assert.ok(yaml.includes('--output "$RUNNER_TEMP/folio-pages/downloads/folio-computer-companion.zip"'));
});
