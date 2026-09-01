import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cookiesFile = path.join(root, 'cookies.txt');

function looksLikeNetscapeCookies(text) {
  if (!text || text.length < 20) return false;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return false;
  if (/netscape/i.test(text.split('\n', 3).join('\n'))) return true;
  // tab-separated cookie lines
  return text.split('\n').some((line) => {
    if (!line || line.startsWith('#')) return false;
    const parts = line.split('\t');
    return parts.length >= 7 && parts[0].includes('youtube');
  });
}

function decodeCookiesPayload() {
  const hex = process.env.YTDLP_COOKIES_HEX || process.env.YOUTUBE_COOKIES_HEX;
  if (hex) {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    if (clean.length % 2 !== 0) {
      throw new Error('YTDLP_COOKIES_HEX has odd length — copy was truncated');
    }
    return Buffer.from(clean, 'hex').toString('utf8');
  }

  const b64 = process.env.YTDLP_COOKIES_BASE64 || process.env.YOUTUBE_COOKIES_BASE64;
  if (b64) {
    return Buffer.from(b64.trim().replace(/\s+/g, ''), 'base64').toString('utf8');
  }

  return null;
}

/**
 * Materialize cookies.txt from Env when file upload is unavailable.
 * Prefer YTDLP_COOKIES_HEX (safer in hosting panels than base64).
 */
export function materializeCookiesFromEnv() {
  let text;
  try {
    text = decodeCookiesPayload();
  } catch (err) {
    console.error('[cookies]', err.message);
    return null;
  }
  if (!text) return null;

  if (!looksLikeNetscapeCookies(text)) {
    console.error(
      '[cookies] decoded payload is not a valid Netscape cookies.txt — delete the Env var and paste again carefully',
    );
    return null;
  }

  if (!/youtube\.com/i.test(text)) {
    console.warn('[cookies] file has no youtube.com entries');
  }

  writeFileSync(cookiesFile, text, 'utf8');
  console.log(`[cookies] wrote ${cookiesFile} from env (${text.length} bytes)`);
  return cookiesFile;
}

export function getCookiesFilePath() {
  materializeCookiesFromEnv();
  const fromEnv = process.env.YTDLP_COOKIES || process.env.YOUTUBE_COOKIES;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync(cookiesFile)) return cookiesFile;
  return null;
}
