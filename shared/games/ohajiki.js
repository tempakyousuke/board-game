// おはじきリング — 指で弾いて的をねらう、物理演算つきのゲーム (2〜4人)
//
// ・自分の番に、盤のふちからおはじきを1つ弾く。向きと強さは自分で決める。
// ・おはじきどうしはぶつかって動く。相手のおはじきを的の外へ弾き出してもよい。
// ・全員が弾き終わったら、的に残っている自分のおはじきの点を数える (まんなかほど高得点)。
// ・これを2回戦やって、合計点の高い人の勝ち。
//
// 動きの計算は、サーバーとブラウザで同じこの関数を使う。足し算・かけ算・平方根だけで
// 書いてあるので、同じ入力からはどこで計算しても同じ結果になる (三角関数は環境で差が出るので使わない)。
// そのためブラウザは「弾く前の配置」と「弾いた速度」だけもらえば、同じ動きを再生できる。

import { assert, makeResult } from './common.js';
import { randInt } from '../rng.js';

export const meta = {
  id: 'ohajiki',
  name: 'おはじきリング',
  emoji: '🎯',
  tagline: '引っぱって、はなす。相手を弾き出して、的のまんなかへ！',
  minPlayers: 2,
  maxPlayers: 4,
  time: '5〜10分',
  tags: ['わいわい', 'アクション', 'だれでも'],
  // 弾いたあと、おはじきが止まるまでの動きを全員が見るので、CPU は少し長めに待ってから弾く。
  botDelayMs: 3600,
};

export const RADIUS = 1; // 的の半径
export const DISC = 0.085; // おはじきの半径
export const LAUNCH = 1.19; // 発射位置 (的の外。的の中のおはじきと重ならない距離)
export const FALL = 1.4; // これより外に出たら盤から落ちる
/** 的の輪。中心からの距離が r 以下なら points 点 (内側から順に調べる)。 */
export const RINGS = [
  { r: 0.2, points: 5 },
  { r: 0.46, points: 3 },
  { r: 0.73, points: 2 },
  { r: RADIUS, points: 1 },
];
// 上限が高すぎると、まんなかのおはじきも毎回弾き出せて盤が空になる。低すぎると何も弾き出せない。
// CPU に遊ばせて、弾き終わったときに半分ほど残る強さにした。
export const MAX_SPEED = 2.3;
export const MIN_SPEED = 0.3;
export const FRICTION = 0.95; // すべるときの減速 (1秒あたり)
export const DT = 1 / 120; // 計算のきざみ (秒)
const RESTITUTION = 0.9; // はね返りの強さ
const STOP = 0.004;
const MAX_STEPS = 2400;
export const ENDS = 2;
const SHOTS_BY_PLAYERS = { 2: 5, 3: 4, 4: 3 };

/**
 * おはじきを DT 秒ぶん動かす。discs の中身を書きかえる。
 * @param {{ x: number, y: number, vx: number, vy: number, out?: boolean }[]} discs
 * @returns {{ moving: boolean, hits: number, fell: number }}
 */
export function stepPhysics(discs) {
  let hits = 0;
  let fell = 0;
  for (const d of discs) {
    if (d.out) continue;
    const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy);
    if (speed <= STOP) {
      d.vx = 0;
      d.vy = 0;
      continue;
    }
    const slowed = speed - FRICTION * DT;
    if (slowed <= 0) {
      d.vx = 0;
      d.vy = 0;
      continue;
    }
    d.vx *= slowed / speed;
    d.vy *= slowed / speed;
    d.x += d.vx * DT;
    d.y += d.vy * DT;
  }

  const reach = DISC * 2;
  for (let i = 0; i < discs.length; i++) {
    const a = discs[i];
    if (a.out) continue;
    for (let j = i + 1; j < discs.length; j++) {
      const b = discs[j];
      if (b.out) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 >= reach * reach || dist2 === 0) continue;
      const dist = Math.sqrt(dist2);
      const nx = dx / dist;
      const ny = dy / dist;
      // めりこんだぶんを半分ずつ押し戻す。
      const overlap = (reach - dist) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
      // 近づいているときだけ、ぶつかった向きの速さをやりとりする (重さは同じ)。
      const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (closing < 0) {
        const push = (-(1 + RESTITUTION) * closing) / 2;
        a.vx -= push * nx;
        a.vy -= push * ny;
        b.vx += push * nx;
        b.vy += push * ny;
        hits++;
      }
    }
  }

  let moving = false;
  for (const d of discs) {
    if (d.out) continue;
    if (d.x * d.x + d.y * d.y > FALL * FALL) {
      d.out = true;
      d.vx = 0;
      d.vy = 0;
      fell++;
    } else if (d.vx !== 0 || d.vy !== 0) {
      moving = true;
    }
  }
  return { moving, hits, fell };
}

