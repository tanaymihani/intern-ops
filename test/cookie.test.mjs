import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCookie, curlHost } from '../lib/cookie.mjs';

test('extracts cookies from Copy-as-cURL variants', () => {
  assert.equal(extractCookie(`curl 'https://swan-api.jobright.ai/x' -H 'accept: application/json' -b 'SESSION_ID=abc; other=val' -H 'referer: https://jobright.ai/'`), 'SESSION_ID=abc; other=val');
  assert.equal(extractCookie(`curl 'https://jobright.ai/api/x' -H 'cookie: SESSION_ID=abc; foo=bar'`), 'SESSION_ID=abc; foo=bar');
  assert.equal(extractCookie(`curl "https://jobright.ai/api/x" -H "Cookie: SESSION_ID=abc; foo=bar"`), 'SESSION_ID=abc; foo=bar');
  assert.equal(extractCookie(`curl 'https://jobright.ai/api/x' -b $'a=b\\'c; SESSION_ID=xyz'`), "a=b'c; SESSION_ID=xyz");
  assert.equal(extractCookie(`curl 'https://jobright.ai/x' \\\n  -H 'accept: */*' \\\n  -b 'k=v; s=t'`), 'k=v; s=t');
  assert.equal(extractCookie('SESSION_ID=abc; foo=bar'), 'SESSION_ID=abc; foo=bar');
  assert.equal(extractCookie(`curl 'https://jobright.ai/x' -H 'accept: */*'`), '');
});

test('reads the request host', () => {
  assert.equal(curlHost(`curl 'https://swan-api.jobright.ai/swan/x?y=1' -b 'a=b'`), 'swan-api.jobright.ai');
  assert.equal(curlHost('a=b'), '');
});
