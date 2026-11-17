// おはじきリングの物理とルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/ohajiki.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

const { settle, stepPhysics, ringPoints, clampShot, FRICTION, LAUNCH, MAX_SPEED, RADIUS, DISC } = game;
const disc = (x, y, vx = 0, vy = 0, seat = 0) => ({ id: 0, seat, x, y, vx, vy });
/** from から、何にも当たらなければ distance だけ進んで止まる速さ。 */
const speedFor = (distance) => Math.sqrt(2 * FRICTION * distance);

test('ohajiki: 同じ入力からは、いつも同じ結果になる', () => {
  const make = () => [disc(0.02, 0.1), disc(-0.15, -0.2, 0, 0, 1), disc(0.3, 0.4), disc(0.05, LAUNCH, -0.1, -2.1, 1)];
  const a = settle(make());
  const b = settle(make());
  assert.deepEqual(a, b);
  // 通信で送っても (JSON にしても) 値が変わらないので、ブラウザでも同じ動きを再生できる。
  const sent = JSON.parse(JSON.stringify(make()));
  assert.deepEqual(settle(sent), a);
});

test('ohajiki: まさつで止まり、ねらった距離だけ進む', () => {
  // 発射位置からまんなかまで、ちょうど届く速さで弾く。
  const [d] = settle([disc(0, LAUNCH, 0, -speedFor(LAUNCH))]);
  assert.ok(Math.abs(d.y) < 0.03, `まんなか付近で止まる (y=${d.y})`);
  assert.equal(d.x, 0);
  assert.equal(ringPoints(d.x, d.y), 5);
});

test('ohajiki: まっすぐ当てると、相手が飛んで自分はその場に残る', () => {
  const after = settle([disc(0, 0.3, 0, 0, 1), disc(0, LAUNCH, 0, -1.7, 0)]);
  const target = after.find((d) => d.seat === 1);
  const shooter = after.find((d) => d.seat === 0);
  assert.ok(target.y < 0.3 - 0.4, '当てられたほうは大きく動く');
  assert.ok(Math.abs(shooter.y - (0.3 + DISC * 2)) < 0.15, '当てたほうは、ぶつかった場所の近くで止まる');
  // いちばん強く当てれば、的の外まで弾き出せる。
  const knocked = settle([disc(0, 0.3, 0, 0, 1), disc(0, LAUNCH, 0, -MAX_SPEED, 0)]);
  assert.deepEqual(knocked.map((d) => d.seat), [0], '相手はいなくなり、自分だけが残る');
  // ぶつかるたびに勢いは減る (増えない)。
  const pair = [disc(0, 0, 0, 0, 1), disc(0, 0.5, 0, -1.5, 0)];
  let energy = Infinity;
  for (let i = 0; i < 400; i++) {
    stepPhysics(pair);
    const now = pair.reduce((sum, p) => sum + p.vx * p.vx + p.vy * p.vy, 0);
    assert.ok(now <= energy + 1e-12);
    energy = now;
  }
});

test('ohajiki: 的の外で止まったものと、盤から落ちたものは取りのぞかれる', () => {
  // 弱すぎて的に届かない。
  assert.deepEqual(settle([disc(0, LAUNCH, 0, -speedFor(0.05))]), []);
  // 強すぎて反対側へ飛び出す。
  assert.deepEqual(settle([disc(0, LAUNCH, 0, -MAX_SPEED)]), []);
  // 的のふちぎりぎりの内側は残る。
  assert.equal(settle([disc(0, RADIUS - 0.01)]).length, 1);
  assert.equal(ringPoints(0, RADIUS - 0.01), 1);
  assert.equal(ringPoints(0, RADIUS + 0.01), 0);
});

test('ohajiki: 弱すぎる弾き方は受けつけず、強すぎるものは上限におさめる', () => {
  assert.equal(clampShot(0.01, 0.01), null);
  assert.equal(clampShot(NaN, 1), null);
  const strong = clampShot(30, 40);
  assert.ok(Math.abs(Math.sqrt(strong.vx ** 2 + strong.vy ** 2) - MAX_SPEED) < 1e-9);
  assert.ok(Math.abs(strong.vx / strong.vy - 0.75) < 1e-9, '向きは変えない');

  const state = game.setup({ n: 2, rng: mulberry32(1) });
  const seat = state.turn;
  assert.throws(() => game.act(state, seat, { type: 'shoot', vx: 0.01, vy: 0 }), GameError);
  assert.throws(() => game.act(state, seat, { type: 'shoot', vx: 'a', vy: 1 }), GameError);
  assert.throws(() => game.act(state, 1 - seat, { type: 'shoot', vx: 0, vy: -1.5 }), GameError, '番ではない');
});

test('ohajiki: 画面は「弾く前の配置」と「速度」から、サーバーと同じ結果を再生できる', () => {
  const rng = mulberry32(7);
  const state = game.setup({ n: 3, rng });
  for (let i = 0; i < 9; i++) {
    const seat = state.turn;
    game.act(state, seat, game.bot(state, seat, rng), rng);
    const view = JSON.parse(JSON.stringify(game.view(state, 0))); // 通信で届いたつもり
    const { last } = view;
    const replay = last.before.map((d) => ({ ...d, vx: 0, vy: 0 }));
    replay.push({ id: last.disc, seat: last.seat, x: view.launch[last.seat].x, y: view.launch[last.seat].y, vx: last.vx, vy: last.vy });
    const result = settle(replay).map((d) => ({ id: d.id, seat: d.seat, x: d.x, y: d.y }));
    assert.deepEqual(result, view.discs, `${i + 1} 発目`);
  }
});

test('ohajiki: 順番に弾き、全員が弾き終わると点を数えて次の回へ', () => {
  const rng = mulberry32(9);
  const state = game.setup({ n: 2, rng });
  const first = state.first;
  assert.equal(state.shots, 5);
  // 席ごとに、まんなかへ届く速さでまっすぐ弾く。
  const toCenter = (seat) => {
    const from = state.launch[seat];
    const speed = speedFor(LAUNCH) / LAUNCH;
    return { type: 'shoot', vx: -from.x * speed, vy: -from.y * speed };
  };

  game.act(state, first, toCenter(first), rng);
  assert.equal(state.turn, 1 - first);
  assert.equal(state.discs.length, 1);
  assert.equal(game.view(state, 0).live[first], 5);
  assert.deepEqual(game.view(state, 0).totals, [0, 0], '合計は回が終わるまで増えない');

  while (state.phase === 'shoot') game.act(state, state.turn, toCenter(state.turn), rng);
  assert.equal(state.phase, 'review');
  assert.deepEqual(state.shotsLeft, [0, 0]);
  assert.deepEqual(state.totals, state.history[0]);
  assert.deepEqual(game.pending(state), [0, 1]);
  assert.throws(() => game.act(state, 0, toCenter(0), rng), GameError);

  game.act(state, 0, { type: 'next' }, rng);
  assert.equal(state.end, 2);
  assert.deepEqual(state.discs, []);
  assert.equal(state.turn, 1 - first, '先に弾く人は回ごとに交代する');

  while (state.phase === 'shoot') game.act(state, state.turn, toCenter(state.turn), rng);
  game.act(state, 1, { type: 'next' }, rng);
  assert.equal(state.over, true);
  assert.deepEqual(state.result.scores, state.totals);
});
