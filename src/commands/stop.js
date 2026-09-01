import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../player.js';

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Остановить воспроизведение и очистить очередь');

export async function execute(interaction) {
  if (!interaction.member?.voice?.channel) {
    await interaction.reply({
      content: 'Ты должен быть в голосовом канале.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const player = getPlayer(interaction.guildId);
  if (!player.current && player.queue.length === 0) {
    await interaction.reply({
      content: 'Сейчас ничего не играет.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  player.stop();
  await interaction.reply('Воспроизведение остановлено, очередь очищена.');
}
