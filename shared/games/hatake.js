// はたけパズル — 全員が同じ形のたねを、自分の畑にすき間なく植えていくパズル (1〜6人)
//
// ・毎ラウンド「たねのふくろ」が1つめくられる。ふくろには形が決まっていて、全員が同じ形を植える。
// ・向きを変えたり裏返したりして、自分の 6×6 の畑の空いているところに植える。
// ・植えられない (植えたくない) ときは見送るか、1回だけ使える「ひとつぶだね」で1マスだけ植える。
// ・10ラウンドで終了。植えたマスの数、そろった列、ふかふかの土に植えた数で点が入る。
// ・全員が同じ畑・同じ形で遊ぶので、差がつくのは置き方だけ。

import { assert, makeResult } from './common.js';
import { shuffle } from '../rng.js';

export const meta = {
  id: 'hatake',
  name: 'はたけパズル',
  emoji: '🥕',
  tagline: 'みんな同じ形のたね。畑にぴったり植えられるのはだれ？',
  minPlayers: 1,
  maxPlayers: 6,
  time: '10分',
  tags: ['じっくり', 'パズル', '同時プレイ'],
};

export const SIZE = 6;
export const ROUNDS = 10;
export const SEEDS = 1;
export const LINE_POINTS = 3;
export const SOIL_POINTS = 2;
const ROCKS = 3;
const SOILS = 4;

/**
 * たねのふくろ。cells は [行, 列] の並び。count は山に入っている数 (全部で 15、うち 10 が出る)。
 * 小さい形ばかりだと、だれでもすき間なく埋められてしまう。CPU に遊ばせて、
 * 満点がめったに出ない大きさの組み合わせにしてある。
 */
export const SHAPES = {
  morokoshi: { emoji: '🌽', name: 'とうもろこし', count: 1, cells: [[0, 0], [0, 1], [0, 2]] },
  nasu: { emoji: '🍆', name: 'なす', count: 2, cells: [[0, 0], [1, 0], [1, 1]] },
  kabocha: { emoji: '🎃', name: 'かぼちゃ', count: 1, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  kyuri: { emoji: '🥒', name: 'きゅうり', count: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  hakusai: { emoji: '🥬', name: 'はくさい', count: 2, cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
  ichigo: { emoji: '🍓', name: 'いちご', count: 2, cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
  mame: { emoji: '🫛', name: 'えだまめ', count: 2, cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  suika: { emoji: '🍉', name: 'すいか', count: 1, cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]] },
  budo: { emoji: '🍇', name: 'ぶどう', count: 1, cells: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]] },
  togarashi: { emoji: '🌶️', name: 'とうがらし', count: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
  piman: { emoji: '🫑', name: 'ピーマン', count: 1, cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]] },
};
export const SEED = { emoji: '🌱', name: 'ひとつぶだね' };

