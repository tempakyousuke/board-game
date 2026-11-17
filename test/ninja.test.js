// かくれんぼ忍者のルールと、見張りに見せる推理 (いるかもしれない部屋) を確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/ninja.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const SIZE = 5;
const at = (r, c) => r * SIZE + c;

/** 忍者と見張りの位置を自分で決めた城を作る。席0 が忍者、席1 が見張り3人。 */
function castle({ ninja, guards, smoke = 1, rounds = 14 }) {
  const state = game.setup({ n: 2, rng: mulberry32(1) });
  state.ninjaSeat = 0;
  state.guardOwner = guards.map(() => 1);
  state.ninja = ninja;
  state.guards = guards;
  state.moved = guards.map(() => false);
  state.smoke = smoke;
  state.maxRounds = rounds;
  state.starts = [ninja];
  state.trail = [ninja];
  state.guardLog = [null];
  state.possible = [ninja];
  return state;
}

/** 見張り全員をその場にとどまらせて、ラウンドを終える。 */
function guardsStay(state, rng) {
  state.guards.forEach((cell, g) => game.act(state, 1, { type: 'patrol', guard: g, to: cell }, rng));
}

test('ninja: 忍者の居場所は本人にしか見えない', () => {
  const state = game.setup({ n: 3, rng: mulberry32(2) });
  const rng = mulberry32(3);
  game.act(state, state.ninjaSeat, game.bot(state, state.ninjaSeat, rng), rng);
  for (let seat = -1; seat < 3; seat++) {
    const view = game.view(state, seat);
    if (seat === state.ninjaSeat) {
      assert.equal(view.ninja, state.ninja);
      assert.deepEqual(view.trail, state.trail);
    } else {
      assert.equal(view.ninja, null);
      assert.equal(view.trail, null);
      assert.equal('guardLog' in view, false);
    }
    assert.ok(view.possible.includes(state.ninja), '推理の候補には必ず本当の居場所が入っている');
  }
});

test('ninja: 足あとは2手前の部屋に出て、候補はそこから2歩以内にしぼられる', () => {
  const rng = mulberry32(4);
  const state = castle({ ninja: at(2, 2), guards: [at(0, 0), at(0, 4), at(4, 4)] });
  assert.deepEqual(game.view(state, 1).footprints, [], '最初は足あとがない');

  game.act(state, 0, { type: 'sneak', to: at(2, 3) }, rng);
  guardsStay(state, rng);
  assert.deepEqual(game.view(state, 1).footprints, []);

  game.act(state, 0, { type: 'sneak', to: at(2, 4) }, rng);
  // 2手動いたので、出発した部屋の足あとが見える。
  assert.deepEqual(game.view(state, 1).footprints, [at(2, 2)]);
  const possible = game.view(state, 1).possible;
  assert.ok(possible.includes(at(2, 4)));
  assert.ok(possible.every((cell) => game.distance(SIZE, cell, at(2, 2)) <= 2));
  assert.ok(!possible.includes(at(0, 4)), '見張りのいる部屋は候補にならない');
  guardsStay(state, rng);

  game.act(state, 0, { type: 'sneak', to: at(2, 4) }, rng); // じっとする
  assert.deepEqual(game.view(state, 1).footprints, [at(2, 3), at(2, 2)], '新しい足あとが先頭');
});

test('ninja: 見張りが踏みこんで外れた部屋は、候補から消える', () => {
  const rng = mulberry32(5);
  const state = castle({ ninja: at(2, 2), guards: [at(2, 0), at(0, 4), at(4, 4)] });
  game.act(state, 0, { type: 'sneak', to: at(1, 2) }, rng);
  assert.ok(state.possible.includes(at(2, 1)));
  game.act(state, 1, { type: 'patrol', guard: 0, to: at(2, 1) }, rng);
  assert.ok(!state.possible.includes(at(2, 1)));
  assert.ok(state.possible.includes(at(1, 2)));
});

test('ninja: 忍者は1歩まで。見張りのいる部屋には入れず、役割の違う操作はできない', () => {
  const rng = mulberry32(6);
  const state = castle({ ninja: at(2, 2), guards: [at(2, 3), at(0, 0), at(4, 4)] });
  assert.deepEqual(game.pending(state), [0]);
  assert.throws(() => game.act(state, 0, { type: 'sneak', to: at(2, 4) }, rng), GameError, '2歩は動けない');
  assert.throws(() => game.act(state, 0, { type: 'sneak', to: at(1, 1) }, rng), GameError, 'ななめには動けない');
  assert.throws(() => game.act(state, 0, { type: 'sneak', to: at(2, 3) }, rng), GameError, '見張りの部屋');
  assert.throws(() => game.act(state, 1, { type: 'sneak', to: at(2, 1) }, rng), GameError, '見張りは忍者を動かせない');
  assert.throws(() => game.act(state, 1, { type: 'patrol', guard: 0, to: at(1, 3) }, rng), GameError, 'まだ忍者の番');

  game.act(state, 0, { type: 'sneak', to: at(2, 1) }, rng);
  assert.deepEqual(game.pending(state), [1]);
  assert.throws(() => game.act(state, 0, { type: 'patrol', guard: 0, to: at(1, 3) }, rng), GameError, '忍者は見張りを動かせない');
  assert.throws(() => game.act(state, 1, { type: 'patrol', guard: 0, to: at(0, 3) }, rng), GameError, '見張りも1歩まで');
  game.act(state, 1, { type: 'patrol', guard: 0, to: at(1, 3) }, rng);
  assert.throws(() => game.act(state, 1, { type: 'patrol', guard: 0, to: at(1, 2) }, rng), GameError, '1ラウンドに1回');
  assert.equal(state.phase, 'guards', '全員が動くまで見張りの番');
  game.act(state, 1, { type: 'patrol', guard: 2, to: at(4, 4) }, rng); // 順番は自由
  game.act(state, 1, { type: 'patrol', guard: 1, to: at(0, 1) }, rng);
  assert.equal(state.phase, 'ninja');
  assert.equal(state.round, 2);
});

