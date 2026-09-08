import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import play from 'play-dl';
import { MAX_PLAYLIST_TRACKS } from './constants.js';
import { resolveYtDlpPathAsync } from './bins.js';
import { getCookiesFilePath } from './cookies.js';

export { MAX_PLAYLIST_TRACKS };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const YT_URL_RE =
  /^(https?:\/\/)?(www\.|music\.)?(youtube\.com|youtu\.be)\//i;

const SC_URL_RE = /^(https?:\/\/)?(www\.|m\.)?(soundcloud\.com|snd\.sc)\//i;

/** YouTube answers with this when the host IP is flagged. */
const BLOCKED_RE =
  /not a bot|sign in to confirm|confirm you.{0,3}re not|HTTP Error 403|Requested format is not available|Video unavailable|player response/i;

export function isYouTubeUrl(query) {
  return YT_URL_RE.test(query.trim());
}

export function isSoundCloudUrl(query) {
  return SC_URL_RE.test(query.trim());
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
  return getCookiesFilePath();
}

function proxyUrl() {
  return (
    process.env.YTDLP_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    null
  );
}

function ytDlpCommonArgs(playerClient = 'web,mweb,android') {
  const args = [
    '--no-warnings',
    '--extractor-args',
    `youtube:player_client=${playerClient}`,
  ];
  const cookies = cookiesPath();
  if (cookies) {
    args.push('--cookies', cookies);
  }
  const proxy = proxyUrl();
  if (proxy) {
    args.push('--proxy', proxy);
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
    throw new Error('Не удалось получить аудиопоток.');
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
    source: info.extractor_key === 'Soundcloud' || info.extractor === 'soundcloud'
      ? 'soundcloud'
      : 'youtube',
  };
}

