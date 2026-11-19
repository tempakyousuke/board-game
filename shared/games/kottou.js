// はったり骨董市 — 品物の本当の価値を知っているのは親だけ。その言い値を信じるか (2〜6人)
//
// ・毎回、1人が親になる。親だけが、品物の本当の価値 (1〜10両) を見る。
// ・親は「この品を いくらで買う」と言い値を宣言する (1〜10両)。本当の価値と関係なく、いくらと言ってもよい。
// ・ほかの人は、親のとなりから順に1回ずつ、「もっと高い値で買う」か「スルー」かを決める。
// ・1周したら、いちばん高い値を言った人がその値で買う。だれも言わなければ、親が自分の言い値で買い取る。
// ・買った人の得点は「本当の価値 − 払った値」。高く買いすぎれば、マイナスになる。
// ・親でない人が高づかみ (価値より高く買うこと) をしたら、その損した分が親の得点になる。
//
// 最後のルールがないと、親には高く言う理由がなく、読み合いにならない
// (親 対 買い手1人で、おたがいが得な打ち方に落ち着いた先を計算すると、親が価値より高く言う割合は 0% で、
//  1品あたりの損得は 親 +0.10・買い手 +1.10 だった。このルールを入れると 47%・親 +1.22・買い手 0.00 になった)。
// ガラクタを高く言って買わせるか、掘り出し物を安く言って自分で買い取るか。

import { assert, makeResult } from './common.js';
import { randInt, shuffle } from '../rng.js';

export const meta = {
  id: 'kottou',
  name: 'はったり骨董市',
  emoji: '🧐',
  tagline: '本当の価値を知るのは親だけ。その言い値、信じて横取りする？',
  minPlayers: 2,
  maxPlayers: 6,
  time: '5〜10分',
  tags: ['じっくり', 'ブラフ', '競り'],
  botDelayMs: 1000,
};

export const MAX_VALUE = 10;
// 全員が同じ回数だけ親になる。
export const TURNS_AS_DEALER = { 2: 6, 3: 4, 4: 3, 5: 3, 6: 2 };
// 本当の価値を見せる時間 (サーバーの時計で次の品物へ進む)。
export const REVEAL_MS = 5200;

export const ITEMS = [
  { emoji: '🏺', name: 'つぼ' },
  { emoji: '🖼️', name: '油絵' },
  { emoji: '🍵', name: '茶わん' },
  { emoji: '🕰️', name: '置き時計' },
  { emoji: '🗿', name: '石像' },
  { emoji: '📜', name: '巻物' },
  { emoji: '🎎', name: 'ひな人形' },
  { emoji: '⚱️', name: '香炉' },
  { emoji: '🗡️', name: '短刀' },
  { emoji: '🎻', name: 'バイオリン' },
  { emoji: '💍', name: 'ゆびわ' },
  { emoji: '👘', name: '着物' },
  { emoji: '🧸', name: 'ぬいぐるみ' },
  { emoji: '📻', name: 'ラジオ' },
  { emoji: '🎺', name: 'ラッパ' },
  { emoji: '🔭', name: '望遠鏡' },
  { emoji: '👑', name: 'かんむり' },
  { emoji: '🏮', name: 'ちょうちん' },
];

const fill = (n, value) => new Array(n).fill(value);

function startRound(state) {
  state.phase = 'declare'; // declare: 親が言い値を決める / bid: 順番に上乗せかスルー / reveal: 本当の価値を見せる
  state.dealer = (state.starter + state.round - 1) % state.n;
  state.ask = 0; // 親の言い値
  state.high = null; // いちばん高い上乗せ { seat, amount }
  state.calls = []; // 上乗せとスルーの流れ
  state.turn = state.dealer;
  state.outcome = null;
}

export function setup({ n, rng }) {
  const maxRounds = n * TURNS_AS_DEALER[n];
  const state = {
    n,
    round: 1,
    maxRounds,
    starter: randInt(rng, n),
    // 品物ごとの本当の価値。どの値も同じ見込みで出る。
    values: Array.from({ length: maxRounds }, () => 1 + randInt(rng, MAX_VALUE)),
    items: shuffle(rng, ITEMS.map((_, i) => i)).slice(0, maxRounds),
    points: fill(n, 0),
    history: [],
    over: false,
    result: null,
  };
  startRound(state);
  return state;
}

