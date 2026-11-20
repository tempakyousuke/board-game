// 神器の箱庭 — 5×5 の地形の上で、拾った神器をぶつけ合う (2〜6人)
//
// ・自分の番は「移動 → 神器を1枚ひろう → 神器を1枚使う」。
// ・移動は、たて・よこに1マス。その場にとどまれるのは、どこへも動けないときだけ
//   (とどまれると、泉に居すわって回復し続けるのが強すぎた)。ひろえる神器は、立っているマスの地形で決まる。
// ・となり (たて・よこの4マス。移動できる範囲と同じ) に人がいるときは、移動のかわりに、その人に当たる武器を使える。
//   そのあと、いつもどおり神器を1枚使えるので、1ターンに2回使えることになる (そのターンは神器をひろえない)。
// ・手札がいっぱい (10枚) のときにひろうなら、古い神器を1枚すてるか、ひろわないかを選ぶ。
// ・岩かべには耐久力があり、攻撃を当てるとこわせる。
// ・盤のどこかに「予言の地」が1マスある。入ると特別な神器をひろえるが、そのマスは消えて元の地形にもどり、
//   5ターン後に、どこか別のマスに現れる。
// ・武器には形がある (たて・よこの直線、ななめ、まわり8マス、十字など)。貫通する武器は、線の上の全員に当たる。
// ・攻撃された人は、手札の防具を何枚でも出して受ける。出した枚数だけ、足もとの地形から引き直す。
// ・地形には効果がある (森は守りやすい、山は攻撃が強くなる、泉は回復、溶岩は強い神器のかわりにダメージ)。
// ・奇跡の神器で、地形を変えられる。
// ・HP がなくなった人は脱落。最後の1人が勝ち。
// ・100ターンをすぎると、全部のマスが魔界になる (毎ターン大ダメージ)。かならず決着がつく。

import { assert, makeResult } from './common.js';
import { randInt, shuffle } from '../rng.js';

export const meta = {
  id: 'hakoniwa',
  name: '神器の箱庭',
  emoji: '⚡',
  tagline: '地形を歩いて神器をひろい、たて・よこ・ななめに撃ち合う',
  minPlayers: 2,
  maxPlayers: 6,
  time: '15〜30分',
  tags: ['じっくり', 'バトル', '陣取り'],
  botDelayMs: 900,
};

export const SIZE = 5;
export const START_HP = 30;
export const MAX_HP = 99;
export const START_HAND = 5;
export const HAND_LIMIT = 10;
export const MAKAI_TURN = 100; // このターンをすぎたら、全部のマスが魔界になる
export const SPRING_HEAL = 2;
export const FOREST_COVER = 1;
export const MOUNTAIN_EDGE = 1;
export const WALL_HP = 10; // 岩かべの耐久力
export const ORACLE_WAIT = 5; // 予言の地が消えてから、また現れるまでのターン数
const EVENTS_KEPT = 40;

// ---- 神器 -------------------------------------------------------------------
//
// weapon: shape (line: たて・よこの1方向 / diag: ななめの1方向 / around: まわり8マス /
//         cross: たて・よこ4方向ぜんぶ / star: 8方向ぜんぶ / bolt: どこにいても1人 / all: どこにいても全員)
//         range: とどくマス数, pierce: 貫通するか, push: 当たった相手を押すマス数
// guard:  block: へらせるダメージ
// heal:   amount
// miracle: effect (erupt / wall / flatten / swap / dash)

