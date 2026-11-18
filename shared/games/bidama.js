// ビーだま工場 — 玉を流して機械を連鎖させる、全員同時のエンジンづくり (2〜6人)
//
// ・自分の前に、機械を横1列にならべる。玉は左から右へ転がり、色の合う機械を順に動かす。
// ・毎周、全員が同時に、次のどちらかをえらぶ (場は全員共通で、同じものを何人がえらんでもよい)。
//     流す:   場の玉を1個とり、自分の列の左から流す。止まった玉は自分の皿にたまる。
//     つくる: 皿の玉で場の機械を買い、列の好きな場所にさしこむ。
// ・機械は、得点機 (★をもらう)・変色機 (玉の色を変える)・おまけ機 (玉をもう1個うみだす) など。
//   どの機械も、1周に1回だけ動く。
// ・20周で終わり。機械の点 + ★ の多い人の勝ち。

import { assert, makeResult } from './common.js';
import { randInt, shuffle } from '../rng.js';

export const meta = {
  id: 'bidama',
  name: 'ビーだま工場',
  emoji: '🔮',
  tagline: '玉を流すと、機械がつぎつぎ動く。ならべる順番が勝負',
  minPlayers: 2,
  maxPlayers: 6,
  time: '10〜15分',
  tags: ['じっくり', '同時プレイ', 'エンジンづくり'],
  // 全員が同時にえらぶゲームなので、CPU は待たせずに次々と決める。
  botDelayMs: 500,
};

export const COLORS = 4; // 0: 赤 / 1: 青 / 2: 黄 / 3: 緑
export const ANY = -1; // どの色でも動く機械
// 全員同時なので1周は短い。16周だと終盤でも連鎖が平均2.5台どまりだったので、20周にしている。
export const ROUNDS = 20;
export const MARKET_MARBLES = 5;
export const SMALL_SHOWN = 3;
export const LARGE_SHOWN = 3;
export const TRAY = 6;
// 全員の手が出そろったあと、連鎖を1つずつ見せる時間 (サーバーの時計で次へ進む)。
export const REVEAL_LEAD_MS = 500;
export const REVEAL_STEP_MS = 520;
export const REVEAL_TAIL_MS = 1400;
const REVEAL_MAX_MS = 9000;

// ---- 機械 ------------------------------------------------------------------
//
// kind: 'star'   in の色が通ると ★ を gain 個もらう
//       'paint'  in の色を out の色に変える
//       'bonus'  in の色が通ると、out の色の玉をもう1個うみだす (out2 があれば、もう1個)
//       'none'   何も起きない (点が高いだけ)
// in が ANY なら、どの色でも動く。

function costOf(colors) {
  const cost = new Array(COLORS).fill(0);
  for (const c of colors) cost[c]++;
  return cost;
}

/** すべての機械。小型 24枚、大型 23枚。 */
export function allMachines() {
  const small = [];
  const large = [];
  for (let c = 0; c < COLORS; c++) {
    const next = (c + 1) % COLORS;
    const far = (c + 2) % COLORS;
    const prev = (c + 3) % COLORS;
    small.push({ kind: 'bonus', in: c, out: next, cost: costOf([c, prev]), vp: 1 });
    small.push({ kind: 'bonus', in: c, out: far, cost: costOf([next, prev]), vp: 1 });
    small.push({ kind: 'bonus', in: c, out: prev, cost: costOf([c, far, next]), vp: 2 });
    small.push({ kind: 'paint', in: c, out: next, cost: costOf([next, far]), vp: 1 });
    small.push({ kind: 'paint', in: c, out: far, cost: costOf([c, prev]), vp: 1 });
    small.push({ kind: 'star', in: c, gain: 1, cost: costOf([c, c, next]), vp: 1 });
    large.push({ kind: 'star', in: c, gain: 1, cost: costOf([c, next, far]), vp: 3 });
    large.push({ kind: 'star', in: c, gain: 2, cost: costOf([c, c, prev, far]), vp: 3 });
    large.push({ kind: 'bonus', in: c, out: c, cost: costOf([c, next, prev]), vp: 4 });
    large.push({ kind: 'bonus', in: c, out: next, out2: prev, cost: costOf([c, far, far, next]), vp: 4 });
    large.push({ kind: 'none', in: null, cost: costOf([c, next, far, prev]), vp: 5 });
  }
  large.push({ kind: 'star', in: ANY, gain: 1, cost: costOf([0, 1, 2, 3, 2]), vp: 4 });
  large.push({ kind: 'bonus', in: ANY, out: 1, cost: costOf([0, 2, 3, 3]), vp: 3 });
  large.push({ kind: 'bonus', in: ANY, out: 3, cost: costOf([0, 1, 2, 2]), vp: 3 });
  small.forEach((m, i) => Object.assign(m, { id: `s${i}`, big: false }));
  large.forEach((m, i) => Object.assign(m, { id: `l${i}`, big: true }));
  return { small, large };
}

