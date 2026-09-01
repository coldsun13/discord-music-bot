import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localYt = path.join(root, 'bin', 'yt-dlp');
const localFf = path.join(root, 'bin', 'ffmpeg');

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolveYtDlpPathAsync() {
  if (process.env.YT_DLP_PATH) return process.env.YT_DLP_PATH;
  const local = firstExisting([localYt]);
  if (local) return local;
  try {
    const mod = await import('youtube-dl-exec');
    const p = mod.default?.constants?.YOUTUBE_DL_PATH;
    if (p && existsSync(p)) return p;
  } catch {
    // ignore
  }
  return 'yt-dlp';
}

export async function resolveFfmpegPathAsync() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const local = firstExisting([localFf]);
  if (local) return local;
  try {
    const mod = await import('ffmpeg-static');
    if (mod.default && existsSync(mod.default)) return mod.default;
  } catch {
    // ignore
  }
  return 'ffmpeg';
}
