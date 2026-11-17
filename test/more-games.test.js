// あとから追加したゲームのルールを個別に確かめる。
// (どのゲームも CPU 同士で最後まで進むことは games.test.js がまとめて確認している)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../shared/games/index.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';
import { scoreBox, scoreAll, HAND_SIZE } from '../shared/games/bento.js';
import { pointsOf, START_COINS, SET_BONUS } from '../shared/games/tataki.js';

// ---- つめつめ弁当 ----------------------------------------------------------

/** 3×3 の箱を、行ごとの配列で書けるようにする。 */
function box(rows) {
  return rows.flat();
}
const _ = null;

test('bento: おかずごとの点の入り方', () => {
  // おにぎり: となりのおかず (おにぎり以外) 1つにつき1点
  assert.equal(scoreBox(box([[_, 'tomato', _], ['ebi', 'onigiri', 'onigiri'], [_, 'karaage', _]])).parts.onigiri, 3 + 0);
  // たまごやき: となり合う1組につき5点。L字なら2組、2×2 なら4組
  assert.equal(scoreBox(box([['tamago', _, _], [_, _, _], [_, _, 'tamago']])).parts.tamago, 0);
  assert.equal(scoreBox(box([['tamago', 'tamago', _], ['tamago', _, _], [_, _, _]])).parts.tamago, 10);
  assert.equal(scoreBox(box([['tamago', 'tamago', _], ['tamago', 'tamago', _], [_, _, _]])).parts.tamago, 20);
  // エビフライ: 1本1点、2本4点、3本以上10点
  assert.equal(scoreBox(box([['ebi', _, _], [_, _, _], [_, _, _]])).parts.ebi, 1);
  assert.equal(scoreBox(box([['ebi', _, 'ebi'], [_, _, _], [_, _, _]])).parts.ebi, 4);
  assert.equal(scoreBox(box([['ebi', 'ebi', 'ebi'], ['ebi', _, _], [_, _, _]])).parts.ebi, 10);
  // トマト: まわり8マスにトマトがなければ3点 (ななめもだめ)
  assert.equal(scoreBox(box([['tomato', _, 'tomato'], [_, _, _], ['tomato', _, 'tomato']])).parts.tomato, 12);
  assert.equal(scoreBox(box([['tomato', _, _], [_, 'tomato', _], [_, _, 'tomato']])).parts.tomato, 0);
  // ブロッコリー: となりにあるおかずの種類の数 (ブロッコリー自身は数えない)
  assert.equal(scoreBox(box([[_, 'ebi', _], ['ebi', 'broccoli', 'tomato'], [_, 'broccoli', _]])).parts.broccoli, 2 + 0);
  // うめぼし: まんなかなら6点、ほかは1点
  assert.equal(scoreBox(box([[_, _, _], [_, 'ume', _], [_, _, 'ume']])).parts.ume, 7);
  // ピーマン: 1つ−2点。3つ以上で1つ+2点
  assert.equal(scoreBox(box([['piman', _, _], [_, _, _], [_, _, _]])).parts.piman, -2);
  assert.equal(scoreBox(box([['piman', 'piman', _], [_, _, _], [_, _, _]])).parts.piman, -4);
  assert.equal(scoreBox(box([['piman', 'piman', 'piman'], [_, _, _], [_, _, _]])).parts.piman, 6);
});

test('bento: からあげは多い順に点が入り、同数は山分け', () => {
  const withKaraage = (count) => {
    const b = new Array(9).fill(null);
    for (let i = 0; i < count; i++) b[i] = 'karaage';
    return b;
  };
  const karaage = (...counts) => scoreAll(counts.map(withKaraage)).map((s) => s.parts.karaage);
  assert.deepEqual(karaage(3, 2, 1, 0), [7, 3, 0, 0]);
  assert.deepEqual(karaage(2, 2, 1), [3, 3, 0], '1位が同数なら山分けで、2位の点はなし');
  assert.deepEqual(karaage(3, 1, 1, 1), [7, 1, 1, 1], '2位が同数なら2位の点を山分け');
  assert.deepEqual(karaage(0, 0), [0, 0]);
});

