#!/usr/bin/env node
// Builds site/index.json (and site/revoked.json, site/icons/) from the entries plus the details
// read from each package. Entries whose package cannot be downloaded or no longer matches its
// fingerprint are left out and reported.
//
//   node tools/build-index.mjs [--root <dir>] [--out <dir>] [--strict] [--pretty] [--delay ms]

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  download, entryId, listEntries, loadLock, loadRevoked, readJson, sha256, sleep,
} from './lib/common.mjs';
import { inspectPackage, parseDependency } from './lib/package.mjs';
import { ROOT } from './lib/paths.mjs';
import { loadSchema, validateSchema } from './lib/schema.mjs';

const { values: opts } = parseArgs({
  options: {
    root: { type: 'string' },
    out: { type: 'string' },
    strict: { type: 'boolean', default: false },
    pretty: { type: 'boolean', default: false },
    delay: { type: 'string', default: '200' },
  },
});
const root = resolve(opts.root ?? ROOT);
const out = resolve(opts.out ?? join(root, 'site'));
const delay = Number(opts.delay) || 0;

const INDEX_FORMAT = 1;
const README_MAX = 8000;
const CHANGELOG_MAX = 3000;

function cap(text, max) {
  if (text === undefined) return { text: undefined, truncated: false };
  const chars = [...text.replace(/\r\n/g, '\n')];
  return chars.length <= max ? { text: chars.join(''), truncated: false } : { text: chars.slice(0, max).join(''), truncated: true };
}

function generatedAt() {
  if (process.env.SOURCE_DATE_EPOCH) return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString();
  try { return new Date(execFileSync('git', ['-C', root, 'log', '-1', '--format=%cI'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()).toISOString(); }
  catch { return new Date().toISOString(); }
}

const entries = listEntries(root);
const lock = loadLock(root);
const revoked = loadRevoked(root);
const problems = [];
const loaded = new Map(); // id -> { info, entry }

for (const info of entries) {
  if (info.shapeError) { problems.push(info.shapeError); continue; }
  let entry;
  try { entry = readJson(info.file); } catch (e) { problems.push(`${info.rel}: ${e.message}`); continue; }
  const errs = validateSchema(loadSchema('entry.schema.json'), entry);
  if (errs.length) { problems.push(`${info.rel}: ${errs.join('; ')}`); continue; }
  loaded.set(entryId(info.owner, info.name, info.version), { info, entry });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'icons'), { recursive: true });

const packages = [];
for (const [id, { info, entry }] of loaded) {
  let buf;
  try { buf = await download(entry.package, { expectSha: entry.sha256 }); await sleep(delay); }
  catch (e) { problems.push(`${id}: left out, download failed (${e.message})`); continue; }
  if (sha256(buf) !== entry.sha256) { problems.push(`${id}: left out, the file no longer matches its fingerprint`); continue; }
  const pkg = inspectPackage(buf);
  if (!pkg.ok) { problems.push(`${id}: left out, package check failed (${pkg.errors.join('; ')})`); continue; }
  const m = pkg.manifest;
  if (m.name !== info.name || m.version_number !== info.version) { problems.push(`${id}: left out, manifest does not match the entry folders`); continue; }

  const deps = [];
  let depProblem = null;
  for (const d of m.dependencies) {
    const ix = loaded.get(d);
    if (ix) deps.push({ id: d, from: 'index', package: ix.entry.package, sha256: ix.entry.sha256 });
    else if (lock[d]) deps.push({ id: d, from: 'thunderstore', package: lock[d].package, sha256: lock[d].sha256 });
    else { depProblem = d; break; }
  }
  if (depProblem) { problems.push(`${id}: left out, dependency ${depProblem} is neither in the Index nor in thunderstore-lock.json`); continue; }

  const iconName = `${id}.png`;
  writeFileSync(join(out, 'icons', iconName), pkg.icon);

  const pj = pkg.progenitor ?? {};
  const progenitorDep = m.dependencies.map(parseDependency).find((d) => d && d.name === 'Progenitor');
  const readme = cap(pkg.readme, README_MAX);
  const changelog = cap(pkg.changelog, CHANGELOG_MAX);

  const rec = {
    id,
    owner: info.owner,
    name: info.name,
    version: info.version,
    description: m.description,
    website_url: m.website_url,
    repo: entry.repo,
    ...(entry.commit ? { commit: entry.commit } : {}),
    source: entry.source,
    package: entry.package,
    sha256: entry.sha256,
    size: buf.length,
    imported: entry.imported,
    confirmed: entry.confirmed,
    dependencies: deps,
    icon: { url: `icons/${iconName}`, sha256: sha256(pkg.icon) },
    // "sides": null means the package gave none and Progenitor works it out as it does for Thunderstore mods.
    sides: pj.sides ?? null,
    progenitor: pj.progenitor ?? (progenitorDep ? `>=${progenitorDep.version}` : '*'),
    ...(pkg.progenitor ? { progenitor_json: pkg.progenitor } : {}),
    readme: readme.text,
    ...(readme.truncated ? { readme_truncated: true } : {}),
    ...(changelog.text !== undefined ? { changelog: changelog.text } : {}),
    ...(changelog.truncated ? { changelog_truncated: true } : {}),
  };
  packages.push(rec);
}

packages.sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name)
  || b.version.localeCompare(a.version, undefined, { numeric: true }));

const index = {
  format: INDEX_FORMAT,
  name: 'Progenitor Index',
  generated: generatedAt(),
  schema: 'https://github.com/VRising-Modders/ProgenitorIndex/blob/main/CONTRIBUTING.md',
  packages,
  revoked,
};
const json = opts.pretty ? JSON.stringify(index, null, 2) : JSON.stringify(index);
writeFileSync(join(out, 'index.json'), json + '\n');
writeFileSync(join(out, 'revoked.json'), JSON.stringify(revoked, null, 2) + '\n');

console.log(`site/index.json: ${packages.length} packages, ${Buffer.byteLength(json)} bytes`);
for (const p of problems) console.log(`warning: ${p}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Index build\n\n${packages.length} packages listed.\n\n${problems.map((p) => `- ${p}`).join('\n')}\n`);
}
if (opts.strict && problems.length) process.exit(1);
