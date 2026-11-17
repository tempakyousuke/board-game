// ぐるぐるとびいし — 全員で1本の列をつなぐ、同時出しのカードゲーム (2〜6人)
//
// ・数字は 1〜60 で、輪になっている (60 の次は 1)。場には「列の先頭」が1枚ある。
// ・各自、手札から1枚を同時に出す。先頭から時計回りに近い順に、1枚ずつ置く。
// ・前のカードから 10 以内なら「つながる」。列が1枚のびる。
// ・届かなければ、それまでの列を全部引き取る (1枚 −1点)。そのカードが新しい列の最初になる。
// ・その番の最後に置かれたカードがつながっていたら、その人にごほうび (いちばん先まで進んだ人)。
//   ごほうびは人数と同じ点数 (4人なら +4点)。
// ・手札を出し切ったら1ラウンド終了。2ラウンドの合計点が高い人の勝ち。

import { assert, makeResult } from './common.js';
import { randInt, shuffle } from '../rng.js';

export const meta = {
  id: 'tobiishi',
  name: 'ぐるぐるとびいし',
  emoji: '🌀',
  tagline: '同時に出して1本につなぐ。届かなかった人が全部引き取る',
  minPlayers: 2,
  maxPlayers: 6,
  time: '5〜10分',
  tags: ['わいわい', '同時プレイ', 'チキンレース'],
  // 全員が同時にえらぶゲームなので、CPU は待たせずに次々と出す。
  botDelayMs: 500,
};

export const RING = 60;
export const REACH = 10;
export const HAND = 8;
export const ROUNDS = 2;
// いちばん先まで進んだ人のごほうび。人数と同じ点数にしている。
// 人数が増えると列が長くなって失点が大きくなり、ごほうびをもらえる回数は減る。
// 固定の +2点だと、6人では点差のうち加点が占める割合が 3% しかなかった
// (CPU 同士の試算。人数と同じ点数にすると、2〜6人で 18〜32% になる)。
export const BONUS_BY_PLAYERS = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
// 出そろったカードを1枚ずつ置いて見せる時間 (サーバーの時計で次へ進む)。
export const REVEAL_LEAD_MS = 600;
export const REVEAL_STEP_MS = 850;
export const REVEAL_TAIL_MS = 1500;

/** from から時計回りに c まで、いくつ進むか (1〜59)。 */
export function distance(from, c) {
  return (c - from + RING) % RING;
}

function deal(state, rng) {
  const deck = shuffle(rng, Array.from({ length: RING }, (_, i) => i + 1));
  state.hands = Array.from({ length: state.n }, () => deck.splice(0, HAND).sort((a, b) => a - b));
  const first = deck.pop();
  state.pile = [{ card: first, seat: -1 }];
  state.played = [first];
  state.picks = new Array(state.n).fill(null);
  state.turn = 1;
  state.phase = 'pick';
}

export function setup({ n, rng }) {
  const state = {
    n,
    bonus: BONUS_BY_PLAYERS[n],
    round: 1,
    maxRounds: ROUNDS,
    turn: 1,
    hands: [],
    pile: [], // いまの列。先頭は最後の要素
    played: [], // このラウンドで場に出たカード (最初の1枚もふくむ)
    picks: [],
    points: new Array(n).fill(0),
    taken: new Array(n).fill(0), // 引き取った枚数
    leads: new Array(n).fill(0), // ごほうびをもらった回数
    roundPoints: new Array(n).fill(0),
    phase: 'pick', // pick: 全員が1枚えらぶ / reveal: 置いていくのを見る / roundEnd: ラウンドの結果を見る
    last: null, // 直前の番のなりゆき (reveal のあいだは、まだ点や列に反映していない)
    lastId: 0,
    over: false,
    result: null,
  };
  deal(state, rng);
  return state;
}

export const topOf = (state) => state.pile[state.pile.length - 1].card;

/**
 * 出されたカードを、先頭から時計回りに近い順に置いていく。
 * pile は書きかえず、なりゆきと新しい列を返す (CPU の先読みにも使う)。
 * @param {{card:number, seat:number}[]} pile
 * @param {number[]} cards 席ごとのカード
 */
export function resolveTurn(pile, cards) {
  const start = pile[pile.length - 1].card;
  const order = cards.map((card, seat) => ({ card, seat })).sort((a, b) => distance(start, a.card) - distance(start, b.card));
  let now = pile.slice();
  const steps = [];
  let leader = -1;
  for (const { card, seat } of order) {
    const gap = distance(now[now.length - 1].card, card);
    if (gap <= REACH) {
      now.push({ card, seat });
      steps.push({ seat, card, gap, ok: true, took: 0 });
      leader = seat;
    } else {
      steps.push({ seat, card, gap, ok: false, took: now.length });
      now = [{ card, seat }];
      leader = -1;
    }
  }
  return { steps, pile: now, leader };
}

export function act(state, seat, action, rng) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && typeof action.type === 'string', '不明な操作です');

  if (action.type === 'next') {
    assert(state.phase === 'roundEnd', 'まだ次のラウンドには進めません');
    state.round++;
    state.roundPoints = new Array(state.n).fill(0);
    deal(state, rng);
    return;
  }

  assert(action.type === 'pick', '不明な操作です');
  assert(state.phase === 'pick', 'いまはカードを出せません');
  assert(state.hands[seat].includes(action.card), 'そのカードは手札にありません');
  // 全員がそろうまでは選び直せる。
  state.picks[seat] = action.card;
  if (state.picks.every((card) => card !== null)) {
    const { steps, pile, leader } = resolveTurn(state.pile, state.picks);
    state.last = { id: ++state.lastId, round: state.round, turn: state.turn, steps, leader, after: pile };
    state.phase = 'reveal';
  }
}

