import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { deletePlayer, getPlayer } from '../player.js';

export const data = new SlashCommandBuilder()
  .setName('leave')
  .setDescription('Выйти из голосового канала');

export async function execute(interaction) {
  if (!interaction.member?.voice?.channel) {
    await interaction.reply({
      content: 'Ты должен быть в голосовом канале.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const player = getPlayer(interaction.guildId);
  if (!player.connection) {
    await interaction.reply({
      content: 'Я не в голосовом канале.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  deletePlayer(interaction.guildId);
  await interaction.reply('Вышел из голосового канала.');
}
