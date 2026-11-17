// ぐるぐるとびいしのルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/tobiishi.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const { distance, resolveTurn, RING, REACH, HAND, BONUS_BY_PLAYERS } = game;
const pileOf = (...cards) => cards.map((card) => ({ card, seat: -1 }));

/** 先頭のカードと手札を決めた状態を作る。 */
function table(top, hands) {
  const rng = mulberry32(1);
  const state = game.setup({ n: hands.length, rng });
  state.pile = pileOf(top);
  state.played = [top];
  state.hands = hands.map((hand) => hand.slice());
  return { state, rng };
}

/** 全員が出して、見せ終わるところまで進める。 */
function turn(state, rng, cards) {
  cards.forEach((card, seat) => game.act(state, seat, { type: 'pick', card }, rng));
  assert.equal(state.phase, 'reveal');
  game.tick(state, rng);
}

test('tobiishi: 数字は輪になっていて、60 の次は 1', () => {
  assert.equal(distance(55, 58), 3);
  assert.equal(distance(55, 3), 8);
  assert.equal(distance(60, 1), 1);
  assert.equal(distance(10, 9), RING - 1, 'すぐ後ろは、いちばん遠い');
});

test('tobiishi: 近い順に置き、10 以内ならつながる。最後までつなげた人にごほうび', () => {
  // ルールの例: 先頭 55 に 58・3・9・17
  const all = resolveTurn(pileOf(55), [17, 58, 9, 3]);
  assert.deepEqual(all.steps.map((s) => [s.seat, s.card, s.gap, s.ok]), [[1, 58, 3, true], [3, 3, 5, true], [2, 9, 6, true], [0, 17, 8, true]]);
  assert.equal(all.leader, 0);
  assert.deepEqual(all.pile.map((p) => p.card), [55, 58, 3, 9, 17]);

  // 17 ではなく 30 だと届かず、それまでの列 (4枚) を引き取る。だれもごほうびをもらえない。
  const miss = resolveTurn(pileOf(55), [30, 58, 9, 3]);
  assert.deepEqual(miss.steps.at(-1), { seat: 0, card: 30, gap: 21, ok: false, took: 4 });
  assert.equal(miss.leader, -1);
  assert.deepEqual(miss.pile, [{ card: 30, seat: 0 }]);
  assert.equal(REACH, 10);
});

test('tobiishi: 届かなかったカードが新しい列の最初になり、あとのカードはそこから数える', () => {
  // 先頭 10。20 はちょうど届く。35 は届かず2枚引き取り。40 は 35 から +5 でつながる。
  const { steps, pile, leader } = resolveTurn(pileOf(10), [40, 35, 20]);
  assert.deepEqual(steps.map((s) => [s.card, s.ok, s.took]), [[20, true, 0], [35, false, 2], [40, true, 0]]);
  assert.deepEqual(pile.map((p) => p.card), [35, 40]);
  assert.equal(leader, 0, '切れたあとでも、最後につながった人がごほうびをもらう');

  // 先にだれかが切っていると、あとで届かなかった人の傷は浅い。
  const two = resolveTurn(pileOf(1, 5, 10), [50, 30]);
  assert.deepEqual(two.steps.map((s) => s.took), [3, 1]);
  // 先頭のすぐ後ろのカードは、1周ぶん離れている。
  assert.equal(resolveTurn(pileOf(10), [9, 12]).steps[1].ok, false);
});

test('tobiishi: 手札は本人にしか見えず、出したカードは全員がそろうまで伏せておく', () => {
  for (let n = 2; n <= 6; n++) {
    const state = game.setup({ n, rng: mulberry32(n) });
    assert.equal(state.bonus, n, 'ごほうびは人数と同じ点数');
    assert.equal(game.view(state, -1).bonus, BONUS_BY_PLAYERS[n]);
    const all = [...state.hands.flat(), game.topOf(state)];
    assert.equal(new Set(all).size, n * HAND + 1, 'カードはすべてちがう数字');
    assert.ok(all.every((c) => c >= 1 && c <= RING));
    for (let seat = 0; seat < n; seat++) {
      const view = game.view(state, seat);
      assert.deepEqual(view.myHand, state.hands[seat]);
      assert.equal(JSON.stringify(view).includes('hands'), false);
    }
    assert.equal(game.view(state, -1).myHand, null);
  }

  const { state, rng } = table(10, [[12, 30], [15, 40], [50, 55]]);
  game.act(state, 0, { type: 'pick', card: 30 }, rng);
  assert.deepEqual(game.pending(state), [1, 2]);
  assert.equal(game.view(state, 0).myPick, 30);
  for (const seat of [1, 2, -1]) {
    const view = game.view(state, seat);
    assert.equal(view.myPick, null);
    assert.deepEqual(view.picked, [true, false, false]);
    assert.equal(view.last, null);
    assert.equal(JSON.stringify(view).includes('picks'), false);
  }
  assert.throws(() => game.act(state, 1, { type: 'pick', card: 12 }, rng), GameError, '持っていないカードは出せない');
  game.act(state, 0, { type: 'pick', card: 12 }, rng); // えらび直し
  game.act(state, 1, { type: 'pick', card: 15 }, rng);
  assert.equal(state.phase, 'pick');
  game.act(state, 2, { type: 'pick', card: 50 }, rng);
  assert.equal(state.phase, 'reveal');
  assert.deepEqual(state.last.steps.map((s) => s.card), [12, 15, 50], 'えらび直したあとのカードで決まる');
});

