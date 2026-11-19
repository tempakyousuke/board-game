// 神器の箱庭 — 5×5 の地形の上で、拾った神器をぶつけ合う (2〜6人)
//
// ・自分の番は「移動 → 神器を1枚ひろう → 神器を1枚使う」。
// ・移動は、たて・よこに1マス (その場にとどまってもよい)。ひろえる神器は、立っているマスの地形で決まる。
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
export const MAX_HP = 30;
export const START_HAND = 5;
export const HAND_LIMIT = 10;
export const MAKAI_TURN = 100; // このターンをすぎたら、全部のマスが魔界になる
export const SPRING_HEAL = 2;
export const FOREST_COVER = 1;
export const MOUNTAIN_EDGE = 1;
const EVENTS_KEPT = 40;

// ---- 神器 -------------------------------------------------------------------
//
// weapon: shape (line: たて・よこの1方向 / diag: ななめの1方向 / around: まわり8マス /
//         cross: たて・よこ4方向ぜんぶ / star: 8方向ぜんぶ / bolt: どこにいても1人)
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
  // 溶岩
  flameSword: { name: '炎のつるぎ', emoji: '🔥', kind: 'weapon', shape: 'line', range: 2, pierce: true, power: 9 },
  inferno: { name: '業火', emoji: '💥', kind: 'weapon', shape: 'around', range: 1, pierce: true, power: 7 },
  lavaAxe: { name: '溶岩のおの', emoji: '🪓', kind: 'weapon', shape: 'line', range: 1, power: 12 },
  // 魔界
  demonSword: { name: '魔剣', emoji: '⚔️', kind: 'weapon', shape: 'cross', range: 4, pierce: true, power: 10 },
  doomLight: { name: '滅びの光', emoji: '🌟', kind: 'weapon', shape: 'star', range: 4, pierce: true, power: 9 },
  demonShield: { name: '魔王のたて', emoji: '👿', kind: 'guard', block: 10 },
};

// ---- 地形 -------------------------------------------------------------------
// hurt: 移動のあと、そのマスにいると受けるダメージ。deck: ひろえる神器と出やすさ。

export const TERRAINS = {
  plain: { name: '平地', emoji: '🌾', hurt: 0, deck: { sword: 3, spear: 3, sickle: 2, woodShield: 3 } },
  forest: { name: '森', emoji: '🌲', hurt: 0, deck: { bow: 3, boomerang: 3, dart: 2, leafCloak: 3 } },
  mountain: { name: '山', emoji: '⛰️', hurt: 0, deck: { hammer: 2, cannon: 2, ironShield: 3, armor: 3 } },
  spring: { name: '泉', emoji: '⛲', hurt: 0, deck: { water: 4, elixir: 2, mist: 3, dash: 2 } },
  ruin: { name: '遺跡', emoji: '🏛️', hurt: 0, deck: { erupt: 3, wall: 2, flatten: 1, gust: 2, swap: 2, thunder: 3 } },
  lava: { name: '溶岩', emoji: '🌋', hurt: 2, deck: { flameSword: 3, inferno: 3, lavaAxe: 2 } },
  makai: { name: '魔界', emoji: '😈', hurt: 4, deck: { demonSword: 3, doomLight: 2, demonShield: 2 } },
  wall: { name: '岩かべ', emoji: '🧱', hurt: 0, deck: {} },
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
  let x = xOf(from);
  let y = yOf(from);
  for (let step = 0; step < range; step++) {
    x += dx;
    y += dy;
    if (!inside(x, y) || field.cells[cellOf(x, y)] === 'wall') break;
    const cell = cellOf(x, y);
    cells.push(cell);
    const seat = whoAt(field, cell);
    if (seat >= 0) {
      hits.push(seat);
      if (!pierce) break;
    }
  }
  return { cells, hits };
}

function merge(rays) {
  return { cells: rays.flatMap((r) => r.cells), hits: rays.flatMap((r) => r.hits) };
}

/** 移動できるマス (その場をふくむ)。 */
export function movesFor(field, seat) {
  const from = field.pos[seat];
  const list = [from];
  for (const [dx, dy] of DIR4) {
    const x = xOf(from) + dx;
    const y = yOf(from) + dy;
    if (!inside(x, y)) continue;
    const cell = cellOf(x, y);
    if (field.cells[cell] !== 'wall' && whoAt(field, cell) < 0) list.push(cell);
  }
  return list;
}

/**
 * その神器の使い方の一覧。それぞれ { label, cells: 光らせるマス, hits: 当たる人, ... }。
 * 使えない神器 (防具など) は、空の一覧になる。
 */
