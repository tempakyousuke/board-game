// つめつめ弁当の盤面。

import { html, useState, useEffect, useMemo, cx } from '../lib.js';
import { FOODS, FOOD_IDS, HAND_SIZE, scoreAll } from '/shared/games/bento.js';
import { Avatar, paletteOf } from '../ui.js';
import { play, useChanged } from '../sound.js';

function Food({ id }) {
  return html`<span class=${cx('food', `food-${id}`)} role="img" aria-label=${FOODS[id].name}>${FOODS[id].emoji}</span>`;
}

function MiniBox({ player, box, score, fresh, done }) {
  return html`
    <div class="bt-mini" style=${`--c:${paletteOf(player).color}`}>
      <div class="bt-mini-head">
        <${Avatar} player=${player} size="xs" />
        <span class="bt-mini-name">${player.name}</span>
        <b>${score}</b>
      </div>
      <div class="bt-mini-grid">
        ${box.map(
          (food, i) => html`<span key=${i} class=${cx('bt-mini-cell', fresh === i && 'is-fresh')}>${food && FOODS[food].emoji}</span>`,
        )}
      </div>
      ${done !== null && html`<span class="bt-mini-state">${done ? '✅' : '🤔'}</span>`}
    </div>
  `;
}

function Board({ view, seat, players, act }) {
  const playing = seat >= 0 && !view.over;
  const [tile, setTile] = useState(null);
  const [cell, setCell] = useState(null);
  const [showTable, setShowTable] = useState(false);

  // 手札がまわってきたら選び直し。
  useEffect(() => {
    setTile(null);
    setCell(null);
  }, [view.turn, view.over]);

  // 全員がつめ終わって、おかずが箱に入ったとき。
  useChanged(`${view.turn}:${view.over}`, () => play('place'));

  const mine = view.myChoice;
  const box = seat >= 0 ? view.boxes[seat] : null;
  const pickTile = tile ?? mine?.tile ?? null;
  const pickCell = cell ?? mine?.cell ?? null;
  const ready = playing && pickTile !== null && pickCell !== null;
  const dirty = ready && (!mine || mine.tile !== pickTile || mine.cell !== pickCell);
  const ghostFood = playing && pickTile !== null ? view.hand[pickTile] : null;

  // 置いたら何点ふえるか (からあげの順位は全員の箱で決まるので、全体を計算し直す)。
  const gain = useMemo(() => {
    if (!ready || !ghostFood) return null;
    const boxes = view.boxes.map((b) => b.slice());
    boxes[seat][pickCell] = ghostFood;
    return scoreAll(boxes)[seat].total - view.scores[seat];
  }, [ready, ghostFood, pickCell, view.boxes]);

  const freshBySeat = Object.fromEntries(view.last.map((l) => [l.seat, l.cell]));
  const waitingFor = view.submitted.filter((d) => !d).length;
  const nextSeat = seat >= 0 ? (seat + 1) % view.n : -1;
  const focusFood = ghostFood ?? null;

  let status;
  if (view.over) status = 'お弁当ができあがりました！';
  else if (seat < 0) status = `あと ${waitingFor} 人がおかずを選んでいます`;
  else if (mine && !dirty) status = waitingFor > 0 ? `つめました。あと ${waitingFor} 人を待っています…` : '全員そろいました';
  else if (pickTile === null) status = '手札からおかずを1つ選んでください';
  else if (pickCell === null) status = 'お弁当箱の空いているマスを選んでください';
  else status = mine ? '変えるなら「つめ直す」を押してください' : 'よければ「つめる」を押してください';

  const others = players.map((_, s) => s).filter((s) => s !== seat);

  return html`
    <div class="game bento">
      <div class="bt-table">
        <div class="bt-others">
          ${others.map(
            (s) => html`
              <${MiniBox}
                key=${s}
                player=${players[s]}
                box=${view.boxes[s]}
                score=${view.scores[s]}
                fresh=${freshBySeat[s]}
                done=${view.over ? null : view.submitted[s]}
              />
            `,
          )}
        </div>

        ${box &&
        html`
          <div class="bt-mine" style=${`--c:${paletteOf(players[seat]).color}`}>
            <div class="bt-box">
              ${box.map((food, i) => {
                const ghost = !food && pickCell === i && ghostFood;
                return html`
                  <button
                    key=${i}
                    class=${cx('bt-cell', !food && playing && 'is-open', ghost && 'is-ghost', freshBySeat[seat] === i && 'is-fresh')}
                    disabled=${!playing || !!food}
                    onClick=${() => setCell(i)}
                    aria-label=${`${Math.floor(i / 3) + 1}段目の${(i % 3) + 1}番目${food ? ` ${FOODS[food].name}` : ' 空き'}`}
                  >
                    ${food && html`<${Food} id=${food} />`}
                    ${ghost && html`<${Food} id=${ghost} />`}
                  </button>
                `;
              })}
            </div>
            <div class="bt-parts">
              ${FOOD_IDS.filter((id) => box.includes(id)).map(
                (id) => html`
                  <span key=${id} class=${cx('bt-part', view.parts[seat][id] < 0 && 'is-bad')}>
                    ${FOODS[id].emoji} <b>${view.parts[seat][id]}</b>
                  </span>
                `,
              )}
              ${!box.some(Boolean) && html`<span class="muted">おかずをつめると、ここに点数が出ます</span>`}
            </div>
          </div>
        `}
      </div>

      <div class="panel">
        <p class=${cx('status', playing && (!mine || dirty) && 'is-mine')}>${status}</p>

        ${playing &&
        html`
          <div class="bt-hand" role="listbox" aria-label="手札">
            ${view.hand.map(
              (food, i) => html`
                <button
                  key=${`${view.turn}-${i}`}
                  class=${cx('bt-tile', pickTile === i && 'is-on')}
                  onClick=${() => setTile(i)}
                  role="option"
                  aria-selected=${pickTile === i}
                >
                  <${Food} id=${food} />
                  <small>${FOODS[food].name}</small>
                </button>
              `,
            )}
          </div>
          ${focusFood
            ? html`<p class="bt-rule">
                <b>${FOODS[focusFood].emoji} ${FOODS[focusFood].name}</b> ${FOODS[focusFood].rule}
                ${gain !== null && html`<span class=${cx('bt-gain', gain < 0 && 'is-bad')}>ここに置くと ${gain >= 0 ? `+${gain}` : gain}点</span>`}
              </p>`
            : html`<p class="bt-rule muted">おかずを選ぶと、点の入り方がここに出ます</p>`}
          <button
            class="btn btn-primary btn-block"
            disabled=${!dirty}
            onClick=${() => act({ type: 'pack', tile: pickTile, cell: pickCell })}
          >
            ${mine ? 'つめ直す' : 'つめる'}
          </button>
          <p class="muted bt-pass">
            ${view.turn} / ${view.maxTurns} 個目。のこりの手札は ${players[nextSeat]?.name ?? '?'} さんにまわります。
          </p>
        `}

        <button class="link-btn" onClick=${() => setShowTable(!showTable)}>
          ${showTable ? '点数表をとじる' : 'おかずの点数表を見る'}
        </button>
        ${showTable && html`<${FoodTable} />`}
      </div>
    </div>
  `;
}

