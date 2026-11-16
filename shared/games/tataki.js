// たたき売り！ — 値段が下がっていく競り。最初に「買う！」と言った人のもの (2〜6人)
//
// ・品物が1つずつ出てきて、値段が1秒ごとに1コインずつ下がっていく。
// ・最初に「買う！」を押した人が、そのときの値段で手に入れる。だれも買わなければ売れ残り。
// ・品物の点数がそのまま得点。自分の「お目当て」の種類なら2倍。
// ・4種類すべてそろえるとボーナス。コインは点にならないので、上手に使い切りたい。
//
// 番のないリアルタイムのゲームなので、時間の進行は timer() と tick() でサーバーの時計にまかせる。

import { assert, makeResult } from './common.js';
import { randInt, shuffle } from '../rng.js';

export const meta = {
  id: 'tataki',
  name: 'たたき売り！',
  emoji: '🔔',
  tagline: '値段はどんどん下がる。待つほど安いが、先に買われたらおしまい',
  minPlayers: 2,
  maxPlayers: 6,
  time: '3〜5分',
  tags: ['わいわい', '競り', 'リアルタイム'],
  realtime: true,
};

export const CATEGORIES = {
  tsubo: { emoji: '🏺', name: 'つぼ' },
  e: { emoji: '🖼️', name: '絵' },
  yubiwa: { emoji: '💍', name: 'ゆびわ' },
  gakki: { emoji: '🎻', name: 'バイオリン' },
};
export const CATEGORY_IDS = Object.keys(CATEGORIES);

export const START_COINS = 20;
export const SET_BONUS = 5;
export const LUCKY_START = 12;
export const INTRO_MS = 2600;
export const TICK_MS = 1000;
export const SOLD_MS = 2400;
const VALUE_BAG = [1, 2, 2, 3, 3, 4, 4, 5];
const LUCKY_VALUES = [2, 3, 4, 5, 6];

function startPrice(item) {
  return item.lucky ? LUCKY_START : item.value * 2 + 4;
}

export function setup({ n, rng }) {
  const perCategory = Math.max(3, n);
  let items = [];
  for (const cat of CATEGORY_IDS) {
    const values = shuffle(rng, VALUE_BAG).slice(0, perCategory);
    for (const value of values) items.push({ cat, value, lucky: false });
  }
  items = shuffle(rng, items);
  // 6つに1つくらいは、中身のわからない福袋にする。
  const luckyCount = Math.round(items.length / 6);
  for (let k = 0; k < luckyCount; k++) {
    items[k] = { cat: CATEGORY_IDS[randInt(rng, CATEGORY_IDS.length)], value: LUCKY_VALUES[randInt(rng, LUCKY_VALUES.length)], lucky: true };
  }
  items = shuffle(rng, items);

  // お目当てはなるべくばらけさせる (5人以上だと同じお目当ての人が出てくる)。
  const order = shuffle(rng, CATEGORY_IDS);
  const fav = Array.from({ length: n }, (_, s) => order[s % order.length]);

  return {
    n,
    items,
    lot: 0,
    phase: 'intro', // intro: 品物のお披露目 / falling: 値下がり中 / sold: 結果の表示
    price: startPrice(items[0]),
    coins: new Array(n).fill(START_COINS),
    bought: Array.from({ length: n }, () => []),
    fav: shuffle(rng, fav),
    lastSale: null,
    nerve: Array.from({ length: n }, () => rng()),
    over: false,
    result: null,
  };
}

export function worthTo(state, seat, item) {
  return item.value * (item.cat === state.fav[seat] ? 2 : 1);
}

export function pointsOf(state, seat) {
  const items = state.bought[seat];
  const base = items.reduce((sum, item) => sum + worthTo(state, seat, item), 0);
  const kinds = new Set(items.map((item) => item.cat)).size;
  return base + (kinds === CATEGORY_IDS.length ? SET_BONUS : 0);
}

/** サーバーの時計に「何ミリ秒後に tick を呼んでほしいか」を伝える。 */
export function timer(state) {
  if (state.over) return null;
  if (state.phase === 'intro') return { ms: INTRO_MS, key: `intro:${state.lot}` };
  if (state.phase === 'falling') return { ms: TICK_MS, key: `fall:${state.lot}:${state.price}` };
  return { ms: SOLD_MS, key: `sold:${state.lot}` };
}

