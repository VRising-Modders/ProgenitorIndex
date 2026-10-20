// Shared helpers: entry files, downloads, the Thunderstore package list, the dependency lock and revocations.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CACHE } from './paths.mjs';
import { NAME_RE, OWNER_RE, VERSION_RE } from './package.mjs';

export const THUNDERSTORE_LIST_URL = 'https://thunderstore.io/c/v-rising/api/v1/package/';
export const USER_AGENT = 'ProgenitorIndex-tools/1.0 (+https://github.com/VRising-Modders/ProgenitorIndex)';
export const LOCK_FILE = 'thunderstore-lock.json';
export const REVOKED_FILE = 'revoked.json';
export const SEVERITIES = ['hidden', 'warning', 'disable'];
/** revoked.json "source": a Thunderstore listing, or a native Index entry. */
export const REVOKED_SOURCES = ['thunderstore', 'index'];

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function readJson(file) {
  let text = readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

export function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

// ---------- GitHub URLs ----------

/** Parses a GitHub repository URL (possibly with a deeper path) into { owner, repo, url }. */
export function parseGitHubRepo(url) {
  if (typeof url !== 'string') return null;
  const m = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/i.exec(url.trim());
  if (!m) return null;
  const reserved = ['sponsors', 'orgs', 'settings', 'marketplace', 'topics', 'features', 'about', 'apps'];
  if (reserved.includes(m[1].toLowerCase())) return null;
  return { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}` };
}

/** Parses https://github.com/<owner>/<repo>/releases/download/<tag>/<file>. */
export function parseReleaseAssetUrl(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)$/.exec(url);
  return m ? { owner: m[1], repo: m[2], tag: decodeURIComponent(m[3]), file: decodeURIComponent(m[4]) } : null;
}

export const thunderstoreDownloadUrl = (owner, name, version) => `https://thunderstore.io/package/download/${owner}/${name}/${version}/`;

// ---------- Entries ----------

/** Lists entry files under <root>/entries as { file, rel, owner, name, version }. */
export function listEntries(root) {
  const dir = join(root, 'entries');
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(describeEntryPath(root, p));
    }
  };
  walk(dir);
  return out;
}

/** Splits an entry path into its parts; `shapeError` is set when the path breaks the naming rule. */
export function describeEntryPath(root, file) {
  const rel = relative(root, file).split(sep).join('/');
  const parts = rel.split('/');
  const res = { file, rel };
  if (parts.length !== 4 || parts[0] !== 'entries' || !parts[3].endsWith('.json')) {
    res.shapeError = `${rel}: entry files must be at entries/<Owner>/<Name>/<version>.json`;
    return res;
  }
  res.owner = parts[1];
  res.name = parts[2];
  res.version = parts[3].slice(0, -5);
  if (!OWNER_RE.test(res.owner)) res.shapeError = `${rel}: owner folder "${res.owner}" may use only letters, digits, underscores and inner hyphens`;
  else if (!NAME_RE.test(res.name)) res.shapeError = `${rel}: name folder "${res.name}" may use only letters, digits and underscores`;
  else if (!VERSION_RE.test(res.version)) res.shapeError = `${rel}: file name must be the version, major.minor.patch`;
  return res;
}

export const entryId = (owner, name, version) => `${owner}-${name}-${version}`;

// ---------- Downloads ----------

/**
 * Downloads a URL into memory. With `cache`, files are kept under .cache/downloads by URL and
 * reused; a cached file is reused only if it still matches `expectSha` when one is given.
 */
