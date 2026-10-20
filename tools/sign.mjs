#!/usr/bin/env node
// Signs site/index.json and writes site/index.json.sig. The signature covers the exact bytes of
// index.json as served. Format (same as Progenitor's signed mod manifests): ECDSA P-256 with
// SHA-256, IEEE P1363 r||s, 128 lowercase hex characters.
//
// The private key (PKCS#8) comes from the INDEX_SIGNING_KEY environment variable (PEM or base64
// DER) or from a file given with --key (PEM, base64 DER or raw DER). After signing, the signature
// is verified with the derived public key, and the public key is printed as base64 SPKI DER, the
// form Progenitor embeds.
//
//   node tools/sign.mjs [--key keys/index-signing-key.pem] [--file site/index.json]

import { createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fingerprint, loadPrivateKey, signHex, spkiBase64, verifyHex } from './lib/keys.mjs';
import { ROOT } from './lib/paths.mjs';

const { values: opts } = parseArgs({ options: { key: { type: 'string' }, file: { type: 'string' } } });
const file = resolve(opts.file ?? join(ROOT, 'site', 'index.json'));

let keyInput;
if (opts.key) keyInput = readFileSync(resolve(opts.key));
else if (process.env.INDEX_SIGNING_KEY) keyInput = process.env.INDEX_SIGNING_KEY;
else { console.error('No signing key: set INDEX_SIGNING_KEY or pass --key <file>.'); process.exit(2); }

let privateKey;
try { privateKey = loadPrivateKey(keyInput); } catch (e) { console.error(`Could not read the signing key: ${e.message}`); process.exit(2); }

const data = readFileSync(file);
const signature = signHex(data, privateKey);
const publicKey = createPublicKey(privateKey);
if (!verifyHex(data, publicKey, signature)) { console.error('Self-check failed: the new signature does not verify.'); process.exit(1); }
writeFileSync(`${file}.sig`, signature + '\n');
console.log(`Signed ${data.length} bytes -> ${file}.sig`);
console.log(`Public key (base64 SPKI DER): ${spkiBase64(publicKey)}`);
console.log(`Fingerprint: ${fingerprint(publicKey)}`);
