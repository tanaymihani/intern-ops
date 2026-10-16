/**
 * feed-crypto.mjs — AES-256-GCM envelope for feeds scraped from behind a
 * login (Handshake, JobRight). The scraper repo is public (that's what makes
 * GitHub Actions free), and those postings are only visible to signed-in
 * users, so they're committed encrypted. The dashboard decrypts with the
 * same FEED_KEY (a GitHub Actions secret + a Vercel env var).
 *
 *   FEED_KEY = 32 random bytes, base64:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function keyFrom(b64) {
  const key = Buffer.from(String(b64 || '').trim(), 'base64');
  if (key.length !== 32) throw new Error('FEED_KEY must be 32 bytes, base64-encoded');
  return key;
}

export function hasFeedKey(b64 = process.env.FEED_KEY) {
  try {
    keyFrom(b64);
    return true;
  } catch {
    return false;
  }
}

export function encryptJson(value, b64 = process.env.FEED_KEY) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(b64), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decryptJson(envelope, b64 = process.env.FEED_KEY) {
  if (!envelope || envelope.alg !== 'aes-256-gcm') throw new Error('not an encrypted feed');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(b64), Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}
