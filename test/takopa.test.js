// ロシアンたこパと、わさび係はだれだ のルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/takopa.js';
import * as role from '../shared/games/wasabi.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const { SLOTS, BET_REWARD, ROUNDS_BY_PLAYERS } = game;

/** 仕込みを終えて、宣言が始まるところまで進める。slots は席ごとのわさびの位置 (0 = なし)。 */
function table(slots, dealer = 0) {
  const rng = mulberry32(3);
  const state = game.setup({ n: slots.length, rng });
  state.dealer = dealer;
  slots.forEach((slot, seat) => game.act(state, seat, { type: 'plate', slot }, rng));
  assert.equal(state.phase, 'bid');
  return { state, rng };
}
const bid = (state, rng, seat, amount) => game.act(state, seat, { type: 'bid', amount }, rng);
const pass = (state, rng, seat) => game.act(state, seat, { type: 'pass' }, rng);
const eat = (state, rng, plate) => game.act(state, state.challenger, { type: 'eat', plate }, rng);
/** 席0 が amount で挑戦者になり、ほかの人が bets のとおりに賭けるところまで進める。 */
function challenge(state, rng, amount, bets) {
  bid(state, rng, 0, amount);
  for (let s = 1; s < state.n; s++) pass(state, rng, s);
  assert.equal(state.phase, 'bet');
  bets.forEach((success, i) => game.act(state, i + 1, { type: 'bet', success }, rng));
  assert.equal(state.phase, 'eat');
}

test('takopa: 仕込みは全員がそろうまで伏せておき、皿の中身は本人にしか見えない', () => {
  const rng = mulberry32(1);
  const state = game.setup({ n: 3, rng });
  assert.equal(state.maxRounds, ROUNDS_BY_PLAYERS[3]);
  assert.deepEqual(game.pending(state), [0, 1, 2]);
  assert.throws(() => game.act(state, 0, { type: 'plate', slot: 4 }, rng), GameError);
  assert.throws(() => game.act(state, 0, { type: 'bid', amount: 1 }, rng), GameError, '仕込みの前には宣言できない');
  game.act(state, 0, { type: 'plate', slot: 2 }, rng);
  assert.equal(game.view(state, 0).myChoice, 2);
  for (const seat of [1, 2, -1]) {
    const view = game.view(state, seat);
    assert.equal(view.myChoice, null);
    assert.deepEqual(view.ready, [true, false, false]);
    assert.equal(JSON.stringify(view).includes('choices'), false);
  }
  game.act(state, 0, { type: 'plate', slot: 3 }, rng); // えらび直し
  game.act(state, 1, { type: 'plate', slot: 0 }, rng);
  assert.equal(state.phase, 'setup');
  game.act(state, 2, { type: 'plate', slot: 1 }, rng);
  assert.equal(state.phase, 'bid');
  assert.deepEqual(state.plates, [[false, false, true], [false, false, false], [true, false, false]]);
  assert.deepEqual(game.pending(state), [state.dealer]);

  assert.deepEqual(game.view(state, 0).plates, [['safe', 'safe', 'wasabi'], [null, null, null], [null, null, null]]);
  assert.deepEqual(game.view(state, 2).plates[2], ['wasabi', 'safe', 'safe']);
  assert.deepEqual(game.view(state, -1).plates, [[null, null, null], [null, null, null], [null, null, null]], '観戦者にはどの皿も見えない');
});

