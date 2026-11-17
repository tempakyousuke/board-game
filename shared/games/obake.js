// おばけ神経衰弱 — おばけがカードを入れかえてしまう神経衰弱 (2〜6人)
//
// ・ふつうの神経衰弱と同じく、2枚めくって同じ絵ならもらえて、もう一度めくれる。
// ・👑 と 💎 のペアは3点。🔍 のペアをとると、裏のカードを1枚こっそりのぞける。
// ・👻 おばけをめくったら、その番はおしまい。おばけは裏のカードを巻きこんで場所を入れかえる。
//   おばけは2回いたずらをすると、満足して帰っていく (カードがなくなる)。
// ・ペアがすべてなくなったら終了。点の高い人の勝ち。
//
// めくったカードを全員が見る時間が要るので、はずれやおばけのあとは timer() で少し待ってから進める。

import { assert, makeResult } from './common.js';
import { randInt, shuffle } from '../rng.js';

export const meta = {
  id: 'obake',
  name: 'おばけ神経衰弱',
  emoji: '👻',
  tagline: 'おぼえたはずのカードが…？おばけがこっそり入れかえる神経衰弱',
  minPlayers: 2,
  maxPlayers: 6,
  time: '5〜10分',
  tags: ['わいわい', 'きおく', 'だれでも'],
};

export const COLS = 6;
export const MISS_MS = 1600;
export const GHOST_MS = 2000;
export const GOLD_POINTS = 3;
export const GHOST_PRANKS = 2; // おばけ1枚がいたずらできる回数

/** カードの絵。points はペアをとったときの点。 */
export const FACES = {
  ringo: { emoji: '🍎', points: 1 },
  lemon: { emoji: '🍋', points: 1 },
  budo: { emoji: '🍇', points: 1 },
  momo: { emoji: '🍑', points: 1 },
  kiwi: { emoji: '🥝', points: 1 },
  banana: { emoji: '🍌', points: 1 },
  suika: { emoji: '🍉', points: 1 },
  sakuranbo: { emoji: '🍒', points: 1 },
  kanmuri: { emoji: '👑', points: GOLD_POINTS },
  houseki: { emoji: '💎', points: GOLD_POINTS },
  megane: { emoji: '🔍', points: 1 },
  obake: { emoji: '👻', points: 0 },
};
const PAIR_FACES = Object.keys(FACES).filter((f) => f !== 'obake');
// おばけは2枚。あと何回いたずらできるかを1枚ずつ数えるので、中では別々の名前で持つ
// (画面にはどちらも同じ「おばけ」として見せる)。
const GHOST_FACES = ['obake:a', 'obake:b'];
const isGhost = (face) => face.startsWith('obake');
const publicFace = (face) => (isGhost(face) ? 'obake' : face);

export function setup({ n, rng, config = {} }) {
  const faces = shuffle(rng, [...PAIR_FACES, ...PAIR_FACES, ...GHOST_FACES]);
  return {
    n,
    cards: faces.map((face) => ({ face, state: 'down', owner: -1 })), // state: down / up / gone
    turn: randInt(rng, n),
    phase: 'flip', // flip: めくる / miss: はずれを見せている / ghost: おばけを見せている / peek: のぞく1枚を選ぶ
    flipped: [],
    points: new Array(n).fill(0),
    taken: Array.from({ length: n }, () => []),
    pranksLeft: Object.fromEntries(GHOST_FACES.map((face) => [face, config.pranks ?? GHOST_PRANKS])),
    peek: null, // { seat, card } 直前にのぞいたカード (絵は本人にだけ見せる)
    // CPU 用の記憶。席ごとに「この場所はこの絵だった」を覚えておく (ときどき忘れる)。
    memory: Array.from({ length: n }, () => ({})),
    event: null,
    eventId: 0,
    over: false,
    result: null,
  };
}

function note(state, event) {
  state.eventId++;
  state.event = { id: state.eventId, ...event };
}

/** 全員がカードを見たので、それぞれの記憶に残す。CPU はときどき覚えそこなう。 */
function witness(state, card, rng) {
  for (let s = 0; s < state.n; s++) {
    if (rng() < 0.78) state.memory[s][card] = publicFace(state.cards[card].face);
  }
}

function forget(state, cards) {
  for (const memory of state.memory) for (const card of cards) delete memory[card];
}

function nextTurn(state) {
  state.turn = (state.turn + 1) % state.n;
  state.flipped = [];
  state.phase = 'flip';
}

function pairsLeft(state) {
  return state.cards.some((c) => c.state !== 'gone' && !isGhost(c.face));
}

