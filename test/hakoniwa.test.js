// 神器の箱庭のルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/hakoniwa.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const { cellOf, START_HP, MAX_HP, START_HAND, HAND_LIMIT, MAKAI_TURN, WALL_HP, ORACLE_WAIT, TERRAINS } = game;

/** 全部が平地の盤で、席0 の番から始める。places: 席ごとの [x, y]。 */
function arena(places, hands = []) {
  const rng = mulberry32(3);
  const state = game.setup({ n: places.length, rng });
  state.cells = state.cells.map(() => 'plain');
  state.oracle = { cell: -1, under: null, returnsAt: 1e9 }; // 予言の地は、試すときだけ置く
  state.pos = places.map(([x, y]) => cellOf(x, y));
  state.turn = 0;
  state.hands = places.map((_, s) => (hands[s] ?? []).slice());
  return { state, rng };
}
const move = (state, rng, seat, x, y) => game.act(state, seat, { type: 'move', to: cellOf(x, y) }, rng);
/** 移動をすませたことにして、seat が神器を使う場面にする。 */
function ready(state, seat) {
  state.turn = seat;
  state.phase = 'use';
}
/** 手札の id の神器を、向きの名前 (か、条件に合う使い方) で使う。 */
function use(state, rng, seat, id, pickBy) {
  const card = state.hands[seat].indexOf(id);
  const options = game.optionsFor(state, seat, id);
  const pick = typeof pickBy === 'function' ? options.findIndex(pickBy) : options.findIndex((o) => o.label === pickBy);
  // 武器は、試すときはかならず当たることにする (命中率は、別に確かめる)。
  game.act(state, seat, { type: 'use', card, pick }, game.ARTIFACTS[id].kind === 'weapon' ? () => 0 : rng);
}
const noGuard = (state, rng, seat) => game.act(state, seat, { type: 'guard', cards: [] }, rng);

test('hakoniwa: HP30・手札5枚で始まり、始まるマスは平地。手札は本人にしか見えない', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const state = game.setup({ n, rng: mulberry32(n) });
    assert.equal(state.cells.length, 25);
    assert.deepEqual(state.hp, new Array(n).fill(START_HP));
    assert.ok(state.hands.every((hand) => hand.length === START_HAND));
    assert.equal(new Set(state.pos).size, n);
    assert.ok(state.pos.every((cell) => state.cells[cell] === 'plain'));
    assert.equal(game.view(state, 1).myHand.length, START_HAND);
    assert.deepEqual(game.view(state, -1).myHand, []);
    assert.deepEqual(game.view(state, -1).handCount, new Array(n).fill(START_HAND));
  }
});

test('hakoniwa: 移動はたて・よこ1マス。その場にはとどまれない。動いた先の地形から1枚ひろう', () => {
  const { state, rng } = arena([[2, 2], [2, 1], [4, 4]]);
  state.cells[cellOf(3, 2)] = 'wall';
  state.cells[cellOf(1, 2)] = 'forest';
  assert.deepEqual(game.movesFor(state, 0).sort((a, b) => a - b), [cellOf(1, 2), cellOf(2, 3)], '人のいるマス・岩かべ・いまのマスには入れない');
  assert.throws(() => move(state, rng, 0, 2, 1), GameError);
  assert.throws(() => move(state, rng, 0, 2, 2), GameError, 'とどまれない');
  assert.throws(() => game.act(state, 0, { type: 'skip' }, rng), GameError, 'まず移動');
  assert.throws(() => move(state, rng, 1, 1, 1), GameError, '番ではない');
  move(state, rng, 0, 1, 2);
  assert.equal(state.phase, 'use');
  assert.equal(state.hands[0].length, 1);
  assert.ok(state.hands[0][0] in TERRAINS.forest.deck);
  game.act(state, 0, { type: 'skip' }, rng);
  assert.equal(state.turn, 1);
  assert.equal(state.turnNo, 2);
});

test('hakoniwa: どこへも動けないときだけ、とどまれる', () => {
  const { state, rng } = arena([[0, 0], [1, 0], [0, 1]]);
  assert.deepEqual(game.movesFor(state, 0), [cellOf(0, 0)]);
  move(state, rng, 0, 0, 0);
  assert.equal(state.phase, 'use');
  assert.equal(state.hands[0].length, 1, 'とどまっても、ひろえる');
  assert.equal(state.events.find((e) => e.t === 'move').stay, true);
});