test('bento: 全員が選ぶと箱に入り、残りの手札がとなりへまわる', () => {
  const game = GAMES.bento;
  const rng = mulberry32(4);
  const state = game.setup({ n: 3, rng });
  assert.ok(state.hands.every((h) => h.length === HAND_SIZE));
  const before = state.hands.map((h) => h.slice());

  // 自分の手札だけが見える。
  assert.deepEqual(game.view(state, 1).hand, before[1]);
  assert.deepEqual(game.view(state, -1).hand, []);

  game.act(state, 0, { type: 'pack', tile: 0, cell: 4 }, rng);
  game.act(state, 1, { type: 'pack', tile: 2, cell: 0 }, rng);
  assert.equal(state.turn, 1, '全員がそろうまで進まない');
  assert.equal(game.view(state, 2).myChoice, null);
  assert.deepEqual(game.view(state, 2).submitted, [true, true, false]);
  // 選び直しもできる。
  game.act(state, 1, { type: 'pack', tile: 1, cell: 8 }, rng);
  game.act(state, 2, { type: 'pack', tile: 0, cell: 0 }, rng);

  assert.equal(state.turn, 2);
  assert.equal(state.boxes[0][4], before[0][0]);
  assert.equal(state.boxes[1][8], before[1][1]);
  assert.equal(state.boxes[1][0], null);
  // 席0 の残りは席1へ、席2 の残りは席0へ。
  assert.deepEqual(state.hands[1], before[0].slice(1));
  assert.deepEqual(state.hands[0], before[2].slice(1));

  assert.throws(() => game.act(state, 0, { type: 'pack', tile: 0, cell: 4 }, rng), GameError, 'うまったマスには置けない');
  assert.throws(() => game.act(state, 0, { type: 'pack', tile: 99, cell: 0 }, rng), GameError);
});

// ---- たたき売り！ ----------------------------------------------------------

test('tataki: 値段は時計で下がり、最初に買った人のものになる', () => {
  const game = GAMES.tataki;
  const rng = mulberry32(12);
  const state = game.setup({ n: 3, rng });
  state.items[0] = { cat: 'tsubo', value: 3, lucky: false };
  state.price = 10;
  state.fav = ['tsubo', 'e', 'gakki'];

  assert.equal(state.phase, 'intro');
  assert.deepEqual(game.pending(state), [], 'リアルタイムなので、だれの番でもない');
  assert.throws(() => game.act(state, 0, { type: 'buy', lot: 0 }, rng), GameError, 'お披露目中は買えない');

  game.tick(state, rng);
  assert.equal(state.phase, 'falling');
  assert.equal(game.timer(state).key, 'fall:0:10');
  game.tick(state, rng);
  game.tick(state, rng);
  assert.equal(state.price, 8);
  assert.notEqual(game.timer(state).key, 'fall:0:10', '値段が変わるたびに時計の区切りも変わる');

  assert.throws(() => game.act(state, 1, { type: 'buy', lot: 1 }, rng), GameError, '見ていた品物と違えば買えない');
  game.act(state, 1, { type: 'buy', lot: 0 }, rng);
  assert.equal(state.phase, 'sold');
  assert.equal(state.coins[1], START_COINS - 8);
  assert.equal(state.lastSale.seat, 1);
  assert.throws(() => game.act(state, 0, { type: 'buy', lot: 0 }, rng), GameError, '売れたあとは買えない');

  game.tick(state, rng);
  assert.equal(state.lot, 1);
  assert.equal(state.phase, 'intro');
});

test('tataki: だれも買わなければ売れ残り、コインが足りなければ買えない', () => {
  const game = GAMES.tataki;
  const rng = mulberry32(13);
  const state = game.setup({ n: 2, rng });
  state.items[0] = { cat: 'e', value: 1, lucky: false };
  state.price = 3;
  game.tick(state, rng); // 値下がり開始
  state.coins[0] = 2;
  assert.throws(() => game.act(state, 0, { type: 'buy', lot: 0 }, rng), GameError);
  game.tick(state, rng); // 2
  game.tick(state, rng); // 1
  assert.equal(state.price, 1);
  game.tick(state, rng); // 売れ残り
  assert.equal(state.phase, 'sold');
  assert.equal(state.lastSale.seat, -1);
  assert.deepEqual(state.bought, [[], []]);
});

test('tataki: お目当ては2倍、4種類そろえるとボーナス、福袋の中身は売れるまで見えない', () => {
  const game = GAMES.tataki;
  const rng = mulberry32(14);
  const state = game.setup({ n: 2, rng });
  state.fav = ['tsubo', 'e'];
  state.bought[0] = [
    { cat: 'tsubo', value: 4 },
    { cat: 'e', value: 2 },
  ];
  assert.equal(pointsOf(state, 0), 8 + 2);
  state.bought[0].push({ cat: 'yubiwa', value: 1 }, { cat: 'gakki', value: 3 });
  assert.equal(pointsOf(state, 0), 8 + 2 + 1 + 3 + SET_BONUS);

  state.items[0] = { cat: 'gakki', value: 6, lucky: true };
  state.items[1] = { cat: 'e', value: 5, lucky: true };
  let view = game.view(state, 0);
  assert.deepEqual(view.item, { lucky: true });
  assert.deepEqual(view.upcoming[0], { lucky: true });
  assert.equal(JSON.stringify(view).includes('"value":6'), false);

  game.tick(state, rng);
  game.act(state, 1, { type: 'buy', lot: 0 }, rng);
  view = game.view(state, 0);
  assert.equal(view.item.value, 6, '買われたら中身がわかる');
  assert.equal(view.lastSale.item.cat, 'gakki');
});

