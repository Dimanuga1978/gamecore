🚨 ЖЕСТКИЙ АУДИТ КОДА: @tablecore/core И @tablecore/game-api
Я провел максимально глубокий и агрессивный ревизию кода. Хорошие новости: архитектура продумана, детерминизм — на первом месте, а многие уязвимости уже исправлены (судя по комментариям, вы провели серьезную работу). Плохие новости: код все еще содержит критические проблемы, которые в продакшене приведут к падению сервера, утечке данных и DoS-атакам.

Ниже — беспощадный разбор каждого проблемного места с указанием, почему это критично и как именно исправить.

🔴 КРИТИЧЕСКИЕ ПРОБЛЕМЫ (P0) — ИСПРАВИТЬ НЕМЕДЛЕННО
1. runAction() — ОТСУТСТВУЕТ ВАЛИДАЦИЯ ACTION.ACTOR
Файл: packages/core/src/runAction.js

javascript
export function runAction({ game, state, action, context = {} }) {
  // ...
  const legal = game.getLegalActions?.(state, action.actor) ?? [];
  const isLegal = legal.some(a => a && a.type === action.type);
  // ...
}
Проблема: action.actor никогда не проверяется на валидность. Это может быть null, undefined, число, объект или строка, не соответствующая PLAYER_ID_RE. Если игра ожидает строку, а получает null — getLegalActions упадет, и весь матч рухнет.

Почему это P0: Это DoS-уязвимость. Злоумышленник может отправить действие с actor: null и положить матч.

Как исправить:

javascript
// В начале runAction():
if (!action.actor || typeof action.actor !== 'string' || !PLAYER_ID_RE.test(action.actor)) {
  return { ok: false, error: { code: 'INVALID_ACTOR' } };
}
2. runAction() — ИСПОЛЬЗУЕТ structuredClone(action) БЕЗ ПРОВЕРКИ НА ЦИКЛИЧЕСКИЕ ССЫЛКИ
Файл: packages/core/src/runAction.js

javascript
const safeAction = structuredClone(action);
Проблема: Если action содержит циклическую ссылку, structuredClone() выбросит DataCloneError. Это положит весь процесс — никакой try-catch не спасет, потому что ошибка происходит до него.

Почему это P0: Злоумышленник может отправить action с циклической структурой и убить сервер.

Как исправить:

javascript
let safeAction;
try {
  safeAction = structuredClone(action);
} catch {
  return { ok: false, error: { code: 'INVALID_ACTION' } };
}
3. runAction() — НЕТ ВАЛИДАЦИИ action.type
Файл: packages/core/src/runAction.js

javascript
if (!action || typeof action.type !== 'string') return { ok:false, error:{ code:'INVALID_ACTION' } };
Проблема: Проверяется только что type — строка. Но не проверяется, что это не пустая строка, не строка из 100500 символов, не строка с управляющими символами.

Почему это P0: Это может привести к:

ReDoS (если type используется в регулярках внутри игры)

Переполнению памяти (огромный type будет храниться в логах и событиях)

Инъекциям (если type где-то интерполируется)

Как исправить:

javascript
if (!action || typeof action.type !== 'string' || action.type.length === 0 || action.type.length > 64) {
  return { ok: false, error: { code: 'INVALID_ACTION' } };
}
if (!/^[A-Za-z0-9_:-]+$/.test(action.type)) {
  return { ok: false, error: { code: 'INVALID_ACTION' } };
}
4. startMatch() — ПЕРЕДАЕТ match.seed В createInitialState() БЕЗ КОНТРОЛЯ
Файл: packages/core/src/match/createMatch.js

javascript
const state = game.createInitialState({
  ...match.options,
  ...stripReservedContextFields(context),
  players: match.players
});
Проблема: match.seed передается в игру через match.options. Если игра использует этот seed для генерации начального состояния (например, тасовки колоды), seed оказывается в состоянии. А состояние — в снапшоте, который уходит клиенту.

Почему это P0: Это утечка seed-а, которую вы уже зафиксировали в audit-poc/poc_seed_leak.mjs. Злоумышленник, получив seed, может предсказывать все будущие случайные события.

Как исправить:

javascript
// НЕ передавать seed в createInitialState!
// Вместо этого игра должна использовать RNG, переданный в context.
// А seed хранится ТОЛЬКО в match.
const state = game.createInitialState({
  ...match.options,
  ...stripReservedContextFields(context),
  players: match.players,
  // seed НЕ передается
});
5. dispatchMatchAction() — ПЕРЕДАЕТ match.seed В context
Файл: packages/core/src/match/createMatch.js

javascript
const result = runAction({
  game,
  state: match.state,
  action,
  context: { ...context, rng, seed: match.seed },
});
Проблема: Seed передается в context игры. Если игра по ошибке положит context.seed в событие или состояние — seed утечет.

