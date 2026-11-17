// みんなでダウト — 宣言のたびに、全員が同時に「本当 / うそ」を賭けるサイコロのブラフゲーム (2〜6人)
//
// ・全員がサイコロをふり、自分のぶんだけを見る。1 の目はワイルドで、どの目にも数える。
// ・番の人が「全員のサイコロを合わせると、5 が 4個以上ある」のように宣言する。
// ・ほかの全員が同時に、こっそり「本当」か「うそ」に賭ける。
//   - 全員が「本当」なら答え合わせはせず、次の人がもっと大きい宣言をする。
//   - 1人でも「うそ」に賭けたら全員のサイコロを公開する。
//     賭けを外した人は全員1個失い、宣言がうそだったら宣言した人も1個失う。
// ・だれかのサイコロがなくなったら終了。残りが多い人の勝ち
//   (同数なら、本当の宣言で引っかけた人数が多い人)。

import { assert, makeResult } from './common.js';
import { randInt } from '../rng.js';

export const meta = {
  id: 'dauto',
  name: 'みんなでダウト',
  emoji: '🤥',
  tagline: 'その宣言、本当？うそ？ 全員が同時に賭けるサイコロ勝負',
  minPlayers: 2,
  maxPlayers: 6,
  time: '5〜10分',
  tags: ['わいわい', 'ブラフ', '同時プレイ'],
  // 宣言のたびに CPU 全員が賭けるので、1手ずつの間合いは短めにする。
  botDelayMs: 800,
};

export const FACES = 6;
export const WILD = 1;
export const MIN_FACE = 2; // 宣言できるのは 2〜6 の目 (1 はワイルド専用)
export const DICE_BY_PLAYERS = { 2: 5, 3: 5, 4: 4, 5: 4, 6: 4 };
/** ほかの人のサイコロ1個が、ある目として数えられる確率 (その目か、ワイルド)。 */
export const P_HIT = 2 / FACES;

/** dice のうち、face として数えられる個数 (ワイルドをふくむ)。 */
export function countFace(dice, face) {
  let count = 0;
  for (const d of dice) if (d === face || d === WILD) count++;
  return count;
}

/** 宣言 a が、いまの宣言 b より大きいか (個数が多い、または同じ個数で目が大きい)。 */
export function isHigher(a, b) {
  return !b || a.q > b.q || (a.q === b.q && a.f > b.f);
}

/** いまの宣言より大きい宣言が、まだ残っているか。 */
export function canRaise(claim, total) {
  return !claim || claim.q < total || claim.f < FACES;
}

/** face で宣言するときの、いちばん小さい個数。 */
export function minQuantity(claim, face) {
  if (!claim) return 1;
  return face > claim.f ? claim.q : claim.q + 1;
}

export const totalDice = (state) => state.counts.reduce((a, b) => a + b, 0);

function roll(state, rng) {
  state.hands = state.counts.map((count) => Array.from({ length: count }, () => 1 + randInt(rng, FACES)).sort((a, b) => a - b));
}

export function setup({ n, rng }) {
  const state = {
    n,
    dice: DICE_BY_PLAYERS[n],
    counts: new Array(n).fill(DICE_BY_PLAYERS[n]),
    hands: [],
    round: 1,
    claimant: randInt(rng, n),
    claim: null, // { q, f }
    claims: [], // このラウンドの宣言の流れ { seat, q, f }
    bets: new Array(n).fill(null), // true: 本当 / false: うそ
    phase: 'claim', // claim: 宣言する / bet: ほかの全員が賭ける / reveal: 答え合わせ
    reveal: null,
    tricked: new Array(n).fill(0), // 本当の宣言を「うそ」と言わせた、のべ人数
    over: false,
    result: null,
  };
  roll(state, rng);
  return state;
}

