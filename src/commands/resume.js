import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../player.js';

export const data = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Продолжить воспроизведение');

export async function execute(interaction) {
  if (!interaction.member?.voice?.channel) {
    await interaction.reply({
      content: 'Ты должен быть в голосовом канале.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const player = getPlayer(interaction.guildId);
  if (!player.isPaused) {
    await interaction.reply({
      content: 'Сейчас нет трека на паузе.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  player.resume();
  await interaction.reply('Продолжаю.');
}