/** 形を左上につめて、行→列の順に並べる。 */
function normalize(cells) {
  const minR = Math.min(...cells.map(([r]) => r));
  const minC = Math.min(...cells.map(([, c]) => c));
  return cells.map(([r, c]) => [r - minR, c - minC]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** 形を rot 回 (90度ずつ) まわし、flip なら左右を裏返した形。 */
export function transform(cells, rot = 0, flip = false) {
  let out = cells.map(([r, c]) => (flip ? [r, -c] : [r, c]));
  for (let i = 0; i < rot % 4; i++) out = out.map(([r, c]) => [c, -r]);
  return normalize(out);
}

const key = (cells) => cells.map(([r, c]) => `${r},${c}`).join(';');

/** その形の、向きのちがいをすべて (重複なしで)。 */
export function orientations(id) {
  const seen = new Map();
  for (const flip of [false, true]) {
    for (let rot = 0; rot < 4; rot++) {
      const cells = transform(SHAPES[id].cells, rot, flip);
      if (!seen.has(key(cells))) seen.set(key(cells), cells);
    }
  }
  return [...seen.values()];
}
const ORIENTATIONS = Object.fromEntries(Object.keys(SHAPES).map((id) => [id, orientations(id)]));

/** 畑のマス番号の集まりが、その形 (どれかの向き) になっているか。 */
export function matchesShape(id, cells) {
  const coords = normalize(cells.map((cell) => [Math.floor(cell / SIZE), cell % SIZE]));
  const wanted = key(coords);
  return ORIENTATIONS[id].some((o) => key(o) === wanted);
}

export function scoreField(field, soils) {
  const planted = field.filter((v) => v && v !== 'rock').length;
  let lines = 0;
  for (let i = 0; i < SIZE; i++) {
    let row = true;
    let col = true;
    for (let j = 0; j < SIZE; j++) {
      if (!field[i * SIZE + j]) row = false;
      if (!field[j * SIZE + i]) col = false;
    }
    lines += (row ? 1 : 0) + (col ? 1 : 0);
  }
  const soil = soils.filter((cell) => field[cell]).length;
  return {
    planted,
    lines,
    soil,
    total: planted + lines * LINE_POINTS + soil * SOIL_POINTS,
  };
}

export function setup({ n, rng, config = {} }) {
  const rockCount = config.rocks ?? ROCKS;
  const cells = shuffle(
    rng,
    Array.from({ length: SIZE * SIZE }, (_, i) => i),
  );
  const rocks = cells.slice(0, rockCount);
  const soils = cells.slice(rockCount, rockCount + SOILS);
  const counts = config.counts ?? Object.fromEntries(Object.entries(SHAPES).map(([id, shape]) => [id, shape.count]));
  const deck = shuffle(
    rng,
    Object.entries(counts).flatMap(([id, count]) => new Array(count).fill(id)),
  );
  const field = new Array(SIZE * SIZE).fill(null);
  for (const rock of rocks) field[rock] = 'rock';

  return {
    n,
    round: 1,
    maxRounds: config.rounds ?? ROUNDS,
    rocks,
    soils,
    deck, // deck[round - 1] がそのラウンドの形。残りは使われない
    fields: Array.from({ length: n }, () => field.slice()), // null / 'rock' / 形の id / 'seed'
    seeds: new Array(n).fill(config.seeds ?? SEEDS),
    choice: new Array(n).fill(null),
    last: Array.from({ length: n }, () => []),
    over: false,
    result: null,
  };
}

export function act(state, seat, action) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && typeof action.type === 'string', '不明な操作です');
  const field = state.fields[seat];
  const shape = state.deck[state.round - 1];

  if (action.type === 'plant') {
    const cells = action.cells;
    assert(Array.isArray(cells) && cells.length === SHAPES[shape].cells.length, 'たねの形が合っていません');
    assert(cells.every((c) => Number.isInteger(c) && c >= 0 && c < SIZE * SIZE), 'マスが正しくありません');
    assert(new Set(cells).size === cells.length, 'マスが重なっています');
    assert(matchesShape(shape, cells), 'たねの形が合っていません');
    assert(cells.every((c) => field[c] === null), 'そこには植えられません');
    state.choice[seat] = { kind: 'plant', cells: cells.slice() };
  } else if (action.type === 'seed') {
    assert(state.seeds[seat] > 0, 'ひとつぶだねはもうありません');
    assert(Number.isInteger(action.cell) && field[action.cell] === null, 'そこには植えられません');
    state.choice[seat] = { kind: 'seed', cell: action.cell };
  } else if (action.type === 'skip') {
    state.choice[seat] = { kind: 'skip' };
  } else {
    assert(false, '不明な操作です');
  }
  if (state.choice.every((c) => c !== null)) resolve(state);
}

