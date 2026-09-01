# Discord Music Bot (YouTube)

Бот для Discord, который ищет и воспроизводит музыку с YouTube в голосовом канале.

## Возможности

- `/play` — ссылка YouTube или поисковый запрос
- `/skip` `/pause` `/resume` `/stop`
- `/queue` — текущий трек и очередь
- `/leave` — выход из голосового канала

Стек: **discord.js** + **@discordjs/voice** + **yt-dlp** + **ffmpeg**.

## Требования

- Node.js 18+
- [ffmpeg](https://ffmpeg.org/) и [yt-dlp](https://github.com/yt-dlp/yt-dlp)

```bash
brew install node ffmpeg yt-dlp
```

## Настройка Discord

1. Создай приложение на [Discord Developer Portal](https://discord.com/developers/applications).
2. В **Bot** создай бота и скопируй **Token**.
3. Включи Privileged Intent не нужны — достаточно Guilds + Voice States (уже в коде).
4. Скопируй **Application ID** (это `CLIENT_ID`).
5. Пригласи бота на сервер со scope `bot` + `applications.commands` и правами:
   - Connect
   - Speak
   - Use Application Commands
   - Send Messages

Invite URL (подставь `CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=3148800&scope=bot%20applications.commands
```

## Установка

```bash
cd discord-music-bot
npm run setup          # создаёт .env только если его ещё нет
# заполни DISCORD_TOKEN и CLIENT_ID в .env (open -e .env)
# для быстрой регистрации команд укажи GUILD_ID своего сервера

npm install
npm run deploy-commands
npm start
```

Не используй `cp .env.example .env`, если `.env` уже заполнен — это затрёт токен.

## Команды

| Команда | Описание |
|--------|----------|
| `/play <query>` | Играть / добавить в очередь |
| `/skip` | Пропустить трек |
| `/pause` | Пауза |
| `/resume` | Продолжить |
| `/stop` | Стоп + очистка очереди |
| `/queue` | Показать очередь |
| `/leave` | Выйти из войса |

## Замечания

- YouTube иногда блокирует запросы; обновляй `yt-dlp`: `brew upgrade yt-dlp`.
- Без `GUILD_ID` slash-команды регистрируются глобально (до ~1 часа).
- Бот выходит из канала через ~60 секунд простоя.
