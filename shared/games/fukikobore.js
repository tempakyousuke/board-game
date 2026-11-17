// ふきこぼれ注意！ — 全員が同じ手札で読み合う、同時出しのカードゲーム (3〜6人)
//
// ・全員が 1〜10 のカードを1枚ずつ持っている。毎回、同時に1枚出す。
// ・小さい順に、3つのなべのうち「いちばん中身の軽いなべ」へ入る。同じ数字はまとめて入る。
// ・なべの合計が 21 をこえたら「ふきこぼれ」。入れた人が、なべの中身を全部引き取る (1枚 −1点)。
//   同じ数字を出した人がいたら、全員がそれぞれ引き取る。
// ・ぴったり 21 にしたら +2点。なべは空になる。
// ・10枚出し切ったら終了。点の高い人の勝ち。

import { assert, makeResult } from './common.js';

export const meta = {
  id: 'fukikobore',
  name: 'ふきこぼれ注意！',
  emoji: '🍲',
  tagline: '全員おなじ手札。かぶると全員ふきこぼれる読み合い',
  minPlayers: 3,
  maxPlayers: 6,
  time: '5分',
  tags: ['わいわい', '同時プレイ', '読み合い'],
  // 全員が同時にえらぶゲームなので、CPU は待たせずに次々と出す。
  botDelayMs: 500,
};

export const POTS = 3;
export const LIMIT = 21;
export const MAX_CARD = 10;
export const EXACT_BONUS = 2;
// 出そろったカードを小さい順に入れて見せる時間 (サーバーの時計で次へ進む)。
export const REVEAL_LEAD_MS = 600;
export const REVEAL_STEP_MS = 950;
export const REVEAL_TAIL_MS = 1500;

export function setup({ n }) {
  return {
    n,
    turn: 1,
    turns: MAX_CARD,
    pots: Array.from({ length: POTS }, () => []), // なべごとの中身 { value, seat }
    hands: Array.from({ length: n }, () => Array.from({ length: MAX_CARD }, (_, i) => i + 1)),
    picks: new Array(n).fill(null),
    points: new Array(n).fill(0),
    taken: new Array(n).fill(0), // 引き取った枚数
    exacts: new Array(n).fill(0), // ぴったりにした回数
    last: null, // 直前の番のなりゆき (reveal のあいだは、まだ点やなべに反映していない)
    lastId: 0,
    phase: 'pick', // pick: 全員が1枚えらぶ / reveal: なべに入っていくのを見る
    over: false,
    result: null,
  };
}

export const potSum = (pot) => pot.reduce((sum, item) => sum + item.value, 0);

/** いちばん中身の軽いなべ (同じなら左)。 */
export function lightest(pots) {
  let best = 0;
  for (let i = 1; i < pots.length; i++) if (potSum(pots[i]) < potSum(pots[best])) best = i;
  return best;
}

/**
 * 出されたカードを、小さい順になべへ入れていく。
 * pots は書きかえず、なりゆきと新しいなべを返す (CPU の先読みにも使う)。
 * @param {{value:number, seat:number}[][]} pots
 * @param {number[]} cards 席ごとのカード
 */
export function resolveTurn(pots, cards) {
  const now = pots.map((pot) => pot.slice());
  const steps = [];
  const values = [...new Set(cards)].sort((a, b) => a - b);
  for (const value of values) {
    const seats = cards.map((card, seat) => (card === value ? seat : -1)).filter((seat) => seat >= 0);
    const index = lightest(now);
    const before = potSum(now[index]);
    for (const seat of seats) now[index].push({ value, seat });
    const after = before + value * seats.length;
    const step = { value, seats, pot: index, before, after, result: 'ok', took: 0 };
    if (after > LIMIT) {
      step.result = 'over';
      step.took = now[index].length;
      now[index] = [];
    } else if (after === LIMIT) {
      step.result = 'exact';
      now[index] = [];
    }
    steps.push(step);
  }
  return { steps, pots: now };
}

export function act(state, seat, action) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && action.type === 'pick', '不明な操作です');
  assert(state.phase === 'pick', 'いまはカードを出せません');
  assert(state.hands[seat].includes(action.card), 'そのカードはもう出しました');
  // 全員がそろうまでは選び直せる。
  state.picks[seat] = action.card;
  if (state.picks.every((card) => card !== null)) {
    const { steps, pots } = resolveTurn(state.pots, state.picks);
    state.last = { id: ++state.lastId, turn: state.turn, steps, after: pots };
    state.phase = 'reveal';
  }
}

