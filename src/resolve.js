import { MAX_PLAYLIST_TRACKS } from './constants.js';
import { getReadyNodes } from './lavalink.js';
import {
  isPlaylistUrl,
  isSoundCloudUrl,
  isYouTubeUrl,
  resolveInput as resolveViaYtDlp,
} from './youtube.js';

function isUrl(value) {
  return /^https?:\/\//i.test(value);
}

/**
 * A link that points at one video inside a playlist should play that video,
 * not the whole list — unless the user explicitly asked for the playlist.
 */
function wantsWholePlaylist(input, asPlaylist) {
  if (asPlaylist) return true;
  if (!isUrl(input)) return false;

  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be' && url.pathname.length > 1) return false;
    if (/youtube\.com$/.test(host) && url.searchParams.get('v')) return false;
  } catch {
    return false;
  }
  return true;
}

function trackFromLavalink(track) {
  const info = track.info || {};
  return {
    title: info.title || 'Unknown title',
    url: info.uri || null,
    duration: info.isStream ? 0 : Math.round((Number(info.length) || 0) / 1000),
    thumbnail: info.artworkUrl || null,
    channel: info.author || 'Unknown',
    source: info.sourceName || 'lavalink',
    encoded: track.encoded,
    isStream: Boolean(info.isStream),
  };
}

function searchPrefix(source) {
  if (source === 'soundcloud') return 'scsearch:';
  return 'ytsearch:';
}

/**
 * Nodes fail on `watch?v=X&list=Y` because they try to read the whole list,
 * so drop the playlist params when only the single video is wanted.
 */
function singleVideoIdentifier(input) {
  try {
    const url = new URL(input);
    for (const param of ['list', 'index', 'start_radio', 'pp']) {
      url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return input;
  }
}

export async function resolveWithNode(node, input, { asPlaylist = false, source = 'auto' } = {}) {
  if (!node) throw new Error('Нет доступной Lavalink-ноды.');

  let identifier;
  if (!isUrl(input)) {
    identifier = `${searchPrefix(source)}${input}`;
  } else if (wantsWholePlaylist(input, asPlaylist)) {
    identifier = input;
  } else {
    identifier = singleVideoIdentifier(input);
  }
  const result = await node.rest.resolve(identifier);

  if (!result) throw new Error('Нода не ответила на запрос.');

  if (result.loadType === 'error') {
    throw new Error(result.data?.message || 'Нода не смогла загрузить трек.');
  }

  if (result.loadType === 'empty') {
    throw new Error('Ничего не найдено.');
  }

  if (result.loadType === 'track') {
    return { type: 'track', track: trackFromLavalink(result.data) };
  }

  if (result.loadType === 'search') {
    const first = result.data?.[0];
    if (!first) throw new Error('Ничего не найдено.');
    return { type: 'track', track: trackFromLavalink(first) };
  }

  if (result.loadType === 'playlist') {
    const entries = result.data?.tracks || [];
    if (!entries.length) throw new Error('В плейлисте нет доступных треков.');

    if (!wantsWholePlaylist(input, asPlaylist)) {
      const selected = entries[result.data.info?.selectedTrack ?? 0] || entries[0];
      return { type: 'track', track: trackFromLavalink(selected) };
    }

    const tracks = entries.slice(0, MAX_PLAYLIST_TRACKS).map(trackFromLavalink);
    return {
      type: 'playlist',
      playlist: {
        title: result.data.info?.name || 'Playlist',
        url: isUrl(input) ? input : null,
        thumbnail: tracks[0]?.thumbnail || null,
        channel: tracks[0]?.channel || 'Unknown',
        total: entries.length,
        tracks,
      },
    };
  }

  throw new Error(`Неизвестный ответ ноды: ${result.loadType}`);
}

/**
 * Resolve user input into a track or playlist, preferring a Lavalink node and
 * falling back to local yt-dlp when no node is reachable.
 */
export async function resolveInput(query, { asPlaylist = false, source = 'auto' } = {}) {
  const input = query.trim();

  // Nodes currently cannot read YouTube playlists, and each failed attempt
  // costs seconds — so only give them one try before enumerating locally.
  const maxNodes = wantsWholePlaylist(input, asPlaylist) ? 1 : Infinity;

  const { result } = await resolveOnNodes(input, { asPlaylist, source, maxNodes });
  if (result) return result;

  return resolveViaYtDlp(input, { asPlaylist, source });
}

/**
 * Try every reachable node, giving up quietly so callers can fall back.
 * Nodes have separate per-IP request quotas, so failing over is worthwhile.
 */
export async function resolveOnNodes(input, { maxNodes = Infinity, ...options } = {}) {
  const nodes = getReadyNodes().slice(0, maxNodes === Infinity ? undefined : maxNodes);
  let rateLimited = false;

  for (const node of nodes) {
    try {
      const result = await resolveWithNode(node, input, options);
      return { result, rateLimited };
    } catch (err) {
      if (err.status === 429) rateLimited = true;
      console.warn(`[resolve] node "${node.name}" failed: ${err.message.split('\n')[0]}`);
    }
  }
  return { result: null, rateLimited };
}

/**
 * Get a node-playable version of a track that was queued without one, e.g.
 * playlist entries enumerated locally. Falls back to searching by title.
 */
export async function resolveEncodedTrack(track) {
  const byTitle = [track.title, track.channel].filter(Boolean).join(' ');
  const attempts = [track.url, byTitle].filter(Boolean);
  let rateLimited = false;

  for (const attempt of attempts) {
    const { result, rateLimited: limited } = await resolveOnNodes(attempt);
    rateLimited = rateLimited || limited;
    if (result?.type === 'track' && result.track.encoded) {
      return result.track;
    }
  }

  throw new Error(
    rateLimited
      ? 'ноды временно ограничили частоту запросов, попробуй через минуту.'
      : 'ни одна нода не смогла найти этот трек.',
  );
}

export { isPlaylistUrl, isSoundCloudUrl, isYouTubeUrl };