export const ARTIFACTS = {
  // 平地
  sword: { name: 'つるぎ', emoji: '🗡️', kind: 'weapon', shape: 'line', range: 1, power: 6 },
  spear: { name: 'やり', emoji: '🔱', kind: 'weapon', shape: 'line', range: 2, pierce: true, power: 5 },
  sickle: { name: 'まわし鎌', emoji: '🌀', kind: 'weapon', shape: 'around', range: 1, pierce: true, power: 4 },
  woodShield: { name: '木のたて', emoji: '🛡️', kind: 'guard', block: 3 },
  // 森
  bow: { name: 'ゆみ', emoji: '🏹', kind: 'weapon', shape: 'line', range: 4, power: 5 },
  boomerang: { name: 'ブーメラン', emoji: '🪃', kind: 'weapon', shape: 'diag', range: 3, pierce: true, power: 4 },
  dart: { name: 'ふき矢', emoji: '🎯', kind: 'weapon', shape: 'diag', range: 4, power: 5 },
  leafCloak: { name: '木の葉のマント', emoji: '🍃', kind: 'guard', block: 2 },
  // 山
  hammer: { name: '大づち', emoji: '🔨', kind: 'weapon', shape: 'line', range: 1, power: 9 },
  cannon: { name: '岩おとし', emoji: '☄️', kind: 'weapon', shape: 'line', range: 4, pierce: true, power: 6 },
  ironShield: { name: '鉄のたて', emoji: '🔰', kind: 'guard', block: 6 },
  armor: { name: 'よろい', emoji: '🥋', kind: 'guard', block: 4 },
  // 泉
  water: { name: 'いやしの水', emoji: '💧', kind: 'heal', amount: 6 },
  elixir: { name: '命のしずく', emoji: '🧪', kind: 'heal', amount: 10 },
  mist: { name: '霧のころも', emoji: '🌫️', kind: 'guard', block: 4 },
  dash: { name: '追い風', emoji: '💨', kind: 'miracle', effect: 'dash', range: 2 },
  // 遺跡
  erupt: { name: '噴火', emoji: '🌋', kind: 'miracle', effect: 'erupt', power: 3 },
  wall: { name: '岩かべ', emoji: '🧱', kind: 'miracle', effect: 'wall' },
  flatten: { name: '地ならし', emoji: '🌾', kind: 'miracle', effect: 'flatten' },
  gust: { name: '突風', emoji: '🌪️', kind: 'weapon', shape: 'line', range: 3, power: 3, push: 2 },
  swap: { name: '入れかえ', emoji: '🔄', kind: 'miracle', effect: 'swap' },
  thunder: { name: 'いかずち', emoji: '⚡', kind: 'weapon', shape: 'bolt', power: 4 },
  // 使うと、CHAOS のどれか1つがランダムに起きる。
  chaos: { name: 'ふしぎな箱', emoji: '🎁', kind: 'miracle', effect: 'chaos' },
  // 溶岩
  flameSword: { name: '炎のつるぎ', emoji: '🔥', kind: 'weapon', shape: 'line', range: 2, pierce: true, power: 9 },
  inferno: { name: '業火', emoji: '💥', kind: 'weapon', shape: 'around', range: 1, pierce: true, power: 7 },
  lavaAxe: { name: '溶岩のおの', emoji: '🪓', kind: 'weapon', shape: 'line', range: 1, power: 12 },
  // 魔界
  demonSword: { name: '魔剣', emoji: '⚔️', kind: 'weapon', shape: 'cross', range: 4, pierce: true, power: 10 },
  doomLight: { name: '滅びの光', emoji: '🌟', kind: 'weapon', shape: 'star', range: 4, pierce: true, power: 9 },
  demonShield: { name: '魔王のたて', emoji: '👿', kind: 'guard', block: 10 },
  // 予言の地 (スペシャル)
  judgment: { name: '天のさばき', emoji: '🌩️', kind: 'weapon', shape: 'all', power: 6 },
  dragon: { name: '竜のいぶき', emoji: '🐉', kind: 'weapon', shape: 'line', range: 4, pierce: true, power: 11 },
  holyShield: { name: '神のたて', emoji: '✨', kind: 'guard', block: 12 },
  lifeFruit: { name: '命の実', emoji: '🍎', kind: 'heal', amount: 20 },
};

// ---- 地形 -------------------------------------------------------------------
// hurt: 移動のあと、そのマスにいると受けるダメージ。deck: ひろえる神器と出やすさ。

export const TERRAINS = {
  plain: { name: '平地', emoji: '🌾', hurt: 0, deck: { sword: 3, spear: 3, sickle: 2, woodShield: 3 } },
  forest: { name: '森', emoji: '🌲', hurt: 0, deck: { bow: 3, boomerang: 3, dart: 2, leafCloak: 3 } },
  mountain: { name: '山', emoji: '⛰️', hurt: 0, deck: { hammer: 2, cannon: 2, ironShield: 3, armor: 3 } },
  spring: { name: '泉', emoji: '⛲', hurt: 0, deck: { water: 4, elixir: 2, mist: 3, dash: 2 } },
  ruin: { name: '遺跡', emoji: '🏛️', hurt: 0, deck: { erupt: 3, wall: 2, flatten: 1, gust: 2, swap: 2, thunder: 3, chaos: 2 } },
  lava: { name: '溶岩', emoji: '🌋', hurt: 2, deck: { flameSword: 3, inferno: 3, lavaAxe: 2 } },
  makai: { name: '魔界', emoji: '😈', hurt: 4, deck: { demonSword: 3, doomLight: 2, demonShield: 2 } },
  wall: { name: '岩かべ', emoji: '🧱', hurt: 0, deck: {} },
  oracle: { name: '予言の地', emoji: '🔮', hurt: 0, deck: { judgment: 2, dragon: 2, holyShield: 2, lifeFruit: 2 } },
};
// ふしぎな箱で起きること。
export const CHAOS = {
  shuffle: '全員の神器をまぜて、配り直した（枚数はそのまま）',
  remap: '地形が、全部つくり直された',
  refill: '手札が、上限までいっぱいになった',
  equal: '全員の HP が、同じになった',
};

const MAP_COUNTS = { plain: 8, forest: 5, mountain: 4, spring: 3, ruin: 3, lava: 2 };
const STARTER_TERRAINS = ['plain', 'forest', 'mountain', 'spring'];
// 始まる場所 (人数ごと)。[x, y]
const STARTS = {
  2: [[0, 0], [4, 4]],
  3: [[0, 0], [4, 0], [2, 4]],
  4: [[0, 0], [4, 0], [4, 4], [0, 4]],
  5: [[0, 0], [4, 0], [4, 4], [0, 4], [2, 2]],
  6: [[0, 0], [2, 0], [4, 0], [4, 4], [2, 4], [0, 4]],
};

