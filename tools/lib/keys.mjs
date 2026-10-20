import { createPrivateKey, createPublicKey } from 'node:crypto';

/** Loads an Ed25519 private key from PEM text or base64 PKCS#8 DER. */
export function loadPrivateKey(text) {
  const t = text.trim();
  const key = t.startsWith('-----')
    ? createPrivateKey({ key: t, format: 'pem' })
    : createPrivateKey({ key: Buffer.from(t, 'base64'), format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`expected an Ed25519 key, got ${key.asymmetricKeyType}`);
  return key;
}

/** Loads an Ed25519 public key from PEM, base64 SPKI DER, or the raw 32-byte key in base64. */
export function loadPublicKey(text) {
  const t = text.trim();
  if (t.startsWith('-----')) return createPublicKey({ key: t, format: 'pem' });
  const raw = Buffer.from(t, 'base64');
  if (raw.length === 32) return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
  return createPublicKey({ key: raw, format: 'der', type: 'spki' });
}

/** The raw 32-byte public key, base64. This is the form to build into Progenitor. */
export function rawPublicKey(publicKey) {
  return Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
}
