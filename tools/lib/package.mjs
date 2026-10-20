// Reads a Thunderstore-layout mod package and checks it against the Index package rules.

import { readZip } from './zip.mjs';
import { loadSchema, validateSchema } from './schema.mjs';

export const NAME_RE = /^[A-Za-z0-9_]+$/;
export const VERSION_RE = /^\d+\.\d+\.\d+$/;
// Thunderstore owners may contain hyphens; names may not, so the name is the last segment before the version.
export const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9_])?$/;
export const DEP_RE = /^([A-Za-z0-9][A-Za-z0-9_-]*)-([A-Za-z0-9_]+)-(\d+\.\d+\.\d+)$/;
export const DESCRIPTION_MAX = 250;
export const ICON_SIZE = 256;
// Executables, scripts and installers a mod package must not carry.
export const FORBIDDEN_EXT = ['.exe', '.bat', '.cmd', '.ps1', '.msi', '.vbs', '.scr'];

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function decodeText(buf) {
  let bom = false;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { buf = buf.subarray(3); bom = true; }
  return { text: buf.toString('utf8'), bom };
}

export function parseDependency(dep) {
  const m = typeof dep === 'string' ? DEP_RE.exec(dep) : null;
  return m ? { owner: m[1], name: m[2], version: m[3], id: dep } : null;
}

/**
 * Inspects a package zip. Returns { ok, errors, warnings, manifest, files, icon, readme, changelog, progenitor }.
 * Errors are hard failures of the package rules; warnings are for the reviewer.
 */
export function inspectPackage(buf) {
  const errors = [];
  const warnings = [];
  const out = { ok: false, errors, warnings, files: [] };

  let zip;
  try { zip = readZip(buf); } catch (e) { errors.push(`package is not a readable zip: ${e.message}`); return out; }

  const files = zip.entries.filter((e) => !e.isDirectory);
  out.files = files.map((e) => ({ path: e.path, size: e.size }));

  for (const e of files) {
    if (e.path.startsWith('/') || e.path.split('/').includes('..') || /^[A-Za-z]:/.test(e.path)) {
      errors.push(`unsafe path in package: ${e.path}`);
    }
  }

  const root = new Map();
  for (const e of files) if (!e.path.includes('/')) root.set(e.path.toLowerCase(), e);
  const get = (name, required) => {
    const e = root.get(name.toLowerCase());
    if (!e) { if (required) errors.push(`${name} missing at the package root`); return null; }
    if (e.path !== name) warnings.push(`${e.path} should be named ${name}`);
    try { return zip.read(e); } catch (err) { errors.push(`${name}: ${err.message}`); return null; }
  };

  // manifest.json
  const manifestBuf = get('manifest.json', true);
  if (manifestBuf) {
    const { text, bom } = decodeText(manifestBuf);
    if (bom) warnings.push('manifest.json starts with a byte order mark');
    let m;
    try { m = JSON.parse(text); } catch (e) { errors.push(`manifest.json is not valid JSON: ${e.message}`); }
    if (m !== undefined) {
      if (m === null || typeof m !== 'object' || Array.isArray(m)) errors.push('manifest.json must be an object');
      else {
        out.manifest = m;
        if (typeof m.name !== 'string' || !NAME_RE.test(m.name)) errors.push('manifest.json "name" must use only letters, digits and underscores');
        if (typeof m.version_number !== 'string' || !VERSION_RE.test(m.version_number)) errors.push('manifest.json "version_number" must be major.minor.patch');
        if (typeof m.website_url !== 'string') errors.push('manifest.json "website_url" must be a string');
        if (typeof m.description !== 'string') errors.push('manifest.json "description" must be a string');
        else if ([...m.description].length > DESCRIPTION_MAX) errors.push(`manifest.json "description" is ${[...m.description].length} characters; the limit is ${DESCRIPTION_MAX}`);
        if (!Array.isArray(m.dependencies)) errors.push('manifest.json "dependencies" must be an array');
        else for (const d of m.dependencies) {
          if (!parseDependency(d)) errors.push(`manifest.json dependency ${JSON.stringify(d)} is not Owner-Name-Version`);
        }
      }
    }
  }

  // icon.png
  const icon = get('icon.png', true);
  if (icon) {
    const size = pngSize(icon);
    if (!size) errors.push('icon.png is not a PNG image');
    else if (size.width !== ICON_SIZE || size.height !== ICON_SIZE) errors.push(`icon.png is ${size.width}x${size.height}; it must be ${ICON_SIZE}x${ICON_SIZE}`);
    else out.icon = icon;
  }

  // README.md, CHANGELOG.md
  const readme = get('README.md', true);
  if (readme) out.readme = decodeText(readme).text;
  const changelog = get('CHANGELOG.md', false);
  if (changelog) out.changelog = decodeText(changelog).text;

  // progenitor.json
  const pj = get('progenitor.json', false);
  if (pj) {
    let v;
    try { v = JSON.parse(decodeText(pj).text); } catch (e) { errors.push(`progenitor.json is not valid JSON: ${e.message}`); }
    if (v !== undefined) {
      const errs = validateSchema(loadSchema('progenitor.schema.json'), v);
      if (errs.length) errors.push(...errs.map((x) => `progenitor.json ${x}`));
      else out.progenitor = v;
    }
  }

  // Contents rule
  for (const f of files) {
    const lower = f.path.toLowerCase();
    if (FORBIDDEN_EXT.some((ext) => lower.endsWith(ext))) errors.push(`forbidden file type in package: ${f.path}`);
  }
  out.hasPluginFiles = files.some((f) => f.path.toLowerCase().endsWith('.dll'));

  out.ok = errors.length === 0;
  return out;
}
