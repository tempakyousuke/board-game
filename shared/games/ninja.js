// かくれんぼ忍者 — 1人が見えない忍者、ほかの全員が見張りの追いかけっこ (2〜4人)
//
// ・忍者は城の中を1部屋ずつこっそり動く。どこにいるかは見張りには見えない。
// ・ただし、忍者が「少し前にいた部屋」には足あとが浮かび上がる。見張りはそれを手がかりに追う。
// ・見張りも1部屋ずつ動く。忍者のいる部屋に踏みこめば、つかまえて見張りの勝ち。
// ・忍者は1回だけ、つかまりそうになっても煙玉でとなりの部屋へ逃げられる。
// ・夜が明けるまで逃げ切れば忍者の勝ち。
//
// 「忍者がいるかもしれない部屋」は、公開されている情報だけから機械的に出せるので、
// サーバーが計算して全員に見せる (possible)。推理の入口をそろえて、読み合いに集中できるようにするため。

import { assert } from './common.js';
import { randInt, shuffle } from '../rng.js';

export const meta = {
  id: 'ninja',
  name: 'かくれんぼ忍者',
  emoji: '🥷',
  tagline: '足あとを手がかりに、見えない忍者を追いつめろ。1人対みんな',
  minPlayers: 2,
  maxPlayers: 4,
  time: '5〜10分',
  tags: ['1人対みんな', '推理', 'かけひき'],
};

/** 足あとが浮かび上がるまでの手数。2 なら「2手前にいた部屋」が見える。 */
export const FOOT_LAG = 2;

/**
 * 城は 5×5、見張りは3人、夜明けまで 14 ラウンド。
 * CPU 同士で試すと、見張り2人では忍者がほぼ逃げ切り、煙玉なしではすぐにつかまった。
 * この組み合わせで勝率がおよそ半々になる。
 */
const SETUP = { size: 5, guards: 3, rounds: 14, smoke: 1 };

const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function neighbors(size, cell) {
  const r = Math.floor(cell / size);
  const c = cell % size;
  const out = [];
  for (const [dr, dc] of ORTH) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && cc >= 0 && rr < size && cc < size) out.push(rr * size + cc);
  }
  return out;
}

export function distance(size, a, b) {
  return Math.abs(Math.floor(a / size) - Math.floor(b / size)) + Math.abs((a % size) - (b % size));
}

export function setup({ n, rng, config }) {
  const cfg = { ...SETUP, ...config };
  const { size } = cfg;
  const cells = Array.from({ length: size * size }, (_, i) => i);
  const mid = (size - 1) / 2;
  const fromCenter = (cell) => Math.abs(Math.floor(cell / size) - mid) + Math.abs((cell % size) - mid);

  // 見張りは城のまんなかあたりから出発する。
  const guards = shuffle(rng, cells.filter((c) => fromCenter(c) <= 1.5)).slice(0, cfg.guards);

  // 忍者は見張りから離れた外周の部屋のどこかに忍びこむ。
  const edge = (cell) => {
    const r = Math.floor(cell / size);
    const c = cell % size;
    return r === 0 || c === 0 || r === size - 1 || c === size - 1;
  };
  const starts = cells.filter((c) => edge(c) && guards.every((g) => distance(size, g, c) >= 3));
  const ninja = starts[randInt(rng, starts.length)];

  const ninjaSeat = randInt(rng, n);
  const guardSeats = Array.from({ length: n }, (_, s) => s).filter((s) => s !== ninjaSeat);

  const state = {
    n,
    size,
    lag: cfg.lag ?? FOOT_LAG,
    maxRounds: cfg.rounds,
    round: 1,
    ninjaSeat,
    guardOwner: guards.map((_, g) => guardSeats[g % guardSeats.length]),
    ninja,
    guards,
    moved: guards.map(() => false),
    smoke: cfg.smoke,
    phase: 'ninja', // ninja: 忍者が動く / guards: 見張りが動く
    starts, // 忍者が忍びこんだかもしれない部屋 (公開)
    trail: [ninja], // trail[i] = 忍者が i 手動いたあとの居場所。本人だけに見える
    // guardLog[i] = 忍者の i 手目のときの見張りの位置と、そのあと見張りが踏みこんだ部屋 (推理の材料)
    guardLog: [null],
    anchor: null, // 煙玉で居場所がばれたときの記録 { step, cells }
    possible: starts.slice(),
    event: null,
    eventId: 0,
    over: false,
    result: null,
  };
  return state;
}

