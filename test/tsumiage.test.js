// つみあげ注意のルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/tsumiage.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const { SAFE_CARDS, WASABI_CARDS, ROUNDS_BY_PLAYERS } = game;

/** 席0 から始めて、cards のとおりに順番に置く ('s' = たこ焼き, 'w' = わさび)。 */
function stacked(n, cards) {
  const rng = mulberry32(2);
  const state = game.setup({ n, rng });
  state.starter = 0;
  state.turn = 0;
  [...cards].forEach((c, i) => game.act(state, i % n, { type: 'place', card: c === 'w' ? 'wasabi' : 'safe' }, rng));
  return { state, rng };
}
const bid = (state, rng, seat, amount) => game.act(state, seat, { type: 'bid', amount }, rng);
const pass = (state, rng, seat) => game.act(state, seat, { type: 'pass' }, rng);
/** めくり終わるまで時計を進める。 */
function flipAll(state, rng) {
  let guard = 0;
  while (state.phase === 'flip') {
    assert.ok(game.timer(state));
    assert.ok(++guard < 50);
    game.tick(state, rng);
  }
}

test('tsumiage: 最初の1周は置くだけ。置いた札の中身は本人にしか見えない', () => {
  const rng = mulberry32(1);
  const state = game.setup({ n: 3, rng });
  const a = state.starter;
  const b = (a + 1) % 3;
  const c = (a + 2) % 3;
  assert.deepEqual(game.pending(state), [a]);
  assert.equal(game.view(state, a).mayDeclare, false);
  assert.throws(() => bid(state, rng, a, 1), GameError, '塔が空のうちは宣言できない');
  assert.throws(() => game.act(state, b, { type: 'place', card: 'safe' }, rng), GameError, '番ではない');
  assert.throws(() => game.act(state, a, { type: 'place', card: 'gold' }, rng), GameError);
  game.act(state, a, { type: 'place', card: 'wasabi' }, rng);
  assert.throws(() => bid(state, rng, b, 1), GameError, '全員が1枚置くまでは宣言できない');
  game.act(state, b, { type: 'place', card: 'safe' }, rng);
  game.act(state, c, { type: 'place', card: 'safe' }, rng);
  assert.equal(state.turn, a);
  assert.equal(game.view(state, a).mayDeclare, true);
  assert.deepEqual(state.hands[a], { safe: SAFE_CARDS, wasabi: WASABI_CARDS - 1 });
  assert.throws(() => game.act(state, a, { type: 'place', card: 'wasabi' }, rng), GameError, 'わさびは1枚しかない');

  // だれが置いたかは全員に見える。中身は本人だけ。
  assert.deepEqual(game.view(state, a).tower.map((t) => [t.seat, t.card]), [[a, 'wasabi'], [b, null], [c, null]]);
  assert.deepEqual(game.view(state, b).tower.map((t) => t.card), [null, 'safe', null]);
  assert.deepEqual(game.view(state, -1).tower.map((t) => t.card), [null, null, null]);
  assert.deepEqual(game.view(state, -1).handCount, [3, 3, 3].map((v, s) => (s === a ? 3 : v)));
  assert.equal(game.view(state, b).myHand.safe, SAFE_CARDS - 1);
  assert.equal(game.view(state, -1).myHand, null);
});

test('tsumiage: 宣言が出たら、順に「もっと多く」かパス。最後まで残った人が上からめくる', () => {
  // 下から 0:s 1:s 2:s 0:s 1:s  → 上から 席1, 席0, 席2, 席1, 席0
  const { state, rng } = stacked(3, 'sssss');
  assert.equal(state.turn, 2);
  assert.throws(() => pass(state, rng, 2), GameError, '宣言が出るまではパスできない');
  assert.throws(() => bid(state, rng, 2, 6), GameError, '塔の高さより多くは言えない');
  bid(state, rng, 2, 2);
  assert.equal(state.phase, 'bid');
  assert.throws(() => game.act(state, 0, { type: 'place', card: 'safe' }, rng), GameError, '宣言が出たら、もう積めない');
  assert.throws(() => bid(state, rng, 0, 2), GameError, '前より多く言う');
  bid(state, rng, 0, 3);
  pass(state, rng, 1);
  pass(state, rng, 2);
  assert.equal(state.phase, 'flip');
  assert.equal(state.challenger, 0);
  assert.equal(state.need, 3);
  assert.deepEqual(game.pending(state), []);
  assert.equal(game.bot(state, 0, rng), null);

  // 1枚ずつ、上からめくられる。
  game.tick(state, rng);
  assert.equal(state.flipped, 1);
  assert.deepEqual(game.view(state, -1).tower.map((t) => [t.card, t.flipped]), [[null, false], [null, false], [null, false], [null, false], ['safe', true]]);
  flipAll(state, rng);
  assert.equal(state.phase, 'result');
  assert.deepEqual(state.outcome, { success: true, hit: -1, gains: [3, 0, 0] });
  assert.deepEqual(state.points, [3, 0, 0]);
  // 結果の場面では、塔を全部ひらく。
  assert.ok(game.view(state, -1).tower.every((t) => t.card === 'safe'));
});

