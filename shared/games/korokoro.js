// コロコロガーデン — サイコロで花を植えるチキンレース (2〜5人)
//
// ・6×6 の花壇。サイコロ2個の目が「行」と「列」になる (3と5なら「3行5列」か「5行3列」)。
// ・ふるたびに、どちらかのマスに種をまく。相手の花のマスにまけば、うばい取れる。
// ・ただし同じ番のあいだは、種をまいた行と列にはもうまけない。自分の花のマスにもまけない。
// ・どちらのマスにもまけない目が出たら「しっぱい」。その番にまいた種はすべて消える。
// ・やめると宣言すれば、種が花になって自分のものになる。
// ・得点 = 花の数 + いちばん大きな「つながり」の花の数。

import { assert, makeResult } from './common.js';
import { randInt } from '../rng.js';

export const meta = {
  id: 'korokoro',
  name: 'コロコロガーデン',
  emoji: '🌷',
  tagline: 'もう1回ふる？やめる？欲ばりすぎると種が全部パー',
  minPlayers: 2,
  maxPlayers: 5,
  time: '10〜15分',
  tags: ['わいわい', '運だめし', 'チキンレース'],
};

export const SIZE = 6;
const ROUNDS_BY_PLAYERS = { 2: 10, 3: 7, 4: 6, 5: 5 };
const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function setup({ n, rng }) {
  const start = randInt(rng, n);
  return {
    n,
    round: 1,
    maxRounds: ROUNDS_BY_PLAYERS[n],
    start,
    order: roundOrder(n, start, 1),
    step: 0,
    turn: start,
    owner: new Array(SIZE * SIZE).fill(-1),
    temp: [],
    dice: null,
    options: [],
    phase: 'roll', // roll: ふるか、やめるか / place: どちらにまくか選ぶ
    event: null,
    eventId: 0,
    over: false,
    result: null,
  };
}

/** いまの種の置き方で、(a, b) の目が出たときにまけるマスの一覧。 */
export function optionsFor(owner, temp, seat, a, b) {
  const rows = new Set(temp.map((i) => Math.floor(i / SIZE)));
  const cols = new Set(temp.map((i) => i % SIZE));
  const out = [];
  const pairs = a === b ? [[a, b]] : [[a, b], [b, a]];
  for (const [r1, c1] of pairs) {
    const r = r1 - 1;
    const c = c1 - 1;
    const cell = r * SIZE + c;
    if (owner[cell] === seat) continue;
    if (rows.has(r) || cols.has(c)) continue;
    out.push(cell);
  }
  return out;
}

/** 次にふったとき「しっぱい」になる確率。 */
export function bustChance(owner, temp, seat) {
  let bust = 0;
  for (let a = 1; a <= SIZE; a++) {
    for (let b = 1; b <= SIZE; b++) {
      if (optionsFor(owner, temp, seat, a, b).length === 0) bust++;
    }
  }
  return bust / (SIZE * SIZE);
}

export function largestGroups(owner, n) {
  const best = new Array(n).fill(0);
  const seen = new Array(owner.length).fill(false);
  for (let i = 0; i < owner.length; i++) {
    if (seen[i] || owner[i] < 0) continue;
    const who = owner[i];
    let size = 0;
    const stack = [i];
    seen[i] = true;
    while (stack.length) {
      const cur = stack.pop();
      size++;
      const r = Math.floor(cur / SIZE);
      const c = cur % SIZE;
      for (const [dr, dc] of NEIGHBORS) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) continue;
        const next = rr * SIZE + cc;
        if (!seen[next] && owner[next] === who) {
          seen[next] = true;
          stack.push(next);
        }
      }
    }
    if (size > best[who]) best[who] = size;
  }
  return best;
}

export function scoreBoard(owner, n) {
  const flowers = new Array(n).fill(0);
  for (const o of owner) if (o >= 0) flowers[o]++;
  const groups = largestGroups(owner, n);
  return {
    flowers,
    groups,
    total: flowers.map((f, s) => f + groups[s]),
  };
}

function pushEvent(state, event) {
  state.eventId++;
  state.event = { id: state.eventId, ...event };
}

/** そのラウンドの手番順。最後に動く人が有利なので、スタートプレイヤーを毎ラウンド1人ずつずらす。 */
export function roundOrder(n, start, round) {
  return Array.from({ length: n }, (_, k) => (start + round - 1 + k) % n);
}

