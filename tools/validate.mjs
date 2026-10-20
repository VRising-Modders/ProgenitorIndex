#!/usr/bin/env node
// Hard checks for Index entries. See CONTRIBUTING.md for what each check means.
//
//   node tools/validate.mjs [entry files or folders...]   (default: every entry)
//     --root <dir>            repository to check (default: this checkout)
//     --changed-since <ref>   check only entries added or changed since a git ref
//     --offline               shape checks only, no downloads
//     --update-lock           add missing Thunderstore dependencies to thunderstore-lock.json
//     --no-cache              always download again
//     --summary <file>        also write a Markdown summary
//     --delay <ms>            pause between downloads (default 250)

import { execFileSync } from 'node:child_process';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  checkRevoked, describeEntryPath, download, entryId, isRevoked, listEntries, loadLock, loadRevoked,
  parseGitHubRepo, parseReleaseAssetUrl, readJson, saveLock, sha256, sleep, thunderstoreDownloadUrl, thunderstoreVersions,
} from './lib/common.mjs';
import { DEP_RE, inspectPackage, parseDependency } from './lib/package.mjs';
import { ROOT } from './lib/paths.mjs';
import { loadSchema, validateSchema } from './lib/schema.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string' },
    'changed-since': { type: 'string' },
    offline: { type: 'boolean', default: false },
    'update-lock': { type: 'boolean', default: false },
    'no-cache': { type: 'boolean', default: false },
    summary: { type: 'string' },
    delay: { type: 'string', default: '250' },
  },
});

const root = resolve(opts.root ?? ROOT);
const delay = Number(opts.delay) || 0;
const cache = !opts['no-cache'];

const globalErrors = [];
const globalWarnings = [];

// ---------- choose entries ----------
const all = listEntries(root);
let targets;
let modifiedExisting = new Set();
if (opts['changed-since']) {
  const out = execFileSync('git', ['-C', root, 'diff', '--name-status', '--no-renames', `${opts['changed-since']}...HEAD`, '--', 'entries'], { encoding: 'utf8' });
  targets = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const [status, path] = line.split('\t');
    if (status === 'D') { globalWarnings.push(`${path}: removes a listed version (use revoked.json for takedowns)`); continue; }
    if (status === 'M') modifiedExisting.add(path);
    targets.push(describeEntryPath(root, join(root, path)));
  }
  if (targets.length > 1) globalWarnings.push(`${targets.length} entries changed in one pull request; author submissions should add one version each`);
} else if (positionals.length) {
  targets = [];
  for (const p of positionals) {
    const abs = resolve(p);
    if (existsSync(abs) && statSync(abs).isDirectory()) targets.push(...all.filter((e) => e.file.startsWith(abs)));
    else targets.push(describeEntryPath(root, abs));
  }
} else {
  targets = all;
}

// ---------- repository-wide files ----------
let revoked = [];
try { revoked = loadRevoked(root); globalErrors.push(...checkRevoked(revoked)); } catch (e) { globalErrors.push(`revoked.json: ${e.message}`); }

let lock = {};
try {
  lock = loadLock(root);
  for (const [id, v] of Object.entries(lock)) {
    const d = parseDependency(id);
    if (!d) { globalErrors.push(`thunderstore-lock.json: "${id}" is not Owner-Name-Version`); continue; }
    if (!v || v.package !== thunderstoreDownloadUrl(d.owner, d.name, d.version)) globalErrors.push(`thunderstore-lock.json: "${id}" must have its Thunderstore download URL as "package"`);
    if (!v || !/^[0-9a-f]{64}$/.test(v.sha256 ?? '')) globalErrors.push(`thunderstore-lock.json: "${id}" needs a lowercase hex "sha256"`);
  }
} catch (e) { globalErrors.push(`thunderstore-lock.json: ${e.message}`); }

const indexIds = new Set(all.filter((e) => !e.shapeError).map((e) => entryId(e.owner, e.name, e.version)));
// Case-insensitive duplicates would collide on Windows and confuse Owner-Name lookups.
const seenLower = new Map();
for (const e of all.filter((x) => !x.shapeError)) {
  const k = entryId(e.owner, e.name, e.version).toLowerCase();
  if (seenLower.has(k) && seenLower.get(k) !== e.rel) globalErrors.push(`${e.rel}: differs only in letter case from ${seenLower.get(k)}`);
  seenLower.set(k, e.rel);
}

