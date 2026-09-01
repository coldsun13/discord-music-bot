import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import play from 'play-dl';
import { MAX_PLAYLIST_TRACKS } from './constants.js';
import { resolveYtDlpPathAsync } from './bins.js';

export { MAX_PLAYLIST_TRACKS };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const YT_URL_RE =
  /^(https?:\/\/)?(www\.|music\.)?(youtube\.com|youtu\.be)\//i;

export function isYouTubeUrl(query) {
  return YT_URL_RE.test(query.trim());
}

export function isPlaylistUrl(query) {
  try {
    const url = new URL(query.trim());
    const host = url.hostname.replace(/^www\./, '');
    if (!/(^|\.)youtube\.com$/.test(host) && host !== 'youtu.be' && host !== 'music.youtube.com') {
      return false;
    }
    if (url.pathname.includes('/playlist')) return true;
    const list = url.searchParams.get('list');
    // Explicit playlist pages only by default; watch?v=&list= needs /play playlist:true
    return Boolean(list && url.pathname.includes('/playlist'));
  } catch {
    return false;
  }
}

function cookiesPath() {
  const fromEnv = process.env.YTDLP_COOKIES || process.env.YOUTUBE_COOKIES;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const local = path.join(root, 'cookies.txt');
  if (existsSync(local)) return local;
  return null;
}

function ytDlpCommonArgs(playerClient = 'android,tv,web') {
  const args = [
    '--no-warnings',
    '--extractor-args',
    `youtube:player_client=${playerClient}`,
  ];
  const cookies = cookiesPath();
  if (cookies) {
    args.push('--cookies', cookies);
  }
  return args;
}

async function runYtDlp(args) {
  const ytDlp = await resolveYtDlpPathAsync();
  return new Promise((resolve, reject) => {
    const proc = spawn(ytDlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    proc.on('error', (err) => {
      reject(
        new Error(
          `Не удалось запустить yt-dlp (${ytDlp}). На хосте выполни ensure-bins.\n${err.message}`,
        ),
      );
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function pickAudioFormat(info) {
  const formats = [
    ...(info.requested_formats || []),
    ...(info.formats || []),
  ].filter((f) => f && f.url && f.acodec && f.acodec !== 'none');

  if (!formats.length) {
    if (info.url) {
      return {
        streamUrl: info.url,
        httpHeaders: info.http_headers || {},
      };
    }
    return null;
  }

  // Prefer pure audio, then highest abr / tbr.
  formats.sort((a, b) => {
    const aAudioOnly = a.vcodec === 'none' || !a.vcodec ? 1 : 0;
    const bAudioOnly = b.vcodec === 'none' || !b.vcodec ? 1 : 0;
    if (aAudioOnly !== bAudioOnly) return bAudioOnly - aAudioOnly;
    return (Number(b.abr) || Number(b.tbr) || 0) - (Number(a.abr) || Number(a.tbr) || 0);
  });

  const best = formats[0];
  return {
    streamUrl: best.url,
    httpHeaders: best.http_headers || info.http_headers || {},
  };
}

function trackFromInfo(info, fallbackUrl) {
  const audio = pickAudioFormat(info);
  if (!audio?.streamUrl && !info.id && !fallbackUrl) {
    throw new Error('Не удалось получить аудиопоток с YouTube.');
  }

  const watchUrl =
    info.webpage_url ||
    fallbackUrl ||
    (info.id ? `https://www.youtube.com/watch?v=${info.id}` : null);

  return {
    title: info.title || 'Unknown title',
    url: watchUrl,
    duration: Number(info.duration) || 0,
    thumbnail: info.thumbnail || info.thumbnails?.at(-1)?.url || null,
    channel: info.uploader || info.channel || 'Unknown',
    streamUrl: audio?.streamUrl || null,
    httpHeaders: audio?.httpHeaders || {},
  };
}

function entryToQueueTrack(entry) {
  if (!entry || entry.ie_key === 'YoutubeTab') return null;

  const id = entry.id || entry.url;
  if (!id || typeof id !== 'string') return null;

  const watchUrl = id.startsWith('http')
    ? id
    : `https://www.youtube.com/watch?v=${id}`;

  const pageUrl =
    entry.webpage_url ||
    (typeof entry.url === 'string' && entry.url.startsWith('http')
      ? entry.url
      : watchUrl);

  return {
    title: entry.title || 'Unknown title',
    url: pageUrl,
    duration: Number(entry.duration) || 0,
    thumbnail: entry.thumbnails?.at(-1)?.url || entry.thumbnail || null,
    channel: entry.uploader || entry.channel || entry.uploader_id || 'Unknown',
    streamUrl: null,
    httpHeaders: {},
  };
}

/**
 * Resolve a YouTube URL or search query into track metadata + stream URL.
 */
export async function resolveTrack(query) {
  const input = query.trim();

  if (!isYouTubeUrl(input)) {
    const results = await play.search(input, { limit: 1 });
    if (!results.length) {
      throw new Error('Ничего не найдено на YouTube.');
    }
    return fetchTrackInfo(results[0].url);
  }

  return fetchTrackInfo(input);
}

async function fetchTrackInfo(url) {
  const attempts = [
    'android,tv,web',
    'android',
    'tv',
    'web',
    'mweb',
  ];

  let lastError = null;
  for (const client of attempts) {
    try {
      // No -f: list all formats, then pick best audio ourselves.
      const stdout = await runYtDlp([
        ...ytDlpCommonArgs(client),
        '--no-playlist',
        '-j',
        '--',
        url,
      ]);
      const info = JSON.parse(stdout);
      const track = trackFromInfo(info, url);
      if (!track.streamUrl) {
        throw new Error('Не удалось получить аудиопоток с YouTube.');
      }
      return track;
    } catch (err) {
      lastError = err;
      console.warn(`[youtube] client=${client} failed: ${err.message}`);
    }
  }

  throw lastError || new Error('Не удалось получить аудиопоток с YouTube.');
}

export async function fetchPlaylist(url, { limit = MAX_PLAYLIST_TRACKS } = {}) {
  const stdout = await runYtDlp([
    ...ytDlpCommonArgs(),
    '--yes-playlist',
    '--flat-playlist',
    '-J',
    '--playlist-end',
    String(limit),
    '--',
    url,
  ]);

  const info = JSON.parse(stdout);
  const rawEntries = Array.isArray(info.entries) ? info.entries : [];
  const tracks = rawEntries.map(entryToQueueTrack).filter(Boolean);

  if (!tracks.length) {
    throw new Error('В плейлисте нет доступных треков.');
  }

  return {
    title: info.title || info.playlist_title || 'YouTube Playlist',
    url: info.webpage_url || info.original_url || url,
    thumbnail: info.thumbnails?.at(-1)?.url || info.thumbnail || tracks[0]?.thumbnail || null,
    channel: info.uploader || info.channel || 'Unknown',
    total: Number(info.playlist_count) || tracks.length,
    tracks,
  };
}

/**
 * Resolve search / YouTube into a unified result.
 */
export async function resolveInput(query, { asPlaylist = false } = {}) {
  const input = query.trim();

  if (isYouTubeUrl(input) && (isPlaylistUrl(input) || asPlaylist)) {
    const playlist = await fetchPlaylist(input);
    return { type: 'playlist', playlist };
  }

  const track = await resolveTrack(input);
  return { type: 'track', track };
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}
