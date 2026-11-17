// おばけ神経衰弱のルールを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../shared/games/obake.js';
import { GameError } from '../shared/games/common.js';
import { mulberry32 } from '../shared/rng.js';

/** カードの並びを自分で決めた場を作る。席0 から始まる。 */
function table(faces, n = 2) {
  const state = game.setup({ n, rng: mulberry32(1) });
  state.cards = faces.map((face) => ({ face, state: 'down', owner: -1 }));
  state.turn = 0;
  return state;
}
const flip = (state, seat, card, rng) => game.act(state, seat, { type: 'flip', card }, rng);

test('obake: そろえばもらえてもう一度、はずれは少し見せてから裏に戻して次の人', () => {
  const rng = mulberry32(2);
  const state = table(['ringo', 'lemon', 'ringo', 'lemon', 'kanmuri', 'kanmuri']);

  flip(state, 0, 0, rng);
  assert.equal(game.view(state, 1).cards[0].face, 'ringo', 'めくったカードは全員に見える');
  assert.equal(game.view(state, 1).cards[1].face, null, '裏のカードの絵は送らない');
  assert.throws(() => flip(state, 0, 0, rng), GameError, '表のカードはめくれない');
  assert.throws(() => flip(state, 1, 1, rng), GameError, '番ではない');

  flip(state, 0, 2, rng);
  assert.equal(state.cards[0].state, 'gone');
  assert.equal(state.cards[2].owner, 0);
  assert.equal(state.points[0], 1);
  assert.deepEqual(game.pending(state), [0], 'そろえたら、もう一度めくれる');

  flip(state, 0, 1, rng);
  flip(state, 0, 4, rng); // はずれ
  assert.equal(state.phase, 'miss');
  assert.deepEqual(game.pending(state), [], '見せているあいだは、だれも動けない');
  assert.equal(game.timer(state).ms, game.MISS_MS);
  assert.equal(game.view(state, 1).cards[4].face, 'kanmuri');
  game.tick(state, rng);
  assert.equal(state.cards[1].state, 'down');
  assert.equal(state.cards[4].state, 'down');
  assert.equal(state.turn, 1);
  assert.equal(game.timer(state), null);

  flip(state, 1, 4, rng);
  flip(state, 1, 5, rng);
  assert.equal(state.points[1], game.GOLD_POINTS, '👑 のペアは3点');
});

test('obake: おばけをめくると番が終わり、裏のカードを入れかえる。2回で帰っていく', () => {
  const rng = mulberry32(3);
  const faces = ['obake:a', 'ringo', 'lemon', 'budo', 'ringo', 'lemon', 'budo', 'momo', 'momo'];
  const state = table(faces);

  flip(state, 0, 1, rng);
  flip(state, 0, 0, rng); // 2枚目がおばけ
  assert.equal(state.phase, 'ghost');
  assert.equal(game.view(state, 1).cards[0].face, 'obake', '画面には「おばけ」とだけ見せる');
  assert.equal(game.timer(state).ms, game.GHOST_MS);
  game.tick(state, rng);

  assert.equal(state.turn, 1, '番はここまで');
  assert.equal(state.event.type, 'shuffle');
  assert.equal(state.event.left, false);
  const cells = state.event.cells;
  assert.equal(cells.length, 3);
  assert.equal(cells[0], 0);
  // 動いたのはこの3枚だけで、3枚とも元の場所には残っていない。
  state.cards.forEach((card, i) => {
    assert.equal(card.state, 'down');
    if (cells.includes(i)) assert.notEqual(card.face, faces[i], `${i} 番目は入れかわっている`);
    else assert.equal(card.face, faces[i]);
  });
  assert.deepEqual(state.cards.map((c) => c.face).sort(), faces.slice().sort(), 'カードの中身は増えも減りもしない');

  // 2回目のいたずらで、おばけは帰っていく。
  const where = state.cards.findIndex((c) => c.face === 'obake:a');
  flip(state, 1, where, rng);
  game.tick(state, rng);
  assert.equal(state.cards[where].state, 'gone');
  assert.equal(state.event.left, true);
  assert.equal(state.event.cells.length, 2, '帰るときは2枚を入れかえていく');
  assert.equal(state.turn, 0);
});

test('obake: 🔍 をとると1枚のぞけて、中身は本人にしか見えない', () => {
  const rng = mulberry32(4);
  const state = table(['megane', 'megane', 'ringo', 'lemon', 'ringo', 'lemon']);
  flip(state, 0, 0, rng);
  flip(state, 0, 1, rng);
  assert.equal(state.phase, 'peek');
  assert.throws(() => flip(state, 0, 2, rng), GameError, '先にのぞくカードを選ぶ');

  game.act(state, 0, { type: 'peek', card: 3 }, rng);
  assert.equal(game.view(state, 0).cards[3].face, 'lemon');
  assert.equal(game.view(state, 1).cards[3].face, null, 'ほかの人には見えない');
  assert.equal(game.view(state, 1).peekCard, 3, 'どのカードをのぞいたかは全員にわかる');
  assert.equal(state.cards[3].state, 'down');
  assert.deepEqual(game.pending(state), [0], 'のぞいたあとも自分の番が続く');

  flip(state, 0, 2, rng);
  assert.equal(game.view(state, 0).cards[3].face, null, '次にめくると、のぞき見は終わる');
});

test('obake: ペアがなくなったら終了。おばけが残っていても終わる', () => {
  const rng = mulberry32(5);
  const state = table(['ringo', 'ringo', 'obake:a', 'obake:b']);
  flip(state, 0, 0, rng);
  flip(state, 0, 1, rng);
  assert.equal(state.over, true);
  assert.deepEqual(state.result.winners, [0]);
  assert.equal(game.view(state, 1).cards[2].face, null, '残ったカードの中身は最後まで伏せたまま');
});