function FoodTable() {
  return html`
    <ul class="bt-foods">
      ${FOOD_IDS.map(
        (id) => html`
          <li key=${id}>
            <${Food} id=${id} />
            <span><b>${FOODS[id].name}</b>${FOODS[id].rule}</span>
          </li>
        `,
      )}
    </ul>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        まわってくる手札からおかずを1つずつ選んで、3×3 のお弁当箱につめていきます。何を取るか、どこに置くか。となりの人に何をまわすかも大事です。
      </p>
      <h3>進め方</h3>
      <ol>
        <li>全員に手札が ${HAND_SIZE} 枚配られます。</li>
        <li>全員が同時に、手札からおかずを<b>1つ</b>選び、自分のお弁当箱の<b>空いているマス</b>につめます。</li>
        <li>残った手札を、そのまま<b>となりの人にまわします</b>。</li>
        <li>これを 9 回くり返すと、お弁当箱がいっぱいになって終了です。</li>
      </ol>
      <h3>おかずの点数</h3>
      <p>「となり」は、たて・よこにくっついているマスのことです。</p>
      <${FoodTable} />
      <h3>勝敗</h3>
      <p>お弁当箱がいっぱいになったら点を数えて、合計がいちばん高い人の勝ちです。</p>
      <h3>コツ</h3>
      <ul>
        <li>まんなかは4方向にとなりがある、いちばん大事なマス。うめぼしが来なければ、おにぎりやブロッコリーが活きます。</li>
        <li>手札は最後に2枚しか残りません。みんなが避けたピーマンを押しつけられないよう、先を読みましょう。</li>
        <li>ほかの人のお弁当箱はいつでも見えます。次の人がほしがっているおかずを、あえて取ってしまうのも作戦です。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.scores,
  unit: '点',
  progress: (view) => `${Math.min(view.turn, view.maxTurns)} / ${view.maxTurns} 個目`,
  waiting: (view) => !view.over,
  turnSound: false,
  extra: (view, s) => (view.karaage[s] > 0 ? `🍗×${view.karaage[s]}` : ''),
};
