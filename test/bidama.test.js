// ビーだま工場のルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/bidama.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const { flow, land, canPay, payment, allMachines, ANY, TRAY, ROUNDS } = game;
const [RED, BLUE, YELLOW, GREEN] = [0, 1, 2, 3];
const star = (color, gain = 1) => ({ kind: 'star', in: color, gain });
const paint = (from, to) => ({ kind: 'paint', in: from, out: to });
const bonus = (from, out, out2) => ({ kind: 'bonus', in: from, out, ...(out2 === undefined ? {} : { out2 }) });
const fired = (result) => result.steps.filter((s) => !s.land).map((s) => s.index);

test('bidama: 玉は左から右へ流れ、色の合う機械を順に動かす', () => {
  // ルールの例: 青→赤の変色機、赤の得点機、赤が通ると黄が出るおまけ機、黄の得点機
  const line = [paint(BLUE, RED), star(RED), bonus(RED, YELLOW), star(YELLOW)];
  const r = flow(line, BLUE);
  assert.deepEqual(fired(r), [0, 1, 2, 3], '4台とも動く');
  assert.equal(r.stars, 2);
  assert.deepEqual(r.landed, [RED, YELLOW], '赤に変わった玉と、うまれた黄の玉が皿に落ちる');
  // 色の合わない玉は、素通りする。
  assert.deepEqual(flow(line, GREEN), { steps: [{ ball: 0, land: true, color: GREEN }], stars: 0, landed: [GREEN] });
  // 赤い玉なら、変色機は動かない。
  assert.deepEqual(fired(flow(line, RED)), [1, 2, 3]);
});

test('bidama: ならべる順番で結果が変わる', () => {
  // 得点機が変色機より左にあると、青い玉は得点機を素通りしてから赤になる。
  assert.equal(flow([star(RED), paint(BLUE, RED)], BLUE).stars, 0);
  assert.equal(flow([paint(BLUE, RED), star(RED)], BLUE).stars, 1);
  // うまれた玉は、うみだした機械の右から流れはじめる (左の機械は通らない)。
  assert.equal(flow([star(YELLOW), bonus(RED, YELLOW)], RED).stars, 0);
  assert.equal(flow([bonus(RED, YELLOW), star(YELLOW)], RED).stars, 1);
});

test('bidama: どの機械も1周に1回だけ動く', () => {
  // 赤が通ると赤をうみだす機械のあとに、赤の得点機: 得点機が動くのは最初の玉の1回だけ。
  const r = flow([bonus(RED, RED), star(RED, 2)], RED);
  assert.equal(r.stars, 2);
  assert.deepEqual(r.landed, [RED, RED]);
  // 2個うみだす機械と、どの色でも動く機械。
  const wide = flow([bonus(GREEN, RED, BLUE), star(ANY), star(BLUE)], GREEN);
  assert.deepEqual(fired(wide), [0, 1, 2], 'どの色でも動く得点機は緑で動き、あとから来た青で青の得点機が動く');
  assert.equal(wide.stars, 2);
  assert.deepEqual(wide.landed, [GREEN, RED, BLUE]);
  // 点が高いだけの機械は、何も起こさない。
  assert.deepEqual(fired(flow([{ kind: 'none', in: null }], RED)), []);
});

test('bidama: 皿は6個まで。いっぱいなら、いちばん多い色がおしだされる', () => {
  const tray = [3, 2, 1, 0];
  assert.equal(TRAY, 6);
  assert.equal(land(tray, GREEN), RED, '緑が入り、いちばん多い赤が1個出る');
  assert.deepEqual(tray, [2, 2, 1, 1]);
  assert.equal(land(tray, RED), RED, '入ってきた色がいちばん多いなら、その玉があふれる');
  assert.deepEqual(tray, [2, 2, 1, 1]);
  const roomy = [1, 0, 0, 0];
  assert.equal(land(roomy, BLUE), -1);
  assert.deepEqual(roomy, [1, 1, 0, 0]);
});

test('bidama: 足りない色は、ほかの玉2個で1個ぶんにできる', () => {
  const cost = [2, 1, 0, 0]; // 赤2 青1
  assert.deepEqual(payment([2, 1, 0, 0], cost), [2, 1, 0, 0]);
  assert.equal(canPay([1, 1, 1, 0], cost), false, '赤が1個足りず、かわりの玉も1個しかない');
  assert.equal(payment([1, 1, 1, 0], cost), null);
  // 赤が1個足りない: 余っている黄2個で1個ぶん。
  assert.deepEqual(payment([1, 1, 2, 0], cost), [1, 1, 2, 0]);
  // 余りの多い色から出す。
  assert.deepEqual(payment([1, 1, 1, 3], cost), [1, 1, 0, 2]);
  assert.equal(canPay([0, 0, 3, 3], cost), true, '3個足りないぶんを、6個で払う');
});

