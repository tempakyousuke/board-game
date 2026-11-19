// 神器の箱庭のルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/hakoniwa.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const { cellOf, START_HP, START_HAND, HAND_LIMIT, MAKAI_TURN, TERRAINS } = game;

/** 全部が平地の盤で、席0 の番から始める。places: 席ごとの [x, y]。 */
function arena(places, hands = []) {
  const rng = mulberry32(3);
  const state = game.setup({ n: places.length, rng });
  state.cells = state.cells.map(() => 'plain');
  state.pos = places.map(([x, y]) => cellOf(x, y));
  state.turn = 0;
  state.hands = places.map((_, s) => (hands[s] ?? []).slice());
  return { state, rng };
}
const stay = (state, rng, seat) => game.act(state, seat, { type: 'move', to: state.pos[seat] }, rng);
/** 手札の id の神器を、label の使い方 (向きの名前など) で使う。 */
function use(state, rng, seat, id, pickBy) {
  const card = state.hands[seat].indexOf(id);
  const options = game.optionsFor(state, seat, id);
  const pick = typeof pickBy === 'function' ? options.findIndex(pickBy) : options.findIndex((o) => o.label === pickBy);
  game.act(state, seat, { type: 'use', card, pick }, rng);
}

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

test('hakoniwa: 移動はたて・よこ1マスかその場。動いた先の地形から神器を1枚ひろう', () => {
  const { state, rng } = arena([[2, 2], [2, 1], [4, 4]]);
  state.cells[cellOf(3, 2)] = 'wall';
  state.cells[cellOf(1, 2)] = 'forest';
  assert.deepEqual(game.movesFor(state, 0).sort((a, b) => a - b), [cellOf(1, 2), cellOf(2, 2), cellOf(2, 3)], '人のいるマスと岩かべには入れない');
  assert.throws(() => game.act(state, 0, { type: 'move', to: cellOf(2, 1) }, rng), GameError);
  assert.throws(() => game.act(state, 0, { type: 'skip' }, rng), GameError, 'まず移動');
  assert.throws(() => game.act(state, 1, { type: 'move', to: cellOf(1, 1) }, rng), GameError, '番ではない');
  game.act(state, 0, { type: 'move', to: cellOf(1, 2) }, rng);
  assert.equal(state.phase, 'use');
  assert.equal(state.hands[0].length, 1);
  assert.ok(state.hands[0][0] in TERRAINS.forest.deck);
  game.act(state, 0, { type: 'skip' }, rng);
  assert.equal(state.turn, 1);
  assert.equal(state.turnNo, 2);
});

test('hakoniwa: 手札は10枚まで。溶岩は強い神器のかわりにダメージ、泉は番の初めに回復', () => {
  const { state, rng } = arena([[0, 0], [4, 4]], [new Array(HAND_LIMIT).fill('sword')]);
  state.cells[cellOf(1, 0)] = 'lava';
  state.cells[cellOf(4, 4)] = 'spring';
  state.hp[1] = 20;
  game.act(state, 0, { type: 'move', to: cellOf(1, 0) }, rng);
  assert.equal(state.hp[0], START_HP - TERRAINS.lava.hurt);
  assert.equal(state.hands[0].length, HAND_LIMIT, 'いっぱいなら、ひろえない');
  game.act(state, 0, { type: 'skip' }, rng);
  assert.equal(state.hp[1], 20 + game.SPRING_HEAL);
  stay(state, rng, 1);
  assert.ok(state.hands[1][0] in TERRAINS.spring.deck);
  game.act(state, 1, { type: 'skip' }, rng);
  stay(state, rng, 0);
  assert.equal(state.hp[0], START_HP - 2 * TERRAINS.lava.hurt, 'とどまっても受ける');
});

