// おかえりヒツジ — 全員で牧羊犬を動かしてヒツジを小屋へ帰す協力ゲーム (1〜4人)
//
// ・毎ラウンド、すべての犬が1回ずつ動く (3歩まで。その場で「ほえる」こともできる)。動く順番は自由。
// ・犬が止まったとき、そのまわり8マスにいるヒツジは、犬と反対の方向へ2マス逃げる。
//   壁にぶつかったら広いほうへ曲がり、壁ぞいに走る。ほかの動物にぶつかったら止まる。
// ・小屋のマスに入ったヒツジは「おかえり」。もう逃げない。岩は犬もヒツジも通れない。
// ・ラウンドの終わりに、そばに犬がいないヒツジは、ふらふらと1マス歩く (下へ行きがち)。
// ・日が暮れる (ラウンドが尽きる) までに全部のヒツジを小屋に入れられたら、全員の勝ち。

import { assert, makeTeamResult } from './common.js';
import { randInt, shuffle } from '../rng.js';

export const meta = {
  id: 'hitsuji',
  name: 'おかえりヒツジ',
  emoji: '🐑',
  tagline: 'みんなで犬を動かして、日が暮れる前にヒツジを小屋へ！協力ゲーム',
  minPlayers: 1,
  maxPlayers: 4,
  time: '10〜15分',
  tags: ['協力', 'じっくり', '相談'],
};

export const SIZE = 7;
export const DOG_STEPS = 3;
export const FLEE_STEPS = 2;

/** 人数ごとの設定。犬が多いほど楽になるので、ヒツジを増やして日を短くする。 */
const SETUPS = {
  1: { dogs: 2, sheep: 5, rounds: 8, rocks: 3 },
  2: { dogs: 2, sheep: 5, rounds: 8, rocks: 3 },
  3: { dogs: 3, sheep: 7, rounds: 9, rocks: 3 },
  4: { dogs: 4, sheep: 9, rounds: 9, rocks: 3 },
};

const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
/** 小屋の入口。上の辺のまんなか3マス。 */
export const GATE = [2, 3, 4];

export const rowOf = (cell) => Math.floor(cell / SIZE);
export const colOf = (cell) => cell % SIZE;
const at = (r, c) => r * SIZE + c;
const inside = (r, c) => r >= 0 && c >= 0 && r < SIZE && c < SIZE;
export const isGate = (cell) => rowOf(cell) === 0 && GATE.includes(colOf(cell));

export function setup({ n, rng, config }) {
  const cfg = { ...SETUPS[n], ...config };
  // 犬は下の辺に等間隔で並ぶ。
  const dogs = Array.from({ length: cfg.dogs }, (_, d) => at(SIZE - 1, Math.round(((d + 1) * (SIZE - 1)) / (cfg.dogs + 1))));
  // 岩とヒツジは牧場のまんなかあたりにばらまく (壁ぎわと犬のとなりは避ける)。
  const spots = [];
  for (let r = 2; r < SIZE - 1; r++) {
    for (let c = 1; c < SIZE - 1; c++) {
      const cell = at(r, c);
      if (!dogs.some((dog) => Math.abs(rowOf(dog) - r) <= 1 && Math.abs(colOf(dog) - c) <= 1)) spots.push(cell);
    }
  }
  const mixed = shuffle(rng, spots);
  // 岩どうしがくっつくと通れない壁になってしまうので、離して置く。
  const rocks = [];
  for (const cell of mixed) {
    if (rocks.length >= cfg.rocks) break;
    if (rocks.some((rock) => Math.abs(rowOf(rock) - rowOf(cell)) <= 1 && Math.abs(colOf(rock) - colOf(cell)) <= 1)) continue;
    rocks.push(cell);
  }
  const sheep = mixed.filter((cell) => !rocks.includes(cell)).slice(0, cfg.sheep);

  return {
    n,
    round: 1,
    maxRounds: cfg.rounds,
    dogs,
    rocks,
    owner: dogs.map((_, d) => d % n), // その犬を動かす席
    moved: dogs.map(() => false),
    sheep, // まだ牧場にいるヒツジの位置
    ids: sheep.map((_, i) => i), // sheep と同じ並びの番号 (画面で1匹ずつ追いかけるため)
    total: cfg.sheep,
    home: 0,
    wanderChance: cfg.wander ?? 0.6,
    last: null, // 直前のできごと (画面の演出用)
    lastId: 0,
    over: false,
    result: null,
  };
}

function occupied(state, cell) {
  return state.dogs.includes(cell) || state.sheep.includes(cell) || state.rocks.includes(cell);
}

