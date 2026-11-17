// CPU 同士で何度も対戦させて、どのゲームも最後まで進むこと・
// 結果が正しい形になること・非公開情報が漏れないことを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../shared/games/index.js';
import { GameError, makeResult } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';
import { lightMap, turnOrder } from '../shared/games/toudai.js';
import { optionsFor, bustChance, seedCap, countFlowers, SIZE } from '../shared/games/korokoro.js';

const MAX_STEPS = 5000;

/**
 * CPU だけで1ゲームを最後まで進める。
 * 番のあるゲームは行動待ちの席から、リアルタイムのゲームは全員に聞いて、
 * だれも動かなければ時計を1つ進める。
 */
export function playOut(game, n, seed) {
  const rng = mulberry32(seed);
  const state = game.setup({ n, rng });
  let steps = 0;
  while (!state.over) {
    const waiting = game.meta.realtime ? Array.from({ length: n }, (_, s) => s) : game.pending(state);
    const order = waiting.slice().sort(() => rng() - 0.5);
    let acted = false;
    for (const seat of order) {
      const action = game.bot(state, seat, rng);
      if (!action) continue;
      game.act(state, seat, action, rng);
      acted = true;
      break;
    }
    if (!acted) {
      assert.ok(game.timer?.(state), '行動待ちの席も時計もないのに終わっていない');
      game.tick(state, rng);
    }
    // どの席の view も JSON にできること。
    for (let s = -1; s < n; s++) JSON.stringify(game.view(state, s));
    assert.ok(++steps < MAX_STEPS, 'ゲームが終わらない');
  }
  return { state, steps };
}

for (const game of Object.values(GAMES)) {
  const { id, minPlayers, maxPlayers } = game.meta;

  test(`${id}: CPU 同士の対戦が最後まで進む`, () => {
    for (let n = minPlayers; n <= maxPlayers; n++) {
      const games = id === 'toudai' && n === 2 ? 6 : 40;
      for (let i = 0; i < games; i++) {
        const { state } = playOut(game, n, 1000 * n + i);
        const { result } = state;
        assert.equal(result.scores.length, n);
        assert.equal(result.places.length, n);
        if (result.coop) {
          // 協力ゲームは全員で勝つか、全員で負けるか。
          assert.equal(result.winners.length, result.success ? n : 0);
        } else {
          assert.ok(result.winners.length >= 1);
        }
        for (const w of result.winners) assert.equal(result.places[w], 1);
        assert.deepEqual(game.pending(state), []);
      }
    }
  });

  test(`${id}: 終了後や順番外の操作は拒否される`, () => {
    const rng = mulberry32(7);
    const state = game.setup({ n: minPlayers, rng });
    assert.throws(() => game.act(state, 0, { type: 'no-such-action' }, rng), GameError);
    assert.throws(() => game.act(state, 0, null, rng), GameError);
    const { state: done } = playOut(game, minPlayers, 99);
    const action = { type: 'place', cell: 0, kind: 'plus', to: 0, n: 1, tile: 0, lot: 0 };
    assert.throws(() => game.act(done, 0, action, rng), GameError);
  });
}

test('toudai: 光は岩と灯台で止まり、多く照らした人のマスになる', () => {
  const size = 5;
  const cells = new Array(25).fill(null);
  cells[0] = { o: 0, k: 'plus' }; // 左上
  cells[3] = 'rock'; // 1行目の4マス目
  cells[24] = { o: 1, k: 'cross' }; // 右下
  const { counts, owner, scores } = lightMap(size, cells, 2);
  assert.equal(owner[1], 0);
  assert.equal(owner[2], 0);
  assert.equal(counts[4][0], 0, '岩の向こうには届かない');
  assert.equal(owner[20], 0, '下方向は端まで届く');
  assert.equal(owner[18], 1);
  assert.equal(owner[6], 1, 'ななめの光は灯台の手前まで届く');
  assert.equal(scores[0], 2 + 4);
  assert.equal(scores[1], 3);

  // 同じ数だけ照らされたマスは誰のものでもない。
  const tie = new Array(25).fill(null);
  tie[0] = { o: 0, k: 'plus' };
  tie[4] = { o: 1, k: 'plus' };
  assert.equal(lightMap(size, tie, 2).owner[2], -1);
});

