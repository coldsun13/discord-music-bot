#!/usr/bin/env node
/**
 * Проверяет, какие источники звука доступны с IP этого сервера.
 * Запуск в консоли хостинга: node scripts/check-sources.mjs
 */
import { materializeCookiesFromEnv } from '../src/cookies.js';
import { resolveTrack, searchSoundCloud } from '../src/youtube.js';

materializeCookiesFromEnv();

const checks = [
  {
    name: 'YouTube (прямая ссылка)',
    run: () => resolveTrack('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { source: 'youtube' }),
  },
  {
    name: 'SoundCloud (поиск)',
    run: () => searchSoundCloud('Rick Astley Never Gonna Give You Up', { expectedDuration: 213 }),
  },
];

let soundcloudOk = false;

for (const check of checks) {
  process.stdout.write(`→ ${check.name}... `);
  try {
    const track = await check.run();
    console.log(`OK — ${track.title} (${Math.round(track.duration)}s, ${track.source})`);
    if (track.source === 'soundcloud') soundcloudOk = true;
  } catch (err) {
    console.log(`НЕДОСТУПНО\n   ${err.message.split('\n')[0]}`);
  }
}

console.log(
  soundcloudOk
    ? '\nSoundCloud работает — бот сможет играть музыку с этого сервера.'
    : '\nSoundCloud недоступен. Проверь, что ensure-bins скачал свежий yt-dlp.',
);
