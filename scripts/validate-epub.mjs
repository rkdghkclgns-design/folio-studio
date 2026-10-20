#!/usr/bin/env node
/** Download, verify and run the pinned W3C checker. No diagnostic suppression. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeEpubFixtures } from './epub-fixtures.mjs';

export const EPUBCHECK = Object.freeze({
  version: '5.4.0',
  url: 'https://github.com/w3c/epubcheck/releases/download/v5.4.0/epubcheck-5.4.0.zip',
  sha256: '33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c',
});

export function verifyArchive(bytes) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== EPUBCHECK.sha256) throw new Error(`EPUBCheck archive checksum mismatch: ${digest}`);
  return digest;
}

export function summarizeReport(report, exitCode) {
  const checker = report?.checker;
  if (!checker || checker.checkerVersion !== EPUBCHECK.version || !Array.isArray(report.messages)
      || ['nFatal', 'nError', 'nWarning', 'nUsage'].some(key => !Number.isInteger(checker[key]) || checker[key] < 0)) {
    throw new Error('Missing or invalid EPUBCheck report; validation cannot pass.');
  }
  return { file: checker.filename, fatal: checker.nFatal, errors: checker.nError, warnings: checker.nWarning,
    usage: checker.nUsage, passed: exitCode === 0 && checker.nFatal === 0 && checker.nError === 0 && checker.nWarning === 0
      && !report.messages.some(message => ['FATAL', 'ERROR', 'WARNING'].includes(String(message.severity).toUpperCase())) };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

export async function validateEpubFixtures({ workdir = resolve(dirname(fileURLToPath(import.meta.url)), '../.qa/epubcheck'), files } = {}) {
  await mkdir(workdir, { recursive: true });
  const archivePath = join(workdir, `epubcheck-${EPUBCHECK.version}.zip`);
  let bytes;
  try { bytes = await readFile(archivePath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(EPUBCHECK.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`EPUBCheck download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    verifyArchive(bytes);
    await writeFile(archivePath, bytes);
  }
  verifyArchive(bytes); // Also verifies cached downloads before extracting/executing them.
  const extraction = run(process.platform === 'win32' ? 'python' : 'python3', ['-c',
    'import sys, zipfile, pathlib\nroot=pathlib.Path(sys.argv[2]).resolve()\nwith zipfile.ZipFile(sys.argv[1]) as z:\n for i in z.infolist():\n  target=(root/i.filename).resolve()\n  if not target.is_relative_to(root) or ((i.external_attr >> 16) & 0o170000) == 0o120000: raise ValueError("Unsafe archive path")\n z.extractall(root)\n', archivePath, workdir]);
  if (extraction.status !== 0) throw new Error(`EPUBCheck extraction failed: ${extraction.stderr}`);
  const jar = join(workdir, `epubcheck-${EPUBCHECK.version}`, 'epubcheck.jar');
  const reports = join(workdir, 'reports');
  await mkdir(reports, { recursive: true });
  const targets = files?.length ? files.map(file => resolve(file)) : await writeEpubFixtures(join(workdir, 'fixtures'));
  const results = [];
  for (let index = 0; index < targets.length; index++) {
    const reportPath = join(reports, `${index + 1}-${targets[index].split(/[\\/]/).pop()}.json`);
    const invocation = run('java', ['-Dfile.encoding=UTF-8', '-jar', jar, targets[index], '--locale', 'en', '--failonwarnings', '--maxOfEachMessage', 'unlimited', '--json', reportPath]);
    await writeFile(reportPath.replace(/\.json$/, '.log'), `${invocation.stdout || ''}\n${invocation.stderr || ''}`);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const result = summarizeReport(report, invocation.status);
    results.push(result);
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.file}: ${result.fatal} fatal, ${result.errors} errors, ${result.warnings} warnings`);
  }
  const summary = { checker: EPUBCHECK, checkedAt: new Date().toISOString(), results, passed: results.length > 0 && results.every(result => result.passed) };
  await writeFile(join(reports, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  if (!summary.passed) throw new Error('EPUBCheck failed. See .qa/epubcheck/reports for complete diagnostics.');
  return summary;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  validateEpubFixtures({ files: process.argv.slice(2) }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
