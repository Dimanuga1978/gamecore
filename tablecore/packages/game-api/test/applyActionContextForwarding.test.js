import test from 'node:test';
import assert from 'node:assert/strict';
import { gridDuel } from '@tablecore/game-grid-duel';
import { coinRace } from '@tablecore/game-coin-race';
import { phaseQuest } from '@tablecore/game-phase-quest';
import { sectorExpedition } from '@tablecore/game-sector-expedition';
import { lastSector } from '@tablecore/game-last-sector';

// A real, external audit found that games/last-sector's own applyAction()
// (part of the GameDefinition contract's own declared entry point --
// packages/core/src/runAction.js's canonical dispatcher calls
// `game.applyAction(workingState, safeAction, context)`, THREE
// arguments) silently dropped whatever real `context` (rng, seed) it
// was actually given, hardcoding an empty {} instead of forwarding it --
// breaking EVERY legal action when applyAction() was called directly,
// since applyActionInPlace unconditionally requires context.rng.
//
// Investigating that finding further (not just fixing the one reported
// instance) found the exact same class of bug, LATENT rather than
// actively broken, in three of the four other shipped games:
// grid-duel/coin-race/phase-quest's own applyAction() also only declared
// two parameters and never forwarded a third `context` argument at all --
// harmless TODAY only because none of their own applyActionInPlace
// implementations happen to read anything from context yet. The moment
// any of them added real randomness (a plausible, ordinary game-design
// change), calling applyAction() directly would have broken in exactly
// the same way last-sector's did, with no engine-level test anywhere to
// have caught it before shipping. sector-expedition already had this
// right (accepts and forwards context) -- it was the model this generic,
// contract-level test (and the other three games' fixes) is built to
// match, applied automatically to every registered game rather than
// requiring a human to remember to check it per-game as each pack is
// authored or modified.
const REAL_GAMES = [
  ['grid-duel', gridDuel],
  ['coin-race', coinRace],
  ['phase-quest', phaseQuest],
  ['sector-expedition', sectorExpedition],
  ['last-sector', lastSector],
];

for (const [name, game] of REAL_GAMES) {
  test(`${name}: applyAction() accepts a third context argument without throwing, matching runAction.js's own real 3-argument call signature`, () => {
    const state = game.createInitialState({ players: ['A', 'B'], seed: 1 });
    assert.ok(game.applyAction.length >= 2, `${name}.applyAction must declare at least (state, action) -- found arity ${game.applyAction.length}`);
    assert.doesNotThrow(() => {
      const legal = game.getLegalActions(state, 'A')[0] ?? { type: '__PROBE__', actor: 'A' };
      game.applyAction(state, { ...legal, actor: legal.actor ?? 'A' }, { rng: { next: () => 0.5, int: () => 0, getState: () => ({}) }, seed: 1 });
    }, `${name}.applyAction must not throw when given a real context object -- if it drops the third argument rather than forwarding it, a game whose applyActionInPlace requires context (like last-sector's own context.rng requirement) would fail here`);
  });

  test(`${name}: applyAction() actually forwards the third context argument it was given down to applyActionInPlace -- verified via a spy that records the REAL received argument, not by behavioral comparison (which is vacuously true for any game whose applyActionInPlace happens not to read anything from context yet, the exact trap this bug hid in for three of these five games)`, () => {
    const state = game.createInitialState({ players: ['A', 'B'], seed: 1 });
    const legal = game.getLegalActions(state, 'A')[0];
    if (!legal) return;
    const sentinelContext = { rng: { next: () => 0.5, int: () => 0, getState: () => ({}) }, seed: 1, __sentinel: Symbol('forwarded-context-marker') };
    const spiedGame = Object.create(game);
    let capturedContext = undefined;
    let callCount = 0;
    spiedGame.applyActionInPlace = function (s, a, c) { callCount++; capturedContext = c; return game.applyActionInPlace(s, a, c); };
    spiedGame.applyAction(structuredClone(state), legal, sentinelContext);
    assert.equal(callCount, 1, `${name}.applyAction must call applyActionInPlace exactly once`);
    assert.ok(capturedContext, `${name}.applyAction must call applyActionInPlace WITH a context argument at all, not omit it entirely`);
    assert.equal(capturedContext.__sentinel, sentinelContext.__sentinel, `${name}.applyAction must forward the EXACT context object it was given (or one carrying the same real data) down to applyActionInPlace -- a Symbol marker survives structural cloning failures/mismatches that a plain deepEqual on the whole object could miss, and catches the real bug (a hardcoded {} that drops the caller's real context) regardless of whether this game's own applyActionInPlace happens to read anything from it`);
  });
}