export function timer(state) {
  if (state.over || state.phase !== 'reveal') return null;
  const ms = REVEAL_LEAD_MS + state.last.steps.length * REVEAL_STEP_MS + REVEAL_TAIL_MS;
  return { ms, key: `reveal:${state.lastId}` };
}

/** 見せ終わったら、なりゆきを点となべに反映して次へ進む。 */
export function tick(state) {
  if (state.over || state.phase !== 'reveal') return;
  const { steps, after } = state.last;
  for (const step of steps) {
    for (const seat of step.seats) {
      if (step.result === 'over') {
        state.taken[seat] += step.took;
        state.points[seat] -= step.took;
      } else if (step.result === 'exact') {
        state.exacts[seat]++;
        state.points[seat] += EXACT_BONUS;
      }
      state.hands[seat] = state.hands[seat].filter((card) => card !== step.value);
    }
  }
  state.pots = after;
  delete state.last.after;
  state.picks = new Array(state.n).fill(null);

  if (state.turn < state.turns) {
    state.turn++;
    state.phase = 'pick';
    return;
  }
  state.phase = 'over';
  state.over = true;
  // 同点なら、引き取った枚数が少ない人を上にする。
  state.result = makeResult(state.points.slice(), {
    unit: '点',
    detail: { taken: state.taken.slice(), exacts: state.exacts.slice() },
    tiebreak: state.taken.map((count) => -count),
  });
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  return {
    n: state.n,
    limit: LIMIT,
    bonus: EXACT_BONUS,
    maxCard: MAX_CARD,
    turn: state.turn,
    turns: state.turns,
    pots: state.pots,
    // 手札は全員同じところから始まるので、残りは全員に見えている。
    hands: state.hands,
    // だれが出し終えたかだけを見せる。カードは全員がそろうまで本人にしか見せない。
    picked: state.picks.map((card) => card !== null),
    myPick: mine ? state.picks[seat] : null,
    last: state.last,
    points: state.points,
    taken: state.taken,
    exacts: state.exacts,
    phase: state.phase,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over || state.phase === 'reveal') return [];
  return state.picks.map((card, s) => (card === null ? s : -1)).filter((s) => s >= 0);
}

// ---- CPU -------------------------------------------------------------------
//
// 相手の出しそうなカードを何通りも思いうかべて、自分のカードごとに点の見込みをくらべる。
// 全員が同じ読み方をすると同じカードでかぶるので、見込みの近いカードからは気まぐれに選ぶ。

const SAMPLES = 30;
const TEMPERATURE = 0.7;

/** 相手として思いうかべる「ふつうの人」: 入るカードの中から大きめを出したがる。 */
function likelyPick(hand, room, rng) {
  if (rng() < 0.25) return hand[Math.floor(rng() * hand.length)];
  const safe = hand.filter((value) => value <= room);
  if (safe.length === 0) return hand[Math.floor(rng() * hand.length)];
  return safe[Math.min(safe.length - 1, Math.floor(safe.length * (0.4 + rng() * 0.6)))];
}

export function bot(state, seat, rng) {
  if (state.phase !== 'pick') return null;
  const hand = state.hands[seat];
  if (hand.length === 1) return { type: 'pick', card: hand[0] };
  const room = LIMIT - potSum(state.pots[lightest(state.pots)]);

  const worlds = Array.from({ length: SAMPLES }, () => state.hands.map((other, s) => (s === seat ? null : likelyPick(other, room, rng))));
  const values = hand.map((card) => {
    let total = 0;
    for (const world of worlds) {
      const cards = world.slice();
      cards[seat] = card;
      const step = resolveTurn(state.pots, cards).steps.find((item) => item.seats.includes(seat));
      total += step.result === 'exact' ? EXACT_BONUS : -step.took;
    }
    // 大きいカードを残すほど、あとが苦しくなる。
    return total / SAMPLES + card * 0.06;
  });

  const top = Math.max(...values);
  const weights = values.map((value) => Math.exp((value - top) / TEMPERATURE));
  let roll = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < hand.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return { type: 'pick', card: hand[i] };
  }
  return { type: 'pick', card: hand[hand.length - 1] };
}
