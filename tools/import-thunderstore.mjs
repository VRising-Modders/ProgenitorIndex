#!/usr/bin/env node
// Prepopulates the Index from Thunderstore's V Rising listing.
//
// For each package that is not deprecated and whose latest version links a GitHub repository,
// it downloads the latest version, checks the package rules, looks for a GitHub Release asset
// with the same SHA-256, and writes entries/<Owner>/<Name>/<version>.json marked imported and
// unconfirmed. Existing entry files are never overwritten. Writes import-report.md.
//
//   node tools/import-thunderstore.mjs [--limit N] [--delay ms] [--releases N] [--dry-run]
//                                      [--exclude-owner <Thunderstore or GitHub owner>]...
//
// --exclude-owner leaves out every package of that owner; the report counts them without naming them.
//
// Needs the GitHub CLI (`gh`), signed in, for the release lookups. Afterwards, generate the meta
// for the new entries from the same downloads: node tools/validate.mjs --write-meta --cache-only

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  download, entryId, loadLock, parseGitHubRepo, saveLock, sha256, sleep, thunderstoreDownloadUrl,
  thunderstorePackages, thunderstoreVersions, writeJson,
} from './lib/common.mjs';
import { inspectPackage, parseDependency } from './lib/package.mjs';
import { ROOT } from './lib/paths.mjs';

const { values: opts } = parseArgs({
  options: {
    limit: { type: 'string' },
    delay: { type: 'string', default: '1000' },
    releases: { type: 'string', default: '5' },
    'dry-run': { type: 'boolean', default: false },
    'exclude-owner': { type: 'string', multiple: true, default: [] },
  },
});
const delay = Number(opts.delay);
const excludedOwners = new Set(opts['exclude-owner'].map((x) => x.toLowerCase()));
const releaseCount = Math.max(1, Math.min(20, Number(opts.releases) || 5));

// Packages that are obviously not mods: the loader itself and standalone applications.
// Libraries stay, because mods depend on them.
const EXCLUDE = [
  { test: (p) => /^BepInExPack/i.test(p.name), reason: 'BepInEx pack (the mod loader, installed from Thunderstore)' },
  { test: (p) => p.full_name === 'ebkr-r2modman', reason: 'mod manager application, not a mod' },
  { test: (p) => p.full_name === 'Samusnews-VRisingDedicatedServerLauncher', reason: 'server launcher application, not a mod' },
  { test: (p) => p.full_name === 'ScarletMods-ScarletRconClient', reason: 'standalone RCON client application, not a mod' },
];
const META_FILES = new Set(['manifest.json', 'icon.png', 'readme.md', 'changelog.md', 'license', 'license.md', 'license.txt', 'progenitor.json']);

function gh(path) {
  try {
    const out = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, data: JSON.parse(out) };
  } catch (e) {
    const text = `${e.stderr ?? ''}${e.stdout ?? ''}`;
    const status = /HTTP (\d{3})/.exec(text)?.[1];
    return { ok: false, status: status ? Number(status) : null, message: text.trim().split('\n')[0] || e.message };
  }
}

const stats = {
  total: 0, deprecated: 0, active: 0, withGitHub: 0, excluded: [], excludedByOwner: 0, downloaded: 0,
  skipped: [], imported: [], existing: [],
};
const skip = (p, reason) => { stats.skipped.push({ id: p.full_name, version: p.versions[0].version_number, reason }); console.log(`skip ${p.full_name}: ${reason}`); };

const packages = await thunderstorePackages({ maxAgeMs: 6 * 60 * 60 * 1000 });
stats.total = packages.length;
let candidates = [];
for (const p of packages) {
  if (p.is_deprecated) { stats.deprecated++; continue; }
  stats.active++;
  const latest = p.versions[0];
  const repo = parseGitHubRepo(latest.website_url);
  if (!repo) continue;
  stats.withGitHub++;
  if (excludedOwners.has(p.owner.toLowerCase()) || excludedOwners.has(repo.owner.toLowerCase())) { stats.excludedByOwner++; continue; }
  const ex = EXCLUDE.find((x) => x.test(p));
  if (ex) { stats.excluded.push({ id: p.full_name, reason: ex.reason }); continue; }
  candidates.push({ p, latest, repo });
}
candidates.sort((a, b) => a.p.full_name.localeCompare(b.p.full_name));
if (opts.limit) candidates = candidates.slice(0, Number(opts.limit));
console.log(`${stats.total} packages, ${stats.active} active, ${stats.withGitHub} link GitHub, ${candidates.length} to check`);

