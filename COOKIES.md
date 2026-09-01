# YouTube: "Sign in to confirm you're not a bot"

Бесплатные датацентровые IP (Bot-Hosting и т.п.) YouTube часто режет.
Бот уже пробует обход через `player_client`. Если всё равно ошибка — нужен `cookies.txt`.

## Как сделать cookies.txt (на своём Mac)

1. В Chrome/Firefox зайди на YouTube под своим аккаунтом.
2. Поставь расширение **Get cookies.txt LOCALLY** (или аналог).
3. На youtube.com → экспорт cookies → сохрани файл как `cookies.txt`.
4. На Bot-Hosting → **Files** → Upload `cookies.txt` **в корень** рядом с `package.json`.
5. Restart бота.

Бот сам подхватит `/home/container/cookies.txt`.

Не свети `cookies.txt` никому — это доступ к твоему Google/YouTube аккаунту.
Обновляй файл раз в несколько недель (cookies протухают).