test('hakoniwa: 溶岩は強い神器のかわりにダメージ。泉は番の初めに回復し、HP は99まで', () => {
  const { state, rng } = arena([[0, 0], [4, 4]], [['elixir']]);
  state.cells[cellOf(1, 0)] = 'lava';
  state.cells[cellOf(4, 4)] = 'spring';
  move(state, rng, 0, 1, 0);
  assert.equal(state.hp[0], START_HP - TERRAINS.lava.hurt);
  assert.ok(state.hands[0][1] in TERRAINS.lava.deck);
  use(state, rng, 0, 'elixir', () => true);
  assert.equal(state.hp[0], START_HP - TERRAINS.lava.hurt + 10, '30をこえて回復できる');
  assert.equal(state.hp[1], START_HP + game.SPRING_HEAL);
  state.hp[0] = MAX_HP - 3;
  state.hands[0] = ['elixir'];
  ready(state, 0);
  use(state, rng, 0, 'elixir', () => true);
  assert.equal(state.hp[0], MAX_HP);
});

test('hakoniwa: 手札がいっぱいのときは、古い神器を1枚すててひろうか、ひろわないかを選ぶ', () => {
  const full = () => ['sword', ...new Array(HAND_LIMIT - 1).fill('woodShield')];
  const a = arena([[0, 0], [4, 4]], [full()]);
  a.state.cells[cellOf(1, 0)] = 'spring';
  move(a.state, a.rng, 0, 1, 0);
  assert.equal(a.state.phase, 'pick');
  assert.deepEqual(game.pending(a.state), [0]);
  const found = a.state.found;
  assert.ok(found in TERRAINS.spring.deck);
  assert.equal(game.view(a.state, 0).found, found);
  assert.equal(game.view(a.state, 1).found, null, 'ほかの人には見えない');
  assert.throws(() => game.act(a.state, 0, { type: 'skip' }, a.rng), GameError);
  assert.throws(() => game.act(a.state, 0, { type: 'swap', discard: HAND_LIMIT }, a.rng), GameError);
  game.act(a.state, 0, { type: 'swap', discard: 0 }, a.rng);
  assert.equal(a.state.phase, 'use');
  assert.equal(a.state.hands[0].length, HAND_LIMIT);
  assert.ok(!a.state.hands[0].includes('sword'));
  assert.equal(a.state.hands[0].at(-1), found);

  const b = arena([[0, 0], [4, 4]], [full()]);
  move(b.state, b.rng, 0, 1, 0);
  game.act(b.state, 0, { type: 'leave' }, b.rng);
  assert.equal(b.state.phase, 'use');
  assert.deepEqual(b.state.hands[0], full());
  assert.equal(game.bot(a.state, 0, a.rng).type !== undefined, true);
});

test('hakoniwa: となりに人がいれば、移動のかわりに武器で攻撃でき、そのあともう1回使える', () => {
  const { state, rng } = arena([[1, 1], [1, 2], [4, 1], [2, 2]], [['dart', 'bow', 'sword', 'water']]);
  assert.deepEqual(game.neighborsOf(state, 0), [1], 'たて・よこだけ。ななめは、となりではない');
  // となりに当たらない使い方や、武器でない神器は、移動のかわりには使えない。
  assert.throws(() => use(state, rng, 0, 'bow', '右'), GameError);
  assert.throws(() => use(state, rng, 0, 'water', () => true), GameError);
  assert.throws(() => use(state, rng, 0, 'dart', '右下'), GameError, 'ななめの人には使えない');
  use(state, rng, 0, 'sword', '下');
  assert.equal(state.phase, 'guard');
  noGuard(state, rng, 1);
  assert.equal(state.hp[1], START_HP - 6);
  assert.equal(state.turn, 0, 'まだ自分の番');
  assert.equal(state.phase, 'use');
  assert.equal(state.pos[0], cellOf(1, 1), '動いていない');
  assert.deepEqual(state.hands[0], ['dart', 'bow', 'water'], 'ひろっていない');
  use(state, rng, 0, 'bow', '右');
  noGuard(state, rng, 2);
  assert.equal(state.hp[2], START_HP - 5);
  assert.equal(state.turn, 1, '2回使ったら終わり');

  // 痛い地形の上なら、動かなくてもダメージを受ける。
  const hot = arena([[1, 1], [2, 1]], [['sword']]);
  hot.state.cells[cellOf(1, 1)] = 'lava';
  use(hot.state, hot.rng, 0, 'sword', '右');
  assert.equal(hot.state.hp[0], START_HP - TERRAINS.lava.hurt);
});