test('toudai: 自分の番でないと置けず、同じマスには置けない', () => {
  const game = GAMES.toudai;
  const rng = mulberry32(3);
  const state = game.setup({ n: 2, rng });
  const first = state.turn;
  const free = state.cells.findIndex((c) => c === null);
  assert.throws(() => game.act(state, 1 - first, { type: 'place', cell: free, kind: 'plus' }, rng), GameError);
  game.act(state, first, { type: 'place', cell: free, kind: 'plus' }, rng);
  assert.equal(state.turn, 1 - first);
  assert.throws(() => game.act(state, 1 - first, { type: 'place', cell: free, kind: 'plus' }, rng), GameError);
  const rock = state.cells.findIndex((c) => c === 'rock');
  assert.throws(() => game.act(state, 1 - first, { type: 'place', cell: rock, kind: 'cross' }, rng), GameError);
});

test('toudai: 手番は折り返し、最後の1基は同時に置く', () => {
  const game = GAMES.toudai;
  assert.deepEqual(turnOrder(3, 1).slice(0, 9), [1, 2, 0, 0, 2, 1, 1, 2, 0]);
  assert.equal(turnOrder(3, 0).length, 3 * 7);

  const rng = mulberry32(8);
  const state = game.setup({ n: 2, rng });
  while (state.phase === 'build') game.act(state, state.turn, game.bot(state, state.turn, rng), rng);
  assert.equal(state.phase, 'final');
  assert.deepEqual(game.pending(state), [0, 1]);
  for (const seat of [0, 1]) assert.equal(state.stock[seat].plus + state.stock[seat].cross, 1);

  // 同じマスを選ぶと、どちらも建てられない。
  const free = state.cells.findIndex((c) => c === null);
  const kindOf = (seat) => (state.stock[seat].plus > 0 ? 'plus' : 'cross');
  game.act(state, 0, { type: 'place', cell: free, kind: kindOf(0) }, rng);
  assert.equal(game.view(state, 1).myChoice, null, '相手の選択は見えない');
  assert.deepEqual(game.view(state, 1).submitted, [true, false]);
  assert.deepEqual(game.pending(state), [1]);
  game.act(state, 1, { type: 'place', cell: free, kind: kindOf(1) }, rng);
  assert.equal(state.over, true);
  assert.equal(state.cells[free], null);
  assert.deepEqual(state.finalReveal.map((r) => r.ok), [false, false]);
});

test('gottsunko: かぶると戻されて宝石が育ち、おしのけは1人だけなら勝つ', () => {
  const game = GAMES.gottsunko;
  const rng = mulberry32(5);
  const state = game.setup({ n: 3, rng });
  state.pos = [0, 2, 10];
  state.gems.fill(0);
  state.gems[1] = 3;
  state.gems[11] = 2;

  // 席0と席1が同じマスをねらい、席2は別のマスへ。
  game.act(state, 0, { type: 'choose', to: 1 }, rng);
  game.act(state, 1, { type: 'choose', to: 1 }, rng);
  assert.equal(game.view(state, 2).submitted.filter(Boolean).length, 2);
  assert.equal(game.view(state, 2).myChoice, null);
  game.act(state, 2, { type: 'choose', to: 11 }, rng);
  assert.deepEqual(state.pos, [0, 2, 11]);
  assert.deepEqual(state.score, [0, 0, 2]);
  assert.equal(state.gems[1], 4, 'ごっつんこした宝石は育つ');
  assert.equal(state.round, 2);

  // おしのけを使ったのが1人だけなら、その人が取る。
  state.gems.fill(0);
  state.gems[1] = 4;
  game.act(state, 0, { type: 'choose', to: 1, push: true }, rng);
  game.act(state, 1, { type: 'choose', to: 1 }, rng);
  game.act(state, 2, { type: 'choose', to: 12 }, rng);
  assert.equal(state.pos[0], 1);
  assert.equal(state.pos[1], 2);
  assert.equal(state.score[0], 4);
  assert.equal(state.push[0], 1);

  // 届かないマスや、使い切ったおしのけは拒否される。
  assert.throws(() => game.act(state, 0, { type: 'choose', to: 24 }, rng), GameError);
  state.push[1] = 0;
  assert.throws(() => game.act(state, 1, { type: 'choose', to: 3, push: true }, rng), GameError);
});