let tsVersions = null;
async function ts() {
  if (!tsVersions) tsVersions = await thunderstoreVersions();
  return tsVersions;
}

let lockChanged = false;
const verifiedDeps = new Map();

async function checkDependency(id, errors, warnings) {
  const d = parseDependency(id);
  if (!d) return; // already reported by the package check
  if (indexIds.has(id)) {
    const r = isRevoked(revoked, d.owner, d.name, d.version);
    if (r) errors.push(`dependency ${id} is revoked (${r.reason})`);
    return;
  }
  const tsv = (await ts()).get(id);
  if (!tsv) { errors.push(`dependency ${id} is not in the Index or in the V Rising community on Thunderstore; add it to the Index first`); return; }
  if (tsv.pkg.is_deprecated) warnings.push(`dependency ${id} is deprecated on Thunderstore`);
  if (opts.offline) {
    if (!lock[id]) errors.push(`dependency ${id} is missing from thunderstore-lock.json`);
    return;
  }
  if (verifiedDeps.has(id)) { const e = verifiedDeps.get(id); if (e) errors.push(e); return; }
  const url = thunderstoreDownloadUrl(d.owner, d.name, d.version);
  let msg = null;
  try {
    const buf = await download(url, { cache, expectSha: lock[id]?.sha256 });
    await sleep(delay);
    const sum = sha256(buf);
    if (!lock[id]) {
      if (opts['update-lock']) { lock[id] = { package: url, sha256: sum }; lockChanged = true; }
      else msg = `dependency ${id} is missing from thunderstore-lock.json (run: node tools/validate.mjs --update-lock <entry>)`;
    } else if (lock[id].sha256 !== sum) {
      msg = `dependency ${id}: Thunderstore file does not match its fingerprint in thunderstore-lock.json`;
    }
  } catch (e) {
    msg = `dependency ${id}: download failed (${e.message})`;
  }
  verifiedDeps.set(id, msg);
  if (msg) errors.push(msg);
}

async function checkEntry(info) {
  const errors = [];
  const warnings = [];
  const result = { rel: info.rel, errors, warnings };
  if (info.shapeError) { errors.push(info.shapeError); return result; }
  if (!existsSync(info.file)) { errors.push('file not found'); return result; }
  if (modifiedExisting.has(info.rel)) warnings.push('changes an already listed version; listed versions should not change after review');

  let entry;
  try { entry = readJson(info.file); } catch (e) { errors.push(`not valid JSON: ${e.message}`); return result; }
  const schemaErrors = validateSchema(loadSchema('entry.schema.json'), entry);
  if (schemaErrors.length) { errors.push(...schemaErrors); return result; }
  result.entry = entry;

  const repo = parseGitHubRepo(entry.repo);
  if (!repo || repo.url !== entry.repo) errors.push('"repo" must be exactly https://github.com/<owner>/<repo>');

  // Ownership and source rules
  if (!entry.imported && repo && repo.owner.toLowerCase() !== info.owner.toLowerCase()) {
    errors.push(`owner folder "${info.owner}" must be the GitHub account that owns ${entry.repo}`);
  }
  if (entry.source === 'github-release') {
    const a = parseReleaseAssetUrl(entry.package);
    if (!a) errors.push('"package" must be a GitHub release download: https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.zip');
    else if (repo && (a.owner.toLowerCase() !== repo.owner.toLowerCase() || a.repo.toLowerCase() !== repo.repo.toLowerCase())) {
      errors.push(`"package" is a release of ${a.owner}/${a.repo}, not of ${repo.owner}/${repo.repo}`);
    } else if (!a.file.toLowerCase().endsWith('.zip')) errors.push('"package" must be a .zip release asset');
  } else if (entry.source === 'thunderstore') {
    const want = thunderstoreDownloadUrl(info.owner, info.name, info.version);
    if (entry.package !== want) errors.push(`"package" for a Thunderstore source must be ${want}`);
  }
  if (isRevoked(revoked, info.owner, info.name, info.version)) warnings.push('this version is revoked');
  if (entry.imported && !entry.confirmed) warnings.push('imported from Thunderstore; not yet confirmed by its author');
  if (opts.offline) return result;

  // Fingerprint
  let buf;
  try { buf = await download(entry.package, { cache, expectSha: entry.sha256 }); await sleep(delay); }
  catch (e) { errors.push(`download failed: ${e.message}`); return result; }
  const sum = sha256(buf);
  if (sum !== entry.sha256) { errors.push(`sha256 mismatch: the file is ${sum}`); return result; }
  result.size = buf.length;

  // Package format and contents
  const pkg = inspectPackage(buf);
  errors.push(...pkg.errors);
  warnings.push(...pkg.warnings);
  if (pkg.manifest) {
    if (pkg.manifest.name !== info.name) errors.push(`manifest name "${pkg.manifest.name}" does not match the folder "${info.name}"`);
    if (pkg.manifest.version_number !== info.version) errors.push(`manifest version "${pkg.manifest.version_number}" does not match the file name "${info.version}"`);
    const site = parseGitHubRepo(pkg.manifest.website_url);
    if (!site) warnings.push('manifest website_url does not point at a GitHub repository');
    else if (repo && site.url.toLowerCase() !== repo.url.toLowerCase()) warnings.push(`manifest website_url points at ${site.url}, not ${entry.repo}`);
    if (Array.isArray(pkg.manifest.dependencies)) {
      for (const dep of pkg.manifest.dependencies) {
        if (typeof dep === 'string' && DEP_RE.test(dep)) await checkDependency(dep, errors, warnings);
      }
    }
  }
  return result;
}

