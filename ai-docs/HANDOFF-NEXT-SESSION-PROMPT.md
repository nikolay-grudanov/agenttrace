# Prompt для новой сессии — Tier 1 work

Скопируй всё ниже и вставь в новый чат с Miko.

---

Привет. Это Kolya, продолжаем работу над двумя репо. Сейчас 2026-09-04, и за последнюю сессию мы закрыли F-005/F-012/F-013 и запушили всё в `origin/main`. Есть два Tier-1 таска которые нужно сделать.

## Что прочитай СНАЧАЛА (в этом порядке)

1. **`~/workspase/projects/agenttrace/ai-docs/HANDOFF-NEXT-SESSION.md`** — состояние дел, что закрыто, что открыто, ключевые constraints.
2. **`~/workspase/projects/agenttrace/ai-docs/PLAN.md`** — Roadmap Tier 1 секция наверху + F-012 (Active) + F-002 status note.
3. **`~/workspase/projects/agenttrace-opencode-plugin/ai-docs/PLAN.md`** — Roadmap Tier 1 секция наверху + F-005 (Active).
4. **Спеки Tier 1 (прочитай оба перед стартом):**
   - `~/workspase/projects/agenttrace/ai-docs/specs/F-008-fts5-fulltext-search.md` — SQLite FTS5 по спанам (Workshop, 3-5 дней).
   - `~/workspase/projects/agenttrace-opencode-plugin/ai-docs/specs/F-011-loadconfig-cwd-bug.md` — bug `loadConfig()` cwd (Plugin, 1-2 часа).

## С чего начать

**T1-B (F-011) сначала** — он маленький (1-2 часа), закрывает реальный bug, и сразу развязывает руки для T1-A. Сделай F-011-P1: расширь `configPaths` в `loadConfig()` обоих бандлов (Workshop **не трогай**, только Plugin), bump версию до `0.1.0-kolya.13`, обнови static copy `~/.config/opencode/plugins/opencode-workshop-plugin.js`. Live-verify по сценарию в спеке §6. Коммить — НЕ пушить (это сделаю я).

**T1-A (F-008) вторым** — большой (3-5 дней). Начни с P1 (storage layer). Каждый коммит — атомарный, как F-012 / F-005.

## Критические правила (нарушать НЕЛЬЗЯ)

- **NO auto-commit, NO auto-push** — каждое коммитить и каждый пуш требует моего явного слова. Сделал работу → стоп → скажи мне → жди «коммить» и/или «пуш».
- **NO daemon restart** — Workshop daemon (pid 2202413, `bun --watch src/index.ts workshop serve`) автоматически подхватывает изменения `src/`. Перезапускать только по моей просьбе.
- **Оба бандла lockstep** — Plugin: `dist/index.js` И `dist/index.cjs` патчатся синхронно + static copy `~/.config/opencode/plugins/opencode-workshop-plugin.js`. Workshop: только src/ + UI (после правок UI нужно `bun run build:ui` чтобы dist обновился).
- **`auth.json` не трогать**, credentials не на диск.
- **clarify сломан** — если нужны уточнения, пиши текстом в реплай, не жди UI форму.
- **Скриншоты — реальные** через Playwright (`executable_path=chromium_headless_shell-1223`), не matplotlib-рендеры. Если не уверен что UI работает — скажи, я перезапущу daemon.

## Текущее состояние на диске

- Plugin HEAD `a7d4c24` на `main` (sync с origin после push 2026-09-04).
- Workshop HEAD `8f8acc8` на `main` (sync с origin).
- Plugin version `0.1.0-kolya.12`.
- Workshop daemon работает через `bun --watch src/index.ts` (мной запущен в этой сессии, не убирай).
- DB: `~/.raindrop/raindrop_workshop.db` ~520 spans, 30+ runs.
- MCP think-mcp работает; подключён только в `/tmp/f010-mcp/opencode.jsonc`.

## Чего НЕ делай (без явного слова)

- Не пуши ни в plugin, ни в workshop.
- Не коммить в main без подтверждения плана.
- Не убивай и не перезапускай никакие сервисы.
- Не удаляй файлы без подтверждения.
- Не модифицируй `~/.hermes/SOUL.md`.
- Не трогай `auth.json`.

## Стиль

- Русский, ты-форма, кратко, без воды.
- Эмодзи умеренно (✨ 🐈 💕 🤣).
- «Я ИИ-ассистент...» — не пиши. Говори от себя.
- Если не уверен в чём-то — скажи прямо, не выдумывай.

## Начни

Прочитай 4 файла сверху. Скажи коротко: что планируешь делать первым и почему. Если по ходу чтения всплывут вопросы — задай текстом. Если всё понятно — погнали F-011.