// ---- のろのろレース --------------------------------------------------------

test('noronoro: カードどおりに進み、はっぱとみずたまりの効果がかかる', async () => {
  const noro = await import('../shared/games/noronoro.js');
  const game = GAMES.noronoro;
  const rng = mulberry32(21);
  const state = game.setup({ n: 3, rng });
  const seat = state.turn;

  // 進む相手が決まっているカードは、ねらいを変えられない。
  state.hands[seat] = [
    { k: 'go', racer: 2, v: 2 },
    { k: 'any', v: 2 },
    { k: 'back', v: 2 },
  ];
  game.act(state, seat, { type: 'play', card: 0, racer: 5 }, rng);
  assert.equal(state.pos[2], 2);
  assert.equal(state.pos[5], 0);
  assert.equal(state.hands[seat].length, noro.HAND_SIZE, '出したら1枚引く');
  assert.equal(state.turn, (seat + 1) % 3);
  assert.throws(() => game.act(state, seat, { type: 'play', card: 0 }, rng), GameError, '番ではない');

  // はっぱ (3) にぴったり止まると +1、みずたまり (5) は −1。
  assert.deepEqual(noro.destination([1, 0, 0, 0, 0, 0], 0, 2), { to: 4, effect: 'leaf' });
  assert.deepEqual(noro.destination([3, 0, 0, 0, 0, 0], 0, 2), { to: 4, effect: 'puddle' });
  assert.deepEqual(noro.destination([4, 0, 0, 0, 0, 0], 0, 2), { to: 6, effect: null });
  // もどるときは効果なし。スタートより後ろには下がらない。
  assert.deepEqual(noro.destination([1, 0, 0, 0, 0, 0], 0, -2), { to: 0, effect: null });
  assert.deepEqual(noro.destination([5, 0, 0, 0, 0, 0], 0, -2), { to: 3, effect: null });

  // 「だれでも」「あともどり」は相手を選ぶ必要がある。
  const next = state.turn;
  state.hands[next] = [{ k: 'back', v: 2 }, { k: 'any', v: 2 }, { k: 'go', racer: 0, v: 1 }];
  assert.throws(() => game.act(state, next, { type: 'play', card: 0 }, rng), GameError);
  game.act(state, next, { type: 'play', card: 0, racer: 2 }, rng);
  assert.equal(state.pos[2], 0);
});

test('noronoro: 推しは本人にしか見えず、ゴールで公開されて順位の点が入る', async () => {
  const noro = await import('../shared/games/noronoro.js');
  const game = GAMES.noronoro;
  const rng = mulberry32(22);
  const state = game.setup({ n: 3, rng });
  assert.equal(new Set(state.fav).size, 3, '推しはかぶらない');
  for (let seat = 0; seat < 3; seat++) {
    const view = game.view(state, seat);
    assert.equal(view.myFav, state.fav[seat]);
    assert.equal(view.favs, null);
    assert.equal(view.hand.length, noro.HAND_SIZE);
  }
  assert.equal(game.view(state, -1).myFav, null);
  assert.deepEqual(game.view(state, -1).hand, []);

  // 同じマスなら、先に着いていたほうが上の順位。
  assert.deepEqual(noro.ranking([4, 4, 2, 0, 0, 0], [7, 6, 8, 3, 4, 5]), [1, 0, 2, 3, 4, 5]);

  state.fav = [0, 1, 2];
  state.pos = [9, 6, 6, 0, 0, 2];
  state.stamp = [10, 12, 11, 3, 4, 13];
  const seat = state.turn;
  state.hands[seat] = [{ k: 'any', v: 2 }, { k: 'go', racer: 3, v: 1 }, { k: 'go', racer: 4, v: 1 }];
  game.act(state, seat, { type: 'play', card: 0, racer: 0 }, rng);
  assert.equal(state.over, true);
  assert.deepEqual(state.result.detail.order.slice(0, 3), [0, 2, 1]);
  assert.deepEqual(state.result.scores, [10, 4, 6]);
  assert.deepEqual(game.view(state, -1).favs, [0, 1, 2]);
});

// ---- はたけパズル ----------------------------------------------------------

