// のろのろレース — 自分の「推し」を秘密にしたまま勝たせるレース (2〜6人)
//
// ・6匹ののんびり屋がゴールをめざす。各プレイヤーは、どれか1匹をこっそり「推し」にしている。
// ・自分の番には手札3枚から1枚出す。カードは「カメを2マス進める」のように進む相手が決まっていて、
//   出したら必ずそのとおりに進む。つまり、推しではない相手を進めるしかないこともある。
// ・「だれでも」カードは好きな1匹を進め、「あともどり」カードは好きな1匹を下がらせる。
// ・だれかがゴールしたらレース終了。そのときの順位で、推しの順位に応じた点が入る。
// ・推しがばれると、じゃまをされる。ばれないように勝たせよう。

import { assert, makeResult } from './common.js';
import { randInt, shuffle } from '../rng.js';

export const meta = {
  id: 'noronoro',
  name: 'のろのろレース',
  emoji: '🐌',
  tagline: 'こっそり応援、こっそり妨害。あなたの推しは、ばれずに勝てる？',
  minPlayers: 2,
  maxPlayers: 6,
  time: '5〜10分',
  tags: ['わいわい', 'ブラフ', 'レース'],
};

export const RACERS = [
  { emoji: '🐢', name: 'カメ' },
  { emoji: '🐌', name: 'カタツムリ' },
  { emoji: '🐛', name: 'イモムシ' },
  { emoji: '🦀', name: 'カニ' },
  { emoji: '🐞', name: 'テントウムシ' },
  { emoji: '🐜', name: 'アリ' },
];
export const GOAL = 10;
export const LEAVES = [3, 7]; // ぴったり止まると、もう1マス進む
export const PUDDLES = [5, 9]; // ぴったり止まると、1マスもどる
export const HAND_SIZE = 3;
export const RANK_POINTS = [10, 6, 4, 2, 1, 0];
const GO_VALUES = [1, 1, 2, 2, 3];
const WILD_COUNT = 4;
const BACK_COUNT = 4;
const WILD_STEPS = 2;
const BACK_STEPS = 2;

// カード: { k: 'go', racer, v } / { k: 'any', v } / { k: 'back', v }

function buildDeck(rng) {
  const deck = [];
  RACERS.forEach((_, racer) => {
    for (const v of GO_VALUES) deck.push({ k: 'go', racer, v });
  });
  for (let i = 0; i < WILD_COUNT; i++) deck.push({ k: 'any', v: WILD_STEPS });
  for (let i = 0; i < BACK_COUNT; i++) deck.push({ k: 'back', v: BACK_STEPS });
  return shuffle(rng, deck);
}

export function setup({ n, rng }) {
  const deck = buildDeck(rng);
  const hands = Array.from({ length: n }, () => deck.splice(0, HAND_SIZE));
  const favorites = shuffle(
    rng,
    RACERS.map((_, i) => i),
  ).slice(0, n);
  return {
    n,
    pos: RACERS.map(() => 0),
    // 同じマスに並んだときは、先に着いたほうが前。着いた順を覚えておく。
    stamp: RACERS.map((_, i) => i),
    clock: RACERS.length,
    deck,
    discard: [],
    hands,
    fav: favorites,
    turn: randInt(rng, n),
    plays: 0,
    last: null,
    over: false,
    result: null,
  };
}

/** いまの順位 (先頭から)。 */
export function ranking(pos, stamp) {
  return pos
    .map((_, racer) => racer)
    .sort((a, b) => pos[b] - pos[a] || stamp[a] - stamp[b]);
}

/** racer を steps マス動かしたときの行き先と、マスの効果。 */
export function destination(pos, racer, steps) {
  if (steps < 0) return { to: Math.max(0, pos[racer] + steps), effect: null };
  let to = Math.min(GOAL, pos[racer] + steps);
  let effect = null;
  if (LEAVES.includes(to)) {
    to += 1;
    effect = 'leaf';
  } else if (PUDDLES.includes(to)) {
    to -= 1;
    effect = 'puddle';
  }
  return { to, effect };
}

export function act(state, seat, action, rng) {
  assert(!state.over, 'ゲームは終了しています');
  assert(action && action.type === 'play', '不明な操作です');
  assert(seat === state.turn, 'あなたの番ではありません');
  const hand = state.hands[seat];
  const index = action.card;
  assert(Number.isInteger(index) && index >= 0 && index < hand.length, 'カードを選んでください');
  const card = hand[index];
  let racer = card.racer;
  if (card.k !== 'go') {
    racer = action.racer;
    assert(Number.isInteger(racer) && racer >= 0 && racer < RACERS.length, 'だれを動かすか選んでください');
  }

  const from = state.pos[racer];
  const { to, effect } = destination(state.pos, racer, card.k === 'back' ? -card.v : card.v);
  state.pos[racer] = to;
  if (to !== from) state.stamp[racer] = state.clock++;
  hand.splice(index, 1);
  state.discard.push(card);
  state.plays++;
  state.last = { id: state.plays, seat, card, racer, from, to, effect };

  if (to >= GOAL) return finish(state);

  if (state.deck.length === 0) {
    state.deck = shuffle(rng, state.discard);
    state.discard = [];
  }
  hand.push(state.deck.pop());
  state.turn = (state.turn + 1) % state.n;
}

function finish(state) {
  state.over = true;
  const order = ranking(state.pos, state.stamp);
  const scores = state.fav.map((racer) => RANK_POINTS[order.indexOf(racer)]);
  state.result = makeResult(scores, { unit: '点', detail: { order, fav: state.fav.slice() } });
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  return {
    n: state.n,
    goal: GOAL,
    pos: state.pos,
    order: ranking(state.pos, state.stamp),
    turn: state.over ? -1 : state.turn,
    hand: mine ? state.hands[seat] : [],
    handSizes: state.hands.map((h) => h.length),
    // 推しは本人だけに見せる。レースが終わったら全員ぶんを公開する。
    myFav: mine ? state.fav[seat] : null,
    favs: state.over ? state.fav : null,
    deckCount: state.deck.length,
    last: state.last,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  return state.over ? [] : [state.turn];
}

export function bot(state, seat, rng) {
  const fav = state.fav[seat];
  const hand = state.hands[seat];
  let best = null;
  let bestScore = -Infinity;

  const consider = (card, index, racer) => {
    const steps = card.k === 'back' ? -card.v : card.v;
    const pos = state.pos.slice();
    pos[racer] = destination(state.pos, racer, steps).to;
    const rival = Math.max(...pos.filter((_, r) => r !== fav));
    // 推しがほかより前にいるほど良い。ゴールさせるなら、そのとき推しが何位かがすべて。
    let score = pos[fav] - rival;
    if (pos[racer] >= GOAL) score += racer === fav ? 100 : -30 + (pos[fav] - rival) * 3;
    // 推しばかり進めるとばれるので、ほかを進めても損の小さい手にも少し色をつける。
    if (racer !== fav && steps > 0 && pos[racer] < rival) score += 0.6;
    score += rng() * 1.2;
    if (score > bestScore) {
      bestScore = score;
      best = card.k === 'go' ? { type: 'play', card: index } : { type: 'play', card: index, racer };
    }
  };

  hand.forEach((card, index) => {
    if (card.k === 'go') consider(card, index, card.racer);
    else RACERS.forEach((_, racer) => consider(card, index, racer));
  });
  return best;
}
