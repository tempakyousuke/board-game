// みんなでダウトのルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/dauto.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const { countFace, isHigher, minQuantity, canRaise, chanceAtLeast, DICE_BY_PLAYERS } = game;

/** 手元のサイコロと、最初に宣言する人を決めた状態を作る。 */
function table(hands, claimant = 0) {
  const rng = mulberry32(1);
  const state = game.setup({ n: hands.length, rng });
  state.hands = hands.map((hand) => hand.slice());
  state.counts = hands.map((hand) => hand.length);
  state.claimant = claimant;
  return { state, rng };
}

/** 宣言して、ほかの全員が賭ける。bets は席ごとの true (本当) / false (うそ)。 */
function round(state, rng, q, f, bets) {
  const claimant = state.claimant;
  game.act(state, claimant, { type: 'claim', q, f }, rng);
  for (const [seat, believe] of Object.entries(bets)) game.act(state, Number(seat), { type: 'bet', believe }, rng);
}

test('dauto: 人数に合わせた数のサイコロを配り、自分のぶんだけが見える', () => {
  for (let n = 2; n <= 6; n++) {
    const state = game.setup({ n, rng: mulberry32(n) });
    assert.deepEqual(state.counts, new Array(n).fill(DICE_BY_PLAYERS[n]));
    for (const hand of state.hands) {
      assert.equal(hand.length, DICE_BY_PLAYERS[n]);
      for (const d of hand) assert.ok(d >= 1 && d <= 6);
    }
    for (let seat = 0; seat < n; seat++) {
      const view = game.view(state, seat);
      assert.deepEqual(view.myDice, state.hands[seat]);
      assert.equal(JSON.stringify(view).includes('hands'), false, '全員の手元は送らない');
    }
    assert.equal(game.view(state, -1).myDice, null, '観戦者にはだれのサイコロも見せない');
    assert.deepEqual(game.pending(state), [state.claimant]);
  }
  assert.equal(DICE_BY_PLAYERS[2], 5);
  assert.equal(DICE_BY_PLAYERS[4], 4);
});

test('dauto: 1の目はワイルドで、どの目にも数える', () => {
  assert.equal(countFace([1, 1, 5, 5, 2], 5), 4);
  assert.equal(countFace([1, 1, 5, 5, 2], 2), 3);
  assert.equal(countFace([1, 1, 5, 5, 2], 6), 2);
  assert.equal(countFace([3, 4], 6), 0);
});

test('dauto: 宣言は前より大きくなければならない', () => {
  assert.ok(isHigher({ q: 1, f: 2 }, null));
  assert.ok(isHigher({ q: 4, f: 2 }, { q: 3, f: 6 }), '個数が多ければ目は小さくてよい');
  assert.ok(isHigher({ q: 3, f: 5 }, { q: 3, f: 4 }), '同じ個数なら大きい目');
  assert.equal(isHigher({ q: 3, f: 4 }, { q: 3, f: 4 }), false);
  assert.equal(isHigher({ q: 3, f: 3 }, { q: 3, f: 4 }), false);
  assert.equal(minQuantity(null, 2), 1);
  assert.equal(minQuantity({ q: 3, f: 4 }, 5), 3);
  assert.equal(minQuantity({ q: 3, f: 4 }, 4), 4);
  assert.equal(minQuantity({ q: 3, f: 4 }, 2), 4);

  const { state, rng } = table([[2, 2, 3], [4, 5, 6], [1, 1, 6]]);
  assert.throws(() => game.act(state, 1, { type: 'claim', q: 2, f: 3 }, rng), GameError, '番ではない人は宣言できない');
  assert.throws(() => game.act(state, 0, { type: 'claim', q: 2, f: 1 }, rng), GameError, '1の目では宣言できない');
  assert.throws(() => game.act(state, 0, { type: 'claim', q: 2, f: 7 }, rng), GameError);
  assert.throws(() => game.act(state, 0, { type: 'claim', q: 0, f: 3 }, rng), GameError);
  assert.throws(() => game.act(state, 0, { type: 'claim', q: 10, f: 3 }, rng), GameError, '全部の個数より多くは言えない');
  assert.throws(() => game.act(state, 0, { type: 'claim', q: 2.5, f: 3 }, rng), GameError);
  game.act(state, 0, { type: 'claim', q: 2, f: 4 }, rng);
  assert.equal(state.phase, 'bet');
  assert.deepEqual(game.pending(state), [1, 2]);
  assert.throws(() => game.act(state, 0, { type: 'bet', believe: true }, rng), GameError, '宣言した人は賭けない');
  assert.throws(() => game.act(state, 1, { type: 'bet', believe: 'yes' }, rng), GameError);
  assert.throws(() => game.act(state, 1, { type: 'claim', q: 3, f: 4 }, rng), GameError, '賭けの最中は宣言できない');
});

