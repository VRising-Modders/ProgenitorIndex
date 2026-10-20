#!/usr/bin/env node
// Verifies site/index.json against site/index.json.sig with a public key, as Progenitor does.
//
//   node tools/verify.mjs --pub <file or base64> [--file site/index.json]
// The public key may be PEM, base64 SPKI DER, or the raw 32-byte key in base64.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verify } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadPublicKey } from './lib/keys.mjs';
import { ROOT } from './lib/paths.mjs';

const { values: opts } = parseArgs({ options: { pub: { type: 'string' }, file: { type: 'string' } } });
if (!opts.pub) { console.error('Pass --pub <public key file or base64>.'); process.exit(2); }
const file = resolve(opts.file ?? join(ROOT, 'site', 'index.json'));
const pubText = existsSync(opts.pub) ? readFileSync(opts.pub, 'utf8') : opts.pub;
const publicKey = loadPublicKey(pubText);
const data = readFileSync(file);
const signature = Buffer.from(readFileSync(`${file}.sig`, 'utf8').trim(), 'base64');
const ok = signature.length === 64 && verify(null, data, publicKey, signature);
console.log(ok ? 'Signature OK' : 'Signature does NOT match');
process.exit(ok ? 0 : 1);