export function timer(state) {
  if (state.over || state.phase !== 'reveal') return null;
  const ms = REVEAL_LEAD_MS + state.last.steps.length * REVEAL_STEP_MS + REVEAL_TAIL_MS;
  return { ms, key: `reveal:${state.lastId}` };
}

/** 見せ終わったら、なりゆきを点と列に反映して次へ進む。 */
export function tick(state) {
  if (state.over || state.phase !== 'reveal') return;
  const { steps, leader, after } = state.last;
  for (const step of steps) {
    if (!step.ok) {
      state.taken[step.seat] += step.took;
      state.points[step.seat] -= step.took;
      state.roundPoints[step.seat] -= step.took;
    }
    state.hands[step.seat] = state.hands[step.seat].filter((card) => card !== step.card);
    state.played.push(step.card);
  }
  if (leader >= 0) {
    state.leads[leader]++;
    state.points[leader] += state.bonus;
    state.roundPoints[leader] += state.bonus;
  }
  state.pile = after;
  delete state.last.after;
  state.picks = new Array(state.n).fill(null);

  if (state.turn < HAND) {
    state.turn++;
    state.phase = 'pick';
    return;
  }
  if (state.round < state.maxRounds) {
    state.phase = 'roundEnd';
    return;
  }
  state.phase = 'over';
  state.over = true;
  // 同点なら、引き取った枚数が少ない人を上にする。
  state.result = makeResult(state.points.slice(), {
    unit: '点',
    detail: { taken: state.taken.slice(), leads: state.leads.slice() },
    tiebreak: state.taken.map((count) => -count),
  });
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  return {
    n: state.n,
    ring: RING,
    reach: REACH,
    bonus: state.bonus,
    round: state.round,
    maxRounds: state.maxRounds,
    turn: state.turn,
    turns: HAND,
    pile: state.pile,
    played: state.played,
    phase: state.phase,
    // だれが出し終えたかだけを見せる。カードは全員がそろうまで本人にしか見せない。
    picked: state.picks.map((card) => card !== null),
    myPick: mine ? state.picks[seat] : null,
    myHand: mine ? state.hands[seat] : null,
    handCount: state.hands.map((hand) => hand.length),
    last: state.last,
    points: state.points,
    roundPoints: state.roundPoints,
    taken: state.taken,
    leads: state.leads,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over || state.phase === 'reveal') return [];
  if (state.phase === 'roundEnd') return Array.from({ length: state.n }, (_, s) => s);
  return state.picks.map((card, s) => (card === null ? s : -1)).filter((s) => s >= 0);
}

// ---- CPU -------------------------------------------------------------------
//
// ほかの人の手札をそれらしく配り直した「ありそうな世界」をいくつも作り、
// 自分のカードごとに点の見込みをくらべる。

const SAMPLES = 24;
const KEEP = 0.4; // 次の番にも届くカードが手元に残ることの値うち
const NOISE = 0.1; // 見込みの近いカードからは気まぐれに選ぶ

function byDistance(hand, top) {
  return hand.slice().sort((a, b) => distance(top, a) - distance(top, b));
}

/** 相手として思いうかべる「ふつうの人」。堅い人・欲ばる人・気まぐれな人が混ざっている。 */
function likelyPick(hand, top, rng) {
  const sorted = byDistance(hand, top);
  const safe = sorted.filter((card) => distance(top, card) <= REACH);
  const stretch = sorted.filter((card) => distance(top, card) > REACH && distance(top, card) <= REACH * 2);
  const r = rng();
  if (r < 0.1) return sorted[randInt(rng, sorted.length)];
  if (r < 0.3) return sorted[0];
  // 少し届かないカードで、だれかが橋をかけてくれるのを待つ。
  if (r < 0.65 && stretch.length) return stretch[0];
  return safe.length ? safe[safe.length - 1] : sorted[0];
}

export function bot(state, seat, rng) {
  if (state.phase === 'roundEnd') return { type: 'next' };
  if (state.phase !== 'pick') return null;
  const hand = state.hands[seat];
  if (hand.length === 1) return { type: 'pick', card: hand[0] };
  const top = topOf(state);

  const known = new Set([...state.played, ...hand]);
  const unseen = [];
  for (let card = 1; card <= RING; card++) if (!known.has(card)) unseen.push(card);

  const worlds = Array.from({ length: SAMPLES }, () => {
    const pool = shuffle(rng, unseen);
    return state.hands.map((other, s) => (s === seat ? null : likelyPick(pool.splice(0, other.length), top, rng)));
  });

  let best = hand[0];
  let bestValue = -Infinity;
  for (const card of hand) {
    let total = 0;
    for (const world of worlds) {
      const cards = world.slice();
      cards[seat] = card;
      const { steps, pile, leader } = resolveTurn(state.pile, cards);
      const mine = steps.find((step) => step.seat === seat);
      total += (leader === seat ? state.bonus : 0) - mine.took;
      const newTop = pile[pile.length - 1].card;
      const alive = hand.filter((other) => other !== card && distance(newTop, other) <= REACH).length;
      total += KEEP * Math.min(2, alive);
    }
    const value = total / SAMPLES + rng() * NOISE;
    if (value > bestValue) {
      bestValue = value;
      best = card;
    }
  }
  return { type: 'pick', card: best };
}
