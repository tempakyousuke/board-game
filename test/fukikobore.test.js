// ふきこぼれ注意！のルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/fukikobore.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const { resolveTurn, lightest, potSum, LIMIT, MAX_CARD, EXACT_BONUS } = game;
/** 合計だけを指定して、なべの中身を作る (1枚ずつ、持ち主なし)。 */
const pot = (...values) => values.map((value) => ({ value, seat: -1 }));

function turn(state, rng, cards) {
  cards.forEach((card, seat) => game.act(state, seat, { type: 'pick', card }, rng));
  assert.equal(state.phase, 'reveal');
  game.tick(state, rng);
}

test('fukikobore: 小さい順に、いちばん軽いなべへ入る', () => {
  assert.equal(lightest([pot(5), pot(3), pot(3)]), 1, '同じ重さなら左');
  // なべは 6 / 4 / 9。2 は B (4→6)。5 は A と B が同じ 6 なので左の A (6→11)。7 は B (6→13)。
  const { steps, pots } = resolveTurn([pot(6), pot(4), pot(9)], [7, 2, 5]);
  assert.deepEqual(steps.map((s) => [s.value, s.seats, s.pot, s.before, s.after, s.result]), [
    [2, [1], 1, 4, 6, 'ok'],
    [5, [2], 0, 6, 11, 'ok'],
    [7, [0], 1, 6, 13, 'ok'],
  ]);
  assert.deepEqual(pots.map(potSum), [11, 13, 9]);
  assert.deepEqual(pots[1].slice(1), [{ value: 2, seat: 1 }, { value: 7, seat: 0 }]);
});

test('fukikobore: 21 をこえたら、入れた人がなべの中身を全部引き取る', () => {
  // どのなべも重い。4 は B (15→19)。9 は A (16→25) であふれ、中身3枚 (もとの2枚 + 自分) を引き取る。
  const { steps, pots } = resolveTurn([pot(10, 6), pot(8, 7), pot(9, 9)], [9, 4, 1]);
  assert.deepEqual(steps.map((s) => [s.value, s.pot, s.after, s.result, s.took]), [
    [1, 1, 16, 'ok', 0],
    [4, 0, 20, 'ok', 0],
    [9, 1, 25, 'over', 4],
  ]);
  assert.deepEqual(pots.map(potSum), [20, 0, 18], 'あふれたなべは空になる');
  assert.equal(LIMIT, 21);
});

test('fukikobore: 同じ数字はまとめて入り、あふれたら全員がそれぞれ引き取る', () => {
  // 空のなべに 10 が3枚: 30 であふれる。3人とも 3枚ずつ。
  const { steps, pots } = resolveTurn([pot(), pot(12), pot(12)], [10, 10, 10, 2]);
  assert.deepEqual(steps[0], { value: 2, seats: [3], pot: 0, before: 0, after: 2, result: 'ok', took: 0 });
  assert.deepEqual(steps[1], { value: 10, seats: [0, 1, 2], pot: 0, before: 2, after: 32, result: 'over', took: 4 });
  assert.deepEqual(pots.map(potSum), [0, 12, 12]);

  const state = game.setup({ n: 4 });
  state.pots = [pot(), pot(12), pot(12)];
  turn(state, mulberry32(1), [10, 10, 10, 2]);
  assert.deepEqual(state.points, [-4, -4, -4, 0]);
  assert.deepEqual(state.taken, [4, 4, 4, 0]);
});

test('fukikobore: ぴったり 21 ならごほうび。なべは空になる', () => {
  const { steps, pots } = resolveTurn([pot(9, 5), pot(10, 10), pot(10, 9)], [7, 3, 1]);
  // 1 は A (14→15)。3 は A (15→18)。7 は A (18→25) であふれる… ではなく、順に確かめる。
  assert.deepEqual(steps.map((s) => [s.value, s.pot, s.after, s.result]), [
    [1, 0, 15, 'ok'],
    [3, 0, 18, 'ok'],
    [7, 0, 25, 'over'],
  ]);
  const exact = resolveTurn([pot(9, 5), pot(10, 10), pot(10, 9)], [7, 8, 9]);
  assert.deepEqual(exact.steps[0], { value: 7, seats: [0], pot: 0, before: 14, after: 21, result: 'exact', took: 0 });
  // A が空になったので、8 と 9 も A に入る。
  assert.deepEqual(exact.steps.slice(1).map((s) => [s.value, s.pot, s.after]), [[8, 0, 8], [9, 0, 17]]);
  assert.deepEqual(exact.pots.map(potSum), [17, 20, 19]);

  const state = game.setup({ n: 3 });
  state.pots = [pot(9, 5), pot(10, 10), pot(10, 9)];
  turn(state, mulberry32(1), [7, 8, 9]);
  assert.deepEqual(state.points, [EXACT_BONUS, 0, 0]);
  assert.deepEqual(state.exacts, [1, 0, 0]);
});

