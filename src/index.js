import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from 'discord.js';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateDependencyReport } from '@discordjs/voice';
import { config } from './config.js';
import { getPlayer } from './player.js';
import { materializeCookiesFromEnv } from './cookies.js';

materializeCookiesFromEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.commands = new Collection();

async function loadCommands() {
  const commandsDir = path.join(__dirname, 'commands');
  const files = (await readdir(commandsDir)).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
    if (mod.data?.name && typeof mod.execute === 'function') {
      client.commands.set(mod.data.name, mod);
    }
  }
}

function memberInBotVoice(interaction, player) {
  const memberChannel = interaction.member?.voice?.channelId;
  const botChannel = player.connection?.joinConfig?.channelId;
  return Boolean(memberChannel && botChannel && memberChannel === botChannel);
}

async function handleMusicButton(interaction) {
  const player = getPlayer(interaction.guildId);

  if (!memberInBotVoice(interaction, player) && interaction.customId !== 'music:lyrics') {
    await interaction.reply({
      content: 'Чтобы управлять плеером, зайди в голосовой канал с ботом.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const id = interaction.customId;

  if (id === 'music:pause') {
    if (!player.current) {
      await interaction.reply({
        content: 'Сейчас ничего не играет.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const wasPaused = player.isPaused;
    player.togglePause();
    await interaction.reply({
      content: wasPaused ? '▶️ Продолжаю.' : '⏸️ Пауза.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (id === 'music:skip') {
    if (!player.skip()) {
      await interaction.reply({
        content: 'Нечего пропускать.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: '⏭️ Пропущено.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (id === 'music:shuffle') {
    const count = player.shuffle();
    await interaction.reply({
      content:
        count > 0
          ? `🔀 Очередь перемешана (${count} треков).`
          : 'В очереди мало треков для перемешивания.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (id === 'music:stop') {
    player.stop();
    await interaction.reply({
      content: '⏹️ Остановлено, очередь очищена.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (id === 'music:lyrics') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const text = await player.lyrics();
      await interaction.editReply({ content: text });
    } catch (err) {
      await interaction.editReply({ content: `📜 ${err.message}` });
    }
  }
}

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log(generateDependencyReport());
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId.startsWith('music:')) {
      await handleMusicButton(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    await command.execute(interaction);
  } catch (err) {
    console.error(err);
    const payload = {
      content: 'Произошла ошибка при выполнении команды.',
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

await loadCommands();
await client.login(config.token);