/** その機械が、色 color の玉で動くか。 */
export function reactsTo(machine, color) {
  return machine.kind !== 'none' && (machine.in === ANY || machine.in === color);
}

/**
 * 色 color の玉を、列 line の左から流す。
 * 戻り値: steps (起きたことの順)、stars (もらった★)、landed (皿に落ちる玉の色、落ちた順)。
 * うみだされた玉は、うみだした機械の右から流れはじめる。どの機械も1回しか動かない。
 */
export function flow(line, color) {
  const fired = new Array(line.length).fill(false);
  const steps = [];
  const landed = [];
  let stars = 0;
  const queue = [{ color, from: 0 }];
  let ball = 0;
  while (queue.length > 0) {
    const item = queue.shift();
    let c = item.color;
    for (let i = item.from; i < line.length; i++) {
      const m = line[i];
      if (fired[i] || !reactsTo(m, c)) continue;
      fired[i] = true;
      const step = { ball, index: i, kind: m.kind, color: c, stars: 0, spawn: [] };
      if (m.kind === 'star') {
        step.stars = m.gain;
        stars += m.gain;
      } else if (m.kind === 'paint') {
        c = m.out;
        step.to = c;
      } else if (m.kind === 'bonus') {
        step.spawn.push(m.out);
        if (m.out2 !== undefined) step.spawn.push(m.out2);
        for (const out of step.spawn) queue.push({ color: out, from: i + 1 });
      }
      steps.push(step);
    }
    steps.push({ ball, land: true, color: c });
    landed.push(c);
    ball++;
  }
  return { steps, stars, landed };
}

export const traySize = (tray) => tray.reduce((a, b) => a + b, 0);

/**
 * 皿に玉を1個入れる。いっぱいなら、いちばん多い色の玉が1個おしだされる
 * (入ってきた玉がいちばん多い色なら、その玉があふれるだけ)。おしだされた色を返す (なければ -1)。
 */
export function land(tray, color) {
  if (traySize(tray) < TRAY) {
    tray[color]++;
    return -1;
  }
  let most = 0;
  for (let c = 1; c < COLORS; c++) if (tray[c] > tray[most]) most = c;
  if (tray[color] >= tray[most]) return color;
  tray[most]--;
  tray[color]++;
  return most;
}

// 足りない色は、ほかの玉2個で1個ぶんにできる。
const missingOf = (tray, cost) => cost.reduce((a, v, c) => a + Math.max(0, v - tray[c]), 0);
const surplusOf = (tray, cost) => cost.reduce((a, v, c) => a + Math.max(0, tray[c] - v), 0);
export const canPay = (tray, cost) => surplusOf(tray, cost) >= 2 * missingOf(tray, cost);

/** 代金として出す玉 (色ごとの数)。足りない色のかわりは、余りの多い色から2個ずつ出す。払えなければ null。 */
export function payment(tray, cost) {
  if (!canPay(tray, cost)) return null;
  const paid = cost.map((v, c) => Math.min(v, tray[c]));
  const left = tray.map((v, c) => v - paid[c]);
  let owed = 2 * missingOf(tray, cost);
  while (owed > 0) {
    let most = 0;
    for (let c = 1; c < COLORS; c++) if (left[c] > left[most]) most = c;
    left[most]--;
    paid[most]++;
    owed--;
  }
  return paid;
}

// ---- 進行 ------------------------------------------------------------------

function draw(state, row) {
  if (state.decks[row].length === 0) {
    state.decks[row] = state.discards[row];
    state.discards[row] = [];
  }
  return state.decks[row].shift() ?? null;
}

function rollMarbles(rng) {
  return Array.from({ length: MARKET_MARBLES }, () => randInt(rng, COLORS));
}