/** すべて止まるまで動かし、的の外で止まったものを取りのぞく。 */
export function settle(discs) {
  for (let step = 0; step < MAX_STEPS; step++) {
    if (!stepPhysics(discs).moving) break;
  }
  for (const d of discs) {
    d.vx = 0;
    d.vy = 0;
    if (!d.out && d.x * d.x + d.y * d.y > RADIUS * RADIUS) d.out = true;
  }
  return discs.filter((d) => !d.out);
}

/** その位置にあるおはじきの点 (的の外は 0)。 */
export function ringPoints(x, y) {
  const d2 = x * x + y * y;
  for (const ring of RINGS) if (d2 <= ring.r * ring.r) return ring.points;
  return 0;
}

export function pointsBySeat(discs, n) {
  const points = new Array(n).fill(0);
  for (const d of discs) if (!d.out) points[d.seat] += ringPoints(d.x, d.y);
  return points;
}

export function setup({ n, rng }) {
  const first = randInt(rng, n);
  // 発射位置は盤のまわりに等間隔。席0 が画面の下になる向きで置く。
  // ここだけは三角関数を使うが、結果の座標を状態に入れて配るので、ずれの心配はない。
  const launch = Array.from({ length: n }, (_, s) => {
    const angle = Math.PI / 2 + (2 * Math.PI * s) / n;
    return { x: LAUNCH * Math.cos(angle), y: LAUNCH * Math.sin(angle) };
  });
  return {
    n,
    end: 1,
    maxEnds: ENDS,
    shots: SHOTS_BY_PLAYERS[n],
    shotsLeft: new Array(n).fill(SHOTS_BY_PLAYERS[n]),
    first,
    turn: first,
    discs: [], // { id, seat, x, y }
    nextId: 1,
    launch,
    totals: new Array(n).fill(0),
    history: [], // 回ごとの点
    phase: 'shoot', // shoot: 弾く / review: その回の点を見る
    last: null, // 直前の1発 (ブラウザが動きを再生するための材料)
    shotCount: 0,
    over: false,
    result: null,
  };
}

/** 速度を上限におさめる。弱すぎる (ほぼ動かない) ものは null。 */
export function clampShot(vx, vy) {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (!(speed >= MIN_SPEED)) return null;
  if (speed <= MAX_SPEED) return { vx, vy };
  return { vx: (vx / speed) * MAX_SPEED, vy: (vy / speed) * MAX_SPEED };
}