test('gottsunko: 他の人の選んだ行き先は見えない', () => {
  const game = GAMES.gottsunko;
  const rng = mulberry32(11);
  const state = game.setup({ n: 3, rng });
  const action = game.bot(state, 0, rng);
  game.act(state, 0, action, rng);
  assert.deepEqual(game.view(state, 0).myChoice, { to: action.to, push: action.push });
  for (const seat of [1, 2, -1]) {
    const v = game.view(state, seat);
    assert.equal(v.myChoice, null);
    assert.equal(JSON.stringify(v).includes('"choice"'), false);
  }
});

test('dokan: 見えるのは自分の1枚だけで、届いたら爆発する', () => {
  const game = GAMES.dokan;
  const rng = mulberry32(21);
  const state = game.setup({ n: 3, rng });
  state.fuse = [4, 5, 6];
  state.peek = [0, 1, 2];
  state.turn = 0;

  for (let seat = 0; seat < 3; seat++) {
    const v = game.view(state, seat);
    assert.equal(v.fuse, null);
    assert.deepEqual(v.myPeek, { index: seat, value: state.fuse[seat] });
  }
  assert.equal(game.view(state, -1).myPeek, null);

  game.act(state, 0, { type: 'add', n: 3 }, rng); // 3
  game.act(state, 1, { type: 'add', n: 3 }, rng); // 6
  game.act(state, 2, { type: 'add', n: 3 }, rng); // 9
  game.act(state, 0, { type: 'add', n: 3 }, rng); // 12
  assert.deepEqual(state.roundPoints, [6, 3, 3]);
  game.act(state, 1, { type: 'pass' }, rng);
  assert.throws(() => game.act(state, 1, { type: 'pass' }, rng), GameError);
  game.act(state, 2, { type: 'add', n: 2 }, rng); // 14 — まだセーフ
  assert.equal(state.phase, 'play');
  game.act(state, 0, { type: 'add', n: 1 }, rng); // 15 — ちょうど届いて爆発
  assert.equal(state.phase, 'reveal');
  assert.deepEqual(state.points, [-3, 3, 5], '爆発した人はラウンドの点を失って減点、ほかは受け取る');
  assert.deepEqual(game.view(state, 1).fuse, [4, 5, 6]);

  game.act(state, 1, { type: 'next' }, rng);
  assert.equal(state.phase, 'play');
  assert.equal(state.turn, 0, '爆発した人から次のラウンドが始まる');
  assert.equal(state.total, 0);
  assert.deepEqual(state.passLeft, [1, 1, 1]);
  assert.deepEqual(state.roundPoints, [0, 0, 0]);
});

test('dokan: 同点なら爆発の少ない人が上位', () => {
  const result = makeResult([10, 10, 4], { tiebreak: [-2, -1, 0] });
  assert.deepEqual(result.places, [2, 1, 3]);
  assert.deepEqual(result.winners, [1]);
  assert.deepEqual(makeResult([5, 5, 1]).places, [1, 1, 3]);
  assert.deepEqual(makeResult([2, 0, 1], { higherIsBetter: false }).places, [3, 1, 2]);
});