test('takopa: 親から順に数を上げるかパスし、最後まで残った人が挑戦者になる', () => {
  const { state, rng } = table([0, 0, 0, 0], 2);
  assert.equal(state.turn, 2);
  assert.throws(() => pass(state, rng, 2), GameError, '親は最初の宣言をパスできない');
  assert.throws(() => bid(state, rng, 3, 1), GameError, '番ではない');
  bid(state, rng, 2, 2);
  assert.throws(() => bid(state, rng, 3, 2), GameError, '前より多く言う');
  assert.throws(() => bid(state, rng, 3, 13), GameError, '全部の個数より多くは言えない');
  bid(state, rng, 3, 3);
  pass(state, rng, 0);
  bid(state, rng, 1, 5);
  assert.equal(state.turn, 2);
  pass(state, rng, 2);
  assert.equal(state.turn, 3, 'パスした人 (席0) は飛ばす');
  assert.deepEqual(game.view(state, -1).passed, [true, false, true, false]);
  pass(state, rng, 3);
  assert.equal(state.phase, 'bet');
  assert.equal(state.challenger, 1);
  assert.equal(state.need, 5);
  assert.deepEqual(state.calls.map((c) => (c.pass ? `${c.seat}p` : `${c.seat}:${c.amount}`)), ['2:2', '3:3', '0p', '1:5', '2p', '3p']);
  assert.deepEqual(game.pending(state), [0, 2, 3]);

  // 全部食べると言ったら、その場で打ち切り。
  const all = table([0, 0, 0]);
  bid(all.state, all.rng, 0, 9);
  assert.equal(all.state.phase, 'bet');
  assert.equal(all.state.challenger, 0);
});

test('takopa: 賭けは挑戦者以外が同時にこっそり行い、結果が出るまで見えない', () => {
  const { state, rng } = table([0, 0, 0]);
  bid(state, rng, 0, 2);
  pass(state, rng, 1);
  pass(state, rng, 2);
  assert.throws(() => game.act(state, 0, { type: 'bet', success: true }, rng), GameError, '挑戦する人は賭けない');
  assert.throws(() => game.act(state, 1, { type: 'bet', success: 'yes' }, rng), GameError);
  assert.throws(() => eat(state, rng, 0), GameError, '賭けが終わるまで食べられない');
  game.act(state, 1, { type: 'bet', success: false }, rng);
  assert.equal(game.view(state, 1).myBet, false);
  for (const seat of [0, 2, -1]) {
    const view = game.view(state, seat);
    assert.equal(view.myBet, null);
    assert.equal(view.bets, null);
    assert.deepEqual(view.betDone, [false, true, false]);
  }
  game.act(state, 1, { type: 'bet', success: true }, rng); // えらび直し
  game.act(state, 2, { type: 'bet', success: false }, rng);
  assert.equal(state.phase, 'eat');
  assert.deepEqual(state.bets, [null, true, false]);
});

test('takopa: まず自分の皿を手前から食べ、足りないぶんは他の人の皿を手前から食べる', () => {
  const { state, rng } = table([0, 0, 3]);
  challenge(state, rng, 5, [true, false]);
  assert.throws(() => eat(state, rng, 1), GameError, 'まず自分の皿から');
  assert.throws(() => game.act(state, 1, { type: 'eat', plate: 1 }, rng), GameError, '挑戦者しか食べられない');
  eat(state, rng, 0);
  eat(state, rng, 0);
  eat(state, rng, 0);
  assert.throws(() => eat(state, rng, 0), GameError, '自分の皿は空');
  // 食べられた分だけが、全員に見えるようになる。
  assert.deepEqual(game.view(state, 1).plates[0], ['safe', 'safe', 'safe']);
  eat(state, rng, 2); // 席2の1番目 (安全)
  assert.deepEqual(game.view(state, 1).plates[2], ['safe', null, null]);
  assert.equal(state.phase, 'eat');
  eat(state, rng, 1);
  // 5個食べきった: 宣言した数が得点。「成功」に賭けた席1 に +1。
  assert.equal(state.phase, 'result');
  assert.deepEqual(state.outcome, { success: true, hit: -1, gains: [5, BET_REWARD, 0] });
  assert.deepEqual(state.points, [5, 1, 0]);
  assert.deepEqual(state.wins, [1, 0, 0]);
  // 結果の場面では、皿も賭けも全部ひらく。
  const view = game.view(state, -1);
  assert.deepEqual(view.plates[2], ['safe', 'safe', 'wasabi']);
  assert.deepEqual(view.bets, [null, true, false]);
});

