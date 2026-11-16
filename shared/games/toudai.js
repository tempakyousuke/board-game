// トウダイ — 灯台の光で海を照らす陣取りゲーム (2〜4人)
//
// ・順番に灯台を1つずつ建てる。灯台は「＋型」(たて・よこ) と「×型」(ななめ) の2種類。
// ・光は岩かほかの灯台 (自分のものも含む) にぶつかるまでまっすぐ進む。
// ・何もない海のマスは、いちばん多く光を当てているプレイヤーのもの。同数なら誰のものでもない。
// ・最後の1基だけは全員が同時にこっそり場所を決める。同じマスを選ぶと、どちらも建てられない。
// ・全員が建て終えたとき、照らしているマスが最も多い人の勝ち。

import { assert, makeResult } from './common.js';
import { randInt } from '../rng.js';

export const meta = {
  id: 'toudai',
  name: 'トウダイ',
  emoji: '🌊',
  tagline: '灯台の光で海を照らせ！サイコロなしの陣取り',
  minPlayers: 2,
  maxPlayers: 4,
  time: '10〜15分',
  tags: ['じっくり', '陣取り', '運なし'],
};

const SIZE_BY_PLAYERS = { 2: 7, 3: 8, 4: 9 };
const ROCKS_BY_PLAYERS = { 2: 4, 3: 6, 4: 8 };
export const STOCK = { plus: 5, cross: 3 };
const PER_PLAYER = STOCK.plus + STOCK.cross;

const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

// cells[i]: null = 海 / 'rock' = 岩 / { o: 席, k: 'plus' | 'cross' } = 灯台

export function setup({ n, rng }) {
  const size = SIZE_BY_PLAYERS[n];
  const cells = new Array(size * size).fill(null);

  // 岩は点対称に置いて、どの席から見ても不公平が出にくいようにする。
  const center = size % 2 === 1 ? (size * size - 1) / 2 : -1;
  let remaining = ROCKS_BY_PLAYERS[n];
  let guard = 0;
  while (remaining > 0 && guard++ < 1000) {
    const i = randInt(rng, size * size);
    const mirror = size * size - 1 - i;
    if (i === center || cells[i] || cells[mirror]) continue;
    if (touchesRock(size, cells, i) || touchesRock(size, cells, mirror)) continue;
    cells[i] = 'rock';
    cells[mirror] = 'rock';
    remaining -= 2;
  }

  const order = turnOrder(n, randInt(rng, n));
  return {
    n,
    size,
    cells,
    stock: Array.from({ length: n }, () => ({ ...STOCK })),
    order,
    placed: 0,
    turn: order[0],
    phase: 'build', // build: 順番に建てる / final: 最後の1基を同時に決める
    finalChoice: new Array(n).fill(null),
    finalReveal: null,
    last: [],
    over: false,
    result: null,
  };
}

/**
 * 順番に建てるあいだの手番の並び。1周ごとに折り返す (A→B→C→C→B→A→A→…) ので、
 * 端の人は2回続けて置く。最後の1基は同時に置くため、ここには含めない。
 */
export function turnOrder(n, first) {
  const order = [];
  for (let round = 0; round < PER_PLAYER - 1; round++) {
    for (let k = 0; k < n; k++) {
      const idx = round % 2 === 1 ? n - 1 - k : k;
      order.push((first + idx) % n);
    }
  }
  return order;
}

function touchesRock(size, cells, i) {
  const r = Math.floor(i / size);
  const c = i % size;
  for (const [dr, dc] of ORTH) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
    if (cells[rr * size + cc] === 'rock') return true;
  }
  return false;
}

/**
 * 盤面全体の光を計算する。クライアントの「置いたらどうなるか」プレビューでも使う。
 * @returns {{ counts: number[][], owner: number[], scores: number[] }}
 */
export function lightMap(size, cells, n) {
  const total = size * size;
  const counts = Array.from({ length: total }, () => new Array(n).fill(0));
  for (let i = 0; i < total; i++) {
    const cell = cells[i];
    if (!cell || cell === 'rock') continue;
    const dirs = cell.k === 'plus' ? ORTH : DIAG;
    const r0 = Math.floor(i / size);
    const c0 = i % size;
    for (const [dr, dc] of dirs) {
      let r = r0 + dr;
      let c = c0 + dc;
      while (r >= 0 && c >= 0 && r < size && c < size) {
        const j = r * size + c;
        if (cells[j] !== null) break;
        counts[j][cell.o]++;
        r += dr;
        c += dc;
      }
    }
  }
  const owner = new Array(total).fill(-1);
  const scores = new Array(n).fill(0);
  for (let i = 0; i < total; i++) {
    if (cells[i] !== null) continue;
    let best = 0;
    let who = -1;
    for (let s = 0; s < n; s++) {
      if (counts[i][s] > best) {
        best = counts[i][s];
        who = s;
      } else if (counts[i][s] === best) {
        who = -1;
      }
    }
    owner[i] = who;
    if (who >= 0) scores[who]++;
  }
  return { counts, owner, scores };
}

