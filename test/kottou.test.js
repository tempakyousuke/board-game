// はったり骨董市のルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/kottou.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const { MAX_VALUE, TURNS_AS_DEALER } = game;

/** 席0 が親で、品物の価値が value の場面から始める。 */
function fresh(n, value) {
  const rng = mulberry32(5);
  const state = game.setup({ n, rng });
  state.starter = 0;
  state.dealer = 0;
  state.turn = 0;
  state.values[0] = value;
  return { state, rng };
}
const ask = (state, seat, amount) => game.act(state, seat, { type: 'ask', amount });
const raise = (state, seat, amount) => game.act(state, seat, { type: 'raise', amount });
const pass = (state, seat) => game.act(state, seat, { type: 'pass' });

test('kottou: 本当の価値は親にしか見えない。売れたら全員に見える', () => {
  const { state } = fresh(3, 7);
  assert.deepEqual(game.pending(state), [0]);
  assert.equal(game.view(state, 0).value, 7);
  assert.equal(game.view(state, 1).value, null);
  assert.equal(game.view(state, -1).value, null);
  ask(state, 0, 4);
  assert.equal(game.view(state, 2).value, null);
  assert.equal(game.view(state, 2).ask, 4);
  pass(state, 1);
  pass(state, 2);
  assert.equal(state.phase, 'reveal');
  for (const seat of [-1, 0, 1, 2]) assert.equal(game.view(state, seat).value, 7);
});

test('kottou: 親が言い値を言い、となりから順に1回ずつ、もっと高い値かスルー', () => {
  const { state } = fresh(4, 8);
  assert.throws(() => ask(state, 1, 3), GameError, '親ではない');
  assert.throws(() => pass(state, 0), GameError, '親は言い値を言う');
  assert.throws(() => ask(state, 0, 0), GameError);
  assert.throws(() => ask(state, 0, MAX_VALUE + 1), GameError);
  assert.throws(() => ask(state, 0, 2.5), GameError);
  ask(state, 0, 3);
  assert.equal(state.phase, 'bid');
  assert.deepEqual(game.pending(state), [1]);
  assert.throws(() => raise(state, 2, 5), GameError, '番ではない');
  assert.throws(() => raise(state, 1, 3), GameError, '言い値と同じ値は言えない');
  assert.throws(() => ask(state, 1, 5), GameError, '言い値を言えるのは親だけ');
  raise(state, 1, 5);
  assert.equal(game.view(state, 2).price, 5);
  assert.throws(() => raise(state, 2, 5), GameError, 'いまの値より高くなければならない');
  assert.throws(() => raise(state, 2, MAX_VALUE + 1), GameError);
  pass(state, 2);
  assert.deepEqual(game.pending(state), [3]);
  raise(state, 3, 6);
  // 1周したので売れる。席1 は、もう言い直せない。
  assert.equal(state.phase, 'reveal');
  assert.deepEqual(game.pending(state), []);
  assert.throws(() => raise(state, 1, 7), GameError);
  assert.deepEqual(state.outcome, { buyer: 3, price: 6, value: 8, gains: [0, 0, 0, 2] });
  assert.deepEqual(state.points, [0, 0, 0, 2]);
  assert.deepEqual(state.calls, [{ seat: 1, amount: 5 }, { seat: 2, pass: true }, { seat: 3, amount: 6 }]);
});

test('kottou: だれも乗らなければ、親が言い値で買い取る (はったりなら自分の損)', () => {
  const good = fresh(3, 9).state;
  ask(good, 0, 4);
  pass(good, 1);
  pass(good, 2);
  assert.deepEqual(good.outcome, { buyer: 0, price: 4, value: 9, gains: [5, 0, 0] });

  const bluff = fresh(3, 2).state;
  ask(bluff, 0, 6);
  pass(bluff, 1);
  pass(bluff, 2);
  assert.deepEqual(bluff.outcome.gains, [-4, 0, 0]);
  assert.deepEqual(bluff.points, [-4, 0, 0]);
});

test('kottou: 高づかみした分は親のもの。安く買えた分は買った人のもの', () => {
  const burned = fresh(3, 3).state;
  ask(burned, 0, 6);
  raise(burned, 1, 7);
  pass(burned, 2);
  assert.deepEqual(burned.outcome.gains, [4, -4, 0]);

  const bargain = fresh(3, 9).state;
  ask(bargain, 0, 4);
  pass(bargain, 1);
  raise(bargain, 2, 5);
  assert.deepEqual(bargain.outcome.gains, [0, 0, 4], '掘り出し物を取られても、親は何も失わない');

  const even = fresh(3, 5).state;
  ask(even, 0, 4);
  raise(even, 1, 5);
  pass(even, 2);
  assert.deepEqual(even.outcome.gains, [0, 0, 0]);

  assert.deepEqual(game.gainsOf(4, 2, 2, 7, 3), [0, 0, -4, 0], '親が自分で高く買っても、だれの得にもならない');
});

