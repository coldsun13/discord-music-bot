import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../player.js';
import { buildNowPlayingPayload } from '../nowPlaying.js';

export const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Показать панель управления текущим треком');

export async function execute(interaction) {
  const player = getPlayer(interaction.guildId);

  if (!player.current) {
    await interaction.reply({
      content: 'Сейчас ничего не играет. Сначала `/play`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  player.textChannel = interaction.channel;
  await interaction.reply(buildNowPlayingPayload(player));
  const message = await interaction.fetchReply();
  await player.attachPanelMessage(message);
}