const tsVersions = await thunderstoreVersions();
const planned = []; // { owner, name, version, entry, manifest }
for (const { p, latest, repo } of candidates) {
  const owner = p.owner;
  const name = p.name;
  const version = latest.version_number;
  const file = join(ROOT, 'entries', owner, name, `${version}.json`);

  // 1. Download the Thunderstore package (serially, with a pause when it was not cached).
  let buf;
  try {
    const t0 = Date.now();
    buf = await download(latest.download_url);
    if (Date.now() - t0 > 50) await sleep(delay);
  } catch (e) { skip(p, `download failed: ${e.message}`); continue; }
  stats.downloaded++;
  const sum = sha256(buf);

  // 2. Package rules.
  const pkg = inspectPackage(buf);
  if (!pkg.ok) {
    const contentsOnly = pkg.errors.every((e) => e.startsWith('forbidden file type'));
    skip(p, `${contentsOnly ? 'contents' : 'package format'}: ${pkg.errors.join('; ')}`);
    continue;
  }
  if (pkg.manifest.name !== name) { skip(p, `package format: manifest name "${pkg.manifest.name}" does not match "${name}"`); continue; }
  if (pkg.manifest.version_number !== version) { skip(p, `package format: manifest version "${pkg.manifest.version_number}" does not match "${version}"`); continue; }
  const content = pkg.files.filter((f) => !META_FILES.has(f.path.toLowerCase()));
  if (!pkg.hasPluginFiles && content.length === 0) { skip(p, 'modpack: dependencies only, no mod files'); continue; }

  const missingDep = pkg.manifest.dependencies.find((d) => !tsVersions.has(d));
  if (missingDep) { skip(p, `dependency: ${missingDep} is not a V Rising package on Thunderstore`); continue; }

  // 3. The repository and its latest releases.
  const r = gh(`repos/${repo.owner}/${repo.repo}`);
  if (!r.ok) { skip(p, r.status === 404 ? `GitHub repository ${repo.owner}/${repo.repo} not found or private` : `GitHub lookup failed: ${r.message}`); continue; }
  const repoUrl = r.data.html_url;
  if (!parseGitHubRepo(repoUrl)) { skip(p, `unexpected repository URL ${repoUrl}`); continue; }

  let match = null;
  const rel = gh(`repos/${r.data.full_name}/releases?per_page=${releaseCount}`);
  if (rel.ok) {
    for (const release of rel.data) {
      for (const asset of release.assets ?? []) {
        if (!asset.name.toLowerCase().endsWith('.zip')) continue;
        let same = false;
        if (asset.digest) same = asset.digest.toLowerCase() === `sha256:${sum}`;
        else if (asset.size === buf.length) {
          try { same = sha256(await download(asset.browser_download_url)) === sum; await sleep(delay); } catch { /* not a match */ }
        }
        if (same) { match = { release, asset }; break; }
      }
      if (match) break;
    }
  }

  const entry = { source: 'thunderstore', repo: repoUrl };
  if (match) {
    entry.source = 'github-release';
    const c = gh(`repos/${r.data.full_name}/commits/${encodeURIComponent(match.release.tag_name)}`);
    if (c.ok && /^[0-9a-f]{40}$/.test(c.data.sha)) entry.commit = c.data.sha;
    entry.package = match.asset.browser_download_url;
  } else {
    entry.package = thunderstoreDownloadUrl(owner, name, version);
  }
  entry.sha256 = sum;
  entry.imported = true;
  entry.confirmed = false;

  const record = { owner, name, version, entry, manifest: pkg.manifest, file };
  if (existsSync(file)) { stats.existing.push(record); console.log(`keep ${entryId(owner, name, version)} (entry exists)`); }
  else { stats.imported.push(record); console.log(`add  ${entryId(owner, name, version)} (${entry.source})`); }
  planned.push(record);
}

// 4. Write entries.
if (!opts['dry-run']) {
  for (const rec of stats.imported) {
    mkdirSync(dirname(rec.file), { recursive: true });
    writeJson(rec.file, rec.entry);
  }
}

