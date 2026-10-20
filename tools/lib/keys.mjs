// Index signing keys and signatures. The format matches Progenitor's signed mod manifests so
// Progenitor verifies the index with its existing code:
//   algorithm   ECDSA P-256 with SHA-256
//   signature   IEEE P1363 raw r||s (64 bytes), lowercase hex (128 characters)
//   public key  SubjectPublicKeyInfo (SPKI) DER, base64
//   fingerprint first 16 hex characters of SHA-256(SPKI DER)
//   private key PKCS#8 (PEM, base64 DER, or raw DER bytes)

import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

export const ALGORITHM = 'ECDSA P-256 + SHA-256';

function checkCurve(key) {
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error(`expected an ECDSA P-256 key, got ${key.asymmetricKeyType} ${key.asymmetricKeyDetails?.namedCurve ?? ''}`.trim());
  }
  return key;
}

/** Loads a P-256 private key from PEM text, base64 PKCS#8 DER, or a raw PKCS#8 DER buffer. */
export function loadPrivateKey(input) {
  if (Buffer.isBuffer(input)) {
    const text = input.toString('latin1').trim();
    if (!text.startsWith('-----') && !/^[A-Za-z0-9+/=\s]+$/.test(text)) {
      return checkCurve(createPrivateKey({ key: input, format: 'der', type: 'pkcs8' }));
    }
    input = text;
  }
  const t = input.trim();
  const key = t.startsWith('-----')
    ? createPrivateKey({ key: t, format: 'pem' })
    : createPrivateKey({ key: Buffer.from(t, 'base64'), format: 'der', type: 'pkcs8' });
  return checkCurve(key);
}

/** Loads a P-256 public key from base64 SPKI DER (Progenitor's form) or PEM. */
export function loadPublicKey(text) {
  const t = text.trim();
  const key = t.startsWith('-----')
    ? createPublicKey({ key: t, format: 'pem' })
    : createPublicKey({ key: Buffer.from(t, 'base64'), format: 'der', type: 'spki' });
  return checkCurve(key);
}

export const spkiDer = (publicKey) => publicKey.export({ format: 'der', type: 'spki' });
export const spkiBase64 = (publicKey) => spkiDer(publicKey).toString('base64');
export const fingerprint = (publicKey) => createHash('sha256').update(spkiDer(publicKey)).digest('hex').slice(0, 16);

/** Signs bytes; returns the 64-byte r||s signature as lowercase hex. */
export function signHex(data, privateKey) {
  return sign('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('hex');
}

/** Verifies a lowercase or uppercase hex r||s signature, as Progenitor does. */
export function verifyHex(data, publicKey, signatureHex) {
  const hex = String(signatureHex ?? '').trim();
  if (!/^[0-9a-fA-F]{128}$/.test(hex)) return false;
  return verify('sha256', data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(hex, 'hex'));
}