test('hatake: 形はまわしても裏返しても同じ形として認められる', async () => {
  const hatake = await import('../shared/games/hatake.js');
  const { SIZE, orientations, matchesShape, transform, SHAPES } = hatake;
  const at = (r, c) => r * SIZE + c;

  // 向きの数: 正方形は1、まっすぐは2、L字 (4マス) は裏返しを入れて8。
  assert.equal(orientations('kabocha').length, 1);
  assert.equal(orientations('kyuri').length, 2);
  assert.equal(orientations('hakusai').length, 8);
  assert.equal(orientations('mame').length, 4);

  // まわすと、たて3マスがよこ3マスになる。
  assert.deepEqual(transform(SHAPES.morokoshi.cells, 1), [[0, 0], [1, 0], [2, 0]]);

  // 畑のどこに置いても、向きが合っていれば OK。
  assert.ok(matchesShape('morokoshi', [at(2, 1), at(2, 2), at(2, 3)]));
  assert.ok(matchesShape('morokoshi', [at(3, 5), at(4, 5), at(5, 5)]));
  assert.ok(!matchesShape('morokoshi', [at(2, 1), at(2, 2), at(3, 2)]), '曲がっていたら別の形');
  assert.ok(matchesShape('nasu', [at(0, 0), at(0, 1), at(1, 1)]));
  assert.ok(matchesShape('mame', [at(0, 0), at(0, 1), at(1, 1), at(1, 2)]), '裏返したえだまめ');
  assert.ok(!matchesShape('mame', [at(0, 0), at(0, 1), at(1, 0), at(1, 1)]));
  // 端をまたいで次の行にはみ出した並びは、形として認めない。
  assert.ok(!matchesShape('morokoshi', [at(0, 4), at(0, 5), at(1, 0)]));
});

test('hatake: 植えたマス・そろった列・ふかふかの土で点が入る', async () => {
  const { SIZE, scoreField, LINE_POINTS, SOIL_POINTS } = await import('../shared/games/hatake.js');
  const field = new Array(SIZE * SIZE).fill(null);
  for (let c = 0; c < SIZE; c++) field[c] = 'kyuri'; // 1行目をすべて埋める
  field[2] = 'rock'; // 岩も「埋まっている」として列に数えるが、植えたマスには数えない
  field[SIZE] = 'seed';
  const score = scoreField(field, [0, SIZE, 20]);
  assert.equal(score.planted, 6);
  assert.equal(score.lines, 1);
  assert.equal(score.soil, 2);
  assert.equal(score.total, 6 + LINE_POINTS + 2 * SOIL_POINTS);
});

test('hatake: 全員が決めるまで置いた場所は見えず、そろうと同時に植わる', async () => {
  const { SIZE, SEEDS, placements } = await import('../shared/games/hatake.js');
  const game = GAMES.hatake;
  const rng = mulberry32(31);
  const state = game.setup({ n: 2, rng });
  const shape = state.deck[0];
  const spots = placements(state.fields[0], shape);
  assert.ok(spots.length > 0);

  game.act(state, 0, { type: 'plant', cells: spots[0] }, rng);
  assert.ok(state.fields[0].every((v) => v === null || v === 'rock'), 'まだ植わっていない');
  assert.deepEqual(game.view(state, 0).myChoice, { kind: 'plant', cells: spots[0] });
  assert.equal(game.view(state, 1).myChoice, null);
  assert.equal(JSON.stringify(game.view(state, 1)).includes('"choice"'), false);
  assert.deepEqual(game.view(state, 1).submitted, [true, false]);

  // 形のちがう置き方、重なる置き方、岩の上は拒否される。
  assert.throws(() => game.act(state, 1, { type: 'plant', cells: [0, 7, 14] }, rng), GameError);
  assert.throws(() => game.act(state, 1, { type: 'plant', cells: [spots[0][0], spots[0][0]] }, rng), GameError);
  assert.throws(() => game.act(state, 1, { type: 'seed', cell: state.rocks[0] }, rng), GameError);

  const free = state.fields[1].findIndex((v) => v === null);
  game.act(state, 1, { type: 'seed', cell: free }, rng);
  assert.equal(state.round, 2);
  for (const cell of spots[0]) assert.equal(state.fields[0][cell], shape);
  assert.equal(state.fields[1][free], 'seed');
  assert.equal(state.seeds[1], SEEDS - 1);
  assert.deepEqual(state.last[1], [free]);

  // ひとつぶだねは使い切ったらもう使えない。見送りはいつでもできる。
  state.seeds[1] = 0;
  const another = state.fields[1].findIndex((v) => v === null);
  assert.throws(() => game.act(state, 1, { type: 'seed', cell: another }, rng), GameError);
  game.act(state, 1, { type: 'skip' }, rng);
  assert.deepEqual(game.view(state, 1).myChoice, { kind: 'skip' });
  assert.equal(SIZE, 6);
});

test('hatake: 1人でも最後まで遊べて、称号がつく', () => {
  const game = GAMES.hatake;
  const rng = mulberry32(32);
  const state = game.setup({ n: 1, rng });
  while (!state.over) game.act(state, 0, game.bot(state, 0, rng), rng);
  assert.equal(state.result.scores.length, 1);
  assert.match(state.result.headline, /^\d+点 — /);
});