test('hakoniwa: 貫通する武器は線の上の全員に当たり、貫通しない武器は最初の1人で止まる', () => {
  const far = arena([[0, 2], [1, 2], [3, 2], [4, 4]]).state;
  const line = (id) => game.optionsFor(far, 0, id).find((o) => o.label === '右');
  assert.deepEqual(line('cannon').hits, [1, 2]);
  assert.deepEqual(line('bow').hits, [1]);
  assert.deepEqual(line('spear').hits, [1], 'やりは2マスまで');
  assert.equal(game.optionsFor(far, 0, 'sword').length, 3, '盤の外へは向けられない');
  far.cells[cellOf(2, 2)] = 'wall';
  assert.deepEqual(line('cannon').hits, [1], '岩かべが受け止める');
  assert.deepEqual(line('cannon').walls, [cellOf(2, 2)]);
  const diag = arena([[1, 1], [2, 2], [3, 3], [0, 1], [4, 0]]).state;
  assert.deepEqual(game.optionsFor(diag, 0, 'boomerang').find((o) => o.label === '右下').hits, [1, 2]);
  assert.deepEqual(game.optionsFor(diag, 0, 'sickle')[0].hits.sort(), [1, 3]);
  assert.deepEqual(game.optionsFor(diag, 0, 'thunder').map((o) => o.target), [1, 2, 3, 4]);
  assert.deepEqual(game.optionsFor(diag, 0, 'woodShield'), [], '防具は自分の番には使えない');
});

test('hakoniwa: 岩かべには耐久力があり、攻撃を当てるとこわれて平地になる', () => {
  const { state, rng } = arena([[0, 0], [4, 4]], [['wall', 'sword', 'hammer', 'cannon']]);
  ready(state, 0);
  use(state, rng, 0, 'wall', (o) => o.cell === cellOf(1, 0));
  assert.equal(state.cells[cellOf(1, 0)], 'wall');
  assert.equal(game.view(state, 1).walls[cellOf(1, 0)], WALL_HP);
  assert.ok(!game.movesFor(state, 0).includes(cellOf(1, 0)));
  ready(state, 0);
  use(state, rng, 0, 'sword', '右');
  assert.equal(state.walls[cellOf(1, 0)], WALL_HP - 6);
  assert.equal(state.cells[cellOf(1, 0)], 'wall');
  assert.equal(state.turn, 1, '人に当たらなければ、受ける場面はない');
  ready(state, 0);
  use(state, rng, 0, 'hammer', '右');
  assert.equal(state.cells[cellOf(1, 0)], 'plain');
  assert.equal(state.walls[cellOf(1, 0)], undefined);
  assert.equal(state.events.find((e) => e.t === 'wall' && e.broken).cell, cellOf(1, 0));
  // 人にも岩かべにも当たる攻撃 (まわり8マス)。
  const both = arena([[1, 1], [2, 1], [4, 4]], [['sickle']]);
  both.state.cells[cellOf(0, 1)] = 'wall';
  ready(both.state, 0);
  use(both.state, both.rng, 0, 'sickle', () => true);
  noGuard(both.state, both.rng, 1);
  assert.equal(both.state.hp[1], START_HP - 4);
  assert.equal(both.state.walls[cellOf(0, 1)], WALL_HP - 4);
});