test('fukikobore: 手札は全員同じ。出したカードは全員がそろうまで伏せておく', () => {
  const rng = mulberry32(3);
  const state = game.setup({ n: 3, rng });
  assert.deepEqual(state.hands, new Array(3).fill([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  game.act(state, 0, { type: 'pick', card: 10 }, rng);
  assert.deepEqual(game.pending(state), [1, 2]);
  assert.equal(game.view(state, 0).myPick, 10);
  for (const seat of [1, 2, -1]) {
    const view = game.view(state, seat);
    assert.equal(view.myPick, null);
    assert.deepEqual(view.picked, [true, false, false]);
    assert.equal(JSON.stringify(view).includes('picks'), false);
    assert.deepEqual(view.hands[0], state.hands[0], '残りの手札は、出そろうまで減らさない');
  }
  game.act(state, 0, { type: 'pick', card: 4 }, rng); // えらび直し
  game.act(state, 1, { type: 'pick', card: 6 }, rng);
  game.act(state, 2, { type: 'pick', card: 6 }, rng);

  // 見せているあいだは点もなべも動かさない。
  assert.equal(state.phase, 'reveal');
  assert.deepEqual(game.pending(state), []);
  assert.equal(game.bot(state, 0, rng), null);
  assert.ok(game.timer(state).ms >= 2 * game.REVEAL_STEP_MS);
  assert.deepEqual(state.pots.map(potSum), [0, 0, 0]);
  assert.throws(() => game.act(state, 0, { type: 'pick', card: 5 }, rng), GameError);
  assert.deepEqual(game.view(state, -1).last.steps.map((s) => [s.value, s.seats, s.pot]), [[4, [0], 0], [6, [1, 2], 1]]);

  game.tick(state, rng);
  assert.equal(state.phase, 'pick');
  assert.equal(game.timer(state), null);
  assert.deepEqual(state.pots.map(potSum), [4, 12, 0]);
  assert.deepEqual(state.hands[0], [1, 2, 3, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(state.hands[1], [1, 2, 3, 4, 5, 7, 8, 9, 10]);
  assert.equal(state.turn, 2);
  assert.throws(() => game.act(state, 0, { type: 'pick', card: 4 }, rng), GameError, '同じカードは2回出せない');
});

test('fukikobore: 10枚出し切ったら終了。同点なら引き取った枚数の少ない人が上', () => {
  const rng = mulberry32(5);
  const state = game.setup({ n: 3, rng });
  // 全員が小さい順に出す: 毎回3人がかぶる。
  for (let t = 1; t <= MAX_CARD; t++) turn(state, rng, [t, t, t]);
  assert.equal(state.over, true);
  assert.deepEqual(game.pending(state), []);
  assert.ok(state.hands.every((hand) => hand.length === 0));
  assert.deepEqual(state.result.scores, state.points);
  assert.deepEqual(state.result.places, [1, 1, 1], '同じことをした3人は同点');
  assert.throws(() => game.act(state, 0, { type: 'pick', card: 1 }, rng), GameError);

  const tie = game.setup({ n: 3 });
  tie.turn = tie.turns;
  tie.hands = [[1], [2], [3]];
  tie.points = [-2, 0, -5];
  tie.taken = [2, 4, 5];
  tie.pots = [pot(10, 10), pot(10, 10), pot(10, 10)];
  // 1 は A でぴったり (+2 → 0点)。2 は空になった A へ。3 も A へ。
  turn(tie, rng, [1, 2, 3]);
  assert.deepEqual(tie.points, [0, 0, -5]);
  assert.deepEqual(tie.result.places, [1, 2, 3], '同じ 0点でも、引き取りが 2枚の席0 が上');
});

test('fukikobore: CPU は残っているカードから出し、最後まで進む', () => {
  for (let n = 3; n <= 6; n++) {
    const rng = mulberry32(70 + n);
    const state = game.setup({ n, rng });
    let guard = 0;
    while (!state.over) {
      assert.ok(++guard < 500);
      const seat = game.pending(state)[0];
      if (seat === undefined) {
        game.tick(state, rng);
        continue;
      }
      const action = game.bot(state, seat, rng);
      assert.ok(state.hands[seat].includes(action.card));
      game.act(state, seat, action, rng);
    }
    assert.equal(state.turn, MAX_CARD);
  }
});