export function act(state, seat, action, rng) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && typeof action.type === 'string', '不明な操作です');

  if (action.type === 'next') {
    assert(state.phase === 'reveal', 'まだ次のラウンドには進めません');
    state.round++;
    state.claimant = state.reveal.next;
    state.claim = null;
    state.claims = [];
    state.bets = new Array(state.n).fill(null);
    state.reveal = null;
    state.phase = 'claim';
    roll(state, rng);
    return;
  }

  if (action.type === 'claim') {
    assert(state.phase === 'claim', 'いまは宣言できません');
    assert(seat === state.claimant, 'あなたの番ではありません');
    const { q, f } = action;
    assert(Number.isInteger(f) && f >= MIN_FACE && f <= FACES, '宣言できる目は 2〜6 です');
    assert(Number.isInteger(q) && q >= 1 && q <= totalDice(state), '個数が正しくありません');
    assert(isHigher({ q, f }, state.claim), 'いまの宣言より大きくしてください');
    state.claim = { q, f };
    state.claims.push({ seat, q, f });
    state.bets = new Array(state.n).fill(null);
    state.phase = 'bet';
    return;
  }

  assert(action.type === 'bet', '不明な操作です');
  assert(state.phase === 'bet', 'いまは賭けられません');
  assert(seat !== state.claimant, '宣言した人は賭けません');
  assert(typeof action.believe === 'boolean', '「本当」か「うそ」を選んでください');
  // 全員がそろうまでは選び直せる。
  state.bets[seat] = action.believe;
  const waiting = state.bets.some((bet, s) => s !== state.claimant && bet === null);
  if (!waiting) settle(state);
}

function settle(state) {
  const { n, claim, claimant } = state;
  const others = Array.from({ length: n }, (_, s) => s).filter((s) => s !== claimant);
  const doubters = others.filter((s) => state.bets[s] === false);
  const next = (claimant + 1) % n;

  // 全員が信じた: 答え合わせはせず、次の人がもっと大きい宣言をする。
  // (これ以上大きい宣言がないときだけは、そのまま答え合わせ。)
  if (doubters.length === 0 && canRaise(claim, totalDice(state))) {
    state.claimant = next;
    state.bets = new Array(n).fill(null);
    state.phase = 'claim';
    return;
  }

  const real = state.hands.reduce((sum, hand) => sum + countFace(hand, claim.f), 0);
  const truth = real >= claim.q;
  const losers = truth ? doubters : [claimant, ...others.filter((s) => state.bets[s] === true)];
  for (const s of losers) state.counts[s]--;
  if (truth) state.tricked[claimant] += doubters.length;

  state.reveal = {
    seat: claimant,
    claim: { ...claim },
    hands: state.hands.map((hand) => hand.slice()),
    real,
    truth,
    bets: state.bets.slice(),
    losers: losers.slice().sort((a, b) => a - b),
    next,
  };

  if (state.counts.some((count) => count === 0)) {
    state.phase = 'over';
    state.over = true;
    state.result = makeResult(state.counts.slice(), {
      unit: '個',
      detail: { tricked: state.tricked.slice() },
      tiebreak: state.tricked.slice(),
    });
  } else {
    state.phase = 'reveal';
  }
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  return {
    n: state.n,
    dice: state.dice,
    counts: state.counts,
    total: totalDice(state),
    round: state.round,
    phase: state.phase,
    claimant: state.claimant,
    claim: state.claim,
    claims: state.claims,
    // だれが賭け終えたかだけを見せる。中身は答え合わせまで本人にしか見せない。
    submitted: state.bets.map((bet) => bet !== null),
    myBet: mine ? state.bets[seat] : null,
    myDice: mine ? state.hands[seat] : null,
    reveal: state.reveal,
    tricked: state.tricked,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  if (state.phase === 'reveal') return Array.from({ length: state.n }, (_, s) => s);
  if (state.phase === 'claim') return [state.claimant];
  return state.bets.map((bet, s) => (s !== state.claimant && bet === null ? s : -1)).filter((s) => s >= 0);
}

// ---- 確率 ------------------------------------------------------------------

function binomial(n, k) {
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c;
}

/** n 個のうち、確率 p の当たりがちょうど k 個出る確率。 */
function exactly(n, k, p) {
  if (k < 0 || k > n) return 0;
  return binomial(n, k) * p ** k * (1 - p) ** (n - k);
}

/** n 個のうち、確率 p の当たりが k 個以上出る確率。 */
export function chanceAtLeast(n, k, p = P_HIT) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let total = 0;
  for (let i = k; i <= n; i++) total += exactly(n, i, p);
  return total;
}

