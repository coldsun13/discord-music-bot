#!/usr/bin/env node
/**
 * Проверяет, какие источники звука доступны с этого сервера.
 * Запуск в консоли хостинга: node scripts/check-sources.mjs
 */
import { materializeCookiesFromEnv } from '../src/cookies.js';
import { getConfiguredNodes } from '../src/lavalink.js';
import { resolveTrack, searchSoundCloud } from '../src/youtube.js';

materializeCookiesFromEnv();

const TEST_QUERY = 'ytsearch:daft punk one more time';

async function probeNode(node) {
  const base = `${node.secure ? 'https' : 'http'}://${node.url}`;
  const url = `${base}/v4/loadtracks?identifier=${encodeURIComponent(TEST_QUERY)}`;

  const res = await fetch(url, {
    headers: { Authorization: node.auth },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = await res.json();
  if (body.loadType === 'error') {
    throw new Error(body.data?.message || 'нода вернула ошибку');
  }

  const entries = Array.isArray(body.data) ? body.data : [body.data];
  const info = entries[0]?.info;
  if (!info) throw new Error(`пустой ответ (loadType: ${body.loadType})`);

  return `${info.title} (${Math.round((info.length || 0) / 1000)}s)`;
}

console.log('=== Lavalink-ноды (основной путь для YouTube) ===');
let workingNodes = 0;
for (const node of getConfiguredNodes()) {
  process.stdout.write(`→ ${node.name} (${node.url})... `);
  try {
    console.log(`OK — ${await probeNode(node)}`);
    workingNodes += 1;
  } catch (err) {
    console.log(`НЕДОСТУПНА — ${err.message}`);
  }
}

console.log('\n=== Локальный резерв (yt-dlp с IP этого сервера) ===');
const localChecks = [
  {
    name: 'YouTube напрямую',
    run: () => resolveTrack('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { source: 'youtube' }),
  },
  {
    name: 'SoundCloud поиск',
    run: () => searchSoundCloud('Rick Astley Never Gonna Give You Up', { expectedDuration: 213 }),
  },
];

for (const check of localChecks) {
  process.stdout.write(`→ ${check.name}... `);
  try {
    const track = await check.run();
    console.log(`OK — ${track.title} (${Math.round(track.duration)}s)`);
  } catch (err) {
    console.log(`НЕДОСТУПНО — ${err.message.split('\n')[0]}`);
  }
}

console.log(
  workingNodes > 0
    ? `\nИтог: работает ${workingNodes} нод(а) — YouTube будет играть через них.`
    : '\nИтог: ни одна нода не отвечает. Бот переключится на локальный резерв.',
);