export function tick(state, rng) {
  if (state.over) return;
  if (state.phase === 'intro') {
    state.phase = 'falling';
    return;
  }
  if (state.phase === 'falling') {
    if (state.price > 1) {
      state.price--;
      return;
    }
    // 1コインでもだれも買わなかった。
    state.lastSale = { lot: state.lot, seat: -1, price: 0, item: state.items[state.lot] };
    state.phase = 'sold';
    return;
  }
  // 結果を見せ終わったので次の品物へ。
  if (state.lot + 1 >= state.items.length) {
    finish(state);
    return;
  }
  state.lot++;
  state.price = startPrice(state.items[state.lot]);
  state.phase = 'intro';
  state.nerve = state.nerve.map(() => rng());
}

function finish(state) {
  state.phase = 'over';
  state.over = true;
  const scores = state.coins.map((_, s) => pointsOf(state, s));
  // 同点なら、コインを多く残した人が上。
  state.result = makeResult(scores, { unit: '点', tiebreak: state.coins.slice(), detail: { coins: state.coins.slice() } });
}

export function act(state, seat, action) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && action.type === 'buy', '不明な操作です');
  // 押した瞬間に見ていた品物と違うものを買ってしまわないよう、何番目の品物かを確かめる。
  assert(action.lot === state.lot && state.phase === 'falling', 'その品物はもう買えません');
  assert(state.coins[seat] >= state.price, 'コインが足りません');
  const item = state.items[state.lot];
  state.coins[seat] -= state.price;
  state.bought[seat].push({ ...item, price: state.price });
  state.lastSale = { lot: state.lot, seat, price: state.price, item };
  state.phase = 'sold';
}

function mask(item) {
  return item.lucky ? { lucky: true } : item;
}

export function view(state) {
  const current = state.items[state.lot];
  const revealed = state.phase === 'sold' || state.over;
  return {
    n: state.n,
    lot: state.lot,
    lots: state.items.length,
    phase: state.phase,
    price: state.price,
    startPrice: startPrice(current),
    // 福袋の中身は、売れるまでだれにも見せない。
    item: revealed && state.lastSale?.seat >= 0 ? current : mask(current),
    upcoming: state.items.slice(state.lot + 1, state.lot + 4).map(mask),
    coins: state.coins,
    bought: state.bought,
    fav: state.fav,
    points: state.coins.map((_, s) => pointsOf(state, s)),
    lastSale: state.lastSale && { ...state.lastSale, item: state.lastSale.seat >= 0 ? state.lastSale.item : mask(state.lastSale.item) },
    tickMs: TICK_MS,
    introMs: INTRO_MS,
    over: state.over,
    result: state.result,
  };
}

/** リアルタイムなので「だれかの番」はない。 */
export function pending() {
  return [];
}

/** CPU は「この値段まで下がったら買う」という目安を持ち、そこに届いたら手を挙げる。 */
export function bot(state, seat) {
  if (state.over || state.phase !== 'falling') return null;
  const coins = state.coins[seat];
  if (coins < state.price) return null;
  const item = state.items[state.lot];
  const remaining = state.items.length - state.lot;

  let worth = item.lucky ? 4.5 : worthTo(state, seat, item);
  // 4種類そろえるボーナスに近づくなら、そのぶん高く買ってよい。
  const kinds = new Set(state.bought[seat].map((b) => b.cat));
  if (!item.lucky && !kinds.has(item.cat)) worth += SET_BONUS / CATEGORY_IDS.length;

  // これから出る品物に対して手持ちが多いほど、強気に買う。
  const expectedShare = Math.max(1, remaining / state.n);
  const pressure = Math.min(2.2, Math.max(0.6, coins / (expectedShare * 5)));
  const nerve = 0.45 + state.nerve[seat] * 0.4;
  let target = worth * nerve * pressure;
  // 最後のほうは、コインを残しても意味がないので使い切る。
  if (remaining <= 1) target = coins;
  return state.price <= Math.min(coins, target) ? { type: 'buy', lot: state.lot } : null;
}