test('korokoro: まける場所のルールと失敗の確率', () => {
  const owner = new Array(SIZE * SIZE).fill(-1);
  // 3と5 → 3行5列 か 5行3列
  assert.deepEqual(optionsFor(owner, [], 0, 3, 5), [2 * SIZE + 4, 4 * SIZE + 2]);
  // ゾロ目は1マスだけ
  assert.deepEqual(optionsFor(owner, [], 0, 2, 2), [SIZE + 1]);
  // 自分の花のマスにはまけないが、相手の花にはまける
  owner[2 * SIZE + 4] = 0;
  owner[4 * SIZE + 2] = 1;
  assert.deepEqual(optionsFor(owner, [], 0, 3, 5), [4 * SIZE + 2]);
  // この番に使った行と列にはまけない
  owner.fill(-1);
  assert.deepEqual(optionsFor(owner, [2 * SIZE + 0], 0, 3, 5), [4 * SIZE + 2]);
  assert.deepEqual(optionsFor(owner, [2 * SIZE + 2], 0, 3, 5), []);

  assert.equal(bustChance(owner, [], 0), 0);
  const one = bustChance(owner, [0], 0);
  const two = bustChance(owner, [0, SIZE + 1], 0);
  const three = bustChance(owner, [0, SIZE + 1, 2 * SIZE + 2], 0);
  assert.ok(one > 0 && one < two && two < three, 'まくほど失敗しやすくなる');
});

/** サイコロの出目を決め打ちするための乱数。1回ふるごとに2つ使われる。 */
function dice(...faces) {
  const queue = faces.map((f) => (f - 1) / SIZE + 0.01);
  return () => queue.shift();
}
const at = (row, col) => (row - 1) * SIZE + (col - 1);

test('korokoro: 失敗すると種は消え、やめると花になる', () => {
  const game = GAMES.korokoro;
  const state = game.setup({ n: 2, rng: mulberry32(1) });
  const first = state.turn;
  const second = 1 - first;

  // 1番手の最初の番は、種1つまで。まいたらそのまま花になって番が終わる。
  game.act(state, first, { type: 'roll' }, dice(3, 5));
  assert.equal(state.phase, 'place');
  assert.throws(() => game.act(state, first, { type: 'bank' }, dice()), GameError, 'まく場所を選ぶ前にはやめられない');
  game.act(state, first, { type: 'place', cell: at(3, 5) }, dice());
  assert.equal(state.owner[at(3, 5)], first);
  assert.equal(state.event.type, 'bank');
  assert.equal(state.turn, second);

  // 2番手の最初の番は2つまで。同じ行・同じ列しか出ない目でしっぱいすると、種は消える。
  game.act(state, second, { type: 'roll' }, dice(1, 2));
  game.act(state, second, { type: 'place', cell: at(1, 2) }, dice());
  assert.equal(state.turn, second, 'まだ続けられる');
  game.act(state, second, { type: 'roll' }, dice(1, 1));
  assert.equal(state.event.type, 'bust');
  assert.deepEqual(state.event.lost, [at(1, 2)]);
  assert.equal(state.owner[at(1, 2)], -1);
  assert.equal(state.turn, first);

  // 2回目の番からは、やめると言うまで続けられる。やめると花になる。
  game.act(state, first, { type: 'roll' }, dice(4, 6));
  game.act(state, first, { type: 'place', cell: at(4, 6) }, dice());
  game.act(state, first, { type: 'roll' }, dice(5, 1));
  game.act(state, first, { type: 'place', cell: at(5, 1) }, dice());
  assert.equal(state.turn, first);
  game.act(state, first, { type: 'bank' }, dice());
  assert.deepEqual(countFlowers(state.owner, 2)[first], 3);
  assert.equal(state.turn, second);
  assert.equal(state.over, false);
});

