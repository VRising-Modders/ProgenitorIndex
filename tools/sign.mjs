#!/usr/bin/env node
// Signs site/index.json with Ed25519 and writes site/index.json.sig (the 64-byte signature, base64).
// The signature covers the exact bytes of index.json as served.
//
// The private key comes from the INDEX_SIGNING_KEY environment variable (PEM, or base64 PKCS#8 DER)
// or from a file given with --key. After signing, the signature is verified with the derived
// public key, and the public key is printed in the raw base64 form Progenitor embeds.
//
//   node tools/sign.mjs [--key keys/index-signing-key.pem] [--file site/index.json]

import { createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadPrivateKey, rawPublicKey } from './lib/keys.mjs';
import { ROOT } from './lib/paths.mjs';

const { values: opts } = parseArgs({ options: { key: { type: 'string' }, file: { type: 'string' } } });
const file = resolve(opts.file ?? join(ROOT, 'site', 'index.json'));

let keyText;
if (opts.key) keyText = readFileSync(resolve(opts.key), 'utf8');
else if (process.env.INDEX_SIGNING_KEY) keyText = process.env.INDEX_SIGNING_KEY;
else { console.error('No signing key: set INDEX_SIGNING_KEY or pass --key <file>.'); process.exit(2); }

let privateKey;
try { privateKey = loadPrivateKey(keyText); } catch (e) { console.error(`Could not read the signing key: ${e.message}`); process.exit(2); }

const data = readFileSync(file);
const signature = sign(null, data, privateKey);
const publicKey = createPublicKey(privateKey);
if (!verify(null, data, publicKey, signature)) { console.error('Self-check failed: the new signature does not verify.'); process.exit(1); }
writeFileSync(`${file}.sig`, signature.toString('base64') + '\n');
console.log(`Signed ${data.length} bytes -> ${file}.sig`);
console.log(`Public key (raw Ed25519, base64): ${rawPublicKey(publicKey)}`);
