const DIR = { N:[0,-1], S:[0,1], E:[1,0], W:[-1,0] };
const inside = (p) => p.x >= 0 && p.x < 5 && p.y >= 0 && p.y < 5;
// The OTHER player in this genuinely, inherently 2-player game (combat
// targets "the other player", a binary toggle -- not something this fix
// generalizes to N players, since that would change real game rules,
// not just id assignment). Looked up dynamically from the real
// state.players keys, not hardcoded to literal 'A'/'B' -- a real,
// confirmed bug found via audit: createInitialState() used to ignore
// whatever real player ids a match was actually created with, always
// assigning literal 'A'/'B' regardless. A match created with real
// participant ids like ['Alice','Bob'] (matching match.players exactly,
// as every other engine-fixture game already correctly does) ended up
// with state.players keyed 'A'/'B' instead -- getLegalActions(state,
// 'Alice') always returned [] (since 'Alice' !== state.activePlayer,
// which was hardcoded 'A'), meaning the real participant could never
// take a single legal action; confirmed directly, not assumed:
// dispatchMatchAction for 'Alice' returned ILLEGAL_ACTION unconditionally.
const other = (state, id) => Object.keys(state.players).find(p => p !== id);
export const gridDuel = {
  version: 'grid-duel@1',
  createInitialState({ players = ['A', 'B'] } = {}) {
    const ids = players.map(p => typeof p === 'string' ? p : p.id);
    const [a, b] = ids;
    return { turn:0, activePlayer:a, phase:'playing', winner:null, players:{ [a]:{id:a,hp:3,position:{x:0,y:0}}, [b]:{id:b,hp:3,position:{x:4,y:4}} } };
  },
  getLegalActions(state, actor) { if (state.phase !== 'playing' || actor !== state.activePlayer) return []; return [{type:'MOVE'}, {type:'ATTACK'}]; },
  applyAction(state, action, context = {}) { return this.applyActionInPlace(structuredClone(state), action, context); },
  applyActionInPlace(state, action) {
    const s = state; const actor = s.players[action.actor]; const events=[];
    if (action.type === 'MOVE') {
      const d = DIR[action.direction]; if (!d) return { state:s, events:[{type:'ACTION_REJECTED',code:'INVALID_DIRECTION'}] };
      const to={x:actor.position.x+d[0],y:actor.position.y+d[1]};
      if (!inside(to)) return { state:s, events:[{type:'ACTION_REJECTED',code:'OUT_OF_BOUNDS'}] };
      if (Object.values(s.players).some(p=>p.id!==actor.id&&p.position.x===to.x&&p.position.y===to.y)) return { state:s, events:[{type:'ACTION_REJECTED',code:'OCCUPIED'}] };
      const from=actor.position; actor.position=to; events.push({type:'PLAYER_MOVED',actor:action.actor,from,to});
    } else if (action.type === 'ATTACK') {
      const target=s.players[other(s, action.actor)]; const dist=Math.abs(actor.position.x-target.position.x)+Math.abs(actor.position.y-target.position.y);
      if (dist!==1) return { state:s, events:[{type:'ACTION_REJECTED',code:'TARGET_NOT_ADJACENT'}] };
      target.hp--; events.push({type:'PLAYER_ATTACKED',actor:action.actor,target:target.id,damage:1});
      if (target.hp<=0) { s.phase='finished'; s.winner=action.actor; events.push({type:'GAME_FINISHED',winner:action.actor}); return {state:s,events}; }
    }
    s.turn++; s.activePlayer=other(s, action.actor); events.push({type:'TURN_CHANGED',activePlayer:s.activePlayer}); return {state:s,events};
  },
  getGameStatus(state) { return { finished:state.phase==='finished', winner:state.winner }; }
};