// ---------- run ----------
const results = [];
for (const t of targets) {
  const r = await checkEntry(t);
  results.push(r);
  const status = r.errors.length ? 'FAIL' : 'ok  ';
  console.log(`${status} ${r.rel}`);
  for (const e of r.errors) console.log(`       error: ${e}`);
  for (const w of r.warnings) console.log(`       note:  ${w}`);
}
if (lockChanged) { saveLock(root, lock); console.log('Updated thunderstore-lock.json'); }
for (const e of globalErrors) console.log(`error: ${e}`);
for (const w of globalWarnings) console.log(`note:  ${w}`);

const failed = results.filter((r) => r.errors.length).length + (globalErrors.length ? 1 : 0);
const passed = results.filter((r) => !r.errors.length).length;
console.log(`\n${results.length} entries checked: ${passed} passed, ${results.length - passed} failed${globalErrors.length ? `; ${globalErrors.length} repository errors` : ''}${opts.offline ? ' (offline: no downloads)' : ''}`);

if (opts.summary) {
  const md = [];
  md.push(`## Progenitor Index checks`, '');
  md.push(failed ? `**${results.length - passed} of ${results.length} entries failed a hard check.**` : `**All ${results.length} checked entries passed the hard checks.**`);
  if (opts.offline) md.push('', 'Offline run: shape checks only, no downloads.');
  md.push('');
  if (results.length) {
    md.push('| Entry | Result | Details |', '|---|---|---|');
    const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    for (const r of results) {
      const details = [...r.errors.map((e) => `error: ${e}`), ...r.warnings.map((w) => `note: ${w}`)];
      md.push(`| \`${esc(r.rel)}\` | ${r.errors.length ? 'fail' : 'pass'} | ${details.length ? details.map(esc).join('<br>') : ''} |`);
    }
    md.push('');
  }
  if (globalErrors.length || globalWarnings.length) {
    md.push('### Repository', '');
    for (const e of globalErrors) md.push(`- error: ${e}`);
    for (const w of globalWarnings) md.push(`- note: ${w}`);
    md.push('');
  }
  md.push('Hard checks: entry shape and folder names, fingerprint, package format, ownership, dependencies, contents. A maintainer still reviews every submission; see CONTRIBUTING.md.');
  writeFileSync(opts.summary, md.join('\n') + '\n');
}

process.exit(failed ? 1 : 0);