export function act(state, seat, action) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && typeof action.type === 'string', '不明な操作です');

  if (action.type === 'next') {
    assert(state.phase === 'review', 'まだ次の回には進めません');
    if (state.end >= state.maxEnds) {
      state.over = true;
      state.result = makeResult(state.totals.slice(), { unit: '点', detail: { ends: state.history } });
      return;
    }
    state.end++;
    state.discs = [];
    state.shotsLeft = new Array(state.n).fill(state.shots);
    // 先に弾く人は回ごとに交代する (あとから弾くほうが有利なので)。
    state.first = (state.first + 1) % state.n;
    state.turn = state.first;
    state.phase = 'shoot';
    state.last = null;
    return;
  }

  assert(action.type === 'shoot', '不明な操作です');
  assert(state.phase === 'shoot', 'いまは弾けません');
  assert(seat === state.turn, 'あなたの番ではありません');
  assert(Number.isFinite(action.vx) && Number.isFinite(action.vy), '向きと強さを決めてください');
  const shot = clampShot(action.vx, action.vy);
  assert(shot, 'もう少し強く引っぱってください');

  const before = state.discs.map((d) => ({ id: d.id, seat: d.seat, x: d.x, y: d.y }));
  const id = state.nextId++;
  const moving = before.map((d) => ({ ...d, vx: 0, vy: 0 }));
  moving.push({ id, seat, x: state.launch[seat].x, y: state.launch[seat].y, vx: shot.vx, vy: shot.vy });
  state.discs = settle(moving).map((d) => ({ id: d.id, seat: d.seat, x: d.x, y: d.y }));
  state.shotCount++;
  state.last = { id: state.shotCount, seat, disc: id, vx: shot.vx, vy: shot.vy, before };
  state.shotsLeft[seat]--;

  // 次に弾く人。全員が弾き終わったら、この回の点を数える。
  let next = -1;
  for (let k = 1; k <= state.n; k++) {
    const candidate = (seat + k) % state.n;
    if (state.shotsLeft[candidate] > 0) {
      next = candidate;
      break;
    }
  }
  if (next >= 0) {
    state.turn = next;
    return;
  }
  const points = pointsBySeat(state.discs, state.n);
  for (let s = 0; s < state.n; s++) state.totals[s] += points[s];
  state.history.push(points);
  state.phase = 'review';
  state.turn = -1;
}

export function view(state) {
  return {
    n: state.n,
    end: state.end,
    maxEnds: state.maxEnds,
    shots: state.shots,
    shotsLeft: state.shotsLeft,
    turn: state.over ? -1 : state.turn,
    phase: state.phase,
    discs: state.discs,
    launch: state.launch,
    live: pointsBySeat(state.discs, state.n),
    totals: state.totals,
    history: state.history,
    last: state.last,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  if (state.phase === 'review') return Array.from({ length: state.n }, (_, s) => s);
  return [state.turn];
}

// ---- CPU ----------------------------------------------------------------

/** from から to へ、ちょうど届いて止まる速さ。 */
function speedToReach(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.sqrt(2 * FRICTION * Math.sqrt(dx * dx + dy * dy));
}

function aim(from, to, speed) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  return { vx: (dx / dist) * speed, vy: (dy / dist) * speed };
}

export function bot(state, seat, rng) {
  if (state.phase === 'review') return { type: 'next' };
  const from = state.launch[seat];
  const candidates = [];
  // まんなか付近に置きにいく。
  for (const factor of [0.9, 0.97, 1.03, 1.1]) {
    for (const offset of [-0.12, 0, 0.12]) {
      const target = { x: offset * (from.y / LAUNCH), y: -offset * (from.x / LAUNCH) };
      candidates.push(aim(from, target, speedToReach(from, target) * factor));
    }
  }
  // 点になっている相手のおはじきを弾き出しにいく。
  for (const d of state.discs) {
    if (d.seat === seat) continue;
    for (const power of [1.5, 1.9, 2.4]) {
      candidates.push(aim(from, d, Math.min(MAX_SPEED, speedToReach(from, d) * power)));
    }
  }

  let best = candidates[0];
  let bestValue = -Infinity;
  for (const shot of candidates) {
    const discs = state.discs.map((d) => ({ ...d, vx: 0, vy: 0 }));
    discs.push({ id: -1, seat, x: from.x, y: from.y, vx: shot.vx, vy: shot.vy });
    const points = pointsBySeat(settle(discs), state.n);
    let rival = 0;
    for (let s = 0; s < state.n; s++) if (s !== seat && points[s] > rival) rival = points[s];
    const value = points[seat] - rival + rng() * 0.5;
    if (value > bestValue) {
      bestValue = value;
      best = shot;
    }
  }
  // 人間と同じように、ねらいは少しぶれる。
  const wobble = (rng() - 0.5) * 0.18;
  const power = 1 + (rng() - 0.5) * 0.08;
  return {
    type: 'shoot',
    vx: (best.vx - best.vy * wobble) * power,
    vy: (best.vy + best.vx * wobble) * power,
  };
}
