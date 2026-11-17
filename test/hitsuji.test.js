// おかえりヒツジのルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/hitsuji.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const { SIZE, fleeFrom, reachable, isGate } = game;
const at = (r, c) => r * SIZE + c;

/** 動物の位置を自分で決めた牧場を作る。 */
function pasture({ n = 2, dogs, sheep, rocks = [], rounds = 8 }) {
  const state = game.setup({ n, rng: mulberry32(1) });
  state.dogs = dogs;
  state.owner = dogs.map((_, d) => d % n);
  state.moved = dogs.map(() => false);
  state.sheep = sheep;
  state.ids = sheep.map((_, i) => i);
  state.total = sheep.length;
  state.rocks = rocks;
  state.maxRounds = rounds;
  state.wanderChance = 0;
  return state;
}

test('hitsuji: ヒツジは犬の反対側へ2マス逃げる (ななめにも)', () => {
  const state = pasture({ dogs: [at(6, 0), at(6, 6)], sheep: [at(3, 3), at(2, 5)] });
  // 真下から近づくと、真上へ2マス。
  let result = fleeFrom(state, 0, at(4, 3));
  assert.deepEqual(result.moves, [{ from: at(3, 3), to: at(1, 3), path: [at(3, 3), at(2, 3), at(1, 3)], home: false }]);
  // 右下から近づくと、左上へ2マス。
  result = fleeFrom(state, 0, at(4, 4));
  assert.equal(result.moves[0].to, at(1, 1));
  // となりにいないヒツジは動かない。
  assert.equal(result.moves.length, 1);
  assert.equal(result.sheep[1], at(2, 5));
  // 計算するだけで、状態は変えない。
  assert.deepEqual(state.sheep, [at(3, 3), at(2, 5)]);
});

test('hitsuji: 小屋のマスに入ったヒツジは帰る', () => {
  const state = pasture({ dogs: [at(6, 0), at(6, 6)], sheep: [at(1, 3), at(4, 4)] });
  assert.ok(isGate(at(0, 3)));
  assert.ok(!isGate(at(0, 1)));
  const rng = mulberry32(2);
  // 犬は3歩までなので、まず近くまで寄せておく。
  state.dogs[0] = at(3, 2);
  assert.ok(reachable(state, 0).includes(at(2, 3)));
  game.act(state, 0, { type: 'move', dog: 0, to: at(2, 3) }, rng);
  assert.deepEqual(state.sheep, [at(4, 4)]);
  assert.deepEqual(state.ids, [1], '残ったヒツジの番号は変わらない');
  assert.equal(state.home, 1);
  assert.equal(state.last.fled[0].home, true);
  assert.equal(state.last.fled[0].to, at(0, 3), '小屋に入ったところで止まる');
});

test('hitsuji: 壁にぶつかると広いほうへ曲がり、岩や動物にぶつかると止まる', () => {
  // 左上の角に追いつめられても、上の壁ぞいに小屋のほうへ走る。
  let state = pasture({ dogs: [at(2, 0), at(6, 6)], sheep: [at(1, 0)] });
  let result = fleeFrom(state, 0, at(2, 0));
  assert.deepEqual(result.moves[0].path, [at(1, 0), at(0, 0), at(0, 1)]);

  // 上の壁にいるヒツジを下から押すと、まんなか寄りへ曲がる。
  state = pasture({ dogs: [at(1, 6), at(6, 0)], sheep: [at(0, 6)] });
  result = fleeFrom(state, 0, at(1, 6));
  assert.deepEqual(result.moves[0].path, [at(0, 6), at(0, 5), at(0, 4)]);
  assert.equal(result.moves[0].home, true);

  // 岩の手前で止まる。
  state = pasture({ dogs: [at(5, 3), at(6, 6)], sheep: [at(4, 3)], rocks: [at(2, 3)] });
  result = fleeFrom(state, 0, at(5, 3));
  assert.equal(result.moves[0].to, at(3, 3));

  // ほかのヒツジがいれば動けない。
  state = pasture({ dogs: [at(5, 3), at(6, 6)], sheep: [at(4, 3), at(3, 3)] });
  result = fleeFrom(state, 0, at(5, 3));
  assert.deepEqual(result.moves, []);
});