test('hakoniwa: 貫通する武器は線の上の全員に当たり、貫通しない武器は最初の1人で止まる。岩かべは止める', () => {
  const places = [[0, 2], [1, 2], [3, 2], [4, 4]];
  const far = arena(places).state;
  const line = (id) => game.optionsFor(far, 0, id).find((o) => o.label === '右');
  assert.deepEqual(line('cannon').hits, [1, 2]);
  assert.deepEqual(line('bow').hits, [1]);
  assert.deepEqual(line('spear').hits, [1], 'やりは2マスまで');
  assert.equal(game.optionsFor(far, 0, 'sword').length, 3, '盤の外へは向けられない');
  far.cells[cellOf(2, 2)] = 'wall';
  assert.deepEqual(line('cannon').hits, [1]);
  // ななめ・まわり・どこでも
  const diag = arena([[1, 1], [2, 2], [3, 3], [0, 1], [4, 0]]).state;
  assert.deepEqual(game.optionsFor(diag, 0, 'boomerang').find((o) => o.label === '右下').hits, [1, 2]);
  assert.deepEqual(game.optionsFor(diag, 0, 'sickle')[0].hits.sort(), [1, 3]);
  assert.deepEqual(game.optionsFor(diag, 0, 'thunder').map((o) => o.target), [1, 2, 3, 4]);
  assert.deepEqual(game.optionsFor(diag, 0, 'woodShield'), [], '防具は自分の番には使えない');
});

test('hakoniwa: 攻撃された人は防具を何枚でも出して受け、出した枚数だけ足もとから引き直す', () => {
  const { state, rng } = arena([[0, 2], [1, 2], [3, 2]], [['cannon'], ['woodShield', 'sword', 'leafCloak'], ['armor']]);
  state.cells[cellOf(3, 2)] = 'forest';
  stay(state, rng, 0);
  use(state, rng, 0, 'cannon', '右');
  assert.equal(state.phase, 'guard');
  assert.deepEqual(game.pending(state).sort(), [1, 2]);
  assert.equal(game.view(state, 2).attack.power, 6);
  assert.throws(() => game.act(state, 0, { type: 'guard', cards: [] }, rng), GameError, '撃った人は受けない');
  assert.throws(() => game.act(state, 1, { type: 'guard', cards: [1] }, rng), GameError, '武器では受けられない');
  assert.throws(() => game.act(state, 1, { type: 'guard', cards: [0, 0] }, rng), GameError);
  game.act(state, 1, { type: 'guard', cards: [0, 2] }, rng);
  assert.deepEqual(game.view(state, 0).attack.answered, [1], 'だれが決めたかだけ見える');
  assert.deepEqual(game.pending(state), [2]);
  game.act(state, 2, { type: 'guard', cards: [] }, rng);
  // 席1: 6 − (3+2) = 1。席2: 森で −1、防具なしで 5。
  assert.deepEqual(state.hp, [START_HP, START_HP - 1, START_HP - 5]);
  assert.equal(state.hands[1].length, 3, '2枚出して2枚引き直す');
  assert.ok(state.hands[1].includes('sword'));
  assert.deepEqual(state.hands[2], ['armor'], '出さなければ引かない');
  const last = state.events.find((e) => e.t === 'attack');
  assert.deepEqual(last.results.map((r) => [r.seat, r.guard.length, r.damage]), [[1, 2, 1], [2, 0, 5]]);
  assert.equal(state.turn, 1);
});

test('hakoniwa: 山の上からは威力が上がる。だれもいない向きは空ぶりで、神器だけなくなる', () => {
  const { state, rng } = arena([[0, 0], [1, 0], [4, 4]], [['hammer', 'sword']]);
  state.cells[cellOf(0, 0)] = 'mountain';
  stay(state, rng, 0);
  state.hands[0] = ['hammer', 'sword'];
  use(state, rng, 0, 'sword', '下');
  assert.equal(state.events.at(-1).t, 'miss');
  assert.deepEqual(state.hands[0], ['hammer']);
  assert.equal(state.turn, 1);
  assert.equal(game.powerOf(state, 0, 'hammer'), 10);
});