test('tobiishi: 見せているあいだは点も列も動かさず、時計で反映して次へ進む', () => {
  const { state, rng } = table(10, [[12, 30], [15, 40], [50, 55]]);
  [12, 15, 50].forEach((card, seat) => game.act(state, seat, { type: 'pick', card }, rng));
  assert.deepEqual(game.pending(state), []);
  assert.equal(game.bot(state, 0, rng), null);
  const clock = game.timer(state);
  assert.ok(clock.ms >= 3 * game.REVEAL_STEP_MS);
  assert.deepEqual(state.points, [0, 0, 0]);
  assert.deepEqual(state.pile.map((p) => p.card), [10]);
  assert.throws(() => game.act(state, 0, { type: 'pick', card: 30 }, rng), GameError);
  // 見ている人には、出そろったカードとなりゆきが届く。
  assert.deepEqual(game.view(state, -1).last.steps.map((s) => [s.card, s.ok, s.took]), [[12, true, 0], [15, true, 0], [50, false, 3]]);

  game.tick(state, rng);
  assert.equal(state.phase, 'pick');
  assert.equal(game.timer(state), null);
  assert.deepEqual(state.points, [0, 0, -3]);
  assert.deepEqual(state.taken, [0, 0, 3]);
  assert.deepEqual(state.pile, [{ card: 50, seat: 2 }]);
  assert.deepEqual(state.hands, [[30], [40], [55]]);
  assert.deepEqual(state.played, [10, 12, 15, 50]);
  assert.equal(state.turn, 2);
  assert.deepEqual(game.pending(state), [0, 1, 2]);

  // 先頭 50。55 (+5) がつながり、30 は届かず2枚引き取り。40 は 30 から +10 でつながって、ごほうび。
  turn(state, rng, [30, 40, 55]);
  assert.equal(state.bonus, 3, 'ごほうびは人数と同じ点数');
  assert.deepEqual(state.points, [-2, 3, -3]);
  assert.deepEqual(state.leads, [0, 1, 0]);
  assert.deepEqual(state.pile.map((p) => p.card), [30, 40]);
});

test('tobiishi: 手札を出し切るとラウンド終了。2ラウンドの合計で決まる', () => {
  const rng = mulberry32(8);
  const state = game.setup({ n: 3, rng });
  const playRound = () => {
    for (let t = 0; t < HAND; t++) turn(state, rng, state.hands.map((hand) => hand[0]));
  };
  playRound();
  assert.equal(state.phase, 'roundEnd');
  assert.deepEqual(game.pending(state), [0, 1, 2]);
  assert.deepEqual(state.roundPoints, state.points);
  assert.throws(() => game.act(state, 0, { type: 'pick', card: 1 }, rng), GameError);
  const before = state.points.slice();
  game.act(state, 1, { type: 'next' }, rng);
  assert.equal(state.round, 2);
  assert.equal(state.turn, 1);
  assert.equal(state.pile.length, 1, '列は引きつがない');
  assert.ok(state.hands.every((hand) => hand.length === HAND));
  assert.deepEqual(state.points, before, '点は引きつぐ');
  playRound();
  assert.equal(state.over, true);
  assert.deepEqual(state.result.scores, state.points);
  const best = Math.max(...state.points);
  assert.ok(state.result.winners.every((w) => state.points[w] === best));
  assert.deepEqual(game.pending(state), []);
});

test('tobiishi: 同点なら、引き取った枚数の少ない人が上', () => {
  const { state, rng } = table(10, [[30], [12], [15]]);
  state.round = state.maxRounds;
  state.turn = HAND;
  // 席0: 最後の 30 が届かず、3枚引き取って −3点。席1: もともと −3点だが引き取りは 0枚。
  // 最後のカードが届かなかったので、だれもごほうびをもらえない。
  state.points = [0, -3, 0];
  turn(state, rng, [30, 12, 15]);
  assert.equal(state.over, true);
  assert.deepEqual(state.points, [-3, -3, 0]);
  assert.deepEqual(state.leads, [0, 0, 0]);
  assert.deepEqual(state.result.places, [3, 2, 1]);
});

test('tobiishi: CPU は手札の中から出し、最後まで進む', () => {
  for (let n = 2; n <= 6; n++) {
    const rng = mulberry32(40 + n);
    const state = game.setup({ n, rng });
    let guard = 0;
    while (!state.over) {
      assert.ok(++guard < 2000);
      const seat = game.pending(state)[0];
      if (seat === undefined) {
        game.tick(state, rng);
        continue;
      }
      const action = game.bot(state, seat, rng);
      if (action.type === 'pick') assert.ok(state.hands[seat].includes(action.card));
      game.act(state, seat, action, rng);
    }
    assert.equal(state.played.length, n * HAND + 1);
  }
});