test('tsumiage: わさびが出たら、宣言した数が置いた人へ移る。自分のわさびなら失うだけ', () => {
  // 下から 0:s 1:w 2:s 0:s  → 上から 席0, 席2, 席1(わさび), 席0
  const hit = stacked(3, 'swss');
  bid(hit.state, hit.rng, 1, 1);
  bid(hit.state, hit.rng, 2, 3);
  pass(hit.state, hit.rng, 0);
  pass(hit.state, hit.rng, 1);
  flipAll(hit.state, hit.rng);
  assert.equal(hit.state.flipped, 3, 'わさびが出たところで止まる');
  assert.deepEqual(hit.state.outcome, { success: false, hit: 1, gains: [0, 3, -3] });
  assert.deepEqual(hit.state.traps, [0, 1, 0]);

  // 自分のわさびが上から2枚目にあるのに、2枚と宣言して、だれにも上げてもらえなかった。
  const own = stacked(3, 'sssws'); // 上から 席1, 席0(わさび), 席2, 席1, 席0
  bid(own.state, own.rng, 2, 1);
  bid(own.state, own.rng, 0, 2);
  pass(own.state, own.rng, 1);
  pass(own.state, own.rng, 2);
  flipAll(own.state, own.rng);
  assert.deepEqual(own.state.outcome, { success: false, hit: 0, gains: [-2, 0, 0] });
});

test('tsumiage: 塔を全部めくると言ったら打ち切り。手札がなくなった人は宣言するしかない', () => {
  const all = stacked(3, 'sss');
  bid(all.state, all.rng, 0, 3);
  assert.equal(all.state.phase, 'flip');
  assert.equal(all.state.challenger, 0);

  // 全員が4枚ずつ置ききった。
  const full = stacked(3, 'ssssssssswww');
  assert.equal(full.state.tower.length, 12);
  assert.deepEqual(full.state.hands[0], { safe: 0, wasabi: 0 });
  assert.throws(() => game.act(full.state, 0, { type: 'place', card: 'safe' }, full.rng), GameError);
  assert.throws(() => pass(full.state, full.rng, 0), GameError, '宣言するしかない');
  const action = game.bot(full.state, 0, full.rng);
  assert.equal(action.type, 'bid');
  bid(full.state, full.rng, 0, 1);
  assert.equal(full.state.phase, 'bid');
});

test('tsumiage: 最初に置く人が順にまわり、決めたラウンド数で終わる', () => {
  for (let n = 3; n <= 6; n++) {
    const rng = mulberry32(60 + n);
    const state = game.setup({ n, rng });
    const first = state.starter;
    let rounds = 0;
    let guard = 0;
    while (!state.over) {
      assert.ok(++guard < 5000);
      const seats = game.pending(state);
      if (seats.length === 0) {
        game.tick(state, rng);
        continue;
      }
      if (state.phase === 'result') {
        rounds++;
        game.act(state, seats[0], { type: 'next' }, rng);
        assert.equal(state.starter, (first + rounds) % n);
        continue;
      }
      const action = game.bot(state, seats[0], rng);
      if (action.type === 'bid') assert.ok(action.amount >= 1 && action.amount <= state.tower.length);
      game.act(state, seats[0], action, rng);
    }
    assert.equal(state.round, ROUNDS_BY_PLAYERS[n]);
    assert.deepEqual(state.result.scores, state.points);
    assert.equal(state.points.reduce((a, b) => a + b, 0) >= -100, true);
  }
});