/**
 * 公開情報だけから、忍者がいまいるかもしれない部屋を求める。
 * いちばん新しい確かな情報 (足あと、または煙玉を使った場所) から、動けた範囲を広げていく。
 */
export function deduce(state) {
  const { size } = state;
  const steps = state.trail.length - 1;
  const footprint = steps - state.lag;
  let from;
  let set;
  if (state.anchor && state.anchor.step >= Math.max(footprint, 0)) {
    from = state.anchor.step;
    set = new Set(state.anchor.cells);
  } else if (footprint >= 0) {
    from = footprint;
    set = new Set([state.trail[footprint]]);
  } else {
    from = 0;
    set = new Set(state.starts);
  }
  for (let i = from + 1; i <= steps; i++) {
    const next = new Set();
    for (const cell of set) {
      next.add(cell);
      for (const nb of neighbors(size, cell)) next.add(nb);
    }
    for (const g of state.guardLog[i].before) next.delete(g); // 見張りの部屋には入れない
    for (const e of state.guardLog[i].entered) next.delete(e); // 踏みこまれて見つからなかった
    set = next;
  }
  return [...set];
}

function note(state, event) {
  state.eventId++;
  state.event = { id: state.eventId, round: state.round, ...event };
}

function finish(state, ninjaWins, reason) {
  state.over = true;
  const places = Array.from({ length: state.n }, (_, s) => ((s === state.ninjaSeat) === ninjaWins ? 1 : 2));
  const survived = state.trail.length - 1;
  state.result = {
    scores: new Array(state.n).fill(survived),
    places,
    winners: places.map((p, s) => (p === 1 ? s : -1)).filter((s) => s >= 0),
    unit: '手',
    // 点数を比べるゲームではないので、結果には役割を出す。
    roles: Array.from({ length: state.n }, (_, s) => (s === state.ninjaSeat ? '忍者' : '見張り')),
    headline: ninjaWins ? '夜が明けました。忍者の逃げ切り勝ち！' : `見張りが ${state.round} ラウンド目に忍者をつかまえました！`,
    detail: { reason, ninjaSeat: state.ninjaSeat },
  };
}

export function act(state, seat, action, rng) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && typeof action.type === 'string', '不明な操作です');
  const { size } = state;

  if (action.type === 'sneak') {
    assert(seat === state.ninjaSeat, '忍者だけができる操作です');
    assert(state.phase === 'ninja', 'いまは見張りの番です');
    const to = action.to;
    assert(to === state.ninja || neighbors(size, state.ninja).includes(to), '動けるのはとなりの部屋までです');
    assert(!state.guards.includes(to), '見張りのいる部屋には入れません');

    state.ninja = to;
    state.trail.push(to);
    state.guardLog.push({ before: state.guards.slice(), entered: [] });
    state.possible = deduce(state);
    state.phase = 'guards';
    state.moved = state.guards.map(() => false);
    note(state, { type: 'sneak' });
    return;
  }

  assert(action.type === 'patrol', '不明な操作です');
  assert(state.phase === 'guards', 'いまは忍者の番です');
  const g = action.guard;
  assert(Number.isInteger(g) && g >= 0 && g < state.guards.length, '見張りを選んでください');
  assert(state.guardOwner[g] === seat, 'その見張りはあなたの担当ではありません');
  assert(!state.moved[g], 'その見張りはもう動きました');
  const to = action.to;
  const from = state.guards[g];
  assert(to === from || neighbors(size, from).includes(to), '動けるのはとなりの部屋までです');
  assert(to === from || !state.guards.includes(to), 'ほかの見張りがいる部屋には入れません');

  const steps = state.trail.length - 1;
  state.guards[g] = to;
  state.moved[g] = true;
  if (to === state.ninja) {
    // 見つかった！ 煙玉が残っていれば、となりの部屋へ逃げる。
    const exits = neighbors(size, to).filter((c) => !state.guards.includes(c));
    if (state.smoke > 0 && exits.length > 0) {
      state.smoke--;
      const nearest = (cell) => Math.min(...state.guards.map((guard) => distance(size, guard, cell)));
      const best = Math.max(...exits.map(nearest));
      const choices = exits.filter((c) => nearest(c) === best);
      state.ninja = choices[randInt(rng, choices.length)];
      state.trail[steps] = state.ninja;
      state.anchor = { step: steps, cells: exits.slice(), at: to };
      note(state, { type: 'smoke', guard: g, cell: to });
    } else {
      state.possible = [to];
      note(state, { type: 'caught', guard: g, cell: to });
      return finish(state, false, 'caught');
    }
  } else {
    state.guardLog[steps].entered.push(to);
    // 煙玉で逃げたばかりなら、その逃げ先の候補からも外す。
    if (state.anchor?.step === steps) state.anchor.cells = state.anchor.cells.filter((c) => c !== to);
    note(state, { type: 'patrol', guard: g, from, to });
  }
  state.possible = deduce(state);

  if (state.moved.every(Boolean)) {
    if (state.round >= state.maxRounds) return finish(state, true, 'dawn');
    state.round++;
    state.phase = 'ninja';
  }
}