function endTurn(state) {
  state.temp = [];
  state.dice = null;
  state.options = [];
  state.phase = 'roll';
  state.step++;
  if (state.step >= state.n) {
    if (state.round >= state.maxRounds) {
      state.over = true;
      const board = scoreBoard(state.owner, state.n);
      state.result = makeResult(board.total, { unit: '点', detail: board });
      return;
    }
    state.round++;
    state.step = 0;
    state.order = roundOrder(state.n, state.start, state.round);
  }
  state.turn = state.order[state.step];
}

function bank(state, seat) {
  const stolen = [];
  for (const cell of state.temp) {
    if (state.owner[cell] >= 0) stolen.push({ cell, from: state.owner[cell] });
    state.owner[cell] = seat;
  }
  pushEvent(state, { type: 'bank', seat, cells: state.temp.slice(), stolen });
  endTurn(state);
}

export function act(state, seat, action, rng) {
  assert(!state.over, 'ゲームは終了しています');
  assert(action && typeof action.type === 'string', '不明な操作です');
  assert(seat === state.turn, 'あなたの番ではありません');

  if (action.type === 'roll') {
    assert(state.phase === 'roll', '先に種をまくマスを選んでください');
    const a = 1 + randInt(rng, SIZE);
    const b = 1 + randInt(rng, SIZE);
    const options = optionsFor(state.owner, state.temp, seat, a, b);
    if (options.length === 0) {
      pushEvent(state, { type: 'bust', seat, dice: [a, b], lost: state.temp.slice() });
      endTurn(state);
      return;
    }
    state.dice = [a, b];
    state.options = options;
    state.phase = 'place';
    return;
  }

  if (action.type === 'place') {
    assert(state.phase === 'place', '先にサイコロをふってください');
    assert(state.options.includes(action.cell), 'そのマスにはまけません');
    state.temp.push(action.cell);
    state.options = [];
    state.phase = 'roll';
    // 6つまいたら行も列も使い切るので、自動で確定する。
    if (state.temp.length >= SIZE) bank(state, seat);
    return;
  }

  if (action.type === 'bank') {
    assert(state.phase === 'roll', '先に種をまくマスを選んでください');
    assert(state.temp.length > 0, 'まだ種をまいていません');
    bank(state, seat);
    return;
  }

  assert(false, '不明な操作です');
}

export function view(state) {
  const board = scoreBoard(state.owner, state.n);
  const active = !state.over;
  return {
    n: state.n,
    size: SIZE,
    round: state.round,
    maxRounds: state.maxRounds,
    turn: active ? state.turn : -1,
    order: state.order,
    step: state.step,
    owner: state.owner,
    temp: state.temp,
    dice: state.dice,
    options: state.options,
    phase: state.phase,
    risk: active && state.phase === 'roll' ? bustChance(state.owner, state.temp, state.turn) : null,
    event: state.event,
    flowers: board.flowers,
    groups: board.groups,
    scores: board.total,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  return state.over ? [] : [state.turn];
}

export function bot(state, seat, rng) {
  if (state.phase === 'place') {
    const board = scoreBoard(state.owner, state.n);
    let best = state.options[0];
    let bestScore = -Infinity;
    for (const cell of state.options) {
      let score = rng() * 0.5;
      const victim = state.owner[cell];
      // 点数の高い相手からうばうほどおいしい。
      if (victim >= 0) score += 1 + board.total[victim] * 0.1;
      const r = Math.floor(cell / SIZE);
      const c = cell % SIZE;
      for (const [dr, dc] of NEIGHBORS) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) continue;
        const next = rr * SIZE + cc;
        if (state.owner[next] === seat || state.temp.includes(next)) score += 0.8;
      }
      if (score > bestScore) {
        bestScore = score;
        best = cell;
      }
    }
    return { type: 'place', cell: best };
  }

  if (state.temp.length === 0) return { type: 'roll' };
  const risk = bustChance(state.owner, state.temp, seat);
  // 失うもの (まいた種) と得るもの (あと1つ) を比べて、割に合うときだけ続ける。
  const lose = risk * state.temp.length * 1.4;
  const gain = (1 - risk) * 1.4;
  const lastTurn = state.round >= state.maxRounds;
  const bold = lastTurn ? 0.8 : 1;
  return gain > lose * bold + (rng() - 0.5) * 0.3 ? { type: 'roll' } : { type: 'bank' };
}
