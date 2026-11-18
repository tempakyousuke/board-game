// つみあげ注意 — 全員で1本の塔に札を積み、上から何枚めくれるかを宣言し合うブラフゲーム (3〜6人)
//
// ・各自、たこ焼き3枚とわさび1枚を持つ。
// ・自分の番には、1枚を伏せて塔のいちばん上に置くか、「上から N 枚めくる」と宣言する。
//   (最初の1周は置くだけ。全員が1枚置いてから、宣言できるようになる。手札がなくなった人は宣言するしかない。)
// ・宣言が出たら、あとの人は順に「もっと多く」か「パス」。最後まで残った人が挑戦者。
// ・挑戦者は、塔の上から宣言した枚数をめくる。順番は選べない。
//   全部たこ焼きなら、宣言した数が得点。わさびが出たら、宣言した数だけ失点し、その点はわさびを置いた人のものになる。
// ・だれが何番目に置いたかは全員に見えている。中身は置いた本人しか知らない。
//
// いちばん上の札の中身を知っているのは、直前に置いた人だけ。宣言する人は、その人を信じることになる。
// 自分のわさびが上の方にあるときに平気な顔で宣言すれば、上げた人に踏ませられる。だれも上げなければ、自分で踏む。

import { assert, makeResult } from './common.js';
import { randInt } from '../rng.js';

export const meta = {
  id: 'tsumiage',
  name: 'つみあげ注意',
  emoji: '🗼',
  tagline: '1本の塔に伏せて積む。上から何枚、めくれる？',
  minPlayers: 3,
  maxPlayers: 6,
  time: '5〜10分',
  tags: ['じっくり', 'ブラフ', '読み合い'],
};

export const SAFE_CARDS = 3;
export const WASABI_CARDS = 1;
// 最初に置く人が全員に同じ回数まわるようにする。
export const ROUNDS_BY_PLAYERS = { 3: 6, 4: 8, 5: 5, 6: 6 };
// めくるのは自動で、1枚ずつ間をおく (サーバーの時計で進む)。
export const FLIP_LEAD_MS = 900;
export const FLIP_STEP_MS = 1000;

const fill = (n, value) => new Array(n).fill(value);

function startRound(state) {
  state.phase = 'stack'; // stack: 積む / bid: 宣言 / flip: めくる / result: 結果を見る
  state.hands = Array.from({ length: state.n }, () => ({ safe: SAFE_CARDS, wasabi: WASABI_CARDS }));
  state.tower = []; // 下から順。{ seat, wasabi, late }
  state.turn = state.starter;
  state.bid = null; // { seat, amount }
  state.passed = fill(state.n, false);
  state.calls = [];
  state.challenger = -1;
  state.need = 0;
  state.flipped = 0; // 上から何枚めくったか
  state.outcome = null;
}

export function setup({ n, rng }) {
  const state = {
    n,
    round: 1,
    maxRounds: ROUNDS_BY_PLAYERS[n],
    starter: randInt(rng, n),
    points: fill(n, 0),
    wins: fill(n, 0),
    traps: fill(n, 0),
    flipId: 0,
    over: false,
    result: null,
  };
  startRound(state);
  return state;
}

const handSize = (hand) => hand.safe + hand.wasabi;

/** 全員が1枚は置いたか (それまでは宣言できない)。 */
export function everyonePlaced(state) {
  const placed = fill(state.n, false);
  for (const card of state.tower) placed[card.seat] = true;
  return placed.every(Boolean);
}

function nextActive(state, from) {
  for (let step = 1; step <= state.n; step++) {
    const seat = (from + step) % state.n;
    if (!state.passed[seat]) return seat;
  }
  return from;
}

function endBidding(state) {
  state.challenger = state.bid.seat;
  state.need = state.bid.amount;
  state.turn = -1;
  state.phase = 'flip';
  state.flipped = 0;
  state.flipId++;
}

function declare(state, seat, amount) {
  assert(everyonePlaced(state), '全員が1枚置くまでは、宣言できません');
  const lowest = (state.bid?.amount ?? 0) + 1;
  assert(Number.isInteger(amount) && amount >= lowest && amount <= state.tower.length, state.bid ? 'いまの宣言より多い枚数を言ってください' : '枚数が正しくありません');
  state.bid = { seat, amount };
  state.calls.push({ seat, amount });
  const next = nextActive(state, seat);
  if (amount === state.tower.length || next === seat) endBidding(state);
  else {
    state.phase = 'bid';
    state.turn = next;
  }
}