test('hakoniwa: 奇跡で地形が変わる。突風は押し、入れかえは場所を取りかえる', () => {
  const { state, rng } = arena([[0, 0], [2, 0], [4, 4]], [['erupt', 'wall', 'flatten', 'gust', 'swap', 'water']]);
  const turnOf0 = (fn) => {
    state.turn = 0;
    state.phase = 'move';
    stay(state, rng, 0);
    fn();
  };
  turnOf0(() => use(state, rng, 0, 'erupt', (o) => o.cell === cellOf(2, 0)));
  assert.equal(state.cells[cellOf(2, 0)], 'lava');
  assert.equal(state.hp[1], START_HP - 3);
  turnOf0(() => {
    assert.ok(!game.optionsFor(state, 0, 'wall').some((o) => o.cell === cellOf(2, 0)), '人のいるマスは岩かべにできない');
    use(state, rng, 0, 'wall', (o) => o.cell === cellOf(1, 1));
  });
  assert.equal(state.cells[cellOf(1, 1)], 'wall');
  turnOf0(() => use(state, rng, 0, 'flatten', (o) => o.cell === cellOf(1, 1)));
  assert.equal(state.cells[cellOf(1, 1)], 'plain');
  turnOf0(() => use(state, rng, 0, 'gust', '右'));
  game.act(state, 1, { type: 'guard', cards: [] }, rng);
  assert.equal(state.pos[1], cellOf(4, 0), '2マス押される');
  assert.equal(state.hp[1], START_HP - 3 - 3);
  turnOf0(() => use(state, rng, 0, 'swap', (o) => o.target === 2));
  assert.deepEqual([state.pos[0], state.pos[2]], [cellOf(4, 4), cellOf(0, 0)]);
  state.hp[0] = 27;
  turnOf0(() => use(state, rng, 0, 'water', () => true));
  assert.equal(state.hp[0], START_HP, '回復は上限まで');
});

test('hakoniwa: HP がなくなると脱落して番がとばされ、最後の1人が勝つ', () => {
  const { state, rng } = arena([[0, 0], [1, 0], [0, 1]], [['lavaAxe', 'lavaAxe']]);
  state.hp = [30, 5, 5];
  stay(state, rng, 0);
  state.hands[0] = ['lavaAxe', 'lavaAxe'];
  use(state, rng, 0, 'lavaAxe', '右');
  game.act(state, 1, { type: 'guard', cards: [] }, rng);
  assert.equal(state.alive[1], false);
  assert.equal(state.turn, 2, '脱落した人の番はとばす');
  assert.equal(game.bot(state, 1, rng), null);
  assert.throws(() => game.act(state, 1, { type: 'move', to: 0 }, rng), GameError);
  stay(state, rng, 2);
  game.act(state, 2, { type: 'skip' }, rng);
  stay(state, rng, 0);
  use(state, rng, 0, 'lavaAxe', '下');
  game.act(state, 2, { type: 'guard', cards: [] }, rng);
  assert.equal(state.over, true);
  assert.deepEqual(state.result.winners, [0]);
  assert.deepEqual(state.result.places, [1, 3, 2], '長く残った人が上');
});

test('hakoniwa: 100ターンをすぎると全部のマスが魔界になり、地形は変えられず、かならず決着がつく', () => {
  const { state, rng } = arena([[0, 0], [4, 4]], [['flatten', 'erupt', 'wall']]);
  state.turnNo = MAKAI_TURN - 1;
  stay(state, rng, 0);
  game.act(state, 0, { type: 'skip' }, rng);
  assert.equal(state.makai, false);
  stay(state, rng, 1);
  game.act(state, 1, { type: 'skip' }, rng);
  assert.equal(state.makai, true);
  assert.ok(state.cells.every((terrain) => terrain === 'makai'));
  for (const id of ['flatten', 'erupt', 'wall']) assert.deepEqual(game.optionsFor(state, 0, id), []);
  stay(state, rng, 0);
  assert.equal(state.hp[0], START_HP - TERRAINS.makai.hurt);
  assert.ok(state.hands[0].at(-1) in TERRAINS.makai.deck);

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
      assert.equal(s.alive.filter(Boolean).length, 1);
      assert.ok(s.turnNo < MAKAI_TURN + 60);
    }
  }
});