test('kottou: これより上を言えなくなったら、その場で売れる', () => {
  const top = fresh(4, 10).state;
  ask(top, 0, MAX_VALUE);
  assert.equal(top.phase, 'reveal', '言い値が上限なら、だれも乗れない');
  assert.deepEqual(top.outcome.gains, [0, 0, 0, 0]);

  const jump = fresh(4, 4).state;
  ask(jump, 0, 5);
  raise(jump, 1, MAX_VALUE);
  assert.equal(jump.phase, 'reveal', '上限まで上げたら、あとの人には聞かない');
  assert.deepEqual(jump.outcome.gains, [6, -6, 0, 0]);
});

test('kottou: 親は順にまわり、全員が同じ回数だけ親をして終わる。記録には言い値と本当の価値が残る', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const rng = mulberry32(40 + n);
    const state = game.setup({ n, rng });
    assert.equal(state.maxRounds, n * TURNS_AS_DEALER[n]);
    assert.ok(state.values.every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_VALUE));
    assert.equal(new Set(state.items).size, state.maxRounds, '同じ品物は2度出ない');
    const dealt = new Array(n).fill(0);
    let previous = -1;
    while (!state.over) {
      const seats = game.pending(state);
      if (seats.length === 0) {
        assert.ok(game.timer(state));
        game.tick(state, rng);
        continue;
      }
      if (state.phase === 'declare') {
        dealt[state.dealer]++;
        if (previous >= 0) assert.equal(state.dealer, (previous + 1) % n);
        previous = state.dealer;
      }
      game.act(state, seats[0], game.bot(state, seats[0], rng), rng);
    }
    assert.deepEqual(dealt, new Array(n).fill(TURNS_AS_DEALER[n]));
    assert.equal(state.history.length, state.maxRounds);
    // 得点は、記録の損得を合計したもの。
    const totals = new Array(n).fill(0);
    for (const h of state.history) {
      assert.deepEqual(h.gains, game.gainsOf(n, h.dealer, h.buyer, h.price, h.value));
      h.gains.forEach((g, s) => (totals[s] += g));
    }
    assert.deepEqual(state.result.scores, totals);
    assert.equal(state.result.unit, '両');
    assert.equal(game.timer(state), null);
    assert.equal(game.view(state, 0).history[0].item.name.length > 0, true);
  }
});

test('kottou: 同点なら、高づかみの少ない人が上', () => {
  const { state, rng } = fresh(2, 5);
  state.round = state.maxRounds;
  state.dealer = 0;
  state.values[state.round - 1] = 5;
  // 席1 は前に高づかみをして、あとで取り返したことにする。
  state.history.push({ round: 1, item: 0, dealer: 0, ask: 4, buyer: 1, price: 6, value: 4, gains: [2, -2] });
  state.points = [0, 0];
  ask(state, 0, 5);
  pass(state, 1);
  game.tick(state, rng);
  assert.equal(state.over, true);
  assert.deepEqual(state.result.scores, [0, 0]);
  assert.deepEqual(state.result.places, [1, 2]);
  assert.deepEqual(state.result.detail.burned, [0, 1]);
});

test('kottou: CPU の表は人数ごとにでき、言い値は 1〜10 に収まる。安すぎる言い値は横取りされる', () => {
  for (const n of [2, 4, 6]) {
    const { says, takes, mean } = game.cpuTable(n);
    for (let value = 1; value <= MAX_VALUE; value++) {
      const total = says[value].reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(total - 1) < 1e-9);
      assert.equal(says[value][0], 0);
    }
    assert.ok(takes[1] > takes[5] && takes[5] > 0.2 && takes[5] < 0.8, '中くらいの言い値には、乗ったり乗らなかったり');
    assert.equal(takes[MAX_VALUE], 0);
    assert.ok(mean[3] < mean[7]);
  }
  // 価値の低い品には高く、価値の高い品には安く言うことがある。
  const { says } = game.cpuTable(4);
  const above = says[2].reduce((sum, p, a) => sum + (a > 2 ? p : 0), 0);
  const below = says[9].reduce((sum, p, a) => sum + (a < 9 ? p : 0), 0);
  assert.ok(above > 0.5 && below > 0.5);
});

test('kottou: CPU は、はったりの多い親には乗らなくなり、安く言う親には乗るようになる', () => {
  const count = (history) => {
    let raised = 0;
    const rng = mulberry32(9);
    for (let i = 0; i < 4000; i++) {
      const { state } = fresh(2, 5);
      state.history = history;
      ask(state, 0, 5);
      if (game.bot(state, 1, rng).type === 'raise') raised++;
    }
    return raised / 4000;
  };
  const record = (value) => ({ round: 1, item: 0, dealer: 0, ask: 5, buyer: 0, price: 5, value, gains: [value - 5, 0] });
  const neutral = count([]);
  const afterBluffs = count([record(1), record(2), record(1)]);
  const afterLowballs = count([record(9), record(10), record(9)]);
  assert.ok(afterBluffs < neutral - 0.08, `${afterBluffs} < ${neutral}`);
  assert.ok(afterLowballs > neutral + 0.08, `${afterLowballs} > ${neutral}`);
  assert.ok(game.habitOf({ history: [record(1)] }, 0) < 0);
  assert.equal(game.habitOf({ history: [record(1)] }, 1), 0, 'ほかの人の記録は数えない');
});
