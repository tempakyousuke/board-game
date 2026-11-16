// ごっつんこ探検隊 — 全員同時に行き先を決める読み合いゲーム (2〜6人)
//
// ・毎ラウンド、全員がこっそり「2歩以内のマス」を1つ選び、いっせいに移動する。
// ・1人だけがそのマスを選んでいたら、移動してそこの宝石を手に入れる。
// ・2人以上が同じマスを選ぶと「ごっつんこ」。全員もとの場所に戻され、宝石は +1 育つ。
// ・ただし「おしのけ」(1人2回まで) を使った人が1人だけなら、その人が押し勝つ。
// ・10ラウンド終了時に宝石の合計がいちばん多い人の勝ち。

import { assert, makeResult } from './common.js';
import { randInt, shuffle, weighted } from '../rng.js';

export const meta = {
  id: 'gottsunko',
  name: 'ごっつんこ探検隊',
  emoji: '💎',
  tagline: 'ねらいがかぶると全員はね返される！同時移動の読み合い',
  minPlayers: 2,
  maxPlayers: 6,
  time: '5〜10分',
  tags: ['わいわい', '読み合い', '同時プレイ'],
};

export const MAX_ROUNDS = 10;
export const PUSH_TOKENS = 2;
export const MOVE_RANGE = 2;
const MAX_GEM = 9;
const GEM_WEIGHTS = [[1, 45], [2, 30], [3, 17], [5, 8]];

// 盤は人数に合わせて広げる。広すぎると誰ともかぶらず、読み合いにならない。
function sizeFor(n) {
  return Math.min(7, n + 2);
}

function perimeter(size) {
  const cells = [];
  for (let c = 0; c < size - 1; c++) cells.push(c);
  for (let r = 0; r < size - 1; r++) cells.push(r * size + size - 1);
  for (let c = size - 1; c > 0; c--) cells.push((size - 1) * size + c);
  for (let r = size - 1; r > 0; r--) cells.push(r * size);
  return cells;
}

export function reachable(size, from) {
  const r0 = Math.floor(from / size);
  const c0 = from % size;
  const out = [];
  for (let dr = -MOVE_RANGE; dr <= MOVE_RANGE; dr++) {
    for (let dc = -MOVE_RANGE; dc <= MOVE_RANGE; dc++) {
      const d = Math.abs(dr) + Math.abs(dc);
      if (d === 0 || d > MOVE_RANGE) continue;
      const r = r0 + dr;
      const c = c0 + dc;
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      out.push(r * size + c);
    }
  }
  return out;
}

export function setup({ n, rng }) {
  const size = sizeFor(n);
  const ring = perimeter(size);
  const offset = randInt(rng, n);
  const pos = [];
  for (let s = 0; s < n; s++) {
    pos[(s + offset) % n] = ring[Math.round((s * ring.length) / n) % ring.length];
  }

  const gems = new Array(size * size).fill(0);
  const free = shuffle(
    rng,
    gems.map((_, i) => i).filter((i) => !pos.includes(i)),
  );
  const initial = Math.round((size * size - n) * 0.38);
  for (let k = 0; k < initial; k++) gems[free[k]] = weighted(rng, GEM_WEIGHTS);

  return {
    n,
    size,
    round: 1,
    maxRounds: MAX_ROUNDS,
    gems,
    pos,
    score: new Array(n).fill(0),
    push: new Array(n).fill(PUSH_TOKENS),
    choice: new Array(n).fill(null),
    lastRound: null,
    over: false,
    result: null,
  };
}

export function act(state, seat, action, rng) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && action.type === 'choose', '不明な操作です');
  const to = action.to;
  const push = !!action.push;
  assert(Number.isInteger(to), '行き先を選んでください');
  assert(reachable(state.size, state.pos[seat]).includes(to), 'そのマスには届きません');
  assert(!push || state.push[seat] > 0, 'おしのけはもう使えません');
  state.choice[seat] = { to, push };
  if (state.choice.every((c) => c !== null)) resolve(state, rng);
}