export function optionsFor(field, seat, id) {
  const art = ARTIFACTS[id];
  const from = field.pos[seat];
  if (art.kind === 'heal') return [{ label: '自分に使う', cells: [from], hits: [] }];
  if (art.kind === 'weapon') {
    if (art.shape === 'line' || art.shape === 'diag') {
      const dirs = art.shape === 'line' ? DIR4 : DIAG;
      return dirs
        .map((dir, d) => ({ dir: d, label: DIR_NAMES[art.shape][d], ...ray(field, from, dir, art.range, art.pierce) }))
        .filter((option) => option.cells.length > 0);
    }
    if (art.shape === 'bolt') {
      return field.pos.map((cell, s) => ({ target: s, label: '', cells: [cell], hits: [s] })).filter((o) => o.target !== seat && field.alive[o.target]);
    }
    const dirs = art.shape === 'cross' ? DIR4 : [...DIR4, ...DIAG];
    const all = merge(dirs.map((dir) => ray(field, from, dir, art.range, true)));
    return all.cells.length ? [{ label: art.shape === 'cross' ? '十字' : art.shape === 'star' ? '8方向' : 'まわり', ...all }] : [];
  }
  if (art.kind !== 'miracle') return [];
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
    // 地形を変える奇跡。魔界は変えられない。
    if (terrain === 'makai') continue;
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
  const state = {
    n,
    cells,
    pos,
    hp: fill(n, START_HP),
    alive: fill(n, true),
    hands: Array.from({ length: n }, () => Array.from({ length: START_HAND }, () => drawFrom(STARTER_TERRAINS[randInt(rng, STARTER_TERRAINS.length)], rng))),
    turn: randInt(rng, n),
    turnNo: 1,
    phase: 'move', // move: 移動 / use: 神器を使う / guard: 攻撃された人が受ける
    attack: null,
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

function endTurn(state) {
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
    note(state, { t: 'makai' });
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
    const id = drawFrom(state.cells[state.pos[seat]], rng);
    if (!id) break;
    state.hands[seat].push(id);
    got++;
  }
  return got;
}

function resolveAttack(state, rng) {
  const { from, card, power, cells, targets, guards } = state.attack;
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
  endTurn(state);
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

  if (state.phase === 'move') {
    assert(action.type === 'move', 'まず移動してください');
    assert(movesFor(state, seat).includes(action.to), 'そこへは動けません');
    const stay = action.to === state.pos[seat];
    state.pos[seat] = action.to;
    const terrain = state.cells[action.to];
    note(state, { t: 'move', seat, to: action.to, stay, terrain });
    hurt(state, seat, TERRAINS[terrain].hurt, terrain);
    if (!state.alive[seat]) return endTurn(state);
    if (gain(state, seat, rng)) note(state, { t: 'draw', seat, terrain });
    state.phase = 'use';
    return;
  }

  assert(state.phase === 'use', 'いまは操作できません');
  if (action.type === 'skip') return endTurn(state);
  assert(action.type === 'use', '不明な操作です');
  const hand = state.hands[seat];
  assert(Number.isInteger(action.card) && action.card >= 0 && action.card < hand.length, 'その神器は持っていません');
  const id = hand[action.card];
  const art = ARTIFACTS[id];
  assert(art.kind !== 'guard', '防具は、攻撃されたときに出します');
  const option = optionsFor(state, seat, id)[action.pick];
  assert(option, 'その使い方はできません');
  hand.splice(action.card, 1);

  if (art.kind === 'heal') {
    const amount = Math.min(art.amount, MAX_HP - state.hp[seat]);
    state.hp[seat] += amount;
    note(state, { t: 'heal', seat, amount, why: id });
    return endTurn(state);
  }
  if (art.kind === 'weapon') {
    if (option.hits.length === 0) {
      note(state, { t: 'miss', seat, card: id, cells: option.cells });
      return endTurn(state);
    }
    state.attack = { from: seat, card: id, power: powerOf(state, seat, id), dir: option.dir ?? -1, cells: option.cells, targets: option.hits.slice(), guards: {} };
    state.phase = 'guard';
    return;
  }
  // 奇跡
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
    note(state, { t: 'miracle', seat, card: id, cell, before });
    if (art.effect === 'erupt' && option.hits.length) hurt(state, option.hits[0], art.power, id);
  }
  endTurn(state);
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
    return amount >= Math.min(art.amount, 5) || state.hp[seat] <= 10 ? amount : crowded && amount > 0 ? 0.5 : -1;
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
  if (art.effect === 'flatten') return state.cells[option.cell] === 'lava' && option.cell === state.pos[seat] ? 3 : crowded ? 0.2 : -1;
  return crowded ? 0.2 : -1;
}

function bestUse(state, seat) {
  let best = null;
  state.hands[seat].forEach((id, card) => {
    if (ARTIFACTS[id].kind === 'guard') return;
    optionsFor(state, seat, id).forEach((option, pick) => {
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
    let value = { plain: 1, forest: 1.6, mountain: 1.6, spring: 1 + (MAX_HP - hp) * 0.25, ruin: 1.4, lava: hp > 14 ? 2.4 : -4, makai: 0 }[terrain];
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
  if (state.phase === 'move') return botMove(state, seat, rng);
  const use = bestUse(state, seat);
  return use && use.value > 0 ? { type: 'use', card: use.card, pick: use.pick } : { type: 'skip' };
}