test('hitsuji: 犬は3歩まで。ヒツジ・岩・小屋は通れない', () => {
  const state = pasture({ dogs: [at(3, 3), at(6, 6)], sheep: [at(3, 4)], rocks: [at(2, 3)] });
  const cells = reachable(state, 0);
  assert.ok(cells.includes(at(3, 3)), 'その場でほえることもできる');
  assert.ok(cells.includes(at(3, 0)));
  assert.ok(cells.includes(at(6, 3)));
  assert.ok(!cells.includes(at(3, 4)), 'ヒツジのマスには入れない');
  assert.ok(!cells.includes(at(2, 3)), '岩には入れない');
  assert.ok(!cells.includes(at(3, 5)), 'ヒツジを飛びこえては行けない (回り道は4歩かかる)');
  assert.ok(!cells.includes(at(0, 3)), '小屋には入れない');
});

test('hitsuji: 動く順番は自由で、全員が動くと次のラウンドへ', () => {
  const state = pasture({ n: 2, dogs: [at(6, 0), at(6, 6)], sheep: [at(3, 3)] });
  const rng = mulberry32(3);
  assert.deepEqual(game.pending(state), [0, 1]);
  assert.throws(() => game.act(state, 0, { type: 'move', dog: 1, to: at(6, 5) }, rng), GameError, 'ほかの人の犬は動かせない');
  assert.throws(() => game.act(state, 1, { type: 'move', dog: 1, to: at(0, 6) }, rng), GameError, '遠すぎる');

  game.act(state, 1, { type: 'move', dog: 1, to: at(6, 5) }, rng); // 席1 から先に動いてよい
  assert.deepEqual(game.pending(state), [0]);
  assert.throws(() => game.act(state, 1, { type: 'move', dog: 1, to: at(6, 6) }, rng), GameError, '1ラウンドに1回だけ');
  game.act(state, 0, { type: 'move', dog: 0, to: at(6, 1) }, rng);
  assert.equal(state.round, 2);
  assert.deepEqual(game.pending(state), [0, 1]);
});

test('hitsuji: 1人で遊ぶときは2匹の犬を両方動かす', () => {
  const state = game.setup({ n: 1, rng: mulberry32(9) });
  assert.equal(state.dogs.length, 2);
  assert.deepEqual(state.owner, [0, 0]);
  assert.deepEqual(game.pending(state), [0]);
  const rng = mulberry32(10);
  game.act(state, 0, { type: 'move', dog: 1, to: state.dogs[1] }, rng);
  assert.deepEqual(game.pending(state), [0], 'もう1匹が残っている');
  game.act(state, 0, { type: 'move', dog: 0, to: state.dogs[0] }, rng);
  assert.equal(state.round, 2);
});

test('hitsuji: そばに犬がいないヒツジだけが、ラウンドの終わりにふらふら歩く', () => {
  const rng = mulberry32(5);
  for (let i = 0; i < 30; i++) {
    const state = pasture({ dogs: [at(6, 0), at(6, 6)], sheep: [at(5, 1), at(3, 3)] });
    state.wanderChance = 1;
    // 犬0 はヒツジ0 のななめ下にいる。ほえずに見張るため、先にヒツジを動かさない位置で確認する。
    state.moved = [true, false];
    game.act(state, 1, { type: 'move', dog: 1, to: at(6, 6) }, rng);
    assert.equal(state.sheep[0], at(5, 1), '犬のそばのヒツジは動かない');
    const moved = state.last.wandered;
    assert.ok(moved.length <= 1);
    if (moved.length === 1) {
      assert.equal(moved[0].from, at(3, 3));
      const dr = Math.abs(Math.floor(moved[0].to / SIZE) - 3);
      const dc = Math.abs((moved[0].to % SIZE) - 3);
      assert.equal(dr + dc, 1, '歩くのは1マスだけ');
    }
  }
});

test('hitsuji: 全部帰せば全員の勝ち、日が暮れたら全員の負け', () => {
  const rng = mulberry32(6);
  let state = pasture({ dogs: [at(3, 2), at(6, 6)], sheep: [at(1, 3)] });
  game.act(state, 0, { type: 'move', dog: 0, to: at(2, 3) }, rng);
  assert.equal(state.over, true);
  assert.equal(state.result.coop, true);
  assert.equal(state.result.success, true);
  assert.equal(state.result.stars, 3);
  assert.deepEqual(state.result.winners, [0, 1]);

  state = pasture({ dogs: [at(6, 0), at(6, 6)], sheep: [at(3, 3)], rounds: 1 });
  game.act(state, 0, { type: 'move', dog: 0, to: at(6, 0) }, rng);
  game.act(state, 1, { type: 'move', dog: 1, to: at(6, 6) }, rng);
  assert.equal(state.over, true);
  assert.equal(state.result.success, false);
  assert.deepEqual(state.result.winners, []);
  assert.match(state.result.headline, /1 匹のうち 0 匹/);
});
