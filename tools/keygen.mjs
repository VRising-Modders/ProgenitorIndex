#!/usr/bin/env node
// Generates an ECDSA P-256 signing keypair into keys/ (gitignored). Never commit the private key.
//
//   node tools/keygen.mjs [--out keys] [--force]
//
// Writes:
//   index-signing-key.pem       private key, PKCS#8 PEM: the value of the INDEX_SIGNING_KEY secret
//   index-signing-key.pub.txt   public key, base64 SPKI DER: the form built into Progenitor
//   index-signing-key.pub.pem   public key, SPKI PEM

import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fingerprint, spkiBase64 } from './lib/keys.mjs';
import { ROOT } from './lib/paths.mjs';

const { values: opts } = parseArgs({ options: { out: { type: 'string' }, force: { type: 'boolean', default: false } } });
const dir = resolve(opts.out ?? join(ROOT, 'keys'));
const priv = join(dir, 'index-signing-key.pem');
if (existsSync(priv) && !opts.force) { console.error(`${priv} already exists; pass --force to replace it.`); process.exit(1); }

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
mkdirSync(dir, { recursive: true });
writeFileSync(priv, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
writeFileSync(join(dir, 'index-signing-key.pub.txt'), spkiBase64(publicKey) + '\n');
writeFileSync(join(dir, 'index-signing-key.pub.pem'), publicKey.export({ format: 'pem', type: 'spki' }));
console.log(`Wrote the keypair to ${dir}`);
console.log(`Public key (base64 SPKI DER): ${spkiBase64(publicKey)}`);
console.log(`Fingerprint: ${fingerprint(publicKey)}`);
console.log('Store the private key PEM as the INDEX_SIGNING_KEY repository secret, then delete or lock away the local copy.');