test('takopa: わさびに当たると宣言した数だけ失点。仕込んだ人には、挑戦者が食べた数だけ入る', () => {
  const { state, rng } = table([0, 2, 0]);
  challenge(state, rng, 7, [false, true]);
  for (let k = 0; k < SLOTS; k++) eat(state, rng, 0);
  eat(state, rng, 1); // 席1の1番目は安全
  assert.equal(state.phase, 'eat');
  eat(state, rng, 1); // 2番目がわさび
  assert.equal(state.phase, 'result');
  // 7個と宣言して、5個目でわさび: 挑戦者は −7点。仕込んだ席1 には、食べた 5個ぶん (と、賭けの +1)。
  assert.deepEqual(state.outcome, { success: false, hit: 1, gains: [-7, 5 + BET_REWARD, 0] });
  assert.equal(game.trapGain(state), 5);

  // 自分の皿を食べ終えて、すぐ次の1個で当たった: 食べたのは 4個。
  const early = table([0, 1, 0]);
  challenge(early.state, early.rng, 8, [true, true]);
  for (let k = 0; k < SLOTS; k++) eat(early.state, early.rng, 0);
  eat(early.state, early.rng, 1);
  assert.deepEqual(early.state.outcome, { success: false, hit: 1, gains: [-8, 4, 0] });
  assert.deepEqual(state.traps, [0, 1, 0]);
  assert.deepEqual(state.hits, [0, 1, 0]);

  // 自分のわさびを自分で食べた: 失点するだけ。
  const own = table([2, 0, 0]);
  challenge(own.state, own.rng, 2, [true, false]);
  eat(own.state, own.rng, 0);
  eat(own.state, own.rng, 0);
  assert.deepEqual(own.state.outcome, { success: false, hit: 0, gains: [-2, 0, BET_REWARD] });
  // わさびより手前までの宣言なら、仕込んでいても成功する。
  const shallow = table([3, 0, 0]);
  challenge(shallow.state, shallow.rng, 2, [true, true]);
  eat(shallow.state, shallow.rng, 0);
  eat(shallow.state, shallow.rng, 0);
  assert.equal(shallow.state.outcome.success, true);
});

test('takopa: 親が全員に同じ回数まわったら終了。同点なら成功の多い人が上', () => {
  const rng = mulberry32(9);
  const state = game.setup({ n: 3, rng });
  const first = state.dealer;
  for (let r = 1; r <= state.maxRounds; r++) {
    assert.equal(state.dealer, (first + r - 1) % 3);
    for (let s = 0; s < 3; s++) game.act(state, s, { type: 'plate', slot: 0 }, rng);
    const d = state.dealer;
    bid(state, rng, d, 1);
    pass(state, rng, (d + 1) % 3);
    pass(state, rng, (d + 2) % 3);
    game.act(state, (d + 1) % 3, { type: 'bet', success: false }, rng);
    game.act(state, (d + 2) % 3, { type: 'bet', success: false }, rng);
    eat(state, rng, d);
    if (r < state.maxRounds) {
      assert.equal(state.phase, 'result');
      assert.deepEqual(game.pending(state), [0, 1, 2]);
      game.act(state, 0, { type: 'next' }, rng);
      assert.equal(state.phase, 'setup');
    }
  }
  assert.equal(state.over, true);
  assert.deepEqual(state.points, [2, 2, 2]);
  assert.deepEqual(state.result.places, [1, 1, 1]);
  assert.deepEqual(game.pending(state), []);
  // 同点でも、成功した回数が多い人が上になる。
  state.result = null;
  state.over = false;
  state.round = state.maxRounds;
  state.points = [4, 4, 0];
  state.wins = [1, 2, 0];
  state.phase = 'eat';
  state.challenger = 2;
  state.need = 1;
  state.eaten = [0, 0, 0];
  state.log = [];
  state.plates = [[false, false, false], [false, false, false], [true, false, false]];
  state.bets = [false, false, null];
  eat(state, rng, 2);
  assert.deepEqual(state.points, [5, 5, -1]);
  assert.deepEqual(state.result.places, [2, 1, 3]);
});

