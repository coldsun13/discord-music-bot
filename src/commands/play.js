import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { getPlayer } from '../player.js';
import {
  resolveInput,
  formatDuration,
  MAX_PLAYLIST_TRACKS,
} from '../youtube.js';
import { buildNowPlayingPayload } from '../nowPlaying.js';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Воспроизвести трек или плейлист с YouTube')
  .addStringOption((option) =>
    option
      .setName('query')
      .setDescription('Ссылка YouTube / плейлист / поисковый запрос')
      .setRequired(true),
  )
  .addBooleanOption((option) =>
    option
      .setName('playlist')
      .setDescription(
        'Если в ссылке на видео YouTube есть list= — добавить весь плейлист',
      )
      .setRequired(false),
  );

async function replyWithPanel(interaction, player) {
  if (!player.current) {
    await interaction.editReply({
      content: 'Не удалось начать воспроизведение.',
      embeds: [],
      components: [],
    });
    return;
  }

  await interaction.editReply(buildNowPlayingPayload(player));
  const message = await interaction.fetchReply();
  await player.attachPanelMessage(message);
}

export async function execute(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.reply({
      content: 'Зайди в голосовой канал, чтобы я мог играть музыку.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const permissions = voiceChannel.permissionsFor(interaction.client.user);
  if (!permissions?.has(['Connect', 'Speak'])) {
    await interaction.reply({
      content: 'Мне нужны права Connect и Speak в этом голосовом канале.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const query = interaction.options.getString('query', true);
  const asPlaylist = interaction.options.getBoolean('playlist') ?? false;
  await interaction.deferReply();

  try {
    const result = await resolveInput(query, { asPlaylist });
    const player = getPlayer(interaction.guildId);
    player.textChannel = interaction.channel;
    await player.connect(voiceChannel);

    const wasIdle =
      !player.current && player.queue.length === 0 && !player.isPlaying;

    if (result.type === 'playlist') {
      const { playlist } = result;
      for (const track of playlist.tracks) {
        player.enqueue({
          ...track,
          requestedBy: interaction.user.tag,
        });
      }

      if (wasIdle) {
        await player.playNext({ updatePanel: false });
        await replyWithPanel(interaction, player);
        if (player.current && playlist.tracks.length > 1) {
          await interaction
            .followUp({
              content: `Добавлено из плейлиста **${playlist.title}**: ${playlist.tracks.length} треков.`,
            })
            .catch(() => {});
        }
        return;
      }

      const preview = playlist.tracks
        .slice(0, 5)
        .map((t, i) => `**${i + 1}.** ${t.title}`)
        .join('\n');
      const more =
        playlist.tracks.length > 5
          ? `\n…и ещё ${playlist.tracks.length - 5}`
          : '';
      const capped =
        playlist.total > playlist.tracks.length
          ? `\n(взято первые ${playlist.tracks.length} из ~${playlist.total}, лимит ${MAX_PLAYLIST_TRACKS})`
          : '';

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('Плейлист добавлен в очередь')
        .setDescription(
          `[${playlist.title}](${playlist.url})\n\n${preview}${more}${capped}`,
        )
        .addFields(
          {
            name: 'Треков',
            value: String(playlist.tracks.length),
            inline: true,
          },
          {
            name: 'Канал',
            value: playlist.channel,
            inline: true,
          },
        )
        .setFooter({ text: `Запросил: ${interaction.user.tag}` });

      if (playlist.thumbnail) {
        embed.setThumbnail(playlist.thumbnail);
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const { track } = result;
    player.enqueue({
      ...track,
      requestedBy: interaction.user.tag,
    });

    if (wasIdle) {
      await player.playNext({ updatePanel: false });
      await replyWithPanel(interaction, player);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('Добавлено в очередь')
      .setDescription(`[${track.title}](${track.url})`)
      .addFields(
        { name: 'Канал', value: track.channel, inline: true },
        {
          name: 'Длительность',
          value: formatDuration(track.duration),
          inline: true,
        },
        {
          name: 'Позиция',
          value: String(player.queue.length),
          inline: true,
        },
      )
      .setFooter({ text: `Запросил: ${interaction.user.tag}` });

    if (track.thumbnail) {
      embed.setThumbnail(track.thumbnail);
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply(`Не удалось добавить: ${err.message}`);
  }
}