function resolve(state) {
  const shape = state.deck[state.round - 1];
  for (let s = 0; s < state.n; s++) {
    const choice = state.choice[s];
    if (choice.kind === 'plant') {
      for (const cell of choice.cells) state.fields[s][cell] = shape;
      state.last[s] = choice.cells;
    } else if (choice.kind === 'seed') {
      state.fields[s][choice.cell] = 'seed';
      state.seeds[s]--;
      state.last[s] = [choice.cell];
    } else {
      state.last[s] = [];
    }
  }
  state.choice = new Array(state.n).fill(null);

  if (state.round >= state.maxRounds) {
    state.over = true;
    const parts = state.fields.map((f) => scoreField(f, state.soils));
    const scores = parts.map((p) => p.total);
    state.result = makeResult(scores, { unit: '点', detail: { parts } });
    if (state.n === 1) state.result.headline = `${scores[0]}点 — ${title(scores[0])}`;
    return;
  }
  state.round++;
}

/** 1人で遊んだときの称号。 */
function title(score) {
  if (score >= 65) return '伝説の農家！';
  if (score >= 55) return '畑の名人';
  if (score >= 45) return '一人前の農家';
  return '見習い農家';
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  const parts = state.fields.map((f) => scoreField(f, state.soils));
  return {
    n: state.n,
    size: SIZE,
    round: state.round,
    maxRounds: state.maxRounds,
    rocks: state.rocks,
    soils: state.soils,
    shape: state.over ? null : state.deck[state.round - 1],
    next: state.round < state.maxRounds ? state.deck[state.round] : null,
    fields: state.fields,
    seeds: state.seeds,
    submitted: state.choice.map((c) => c !== null),
    myChoice: mine ? state.choice[seat] : null,
    last: state.last,
    scores: parts.map((p) => p.total),
    parts,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  return state.choice.map((c, s) => (c === null ? s : -1)).filter((s) => s >= 0);
}

/** その形を畑に置ける場所をすべて挙げる。 */
export function placements(field, id) {
  const out = [];
  for (const cells of ORIENTATIONS[id]) {
    const height = Math.max(...cells.map(([r]) => r)) + 1;
    const width = Math.max(...cells.map(([, c]) => c)) + 1;
    for (let r = 0; r + height <= SIZE; r++) {
      for (let c = 0; c + width <= SIZE; c++) {
        const abs = cells.map(([dr, dc]) => (r + dr) * SIZE + c + dc);
        if (abs.every((cell) => field[cell] === null)) out.push(abs);
      }
    }
  }
  return out;
}

const SIDES = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/** 置いたあとの畑の良さ。点数に加えて、あとで困る「ぽつんと空いたマス」をきらう。 */
function evaluate(field, soils) {
  let value = scoreField(field, soils).total;
  for (let cell = 0; cell < field.length; cell++) {
    if (field[cell] !== null) continue;
    const r = Math.floor(cell / SIZE);
    const c = cell % SIZE;
    let open = 0;
    for (const [dr, dc] of SIDES) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < SIZE && cc < SIZE && field[rr * SIZE + cc] === null) open++;
    }
    // 空きマスがとなりにないと、ひとつぶだねでしか埋まらない。
    if (open === 0) value -= 2.2;
    else if (open === 1) value -= 0.5;
  }
  return value;
}

export function bot(state, seat, rng) {
  const field = state.fields[seat];
  const shape = state.deck[state.round - 1];
  let best = null;
  let bestValue = -Infinity;
  for (const cells of placements(field, shape)) {
    for (const cell of cells) field[cell] = shape;
    const value = evaluate(field, state.soils) + rng() * 0.4;
    for (const cell of cells) field[cell] = null;
    if (value > bestValue) {
      bestValue = value;
      best = { type: 'plant', cells };
    }
  }
  if (best) return best;

  // 置けないときは、ひとつぶだねでいちばん得なマスを埋める。
  if (state.seeds[seat] > 0) {
    let cell = -1;
    let value = -Infinity;
    for (let i = 0; i < field.length; i++) {
      if (field[i] !== null) continue;
      field[i] = 'seed';
      const v = evaluate(field, state.soils) + rng() * 0.2;
      field[i] = null;
      if (v > value) {
        value = v;
        cell = i;
      }
    }
    if (cell >= 0) return { type: 'seed', cell };
  }
  return { type: 'skip' };
}