test('hakoniwa: 攻撃された人は防具を何枚でも出して受け、出した枚数だけ足もとから引き直す', () => {
  const { state, rng } = arena([[0, 2], [1, 2], [3, 2]], [['cannon'], ['woodShield', 'sword', 'leafCloak'], ['armor']]);
  state.cells[cellOf(3, 2)] = 'forest';
  ready(state, 0);
  use(state, rng, 0, 'cannon', '右');
  assert.equal(state.phase, 'guard');
  assert.deepEqual(game.pending(state).sort(), [1, 2]);
  assert.equal(game.view(state, 2).attack.power, 6);
  assert.throws(() => noGuard(state, rng, 0), GameError, '撃った人は受けない');
  assert.throws(() => game.act(state, 1, { type: 'guard', cards: [1] }, rng), GameError, '武器では受けられない');
  assert.throws(() => game.act(state, 1, { type: 'guard', cards: [0, 0] }, rng), GameError);
  game.act(state, 1, { type: 'guard', cards: [0, 2] }, rng);
  assert.deepEqual(game.view(state, 0).attack.answered, [1], 'だれが決めたかだけ見える');
  noGuard(state, rng, 2);
  // 席1: 6 − (3+2) = 1。席2: 森で −1、防具なしで 5。
  assert.deepEqual(state.hp, [START_HP, START_HP - 1, START_HP - 5]);
  assert.equal(state.hands[1].length, 3, '2枚出して2枚引き直す');
  assert.ok(state.hands[1].includes('sword'));
  assert.deepEqual(state.hands[2], ['armor'], '出さなければ引かない');
  assert.deepEqual(state.events.find((e) => e.t === 'attack').results.map((r) => [r.seat, r.guard.length, r.damage]), [[1, 2, 1], [2, 0, 5]]);
  assert.equal(state.turn, 1);
});

test('hakoniwa: 山の上からは威力が上がる。だれもいない向きは空ぶりで、神器だけなくなる', () => {
  const { state, rng } = arena([[0, 0], [1, 0], [4, 4]], [['hammer', 'sword']]);
  state.cells[cellOf(0, 0)] = 'mountain';
  ready(state, 0);
  use(state, rng, 0, 'sword', '下');
  assert.equal(state.events.at(-1).t, 'miss');
  assert.deepEqual(state.hands[0], ['hammer']);
  assert.equal(state.turn, 1);
  assert.equal(game.powerOf(state, 0, 'hammer'), 10);
});

test('hakoniwa: 奇跡で地形が変わる。突風は押し、入れかえは場所を取りかえる', () => {
  const { state, rng } = arena([[0, 0], [2, 0], [4, 4]], [['erupt', 'wall', 'flatten', 'gust', 'swap']]);
  ready(state, 0);
  use(state, rng, 0, 'erupt', (o) => o.cell === cellOf(2, 0));
  assert.equal(state.cells[cellOf(2, 0)], 'lava');
  assert.equal(state.hp[1], START_HP - 3);
  ready(state, 0);
  assert.ok(!game.optionsFor(state, 0, 'wall').some((o) => o.cell === cellOf(2, 0)), '人のいるマスは岩かべにできない');
  use(state, rng, 0, 'wall', (o) => o.cell === cellOf(1, 1));
  ready(state, 0);
  use(state, rng, 0, 'flatten', (o) => o.cell === cellOf(1, 1));
  assert.equal(state.cells[cellOf(1, 1)], 'plain');
  assert.deepEqual(state.walls, {});
  ready(state, 0);
  use(state, rng, 0, 'gust', '右');
  noGuard(state, rng, 1);
  assert.equal(state.pos[1], cellOf(4, 0), '2マス押される');
  assert.equal(state.hp[1], START_HP - 3 - 3);
  ready(state, 0);
  use(state, rng, 0, 'swap', (o) => o.target === 2);
  assert.deepEqual([state.pos[0], state.pos[2]], [cellOf(4, 4), cellOf(0, 0)]);
});

test('hakoniwa: HP がなくなると脱落して番がとばされ、最後の1人が勝つ', () => {
  const { state, rng } = arena([[0, 0], [1, 0], [0, 1]], [['lavaAxe', 'lavaAxe']]);
  state.hp = [30, 5, 5];
  ready(state, 0);
  use(state, rng, 0, 'lavaAxe', '右');
  noGuard(state, rng, 1);
  assert.equal(state.alive[1], false);
  assert.equal(state.turn, 2, '脱落した人の番はとばす');
  assert.equal(game.bot(state, 1, rng), null);
  assert.throws(() => move(state, rng, 1, 2, 0), GameError);
  ready(state, 0);
  use(state, rng, 0, 'lavaAxe', '下');
  noGuard(state, rng, 2);
  assert.equal(state.over, true);
  assert.deepEqual(state.result.winners, [0]);
  assert.deepEqual(state.result.places, [1, 3, 2], '長く残った人が上');
});

