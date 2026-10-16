/**
 * Pull the Cookie header out of a DevTools "Copy as cURL" paste. Handles
 * `-H 'cookie: …'`, `-b '…'` / `--cookie '…'`, double quotes, and bash
 * ANSI-C quoting (`$'…'`), which Chrome uses when a cookie has odd bytes.
 */

/** Read one shell argument starting at s[i]; returns its unquoted value. */
function readArg(s, i) {
  if (s[i] === '$' && s[i + 1] === "'") {
    let out = '';
    for (i += 2; i < s.length && s[i] !== "'"; i += 1) {
      if (s[i] === '\\' && i + 1 < s.length) { i += 1; out += s[i]; } else out += s[i];
    }
    return out;
  }
  if (s[i] === "'") {
    const end = s.indexOf("'", i + 1);
    return s.slice(i + 1, end < 0 ? undefined : end);
  }
  if (s[i] === '"') {
    let out = '';
    for (i += 1; i < s.length && s[i] !== '"'; i += 1) {
      if (s[i] === '\\' && i + 1 < s.length) { i += 1; out += s[i]; } else out += s[i];
    }
    return out;
  }
  return (s.slice(i).match(/^\S+/) || [''])[0];
}

export function extractCookie(curl) {
  const s = String(curl || '').replace(/\\\r?\n/g, ' ');
  const flag = /(?:^|\s)(-H|--header|-b|--cookie)\s+/g;
  let m;
  while ((m = flag.exec(s))) {
    const arg = readArg(s, m.index + m[0].length);
    if (m[1] === '-b' || m[1] === '--cookie') {
      if (arg.trim()) return arg.trim();
    } else {
      const h = arg.match(/^\s*cookie:\s*([\s\S]*)$/i);
      if (h && h[1].trim()) return h[1].trim();
    }
  }
  // A bare "name=value; name2=value2" paste.
  const t = s.trim();
  if (!/\bcurl\b/i.test(t) && /^[^\s=;]+=[^;]*(;\s*[^\s=;]+=[^;]*)*;?$/.test(t)) return t;
  return '';
}

export function curlHost(curl) {
  const m = String(curl || '').match(/curl\s+\$?['"]?(https?:\/\/[^'"\s]+)/i);
  try {
    return m ? new URL(m[1]).hostname : '';
  } catch {
    return '';
  }
}
