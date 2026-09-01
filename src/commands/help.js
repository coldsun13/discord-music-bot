import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Руководство по командам бота');

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎵 Музыкальный бот — руководство')
    .setDescription(
      'Зайди в голосовой канал и используй команды ниже.\nЗвук берётся с **YouTube**.',
    )
    .addFields(
      {
        name: '/play query: …',
        value: [
          'Включить трек или добавить в очередь:',
          '• текст — поиск на YouTube',
          '• ссылка на видео YouTube — это видео',
          '• ссылка на плейлист YouTube — весь плейлист (до 50 треков)',
          '• `playlist: True` — если в ссылке видео есть `list=`, взять весь плейлист',
        ].join('\n'),
      },
      {
        name: 'Панель управления',
        value: [
          'Появляется сама после `/play`, когда трек начинает играть.',
          'Кнопки: ⏸️/▶️ пауза • ⏭️ скип • 📜 текст • 🔀 шаффл • ⏹️ стоп',
          'Если панели нет — напиши `/panel`.',
        ].join('\n'),
      },
      {
        name: '/panel',
        value: 'Показать панель с кнопками',
        inline: true,
      },
      {
        name: '/queue',
        value: 'Показать текущий трек и очередь',
        inline: true,
      },
      {
        name: '/skip',
        value: 'Пропустить текущий трек',
        inline: true,
      },
      {
        name: '/pause',
        value: 'Поставить на паузу',
        inline: true,
      },
      {
        name: '/resume',
        value: 'Продолжить после паузы',
        inline: true,
      },
      {
        name: '/stop',
        value: 'Стоп и очистить очередь',
        inline: true,
      },
      {
        name: '/leave',
        value: 'Выйти из голосового канала',
        inline: true,
      },
      {
        name: '/help',
        value: 'Показать это руководство',
        inline: true,
      },
    )
    .setFooter({
      text: 'Бот должен быть онлайн. После простоя ~60 сек сам выходит из войса.',
    });

  await interaction.reply({ embeds: [embed] });
}