/** 犬 d が歩いて行けるマス (3歩まで。ヒツジ・ほかの犬・小屋は通れない)。 */
export function reachable(state, d) {
  const start = state.dogs[d];
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    const steps = dist.get(cur);
    if (steps >= DOG_STEPS) continue;
    for (const [dr, dc] of ORTH) {
      const r = rowOf(cur) + dr;
      const c = colOf(cur) + dc;
      if (!inside(r, c)) continue;
      const next = at(r, c);
      if (dist.has(next) || isGate(next) || occupied(state, next)) continue;
      dist.set(next, steps + 1);
      queue.push(next);
    }
  }
  return [...dist.keys()];
}

/**
 * 犬が dogCell に止まったとき、ヒツジがどう逃げるかを計算する (状態は変えない)。
 * 画面の「ここに動くとこうなる」表示にも使う。
 * @returns {{ moves: { from: number, to: number, path: number[], home: boolean }[], sheep: number[], gone: Set<number> }}
 *   sheep は逃げたあとの位置 (並びは元のまま)、gone は小屋に入ったヒツジの添字。
 */
export function fleeFrom(state, d, dogCell) {
  const dogs = state.dogs.slice();
  dogs[d] = dogCell;
  const sheep = state.sheep.slice();
  const gone = new Set();
  const moves = [];
  const blocked = (cell, self) =>
    dogs.includes(cell) || state.rocks.includes(cell) || sheep.some((s, i) => s === cell && i !== self && !gone.has(i));

  for (let i = 0; i < sheep.length; i++) {
    let dr = Math.sign(rowOf(sheep[i]) - rowOf(dogCell));
    let dc = Math.sign(colOf(sheep[i]) - colOf(dogCell));
    const near = Math.abs(rowOf(sheep[i]) - rowOf(dogCell)) <= 1 && Math.abs(colOf(sheep[i]) - colOf(dogCell)) <= 1;
    if (!near || (dr === 0 && dc === 0)) continue;
    const from = sheep[i];
    const path = [from];
    let home = false;
    for (let step = 0; step < FLEE_STEPS && !home; step++) {
      const r = rowOf(sheep[i]);
      const c = colOf(sheep[i]);
      let tries;
      if (dr !== 0 && dc !== 0) {
        // ななめに逃げられなければ「たて」「よこ」の順にかわす。
        tries = [[dr, dc], [dr, 0], [0, dc]];
      } else if (!inside(r + dr, c + dc)) {
        // 壁にぶつかったら、広いほうへ曲がって壁ぞいに走る。
        const mid = (SIZE - 1) / 2;
        tries = dr !== 0 ? (c <= mid ? [[0, 1], [0, -1]] : [[0, -1], [0, 1]]) : r <= mid ? [[1, 0], [-1, 0]] : [[-1, 0], [1, 0]];
      } else {
        tries = [[dr, dc]];
      }
      let went = false;
      for (const [tr, tc] of tries) {
        if (!inside(r + tr, c + tc)) continue;
        const next = at(r + tr, c + tc);
        if (blocked(next, i)) continue;
        sheep[i] = next;
        path.push(next);
        went = true;
        // 曲がったら、そのまま曲がった方向へ走り続ける。
        dr = tr;
        dc = tc;
        if (isGate(next)) home = true;
        break;
      }
      if (!went) break;
    }
    if (sheep[i] !== from) moves.push({ from, to: sheep[i], path, home });
    if (home) gone.add(i);
  }
  return { moves, sheep, gone };
}

function note(state, event) {
  state.lastId++;
  state.last = { id: state.lastId, ...event };
}

export function act(state, seat, action, rng) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && action.type === 'move', '不明な操作です');
  const d = action.dog;
  assert(Number.isInteger(d) && d >= 0 && d < state.dogs.length, '犬を選んでください');
  assert(state.owner[d] === seat, 'その犬はあなたの犬ではありません');
  assert(!state.moved[d], 'その犬はこのラウンドにもう動きました');
  assert(reachable(state, d).includes(action.to), 'そこへは行けません');

  const from = state.dogs[d];
  const result = fleeFrom(state, d, action.to);
  state.dogs[d] = action.to;
  state.sheep = result.sheep;
  sendHome(state, result.gone);
  state.moved[d] = true;
  note(state, { type: 'move', dog: d, from, to: action.to, fled: result.moves, wandered: [] });

  if (state.sheep.length === 0) return finish(state);
  if (state.moved.every(Boolean)) endRound(state, rng);
}