test('hakoniwa: 100ターンをすぎると全部のマスが魔界になり、地形は変えられず、かならず決着がつく', () => {
  const { state, rng } = arena([[0, 0], [4, 4]], [['flatten', 'erupt', 'wall']]);
  state.cells[cellOf(2, 2)] = 'wall';
  state.walls[cellOf(2, 2)] = 4;
  state.turnNo = MAKAI_TURN;
  move(state, rng, 0, 1, 0);
  assert.equal(state.makai, false);
  game.act(state, 0, { type: 'skip' }, rng);
  assert.equal(state.makai, true);
  assert.ok(state.cells.every((terrain) => terrain === 'makai'));
  assert.deepEqual(state.walls, {});
  for (const id of ['flatten', 'erupt', 'wall']) assert.deepEqual(game.optionsFor(state, 0, id), []);
  move(state, rng, 1, 4, 3);
  assert.equal(state.hp[1], START_HP - TERRAINS.makai.hurt);
  assert.ok(state.hands[1].at(-1) in TERRAINS.makai.deck);

  for (const n of [2, 4, 6]) {
    for (let g = 0; g < 20; g++) {
      const r = mulberry32(g * 10 + n);
      const s = game.setup({ n, rng: r });
      let guard = 0;
      while (!s.over) {
        assert.ok(++guard < 5000);
        const seat = game.pending(s)[0];
        game.act(s, seat, game.bot(s, seat, r), r);
      }
      assert.equal(s.result.winners.length, 1);
      assert.ok(s.turnNo < MAKAI_TURN + 80);
    }
  }
});

test('hakoniwa: 予言の地は1マスだけ。入ると特別な神器をひろえて消え、5ターン後に別のマスに現れる', () => {
  for (const n of [2, 5, 6]) {
    const fresh = game.setup({ n, rng: mulberry32(70 + n) });
    assert.equal(fresh.cells.filter((terrain) => terrain === 'oracle').length, 1);
    assert.ok(!fresh.pos.includes(fresh.oracle.cell), '始まるマスには置かない');
    assert.equal(game.view(fresh, 0).oracleIn, null);
  }
  const { state, rng } = arena([[0, 0], [4, 4]], [['flatten', 'erupt'], []]);
  state.cells[cellOf(1, 0)] = 'oracle';
  state.oracle = { cell: cellOf(1, 0), under: 'forest', returnsAt: 0 };
  assert.ok(!game.optionsFor(state, 0, 'flatten').some((o) => o.cell === cellOf(1, 0)), '奇跡では変えられない');
  assert.ok(!game.optionsFor(state, 0, 'erupt').some((o) => o.cell === cellOf(1, 0)));
  move(state, rng, 0, 1, 0);
  assert.ok(state.hands[0].at(-1) in TERRAINS.oracle.deck);
  assert.equal(state.cells[cellOf(1, 0)], 'forest', '元の地形にもどる');
  assert.equal(state.oracle.cell, -1);
  assert.equal(game.view(state, 1).oracleIn, ORACLE_WAIT);
  game.act(state, 0, { type: 'skip' }, rng);
  // 5ターンのあいだは、どこにもない。
  const goneAt = state.turnNo - 1;
  let guard = 0;
  while (state.oracle.cell < 0) {
    assert.ok(!state.cells.includes('oracle'));
    assert.ok(++guard < 20);
    const seat = state.turn;
    game.act(state, seat, { type: 'move', to: game.movesFor(state, seat)[0] }, rng);
    game.act(state, seat, { type: 'skip' }, rng);
  }
  assert.equal(state.turnNo, goneAt + ORACLE_WAIT);
  assert.equal(state.cells[state.oracle.cell], 'oracle');
  assert.notEqual(state.oracle.cell, cellOf(1, 0), '同じマスには現れない');
  assert.ok(!state.pos.includes(state.oracle.cell), '人のいるマスには現れない');
  assert.equal(game.view(state, 0).oracleIn, null);
});

