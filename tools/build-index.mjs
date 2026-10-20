#!/usr/bin/env node
// Builds site/index.json, site/revoked.json and site/icons/ from the entry files and their
// committed meta (meta/<Owner>/<Name>/<version>/). It makes no network requests: package details
// were read from each package when the entry was validated.
//
//   node tools/build-index.mjs [--root <dir>] [--out <dir>] [--strict] [--pretty]

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { entryId, listEntries, loadLock, loadRevoked, readJson } from './lib/common.mjs';
import { checkMetaOffline, readMeta } from './lib/meta.mjs';
import { ROOT } from './lib/paths.mjs';
import { loadSchema, validateSchema } from './lib/schema.mjs';

const { values: opts } = parseArgs({
  options: {
    root: { type: 'string' },
    out: { type: 'string' },
    strict: { type: 'boolean', default: false },
    pretty: { type: 'boolean', default: false },
  },
});
const root = resolve(opts.root ?? ROOT);
const out = resolve(opts.out ?? join(root, 'site'));

const INDEX_FORMAT = 1;

function generatedAt() {
  if (process.env.SOURCE_DATE_EPOCH) return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString();
  try { return new Date(execFileSync('git', ['-C', root, 'log', '-1', '--format=%cI'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()).toISOString(); }
  catch { return new Date().toISOString(); }
}

const lock = loadLock(root);
const revoked = loadRevoked(root);
const problems = [];
const loaded = new Map(); // id -> { info, entry }

for (const info of listEntries(root)) {
  if (info.shapeError) { problems.push(info.shapeError); continue; }
  let entry;
  try { entry = readJson(info.file); } catch (e) { problems.push(`${info.rel}: ${e.message}`); continue; }
  const errs = validateSchema(loadSchema('entry.schema.json'), entry);
  if (errs.length) { problems.push(`${info.rel}: ${errs.join('; ')}`); continue; }
  loaded.set(entryId(info.owner, info.name, info.version), { info, entry });
}

function resolveDep(id) {
  const ix = loaded.get(id);
  if (ix) return { id, from: 'index', package: ix.entry.package, sha256: ix.entry.sha256 };
  return lock[id] ? { id, from: 'thunderstore', package: lock[id].package, sha256: lock[id].sha256 } : null;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'icons'), { recursive: true });

const packages = [];
for (const [id, { info, entry }] of loaded) {
  const m = readMeta(root, info.owner, info.name, info.version);
  const errs = checkMetaOffline(m, entry, resolveDep);
  if (errs.length) { problems.push(`${id}: left out, ${errs.join('; ')}`); continue; }
  const meta = m.meta;

  const iconName = `${id}.png`;
  writeFileSync(join(out, 'icons', iconName), m.icon);

  packages.push({
    id,
    owner: info.owner,
    name: info.name,
    version: info.version,
    description: meta.description,
    website_url: meta.manifest.website_url,
    repo: entry.repo,
    ...(entry.commit ? { commit: entry.commit } : {}),
    source: entry.source,
    package: entry.package,
    sha256: entry.sha256,
    size: meta.size,
    imported: entry.imported,
    confirmed: entry.confirmed,
    dependencies: meta.dependencies,
    icon: { url: `icons/${iconName}`, sha256: meta.icon.sha256 },
    sides: meta.sides,
    progenitor: meta.progenitor,
    ...(meta.progenitor_json ? { progenitor_json: meta.progenitor_json } : {}),
    readme: meta.readme,
    ...(meta.readme_truncated ? { readme_truncated: true } : {}),
    ...(meta.changelog !== undefined ? { changelog: meta.changelog } : {}),
    ...(meta.changelog_truncated ? { changelog_truncated: true } : {}),
  });
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

console.log(`site/index.json: ${packages.length} packages, ${Buffer.byteLength(json) + 1} bytes`);
for (const p of problems) console.log(`warning: ${p}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Index build\n\n${packages.length} packages listed.\n\n${problems.map((p) => `- ${p}`).join('\n')}\n`);
}
if (opts.strict && problems.length) process.exit(1);