export function act(state, seat, action) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && typeof action.type === 'string', '不明な操作です');

  if (action.type === 'next') {
    assert(state.phase === 'result', 'まだ次のラウンドには進めません');
    state.round++;
    state.starter = (state.starter + 1) % state.n;
    startRound(state);
    return;
  }

  assert(state.phase === 'stack' || state.phase === 'bid', 'いまは操作できません');
  assert(seat === state.turn, 'あなたの番ではありません');

  if (action.type === 'place') {
    assert(state.phase === 'stack', '宣言が出たあとは、もう積めません');
    const kind = action.card;
    assert(kind === 'safe' || kind === 'wasabi', '置く札を選んでください');
    assert(state.hands[seat][kind] > 0, 'その札はもう持っていません');
    state.hands[seat][kind]--;
    // late: 宣言もできたのに、置く方を選んだ札 (最初の1周より後の札)。
    state.tower.push({ seat, wasabi: kind === 'wasabi', late: everyonePlaced(state) });
    state.turn = (seat + 1) % state.n;
    return;
  }

  if (action.type === 'bid') {
    // 最初の宣言、または、宣言が出ているときの「もっと多く」。
    declare(state, seat, action.amount);
    return;
  }

  assert(action.type === 'pass', '不明な操作です');
  assert(state.phase === 'bid', '宣言が出るまでは、パスできません');
  state.passed[seat] = true;
  state.calls.push({ seat, pass: true });
  if (state.passed.filter((out) => !out).length === 1) endBidding(state);
  else state.turn = nextActive(state, seat);
}

export function timer(state) {
  if (state.over || state.phase !== 'flip') return null;
  return { ms: state.flipped === 0 ? FLIP_LEAD_MS : FLIP_STEP_MS, key: `flip:${state.flipId}:${state.flipped}` };
}

/** 塔の上から1枚めくる。 */
export function tick(state) {
  if (state.over || state.phase !== 'flip') return;
  const card = state.tower[state.tower.length - 1 - state.flipped];
  state.flipped++;
  if (card.wasabi) settle(state, false, card.seat);
  else if (state.flipped === state.need) settle(state, true, -1);
}

function settle(state, success, hit) {
  const c = state.challenger;
  const gains = fill(state.n, 0);
  if (success) {
    gains[c] += state.need;
    state.wins[c]++;
  } else {
    // 宣言した数が、そのまま賭け金になる。
    gains[c] -= state.need;
    if (hit !== c) {
      gains[hit] += state.need;
      state.traps[hit]++;
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
    detail: { wins: state.wins.slice(), traps: state.traps.slice() },
    tiebreak: state.wins.slice(),
  });
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  const open = state.phase === 'result' || state.over;
  const height = state.tower.length;
  return {
    n: state.n,
    round: state.round,
    maxRounds: state.maxRounds,
    starter: state.starter,
    phase: state.phase,
    turn: state.turn,
    // 塔は下から順。中身は、めくられた札と自分の札だけが見える。結果の場面では全部ひらく。
    tower: state.tower.map((card, i) => {
      const flipped = height - 1 - i < state.flipped;
      const known = open || flipped || card.seat === seat;
      return { seat: card.seat, card: known ? (card.wasabi ? 'wasabi' : 'safe') : null, flipped };
    }),
    handCount: state.hands.map(handSize),
    myHand: mine ? state.hands[seat] : null,
    // 宣言できるか (最初の1周が終わっているか)。
    mayDeclare: state.phase === 'stack' && everyonePlaced(state),
    bid: state.bid,
    passed: state.passed,
    calls: state.calls,
    challenger: state.challenger,
    need: state.need,
    flipped: state.flipped,
    outcome: state.outcome,
    points: state.points,
    wins: state.wins,
    traps: state.traps,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over || state.phase === 'flip') return [];
  if (state.phase === 'result') return Array.from({ length: state.n }, (_, s) => s);
  return [state.turn];
}