function checkPlacement(state, seat, action) {
  assert(action && action.type === 'place', '不明な操作です');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  const { cell, kind } = action;
  assert(kind === 'plus' || kind === 'cross', '灯台の種類を選んでください');
  assert(Number.isInteger(cell) && cell >= 0 && cell < state.cells.length, 'マスが正しくありません');
  assert(state.cells[cell] === null, 'そこには建てられません');
  assert(state.stock[seat][kind] > 0, 'その灯台はもう残っていません');
}

export function act(state, seat, action) {
  assert(!state.over, 'ゲームは終了しています');
  checkPlacement(state, seat, action);
  const { cell, kind } = action;

  if (state.phase === 'final') {
    state.finalChoice[seat] = { cell, kind };
    if (state.finalChoice.every((c) => c !== null)) resolveFinal(state);
    return;
  }

  assert(seat === state.turn, 'あなたの番ではありません');
  state.cells[cell] = { o: seat, k: kind };
  state.stock[seat][kind]--;
  state.last = [cell];
  state.placed++;
  if (state.placed >= state.order.length) {
    state.phase = 'final';
    state.turn = -1;
  } else {
    state.turn = state.order[state.placed];
  }
}

function resolveFinal(state) {
  const picks = new Map();
  for (const choice of state.finalChoice) {
    picks.set(choice.cell, (picks.get(choice.cell) || 0) + 1);
  }
  state.last = [];
  state.finalReveal = state.finalChoice.map((choice, seat) => {
    const ok = picks.get(choice.cell) === 1;
    state.stock[seat][choice.kind]--;
    if (ok) {
      state.cells[choice.cell] = { o: seat, k: choice.kind };
      state.last.push(choice.cell);
    }
    return { seat, cell: choice.cell, kind: choice.kind, ok };
  });
  state.finalChoice = new Array(state.n).fill(null);
  state.over = true;
  const { scores } = lightMap(state.size, state.cells, state.n);
  state.result = makeResult(scores, { unit: 'マス' });
}

export function view(state, seat) {
  const { owner, scores } = lightMap(state.size, state.cells, state.n);
  const mine = seat >= 0 && seat < state.n;
  return {
    n: state.n,
    size: state.size,
    cells: state.cells,
    stock: state.stock,
    phase: state.phase,
    turn: state.over ? -1 : state.turn,
    upcoming: state.phase === 'build' ? state.order.slice(state.placed + 1, state.placed + 5) : [],
    submitted: state.finalChoice.map((c) => c !== null),
    myChoice: mine ? state.finalChoice[seat] : null,
    finalReveal: state.finalReveal,
    last: state.last,
    owner,
    scores,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  if (state.phase === 'final') {
    return state.finalChoice.map((c, s) => (c === null ? s : -1)).filter((s) => s >= 0);
  }
  return [state.turn];
}

function evaluate(state, seat) {
  const { scores, counts } = lightMap(state.size, state.cells, state.n);
  let bestOther = -Infinity;
  for (let s = 0; s < state.n; s++) {
    if (s !== seat && scores[s] > bestOther) bestOther = scores[s];
  }
  // 同点のマスにも少しだけ価値を見て、手が単調にならないようにする。
  let contested = 0;
  for (let i = 0; i < counts.length; i++) {
    if (state.cells[i] === null && counts[i][seat] > 0) contested++;
  }
  return scores[seat] - bestOther + contested * 0.05;
}

function legalMoves(state, seat) {
  const moves = [];
  const kinds = ['plus', 'cross'].filter((k) => state.stock[seat][k] > 0);
  for (let i = 0; i < state.cells.length; i++) {
    if (state.cells[i] !== null) continue;
    for (const kind of kinds) moves.push({ type: 'place', cell: i, kind });
  }
  return moves;
}

export function bot(state, seat, rng) {
  const moves = legalMoves(state, seat);
  // 2人戦で次が相手の番なら、相手の最善の返しまで読む (盤が小さいので十分速い)。
  const lookahead =
    state.phase === 'build' && state.n === 2 && state.order[state.placed + 1] === 1 - seat;
  const scored = [];
  for (const move of moves) {
    state.cells[move.cell] = { o: seat, k: move.kind };
    state.stock[seat][move.kind]--;
    let score;
    if (lookahead) {
      const opp = 1 - seat;
      let worst = Infinity;
      for (const reply of legalMoves(state, opp)) {
        state.cells[reply.cell] = { o: opp, k: reply.kind };
        const v = evaluate(state, seat);
        state.cells[reply.cell] = null;
        if (v < worst) worst = v;
      }
      score = worst;
    } else {
      score = evaluate(state, seat);
    }
    state.stock[seat][move.kind]++;
    state.cells[move.cell] = null;
    scored.push({ move, score: score + rng() * 0.6 });
  }
  scored.sort((a, b) => b.score - a.score);
  // 同時に置く最後の1基は、いちばん良いマスが相手とかぶりやすいので少しばらけさせる。
  if (state.phase === 'final' && scored.length > 1) {
    const second = scored.find((s) => s.move.cell !== scored[0].move.cell);
    if (second && scored[0].score - second.score < 1.2 && rng() < 0.35) return second.move;
  }
  return scored[0].move;
}
