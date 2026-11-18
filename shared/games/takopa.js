// ロシアンたこパ — わさび入りを仕込み、「何個食べられるか」を宣言し合うブラフゲーム (3〜6人)
//
// 1. 仕込み: 全員が同時に、たこ焼き3個の皿をこっそり用意する。わさび入りは0個か1個 (何番目かも決める)。
// 2. 宣言: 親から順に「◯個食べられる」と数を上げるか、パスする。最後まで残った人が挑戦者。
// 3. 賭け: 挑戦者以外の全員が、同時にこっそり「成功 / 失敗」に賭ける。
// 4. 挑戦: まず自分の皿を手前から食べ、足りないぶんは他の人の皿を手前から1個ずつ食べる。
//    食べきれば宣言した数が得点。わさびに当たると、宣言した数だけ失点し、その点は仕込んだ人のものになる。
//
// 「わさび係はだれだ」(wasabi.js) も同じ進め方で、わさびを入れるのが毎回ランダムな1人だけになる。

import { assert, makeResult } from './common.js';
import { randInt } from '../rng.js';

export const meta = {
  id: 'takopa',
  name: 'ロシアンたこパ',
  emoji: '🐙',
  tagline: 'わさび入りはどの皿？ 宣言した数だけ食べきれるか',
  minPlayers: 3,
  maxPlayers: 6,
  time: '10分',
  tags: ['わいわい', 'ブラフ', '読み合い'],
};

export const SLOTS = 3;
// 宣言した数が、そのまま賭け金になる: 成功すれば +宣言した数、失敗すれば −宣言した数で、
// その点はわさびを仕込んだ人のものになる。
// (失敗 −3点・仕込んだ人 +3点の固定だと、CPU 同士の試算で、わさびを入れない人の得点が
//  入れた人の2倍になり、仕込むうまみがなかった。)
export const BET_REWARD = 1;
// 親が全員に同じ回数まわるようにする。
export const ROUNDS_BY_PLAYERS = { 3: 6, 4: 8, 5: 5, 6: 6 };

const fill = (n, value) => new Array(n).fill(value);

function startRound(state) {
  state.phase = 'setup'; // setup: 仕込み / bid: 宣言 / bet: 賭け / eat: 挑戦 / result: 結果を見る
  state.choices = fill(state.n, null); // 0 = わさびなし, 1〜3 = わさびを入れる位置
  state.plates = null; // 席ごとの皿。true がわさび入り
  state.trapper = -1; // わさび係 (role のときだけ)
  state.bid = null; // { seat, amount }
  state.passed = fill(state.n, false);
  state.calls = []; // 宣言とパスの流れ
  state.turn = -1;
  state.challenger = -1;
  state.need = 0;
  state.bets = fill(state.n, null); // true: 成功 / false: 失敗
  state.eaten = fill(state.n, 0); // 皿ごとに、手前から何個食べられたか
  state.log = []; // 食べた順 { plate, slot, wasabi }
  state.outcome = null;
}

/** mode: 'free' = 全員が自由に仕込む / 'role' = わさびを入れるのはランダムな1人だけ */
export function setupWith({ n, rng }, mode) {
  const state = {
    n,
    mode,
    round: 1,
    maxRounds: ROUNDS_BY_PLAYERS[n],
    dealer: randInt(rng, n),
    points: fill(n, 0),
    wins: fill(n, 0), // 挑戦に成功した回数
    traps: fill(n, 0), // わさびを食べさせた回数
    hits: fill(n, 0), // 賭けを当てた回数
    over: false,
    result: null,
  };
  startRound(state);
  return state;
}

export function setup(args) {
  return setupWith(args, 'free');
}

export const maxBid = (state) => SLOTS * state.n;

function nextActive(state, from) {
  for (let step = 1; step <= state.n; step++) {
    const seat = (from + step) % state.n;
    if (!state.passed[seat]) return seat;
  }
  return from;
}

