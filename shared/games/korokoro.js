// コロコロガーデン — サイコロで花を植えるチキンレース (2〜5人)
//
// ・6×6 の花壇。サイコロ2個の目が「行」と「列」になる (3と5なら「3行5列」か「5行3列」)。
// ・ふるたびに、どちらかのマスに種をまく。相手の花のマスにまけば、うばい取れる。
// ・ただし同じ番のあいだは、種をまいた行と列にはもうまけない。自分の花のマスにもまけない。
// ・どちらのマスにもまけない目が出たら「しっぱい」。その番にまいた種はすべて消える。
// ・やめると宣言すれば、種が花になって自分のものになる。
// ・先に花を10個 (5人のときは9個) 咲かせた人が、その場で勝ち。
//
// 以前は「決まったラウンド数を遊んで点を比べる」方式だったが、最後に動く人が
// 「あと何点で逆転か」を見てからふれるぶん有利だった (2人戦で勝率 58%)。
// 先に咲かせた人の勝ちにすれば「最後の番」がなくなる。かわりに先に動く人が少し得をするので、
// 最初の番だけ、まける種の数を手番順に 1つ・2つ・3つ…と制限して釣り合わせている。

import { assert, makeResult } from './common.js';
import { randInt } from '../rng.js';

export const meta = {
  id: 'korokoro',
  name: 'コロコロガーデン',
  emoji: '🌷',
  tagline: 'もう1回ふる？やめる？欲ばりすぎると種が全部パー',
  minPlayers: 2,
  maxPlayers: 5,
  time: '5〜10分',
  tags: ['わいわい', '運だめし', 'チキンレース'],
};

export const SIZE = 6;
/**
 * 勝ちに必要な花の数。5人だと 36 マスを分け合うので、10 個にはうばい合いが長く続く
 * (CPU 同士で1ゲーム約 40 番)。9 個にすると 4 人のときと同じくらいの長さになる。
 */
const TARGET_BY_PLAYERS = { 2: 10, 3: 10, 4: 10, 5: 9 };

export function setup({ n, rng }) {
  const start = randInt(rng, n);
  return {
    n,
    target: TARGET_BY_PLAYERS[n],
    start,
    turn: start,
    turnsTaken: new Array(n).fill(0), // 席ごとの、終えた番の数
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

export function countFlowers(owner, n) {
  const flowers = new Array(n).fill(0);
  for (const o of owner) if (o >= 0) flowers[o]++;
  return flowers;
}

/**
 * この番にまける種の上限。ふだんは 6 (行と列を使い切る数)。
 * 最初の番だけは、手番が早い人ほど少ない (1番手は1つ、2番手は2つ…)。
 */
export function seedCap(state) {
  const seat = state.turn;
  if (state.turnsTaken[seat] > 0) return SIZE;
  const position = (seat - state.start + state.n) % state.n;
  return Math.min(SIZE, position + 1);
}

function pushEvent(state, event) {
  state.eventId++;
  state.event = { id: state.eventId, ...event };
}

function endTurn(state) {
  state.turnsTaken[state.turn]++;
  state.temp = [];
  state.dice = null;
  state.options = [];
  state.phase = 'roll';
  state.turn = (state.turn + 1) % state.n;
}

function bank(state, seat) {
  const stolen = [];
  for (const cell of state.temp) {
    if (state.owner[cell] >= 0) stolen.push({ cell, from: state.owner[cell] });
    state.owner[cell] = seat;
  }
  pushEvent(state, { type: 'bank', seat, cells: state.temp.slice(), stolen });

  const flowers = countFlowers(state.owner, state.n);
  if (flowers[seat] >= state.target) {
    state.over = true;
    state.temp = [];
    state.dice = null;
    state.options = [];
    state.result = makeResult(flowers, { unit: '個', detail: { target: state.target } });
    return;
  }
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
    // 上限までまいたら、自動で花にする。
    if (state.temp.length >= seedCap(state)) bank(state, seat);
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
  const active = !state.over;
  const flowers = countFlowers(state.owner, state.n);
  return {
    n: state.n,
    size: SIZE,
    target: state.target,
    turn: active ? state.turn : -1,
    owner: state.owner,
    temp: state.temp,
    dice: state.dice,
    options: state.options,
    phase: state.phase,
    // この番にまける種の上限 (最初の番だけ少ない)。
    cap: active ? seedCap(state) : SIZE,
    risk: active && state.phase === 'roll' ? bustChance(state.owner, state.temp, state.turn) : null,
    event: state.event,
    flowers,
    scores: flowers,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  return state.over ? [] : [state.turn];
}

export function bot(state, seat, rng) {
  const flowers = countFlowers(state.owner, state.n);

  if (state.phase === 'place') {
    let best = state.options[0];
    let bestScore = -Infinity;
    for (const cell of state.options) {
      let score = rng() * 0.5;
      const victim = state.owner[cell];
      // 花の多い相手からうばうほどおいしい (自分が増えて、相手が減る)。
      if (victim >= 0) score += 1 + flowers[victim] * 0.15;
      if (score > bestScore) {
        bestScore = score;
        best = cell;
      }
    }
    return { type: 'place', cell: best };
  }

  if (state.temp.length === 0) return { type: 'roll' };
  // いまやめれば勝ち、なら迷わずやめる。
  if (flowers[seat] + state.temp.length >= state.target) return { type: 'bank' };

  const risk = bustChance(state.owner, state.temp, seat);
  // 失うもの (まいた種) と得るもの (あと1つ) を比べて、割に合うときだけ続ける。
  const lose = risk * state.temp.length * 1.4;
  const gain = (1 - risk) * 1.4;
  // 相手が勝ちに近いときは、ちまちまやめていても間に合わないので強気にふる。
  const rivalNear = flowers.some((f, s) => s !== seat && f >= state.target - 3);
  const bold = rivalNear ? 0.6 : 1;
  return gain > lose * bold + (rng() - 0.5) * 0.3 ? { type: 'roll' } : { type: 'bank' };
}
