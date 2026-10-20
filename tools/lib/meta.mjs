// Derived metadata: what the index needs from a package, read once at validate time and committed
// next to the entry as meta/<Owner>/<Name>/<version>/meta.json and icon.png. Publishing builds the
// index from entries plus meta only, with no package downloads.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './common.mjs';
import { parseDependency } from './package.mjs';

export const META_FORMAT = 1;
export const README_MAX = 8000;
export const CHANGELOG_MAX = 3000;

export const metaDir = (root, owner, name, version) => join(root, 'meta', owner, name, version);

function cap(text, max) {
  if (text === undefined) return { text: undefined, truncated: false };
  const chars = [...text.replace(/\r\n/g, '\n')];
  return chars.length <= max ? { text: chars.join(''), truncated: false } : { text: chars.slice(0, max).join(''), truncated: true };
}

/**
 * Builds the meta record for a checked package. `deps` is the resolved dependency list:
 * [{ id, from: 'index' | 'thunderstore', package, sha256 }].
 * Returns { json (string, as committed), icon (Buffer) }.
 */
export function deriveMeta(entry, pkg, size, deps) {
  const m = pkg.manifest;
  const pj = pkg.progenitor ?? {};
  const progenitorDep = m.dependencies.map(parseDependency).find((d) => d && d.name === 'Progenitor');
  const readme = cap(pkg.readme, README_MAX);
  const changelog = cap(pkg.changelog, CHANGELOG_MAX);
  const meta = {
    format: META_FORMAT,
    package_sha256: entry.sha256,
    size,
    manifest: {
      name: m.name,
      version_number: m.version_number,
      website_url: m.website_url,
      description: m.description,
      dependencies: m.dependencies,
    },
    description: m.description,
    dependencies: deps,
    icon: { file: 'icon.png', sha256: sha256(pkg.icon) },
    // "sides": null means the package gave none and Progenitor works it out as it does for Thunderstore mods.
    sides: pj.sides ?? null,
    progenitor: pj.progenitor ?? (progenitorDep ? `>=${progenitorDep.version}` : '*'),
    ...(pkg.progenitor ? { progenitor_json: pkg.progenitor } : {}),
    readme: readme.text ?? '',
    ...(readme.truncated ? { readme_truncated: true } : {}),
    ...(changelog.text !== undefined ? { changelog: changelog.text } : {}),
    ...(changelog.truncated ? { changelog_truncated: true } : {}),
  };
  return { json: JSON.stringify(meta, null, 2) + '\n', icon: pkg.icon };
}

/** Reads committed meta; returns { json, meta, icon } with null fields for missing files. */
export function readMeta(root, owner, name, version) {
  const dir = metaDir(root, owner, name, version);
  const jf = join(dir, 'meta.json');
  const icf = join(dir, 'icon.png');
  const json = existsSync(jf) ? readFileSync(jf, 'utf8') : null;
  let meta = null;
  if (json !== null) { try { meta = JSON.parse(json); } catch { meta = null; } }
  return { json, meta, icon: existsSync(icf) ? readFileSync(icf) : null };
}

export function writeMeta(root, owner, name, version, derived) {
  const dir = metaDir(root, owner, name, version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), derived.json);
  writeFileSync(join(dir, 'icon.png'), derived.icon);
}

/** Problems with committed meta that can be found without downloading the package. */
export function checkMetaOffline(m, entry, resolveDep) {
  const errors = [];
  if (m.json === null) return ['meta.json is missing (run: node tools/validate.mjs --write-meta <entry>)'];
  if (!m.meta) return ['meta.json is not valid JSON'];
  if (m.meta.format !== META_FORMAT) errors.push(`meta.json format ${m.meta.format} is not ${META_FORMAT}`);
  if (m.meta.package_sha256 !== entry.sha256) errors.push('meta.json was made from a different package file (package_sha256 does not match the entry)');
  if (!m.icon) errors.push('icon.png is missing from meta');
  else if (sha256(m.icon) !== m.meta.icon?.sha256) errors.push('meta icon.png does not match its fingerprint in meta.json');
  for (const d of m.meta.dependencies ?? []) {
    const cur = resolveDep(d.id);
    if (!cur) errors.push(`meta dependency ${d.id} is neither in the Index nor in thunderstore-lock.json`);
    else if (cur.sha256 !== d.sha256 || cur.package !== d.package || cur.from !== d.from) errors.push(`meta dependency ${d.id} no longer matches the Index or the lock`);
  }
  return errors;
}