const DIR4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const DIAG = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
export const DIR_NAMES = { line: ['上', '右', '下', '左'], diag: ['右上', '右下', '左下', '左上'] };

export const cellOf = (x, y) => y * SIZE + x;
export const xOf = (cell) => cell % SIZE;
export const yOf = (cell) => Math.floor(cell / SIZE);
const inside = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
const fill = (n, value) => new Array(n).fill(value);

/** そのマスにいる人 (いなければ -1)。field は { cells, pos, alive } を持つもの (状態でも、画面用の情報でもよい)。 */
export function whoAt(field, cell) {
  for (let s = 0; s < field.pos.length; s++) if (field.alive[s] && field.pos[s] === cell) return s;
  return -1;
}

/** from から1方向へのびる線。岩かべで止まる。貫通しない武器は、最初に当たった人で止まる。 */
function ray(field, from, [dx, dy], range, pierce) {
  const cells = [];
  const hits = [];
  const walls = [];
  let x = xOf(from);
  let y = yOf(from);
  for (let step = 0; step < range; step++) {
    x += dx;
    y += dy;
    if (!inside(x, y)) break;
    const cell = cellOf(x, y);
    cells.push(cell);
    if (field.cells[cell] === 'wall') {
      // 岩かべが攻撃を受け止める。
      walls.push(cell);
      break;
    }
    const seat = whoAt(field, cell);
    if (seat >= 0) {
      hits.push(seat);
      if (!pierce) break;
    }
  }
  return { cells, hits, walls };
}

function merge(rays) {
  return { cells: rays.flatMap((r) => r.cells), hits: rays.flatMap((r) => r.hits), walls: rays.flatMap((r) => r.walls) };
}

/** となり (たて・よこの4マス) にいる人。 */
export function neighborsOf(field, seat) {
  const from = field.pos[seat];
  const list = [];
  for (let s = 0; s < field.pos.length; s++) {
    if (s === seat || !field.alive[s]) continue;
    if (Math.abs(xOf(field.pos[s]) - xOf(from)) + Math.abs(yOf(field.pos[s]) - yOf(from)) === 1) list.push(s);
  }
  return list;
}

/** 移動のかわりに使える使い方か (となりの人に当たる武器だけ)。 */
export function strikesNeighbor(field, seat, id, option) {
  if (ARTIFACTS[id].kind !== 'weapon') return false;
  const near = neighborsOf(field, seat);
  return option.hits.some((target) => near.includes(target));
}

/** 移動できるマス。どこへも動けないときだけ、その場にとどまれる。 */
export function movesFor(field, seat) {
  const from = field.pos[seat];
  const list = [];
  for (const [dx, dy] of DIR4) {
    const x = xOf(from) + dx;
    const y = yOf(from) + dy;
    if (!inside(x, y)) continue;
    const cell = cellOf(x, y);
    if (field.cells[cell] !== 'wall' && whoAt(field, cell) < 0) list.push(cell);
  }
  return list.length ? list : [from];
}

/**
 * その神器の使い方の一覧。それぞれ { label, cells: 光らせるマス, hits: 当たる人, ... }。
 * 使えない神器 (防具など) は、空の一覧になる。
 */
export function optionsFor(field, seat, id) {
  const art = ARTIFACTS[id];
  const from = field.pos[seat];
  if (art.kind === 'heal') return [{ label: '自分に使う', cells: [from], hits: [], walls: [] }];
  if (art.kind === 'weapon') {
    if (art.shape === 'line' || art.shape === 'diag') {
      const dirs = art.shape === 'line' ? DIR4 : DIAG;
      return dirs
        .map((dir, d) => ({ dir: d, label: DIR_NAMES[art.shape][d], ...ray(field, from, dir, art.range, art.pierce) }))
        .filter((option) => option.cells.length > 0);
    }
    if (art.shape === 'all') {
      const hits = field.pos.map((_, s) => s).filter((s) => s !== seat && field.alive[s]);
      return [{ label: '全員', cells: hits.map((s) => field.pos[s]), hits, walls: [] }];
    }
    if (art.shape === 'bolt') {
      return field.pos.map((cell, s) => ({ target: s, label: '', cells: [cell], hits: [s], walls: [] })).filter((o) => o.target !== seat && field.alive[o.target]);
    }
    const dirs = art.shape === 'cross' ? DIR4 : [...DIR4, ...DIAG];
    const all = merge(dirs.map((dir) => ray(field, from, dir, art.range, true)));
    return all.cells.length ? [{ label: art.shape === 'cross' ? '十字' : art.shape === 'star' ? '8方向' : 'まわり', ...all }] : [];
  }
  if (art.kind !== 'miracle') return [];
  if (art.effect === 'chaos') return [{ label: '自分に使う', cells: [from], hits: [], walls: [] }];
  const options = [];
  for (let cell = 0; cell < SIZE * SIZE; cell++) {
    const terrain = field.cells[cell];
    const seatHere = whoAt(field, cell);
    if (art.effect === 'swap') {
      if (seatHere >= 0 && seatHere !== seat) options.push({ cell, target: seatHere, label: '', cells: [cell], hits: [] });
      continue;
    }
    if (art.effect === 'dash') {
      const far = Math.abs(xOf(cell) - xOf(from)) + Math.abs(yOf(cell) - yOf(from));
      if (far >= 1 && far <= art.range && terrain !== 'wall' && seatHere < 0) options.push({ cell, label: '', cells: [cell], hits: [] });
      continue;
    }
    // 地形を変える奇跡。魔界と予言の地は変えられない。
    if (terrain === 'makai' || terrain === 'oracle') continue;
    if (art.effect === 'erupt' && terrain !== 'lava' && terrain !== 'wall') options.push({ cell, label: '', cells: [cell], hits: seatHere >= 0 ? [seatHere] : [] });
    if (art.effect === 'wall' && terrain !== 'wall' && seatHere < 0) options.push({ cell, label: '', cells: [cell], hits: [] });
    if (art.effect === 'flatten' && terrain !== 'plain') options.push({ cell, label: '', cells: [cell], hits: [] });
  }
  return options;
}