Почему это P0: Та же утечка seed-а, только через другой канал.

Как исправить:

javascript
// НЕ передавать seed в context.
// Игра должна использовать только rng.
const result = runAction({
  game,
  state: match.state,
  action,
  context: { ...context, rng }, // seed НЕ передается
});
🟠 ВАЖНЫЕ ПРОБЛЕМЫ (P1) — ИСПРАВИТЬ В БЛИЖАЙШЕЕ ВРЕМЯ
6. createMatch() — match.id ГЕНЕРИРУЕТСЯ ЧЕРЕЗ Date.now()
Файл: packages/core/src/match/createMatch.js

javascript
return {
  id: id ?? `match-${Date.now()}`,
  // ...
};
Проблема: Если id не передан, используется Date.now(). Это недетерминированно — нарушает весь смысл движка. Два одинаковых матча, созданные в разное время, получат разные ID.

Почему это P1: Нарушает воспроизводимость и детерминизм. Для replay-системы это катастрофа — нельзя воспроизвести матч, если ID зависит от времени.

Как исправить:

javascript
import { randomBytes } from 'node:crypto';
// ...
return {
  id: id ?? `match-${randomBytes(8).toString('hex')}`,
  // ...
};
7. createMatch() — match.options КЛОНИРУЕТСЯ, НО НЕ ВАЛИДИРУЕТСЯ
Файл: packages/core/src/match/createMatch.js

javascript
options: Object.freeze(clone(options)),
Проблема: options может содержать что угодно — функции, циклические ссылки, огромные объекты. structuredClone() упадет на функциях и циклах.

Почему это P1: DoS-уязвимость при создании матча.

Как исправить:

javascript
// Валидация перед клонированием:
try {
  const safeOptions = structuredClone(options ?? {});
  // Ограничить размер:
  if (JSON.stringify(safeOptions).length > 10000) {
    throw new TypeError('Options too large');
  }
  options: Object.freeze(safeOptions),
} catch {
  throw new TypeError('Invalid options');
}
8. replay.js — ИСПОЛЬЗУЕТ Function#toString() ДЛЯ ХЕШИРОВАНИЯ
Файл: packages/core/src/replay/replay.js

javascript
const RULE_FUNCTION_NAMES = [
  'createInitialState', 'getLegalActions', 'validateAction',
  'applyAction', 'applyActionInPlace', 'getGameStatus',
  'getPlayerView', 'secrets'
];
Проблема: Function#toString() возвращает исходный код функции, включая комментарии и пробелы. Если разработчик добавит комментарий или перенесет строку — хеш изменится, хотя логика осталась той же.

Почему это P1: Ложные срабатывания при проверке replay. Игроки не смогут воспроизвести старые replay после косметических правок кода.

Как исправить:

javascript
// Использовать AST-нормализацию (например, через acorn):
// 1. Парсить функцию в AST.
// 2. Удалить комментарии и нормализовать пробелы.
// 3. Сериализовать AST в канонический вид.
// ИЛИ использовать версию пакета, а не хеш кода.
9. game-api/src/index.js — SEMVER-ПАРСЕР НЕ ПОДДЕРЖИВАЕТ СБОРКИ
Файл: packages/game-api/src/index.js