test('dauto: 全員が「本当」なら答え合わせをせず、次の人がもっと大きい宣言をする', () => {
  const { state, rng } = table([[2, 2, 3], [4, 5, 6], [1, 1, 6]]);
  const before = state.hands.map((hand) => hand.slice());
  round(state, rng, 2, 4, { 1: true, 2: true });
  assert.equal(state.phase, 'claim');
  assert.equal(state.claimant, 1);
  assert.equal(state.reveal, null);
  assert.deepEqual(state.counts, [3, 3, 3], 'だれも失わない');
  assert.deepEqual(state.hands, before, 'ふり直さない');
  assert.deepEqual(state.claim, { q: 2, f: 4 });
  assert.throws(() => game.act(state, 1, { type: 'claim', q: 2, f: 4 }, rng), GameError);
  assert.throws(() => game.act(state, 1, { type: 'claim', q: 2, f: 3 }, rng), GameError);
  game.act(state, 1, { type: 'claim', q: 2, f: 5 }, rng);
  assert.deepEqual(state.claims.map((c) => [c.seat, c.q, c.f]), [[0, 2, 4], [1, 2, 5]]);
  assert.deepEqual(game.pending(state), [0, 2]);
});

test('dauto: 本当の宣言を疑った人だけが、サイコロを失う', () => {
  // 6 の目は、席1に1個・席2に3個 (ワイルド2個をふくむ) で、合わせて4個。
  const { state, rng } = table([[2, 2, 3], [4, 5, 6], [1, 1, 6], [2, 3, 4]]);
  round(state, rng, 4, 6, { 1: false, 2: true, 3: false });
  assert.equal(state.phase, 'reveal');
  assert.equal(state.reveal.real, 4);
  assert.equal(state.reveal.truth, true);
  assert.deepEqual(state.reveal.losers, [1, 3]);
  assert.deepEqual(state.counts, [3, 2, 3, 2]);
  assert.deepEqual(state.tricked, [2, 0, 0, 0], '引っかけた人数を数える');
  assert.deepEqual(game.pending(state), [0, 1, 2, 3]);

  // 答え合わせでは、全員のサイコロと賭けが見える。
  const view = game.view(state, -1);
  assert.deepEqual(view.reveal.hands, [[2, 2, 3], [4, 5, 6], [1, 1, 6], [2, 3, 4]]);
  assert.deepEqual(view.reveal.bets, [null, false, true, false]);

  // 次のラウンドは、宣言した人の次の人から。減ったぶんだけ少なくふり直す。
  game.act(state, 2, { type: 'next' }, rng);
  assert.equal(state.phase, 'claim');
  assert.equal(state.round, 2);
  assert.equal(state.claimant, 1);
  assert.equal(state.claim, null);
  assert.deepEqual(state.claims, []);
  assert.deepEqual(state.hands.map((hand) => hand.length), [3, 2, 3, 2]);
});

test('dauto: うその宣言なら、宣言した人と信じた人が失う', () => {
  const { state, rng } = table([[2, 2, 3], [4, 5, 6], [1, 1, 6], [2, 3, 4]], 2);
  round(state, rng, 5, 6, { 0: true, 1: false, 3: true });
  assert.equal(state.reveal.real, 4);
  assert.equal(state.reveal.truth, false);
  assert.deepEqual(state.reveal.losers, [0, 2, 3]);
  assert.deepEqual(state.counts, [2, 3, 2, 2]);
  assert.deepEqual(state.tricked, [0, 0, 0, 0]);
  assert.equal(state.reveal.next, 3);
});

test('dauto: 賭けは全員がそろうまで本人にしか見えず、えらび直せる', () => {
  const { state, rng } = table([[2, 2, 3], [4, 5, 6], [1, 1, 6]]);
  game.act(state, 0, { type: 'claim', q: 3, f: 6 }, rng);
  game.act(state, 1, { type: 'bet', believe: false }, rng);
  assert.equal(state.phase, 'bet');
  assert.deepEqual(game.pending(state), [2]);
  assert.equal(game.view(state, 1).myBet, false);
  for (const seat of [0, 2, -1]) {
    const view = game.view(state, seat);
    assert.equal(view.myBet, null);
    assert.deepEqual(view.submitted, [false, true, false], '賭けたかどうかだけが見える');
    assert.equal(view.reveal, null);
    assert.equal(JSON.stringify(view).includes('bets'), false);
  }
  game.act(state, 1, { type: 'bet', believe: true }, rng);
  assert.equal(game.view(state, 1).myBet, true);
  game.act(state, 2, { type: 'bet', believe: true }, rng);
  assert.equal(state.phase, 'claim', 'えらび直したあとの賭けで決まる');
  assert.equal(state.claimant, 1);
});