/** 攻撃の威力 (山の上からは強くなる)。 */
export function powerOf(field, seat, id) {
  return ARTIFACTS[id].power + (field.cells[field.pos[seat]] === 'mountain' ? MOUNTAIN_EDGE : 0);
}

/** 受けるダメージ (森の中では減る)。 */
export function damageOf(field, target, power, block) {
  const cover = field.cells[field.pos[target]] === 'forest' ? FOREST_COVER : 0;
  return Math.max(0, power - block - cover);
}

// ---- 進行 -------------------------------------------------------------------

function drawFrom(terrain, rng) {
  const entries = Object.entries(TERRAINS[terrain].deck);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total === 0) return null;
  let roll = rng() * total;
  for (const [id, weight] of entries) {
    roll -= weight;
    if (roll < 0) return id;
  }
  return entries[0][0];
}

function note(state, event) {
  state.events.push({ seq: ++state.seq, turn: state.turnNo, ...event });
  if (state.events.length > EVENTS_KEPT) state.events.shift();
}

export function setup({ n, rng }) {
  let cells = shuffle(rng, Object.entries(MAP_COUNTS).flatMap(([terrain, count]) => fill(count, terrain)));
  const pos = STARTS[n].map(([x, y]) => cellOf(x, y));
  // 始まるマスは平地にする (ほかの平地と入れかえる)。
  cells = cells.slice();
  for (const cell of pos) {
    if (cells[cell] === 'plain') continue;
    const other = cells.findIndex((terrain, i) => terrain === 'plain' && !pos.includes(i));
    [cells[cell], cells[other]] = [cells[other], cells[cell]];
  }
  // 予言の地を、始まるマス以外のどこかに置く。
  const spots = cells.map((_, i) => i).filter((i) => !pos.includes(i));
  const spot = spots[randInt(rng, spots.length)];
  const oracle = { cell: spot, under: cells[spot], returnsAt: 0 };
  cells[spot] = 'oracle';
  const state = {
    n,
    cells,
    oracle, // 予言の地 (cell: いまある場所。消えているあいだは -1 / under: その下の地形 / returnsAt: また現れるターン)
    pos,
    hp: fill(n, START_HP),
    alive: fill(n, true),
    hands: Array.from({ length: n }, () => Array.from({ length: START_HAND }, () => drawFrom(STARTER_TERRAINS[randInt(rng, STARTER_TERRAINS.length)], rng))),
    turn: randInt(rng, n),
    turnNo: 1,
    phase: 'move', // move: 移動 (か、となりへの攻撃) / pick: 手札がいっぱいのときの入れかえ / use: 神器を使う / guard: 攻撃された人が受ける
    attack: null,
    found: null, // ひろおうとしている神器 (手札がいっぱいのとき)
    walls: {}, // 岩かべの残りの耐久力 (マス → 数)
    makai: false,
    out: [], // 脱落した順
    events: [],
    seq: 0,
    over: false,
    result: null,
  };
  return state;
}

function hurt(state, seat, amount, why) {
  if (amount <= 0 || !state.alive[seat]) return;
  state.hp[seat] = Math.max(0, state.hp[seat] - amount);
  if (why) note(state, { t: 'hurt', seat, amount, why });
  if (state.hp[seat] === 0) {
    state.alive[seat] = false;
    state.hands[seat] = [];
    state.out.push(seat);
    note(state, { t: 'dead', seat });
  }
}

function finish(state) {
  state.over = true;
  state.phase = 'over';
  state.attack = null;
  // 残った人が1位。あとは、長く生き残った順。
  const order = fill(state.n, state.n);
  state.out.forEach((seat, i) => (order[seat] = i));
  state.result = makeResult(state.hp.slice(), { unit: 'HP', tiebreak: order, detail: { out: state.out.slice(), turns: state.turnNo } });
}

