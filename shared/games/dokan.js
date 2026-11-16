// ドカン！導火線 — 導火線の長さを少しだけ知っているブラフゲーム (2〜6人)
//
// ・導火線の長さは、裏向きの3枚のカード (それぞれ4〜9) の合計。
// ・各プレイヤーは3枚のうち1枚だけをこっそり見ている。
// ・自分の番には火を 1〜3 進める。進めた数がそのままそのラウンドの得点になる。
//   ラウンドに1回だけ「パス」(0点) もできる。
// ・火が導火線の長さに届いたらドカン！進めた人はそのラウンドの得点を失い、さらに減点。
//   ほかの人はそのラウンドの得点を受け取る。
// ・5ラウンド遊んで、合計点が高い人の勝ち (同点なら爆発の少ない人)。

import { assert, makeResult } from './common.js';
import { randInt } from '../rng.js';

export const meta = {
  id: 'dokan',
  name: 'ドカン！導火線',
  emoji: '💣',
  tagline: '導火線の長さは3枚の合計。知っているのは1枚だけ！',
  minPlayers: 2,
  maxPlayers: 6,
  time: '5〜10分',
  tags: ['わいわい', 'ブラフ', '推理'],
};

export const CARD_MIN = 4;
export const CARD_MAX = 9;
export const CARDS = 3;
export const MAX_ROUNDS = 5;
export const BOOM_PENALTY = 3;

function deal(state, rng) {
  state.fuse = Array.from({ length: CARDS }, () => CARD_MIN + randInt(rng, CARD_MAX - CARD_MIN + 1));
  // だれがどのカードを見るかはラウンドごとに変わる。
  const shift = randInt(rng, CARDS);
  state.peek = Array.from({ length: state.n }, (_, s) => (s + shift) % CARDS);
  state.total = 0;
  state.passLeft = new Array(state.n).fill(1);
  state.roundPoints = new Array(state.n).fill(0);
  state.history = [];
  state.phase = 'play';
}

export function setup({ n, rng }) {
  const state = {
    n,
    round: 1,
    maxRounds: MAX_ROUNDS,
    fuse: [],
    peek: [],
    total: 0,
    turn: randInt(rng, n),
    passLeft: [],
    roundPoints: [],
    points: new Array(n).fill(0),
    booms: new Array(n).fill(0),
    history: [],
    phase: 'play', // play: 火を進める / reveal: 爆発してカード公開中
    boom: null,
    over: false,
    result: null,
  };
  deal(state, rng);
  return state;
}

export function fuseLength(state) {
  return state.fuse.reduce((a, b) => a + b, 0);
}

export function act(state, seat, action, rng) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && typeof action.type === 'string', '不明な操作です');

  if (action.type === 'next') {
    assert(state.phase === 'reveal', 'まだ次のラウンドには進めません');
    state.round++;
    // 爆発させた人が次のラウンドの最初 (安全なうちに点を取り返せる)。
    state.turn = state.boom.seat;
    state.boom = null;
    deal(state, rng);
    return;
  }

  assert(state.phase === 'play', 'いまは操作できません');
  assert(seat === state.turn, 'あなたの番ではありません');

  if (action.type === 'pass') {
    assert(state.passLeft[seat] > 0, 'パスはこのラウンドではもう使えません');
    state.passLeft[seat]--;
    state.history.push({ seat, pass: true, total: state.total });
    state.turn = (state.turn + 1) % state.n;
    return;
  }

  assert(action.type === 'add', '不明な操作です');
  const amount = action.n;
  assert(amount === 1 || amount === 2 || amount === 3, '進められるのは1〜3です');
  state.total += amount;
  state.history.push({ seat, add: amount, total: state.total });

  const length = fuseLength(state);
  if (state.total < length) {
    state.roundPoints[seat] += amount;
    state.turn = (state.turn + 1) % state.n;
    return;
  }

  // ドカン！
  const lost = state.roundPoints[seat];
  const gained = state.roundPoints.slice();
  gained[seat] = -BOOM_PENALTY;
  for (let s = 0; s < state.n; s++) state.points[s] += gained[s];
  state.booms[seat]++;
  state.boom = { seat, total: state.total, length, fuse: state.fuse.slice(), lost, gained };
  state.turn = -1;
  if (state.round >= state.maxRounds) {
    state.phase = 'over';
    state.over = true;
    // 同点なら、爆発させた回数が少ない人を上位にする。
    state.result = makeResult(state.points.slice(), {
      unit: '点',
      detail: { booms: state.booms.slice() },
      tiebreak: state.booms.map((b) => -b),
    });
  } else {
    state.phase = 'reveal';
  }
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  const revealed = state.phase !== 'play';
  return {
    n: state.n,
    round: state.round,
    maxRounds: state.maxRounds,
    cardMin: CARD_MIN,
    cardMax: CARD_MAX,
    penalty: BOOM_PENALTY,
    total: state.total,
    turn: state.phase === 'play' ? state.turn : -1,
    passLeft: state.passLeft,
    roundPoints: state.roundPoints,
    points: state.points,
    booms: state.booms,
    history: state.history,
    phase: state.phase,
    peek: state.peek,
    myPeek: mine ? { index: state.peek[seat], value: state.fuse[state.peek[seat]] } : null,
    fuse: revealed ? state.fuse : null,
    boom: state.boom,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  if (state.phase === 'reveal') return Array.from({ length: state.n }, (_, s) => s);
  return [state.turn];
}

/** 自分の見たカードだけから、導火線の長さが limit 以下である確率を出す。 */
export function chanceAtMost(known, limit) {
  let hit = 0;
  let all = 0;
  for (let a = CARD_MIN; a <= CARD_MAX; a++) {
    for (let b = CARD_MIN; b <= CARD_MAX; b++) {
      all++;
      if (known + a + b <= limit) hit++;
    }
  }
  return hit / all;
}

export function bot(state, seat, rng) {
  if (state.phase === 'reveal') return { type: 'next' };
  const known = state.fuse[state.peek[seat]];
  const atStake = state.roundPoints[seat] + BOOM_PENALTY;
  // 性格のゆらぎ: 強気なときは危険を小さめに、弱気なときは大きめに見積もる。
  const mood = 0.75 + rng() * 0.6;

  let best = null;
  let bestValue = -Infinity;
  for (const add of [1, 2, 3]) {
    const risk = Math.min(1, chanceAtMost(known, state.total + add) * mood);
    const value = (1 - risk) * add - risk * atStake + rng() * 0.2;
    if (value > bestValue) {
      bestValue = value;
      best = { type: 'add', n: add };
    }
  }
  // どう進めても損をしそうなら、残っていればパスでやり過ごす。
  if (bestValue < -0.4 && state.passLeft[seat] > 0) return { type: 'pass' };
  return best;
}
