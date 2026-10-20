import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultSource = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const inside = (parent, child) => { const value = relative(parent, child); return !value || (!value.startsWith('..' + sep) && value !== '..' && !isAbsolute(value)); };

async function canonicalDestination(value) {
  const path = resolve(value);
  try { return await realpath(path); } catch (error) {
    if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(await canonicalDestination(dirname(path)), basename(path));
  }
}

async function collectFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.isSymbolicLink()) throw new Error('Static packaging does not follow symbolic links.');
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await collectFiles(join(directory, entry.name), name + '/'));
    else if (entry.isFile()) files.push({ name, bytes: await readFile(join(directory, entry.name)) });
    else throw new Error('Static packaging accepts only regular files and directories.');
  }
  return files;
}

function versionEntry(html, names, assetBase) {
  return html.replace(/<(?:script|link)\b[^>]*>/gi, tag => {
    const script = /^<script\b/i.test(tag);
    if (!script && !/\brel\s*=\s*(["'])stylesheet\1/i.test(tag)) return tag;
    const attribute = script ? 'src' : 'href';
    const pattern = new RegExp('(\\b' + attribute + '\\s*=\\s*)(["\'])([^"\']+)\\2', 'i');
    return tag.replace(pattern, (match, start, quote, url) => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return match;
      const [path] = url.split(/[?#]/);
      if (!path.endsWith(script ? '.js' : '.css')) return match;
      const name = path.replace(/^\.\//, '');
      if (!names.has(name)) throw new Error('Missing local entry asset: ' + path);
      return start + quote + assetBase + url.replace(/^\.\//, '') + quote;
    });
  });
}

/** Keep the document URL stable so existing browser books remain on the same origin.
 * Every module and stylesheet shares a content-addressed directory, including vendor
 * dependencies and relative CSS assets. Root copies retain legacy/download links.
 */
export async function packageStatic({ sourceDir = defaultSource, outputDir } = {}) {
  if (!outputDir) throw new Error('An output directory is required.');
  const source = await realpath(sourceDir), output = await canonicalDestination(outputDir);
  if (inside(source, output)) throw new Error('Output must be outside the static source directory.');
  try {
    const info = await stat(output);
    if (!info.isDirectory() || (await readdir(output)).length) throw new Error('Output directory must be absent or empty.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = await collectFiles(source), names = new Set(files.map(file => file.name));
  if (!names.has('index.html')) throw new Error('Static source requires index.html.');
  if (names.has('release.json') || files.some(file => file.name.startsWith('assets/'))) throw new Error('Static source uses a reserved packaging path.');
  const digest = createHash('sha256');
  for (const file of files) digest.update(file.name + '\0' + file.bytes.length + '\0').update(file.bytes);
  const version = digest.digest('hex').slice(0, 20), assetBase = './assets/' + version + '/';
  const index = versionEntry(files.find(file => file.name === 'index.html').bytes.toString('utf8'), names, assetBase);
  await mkdir(output, { recursive: true });
  for (const file of files) {
    for (const destination of [join(output, file.name), join(output, 'assets', version, file.name)]) {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.bytes);
    }
  }
  await writeFile(join(output, 'index.html'), index);
  const result = { version, assetBase, fileCount: files.length };
  await writeFile(join(output, 'release.json'), JSON.stringify(result, null, 2) + '\n');
  return { ...result, outputDir: output };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  packageStatic({ outputDir: process.argv[2] }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
