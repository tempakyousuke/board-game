// トウダイの盤面。

import { html, useState, useMemo, useEffect, cx } from '../lib.js';
import { lightMap, beams } from '/shared/games/toudai.js';
import { Avatar, paletteOf } from '../ui.js';

const KIND_LABEL = { plus: '＋型', cross: '×型' };

function Tower({ kind, color }) {
  return html`
    <svg class="tower" viewBox="0 0 100 100" aria-hidden="true">
      <g transform=${kind === 'cross' ? 'rotate(45 50 50)' : undefined} fill=${color}>
        <rect x="42" y="4" width="16" height="92" rx="8" />
        <rect x="4" y="42" width="92" height="16" rx="8" />
      </g>
      <circle cx="50" cy="50" r="26" fill=${color} stroke="#fff" stroke-width="7" />
      <circle cx="50" cy="50" r="9" fill="#fff" />
    </svg>
  `;
}

function Board({ view, seat, players, act }) {
  const { size, n } = view;
  const [sel, setSel] = useState(null);
  const [kind, setKind] = useState('plus');
  const colorOf = (s) => paletteOf(players[s]).color;

  const stock = seat >= 0 ? view.stock[seat] : null;
  const inFinal = view.phase === 'final' && !view.over;
  const myTurn = seat >= 0 && !view.over && (inFinal || view.turn === seat);
  const usableKind = stock && stock[kind] > 0 ? kind : stock && stock.plus > 0 ? 'plus' : 'cross';
  const towerCount = useMemo(() => view.cells.filter((c) => c && c !== 'rock').length, [view.cells]);

  useEffect(() => setSel(null), [towerCount, view.phase, view.turn]);

  // 「置いたらこうなる」の仮置き。同時に置くラスト1基は、決定後も自分にだけ見せる。
  const submitted = inFinal ? view.myChoice : null;
  const ghost = myTurn && sel !== null ? { cell: sel, kind: usableKind } : submitted;
  const preview = useMemo(() => {
    if (!ghost || seat < 0) return null;
    const cells = view.cells.slice();
    cells[ghost.cell] = { o: seat, k: ghost.kind };
    return { cells, ...lightMap(size, cells, n) };
  }, [ghost?.cell, ghost?.kind, view.cells, seat]);

  const cells = preview ? preview.cells : view.cells;
  const owner = preview ? preview.owner : view.owner;
  const scores = preview ? preview.scores : view.scores;
  const rays = useMemo(() => beams(size, cells), [cells]);
  const clashed = new Set((view.finalReveal ?? []).filter((r) => !r.ok).map((r) => r.cell));

  const confirm = () => {
    if (sel === null) return;
    act({ type: 'place', cell: sel, kind: usableKind });
    if (inFinal) setSel(null);
  };

  let status;
  if (view.over) status = '全員が建て終わりました';
  else if (inFinal) {
    status = seat < 0 ? 'ラスト1基を全員が同時に選んでいます' : submitted ? '決定しました。ほかの人を待っています…' : 'ラスト1基！建てるマスを選んでください';
  } else if (view.turn === seat) status = sel === null ? 'あなたの番です。建てるマスを選んでください' : 'ここでよければ「建てる」を押してください';
  else status = `${players[view.turn]?.name ?? '?'} さんの番です`;

  return html`
    <div class="game toudai">
      ${inFinal &&
      html`<div class="banner banner-final">
        <b>🏁 ラスト1基は全員同時！</b>
        ほかの人と同じマスを選ぶと、どちらも建てられません。
      </div>`}

      <div class="board toudai-board" style=${`--n:${size}`}>
        ${cells.map((cell, i) => {
          const own = owner[i];
          const isGhost = ghost && ghost.cell === i;
          const changed = preview && cell === null && own !== view.owner[i];
          const selectable = myTurn && view.cells[i] === null;
          return html`
            <button
              key=${i}
              class=${cx(
                'cell sea',
                cell === 'rock' && 'is-rock',
                cell === null && own >= 0 && 'is-lit',
                changed && 'is-changed',
                isGhost && 'is-ghost',
                view.last.includes(i) && 'is-last',
                selectable && 'is-open',
              )}
              style=${own >= 0 && cell === null ? `--c:${colorOf(own)}` : undefined}
              disabled=${!selectable}
              onClick=${() => setSel(i)}
              aria-label=${`${Math.floor(i / size) + 1}行${(i % size) + 1}列`}
            >
              ${cell === 'rock' && html`<span class="rock">🪨</span>`}
              ${cell && cell !== 'rock' && html`<${Tower} kind=${cell.k} color=${colorOf(cell.o)} />`}
              ${clashed.has(i) && html`<span class="clash-mark">💥</span>`}
            </button>
          `;
        })}
        <svg class="toudai-beams" viewBox=${`0 0 ${size} ${size}`} aria-hidden="true">
          ${rays.map(
            (b, i) => html`<line
              key=${i}
              x1=${b.c1 + 0.5}
              y1=${b.r1 + 0.5}
              x2=${b.c2 + 0.5}
              y2=${b.r2 + 0.5}
              stroke=${colorOf(b.o)}
            />`,
          )}
        </svg>
      </div>

      <div class="panel">
        <p class=${cx('status', myTurn && !submitted && 'is-mine')}>${status}</p>

        ${myTurn &&
        html`
          <div class="row">
            ${['plus', 'cross'].map(
              (k) => html`
                <button
                  key=${k}
                  class=${cx('choice', usableKind === k && 'is-on')}
                  disabled=${stock[k] === 0}
                  onClick=${() => setKind(k)}
                >
                  <span class="choice-icon"><${Tower} kind=${k} color=${colorOf(seat)} /></span>
                  <span>
                    <b>${KIND_LABEL[k]}</b>
                    <small>${k === 'plus' ? 'たて・よこ' : 'ななめ'}／のこり ${stock[k]}</small>
                  </span>
                </button>
              `,
            )}
          </div>
          <button class="btn btn-primary btn-block" disabled=${sel === null} onClick=${confirm}>
            ${sel === null ? 'マスを選んでください' : submitted ? 'この場所に変更する' : `${KIND_LABEL[usableKind]}をここに建てる`}
          </button>
        `}

        ${preview &&
        html`
          <div class="preview-scores">
            <span class="preview-label">${submitted && sel === null ? '建てられた場合' : '建てると'}</span>
            ${scores.map((score, s) => {
              const diff = score - view.scores[s];
              return html`
                <span key=${s} class="preview-score">
                  <${Avatar} player=${players[s]} size="xs" />
                  <b>${score}</b>
                  ${diff !== 0 && html`<i class=${diff > 0 ? 'up' : 'down'}>${diff > 0 ? `+${diff}` : diff}</i>`}
                </span>
              `;
            })}
          </div>
        `}

        ${!view.over &&
        view.upcoming.length > 0 &&
        html`
          <div class="upcoming">
            <span>このあとの順番</span>
            ${view.upcoming.map((s, i) => html`<${Avatar} key=${i} player=${players[s]} size="xs" />`)}
            <span>…</span>
          </div>
        `}

        ${view.over &&
        view.finalReveal &&
        html`
          <div class="reveal-list">
            <b>ラスト1基の結果</b>
            ${view.finalReveal.map(
              (r) => html`
                <span key=${r.seat} class="reveal-item">
                  <${Avatar} player=${players[r.seat]} size="xs" />
                  ${r.ok ? `${KIND_LABEL[r.kind]}を建てた` : '💥 かぶって建てられず'}
                </span>
              `,
            )}
          </div>
        `}
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        灯台を建てて、光で海を照らす陣取りゲーム。サイコロもカードも使わないので、勝負を決めるのは読みと駆け引きだけです。
      </p>
      <h3>準備</h3>
      <ul>
        <li>海の広さは 2人なら 7×7、3人なら 8×8、4人なら 9×9。岩がいくつか置かれます。</li>
        <li>各プレイヤーは灯台を <b>8基</b>（＋型 5基・×型 3基）持ちます。</li>
      </ul>
      <h3>自分の番</h3>
      <ul>
        <li>空いている海のマスに、灯台を1基建てます。</li>
        <li><b>＋型</b>はたて・よこ、<b>×型</b>はななめの4方向を照らします。</li>
        <li>光は、岩かほかの灯台にぶつかるまでまっすぐ進みます（自分の灯台でも止まります）。</li>
      </ul>
      <h3>マスの取り合い</h3>
      <ul>
        <li>海のマスは、<b>いちばん多くの光を当てている人</b>のものになります。</li>
        <li>当てている光の数が同じなら、誰のものでもありません。</li>
      </ul>
      <h3>順番とラスト1基</h3>
      <ul>
        <li>順番は1周ごとに折り返します（A→B→C→C→B→A→A→…）。端の人は2回続けて建てます。</li>
        <li>
          <b>最後の1基だけは、全員が同時に</b>こっそり場所を決めます。ほかの人と同じマスを選ぶと、どちらも建てられません。
        </li>
      </ul>
      <h3>勝敗</h3>
      <p>全員が建て終えたとき、自分の色のマスが最も多い人の勝ちです。</p>
      <h3>コツ</h3>
      <ul>
        <li>相手の光の通り道に灯台を建てると、その先の光をさえぎれます。</li>
        <li>1つのマスを2基で照らしておくと、うばわれにくくなります。</li>
        <li>ラスト1基は、いちばん良いマスほど相手とかぶりやすい。あえて2番目をねらうのも手です。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.scores,
  unit: 'マス',
  progress: (view) => (view.phase === 'final' ? 'ラスト1基' : null),
  waiting: (view) => view.phase === 'final' && !view.over,
  extra: (view, s) => {
    const left = view.stock[s];
    return `＋${left.plus} ×${left.cross}`;
  },
};