test('wasabi: わさびが入るのは、こっそり決まった1人の皿だけ', () => {
  assert.equal(role.meta.minPlayers, 4);
  let trappers = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed);
    const state = role.setup({ n: 4, rng });
    assert.equal(state.mode, 'role');
    assert.throws(() => role.act(state, 0, { type: 'plate', slot: 0 }, rng), GameError, '全員が「入れるならここ」を決める');
    [1, 2, 3, 2].forEach((slot, seat) => role.act(state, seat, { type: 'plate', slot }, rng));
    assert.equal(state.phase, 'bid');
    const t = state.trapper;
    trappers.add(t);
    // 係の皿にだけ、本人が決めておいた場所にわさびが入る。
    state.plates.forEach((plate, seat) => {
      assert.deepEqual(plate, [1, 2, 3].map((k) => seat === t && k === [1, 2, 3, 2][seat]));
    });
    for (let seat = 0; seat < 4; seat++) {
      const view = role.view(state, seat);
      assert.equal(view.myRole, seat === t ? 'wasabi' : 'clean');
      assert.equal(view.trapper, -1, 'だれが係かは、結果まで明かさない');
      assert.equal(JSON.stringify(view.plates.filter((_, s) => s !== seat)).includes('wasabi'), false);
    }
    assert.equal(role.view(state, -1).myRole, null);
  }
  assert.equal(trappers.size, 4, '係はだれにでもまわる');
});

test('wasabi: 係に当たると、宣言した数が係のものになり、結果の場面で係が明かされる', () => {
  const rng = mulberry32(5);
  const state = role.setup({ n: 4, rng });
  state.dealer = 0;
  for (let s = 0; s < 4; s++) role.act(state, s, { type: 'plate', slot: 1 }, rng);
  const t = state.trapper;
  const c = (t + 1) % 4;
  state.turn = c;
  role.act(state, c, { type: 'bid', amount: 4 }, rng);
  for (let k = 1; k < 4; k++) role.act(state, (c + k) % 4, { type: 'pass' }, rng);
  for (let k = 1; k < 4; k++) role.act(state, (c + k) % 4, { type: 'bet', success: (c + k) % 4 !== t }, rng);
  for (let k = 0; k < SLOTS; k++) role.act(state, c, { type: 'eat', plate: c }, rng);
  role.act(state, c, { type: 'eat', plate: t }, rng);
  assert.equal(state.outcome.success, false);
  assert.equal(state.outcome.hit, t);
  assert.equal(state.outcome.gains[c], -4);
  assert.equal(state.outcome.gains[t], 4 + BET_REWARD, '係は「失敗」に賭けていたので、その分も入る');

  // わさび係はだれだ では、係に入るのは「宣言した数」のまま (食べた数ではない)。
  const deep = role.setup({ n: 4, rng });
  for (let s = 0; s < 4; s++) role.act(deep, s, { type: 'plate', slot: 1 }, rng);
  const dt = deep.trapper;
  const dc = (dt + 1) % 4;
  deep.turn = dc;
  role.act(deep, dc, { type: 'bid', amount: 9 }, rng);
  for (let k = 1; k < 4; k++) role.act(deep, (dc + k) % 4, { type: 'pass' }, rng);
  for (let k = 1; k < 4; k++) role.act(deep, (dc + k) % 4, { type: 'bet', success: true }, rng);
  for (let k = 0; k < SLOTS; k++) role.act(deep, dc, { type: 'eat', plate: dc }, rng);
  role.act(deep, dc, { type: 'eat', plate: dt }, rng);
  assert.equal(deep.outcome.gains[dc], -9);
  assert.equal(deep.outcome.gains[dt], 9);
  assert.equal(role.view(state, -1).trapper, t);
});

test('takopa / wasabi: CPU 同士で最後まで進み、宣言はいつもルールどおり', () => {
  for (const [mod, from] of [[game, 3], [role, 4]]) {
    for (let n = from; n <= 6; n++) {
      const rng = mulberry32(n * 7);
      const state = mod.setup({ n, rng });
      let guard = 0;
      while (!state.over) {
        assert.ok(++guard < 5000);
        const seats = mod.pending(state);
        const seat = seats[Math.floor(rng() * seats.length)];
        mod.act(state, seat, mod.bot(state, seat, rng), rng);
      }
      assert.equal(state.round, ROUNDS_BY_PLAYERS[n]);
    }
  }
});