export function setup({ n, rng }) {
  const all = allMachines();
  const state = {
    n,
    round: 1,
    maxRounds: ROUNDS,
    marbles: rollMarbles(rng),
    decks: { small: shuffle(rng, all.small), large: shuffle(rng, all.large) },
    discards: { small: [], large: [] },
    small: [],
    large: [],
    // 全員、色ちがいの「おまけ機」を1台持って始める (点はなし)。
    players: Array.from({ length: n }, (_, seat) => {
      const input = (seat + randInt(rng, COLORS)) % COLORS;
      const starter = { id: `start${seat}`, kind: 'bonus', in: input, out: (input + 1 + randInt(rng, COLORS - 1)) % COLORS, cost: costOf([]), vp: 0, big: false };
      return { line: [starter], tray: new Array(COLORS).fill(0), stars: 0, vp: 0 };
    }),
    picks: new Array(n).fill(null),
    phase: 'pick', // pick: 全員がえらぶ / reveal: 連鎖を見る
    last: null, // 直前の周のなりゆき (reveal のあいだは、まだ反映していない)
    lastId: 0,
    over: false,
    result: null,
  };
  for (let i = 0; i < SMALL_SHOWN; i++) state.small.push(draw(state, 'small'));
  for (let i = 0; i < LARGE_SHOWN; i++) state.large.push(draw(state, 'large'));
  return state;
}

export const scoreOf = (player) => player.vp + player.stars;

/** えらんだ手が、いまの場と自分の持ちものでできるかを確かめて、整えて返す。 */
function checkPick(state, seat, action) {
  const player = state.players[seat];
  if (action.kind === 'flow') {
    assert(Number.isInteger(action.color) && state.marbles.includes(action.color), 'その色の玉は場にありません');
    return { kind: 'flow', color: action.color };
  }
  assert(action.kind === 'build', '「流す」か「つくる」をえらんでください');
  assert(action.row === 'small' || action.row === 'large', '機械をえらんでください');
  const card = state[action.row][action.index];
  assert(card, '機械をえらんでください');
  assert(canPay(player.tray, card.cost), '玉が足りません');
  assert(Number.isInteger(action.pos) && action.pos >= 0 && action.pos <= player.line.length, 'さしこむ場所をえらんでください');
  return { kind: 'build', row: action.row, index: action.index, pos: action.pos };
}

/** 1人ぶんの手のなりゆき (まだ反映しない)。 */
function outcomeOf(state, seat, pick) {
  const player = state.players[seat];
  if (pick.kind === 'flow') {
    const { steps, stars, landed } = flow(player.line, pick.color);
    const tray = player.tray.slice();
    const pushed = [];
    for (const color of landed) {
      const out = land(tray, color);
      if (out >= 0) pushed.push(out);
    }
    return { kind: 'flow', color: pick.color, steps, stars, landed, pushed, tray };
  }
  const card = state[pick.row][pick.index];
  const paid = payment(player.tray, card.cost);
  return { kind: 'build', card, pos: pick.pos, paid, tray: player.tray.map((v, c) => v - paid[c]) };
}

export function act(state, seat, action) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && action.type === 'pick', '不明な操作です');
  assert(state.phase === 'pick', 'いまはえらべません');
  // 全員がそろうまでは選び直せる。
  state.picks[seat] = checkPick(state, seat, action);
  if (state.picks.every((pick) => pick !== null)) {
    state.last = { id: ++state.lastId, round: state.round, results: state.picks.map((pick, s) => outcomeOf(state, s, pick)) };
    state.phase = 'reveal';
  }
}

export function timer(state) {
  if (state.over || state.phase !== 'reveal') return null;
  const longest = Math.max(...state.last.results.map((r) => (r.kind === 'flow' ? r.steps.length : 1)));
  return { ms: Math.min(REVEAL_MAX_MS, REVEAL_LEAD_MS + longest * REVEAL_STEP_MS + REVEAL_TAIL_MS), key: `reveal:${state.lastId}` };
}

/** 見せ終わったら、なりゆきを反映して次の周へ進む。 */
export function tick(state, rng) {
  if (state.over || state.phase !== 'reveal') return;
  const built = { small: new Set(), large: new Set() };
  state.last.results.forEach((result, seat) => {
    const player = state.players[seat];
    player.tray = result.tray;
    if (result.kind === 'flow') player.stars += result.stars;
    else {
      player.line.splice(result.pos, 0, result.card);
      player.vp += result.card.vp;
      built[state.picks[seat].row].add(state.picks[seat].index);
    }
  });
  // 場の機械: だれかがつくったものは片づける。だれもつくらなかった列は、いちばん古い1枚が流れていく。
  for (const row of ['small', 'large']) {
    const shown = row === 'small' ? SMALL_SHOWN : LARGE_SHOWN;
    let kept = state[row].filter((_, i) => !built[row].has(i));
    if (kept.length === state[row].length && kept.length > 0) {
      state.discards[row].push(kept[0]);
      kept = kept.slice(1);
    }
    while (kept.length < shown) {
      const card = draw(state, row);
      if (!card) break;
      kept.push(card);
    }
    state[row] = kept;
  }
  state.marbles = rollMarbles(rng);
  state.picks = new Array(state.n).fill(null);

  if (state.round < state.maxRounds) {
    state.round++;
    state.phase = 'pick';
    return;
  }
  state.phase = 'over';
  state.over = true;
  // 同点なら、★ の多い人を上にする。
  state.result = makeResult(state.players.map(scoreOf), {
    unit: '点',
    detail: { stars: state.players.map((p) => p.stars), machines: state.players.map((p) => p.line.length) },
    tiebreak: state.players.map((p) => p.stars),
  });
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  return {
    n: state.n,
    round: state.round,
    maxRounds: state.maxRounds,
    trayMax: TRAY,
    phase: state.phase,
    marbles: state.marbles,
    small: state.small,
    large: state.large,
    // 列・皿・点は全員に見えている。
    players: state.players.map((p) => ({ line: p.line, tray: p.tray, stars: p.stars, vp: p.vp })),
    scores: state.players.map(scoreOf),
    // だれがえらび終えたかだけを見せる。中身は全員がそろうまで本人にしか見せない。
    picked: state.picks.map((pick) => pick !== null),
    myPick: mine ? state.picks[seat] : null,
    last: state.last,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over || state.phase !== 'pick') return [];
  return state.picks.map((pick, s) => (pick === null ? s : -1)).filter((s) => s >= 0);
}