export function act(state, seat, action, rng) {
  assert(!state.over, 'ゲームは終了しています');
  assert(action && typeof action.type === 'string', '不明な操作です');
  assert(seat === state.turn, 'あなたの番ではありません');
  const index = action.card;
  assert(Number.isInteger(index) && index >= 0 && index < state.cards.length, 'カードを選んでください');
  const card = state.cards[index];
  assert(card.state === 'down', 'そのカードは選べません');

  if (action.type === 'peek') {
    assert(state.phase === 'peek', 'いまはのぞけません');
    state.peek = { seat, card: index };
    state.memory[seat][index] = publicFace(card.face);
    state.phase = 'flip';
    note(state, { type: 'peek', seat, card: index });
    return;
  }

  assert(action.type === 'flip', '不明な操作です');
  assert(state.phase === 'flip', 'いまはめくれません');
  state.peek = null;
  card.state = 'up';
  state.flipped.push(index);
  witness(state, index, rng);

  if (isGhost(card.face)) {
    state.phase = 'ghost';
    note(state, { type: 'ghost', seat, card: index });
    return;
  }
  if (state.flipped.length < 2) {
    note(state, { type: 'flip', seat, card: index });
    return;
  }

  const [first, second] = state.flipped;
  if (state.cards[first].face !== card.face) {
    state.phase = 'miss';
    note(state, { type: 'miss', seat, cards: [first, second] });
    return;
  }

  // そろった！
  for (const i of [first, second]) {
    state.cards[i].state = 'gone';
    state.cards[i].owner = seat;
  }
  forget(state, [first, second]);
  state.points[seat] += FACES[card.face].points;
  state.taken[seat].push(card.face);
  state.flipped = [];
  note(state, { type: 'match', seat, face: card.face, cards: [first, second] });

  if (!pairsLeft(state)) {
    state.over = true;
    state.result = makeResult(state.points.slice(), { unit: '点', tiebreak: state.taken.map((t) => t.length) });
    return;
  }
  // 🔍 をとったら、裏のカードを1枚のぞける。そのあと続けてめくる。
  if (card.face === 'megane') state.phase = 'peek';
}

/** はずれやおばけを見せ終わったあとの処理。 */
export function tick(state, rng) {
  if (state.over) return;
  if (state.phase === 'miss') {
    for (const i of state.flipped) state.cards[i].state = 'down';
    nextTurn(state);
    return;
  }
  if (state.phase === 'ghost') {
    for (const i of state.flipped) state.cards[i].state = 'down';
    const ghost = state.flipped[state.flipped.length - 1];
    const ghostFace = state.cards[ghost].face;
    // おばけは、裏向きのカード2枚を巻きこんで場所を入れかえる。
    const others = shuffle(
      rng,
      state.cards.map((_, i) => i).filter((i) => i !== ghost && state.cards[i].state === 'down'),
    ).slice(0, 2);
    state.pranksLeft[ghostFace]--;
    const leaving = state.pranksLeft[ghostFace] <= 0;
    let cells;
    if (leaving) {
      // 最後のいたずら: 2枚を入れかえて、おばけは帰っていく。
      state.cards[ghost].state = 'gone';
      cells = others;
      if (others.length === 2) {
        const [a, b] = others;
        [state.cards[a].face, state.cards[b].face] = [state.cards[b].face, state.cards[a].face];
      }
    } else {
      // おばけも入れて3枚をぐるっとまわす。3枚とも元の場所には残らない。
      cells = [ghost, ...others];
      const faces = cells.map((i) => state.cards[i].face);
      const shift = cells.length === 3 && rng() < 0.5 ? 2 : 1;
      cells.forEach((cell, k) => {
        state.cards[cell].face = faces[(k + shift) % cells.length];
      });
    }
    forget(state, [ghost, ...others]);
    const seat = state.turn;
    nextTurn(state);
    note(state, { type: 'shuffle', seat, cells, left: leaving, from: ghost });
  }
}

export function timer(state) {
  if (state.over) return null;
  if (state.phase === 'miss') return { ms: MISS_MS, key: `miss:${state.eventId}` };
  if (state.phase === 'ghost') return { ms: GHOST_MS, key: `ghost:${state.eventId}` };
  return null;
}

export function view(state, seat) {
  const peeking = state.peek && state.peek.seat === seat;
  return {
    n: state.n,
    cols: COLS,
    // 裏向きのカードの絵は送らない。
    cards: state.cards.map((card, i) => ({
      state: card.state,
      owner: card.owner,
      face: card.state !== 'down' || (peeking && state.peek.card === i) ? publicFace(card.face) : null,
    })),
    turn: state.over ? -1 : state.turn,
    phase: state.phase,
    flipped: state.flipped,
    points: state.points,
    taken: state.taken,
    peekCard: state.peek ? state.peek.card : null,
    peekSeat: state.peek ? state.peek.seat : -1,
    event: state.event,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over || state.phase === 'miss' || state.phase === 'ghost') return [];
  return [state.turn];
}

export function bot(state, seat, rng) {
  if (state.over || seat !== state.turn) return null;
  if (state.phase !== 'flip' && state.phase !== 'peek') return null;
  const memory = state.memory[seat];
  const down = state.cards.map((_, i) => i).filter((i) => state.cards[i].state === 'down');
  const unknown = down.filter((i) => !(i in memory));
  const pickFrom = (list) => list[randInt(rng, list.length)];

  if (state.phase === 'peek') {
    return { type: 'peek', card: pickFrom(unknown.length ? unknown : down) };
  }

  if (state.flipped.length === 1) {
    // 1枚目と同じ絵の場所を覚えていれば、それをめくる。
    const face = publicFace(state.cards[state.flipped[0]].face);
    const partner = down.find((i) => memory[i] === face);
    if (partner !== undefined) return { type: 'flip', card: partner };
    // おばけだと覚えている場所は避ける。
    const safe = unknown.length ? unknown : down.filter((i) => memory[i] !== 'obake');
    return { type: 'flip', card: pickFrom(safe.length ? safe : down) };
  }

  // 両方の場所を覚えているペアがあれば、それをとる。
  const seen = {};
  for (const i of down) {
    const face = memory[i];
    if (!face || face === 'obake') continue;
    if (face in seen) return { type: 'flip', card: seen[face] };
    seen[face] = i;
  }
  const safe = unknown.length ? unknown : down.filter((i) => memory[i] !== 'obake');
  return { type: 'flip', card: pickFrom(safe.length ? safe : down) };
}