export const valueOf = (state) => state.values[state.round - 1];

/** いま、これより高い値を言わなければならない額。 */
export const priceNow = (state) => (state.high ? state.high.amount : state.ask);

/**
 * 売れたときの全員の損得。
 * 買った人は「価値 − 払った値」。親でない人の高づかみは、その分が親のものになる。
 */
export function gainsOf(n, dealer, buyer, price, value) {
  const gains = fill(n, 0);
  gains[buyer] += value - price;
  if (buyer !== dealer && price > value) gains[dealer] += price - value;
  return gains;
}

function settle(state) {
  const value = valueOf(state);
  const buyer = state.high ? state.high.seat : state.dealer;
  const price = priceNow(state);
  const gains = gainsOf(state.n, state.dealer, buyer, price, value);
  for (let s = 0; s < state.n; s++) state.points[s] += gains[s];
  state.outcome = { buyer, price, value, gains };
  state.history.push({ round: state.round, item: state.items[state.round - 1], dealer: state.dealer, ask: state.ask, buyer, price, value, gains });
  state.turn = -1;
  state.phase = 'reveal';
}

/** 番を次の人へ。1周したか、もうこれより高く言えないなら、売る。 */
function advance(state, seat) {
  const next = (seat + 1) % state.n;
  if (next === state.dealer || priceNow(state) >= MAX_VALUE) settle(state);
  else state.turn = next;
}

export function act(state, seat, action) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && typeof action.type === 'string', '不明な操作です');
  assert(state.phase === 'declare' || state.phase === 'bid', 'いまは操作できません');
  assert(seat === state.turn, 'あなたの番ではありません');

  if (state.phase === 'declare') {
    assert(action.type === 'ask', '言い値を決めてください');
    const { amount } = action;
    assert(Number.isInteger(amount) && amount >= 1 && amount <= MAX_VALUE, `言い値は 1〜${MAX_VALUE} で決めてください`);
    state.ask = amount;
    state.phase = 'bid';
    advance(state, seat);
    return;
  }

  if (action.type === 'raise') {
    const { amount } = action;
    assert(Number.isInteger(amount) && amount > priceNow(state) && amount <= MAX_VALUE, 'いまの値より高い値を言ってください');
    state.high = { seat, amount };
    state.calls.push({ seat, amount });
  } else {
    assert(action.type === 'pass', '不明な操作です');
    state.calls.push({ seat, pass: true });
  }
  advance(state, seat);
}

export function timer(state) {
  if (state.over || state.phase !== 'reveal') return null;
  return { ms: REVEAL_MS, key: `reveal:${state.round}` };
}

/** 本当の価値を見せ終わったので、次の品物へ。 */
export function tick(state) {
  if (state.over || state.phase !== 'reveal') return;
  if (state.round < state.maxRounds) {
    state.round++;
    startRound(state);
    return;
  }
  state.phase = 'over';
  state.over = true;
  // 同点なら、高づかみの少ない人を上にする。
  const burned = fill(state.n, 0);
  const bargains = fill(state.n, 0);
  for (const h of state.history) {
    if (h.gains[h.buyer] < 0) burned[h.buyer]++;
    if (h.gains[h.buyer] > 0) bargains[h.buyer]++;
  }
  state.result = makeResult(state.points.slice(), { unit: '両', detail: { burned, bargains }, tiebreak: burned.map((count) => -count) });
}

export function view(state, seat) {
  const open = state.phase === 'reveal' || state.over;
  return {
    n: state.n,
    round: state.round,
    maxRounds: state.maxRounds,
    turnsAsDealer: TURNS_AS_DEALER[state.n],
    phase: state.phase,
    dealer: state.dealer,
    turn: state.turn,
    item: ITEMS[state.items[state.round - 1]],
    // 本当の価値は、親にだけ見える。売れたら全員に見せる。
    value: open || seat === state.dealer ? valueOf(state) : null,
    ask: state.ask,
    high: state.high,
    price: priceNow(state),
    calls: state.calls,
    outcome: state.outcome,
    points: state.points,
    history: state.history.map((h) => ({ ...h, item: ITEMS[h.item] })),
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over || state.phase === 'reveal') return [];
  return [state.turn];
}