javascript
function parseSemver(value) {
  const m = String(value ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  // ...
}
Проблема: Не поддерживаются сборки (+build.123). Реальный semver может быть 2.0.0-alpha.1+20260902.

Почему это P1: engineCompatibility может ложно сработать на реальных версиях.

Как исправить:

javascript
// Добавить поддержку build-метаданных:
const m = String(value ?? '').trim().match(
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?/
);
// build-метаданные игнорировать при сравнении, как в semver.
10. createMatch() — spectatorPolicy ПО УМОЛЧАНИЮ 'deny', НО НЕТ MECHANISMА ДЛЯ ЕГО ИЗМЕНЕНИЯ
Файл: packages/core/src/match/createMatch.js

javascript
const SPECTATOR_POLICIES = new Set(['deny', 'public']);
if (!SPECTATOR_POLICIES.has(spectatorPolicy)) {
  throw new TypeError(`spectatorPolicy must be one of ${[...SPECTATOR_POLICIES].join('|')}`);
}
Проблема: Политика задается при создании матча и никогда не меняется. Нет API для добавления зрителей после старта.

Почему это P1: Ограничивает функциональность. Если вы хотите сделать игру с публичным просмотром — нужно пересоздавать матч.

Как исправить:

javascript
// Добавить метод addSpectator(matchId, spectatorId)
// Или разрешить изменение spectatorPolicy через отдельное действие.
🟡 СРЕДНИЕ ПРОБЛЕМЫ (P2) — ИСПРАВИТЬ В ПЛАНОВОМ ПОРЯДКЕ
11. runAction() — НЕТ ЛИМИТА НА КОЛИЧЕСТВО СОБЫТИЙ
Файл: packages/core/src/runAction.js

javascript
nextState = produce(state, draft => {
  mutationResult = game.applyActionInPlace(draft, safeAction, context);
  if (mutationResult && Array.isArray(mutationResult.events)) {
    safeEvents = JSON.parse(JSON.stringify(mutationResult.events));
  }
});
Проблема: Игра может вернуть миллион событий за одно действие. Это приведет к OOM (out of memory).

Почему это P2: DoS-уязвимость, но менее критичная, так как требует специально написанной игры.

Как исправить:

javascript
const MAX_EVENTS_PER_ACTION = 1000;
if (mutationResult.events.length > MAX_EVENTS_PER_ACTION) {
  throw new Error('Too many events');
}
12. createMatch() — MAX_RECENT_MATCH_EVENTS = 100 СЛИШКОМ МАЛО
Файл: packages/core/src/match/createMatch.js

javascript
const MAX_RECENT_MATCH_EVENTS = 100;
Проблема: 100 событий — это очень мало для серьезной игры. Матч может иметь тысячи ходов, а вы храните только последние 100.

Почему это P2: Диагностика и отладка становятся невозможными. Если что-то пошло не на 500-м ходу — у вас нет истории.

Как исправить:

javascript
const MAX_RECENT_MATCH_EVENTS = 1000; // Или сделать конфигурируемым.
// ИЛИ хранить все события, но с ограничением по времени (например, последние 5 минут).
13. SeededRng.js — int() НЕ ПРОВЕРЯЕТ max НА БЕЗОПАСНОСТЬ
Файл: packages/core/src/rng/SeededRng.js

javascript
int(min, max) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new RangeError('Invalid integer range');
  }
  return min + Math.floor(this.next() * (max - min + 1));
}
Проблема: Если max - min + 1 > Number.MAX_SAFE_INTEGER (9e15), то Math.floor() может дать недетерминированный результат из-за потери точности.

Почему это P2: В редких случаях (огромные диапазоны) RNG сломается.

Как исправить:

javascript
const range = max - min + 1;
if (range > Number.MAX_SAFE_INTEGER) {
  throw new RangeError('Range too large');
}
🟢 КОСМЕТИЧЕСКИЕ ПРОБЛЕМЫ (P3)
14. runAction() — ИЗБЫТОЧНОЕ ИСПОЛЬЗОВАНИЕ JSON.parse(JSON.stringify())
Файл: packages/core/src/runAction.js

javascript
safeEvents = JSON.parse(JSON.stringify(mutationResult.events));
Проблема: Это медленно и не работает с Date, Map, Set, BigInt, undefined.

Почему это P3: Работает, но неэффективно и может сломаться на нестандартных данных.

Как исправить:

javascript
// Использовать structuredClone, если доступен:
safeEvents = structuredClone(mutationResult.events);
// Или написать кастомный клонер с поддержкой Map/Set.
15. version.js — ENGINE_VERSION ХАРДКОДИТСЯ
Файл: packages/core/src/version.js

javascript
export const ENGINE_VERSION = 'tablecore-v2-b24';
Проблема: Версия хардкодится в коде. При каждом релизе нужно править этот файл.

Почему это P3: Не критично, но создает лишнюю работу.

Как исправить:

javascript
// Читать из package.json:
import pkg from '../package.json' assert { type: 'json' };
export const ENGINE_VERSION = pkg.version;
📊 ОБЩАЯ ОЦЕНКА
Уровень	Количество	Статус
🔴 P0 (критические)	5	Исправить немедленно
🟠 P1 (важные)	5	Исправить в ближайшее время
🟡 P2 (средние)	3	Исправить в плановом порядке
🟢 P3 (косметические)	2	По желанию
🎯 ГЛАВНЫЕ ВЫВОДЫ
Вы на правильном пути. Архитектура продумана, детерминизм — на первом месте, вы уже исправили много уязвимостей (судя по комментариям).

Но вы доверяете входным данным. action.actor, action.type, action в целом — ничто не валидируется должным образом. Это главная проблема.

Seed все еще утекает. Вы это уже знаете (у вас есть PoC), но исправление до сих пор не реализовано.

Immer-draft проблема. structuredClone() на draft все еще может упасть, если игра попытается его использовать.

Replay-система хороша, но хрупка. Хеширование через toString() — это бомба замедленного действия.

🔧 ЧТО ДЕЛАТЬ В ПЕРВУЮ ОЧЕРЕДЬ
Добавить валидацию action.actor через PLAYER_ID_RE.

Обернуть structuredClone(action) в try-catch.

Убрать seed из context и createInitialState.

Добавить валидацию action.type (длина, допустимые символы).

Заменить Date.now() на детерминированный генератор ID.

После этого можно будет говорить о production-ready коде.