export function view(state, seat) {
  const isNinja = seat === state.ninjaSeat;
  const steps = state.trail.length - 1;
  const known = steps - state.lag; // ここまでの足あとは全員に見えている
  return {
    n: state.n,
    size: state.size,
    lag: state.lag,
    round: state.round,
    maxRounds: state.maxRounds,
    ninjaSeat: state.ninjaSeat,
    guardOwner: state.guardOwner,
    guards: state.guards,
    moved: state.moved,
    smoke: state.smoke,
    phase: state.phase,
    possible: state.possible,
    // 足あとは新しい順に3つまで。古いものほど薄く描く。
    footprints: known >= 0 ? state.trail.slice(Math.max(0, known - 2), known + 1).reverse() : [],
    smokeAt: state.anchor && state.anchor.step > known ? state.anchor.at : null,
    event: state.event,
    // 忍者の居場所と足どりは、本人だけ (終わったら全員) に見せる。
    ninja: isNinja || state.over ? state.ninja : null,
    trail: isNinja || state.over ? state.trail : null,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  if (state.phase === 'ninja') return [state.ninjaSeat];
  return [...new Set(state.guardOwner.filter((_, g) => !state.moved[g]))];
}

// ---- CPU ----------------------------------------------------------------

function ninjaBot(state, rng) {
  const { size } = state;
  const options = [state.ninja, ...neighbors(size, state.ninja)].filter((c) => !state.guards.includes(c));
  let best = options[0];
  let bestScore = -Infinity;
  for (const cell of options) {
    let score = rng() * 0.6;
    // 見張りに近いほど危ない。となりは、当てずっぽうで踏みこまれるおそれが大きい。
    for (const g of state.guards) {
      const d = distance(size, g, cell);
      score -= d === 1 ? 4 : 3 / (d * d);
    }
    // 逃げ道の多い部屋を好む (角や壁ぎわは追いつめられやすい)。
    const exits = neighbors(size, cell).filter((c) => !state.guards.includes(c));
    score += exits.length * 0.45;
    // 2手先まで見て、囲まれそうな場所は避ける。
    const safeExits = exits.filter((c) => state.guards.every((g) => distance(size, g, c) > 1)).length;
    score += safeExits * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  return { type: 'sneak', to: best };
}

function guardBot(state, seat, rng) {
  const { size } = state;
  const g = state.guardOwner.findIndex((owner, i) => owner === seat && !state.moved[i]);
  const from = state.guards[g];
  const options = [from, ...neighbors(size, from)].filter((c) => c === from || !state.guards.includes(c));
  const possible = state.possible;

  let best = from;
  let bestScore = -Infinity;
  for (const cell of options) {
    const guards = state.guards.slice();
    guards[g] = cell;
    const nearest = (target) => Math.min(...guards.map((guard) => distance(size, guard, target)));
    let score = rng() * 0.3;
    // 忍者がいそうな部屋に、だれかが近いほど良い。
    let cover = 0;
    for (const p of possible) cover += nearest(p);
    score -= (cover / Math.max(1, possible.length)) * 1.5;
    // 当たればつかまえられる (か、煙玉を使わせられる)。外れても候補が1つ減る。
    if (possible.includes(cell)) score += 5 / possible.length + 0.4;
    // 見張りどうしが固まると、すき間から逃げられる。
    for (let other = 0; other < guards.length; other++) {
      if (other !== g && distance(size, guards[other], cell) <= 1) score -= 0.6;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  return { type: 'patrol', guard: g, to: best };
}

export function bot(state, seat, rng) {
  if (state.over) return null;
  return seat === state.ninjaSeat ? ninjaBot(state, rng) : guardBot(state, seat, rng);
}