function entryToQueueTrack(entry) {
  if (!entry || entry.ie_key === 'YoutubeTab') return null;

  const id = entry.id != null ? String(entry.id) : entry.url;
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

/** yt-dlp call without YouTube-specific extractor args. */
async function fetchPlainInfo(target) {
  const args = ['--no-warnings', '--no-playlist'];
  const proxy = proxyUrl();
  if (proxy) args.push('--proxy', proxy);
  args.push('-j', '--', target);

  const stdout = await runYtDlp(args);
  const info = JSON.parse(stdout.trim().split('\n')[0]);
  const track = trackFromInfo(info, null);
  if (!track.streamUrl) {
    throw new Error('Не удалось получить аудиопоток.');
  }
  return track;
}

/** Junk that YouTube titles carry but SoundCloud titles don't. */
function cleanQuery(raw) {
  return String(raw)
    .replace(/\((?=[^)]*(?:official|video|audio|lyrics?|visualizer|hd|4k|remaster))[^)]*\)/gi, ' ')
    .replace(/\[(?=[^\]]*(?:official|video|audio|lyrics?|visualizer|hd|4k|remaster))[^\]]*\]/gi, ' ')
    .replace(/\b(?:official\s+(?:music\s+)?video|official\s+audio|lyric\s+video|visualizer|topic)\b/gi, ' ')
    .replace(/[|•·–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VARIANT_RE =
  /\b(remix|edit|cover|live|bootleg|mashup|nightcore|sped\s*up|slowed|reverb|8d|karaoke|instrumental|acapella|snippet|preview|teaser)\b/i;

function tokens(str) {
  return new Set(
    str
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function scoreCandidate(entry, wanted, expectedDuration) {
  const duration = Number(entry.duration) || 0;
  const haystack = `${entry.title || ''} ${entry.uploader || ''}`;
  const hay = tokens(haystack);

  let score = 0;
  for (const t of wanted) if (hay.has(t)) score += 10;

  // 30-second entries are almost always Go+ previews, not real tracks.
  const wantsShort = expectedDuration > 0 && expectedDuration <= 45;
  if (!wantsShort && duration > 0 && duration <= 35) score -= 60;
  if (expectedDuration > 0 && duration > 0) {
    const diff = Math.abs(duration - expectedDuration);
    if (diff <= 5) score += 35;
    else if (diff <= 15) score += 20;
    else if (diff > 60) score -= 15;
  }
  if (VARIANT_RE.test(entry.title || '') && !VARIANT_RE.test(wantedRaw(wanted))) {
    score -= 12;
  }
  return score;
}

function wantedRaw(wanted) {
  return [...wanted].join(' ');
}

/**
 * Search SoundCloud and stream the best match. Uses a cheap flat search to
 * rank candidates (skipping Go+ 30-second previews), then extracts the winner.
 */
export async function searchSoundCloud(query, { expectedDuration = 0, limit = 10 } = {}) {
  const cleaned = cleanQuery(query);
  const args = ['--no-warnings', '--flat-playlist', '-J'];
  const proxy = proxyUrl();
  if (proxy) args.push('--proxy', proxy);
  args.push(`scsearch${limit}:${cleaned}`);

  let entries = [];
  try {
    const parsed = JSON.parse(await runYtDlp(args));
    entries = (Array.isArray(parsed.entries) ? parsed.entries : []).filter(
      (e) => e && (e.url || e.id),
    );
  } catch (err) {
    console.warn(`[soundcloud] search failed: ${err.message}`);
  }

  if (!entries.length) {
    throw new Error(`На SoundCloud ничего не нашлось по запросу «${cleaned}».`);
  }

  const wanted = tokens(cleaned);
  const ranked = entries
    .map((e) => ({ entry: e, score: scoreCandidate(e, wanted, expectedDuration) }))
    .sort((a, b) => b.score - a.score);

  let lastError = null;
  for (const { entry } of ranked.slice(0, 3)) {
    const target = entry.webpage_url || entry.url;
    if (!target) continue;
    try {
      return await fetchPlainInfo(target);
    } catch (err) {
      lastError = err;
      console.warn(`[soundcloud] ${target} failed: ${err.message}`);
    }
  }

  throw lastError || new Error('Не удалось получить аудиопоток с SoundCloud.');
}

/** Title lookup that keeps working when YouTube blocks the host IP. */
async function fetchYouTubeTitle(url) {
  const res = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.title) return null;
  return data.author_name ? `${data.author_name} - ${data.title}` : data.title;
}

/**
 * Resolve a URL or search query into track metadata + stream URL.
 * Falls back to SoundCloud when YouTube blocks the host.
 */
export async function resolveTrack(
  query,
  { fallbackQuery = null, fallbackDuration = 0, source = 'auto' } = {},
) {
  const input = query.trim();

  if (isSoundCloudUrl(input)) {
    return fetchPlainInfo(input);
  }

  const scFallback = async () => {
    const scQuery =
      fallbackQuery || (isYouTubeUrl(input) ? await fetchYouTubeTitle(input).catch(() => null) : input);
    if (!scQuery) return null;
    console.warn(`[soundcloud] fallback search: "${scQuery}"`);
    return searchSoundCloud(scQuery, { expectedDuration: fallbackDuration });
  };

  if (source === 'soundcloud') {
    const track = await scFallback();
    if (!track) throw new Error('Не удалось определить название трека для поиска.');
    return track;
  }

  if (!isYouTubeUrl(input)) {
    let ytUrl = null;
    try {
      const results = await play.search(input, { limit: 1 });
      ytUrl = results[0]?.url || null;
    } catch (err) {
      console.warn(`[youtube] search failed: ${err.message}`);
    }

    if (ytUrl) {
      try {
        return await fetchTrackInfo(ytUrl);
      } catch (err) {
        console.warn(`[youtube] blocked, trying SoundCloud: ${err.message}`);
      }
    }
    return searchSoundCloud(input);
  }

  try {
    return await fetchTrackInfo(input);
  } catch (err) {
    if (source === 'youtube' || !BLOCKED_RE.test(err.message)) throw err;

    const track = await scFallback();
    if (!track) throw err;
    return track;
  }
}

async function fetchTrackInfo(url) {
  // Prefer web/mweb when cookies exist — android/tv often ignore cookies.
  const attempts = cookiesPath()
    ? ['web', 'web_safari', 'mweb', 'android']
    : ['android,tv,web', 'android', 'tv', 'web', 'mweb'];

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
  const baseArgs = isSoundCloudUrl(url)
    ? ['--no-warnings', ...(proxyUrl() ? ['--proxy', proxyUrl()] : [])]
    : ytDlpCommonArgs();

  const stdout = await runYtDlp([
    ...baseArgs,
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
    title: info.title || info.playlist_title || 'Playlist',
    url: info.webpage_url || info.original_url || url,
    thumbnail: info.thumbnails?.at(-1)?.url || info.thumbnail || tracks[0]?.thumbnail || null,
    channel: info.uploader || info.channel || 'Unknown',
    total: Number(info.playlist_count) || tracks.length,
    tracks,
  };
}

/**
 * Resolve search / YouTube / SoundCloud into a unified result.
 */
export async function resolveInput(query, { asPlaylist = false, source = 'auto' } = {}) {
  const input = query.trim();

  const isScSet = isSoundCloudUrl(input) && /\/sets\//.test(input);
  if (isScSet || (isYouTubeUrl(input) && (isPlaylistUrl(input) || asPlaylist))) {
    const playlist = await fetchPlaylist(input);
    return { type: 'playlist', playlist };
  }

  const track = await resolveTrack(input, { source });
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
