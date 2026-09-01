# Деплой на сервер (VPS)

Голосовому Discord-боту нужен обычный VPS с UDP. PaaS вроде Railway/Render часто ломают voice.

## Что нужно от тебя

1. Арендовать VPS (Ubuntu 22.04/24.04), например:
   - [Aeza](https://aeza.net/) / [Timeweb](https://timeweb.cloud/) / [Hetzner](https://www.hetzner.com/) / [DigitalOcean](https://www.digitalocean.com/)
   - Хватает самого дешёвого тарифа (1 vCPU, 1 GB RAM)
2. Прислать:
   - IP сервера
   - пользователя (обычно `root`)
   - пароль **или** доступ по SSH-ключу

Дальше можно залить проект и запустить бота удалённо.

## Вариант A: Docker (предпочтительно)

На сервере:

```bash
# установка Docker
curl -fsSL https://get.docker.com | sh

# проект
git clone <repo-url> discord-music-bot
cd discord-music-bot
nano .env   # DISCORD_TOKEN, CLIENT_ID, GUILD_ID

docker compose up -d --build
docker compose logs -f
```

Обновление:

```bash
cd discord-music-bot
git pull
docker compose up -d --build
```

## Вариант B: Node + pm2 (без Docker)

```bash
# зависимости системы
apt update && apt install -y nodejs npm ffmpeg curl
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
npm i -g pm2

# проект
cd /opt
git clone <repo-url> discord-music-bot
cd discord-music-bot
npm run setup && nano .env
npm ci --omit=dev
npm run deploy-commands
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Переменные окружения

```
DISCORD_TOKEN=...
CLIENT_ID=...
GUILD_ID=...   # желательно указать ID сервера
```

После деплоя локальный `npm start` на Mac можно выключить — бот будет жить на сервере.