test('hakoniwa: 天のさばきは、どこにいても ほかの全員に当たる', () => {
  const { state, rng } = arena([[0, 0], [4, 4], [2, 3]], [['judgment']]);
  ready(state, 0);
  use(state, rng, 0, 'judgment', () => true);
  assert.deepEqual(game.pending(state).sort(), [1, 2]);
  noGuard(state, rng, 1);
  noGuard(state, rng, 2);
  assert.deepEqual(state.hp, [START_HP, START_HP - 6, START_HP - 6]);
});

test('hakoniwa: ふしぎな箱は予言の地でひろえて、7つのうちどれか1つをランダムに起こす', () => {
  assert.ok('chaos' in TERRAINS.oracle.deck && !('chaos' in TERRAINS.ruin.deck));
  const seenEffects = new Set();
  for (let seed = 1; seed <= 150; seed++) {
    const { state } = arena([[0, 0], [4, 4], [2, 2]], [['chaos', 'sword'], ['bow', 'bow', 'bow'], ['armor']]);
    const rng = mulberry32(seed);
    state.hp = [10, 30, 21];
    state.cells[cellOf(3, 3)] = 'wall';
    state.cells[cellOf(1, 3)] = 'forest';
    state.walls[cellOf(3, 3)] = 20;
    ready(state, 0);
    use(state, rng, 0, 'chaos', () => true);
    const event = state.events.find((e) => e.t === 'chaos');
    const { effect } = event;
    seenEffects.add(effect);
    if (effect === 'shuffle') {
      assert.deepEqual(state.hands.map((hand) => hand.length), [1, 3, 1], '枚数はそのまま');
      assert.deepEqual(state.hands.flat().sort(), ['armor', 'bow', 'bow', 'bow', 'sword']);
    } else if (effect === 'remap') {
      assert.equal(state.cells.filter((terrain) => terrain === 'lava').length, 2);
      assert.deepEqual(state.walls, {});
      assert.deepEqual(state.pos, [cellOf(0, 0), cellOf(4, 4), cellOf(2, 2)], '人は動かない');
    } else if (effect === 'refill') {
      assert.equal(state.hands[0].length, HAND_LIMIT);
      assert.equal(state.hands[1].length, 3, 'ほかの人は変わらない');
    } else if (effect === 'equal') {
      assert.deepEqual(state.hp, [20, 20, 20]);
    } else if (effect === 'warp') {
      assert.deepEqual(state.pos.slice().sort((a, b) => a - b), [cellOf(0, 0), cellOf(2, 2), cellOf(4, 4)], '同じ3マスの中で入れかわる');
      assert.notDeepEqual(state.pos, [cellOf(0, 0), cellOf(4, 4), cellOf(2, 2)], 'だれかは動く');
    } else if (effect === 'meteor') {
      assert.equal(new Set(event.cells).size, game.METEORS);
      const before = [10, 30, 21];
      [cellOf(0, 0), cellOf(4, 4), cellOf(2, 2)].forEach((cell, s) => {
        const hit = event.cells.includes(cell);
        assert.equal(event.hits.includes(s), hit);
        assert.equal(state.hp[s], before[s] - (hit ? game.METEOR_POWER : 0), '当たった人だけ、防具なしで受ける');
      });
      assert.equal(state.walls[cellOf(3, 3)], event.cells.includes(cellOf(3, 3)) ? 20 - game.METEOR_POWER : 20);
    } else {
      assert.equal(effect, 'curse');
      assert.ok(state.cells.every((terrain) => terrain === 'makai'));
      assert.equal(state.makai, false, '本物の魔界ではない');
      assert.equal(game.view(state, 0).curseLeft, 3);
      // 3人が1回ずつ番をすると、元にもどる。
      const hpBefore = state.hp.slice();
      for (let lap = 0; lap < 3; lap++) {
        const seat = state.turn;
        assert.ok(state.cells.every((terrain) => terrain === 'makai'));
        game.act(state, seat, { type: 'move', to: game.movesFor(state, seat)[0] }, rng);
        if (state.phase === 'pick') game.act(state, seat, { type: 'leave' }, rng);
        game.act(state, seat, { type: 'skip' }, rng);
      }
      assert.deepEqual(state.hp, hpBefore.map((hp) => hp - TERRAINS.makai.hurt), '全員が1回ずつ魔界のダメージを受ける');
      assert.equal(state.cells[cellOf(3, 3)], 'wall');
      assert.equal(state.cells[cellOf(1, 3)], 'forest');
      assert.equal(state.walls[cellOf(3, 3)], 20);
      assert.equal(state.curse, null);
      assert.equal(game.view(state, 0).curseLeft, 0);
    }
  }
  assert.deepEqual([...seenEffects].sort(), Object.keys(game.CHAOS).sort());
  assert.equal(Object.keys(game.CHAOS).length, 7);
});