/** 小屋に入ったヒツジを牧場から外す。 */
function sendHome(state, gone) {
  state.sheep = state.sheep.filter((_, i) => !gone.has(i));
  state.ids = state.ids.filter((_, i) => !gone.has(i));
  state.home += gone.size;
}

function endRound(state, rng) {
  // そばに犬がいないヒツジは、ふらふらと歩く。草を食べに下へ行くことが多い。
  const wandered = [];
  const guarded = (cell) =>
    state.dogs.some((dog) => Math.abs(rowOf(dog) - rowOf(cell)) <= 1 && Math.abs(colOf(dog) - colOf(cell)) <= 1);
  const gone = new Set();
  for (let i = 0; i < state.sheep.length; i++) {
    const cell = state.sheep[i];
    if (guarded(cell) || rng() >= state.wanderChance) continue;
    const dirs = [[1, 0], [1, 0], [0, -1], [0, 1], [-1, 0]];
    const [dr, dc] = dirs[randInt(rng, dirs.length)];
    const r = rowOf(cell) + dr;
    const c = colOf(cell) + dc;
    if (!inside(r, c)) continue;
    const next = at(r, c);
    if (state.dogs.includes(next) || state.rocks.includes(next)) continue;
    if (state.sheep.some((s, j) => s === next && !gone.has(j))) continue;
    state.sheep[i] = next;
    const home = isGate(next);
    if (home) gone.add(i);
    wandered.push({ from: cell, to: next, home });
  }
  sendHome(state, gone);
  state.last.wandered = wandered;

  if (state.sheep.length === 0 || state.round >= state.maxRounds) return finish(state);
  state.round++;
  state.moved = state.dogs.map(() => false);
}

function finish(state) {
  state.over = true;
  const success = state.sheep.length === 0;
  const spare = state.maxRounds - state.round;
  // 早く終えるほど星が多い。
  const stars = !success ? 0 : spare >= 2 ? 3 : spare >= 1 ? 2 : 1;
  state.result = makeTeamResult(state.n, {
    success,
    score: state.home,
    unit: '匹',
    stars,
    headline: success
      ? `ヒツジ ${state.total} 匹、みんな小屋に帰れました！`
      : `日が暮れてしまいました… ${state.total} 匹のうち ${state.home} 匹が帰れました`,
  });
}

export function view(state) {
  return {
    n: state.n,
    size: SIZE,
    gate: GATE,
    round: state.round,
    maxRounds: state.maxRounds,
    dogs: state.dogs,
    rocks: state.rocks,
    owner: state.owner,
    moved: state.moved,
    sheep: state.sheep,
    ids: state.ids,
    total: state.total,
    home: state.home,
    last: state.last,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  return [...new Set(state.owner.filter((_, d) => !state.moved[d]))];
}

// ---- CPU ----------------------------------------------------------------

/** ヒツジが小屋までどれくらい遠いかの目安 (上の壁まで行けば、壁ぞいに入口へ寄っていける)。 */
function sheepCost(cell) {
  const c = colOf(cell);
  const dc = c < GATE[0] ? GATE[0] - c : c > GATE[GATE.length - 1] ? c - GATE[GATE.length - 1] : 0;
  return rowOf(cell) + dc * 0.6;
}

function evaluate(state, sheep, homed, dogs) {
  let cost = -homed * 8;
  for (const cell of sheep) cost += sheepCost(cell);
  // まだ手つかずのヒツジの「押しやすい位置」(ヒツジの真下) に近いほど良い。
  for (const cell of sheep) {
    const below = Math.min(SIZE - 1, rowOf(cell) + 1);
    const want = at(below, colOf(cell));
    let best = Infinity;
    for (const dog of dogs) {
      best = Math.min(best, Math.abs(rowOf(dog) - rowOf(want)) + Math.abs(colOf(dog) - colOf(want)));
    }
    cost += best * 0.12;
  }
  return cost;
}

export function bot(state, seat, rng) {
  let best = null;
  let bestCost = Infinity;
  for (let d = 0; d < state.dogs.length; d++) {
    if (state.owner[d] !== seat || state.moved[d]) continue;
    for (const to of reachable(state, d)) {
      const result = fleeFrom(state, d, to);
      const dogs = state.dogs.slice();
      dogs[d] = to;
      const left = result.sheep.filter((_, i) => !result.gone.has(i));
      const cost = evaluate(state, left, result.gone.size, dogs) + rng() * 0.3;
      if (cost < bestCost) {
        bestCost = cost;
        best = { type: 'move', dog: d, to };
      }
    }
  }
  return best;
}
