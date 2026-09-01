import { REST, Routes } from 'discord.js';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(__dirname, 'commands');
const files = (await readdir(commandsDir)).filter((f) => f.endsWith('.js'));

const body = [];
for (const file of files) {
  const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
  body.push(mod.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(config.token);

try {
  if (config.guildId) {
    console.log(`Deploying ${body.length} guild commands to ${config.guildId}...`);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body,
    });
  } else {
    console.log(`Deploying ${body.length} global commands...`);
    await rest.put(Routes.applicationCommands(config.clientId), { body });
  }
  console.log('Commands deployed.');
} catch (err) {
  console.error(err);
  process.exit(1);
}