test('hakoniwa: 魔界 (本物でも一時的でも) のあいだは、ふしぎな箱で地形は変わらない', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { state } = arena([[0, 0], [4, 4]], [['chaos']]);
    if (seed % 2) state.makai = true;
    else state.curse = { until: 99, cells: state.cells, walls: {}, oracle: state.oracle };
    state.cells = state.cells.map(() => 'makai');
    ready(state, 0);
    use(state, mulberry32(seed), 0, 'chaos', () => true);
    const { effect } = state.events.find((e) => e.t === 'chaos');
    assert.ok(effect !== 'remap' && effect !== 'curse');
    assert.ok(state.cells.every((terrain) => terrain === 'makai'));
  }
});

test('hakoniwa: 遠い相手には外れることがある。となりは必ず当たり、威力の低い武器ほど遠くても当たりやすい', () => {
  const field = arena([[0, 0], [1, 0], [4, 0], [1, 1], [4, 4]]).state;
  const acc = (id, target) => Math.round(game.accuracyOf(field, 0, id, target) * 100);
  assert.equal(acc('bow', 1), 100);
  assert.equal(acc('dragon', 3), 100, 'ななめのとなりも必ず当たる');
  assert.deepEqual([acc('bow', 2), acc('cannon', 2), acc('dragon', 2)], [70, 55, 40], '4マス先');
  assert.equal(acc('thunder', 4), 70);
  assert.equal(acc('judgment', 4), 100);

  // 外れた人は受けなくてよい。全員に外れたら、そのまま番が進む。
  const shoot = (roll) => {
    const { state, rng } = arena([[0, 2], [1, 2], [4, 2]], [['cannon']]);
    ready(state, 0);
    game.act(state, 0, { type: 'use', card: 0, pick: game.optionsFor(state, 0, 'cannon').findIndex((o) => o.label === '右') }, () => roll);
    return { state, rng };
  };
  const half = shoot(0.6); // となりには当たり、4マス先 (55%) には外れる
  assert.deepEqual(game.pending(half.state), [1]);
  assert.deepEqual(game.view(half.state, 2).attack.missed, [2]);
  noGuard(half.state, half.rng, 1);
  assert.deepEqual(half.state.hp, [START_HP, START_HP - 6, START_HP]);
  assert.deepEqual(half.state.events.find((e) => e.t === 'attack').missed, [2]);

  const far = arena([[0, 2], [4, 2]], [['bow']]);
  ready(far.state, 0);
  game.act(far.state, 0, { type: 'use', card: 0, pick: game.optionsFor(far.state, 0, 'bow').findIndex((o) => o.label === '右') }, () => 0.9);
  assert.equal(far.state.phase, 'move', '外れたら、受ける場面はない');
  assert.equal(far.state.turn, 1);
  assert.deepEqual(far.state.hp, [START_HP, START_HP]);
  assert.deepEqual(far.state.hands[0], [], '神器はなくなる');

  // 実際の当たる割合が、命中率どおりになる。
  const rng = mulberry32(11);
  let hit = 0;
  for (let i = 0; i < 3000; i++) {
    const t = arena([[0, 2], [4, 2]], [['bow']]);
    ready(t.state, 0);
    game.act(t.state, 0, { type: 'use', card: 0, pick: game.optionsFor(t.state, 0, 'bow').findIndex((o) => o.label === '右') }, rng);
    if (t.state.phase === 'guard') hit++;
  }
  assert.ok(Math.abs(hit / 3000 - 0.7) < 0.03, String(hit / 3000));
});
