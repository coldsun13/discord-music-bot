import { createWriteStream, existsSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binDir = path.join(root, 'bin');

mkdirSync(binDir, { recursive: true });

async function download(url, dest, { force = false } = {}) {
  if (existsSync(dest) && !force) {
    console.log(`[bins] exists: ${path.basename(dest)}`);
    return;
  }
  if (existsSync(dest) && force) {
    unlinkSync(dest);
  }
  console.log(`[bins] downloading ${path.basename(dest)}...`);
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'discord-music-bot' },
  });
  if (!res.ok) {
    throw new Error(`Download failed ${url}: ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  chmodSync(dest, 0o755);
  console.log(`[bins] saved ${dest}`);
}

const ytDlp = path.join(binDir, 'yt-dlp');
const ffmpeg = path.join(binDir, 'ffmpeg');

const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const ffmpegAsset =
  process.platform === 'linux'
    ? `ffmpeg-linux-${arch}`
    : process.platform === 'darwin'
      ? `ffmpeg-darwin-${arch}`
      : `ffmpeg-win32-${arch}.exe`;

// Always refresh yt-dlp — YouTube breaks old builds quickly.
await download(
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
  ytDlp,
  { force: true },
);

await download(
  `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/${ffmpegAsset}`,
  ffmpeg,
);

console.log('[bins] ready');