// ---- CPU -------------------------------------------------------------------
//
// 上から N 枚が全部たこ焼きである見込みを、自分の札 (中身を知っている) と、
// ほかの人の札の「置かれ方」から見積もる。

const RISK_FIRST_LAP = 0.18; // 最初の1周で置かれた札 (底にうまるので、わさびは少なめ)
const RISK_LATE = 0.32; // 宣言もできたのに、置く方を選んだ札

/** viewer から見て、塔の i 番目 (下から) の札がわさびである見込み。 */
function riskOf(state, viewer, i) {
  const card = state.tower[i];
  if (card.seat === viewer) return card.wasabi ? 1 : 0;
  // 4枚全部置いた人の札は、どれか1枚がかならずわさび。
  const placed = state.tower.filter((other) => other.seat === card.seat).length;
  const floor = placed >= SAFE_CARDS + WASABI_CARDS ? 1 / placed : 0;
  return Math.max(card.late ? RISK_LATE : RISK_FIRST_LAP, floor);
}

/** 上から depth 枚が全部たこ焼きである見込み (viewer から見て)。 */
function oddsTop(state, viewer, depth) {
  let odds = 1;
  for (let k = 0; k < depth; k++) odds *= 1 - riskOf(state, viewer, state.tower.length - 1 - k);
  return odds;
}

/** 本当にめくれそうな、いちばん多い枚数。 */
function honestMax(state, seat, rng) {
  const nerve = 0.55 + rng() * 0.17;
  let best = 0;
  for (let depth = 1; depth <= state.tower.length; depth++) {
    if (oddsTop(state, seat, depth) < nerve) break;
    best = depth;
  }
  return best;
}

/** 自分のわさびが、上から何枚目にあるか (塔になければ 0)。 */
function myWasabiDepth(state, seat) {
  for (let k = 0; k < state.tower.length; k++) {
    const card = state.tower[state.tower.length - 1 - k];
    if (card.seat === seat && card.wasabi) return k + 1;
  }
  return 0;
}

function botBid(state, seat, rng) {
  const current = state.bid.amount;
  const honest = honestMax(state, seat, rng);
  if (current < honest) return { type: 'bid', amount: current + 1 };
  const trap = myWasabiDepth(state, seat);
  const rivals = state.passed.filter((out, s) => !out && s !== seat).length;
  // いまの宣言の中に自分のわさびが入っているなら、だまって失敗を待つ。
  if (trap > 0 && trap <= current) return { type: 'pass' };
  // はったり: 自分のわさびに届く枚数まで、平気な顔で上げる (競っている人がまだいるときだけ)。
  if (trap > 0 && current + 1 <= state.tower.length && rivals >= 2 && rng() < 0.2) return { type: 'bid', amount: current + 1 };
  return { type: 'pass' };
}

function botStack(state, seat, rng) {
  const hand = state.hands[seat];
  const mayDeclare = everyonePlaced(state);
  const honest = mayDeclare ? honestMax(state, seat, rng) : 0;
  if (handSize(hand) === 0) {
    // 置く札がないので、宣言するしかない。
    return { type: 'bid', amount: Math.max(1, honest) };
  }
  if (mayDeclare) {
    // めくれそうなら宣言する。塔が高くなるほど、宣言したくなる。
    if (honest >= 1 && rng() < 0.55 + 0.04 * state.tower.length) return { type: 'bid', amount: honest };
    // はったりの宣言: 自分のわさびが上の方にあるとき、わざと届く枚数を言って、上げた人に踏ませる。
    const trap = myWasabiDepth(state, seat);
    if (trap > 0 && trap <= 3 && rng() < 0.22) return { type: 'bid', amount: trap };
  }
  // わさびを置くか、たこ焼きを置くか。最初の1周に置くと、底にうまってしまう。
  const eager = mayDeclare ? 0.3 : 0.12;
  if (hand.wasabi > 0 && (hand.safe === 0 || rng() < eager)) return { type: 'place', card: 'wasabi' };
  return { type: 'place', card: 'safe' };
}

export function bot(state, seat, rng) {
  if (state.phase === 'result') return { type: 'next' };
  if (state.phase === 'bid') return botBid(state, seat, rng);
  if (state.phase === 'stack') return botStack(state, seat, rng);
  return null;
}