function beginBidding(state, rng) {
  if (state.mode === 'role') {
    // 全員が「自分が係になったらここに入れる」を先に決めておき、そのあとで係をこっそり決める。
    state.trapper = randInt(rng, state.n);
    state.plates = state.choices.map((slot, seat) => Array.from({ length: SLOTS }, (_, k) => seat === state.trapper && slot === k + 1));
  } else {
    state.plates = state.choices.map((slot) => Array.from({ length: SLOTS }, (_, k) => slot === k + 1));
  }
  state.phase = 'bid';
  state.turn = state.dealer;
}

function endBidding(state) {
  state.challenger = state.bid.seat;
  state.need = state.bid.amount;
  state.turn = -1;
  state.phase = 'bet';
}

export function act(state, seat, action, rng) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && typeof action.type === 'string', '不明な操作です');

  switch (action.type) {
    case 'next': {
      assert(state.phase === 'result', 'まだ次のラウンドには進めません');
      state.round++;
      state.dealer = (state.dealer + 1) % state.n;
      startRound(state);
      return;
    }
    case 'plate': {
      assert(state.phase === 'setup', 'いまは仕込めません');
      const { slot } = action;
      const lowest = state.mode === 'role' ? 1 : 0;
      assert(Number.isInteger(slot) && slot >= lowest && slot <= SLOTS, 'わさびを入れる場所を選んでください');
      // 全員がそろうまでは選び直せる。
      state.choices[seat] = slot;
      if (state.choices.every((choice) => choice !== null)) beginBidding(state, rng);
      return;
    }
    case 'bid': {
      assert(state.phase === 'bid', 'いまは宣言できません');
      assert(seat === state.turn, 'あなたの番ではありません');
      const { amount } = action;
      const lowest = (state.bid?.amount ?? 0) + 1;
      assert(Number.isInteger(amount) && amount >= lowest && amount <= maxBid(state), 'いまの宣言より多い数を言ってください');
      state.bid = { seat, amount };
      state.calls.push({ seat, amount });
      const next = nextActive(state, seat);
      // 全部食べると言ったら、それ以上はないので打ち切る。
      if (amount === maxBid(state) || next === seat) endBidding(state);
      else state.turn = next;
      return;
    }
    case 'pass': {
      assert(state.phase === 'bid', 'いまはパスできません');
      assert(seat === state.turn, 'あなたの番ではありません');
      assert(state.bid !== null, '親は最初の宣言をしなければなりません');
      state.passed[seat] = true;
      state.calls.push({ seat, pass: true });
      const active = state.passed.filter((out) => !out).length;
      if (active === 1) endBidding(state);
      else state.turn = nextActive(state, seat);
      return;
    }
    case 'bet': {
      assert(state.phase === 'bet', 'いまは賭けられません');
      assert(seat !== state.challenger, '挑戦する人は賭けません');
      assert(typeof action.success === 'boolean', '「成功」か「失敗」を選んでください');
      // 全員がそろうまでは選び直せる。
      state.bets[seat] = action.success;
      const waiting = state.bets.some((bet, s) => s !== state.challenger && bet === null);
      if (!waiting) state.phase = 'eat';
      return;
    }
    case 'eat': {
      assert(state.phase === 'eat', 'いまは食べられません');
      assert(seat === state.challenger, '挑戦しているのは別の人です');
      const { plate } = action;
      assert(Number.isInteger(plate) && plate >= 0 && plate < state.n, 'どの皿から食べるかを選んでください');
      if (state.eaten[seat] < Math.min(SLOTS, state.need)) assert(plate === seat, 'まず自分の皿から食べます');
      assert(state.eaten[plate] < SLOTS, 'その皿はもう空です');
      const slot = state.eaten[plate];
      const wasabi = state.plates[plate][slot];
      state.eaten[plate]++;
      state.log.push({ plate, slot, wasabi });
      if (wasabi) settle(state, false, plate);
      else if (state.log.length === state.need) settle(state, true, -1);
      return;
    }
    default:
      assert(false, '不明な操作です');
  }
}

