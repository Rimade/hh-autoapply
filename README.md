# hh-autoapply

Stateful worker для автооткликов на [hh.ru](https://hh.ru): persistent profile, SQLite, cooldowns, human behavior, block detection.

## Архитектура

```txt
browser identity (persistent profile + fixed fingerprint)
+ state persistence (SQLite)
+ behavior simulation
+ block detection
+ graceful stop
```

## Быстрый старт

```bash
cp .env.example .env
cp cover-letter.example.txt cover-letter.txt

npm run login
npm run apply
```

## v3 — что нового

### Persistent «личность» браузера

- `user-data/hh-profile/.hh-profile.json` — **фиксированные** viewport, CPU, RAM (не рандом каждый запуск)
- Согласованный stealth init script

### SQLite (`data/hh.db`)

- Таблицы: `vacancies`, `companies`, `runs`
- Миграция из `data/applied.json` при первом запуске

### Cooldowns

| Правило | ENV |
|---------|-----|
| Пауза между откликами в одну компанию | `COMPANY_COOLDOWN_HOURS=24` |
| Повтор failed через N дней | `FAILED_RETRY_DAYS=3` |
| Лимит в час | `HOURLY_LIMIT=12` |
| Лимит в сутки | `DAILY_LIMIT=40` |

### Ranking (опционально)

```env
SCORE_ENABLED=true
SCORE_THRESHOLD=0
POSITIVE_KEYWORDS=typescript,javascript,nest,react
NEGATIVE_KEYWORDS=php,python,java,qa,devops
```

### Navigation entropy

`NAVIGATION_ENTROPY_CHANCE=0.08` — иногда страница компании, просмотр вакансии или пауза на выдаче.

## Структура

```
src/
  browser.js      — persistent context + lock
  profile-meta.js — фиксированный fingerprint
  db.js           — SQLite + cooldowns
  score.js        — ranking
  captcha.js      — stop on block
  human.js        — поведение
  apply.js        — основной цикл
```

## Безопасность

- Один процесс на профиль (lock + PID)
- Не запускай два `apply` параллельно
- 15–30 релевантных откликов/день лучше 100 шаблонных
- `USE_SYSTEM_CHROME=true` рекомендуется

## Слои системы

| Слой | Модули |
|------|--------|
| Identity | `browser.js`, `profile-meta.js`, `stealth.js` |
| Behavior | `human.js`, cooldowns |
| Decision | `score.js` (negative dominates) |
| Storage | `db.js` + `outcome` для feedback loop |

## Ranking (`SCORE_ENABLED=true`)

- Встроенные сигналы: `remote`, `hybrid`, `agency`, `office_only`, `relocation`…
- `NEGATIVE_DOMINATES=true` — любой negative keyword или hard-skip → пропуск
- Лучше пропустить, чем откликнуться «куда попало»

## Roadmap v4 — feedback loop

1. **Outcome tracking** — `pending` → `replied` / `ignored` / `rejected` / `interview` (поле уже в БД)
2. **AI letters** — base template + адаптация 2–3 предложений под стек (не GPT на всё письмо)
3. **Learn from outcomes** — поднять score паттернам, которые дают ответы

Не трогаем Canvas/WebGL deep spoof — system Chrome + stable profile безопаснее.