export async function download(url, { cache = true, cacheOnly = false, expectSha = null, maxBytes = 600 * 1024 * 1024 } = {}) {
  const dir = join(CACHE, 'downloads');
  const key = join(dir, sha256(Buffer.from(url)).slice(0, 32) + '.bin');
  if (cache && existsSync(key)) {
    const buf = readFileSync(key);
    if (!expectSha || sha256(buf) === expectSha) return buf;
  }
  if (cacheOnly) throw Object.assign(new Error(`not in the download cache: ${url}`), { final: true });
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.status = res.status;
        if (res.status === 404 || res.status === 410 || res.status === 403) throw Object.assign(err, { final: true });
        throw err;
      }
      const len = Number(res.headers.get('content-length') || 0);
      if (len > maxBytes) throw Object.assign(new Error(`download too large (${len} bytes)`), { final: true });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw Object.assign(new Error(`download too large (${buf.length} bytes)`), { final: true });
      if (cache) { mkdirSync(dir, { recursive: true }); writeFileSync(key, buf); }
      return buf;
    } catch (e) {
      lastErr = e;
      if (e.final) break;
      await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

// ---------- Thunderstore ----------

let tsList = null;
/** The Thunderstore V Rising package list, cached in .cache for `maxAgeMs`. */
export async function thunderstorePackages({ maxAgeMs = 60 * 60 * 1000 } = {}) {
  if (tsList) return tsList;
  const file = join(CACHE, 'thunderstore-packages.json');
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < maxAgeMs) {
    tsList = readJson(file);
  } else {
    const res = await fetch(THUNDERSTORE_LIST_URL, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Thunderstore package list: HTTP ${res.status}`);
    const text = await res.text();
    tsList = JSON.parse(text);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, text);
  }
  return tsList;
}

/** Map from "Owner-Name-Version" to { pkg, version } for every Thunderstore version. */
export async function thunderstoreVersions(opts = {}) {
  const map = new Map();
  for (const pkg of await thunderstorePackages(opts)) {
    for (const v of pkg.versions) map.set(v.full_name, { pkg, version: v });
  }
  return map;
}

// ---------- Dependency lock and revocations ----------

export function loadLock(root) {
  const file = join(root, LOCK_FILE);
  return existsSync(file) ? readJson(file) : {};
}

export function saveLock(root, lock) {
  const sorted = Object.fromEntries(Object.keys(lock).sort((a, b) => a.localeCompare(b)).map((k) => [k, lock[k]]));
  writeJson(join(root, LOCK_FILE), sorted);
}

export function loadRevoked(root) {
  const file = join(root, REVOKED_FILE);
  return existsSync(file) ? readJson(file) : [];
}

/** Checks revoked.json; returns a list of problems. */
export function checkRevoked(list) {
  const errors = [];
  if (!Array.isArray(list)) return ['revoked.json must be a JSON array'];
  list.forEach((r, i) => {
    const at = `revoked.json[${i}]`;
    if (!r || typeof r !== 'object') { errors.push(`${at}: must be an object`); return; }
    for (const k of ['owner', 'name', 'version', 'reason', 'severity', 'date']) {
      if (typeof r[k] !== 'string' || !r[k]) errors.push(`${at}: "${k}" must be a non-empty string`);
    }
    if (r.version !== undefined && r.version !== '*' && !VERSION_RE.test(r.version)) errors.push(`${at}: "version" must be major.minor.patch or "*"`);
    if (r.severity !== undefined && !SEVERITIES.includes(r.severity)) errors.push(`${at}: "severity" must be one of ${SEVERITIES.join(', ')}`);
    if (r.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) errors.push(`${at}: "date" must be YYYY-MM-DD`);
    // Optional narrowing: which listing the takedown applies to, and which repository's entry.
    if (r.source !== undefined && !REVOKED_SOURCES.includes(r.source)) errors.push(`${at}: "source" must be one of ${REVOKED_SOURCES.join(', ')}`);
    if (r.repo !== undefined) {
      const repo = parseGitHubRepo(r.repo);
      if (!repo || repo.url !== r.repo) errors.push(`${at}: "repo" must be https://github.com/<owner>/<repo>, nothing after the repository name`);
    }
  });
  return errors;
}

export function isRevoked(list, owner, name, version) {
  return list.find((r) => r.owner === owner && r.name === name && (r.version === version || r.version === '*'));
}