test('bidama: 機械の一覧に、払えない値段や同じ名前がない', () => {
  const { small, large } = allMachines();
  assert.equal(small.length, 24);
  assert.equal(large.length, 23);
  const ids = new Set();
  for (const m of [...small, ...large]) {
    assert.ok(!ids.has(m.id));
    ids.add(m.id);
    const total = m.cost.reduce((a, b) => a + b, 0);
    assert.ok(total >= 2 && total <= TRAY, `皿におさまる値段: ${m.id}`);
    assert.ok(m.vp >= 1);
    if (m.kind === 'paint' || m.kind === 'bonus') assert.ok(m.out >= 0 && m.out < 4);
  }
});

/** 全員が同じ手を出して、見せ終わるところまで進める。 */
function round(state, rng, actions) {
  actions.forEach((action, seat) => game.act(state, seat, { type: 'pick', ...action }, rng));
  assert.equal(state.phase, 'reveal');
  game.tick(state, rng);
}

test('bidama: 全員が同時にえらび、そろうまで中身は見えない', () => {
  const rng = mulberry32(4);
  const state = game.setup({ n: 3, rng });
  assert.equal(state.players.length, 3);
  for (const p of state.players) {
    assert.equal(p.line.length, 1, '全員、おまけ機を1台持って始める');
    assert.equal(p.line[0].kind, 'bonus');
    assert.notEqual(p.line[0].in, p.line[0].out);
  }
  assert.equal(state.marbles.length, 5);
  assert.equal(state.small.length, 3);
  assert.equal(state.large.length, 3);
  assert.deepEqual(game.pending(state), [0, 1, 2]);

  const color = state.marbles[0];
  const absent = [0, 1, 2, 3].find((c) => !state.marbles.includes(c));
  if (absent !== undefined) assert.throws(() => game.act(state, 0, { type: 'pick', kind: 'flow', color: absent }, rng), GameError);
  assert.throws(() => game.act(state, 0, { type: 'pick', kind: 'build', row: 'small', index: 0, pos: 0 }, rng), GameError, '玉がないので、つくれない');
  assert.throws(() => game.act(state, 0, { type: 'pick', kind: 'dance' }, rng), GameError);

  game.act(state, 0, { type: 'pick', kind: 'flow', color }, rng);
  assert.deepEqual(game.view(state, 0).myPick, { kind: 'flow', color });
  for (const seat of [1, 2, -1]) {
    const view = game.view(state, seat);
    assert.equal(view.myPick, null);
    assert.deepEqual(view.picked, [true, false, false]);
    assert.equal(JSON.stringify(view).includes('picks'), false);
  }
  game.act(state, 1, { type: 'pick', kind: 'flow', color }, rng);
  assert.equal(state.phase, 'pick');
  game.act(state, 2, { type: 'pick', kind: 'flow', color }, rng);

  // 見せているあいだは、皿も点も動かさない。
  assert.equal(state.phase, 'reveal');
  assert.deepEqual(game.pending(state), []);
  assert.equal(game.bot(state, 0, rng), null);
  assert.ok(game.timer(state).ms >= game.REVEAL_LEAD_MS + game.REVEAL_STEP_MS);
  assert.ok(state.players.every((p) => p.tray.every((v) => v === 0)));
  assert.throws(() => game.act(state, 0, { type: 'pick', kind: 'flow', color }, rng), GameError);
  assert.equal(game.view(state, -1).last.results.length, 3);

  const before = state.marbles.slice();
  game.tick(state, rng);
  assert.equal(state.phase, 'pick');
  assert.equal(state.round, 2);
  assert.equal(game.timer(state), null);
  state.players.forEach((p, seat) => {
    assert.deepEqual(p.tray, state.last.results[seat].tray);
    assert.ok(p.tray[color] >= 1 || p.line[0].in === color);
  });
  assert.equal(state.marbles.length, 5);
  assert.notEqual(state.marbles, before);
});