function endTurn(state, rng) {
  state.attack = null;
  if (state.alive.filter(Boolean).length <= 1) return finish(state);
  let next = state.turn;
  do next = (next + 1) % state.n;
  while (!state.alive[next]);
  state.turn = next;
  state.turnNo++;
  state.phase = 'move';
  if (!state.makai && state.turnNo > MAKAI_TURN) {
    state.makai = true;
    state.cells = state.cells.map(() => 'makai');
    state.walls = {};
    state.oracle = { cell: -1, under: null, returnsAt: 0 };
    note(state, { t: 'makai' });
  }
  // 予言の地が、どこか別のマスに現れる (人のいないマス。岩かべは除く)。
  if (!state.makai && state.oracle.cell < 0 && state.turnNo >= state.oracle.returnsAt) {
    const free = state.cells.map((_, i) => i).filter((i) => state.cells[i] !== 'wall' && whoAt(state, i) < 0 && i !== state.oracle.last);
    if (free.length) {
      const cell = free[randInt(rng, free.length)];
      state.oracle = { cell, under: state.cells[cell], returnsAt: 0 };
      state.cells[cell] = 'oracle';
      note(state, { t: 'oracle', cell });
    }
  }
  // 泉にいる人は、番の初めに回復する。
  if (state.cells[state.pos[next]] === 'spring' && state.hp[next] < MAX_HP) {
    const amount = Math.min(SPRING_HEAL, MAX_HP - state.hp[next]);
    state.hp[next] += amount;
    note(state, { t: 'heal', seat: next, amount, why: 'spring' });
  }
}

function gain(state, seat, rng, count = 1) {
  let got = 0;
  for (let i = 0; i < count; i++) {
    if (state.hands[seat].length >= HAND_LIMIT) break;
    // 予言の地の上で引き直すときは、その下の地形から引く。
    const here = state.cells[state.pos[seat]];
    const id = drawFrom(here === 'oracle' ? state.oracle.under : here, rng);
    if (!id) break;
    state.hands[seat].push(id);
    got++;
  }
  return got;
}

/** 岩かべに攻撃が当たる。耐久力がなくなったら、平地になる。 */
function hitWalls(state, walls, power) {
  for (const cell of walls) {
    if (state.cells[cell] !== 'wall') continue;
    state.walls[cell] = (state.walls[cell] ?? WALL_HP) - power;
    const broken = state.walls[cell] <= 0;
    if (broken) {
      state.cells[cell] = 'plain';
      delete state.walls[cell];
    }
    note(state, { t: 'wall', cell, amount: power, broken });
  }
}

/** 攻撃が片づいたあと。移動のかわりの攻撃なら、つづけて神器を使える。 */
function afterAttack(state, first, rng) {
  state.attack = null;
  if (!first || !state.alive[state.turn] || state.alive.filter(Boolean).length <= 1) return endTurn(state, rng);
  state.phase = 'use';
}

function resolveAttack(state, rng) {
  const { from, card, power, cells, targets, guards, walls, first } = state.attack;
  const art = ARTIFACTS[card];
  const results = [];
  for (const target of targets) {
    const picked = guards[target].slice().sort((a, b) => b - a);
    const used = picked.map((i) => state.hands[target][i]);
    const block = used.reduce((sum, id) => sum + ARTIFACTS[id].block, 0);
    const damage = damageOf(state, target, power, block);
    for (const i of picked) state.hands[target].splice(i, 1);
    results.push({ seat: target, guard: used, damage });
  }
  note(state, { t: 'attack', seat: from, card, power, cells, results });
  for (const r of results) {
    hurt(state, r.seat, r.damage, null);
    if (!state.alive[r.seat]) continue;
    // 使った防具の枚数だけ、足もとの地形から引き直す。
    if (r.guard.length) gain(state, r.seat, rng, r.guard.length);
    if (art.push) {
      // 押された人は、岩かべ・盤のはし・ほかの人にぶつかるまで下がる。
      const [dx, dy] = DIR4[state.attack.dir];
      let moved = 0;
      for (let step = 0; step < art.push; step++) {
        const x = xOf(state.pos[r.seat]) + dx;
        const y = yOf(state.pos[r.seat]) + dy;
        if (!inside(x, y) || state.cells[cellOf(x, y)] === 'wall' || whoAt(state, cellOf(x, y)) >= 0) break;
        state.pos[r.seat] = cellOf(x, y);
        moved++;
      }
      if (moved) note(state, { t: 'pushed', seat: r.seat, to: state.pos[r.seat] });
    }
  }
  hitWalls(state, walls, power);
  afterAttack(state, first, rng);
}

