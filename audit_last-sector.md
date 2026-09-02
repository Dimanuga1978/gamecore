🔴 КРИТИЧЕСКИЕ ПРОБЛЕМЫ (P0)
1. game.js — прямая мутация structuredClone без защиты от циклических ссылок
Файл: games/last-sector/src/game.js, строка 15

javascript
function clone(v) { return structuredClone(v); }
Проблема: Функция clone используется для копирования состояния игры, но она не обрабатывает ошибки. Если в состоянии окажется циклическая ссылка, structuredClone выбросит исключение, и весь процесс упадёт. Учитывая, что Last Sector использует Map и Set, риск возникновения циклических структур в состоянии высок.
Почему это P0: Это критическая DoS-уязвимость. Злоумышленник может отправить действие, которое приведёт к созданию циклической ссылки в состоянии, и положить весь матч.
Исправление:

javascript
function clone(v) {
  try {
    return structuredClone(v);
  } catch {
    // В случае ошибки клонирования, возвращаем null или выбрасываем понятное исключение
    throw new Error('Failed to clone game state');
  }
}
2. game.js — legacyRandom.shuffle мутирует исходный массив
Файл: games/last-sector/src/game.js, строки 22-24

javascript
shuffle(items) {
  if (!Array.isArray(items)) throw new TypeError('shuffle requires an array');
  for (let i=items.length-1; i>0; i--) {
    const j = rng.int(0,i); [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
Проблема: Метод shuffle изменяет (мутирует) переданный массив на месте. Это прямое нарушение принципа детерминизма и иммутабельности, на котором построен движок. Если этот метод используется для перемешивания колоды или списка игроков в applyAction, это приведет к непредсказуемым и недетерминированным состояниям.
Почему это P0: Это нарушает фундаментальный контракт движка. Результат игры становится невоспроизводимым.
Исправление: Метод должен возвращать новый массив, не изменяя исходный.

javascript
shuffle(items) {
  if (!Array.isArray(items)) throw new TypeError('shuffle requires an array');
  const newItems = [...items]; // Создаем копию
  for (let i = newItems.length-1; i>0; i--) {
    const j = rng.int(0,i);
    [newItems[i], newItems[j]] = [newItems[j], newItems[i]];
  }
  return newItems;
}
3. game.js — отсутствует валидация action.actor
Файл: games/last-sector/src/game.js, строка 39

javascript
actor: action?.actor,
Проблема: В функции buildContext значение action.actor используется без какой-либо проверки. Если в action не будет поля actor или оно будет иметь неверный тип, это может привести к падению легаси-кода, который ожидает валидный идентификатор игрока.
Почему это P0: Это DoS-уязвимость. Злоумышленник может отправить действие без actor и положить матч.
Исправление: Добавить строгую валидацию в начале applyAction или applyActionInPlace.

javascript
// В applyAction или applyActionInPlace
if (!action || typeof action.actor !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(action.actor)) {
  throw new Error('Invalid actor');
}
4. game.js — утечка PRIVATE_EVENTS в публичные события
Файл: games/last-sector/src/game.js, строки 11-14

javascript
const PRIVATE_EVENTS = new Set(['SHIP_MOVED','RESOURCE_COLLECTED', ...]);
Проблема: Список PRIVATE_EVENTS определяет события, которые не должны быть видны всем игрокам. Однако в коде нет механизма, который бы гарантированно фильтровал эти события для зрителей или противников. Если легаси-код генерирует такое событие, оно может попасть в общий поток и раскрыть скрытую информацию.
Почему это P0: Это прямая утечка приватной информации, что нарушает контракт getPlayerView.
Исправление: Необходимо явно реализовать фильтрацию событий на основе audience в applyActionInPlace или в адаптере, который обрабатывает события из легаси-кода.

🟠 ВАЖНЫЕ ПРОБЛЕМЫ (P1)
5. game.js — normalizePlayers не проверяет options.shipTypes на валидность
Файл: games/last-sector/src/game.js, строки 31-35

javascript
function buildPlayerMeta(players, options) {
  const ids = normalizePlayers(players);
  const shipTypes = options?.shipTypes || options?.playerShipTypes || {};
  return Object.fromEntries(ids.map((id, i) => {
    const configured = Array.isArray(shipTypes) ? shipTypes[i] : shipTypes[id];
    return [id, { id, shipType: configured || ['scout','transport','warship'][i % 3], eliminated:false }];
  }));
}
Проблема: Функция не проверяет, что переданный тип корабля (shipType) является валидным. В легаси-коде, вероятно, есть жесткий список допустимых типов (SHIPS). Если передать невалидный тип, это может привести к падению игры.
Почему это P1: Это может привести к падению матча при создании, если клиент передаст неверные данные.
Исправление: Проверять shipType на вхождение в список SHIPS.

6. index.js — hexDistance может выбросить исключение при неверном формате координат
Файл: games/last-sector/src/index.js, строки 40-43

javascript
function hexDistance(a, b) {
  const [aq, ar] = String(a).split(',').map(Number);
  // ...
}
Проблема: Если координаты (a или b) не являются строками в формате "q,r", функция выбросит исключение. Это может привести к падению бота или других частей кода, которые используют эту функцию.
Почему это P1: Потенциальная точка отказа, которая может быть использована для DoS.
Исправление: Добавить проверку ввода.

javascript
function hexDistance(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a.includes(',') || !b.includes(',')) {
    throw new Error('Invalid coordinate format');
  }
  // ...
}
🟡 СРЕДНИЕ ПРОБЛЕМЫ (P2) и 🟢 КОСМЕТИЧЕСКИЕ (P3)
P2 (Средние):

game.js, строка 17: legacyRandom не проверяет rng на валидность. Если передан null или undefined, все методы упадут.

index.js, строка 23: Импорт статического манифеста через with { type: 'json' } может не работать в старых версиях Node.js.

Отсутствие rate limiting: В игре нет защиты от спама действиями, что может привести к перегрузке сервера.

P3 (Косметические):

game.js, строка 3: Импорт createRequire и загрузка .cjs файла — это архитектурный "костыль", который стоит убрать в будущем.

Неиспользуемая константа: ACTIONS в game.js определена, но, возможно, не используется.

📊 ИТОГОВАЯ ОЦЕНКА
Уровень	Количество	Статус
🔴 Критические (P0)	4	Исправить немедленно
🟠 Важные (P1)	2	Исправить в ближайшее время
🟡 Средние (P2)	3	Исправить в плановом порядке
🟢 Косметические (P3)	2	По желанию
🎯 ГЛАВНЫЕ ВЫВОДЫ ПО ИГРЕ
Стратегия миграции через адаптер — это риск. Она позволяет быстро портировать игру, но переносит все старые ошибки и проблемы с детерминизмом в новую систему. Легаси-код (legacy/game.cjs) — это главный источник проблем.

Критические проблемы связаны с мутацией данных. structuredClone без обработки ошибок и shuffle, мутирующий массив — это прямой путь к падению сервера и недетерминированному поведению.

Безопасность хромает. Отсутствие валидации actor и потенциальная утечка приватных событий делают игру уязвимой для атак.

🔧 ПЛАН ИСПРАВЛЕНИЙ (ПРИОРИТЕТ 1)
Обернуть structuredClone в try...catch в функции clone().

Переписать legacyRandom.shuffle так, чтобы он возвращал новый массив, а не мутировал старый.

Добавить валидацию action.actor в начале обработки действия.

Реализовать фильтрацию PRIVATE_EVENTS на уровне адаптера, чтобы они не попадали в общий эфир.

Я рекомендую после исправления этих проблем провести повторный аудит, особенно в части взаимодействия с legacy/game.cjs.