// ---- CPU -------------------------------------------------------------------
//
// 「相手がこう打つなら、こう打つのが得」を親と買い手でくり返し、落ち着いた先の打ち方を使う。
// 親 対 買い手1人・上乗せは「言い値 + 1」という形で計算する。買い手が何人いても、
// 親にとって大事なのは「だれかが上乗せするかどうか」なので、読み合いの形は同じになる。
//
// 勝ち負けは点の差で決まるので、自分の得だけでなく「相手に得をさせない」ことも数える。
// 2人なら、相手の1両の得は自分の1両の損と同じ。人数が増えるほど、その重みは軽くなる (1 / (人数 − 1))。
// (自分の得だけで計算した表だと、2人のとき「買い手はいつもスルー」が勝率 58% になった。
//  スルーされると、親ははったりの品を自分で買い取るしかないため。)

// 人は理屈どおりには言わない。その分として、素直な言い方 (価値より 1〜3 安く言う) を少しまぜて考える。
// こうしておくと、理屈では出てこない言い値 (1 や 9 など) を言われても、買い手が返事を決められる。
// CPU の親も、この割合で本当に素直な言い方をする (そうしないと、買い手の読みが CPU の親に合わなくなる)。
const TREMBLE = 0.1;
const SOLVE_ROUNDS = 20000;
// 1位になれるのは1人だけなので、人数が多いほど、損得が五分より少し悪い勝負にも出る値打ちがある。
// 買い手がそう考える分だけ、上乗せを得に数える (その分、親ははったりを増やす)。
// (これを入れないと、6人のとき「いつも上乗せ」するだけで勝率が 27% になった。互角なら 17%。入れると 15%。)
export const GAMBLE_BY_PLAYERS = { 2: 0, 3: 0.1, 4: 0.25, 5: 0.4, 6: 0.5 };

function plainAsk(value, ask) {
  let odds = 0;
  for (let cut = 1; cut <= 3; cut++) if (Math.max(1, value - cut) === ask) odds += 1 / 3;
  return odds;
}

/**
 * 価値 value の品に親が ask と言ったときの、親と買い手の損得 [親, 買い手]。
 * taken: 買い手が ask + 1 で上乗せしたか。
 */
function gainPair(value, ask, taken) {
  if (!taken) return [value - ask, 0];
  return [Math.max(0, ask + 1 - value), value - ask - 1];
}

const tables = {};

/**
 * CPU の打ち方の表 (人数ごと)。
 *   says[value][ask]  … 親が価値 value の品に ask と言う割合
 *   takes[ask]        … 言い値 ask に、(買い手全体として) だれかが上乗せする割合
 *   mean[ask]         … 言い値 ask の品の、価値の見込み
 */