/** ふしぎな箱: どれか1つがランダムに起きる。 */
function chaos(state, seat, rng) {
  const living = state.alive.map((ok, s) => (ok ? s : -1)).filter((s) => s >= 0);
  // 魔界になったあとは、地形は変わらない。
  const kinds = Object.keys(CHAOS).filter((kind) => kind !== 'remap' || !state.makai);
  const effect = kinds[randInt(rng, kinds.length)];
  if (effect === 'shuffle') {
    const pile = shuffle(rng, living.flatMap((s) => state.hands[s]));
    for (const s of living) state.hands[s] = pile.splice(0, state.hands[s].length);
  } else if (effect === 'remap') {
    state.cells = shuffle(rng, Object.entries(MAP_COUNTS).flatMap(([terrain, count]) => fill(count, terrain)));
    state.walls = {};
    if (state.oracle.cell >= 0) {
      // 予言の地も、人のいないどこかへ移る。
      const free = state.cells.map((_, i) => i).filter((i) => whoAt(state, i) < 0);
      const cell = free[randInt(rng, free.length)];
      state.oracle = { cell, under: state.cells[cell], returnsAt: 0 };
      state.cells[cell] = 'oracle';
    }
  } else if (effect === 'refill') {
    gain(state, seat, rng, HAND_LIMIT);
  } else {
    const even = Math.round(living.reduce((sum, s) => sum + state.hp[s], 0) / living.length);
    for (const s of living) state.hp[s] = even;
  }
  note(state, { t: 'chaos', seat, effect });
}

export function act(state, seat, action, rng) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n && state.alive[seat], '操作できません');
  assert(action && typeof action.type === 'string', '不明な操作です');

  if (state.phase === 'guard') {
    const { attack } = state;
    assert(action.type === 'guard', 'いまは、攻撃を受ける人の番です');
    assert(attack.targets.includes(seat) && !(seat in attack.guards), 'あなたが受ける番ではありません');
    const picked = action.cards ?? [];
    assert(Array.isArray(picked) && new Set(picked).size === picked.length, '防具のえらび方が正しくありません');
    for (const i of picked) {
      assert(Number.isInteger(i) && i >= 0 && i < state.hands[seat].length, 'その神器は持っていません');
      assert(ARTIFACTS[state.hands[seat][i]].kind === 'guard', '防具だけが出せます');
    }
    attack.guards[seat] = picked.slice();
    if (attack.targets.every((target) => target in attack.guards)) resolveAttack(state, rng);
    return;
  }

  assert(seat === state.turn, 'あなたの番ではありません');

  if (state.phase === 'pick') {
    // 手札がいっぱい。古い神器を1枚すてて ひろうか、ひろわないか。
    if (action.type === 'swap') {
      assert(Number.isInteger(action.discard) && action.discard >= 0 && action.discard < state.hands[seat].length, 'すてる神器をえらんでください');
      const dropped = state.hands[seat].splice(action.discard, 1)[0];
      state.hands[seat].push(state.found);
      note(state, { t: 'draw', seat, terrain: state.foundFrom, dropped });
    } else {
      assert(action.type === 'leave', 'すてる神器をえらぶか、ひろわないかを決めてください');
      note(state, { t: 'left', seat });
    }
    state.found = null;
    state.phase = 'use';
    return;
  }

  // 移動のかわりに、となりの人を攻撃する (そのあと、もう1回神器を使える)。
  const first = state.phase === 'move' && action.type === 'use';
  if (state.phase === 'move' && !first) {
    assert(action.type === 'move', 'まず移動してください');
    assert(movesFor(state, seat).includes(action.to), action.to === state.pos[seat] ? '動けるマスがあるときは、とどまれません' : 'そこへは動けません');
    const stay = action.to === state.pos[seat];
    state.pos[seat] = action.to;
    const terrain = state.cells[action.to];
    note(state, { t: 'move', seat, to: action.to, stay, terrain });
    hurt(state, seat, TERRAINS[terrain].hurt, terrain);
    if (!state.alive[seat]) return endTurn(state, rng);
    const id = drawFrom(terrain, rng);
    if (terrain === 'oracle') {
      // 予言の地は、入られると消えて元の地形にもどる。
      state.cells[action.to] = state.oracle.under;
      state.oracle = { cell: -1, under: null, returnsAt: state.turnNo + ORACLE_WAIT, last: action.to };
      note(state, { t: 'oracleGone', seat });
    }
    if (state.hands[seat].length >= HAND_LIMIT) {
      state.found = id;
      state.foundFrom = terrain;
      state.phase = 'pick';
      return;
    }
    state.hands[seat].push(id);
    note(state, { t: 'draw', seat, terrain });
    state.phase = 'use';
    return;
  }

  assert(state.phase === 'use' || first, 'いまは操作できません');
  if (action.type === 'skip') return endTurn(state, rng);
  assert(action.type === 'use', '不明な操作です');
  const hand = state.hands[seat];
  assert(Number.isInteger(action.card) && action.card >= 0 && action.card < hand.length, 'その神器は持っていません');
  const id = hand[action.card];
  const art = ARTIFACTS[id];
  assert(art.kind !== 'guard', '防具は、攻撃されたときに出します');
  const option = optionsFor(state, seat, id)[action.pick];
  assert(option, 'その使い方はできません');
  if (first) {
    assert(strikesNeighbor(state, seat, id, option), '移動のかわりに使えるのは、となりの人に当たる武器だけです');
    // 動かなくても、痛い地形の上にいればダメージを受ける (魔界でかならず決着がつくように)。
    const terrain = state.cells[state.pos[seat]];
    note(state, { t: 'strike', seat });
    hurt(state, seat, TERRAINS[terrain].hurt, terrain);
    if (!state.alive[seat]) return endTurn(state, rng);
  }
  hand.splice(action.card, 1);

  if (art.kind === 'heal') {
    const amount = Math.min(art.amount, MAX_HP - state.hp[seat]);
    state.hp[seat] += amount;
    note(state, { t: 'heal', seat, amount, why: id });
    return endTurn(state, rng);
  }
  if (art.kind === 'weapon') {
    const power = powerOf(state, seat, id);
    if (option.hits.length === 0) {
      note(state, { t: 'miss', seat, card: id, cells: option.cells });
      hitWalls(state, option.walls, power);
      return endTurn(state, rng);
    }
    state.attack = { from: seat, card: id, power, dir: option.dir ?? -1, cells: option.cells, targets: option.hits.slice(), walls: option.walls.slice(), first, guards: {} };
    state.phase = 'guard';
    return;
  }
  // 奇跡
  if (art.effect === 'chaos') {
    chaos(state, seat, rng);
    return endTurn(state, rng);
  }
  const { cell } = option;
  if (art.effect === 'swap') {
    [state.pos[seat], state.pos[option.target]] = [state.pos[option.target], state.pos[seat]];
    note(state, { t: 'miracle', seat, card: id, cell, target: option.target });
  } else if (art.effect === 'dash') {
    state.pos[seat] = cell;
    note(state, { t: 'miracle', seat, card: id, cell });
  } else {
    const before = state.cells[cell];
    state.cells[cell] = { erupt: 'lava', wall: 'wall', flatten: 'plain' }[art.effect];
    delete state.walls[cell];
    if (art.effect === 'wall') state.walls[cell] = WALL_HP;
    note(state, { t: 'miracle', seat, card: id, cell, before });
    if (art.effect === 'erupt' && option.hits.length) hurt(state, option.hits[0], art.power, id);
  }
  endTurn(state, rng);
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  return {
    n: state.n,
    cells: state.cells,
    pos: state.pos,
    hp: state.hp,
    alive: state.alive,
    handCount: state.hands.map((hand) => hand.length),
    // 手札は本人にしか見えない。
    myHand: mine ? state.hands[seat] : [],
    // ひろおうとしている神器も、本人にしか見えない。
    found: mine && seat === state.turn ? state.found : null,
    walls: state.walls,
    turn: state.turn,
    turnNo: state.turnNo,
    makai: state.makai,
    phase: state.phase,
    // 攻撃の中身は全員に見える。だれが何で受けるかは、全員が決めるまで見えない。
    attack: state.attack && {
      from: state.attack.from,
      card: state.attack.card,
      power: state.attack.power,
      cells: state.attack.cells,
      targets: state.attack.targets,
      answered: state.attack.targets.filter((target) => target in state.attack.guards),
    },
    // 予言の地が消えているあいだは、あと何ターンで現れるか。
    oracleIn: state.makai || state.oracle.cell >= 0 ? null : Math.max(1, state.oracle.returnsAt - state.turnNo),
    out: state.out,
    events: state.events,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  if (state.phase === 'guard') return state.attack.targets.filter((target) => !(target in state.attack.guards));
  return [state.turn];
}

