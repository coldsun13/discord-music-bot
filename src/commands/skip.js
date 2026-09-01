import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayer } from '../player.js';

export const data = new SlashCommandBuilder()
  .setName('skip')
  .setDescription('Пропустить текущий трек');

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

  const skipped = player.current?.title || 'трек';
  player.skip();
  await interaction.reply(`Пропущено: **${skipped}**`);
}