test('korokoro: 最初の番だけ、手番が早い人ほどまける種が少ない', () => {
  const game = GAMES.korokoro;
  const state = game.setup({ n: 4, rng: mulberry32(2) });
  const order = [0, 1, 2, 3].map((k) => (state.start + k) % 4);
  const caps = order.map((seat) => seedCap({ ...state, turn: seat }));
  assert.deepEqual(caps, [1, 2, 3, 4]);
  assert.equal(game.view(state, 0).cap, 1, '画面にも、いまの番の上限が届く');
  // 一度でも番を終えた人は、ふつうどおり6つまで。
  state.turnsTaken[order[0]] = 1;
  assert.equal(seedCap({ ...state, turn: order[0] }), SIZE);

  // 6つまいたら行も列も使い切るので、自動で花になる。
  state.turnsTaken.fill(1);
  const seat = state.turn;
  const rolls = [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1]];
  for (const [r, c] of rolls) {
    game.act(state, seat, { type: 'roll' }, dice(r, c));
    game.act(state, seat, { type: 'place', cell: at(r, c) }, dice());
  }
  assert.equal(state.event.type, 'bank');
  assert.equal(countFlowers(state.owner, 4)[seat], 6);
  assert.notEqual(state.turn, seat);
});

test('korokoro: 先に目標の数の花を咲かせた人が、その場で勝つ', () => {
  const game = GAMES.korokoro;
  assert.equal(game.setup({ n: 2, rng: mulberry32(3) }).target, 10);
  assert.equal(game.setup({ n: 5, rng: mulberry32(3) }).target, 9, '5人のときは9個');

  const state = game.setup({ n: 2, rng: mulberry32(3) });
  state.turnsTaken = [1, 1];
  const me = state.turn;
  const rival = 1 - me;
  // 自分は 8 個、相手は 9 個持っている。
  for (let c = 1; c <= 6; c++) state.owner[at(1, c)] = me;
  state.owner[at(2, 1)] = me;
  state.owner[at(2, 2)] = me;
  for (let c = 1; c <= 6; c++) state.owner[at(6, c)] = rival;
  for (let c = 1; c <= 3; c++) state.owner[at(5, c)] = rival;

  // 相手の花にまいて 9 個。まだ種のうちは、勝ちにならない。
  game.act(state, me, { type: 'roll' }, dice(6, 6));
  game.act(state, me, { type: 'place', cell: at(6, 6) }, dice());
  game.act(state, me, { type: 'roll' }, dice(3, 3));
  game.act(state, me, { type: 'place', cell: at(3, 3) }, dice());
  assert.equal(state.over, false, 'やめると言うまでは決まらない');
  assert.equal(game.view(state, me).flowers[me], 8);

  game.act(state, me, { type: 'bank' }, dice());
  assert.equal(state.over, true);
  assert.deepEqual(state.result.winners, [me]);
  assert.equal(state.result.scores[me], 10);
  assert.equal(state.result.scores[rival], 8, 'うばわれたぶん、相手の花は減る');
  assert.equal(state.event.stolen.length, 1);
  assert.deepEqual(game.pending(state), []);
});

test('korokoro: あと1個でも、しっぱいすれば勝ちにならない', () => {
  const game = GAMES.korokoro;
  const state = game.setup({ n: 2, rng: mulberry32(4) });
  state.turnsTaken = [1, 1];
  const me = state.turn;
  for (let c = 1; c <= 6; c++) state.owner[at(1, c)] = me;
  for (let c = 1; c <= 3; c++) state.owner[at(2, c)] = me;
  game.act(state, me, { type: 'roll' }, dice(4, 4));
  game.act(state, me, { type: 'place', cell: at(4, 4) }, dice());
  game.act(state, me, { type: 'roll' }, dice(4, 4)); // 同じマスは、行も列も使用ずみ
  assert.equal(state.event.type, 'bust');
  assert.equal(state.over, false);
  assert.equal(countFlowers(state.owner, 2)[me], 9);
  assert.equal(state.turn, 1 - me);
});
