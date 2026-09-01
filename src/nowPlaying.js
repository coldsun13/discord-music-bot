import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { formatDuration } from './youtube.js';

export function buildProgressBar(currentSec, totalSec, size = 14) {
  const total = Math.max(0, Number(totalSec) || 0);
  const current = Math.max(0, Math.min(total || currentSec, Number(currentSec) || 0));
  if (!total) {
    return `\`${formatDuration(current)}\` ${'▬'.repeat(size)} \`?:??\``;
  }
  const ratio = Math.min(1, current / total);
  const knob = Math.round(ratio * (size - 1));
  let bar = '';
  for (let i = 0; i < size; i++) {
    bar += i === knob ? '●' : '▬';
  }
  return `\`${formatDuration(current)}\` ${bar} \`${formatDuration(total)}\``;
}

export function buildControlRow(player) {
  const paused = player.isPaused;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music:pause')
      .setEmoji(paused ? '▶️' : '⏸️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('music:skip')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:lyrics')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:shuffle')
      .setEmoji('🔀')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('music:stop')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger),
  );
}

export function buildDisabledControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music:pause')
      .setEmoji('⏸️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('music:skip')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('music:lyrics')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('music:shuffle')
      .setEmoji('🔀')
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('music:stop')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
  );
}

export function buildNowPlayingEmbed(player) {
  const track = player.current;
  if (!track) {
    return new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('Очередь пуста')
      .setDescription('Добавь трек через `/play`.');
  }

  const status = player.isPaused ? 'PAUSE' : 'NOW PLAYING';
  const statusColor = player.isPaused ? 0xf1c40f : 0xe74c3c;
  const position = buildProgressBar(
    player.getPlaybackPosition(),
    track.duration,
  );

  const embed = new EmbedBuilder()
    .setColor(statusColor)
    .setAuthor({ name: status })
    .setTitle(track.title.length > 240 ? `${track.title.slice(0, 237)}...` : track.title)
    .setURL(track.url)
    .setDescription(
      [
        track.channel ? `**${track.channel}**` : null,
        `Requested by **${track.requestedBy || 'unknown'}** • **${player.queue.length}** in queue`,
        '',
        position,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: 'Music Bot' });

  if (track.thumbnail) {
    embed.setThumbnail(track.thumbnail);
  }

  return embed;
}

export function buildNowPlayingPayload(player, { disabled = false } = {}) {
  return {
    embeds: [buildNowPlayingEmbed(player)],
    components: [disabled ? buildDisabledControlRow() : buildControlRow(player)],
  };
}

/** Best-effort lyrics lookup (no API key). */
export async function fetchLyrics(trackTitle) {
  const query = trackTitle
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
  const searchRes = await fetch(searchUrl, {
    headers: { 'User-Agent': 'discord-music-bot' },
  });
  if (!searchRes.ok) {
    throw new Error('Сервис текстов недоступен.');
  }

  const results = await searchRes.json();
  const hit = Array.isArray(results)
    ? results.find((r) => r.plainLyrics || r.syncedLyrics)
    : null;

  if (!hit) {
    throw new Error('Текст не найден.');
  }

  let lyrics = hit.plainLyrics || hit.syncedLyrics || '';
  lyrics = lyrics.replace(/\[\d+:\d+\.\d+\]/g, '').trim();
  if (!lyrics) {
    throw new Error('Текст не найден.');
  }

  const header = `**${hit.trackName || trackTitle}** — ${hit.artistName || '?'}\n\n`;
  const max = 3800 - header.length;
  if (lyrics.length > max) {
    lyrics = `${lyrics.slice(0, max)}\n…`;
  }
  return header + lyrics;
}