test('ninja: 踏みこまれても1回は煙玉で逃げ、2回目はつかまる', () => {
  const rng = mulberry32(7);
  const state = castle({ ninja: at(2, 2), guards: [at(2, 4), at(0, 0), at(4, 4)] });
  game.act(state, 0, { type: 'sneak', to: at(2, 3) }, rng);
  game.act(state, 1, { type: 'patrol', guard: 0, to: at(2, 3) }, rng);
  assert.equal(state.over, false);
  assert.equal(state.smoke, 0);
  assert.equal(state.event.type, 'smoke');
  assert.equal(game.distance(SIZE, state.ninja, at(2, 3)), 1, 'となりの部屋へ逃げる');
  assert.equal(game.view(state, 1).smokeAt, at(2, 3), 'どこから逃げたかは全員にわかる');
  assert.ok(state.possible.includes(state.ninja));
  assert.ok(state.possible.every((cell) => game.distance(SIZE, cell, at(2, 3)) === 1));

  // 煙玉がなくなったあとに踏みこまれると終わり。
  const hide = state.ninja;
  game.act(state, 1, { type: 'patrol', guard: 1, to: at(0, 0) }, rng);
  game.act(state, 1, { type: 'patrol', guard: 2, to: at(4, 4) }, rng);
  game.act(state, 0, { type: 'sneak', to: hide }, rng);
  const towards = game.neighbors(SIZE, at(2, 3)).includes(hide);
  assert.ok(towards);
  game.act(state, 1, { type: 'patrol', guard: 0, to: hide }, rng);
  assert.equal(state.over, true);
  assert.deepEqual(state.result.winners, [1]);
  assert.equal(state.result.detail.reason, 'caught');
  assert.equal(game.view(state, 1).ninja, hide, '終わったら居場所と足どりが公開される');
});

test('ninja: 夜明けまで逃げ切れば忍者の勝ち', () => {
  const rng = mulberry32(8);
  const state = castle({ ninja: at(0, 0), guards: [at(4, 4), at(4, 3), at(4, 2)], rounds: 2 });
  for (let round = 0; round < 2; round++) {
    game.act(state, 0, { type: 'sneak', to: at(0, 0) }, rng);
    guardsStay(state, rng);
  }
  assert.equal(state.over, true);
  assert.deepEqual(state.result.winners, [0]);
  assert.deepEqual(state.result.roles, ['忍者', '見張り']);
  assert.match(state.result.headline, /逃げ切り/);
});

test('ninja: どう進んでも、推理の候補から本当の居場所が外れることはない', () => {
  for (let i = 0; i < 150; i++) {
    const rng = mulberry32(1000 + i);
    const n = 2 + (i % 3);
    const state = game.setup({ n, rng });
    let steps = 0;
    while (!state.over) {
      const seat = game.pending(state)[0];
      // CPU の手と、でたらめな手を混ぜる。
      let action = game.bot(state, seat, rng);
      if (rng() < 0.4) {
        if (seat === state.ninjaSeat) {
          const moves = [state.ninja, ...game.neighbors(state.size, state.ninja)].filter((c) => !state.guards.includes(c));
          action = { type: 'sneak', to: moves[Math.floor(rng() * moves.length)] };
        } else {
          const g = action.guard;
          const from = state.guards[g];
          const moves = [from, ...game.neighbors(state.size, from)].filter((c) => c === from || !state.guards.includes(c));
          action = { type: 'patrol', guard: g, to: moves[Math.floor(rng() * moves.length)] };
        }
      }
      game.act(state, seat, action, rng);
      if (!state.over) assert.ok(state.possible.includes(state.ninja), `seed ${i} step ${steps}`);
      assert.ok(++steps < 500);
    }
  }
});

test('ninja: 人数にかかわらず見張りは3人で、全員に担当がある', () => {
  for (const n of [2, 3, 4]) {
    const state = game.setup({ n, rng: mulberry32(n) });
    assert.equal(state.guards.length, 3);
    const owners = new Set(state.guardOwner);
    assert.equal(owners.has(state.ninjaSeat), false);
    assert.equal(owners.size, n - 1, '忍者以外の全員が見張りを持つ');
  }
});