// ---- CPU -------------------------------------------------------------------

const GUARD_GUESS = 2.5; // 相手が防具で止めてくる分の見込み

/** その使い方の値打ち (0 以下なら、使わないほうがよい)。 */
function useValue(state, seat, id, option) {
  const art = ARTIFACTS[id];
  const crowded = state.hands[seat].length >= HAND_LIMIT - 1;
  if (art.kind === 'heal') {
    const amount = Math.min(art.amount, MAX_HP - state.hp[seat]);
    return state.hp[seat] <= 24 ? amount : crowded ? 0.5 : -1;
  }
  if (art.kind === 'weapon') {
    if (option.hits.length === 0) return -1;
    const power = powerOf(state, seat, id);
    let value = art.push ? 0.5 : 0;
    for (const target of option.hits) {
      const sure = damageOf(state, target, power, 0);
      const likely = Math.max(0, sure - GUARD_GUESS);
      value += likely + 0.3 * sure + (sure >= state.hp[target] ? 5 : 0);
    }
    return value;
  }
  if (art.effect === 'erupt') {
    if (option.hits.length === 0 || option.hits[0] === seat) return crowded ? 0.2 : -1;
    return art.power + 1.5 + (state.hp[option.hits[0]] <= art.power ? 6 : 0);
  }
  if (art.effect === 'swap') {
    // 自分が痛い地形にいて、相手がいい地形にいるなら入れかわる。
    const here = TERRAINS[state.cells[state.pos[seat]]].hurt;
    const there = TERRAINS[state.cells[option.cell]].hurt;
    return here > there ? 3 : crowded ? 0.2 : -1;
  }
  if (art.effect === 'chaos') {
    // 負けているときほど、ひっくり返しにいく。
    const others = state.hp.filter((_, s) => s !== seat && state.alive[s]);
    const average = others.reduce((a, b) => a + b, 0) / others.length;
    return state.hp[seat] < average - 3 || state.hands[seat].length <= 4 ? 2 : crowded ? 0.3 : -1;
  }
  if (art.effect === 'flatten') return state.cells[option.cell] === 'lava' && option.cell === state.pos[seat] ? 3 : crowded ? 0.2 : -1;
  return crowded ? 0.2 : -1;
}

