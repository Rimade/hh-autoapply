# hh-autoapply

Автоотклики на [hh.ru](https://hh.ru) через Playwright с **persistent-профилем** (как у обычного браузера).

## Почему persistent profile, а не только cookies

`storageState` хранит в основном cookies. **Persistent context** (`user-data/`) сохраняет:

- cookies и localStorage;
- IndexedDB;
- историю сессии в профиле Chromium.

Так HH реже видит «новый браузер каждый запуск».

## Быстрый старт

```bash
cp .env.example .env
cp cover-letter.example.txt cover-letter.txt

npm run login
# войди на hh.ru, затем Enter

npm run apply
```

### Миграция со старой версии

Если есть `cookies/hh-storage.json`, при первом `apply` cookies **один раз** импортируются в `user-data/hh-profile`.
Рекомендуется после этого снова `npm run login` для стабильной сессии.

## Структура

```
hh-autoapply/
├── index.js
├── src/
│   ├── browser.js    # persistent profile + lock
│   ├── stealth.js    # anti-automation init script
│   ├── captcha.js    # капча / блокировка → стоп
│   ├── human.js      # скролл, паузы, «просмотр» вакансии
│   ├── auth.js
│   ├── apply.js
│   ├── hh-response.js
│   └── ...
├── user-data/        # профиль браузера (gitignore)
└── data/applied.json
```

## Переменные (.env)

| Переменная | Описание |
|------------|----------|
| `USER_DATA_DIR` | Папка persistent-профиля |
| `HH_SEARCH_URL` | URL поиска с фильтрами |
| `MAX_APPLICATIONS` | Лимит откликов за запуск |
| `MAX_PAGES` | Страниц выдачи (1 → 2 → 3…) |
| `DELAY_MIN_MS` / `DELAY_MAX_MS` | Случайная пауза между откликами |
| `HUMAN_BROWSE_CHANCE` | Шанс открыть вакансию без отклика (≈0.06) |
| `HEADLESS` | `false` рекомендуется |
| `USE_SYSTEM_CHROME` | `true` — установленный Chrome |
| `COVER_LETTER_FILE` | Сопроводительное письмо |

## Безопасность и лимиты

1. **Не запускай два `apply`/`login` одновременно** — один профиль, file-lock.
2. **10–30 релевантных откликов/день**, не сотни.
3. При капче скрипт остановится с `⛔ Остановка` — зайди вручную, `npm run login`.
4. Не шарь папку `user-data/` — это твой аккаунт HH.

## Сценарии отклика HH

| flow | Описание |
|------|----------|
| `modal` | Модалка + обязательное письмо + «Откликнуться» |
| `inline` | «Резюме доставлено» / форма внизу + «Отправить» |
| `post_delivered` | Уже откликнулся, опционально доп. письмо |
| `instant` | Отклик без письма |

## Команды

| Команда | Действие |
|---------|----------|
| `npm run login` | Вход, профиль сохраняется в `user-data/` |
| `npm run apply` | Автоотклики по выдаче |

## Roadmap (v3+)

- SQLite вместо JSON
- AI cover letter по тексту вакансии
- Retry queue
- Telegram / dashboard