test('bidama: 同じ機械を何人がつくってもよく、好きな場所にさしこめる', () => {
  const rng = mulberry32(6);
  const state = game.setup({ n: 3, rng });
  const card = state.small[1];
  const oldest = state.large[0];
  for (const p of state.players) p.tray = [2, 2, 1, 1];
  assert.ok(canPay([2, 2, 1, 1], card.cost));
  const color = state.marbles[0];
  // 席0 は左はしに、席1 は右はしにさしこむ。席2 は流す。
  round(state, rng, [
    { kind: 'build', row: 'small', index: 1, pos: 0 },
    { kind: 'build', row: 'small', index: 1, pos: 1 },
    { kind: 'flow', color },
  ]);
  assert.equal(state.players[0].line[0].id, card.id);
  assert.equal(state.players[1].line[1].id, card.id);
  assert.equal(state.players[2].line.length, 1);
  assert.equal(state.players[0].vp, card.vp);
  assert.deepEqual(state.players[0].tray, [2, 2, 1, 1].map((v, c) => v - payment([2, 2, 1, 1], card.cost)[c]));
  // つくられた機械は場からなくなり、新しい機械が入る。だれもつくらなかった大型の列は、いちばん古い1枚が流れていく。
  assert.equal(state.small.length, 3);
  assert.ok(!state.small.some((m) => m.id === card.id));
  assert.equal(state.large.length, 3);
  assert.ok(!state.large.some((m) => m.id === oldest.id));
  assert.deepEqual(state.discards.large.map((m) => m.id), [oldest.id]);

  // さしこむ場所は、列の長さまで。
  assert.throws(() => game.act(state, 2, { type: 'pick', kind: 'build', row: 'small', index: 0, pos: 5 }, rng), GameError);
});

test('bidama: 流すと★と玉が入り、20周で終わる。同点なら★の多い人が上', () => {
  const rng = mulberry32(8);
  const state = game.setup({ n: 2, rng });
  state.players[0].line = [paint(BLUE, RED), star(RED), bonus(RED, YELLOW), star(YELLOW)].map((m, i) => ({ ...m, id: `t${i}`, cost: [0, 0, 0, 0], vp: 0 }));
  state.marbles = [BLUE, BLUE, GREEN, GREEN, RED];
  round(state, rng, [{ kind: 'flow', color: BLUE }, { kind: 'flow', color: GREEN }]);
  assert.equal(state.players[0].stars, 2);
  assert.deepEqual(state.players[0].tray, [1, 0, 1, 0]);
  assert.deepEqual(game.view(state, -1).scores[0], 2);

  let guard = 0;
  while (!state.over) {
    assert.ok(++guard < 500);
    const seats = game.pending(state);
    if (seats.length === 0) game.tick(state, rng);
    else game.act(state, seats[0], { type: 'pick', kind: 'flow', color: state.marbles[0] }, rng);
  }
  assert.equal(state.round, ROUNDS);
  assert.deepEqual(state.result.scores, state.players.map(game.scoreOf));
  assert.deepEqual(game.pending(state), []);

  // 同点: ★ の多い人が上。
  const tie = game.setup({ n: 2, rng });
  tie.round = ROUNDS;
  tie.players[0].vp = 5;
  tie.players[1].stars = 5;
  const c = tie.marbles[0];
  const gain = tie.players.map((p) => flow(p.line, c).stars);
  assert.deepEqual(gain, [0, 0]);
  round(tie, rng, [{ kind: 'flow', color: c }, { kind: 'flow', color: c }]);
  assert.equal(tie.over, true);
  assert.deepEqual(tie.result.scores, [5, 5]);
  assert.deepEqual(tie.result.places, [2, 1]);
});

test('bidama: CPU の手はいつもルールどおりで、機械を買いながら最後まで進む', () => {
  for (let n = 2; n <= 6; n++) {
    const rng = mulberry32(90 + n);
    const state = game.setup({ n, rng });
    let guard = 0;
    while (!state.over) {
      assert.ok(++guard < 2000);
      const seats = game.pending(state);
      if (seats.length === 0) {
        game.tick(state, rng);
        continue;
      }
      game.act(state, seats[0], game.bot(state, seats[0], rng), rng);
    }
    for (const p of state.players) {
      assert.ok(p.line.length >= 2, 'CPU も機械をつくる');
      assert.ok(p.tray.reduce((a, b) => a + b, 0) <= TRAY);
      assert.ok(p.tray.every((v) => v >= 0));
    }
  }
});