function resolve(state, rng) {
  const { n, size } = state;
  const byCell = new Map();
  for (let s = 0; s < n; s++) {
    const { to } = state.choice[s];
    if (!byCell.has(to)) byCell.set(to, []);
    byCell.get(to).push(s);
  }

  const moves = [];
  const clashes = [];
  for (const [cell, seats] of byCell) {
    const pushers = seats.filter((s) => state.choice[s].push);
    let winner = -1;
    if (seats.length === 1) winner = seats[0];
    else if (pushers.length === 1) winner = pushers[0];

    if (seats.length > 1) {
      const grown = winner < 0 && state.gems[cell] > 0 && state.gems[cell] < MAX_GEM;
      if (grown) state.gems[cell]++;
      clashes.push({ cell, seats: seats.slice(), winner, grown });
    }
    for (const s of seats) {
      const from = state.pos[s];
      const pushed = state.choice[s].push;
      if (pushed) state.push[s]--;
      let gain = 0;
      let outcome = 'bounce';
      if (s === winner) {
        gain = state.gems[cell];
        state.gems[cell] = 0;
        state.score[s] += gain;
        state.pos[s] = cell;
        outcome = seats.length > 1 ? 'push' : 'move';
      }
      moves.push({ seat: s, from, to: cell, push: pushed, outcome, gain });
    }
  }
  moves.sort((a, b) => a.seat - b.seat);

  const spawned = [];
  const finished = state.round >= state.maxRounds;
  if (!finished) {
    const free = shuffle(
      rng,
      state.gems.map((_, i) => i).filter((i) => state.gems[i] === 0 && !state.pos.includes(i)),
    );
    // 新しくわく宝石は人数より1つ少ない。全員ぶんは無いので、取り合いになる。
    const count = Math.min(free.length, Math.max(1, n - 1));
    for (let k = 0; k < count; k++) {
      const value = weighted(rng, GEM_WEIGHTS);
      state.gems[free[k]] = value;
      spawned.push({ cell: free[k], value });
    }
  }

  state.lastRound = { round: state.round, moves, clashes, spawned };
  state.choice = new Array(n).fill(null);
  if (finished) {
    state.over = true;
    state.result = makeResult(state.score.slice(), { unit: '点' });
  } else {
    state.round++;
  }
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  return {
    n: state.n,
    size: state.size,
    round: state.round,
    maxRounds: state.maxRounds,
    gems: state.gems,
    pos: state.pos,
    score: state.score,
    push: state.push,
    submitted: state.choice.map((c) => c !== null),
    myChoice: mine ? state.choice[seat] : null,
    lastRound: state.lastRound,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  const out = [];
  for (let s = 0; s < state.n; s++) if (state.choice[s] === null) out.push(s);
  return out;
}

export function bot(state, seat, rng) {
  const { size, n } = state;
  const others = [];
  for (let s = 0; s < n; s++) {
    if (s !== seat) others.push(new Set(reachable(size, state.pos[s])));
  }
  const options = reachable(size, state.pos[seat]);
  let best = options[0];
  let bestScore = -Infinity;
  let bestRivals = 0;
  for (const cell of options) {
    const gem = state.gems[cell];
    const rivals = others.filter((set) => set.has(cell)).length;
    // ライバルが多いほど、価値の高い宝石ほど、かぶる可能性が高いと見積もる。
    const clashChance = Math.min(0.85, rivals * (0.12 + gem * 0.07));
    let score = gem * (1 - clashChance);
    // 次のラウンドに向けて、近くに宝石が多い場所を少しだけ好む。
    let nearby = 0;
    for (const next of reachable(size, cell)) nearby += state.gems[next];
    score += nearby * 0.04 + rng() * 0.9;
    if (score > bestScore) {
      bestScore = score;
      best = cell;
      bestRivals = rivals;
    }
  }
  const gem = state.gems[best];
  const roundsLeft = state.maxRounds - state.round;
  const wantPush =
    state.push[seat] > 0 &&
    bestRivals > 0 &&
    (gem >= 4 || (gem >= 3 && roundsLeft < state.push[seat] * 2)) &&
    rng() < 0.7;
  return { type: 'choose', to: best, push: wantPush };
}