test('dauto: これ以上大きい宣言がないときは、全員が信じても答え合わせ', () => {
  assert.equal(canRaise({ q: 4, f: 6 }, 4), false);
  assert.equal(canRaise({ q: 4, f: 5 }, 4), true);
  assert.equal(canRaise({ q: 3, f: 6 }, 4), true);

  const lie = table([[6, 6], [1, 2]]);
  round(lie.state, lie.rng, 4, 6, { 1: true });
  assert.equal(lie.state.phase, 'reveal');
  assert.equal(lie.state.reveal.truth, false);
  assert.deepEqual(lie.state.reveal.losers, [0, 1]);

  const truth = table([[6, 6], [1, 6]]);
  round(truth.state, truth.rng, 4, 6, { 1: true });
  assert.equal(truth.state.reveal.truth, true);
  assert.deepEqual(truth.state.reveal.losers, [], '全員が当てたら、だれも失わない');
  assert.deepEqual(truth.state.counts, [2, 2]);
});

test('dauto: だれかのサイコロがなくなったら終了。残りが多い人の勝ち', () => {
  const { state, rng } = table([[2, 2, 3], [4], [1, 1, 6], [2, 3]]);
  round(state, rng, 3, 6, { 1: false, 2: true, 3: true });
  assert.equal(state.over, true);
  assert.equal(state.phase, 'over');
  assert.deepEqual(state.counts, [3, 0, 3, 2]);
  assert.deepEqual(game.pending(state), []);
  // 席0 と 席2 は同じ3個。席0 は本当の宣言で1人引っかけたので上。
  assert.deepEqual(state.result.scores, [3, 0, 3, 2]);
  assert.deepEqual(state.result.places, [1, 4, 2, 3]);
  assert.deepEqual(state.result.winners, [0]);
  assert.deepEqual(state.result.detail.tricked, [1, 0, 0, 0]);
  assert.throws(() => game.act(state, 0, { type: 'next' }, rng), GameError);
  // 最後の答え合わせは、終わったあとも見える。
  assert.deepEqual(game.view(state, 3).reveal.losers, [1]);
});

test('dauto: 引っかけた人数も同じなら同率', () => {
  const { state, rng } = table([[2, 2, 3], [4], [1, 1, 6]], 1);
  round(state, rng, 5, 4, { 0: false, 2: false });
  assert.equal(state.over, true);
  assert.deepEqual(state.result.places, [1, 3, 1]);
  assert.deepEqual(state.result.winners, [0, 2]);
});

test('dauto: CPU は確実な宣言を信じ、ありえない宣言を疑う', () => {
  assert.equal(chanceAtLeast(12, 0), 1);
  assert.equal(chanceAtLeast(3, 4), 0);
  assert.ok(Math.abs(chanceAtLeast(3, 1) - (1 - (2 / 3) ** 3)) < 1e-9);

  for (let seed = 1; seed <= 30; seed++) {
    const rng = mulberry32(seed);
    const sure = table([[2, 3, 4, 5], [6, 6, 6, 1], [2, 3, 4, 5]]);
    game.act(sure.state, 0, { type: 'claim', q: 4, f: 6 }, rng);
    assert.deepEqual(game.bot(sure.state, 1, rng), { type: 'bet', believe: true }, '自分の手元だけで足りている');

    const absurd = table([[2, 3, 4, 5], [2, 3, 4, 5], [2, 3, 4, 5]]);
    game.act(absurd.state, 0, { type: 'claim', q: 11, f: 6 }, rng);
    assert.deepEqual(game.bot(absurd.state, 1, rng), { type: 'bet', believe: false }, '自分に1個もないのに、ほぼ全部とは言えない');
  }
});

test('dauto: CPU の宣言はいつもルールどおりで、最後まで進む', () => {
  for (let n = 2; n <= 6; n++) {
    for (let seed = 1; seed <= 25; seed++) {
      const rng = mulberry32(seed * 31 + n);
      const state = game.setup({ n, rng });
      let steps = 0;
      while (!state.over) {
        assert.ok(++steps < 5000, '終わらない');
        const seat = game.pending(state)[0];
        const action = game.bot(state, seat, rng);
        if (action.type === 'claim') assert.ok(isHigher(action, state.claim) && action.q <= game.totalDice(state));
        game.act(state, seat, action, rng);
      }
      assert.ok(state.counts.some((count) => count === 0));
      assert.ok(state.counts.every((count) => count >= 0));
    }
  }
});