// 5. Lock the fingerprints of Thunderstore dependencies that are not in the Index.
const indexIds = new Set(planned.map((x) => entryId(x.owner, x.name, x.version)));
const lock = loadLock(ROOT);
const depIds = new Set();
for (const rec of planned) for (const d of rec.manifest.dependencies) if (!indexIds.has(d)) depIds.add(d);
let lockAdded = 0;
const lockFailed = [];
for (const id of [...depIds].sort()) {
  if (lock[id]) continue;
  const d = parseDependency(id);
  const url = thunderstoreDownloadUrl(d.owner, d.name, d.version);
  try {
    const t0 = Date.now();
    const buf = await download(url);
    if (Date.now() - t0 > 50) await sleep(delay);
    lock[id] = { package: url, sha256: sha256(buf) };
    lockAdded++;
  } catch (e) { lockFailed.push({ id, reason: e.message }); console.log(`lock ${id}: ${e.message}`); }
}
if (!opts['dry-run']) saveLock(ROOT, lock);

// 6. Report.
const matched = planned.filter((x) => x.entry.source === 'github-release');
const tsSourced = planned.filter((x) => x.entry.source === 'thunderstore');
const byReason = new Map();
for (const s of stats.skipped) {
  const key = s.reason.replace(/:.*$/, '').replace(/^GitHub repository .*/, 'GitHub repository not found or private');
  if (!byReason.has(key)) byReason.set(key, []);
  byReason.get(key).push(s);
}

const md = [];
md.push('# Thunderstore import report', '');
md.push(`Generated by \`tools/import-thunderstore.mjs\` on ${new Date().toISOString().slice(0, 10)} from the Thunderstore V Rising package list.`);
md.push('Every imported entry is marked `"imported": true, "confirmed": false` until its author confirms the listing.', '');
md.push('## Counts', '');
md.push('| | Packages |', '|---|---:|');
md.push(`| V Rising packages on Thunderstore | ${stats.total} |`);
md.push(`| Deprecated (not imported) | ${stats.deprecated} |`);
md.push(`| Active | ${stats.active} |`);
md.push(`| Active, latest version links a GitHub repository | ${stats.withGitHub} |`);
md.push(`| Excluded as not mods | ${stats.excluded.length} |`);
if (stats.excludedByOwner) md.push(`| Left out with --exclude-owner (not named) | ${stats.excludedByOwner} |`);
md.push(`| Checked | ${candidates.length} |`);
md.push(`| Skipped | ${stats.skipped.length} |`);
md.push(`| **Listed** (latest version only) | **${planned.length}** |`);
md.push(`| Package matched a GitHub release asset (source \`github-release\`) | ${matched.length} |`);
md.push(`| No matching release asset (source \`thunderstore\`) | ${tsSourced.length} |`);
md.push(`| Thunderstore dependencies locked in \`thunderstore-lock.json\` | ${Object.keys(lock).length} |`);
md.push('');
md.push('## Excluded as not mods', '');
for (const x of stats.excluded) md.push(`- \`${x.id}\`: ${x.reason}`);
md.push('');
md.push('## Skipped', '');
if (!stats.skipped.length) md.push('None.');
for (const [reason, list] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
  md.push(`### ${reason[0].toUpperCase()}${reason.slice(1)} (${list.length})`, '');
  for (const s of list) md.push(`- \`${s.id}-${s.version}\`: ${s.reason}`);
  md.push('');
}
if (lockFailed.length) {
  md.push('## Dependencies that could not be locked', '');
  for (const x of lockFailed) md.push(`- \`${x.id}\`: ${x.reason}`);
  md.push('');
}
md.push('## Listed entries', '');
md.push('| Package | Version | Source |', '|---|---|---|');
for (const x of [...planned].sort((a, b) => entryId(a.owner, a.name, '').localeCompare(entryId(b.owner, b.name, '')))) {
  md.push(`| \`${x.owner}-${x.name}\` | ${x.version} | ${x.entry.source} |`);
}
md.push('');
if (!opts['dry-run']) writeFileSync(join(ROOT, 'import-report.md'), md.join('\n'));
console.log(`\nlisted ${planned.length} (${stats.imported.length} new): ${matched.length} github-release, ${tsSourced.length} thunderstore; skipped ${stats.skipped.length}; excluded ${stats.excluded.length}; lock +${lockAdded}`);
