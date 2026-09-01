import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cookiesFile = path.join(root, 'cookies.txt');

/**
 * Allow providing YouTube cookies via Env when file upload is broken:
 * YTDLP_COOKIES_BASE64=<base64 of cookies.txt>
 */
export function materializeCookiesFromEnv() {
  const b64 = process.env.YTDLP_COOKIES_BASE64 || process.env.YOUTUBE_COOKIES_BASE64;
  if (!b64) return null;

  try {
    const text = Buffer.from(b64.trim(), 'base64').toString('utf8');
    if (!text.includes('youtube') && !text.includes('.youtube.com')) {
      console.warn('[cookies] YTDLP_COOKIES_BASE64 decoded, but no youtube entries found');
    }
    writeFileSync(cookiesFile, text, 'utf8');
    console.log(`[cookies] wrote ${cookiesFile} from env`);
    return cookiesFile;
  } catch (err) {
    console.error('[cookies] failed to decode YTDLP_COOKIES_BASE64:', err.message);
    return null;
  }
}

export function getCookiesFilePath() {
  materializeCookiesFromEnv();
  const fromEnv = process.env.YTDLP_COOKIES || process.env.YOUTUBE_COOKIES;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync(cookiesFile)) return cookiesFile;
  return null;
}