// ---- CPU -------------------------------------------------------------------
//
// 列の強さを「どの色の玉も同じくらい来るとして、1回流したときの見込み」で測り、
// 機械を足したときの伸びと、残りの周数から、つくるか流すかを決める。

const BALL_WORTH = 0.45; // 皿に落ちる玉1個の値うち (★ 1個を 1 として)

/** 列の強さ: 1回流したときの、★ と皿に落ちる玉の見込み。 */
export function power(line) {
  let total = 0;
  for (let c = 0; c < COLORS; c++) {
    const r = flow(line, c);
    total += r.stars + r.landed.length * BALL_WORTH;
  }
  return total / COLORS;
}

/** 機械をどこにさしこむのがいちばん強いか。 */
export function bestInsert(line, machine) {
  let best = 0;
  let bestValue = -Infinity;
  for (let pos = 0; pos <= line.length; pos++) {
    const value = power([...line.slice(0, pos), machine, ...line.slice(pos)]);
    if (value > bestValue) {
      bestValue = value;
      best = pos;
    }
  }
  return { pos: best, value: bestValue };
}

export function bot(state, seat, rng) {
  if (state.phase !== 'pick') return null;
  const player = state.players[seat];
  // あと何回くらい流せそうか (残りの周のうち、4回に3回は流すとみる)。
  const flowsLeft = Math.max(0, (state.maxRounds - state.round) * 0.75);
  const now = power(player.line);
  const shop = [...state.small.map((card, index) => ({ card, row: 'small', index })), ...state.large.map((card, index) => ({ card, row: 'large', index }))];
  const worth = shop.map((item) => {
    const ins = bestInsert(player.line, item.card);
    return { ...item, pos: ins.pos, value: item.card.vp + (ins.value - now) * flowsLeft };
  });

  // つくれる中で、いちばん値うちのある機械。
  let build = null;
  for (const item of worth) {
    if (canPay(player.tray, item.card.cost) && (!build || item.value > build.value)) build = item;
  }
  // 次にねらう機械: 値うちが高く、あと少しで買えるもの。
  let target = null;
  for (const item of worth) {
    const missing = Math.max(0, missingOf(player.tray, item.card.cost) - Math.floor(surplusOf(player.tray, item.card.cost) / 2));
    const value = item.value / (1 + missing);
    if (!target || value > target.value) target = { ...item, value };
  }

  // 流すなら、どの色がいちばん得か (★ と、ねらう機械に近づく玉)。
  let drop = null;
  for (const color of new Set(state.marbles)) {
    const r = flow(player.line, color);
    const tray = player.tray.slice();
    let useful = 0;
    for (const c of r.landed) {
      const need = target && tray[c] < target.card.cost[c];
      if (land(tray, c) !== c) useful += need ? 1 : 0.35;
    }
    const value = r.stars + useful * 1.2 + rng() * 0.3;
    if (!drop || value > drop.value) drop = { color, value };
  }

  // 最後の周は、点になる方をえらぶ。それまでは、はっきり得なときだけつくる (何でもつくると、流す回数が足りなくなる)。
  const last = state.round === state.maxRounds;
  if (build && (last ? build.card.vp >= flow(player.line, drop.color).stars : build.value >= drop.value * 3)) {
    return { type: 'pick', kind: 'build', row: build.row, index: build.index, pos: build.pos };
  }
  return { type: 'pick', kind: 'flow', color: drop.color };
}