function bestUse(state, seat, strikeOnly = false) {
  let best = null;
  state.hands[seat].forEach((id, card) => {
    if (ARTIFACTS[id].kind === 'guard') return;
    optionsFor(state, seat, id).forEach((option, pick) => {
      if (strikeOnly && !strikesNeighbor(state, seat, id, option)) return;
      const value = useValue(state, seat, id, option);
      if (!best || value > best.value) best = { value, card, pick };
    });
  });
  return best;
}

function botMove(state, seat, rng) {
  const hp = state.hp[seat];
  const guards = state.hands[seat].filter((id) => ARTIFACTS[id].kind === 'guard').length;
  const from = state.pos[seat];
  let best = null;
  for (const to of movesFor(state, seat)) {
    state.pos[seat] = to;
    const terrain = state.cells[to];
    let value = { plain: 1, forest: 1.6, mountain: 1.6, spring: 1.5 + Math.max(0, START_HP - hp) * 0.25, ruin: 1.4, lava: hp > 14 ? 2.4 : -4, makai: 0, oracle: 6 }[terrain];
    if (guards === 0 && (terrain === 'mountain' || terrain === 'plain')) value += 0.8;
    // そこから撃てるなら、行く値打ちがある。
    const shot = bestUse(state, seat);
    if (shot && shot.value > 0) value += shot.value * 0.8;
    // ねらわれやすい場所 (ほかの人と、たて・よこ・ななめにならぶ) は、HP が少ないほど避ける。
    let exposed = 0;
    for (let other = 0; other < state.n; other++) {
      if (other === seat || !state.alive[other]) continue;
      const dx = Math.abs(xOf(state.pos[other]) - xOf(to));
      const dy = Math.abs(yOf(state.pos[other]) - yOf(to));
      if (dx === 0 || dy === 0 || dx === dy) exposed++;
    }
    value -= exposed * (hp <= 12 ? 1.2 : 0.4);
    value += rng() * 1.2;
    if (!best || value > best.value) best = { value, to };
  }
  state.pos[seat] = from;
  return { type: 'move', to: best.to };
}

/** 手もとに置いておきたい度合い。 */
function keepValue(id) {
  const art = ARTIFACTS[id];
  if (art.kind === 'weapon') return art.power + (art.pierce ? 1 : 0);
  if (art.kind === 'guard') return art.block + 3;
  if (art.kind === 'heal') return art.amount;
  return 3;
}

function botGuard(state, seat) {
  // 大きい防具から、ダメージがなくなるまで出す (出した分は引き直せるので、けちらない)。
  const { power } = state.attack;
  const guards = state.hands[seat]
    .map((id, i) => ({ i, block: ARTIFACTS[id].kind === 'guard' ? ARTIFACTS[id].block : 0 }))
    .filter((g) => g.block > 0)
    .sort((a, b) => b.block - a.block);
  const cards = [];
  let block = 0;
  for (const g of guards) {
    if (damageOf(state, seat, power, block) === 0) break;
    cards.push(g.i);
    block += g.block;
  }
  return { type: 'guard', cards };
}

export function bot(state, seat, rng) {
  if (state.over || !state.alive[seat]) return null;
  if (state.phase === 'guard') return state.attack.targets.includes(seat) && !(seat in state.attack.guards) ? botGuard(state, seat) : null;
  if (seat !== state.turn) return null;
  if (state.phase === 'pick') {
    // いちばんいらない神器より良ければ、入れかえる。
    const hand = state.hands[seat];
    let worst = 0;
    hand.forEach((id, i) => {
      if (keepValue(id) < keepValue(hand[worst])) worst = i;
    });
    return keepValue(state.found) > keepValue(hand[worst]) ? { type: 'swap', discard: worst } : { type: 'leave' };
  }
  if (state.phase === 'move') {
    // となりに強く当てられて、あとでもう1枚撃てるなら、動かずに2回使う。
    const strike = bestUse(state, seat, true);
    const weapons = state.hands[seat].filter((id) => ARTIFACTS[id].kind === 'weapon').length;
    if (strike && strike.value >= 4 && weapons >= 2 && TERRAINS[state.cells[state.pos[seat]]].hurt === 0) return { type: 'use', card: strike.card, pick: strike.pick };
    return botMove(state, seat, rng);
  }
  const use = bestUse(state, seat);
  return use && use.value > 0 ? { type: 'use', card: use.card, pick: use.pick } : { type: 'skip' };
}
