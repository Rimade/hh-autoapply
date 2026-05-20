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
npm install
npx playwright install chromium

cp .env.example .env
cp cover-letter.example.txt cover-letter.txt
# отредактируй HH_SEARCH_URL и письмо в .env / cover-letter.txt

npm run login    # один раз или после 403/503
npm run apply
```

## Ежедневный цикл (достаточно для самостоятельной работы)

| Шаг | Команда | Зачем |
|-----|---------|--------|
| 1 | `npm run login` | если 403/503, «сессия устарела» или давно не заходил |
| 2 | `npm run apply` | отклики (лимиты и cooldowns в `.env`) |
| 3 | `npm run outcomes` | раз в 2–7 дней: разметить pending → replied/ignored/… |
| 4 | `npm run cohorts` → `insights` → `stats` | аналитика (когда есть размеченные исходы) |
| 5 | `npm run export` | CSV в Excel при необходимости |

Рекомендуется в `.env`: `SCORE_ENABLED=true`, `USE_SYSTEM_CHROME=true`, `NEGATIVE_DOMINATES=true`.

**Не запускай два `apply` параллельно** (lock на профиль).

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

## v4 — feedback loop (реализовано)

### Разметка исходов

```bash
npm run outcomes
```

Коды: `1` replied · `2` ignored · `3` rejected · `4` interview · `s` skip · `q` выход

После откликов в БД остаётся `outcome=pending`. Ручная разметка — ground truth до любого GPT.

### Статистика по сигналам (decay + confidence)

```bash
npm run stats
```

- Только размеченные outcomes (не `pending`)
- **Decay** по возрасту отклика: `<30д=1.0` · `30–90=0.7` · `90–180=0.4` · `>180=0.2`
- **conf** — reliability estimate, не truth (ranking не меняется автоматически)
- **Пары сигналов** — `remote + typescript` и т.д. (`PAIRWISE_MIN_SAMPLES=3`)
- **Latency** — дни от отклика до разметки (`outcome_at` при `npm run outcomes`)
- **Timeline** — последние исходы с `+Nд`

`n >= LEARNING_MIN_SAMPLES` (по умолчанию 5) для одиночных сигналов.

### Cohort analysis (P2)

```bash
npm run cohorts
```

- **Funnel** — seen → ok → labeled → positive
- **Weekly** — отклики по неделям + pos% среди размеченных
- **Score buckets** — `<0`, `0–19`, `20–39`, `40+` и reply rate по корзинам

Pairwise `conf` в stats с **sparsity penalty** (`n/(n+2)`), чтобы `3/3` не выглядел как истина.

### Insights (P2.2–P2.3)

```bash
npm run insights
```

- **Exposure** — откликов до первого positive; pos% по дню недели и часу (локальное время)
- **Saturation** — компании seen×N, повторные apply, доминирующие сигналы за окно

### Diversity guard (P2.4, в `apply`)

```env
DIVERSITY_GUARD=true
MAX_COMPANY_APPLIES_PER_DAY=2
MAX_SIGNAL_APPLIES_PER_DAY=4
```

Лимит «похожих» откликов в день (компания + primary signal). Отключить: `DIVERSITY_GUARD=false`.

Рекомендуемый порядок: `cohorts` → `insights` → `stats` → `export`.

### CSV export

```bash
npm run export
```

Файл `data/hh-export-YYYY-MM-DD.csv` — для Excel, pivot tables, ручного анализа. Свой путь: `EXPORT_CSV_PATH=...`

### Шаблонные письма (без GPT)

```bash
cp cover-letter-template.example.txt cover-letter-template.txt
```

В `.env`:

```env
USE_TEMPLATE_LETTER=true
```

Плейсхолдеры: `{{STACK_LINE}}`, `{{TITLE}}`, `{{COMPANY}}`, `{{COMPANY_LINE}}`. Стек детектится из заголовка и описания вакансии.

### Дальше (не в коде)

- Light sync с перепиской HH (осторожно, без aggressive polling)
- Micro-AI только как тонкая правка шаблона, не генерация всего письма
- Автоподстройка score только при достаточной выборке + decay

Не трогаем Canvas/WebGL deep spoof — system Chrome + stable profile безопаснее.