function settle(state, success, hit) {
  const c = state.challenger;
  const gains = fill(state.n, 0);
  if (success) {
    gains[c] += state.need;
    state.wins[c]++;
  } else {
    gains[c] -= state.need;
    if (hit !== c) {
      gains[hit] += state.need;
      state.traps[hit]++;
    }
  }
  for (let s = 0; s < state.n; s++) {
    if (s !== c && state.bets[s] === success) {
      gains[s] += BET_REWARD;
      state.hits[s]++;
    }
  }
  for (let s = 0; s < state.n; s++) state.points[s] += gains[s];
  state.outcome = { success, hit, gains };

  if (state.round < state.maxRounds) {
    state.phase = 'result';
    return;
  }
  state.phase = 'over';
  state.over = true;
  // 同点なら、挑戦に成功した回数が多い人を上にする。
  state.result = makeResult(state.points.slice(), {
    unit: '点',
    detail: { wins: state.wins.slice(), traps: state.traps.slice(), hits: state.hits.slice() },
    tiebreak: state.wins.slice(),
  });
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  const open = state.phase === 'result' || state.over;
  return {
    n: state.n,
    mode: state.mode,
    slots: SLOTS,
    maxBid: maxBid(state),
    betReward: BET_REWARD,
    round: state.round,
    maxRounds: state.maxRounds,
    dealer: state.dealer,
    phase: state.phase,
    ready: state.choices.map((choice) => choice !== null),
    myChoice: mine ? state.choices[seat] : null,
    // 皿の中身は、食べられた分と自分の皿だけが見える。結果の場面では全部ひらく。
    plates: state.plates
      ? state.plates.map((plate, s) => plate.map((wasabi, k) => (open || s === seat || k < state.eaten[s] ? (wasabi ? 'wasabi' : 'safe') : null)))
      : null,
    // わさび係かどうかは本人にしか知らせない。結果の場面で全員に明かす。
    myRole: state.mode === 'role' && mine && state.plates ? (seat === state.trapper ? 'wasabi' : 'clean') : null,
    trapper: open ? state.trapper : -1,
    bid: state.bid,
    passed: state.passed,
    calls: state.calls,
    turn: state.turn,
    challenger: state.challenger,
    need: state.need,
    // だれが賭け終えたかだけを見せる。中身は結果まで本人にしか見せない。
    betDone: state.bets.map((bet) => bet !== null),
    myBet: mine ? state.bets[seat] : null,
    bets: open ? state.bets : null,
    eaten: state.eaten,
    log: state.log,
    outcome: state.outcome,
    points: state.points,
    wins: state.wins,
    traps: state.traps,
    hits: state.hits,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  const everyone = Array.from({ length: state.n }, (_, s) => s);
  if (state.phase === 'setup') return everyone.filter((s) => state.choices[s] === null);
  if (state.phase === 'bid') return [state.turn];
  if (state.phase === 'bet') return everyone.filter((s) => s !== state.challenger && state.bets[s] === null);
  if (state.phase === 'eat') return [state.challenger];
  return everyone;
}

// ---- CPU -------------------------------------------------------------------
//
// ほかの人の皿について「わさびが何番目にありそうか」を、宣言のしかたと、すでに食べられた分から見積もる。
// 自分の皿より先まで宣言した人は、たぶんわさびを入れていない (はったりの分だけ割り引く)。

// わさびを入れた人が、自分のわさびより先まで宣言している (はったり) 見込み。
// 係が1人だけのときは、まぎれるために強気に出る人が多いとみる。
const BLUFF = { free: 0.55, role: 0.75 };
const FREE_PRIOR = [0.58, 0.13, 0.14, 0.15]; // わさびなし / 1番目 / 2番目 / 3番目

/** その人がこのラウンドで宣言した、いちばん大きい数。 */
function claimOf(state, seat) {
  let best = 0;
  for (const call of state.calls) if (call.seat === seat && !call.pass) best = Math.max(best, call.amount);
  return best;
}

/**
 * viewer から見た、plate の皿のわさびの位置の見込み [なし, 1番目, 2番目, 3番目]。
 * role のときは「ほかの人のうち、ちょうど1人が係」なので、係である見込みを全員ぶん合わせて 1 にする。
 */
function beliefs(state, viewer) {
  const out = [];
  const claims = Array.from({ length: state.n }, (_, s) => claimOf(state, s));
  // 自分の皿の分だけで宣言できるのに、すぐパスした人は少しあやしい。
  const shy = (s) => state.passed[s] && claims[s] < SLOTS;
  for (let j = 0; j < state.n; j++) {
    if (j === viewer) {
      const slot = state.plates[j].indexOf(true) + 1;
      out.push([0, 1, 2, 3].map((w) => (w === slot ? 1 : 0)));
      continue;
    }
    const weights = [0, 0, 0, 0];
    for (let w = 0; w <= SLOTS; w++) {
      if (w > 0 && w <= state.eaten[j]) continue; // そこはもう食べられて、安全だった
      let prior;
      if (state.mode === 'role') prior = w === 0 ? 0 : 1 / SLOTS;
      else prior = FREE_PRIOR[w];
      const likelihood = w === 0 ? (shy(j) ? 0.6 : 1) : claims[j] >= w ? BLUFF[state.mode] : 1;
      weights[w] = prior * likelihood;
    }
    out.push(weights);
  }
  if (state.mode === 'role') {
    // 係は自分か、ほかのだれか1人。
    const iAmTrapper = state.plates[viewer].includes(true);
    const total = out.reduce((sum, weights, j) => (j === viewer ? sum : sum + weights[1] + weights[2] + weights[3]), 0);
    for (let j = 0; j < state.n; j++) {
      if (j === viewer) continue;
      const scale = iAmTrapper || total === 0 ? 0 : 1 / total;
      const trap = [1, 2, 3].map((w) => out[j][w] * scale);
      out[j] = [1 - trap[0] - trap[1] - trap[2], ...trap];
    }
  } else {
    for (let j = 0; j < state.n; j++) {
      const total = out[j].reduce((a, b) => a + b, 0) || 1;
      out[j] = out[j].map((v) => v / total);
    }
  }
  return out;
}

/** plate の皿を、いまからさらに depth 個食べたときに、わさびに当たる見込み。 */
function badness(state, belief, plate, depth) {
  let bad = 0;
  for (let w = state.eaten[plate] + 1; w <= Math.min(SLOTS, state.eaten[plate] + depth); w++) bad += belief[plate][w];
  return bad;
}

/** seat が、ほかの人の皿からあと extra 個食べるときの、いちばん安全な食べ方の成功率。 */
function bestOdds(state, seat, belief, extra) {
  const others = Array.from({ length: state.n }, (_, s) => s).filter((s) => s !== seat);
  const room = others.reduce((sum, s) => sum + SLOTS - state.eaten[s], 0);
  if (extra > room) return 0;
  let best = 0;
  const walk = (index, left, bad, safe) => {
    const odds = state.mode === 'role' ? 1 - bad : safe;
    if (odds <= best) return;
    if (index === others.length) {
      if (left === 0) best = odds;
      return;
    }
    const plate = others[index];
    for (let depth = Math.min(SLOTS - state.eaten[plate], left); depth >= 0; depth--) {
      const b = badness(state, belief, plate, depth);
      walk(index + 1, left - depth, bad + b, safe * (1 - b));
    }
  };
  walk(0, extra, 0, 1);
  return best;
}

function botPlate(state, seat, rng) {
  if (state.mode === 'role') return { type: 'plate', slot: 1 + randInt(rng, SLOTS) };
  // 親は最初に宣言しなければならないので、仕込むのはひかえめにし、入れるなら奥にする。
  const dealer = seat === state.dealer;
  if (rng() > (dealer ? 0.25 : 0.42)) return { type: 'plate', slot: 0 };
  const roll = rng();
  if (dealer) return { type: 'plate', slot: roll < 0.2 ? 2 : 3 };
  return { type: 'plate', slot: roll < 0.3 ? 1 : roll < 0.62 ? 2 : 3 };
}

function botBid(state, seat, rng) {
  const current = state.bid?.amount ?? 0;
  const own = state.plates[seat].indexOf(true) + 1; // 0 = 自分の皿は安全
  const safeOwn = own === 0 ? SLOTS : own - 1; // 自分の皿を、手前から何個まで安全に食べられるか
  const belief = beliefs(state, seat);
  const rivals = state.passed.filter((out, s) => !out && s !== seat).length;

  // 本当に食べきれそうな、いちばん大きい数。
  let honest = safeOwn;
  if (own === 0) {
    const nerve = 0.55 + rng() * 0.2; // 失敗すると同じだけ失うので、五分より分がよくないと上げない
    for (let target = SLOTS + 1; target <= maxBid(state); target++) {
      const odds = bestOdds(state, seat, belief, target - SLOTS);
      if (odds < nerve) break;
      honest = target;
    }
  }
  if (current < honest) {
    // たいていは1つずつ上げる。ときどき思いきって飛ばす。
    const amount = rng() < 0.7 ? current + 1 : current + 1 + randInt(rng, honest - current);
    return { type: 'bid', amount };
  }
  if (state.bid === null) return { type: 'bid', amount: 1 }; // 親は言うしかない
  // はったり: わさびを入れているのに、平気な顔で上げる。競っている人が多いほど、押しつけやすい。
  // 自分の皿の分 (3個) までは、入れていない人と同じように言っておかないと、すぐにばれる。
  if (own > 0) {
    const crowd = rivals >= 2;
    const role = state.mode === 'role';
    let nerve = 0;
    if (current + 1 <= SLOTS) nerve = crowd ? (role ? 0.85 : 0.6) : role ? 0.25 : 0.3;
    else if (current + 1 <= SLOTS + 2) nerve = crowd ? (role ? 0.5 : 0.3) : 0.06;
    else if (role && current + 1 <= SLOTS + 4) nerve = crowd ? 0.25 : 0;
    if (rng() < nerve) return { type: 'bid', amount: current + 1 };
  }
  return { type: 'pass' };
}

function botBet(state, seat, rng) {
  const c = state.challenger;
  const belief = beliefs(state, seat);
  // 挑戦者が自分の皿で自滅する見込み。
  const ownDepth = Math.min(SLOTS, state.need);
  let odds = 1 - (belief[c][1] * (ownDepth >= 1) + belief[c][2] * (ownDepth >= 2) + belief[c][3] * (ownDepth >= 3));
  // 残りは、ほかの皿を「わさびの濃さ」が平均くらいの順に食べるとみなす。
  const extra = state.need - SLOTS;
  if (extra > 0) {
    const others = Array.from({ length: state.n }, (_, s) => s).filter((s) => s !== c);
    const density = others.reduce((sum, s) => sum + belief[s][1] + belief[s][2] + belief[s][3], 0) / (others.length * SLOTS);
    // 挑戦者は読んで選ぶので、でたらめに食べるよりは当たりにくい。
    odds *= (1 - density * 0.7) ** extra;
  }
  return { type: 'bet', success: odds + (rng() - 0.5) * 0.2 >= 0.5 };
}

function botEat(state, seat, rng) {
  if (state.eaten[seat] < Math.min(SLOTS, state.need)) return { type: 'eat', plate: seat };
  const belief = beliefs(state, seat);
  let best = -1;
  let bestRisk = Infinity;
  for (let plate = 0; plate < state.n; plate++) {
    if (plate === seat || state.eaten[plate] >= SLOTS) continue;
    const risk = badness(state, belief, plate, 1) + rng() * 0.03;
    if (risk < bestRisk) {
      bestRisk = risk;
      best = plate;
    }
  }
  return { type: 'eat', plate: best };
}

export function bot(state, seat, rng) {
  if (state.phase === 'result') return { type: 'next' };
  if (state.phase === 'setup') return botPlate(state, seat, rng);
  if (state.phase === 'bid') return botBid(state, seat, rng);
  if (state.phase === 'bet') return botBet(state, seat, rng);
  if (state.phase === 'eat') return botEat(state, seat, rng);
  return null;
}