export function cpuTable(n) {
  if (tables[n]) return tables[n];
  const rival = 1 / (n - 1); // 相手の得を、どのくらい自分の損として数えるか
  const gamble = GAMBLE_BY_PLAYERS[n];
  const range = Array.from({ length: MAX_VALUE }, (_, i) => i + 1);
  const says = Array.from({ length: MAX_VALUE + 1 }, () => fill(MAX_VALUE + 1, 0));
  const takes = fill(MAX_VALUE + 1, 0);
  for (const value of range) for (const ask of range) says[value][ask] = 1 / MAX_VALUE;
  for (const ask of range) takes[ask] = 0.5;
  // 価値 value・言い値 ask の組が、どのくらい出るか (素直な言い方をまぜたもの)。
  const weight = (value, ask, rounds) => (1 - TREMBLE) * (says[value][ask] / rounds) + TREMBLE * plainAsk(value, ask);
  const dealerSide = ([dealer, buyer]) => dealer - rival * buyer;
  const buyerSide = ([dealer, buyer]) => buyer - rival * dealer;

  for (let rounds = 1; rounds <= SOLVE_ROUNDS; rounds++) {
    // 親: いまの買い手に対して、いちばん得な言い値。
    const best = fill(MAX_VALUE + 1, 1);
    for (const value of range) {
      let top = -Infinity;
      for (const ask of range) {
        const take = ask < MAX_VALUE ? takes[ask] / rounds : 0;
        const gain = (1 - take) * dealerSide(gainPair(value, ask, false)) + take * dealerSide(gainPair(value, ask, true));
        if (gain > top + 1e-12) {
          top = gain;
          best[value] = ask;
        }
      }
    }
    // 買い手: いまの親に対して、上乗せとスルーのどちらが得か。
    const take = fill(MAX_VALUE + 1, 0);
    for (const ask of range) {
      if (ask >= MAX_VALUE) continue;
      let edge = 0;
      for (const value of range) edge += weight(value, ask, rounds) * (buyerSide(gainPair(value, ask, true)) + gamble - buyerSide(gainPair(value, ask, false)));
      take[ask] = edge > 1e-12 ? 1 : 0;
    }
    for (const value of range) says[value][best[value]] += 1;
    for (const ask of range) takes[ask] += take[ask];
  }

  const total = SOLVE_ROUNDS + 1;
  const mean = fill(MAX_VALUE + 1, 0);
  for (const ask of range) {
    let mass = 0;
    let sum = 0;
    for (const value of range) {
      const w = weight(value, ask, total);
      mass += w;
      sum += w * value;
    }
    mean[ask] = mass > 0 ? sum / mass : ask;
  }
  for (const value of range) {
    // めったに言わない値は切りすてる。
    const row = says[value].map((count) => (count / total >= 0.03 ? count : 0));
    const sum = row.reduce((a, b) => a + b, 0);
    says[value] = row.map((count) => count / sum);
  }
  // 上限の言い値には、だれも乗れない。
  tables[n] = { says, takes: takes.map((count, ask) => (ask >= MAX_VALUE ? 0 : count / total)), mean };
  return tables[n];
}

function botAsk(state, rng) {
  const value = valueOf(state);
  // たまに、素直に言う。
  if (rng() < TREMBLE) return { type: 'ask', amount: Math.max(1, value - 1 - randInt(rng, 3)) };
  const row = cpuTable(state.n).says[value];
  let roll = rng();
  for (let ask = 1; ask <= MAX_VALUE; ask++) {
    roll -= row[ask];
    if (roll < 0) return { type: 'ask', amount: ask };
  }
  return { type: 'ask', amount: Math.max(1, value - 2) };
}

// 親のくせを、どのくらい本気にするか。
const HABIT_WEIGHT = 1.2;
const HABIT_PRIOR = 2;

/**
 * その親の、これまでのくせ (−1〜+1)。
 * プラス: 言い値に上乗せすれば得だったことが多い (安く言う人)。マイナス: 高づかみになったことが多い (はったりの多い人)。
 * 本当の価値は毎回全員に見えるので、人もCPUも同じものを見ている。
 */
export function habitOf(state, dealer) {
  let sum = 0;
  let count = 0;
  for (const h of state.history) {
    if (h.dealer !== dealer) continue;
    sum += Math.sign(h.value - (h.ask + 1));
    count++;
  }
  return sum / (count + HABIT_PRIOR);
}

function botBid(state, rng) {
  const { takes, mean } = cpuTable(state.n);
  const price = priceNow(state);
  if (price >= MAX_VALUE) return { type: 'pass' };
  const habit = habitOf(state, state.dealer);
  if (!state.high) {
    // 表の割合を、親のくせに合わせてずらす (はったりの多い親には乗らない。安く言う親には乗る)。
    const base = takes[state.ask];
    const lean = Math.exp(HABIT_WEIGHT * habit);
    const take = base >= 1 ? 1 : (base * lean) / (base * lean + 1 - base);
    // 買い手が何人いても、「だれかが上乗せする」見込みが同じになるように、1人あたりに分ける。
    const each = 1 - Math.pow(1 - take, 1 / (state.n - 1));
    return rng() < each ? { type: 'raise', amount: price + 1 } : { type: 'pass' };
  }
  // もう上乗せが出ている。価値の見込みがまだ上なら、さらに上を言う。
  return mean[state.ask] + habit - (price + 1) > 0.3 ? { type: 'raise', amount: price + 1 } : { type: 'pass' };
}

export function bot(state, seat, rng) {
  if (state.over || seat !== state.turn) return null;
  if (state.phase === 'declare') return botAsk(state, rng);
  if (state.phase === 'bid') return botBid(state, rng);
  return null;
}