/**
 * 2つの山 (a 個は確率 pa、b 個は確率 pb) を合わせて、当たりが k 個以上出る確率。
 * 「宣言した人は、その目を多めに持っていそう」という読みを入れるのに使う。
 */
function chanceAtLeastMixed(a, pa, b, pb, k) {
  if (k <= 0) return 1;
  let total = 0;
  for (let i = 0; i <= a; i++) total += exactly(a, i, pa) * chanceAtLeast(b, k - i, pb);
  return total;
}

// ---- CPU -------------------------------------------------------------------

// 宣言した人のサイコロは、宣言した目である見込みを少し高く見る。
const CLAIMANT_HIT = 0.45;
// 「本当」に賭ける目安。次に宣言する番の人は、上げるのがつらいので少し疑い深い。
const TRUST_LINE = 0.42;
const TRUST_LINE_NEXT = 0.5;

/** その席から見て、いまの宣言が本当である確率。 */
function belief(state, seat) {
  const { claim, claimant } = state;
  const need = claim.q - countFace(state.hands[seat], claim.f);
  const theirs = state.counts[claimant];
  const rest = totalDice(state) - state.counts[seat] - theirs;
  return chanceAtLeastMixed(theirs, CLAIMANT_HIT, rest, P_HIT, need);
}

function botBet(state, seat, rng) {
  const next = seat === (state.claimant + 1) % state.n;
  const line = (next ? TRUST_LINE_NEXT : TRUST_LINE) + (rng() - 0.5) * 0.16;
  return { type: 'bet', believe: belief(state, seat) >= line };
}

/** 「本当なのに、うそに聞こえる」宣言をねらう。ばれそうなうそは避ける。 */
function botClaim(state, seat, rng) {
  const total = totalDice(state);
  const mine = state.hands[seat];
  const unknown = total - mine.length;
  const others = state.n - 1;
  const from = state.claim ? state.claim.q : 1;
  let best = null;
  let bestValue = -Infinity;
  for (let q = from; q <= Math.min(total, from + 6); q++) {
    for (let f = MIN_FACE; f <= FACES; f++) {
      if (!isHigher({ q, f }, state.claim)) continue;
      const truth = chanceAtLeast(unknown, q - countFace(mine, f));
      // ほかの人からどう見えるか (その人の手元は平均的だとみなす)。
      const looks = chanceAtLeastMixed(mine.length, CLAIMANT_HIT, unknown, P_HIT, q);
      const doubt = 1 / (1 + Math.exp((looks - TRUST_LINE) / 0.1));
      const someone = 1 - (1 - doubt) ** others;
      // 疑われて本当なら、疑った人数ぶん得。うそなら自分が1個失う。
      // だれにも疑われなければ何も起きず、次の人が苦しくなる。
      const value = truth * others * doubt * 0.7 - (1 - truth) * someone + (1 - someone) * 0.12 + rng() * 0.22;
      if (value > bestValue) {
        bestValue = value;
        best = { type: 'claim', q, f };
      }
    }
  }
  return best;
}

export function bot(state, seat, rng) {
  if (state.phase === 'reveal') return { type: 'next' };
  if (state.phase === 'claim') return botClaim(state, seat, rng);
  return botBet(state, seat, rng);
}
