import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../player.js';

export const data = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Поставить на паузу');

export async function execute(interaction) {
  if (!interaction.member?.voice?.channel) {
    await interaction.reply({
      content: 'Ты должен быть в голосовом канале.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const player = getPlayer(interaction.guildId);
  if (!player.isPlaying) {
    await interaction.reply({
      content: 'Сейчас ничего не играет.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  player.pause();
  await interaction.reply('Пауза.');
}
