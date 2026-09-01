import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { getPlayer } from '../player.js';
import { formatDuration } from '../youtube.js';

export const data = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Показать очередь');

export async function execute(interaction) {
  const player = getPlayer(interaction.guildId);

  if (!player.current && player.queue.length === 0) {
    await interaction.reply({
      content: 'Очередь пуста.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = [];
  if (player.current) {
    lines.push(
      `**Сейчас:** [${player.current.title}](${player.current.url}) \`${formatDuration(player.current.duration)}\``,
    );
  }

  player.queue.slice(0, 10).forEach((track, index) => {
    lines.push(
      `**${index + 1}.** [${track.title}](${track.url}) \`${formatDuration(track.duration)}\``,
    );
  });

  if (player.queue.length > 10) {
    lines.push(`\n…и ещё ${player.queue.length - 10}`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Очередь')
    .setDescription(lines.join('\n'));

  await interaction.reply({ embeds: [embed] });
}
