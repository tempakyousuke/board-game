// はたけパズルの盤面。

import { html, useState, useEffect, useMemo, cx } from '../lib.js';
import { SHAPES, SEED, SIZE, ROUNDS, SEEDS, LINE_POINTS, SOIL_POINTS, transform } from '/shared/games/hatake.js';
import { Avatar, paletteOf } from '../ui.js';

const emojiOf = (value) => (value === 'seed' ? SEED.emoji : SHAPES[value]?.emoji);

/** たねの形を小さな図で見せる。 */
function ShapeIcon({ id, rot = 0, flip = false, size = 'md' }) {
  const cells = transform(SHAPES[id].cells, rot, flip);
  const rows = Math.max(...cells.map(([r]) => r)) + 1;
  const cols = Math.max(...cells.map(([, c]) => c)) + 1;
  const filled = new Set(cells.map(([r, c]) => r * cols + c));
  return html`
    <span class=${cx('hk-shape', `hk-shape-${size}`)} style=${`--cols:${cols}`} role="img" aria-label=${SHAPES[id].name}>
      ${Array.from({ length: rows * cols }, (_, i) => html`<i key=${i} class=${filled.has(i) ? 'on' : ''}>${filled.has(i) ? SHAPES[id].emoji : ''}</i>`)}
    </span>
  `;
}

/** そろった行と列に入っているマス。 */
function fullLines(field) {
  const cells = new Set();
  for (let i = 0; i < SIZE; i++) {
    const row = Array.from({ length: SIZE }, (_, j) => i * SIZE + j);
    const col = Array.from({ length: SIZE }, (_, j) => j * SIZE + i);
    if (row.every((c) => field[c])) row.forEach((c) => cells.add(c));
    if (col.every((c) => field[c])) col.forEach((c) => cells.add(c));
  }
  return cells;
}

function MiniField({ player, field, score, done }) {
  return html`
    <div class="hk-mini" style=${`--c:${paletteOf(player).color}`}>
      <div class="bt-mini-head">
        <${Avatar} player=${player} size="xs" />
        <span class="bt-mini-name">${player.name}</span>
        <b>${score}</b>
      </div>
      <div class="hk-mini-grid">
        ${field.map((v, i) => html`<i key=${i} class=${v === 'rock' ? 'is-rock' : v ? `is-on hk-${v}` : ''}></i>`)}
      </div>
      ${done !== null && html`<span class="bt-mini-state">${done ? '✅' : '🤔'}</span>`}
    </div>
  `;
}

function Board({ view, seat, players, act }) {
  const playing = seat >= 0 && !view.over;
  const [rot, setRot] = useState(0);
  const [flip, setFlip] = useState(false);
  const [tapped, setTapped] = useState(null);
  const [seedMode, setSeedMode] = useState(false);

  useEffect(() => {
    setRot(0);
    setFlip(false);
    setTapped(null);
    setSeedMode(false);
  }, [view.round, view.over]);

  const field = seat >= 0 ? view.fields[seat] : null;
  const mine = view.myChoice;
  const shape = view.shape;
  const canSeed = playing && view.seeds[seat] > 0;

  // タップしたマスに形の左上がくるように置く。はみ出すときは内側へずらす。
  const ghost = useMemo(() => {
    if (!playing || tapped === null) return null;
    if (seedMode) return { cells: [tapped], valid: field[tapped] === null };
    const cells = transform(SHAPES[shape].cells, rot, flip);
    const height = Math.max(...cells.map(([r]) => r)) + 1;
    const width = Math.max(...cells.map(([, c]) => c)) + 1;
    const r0 = Math.min(Math.max(Math.floor(tapped / SIZE), 0), SIZE - height);
    const c0 = Math.min(Math.max((tapped % SIZE) - cells[0][1], 0), SIZE - width);
    const abs = cells.map(([r, c]) => (r0 + r) * SIZE + c0 + c);
    return { cells: abs, valid: abs.every((cell) => field[cell] === null) };
  }, [playing, tapped, seedMode, rot, flip, shape, field]);

  const chosen = !ghost && mine ? (mine.kind === 'plant' ? mine.cells : mine.kind === 'seed' ? [mine.cell] : []) : [];
  const preview = new Set(ghost ? ghost.cells : chosen);
  const previewEmoji = ghost ? (seedMode ? SEED.emoji : SHAPES[shape].emoji) : mine?.kind === 'seed' ? SEED.emoji : shape ? SHAPES[shape].emoji : '';
  const lines = field ? fullLines(field) : new Set();
  const fresh = new Set(seat >= 0 ? view.last[seat] : []);
  const waitingFor = view.submitted.filter((d) => !d).length;
  const parts = seat >= 0 ? view.parts[seat] : null;

  const confirm = () => {
    if (!ghost?.valid) return;
    act(seedMode ? { type: 'seed', cell: ghost.cells[0] } : { type: 'plant', cells: ghost.cells });
    setTapped(null);
  };

  let status;
  if (view.over) status = '収穫のときです！';
  else if (seat < 0) status = `あと ${waitingFor} 人が植える場所を考えています`;
  else if (mine && !ghost) {
    const what = mine.kind === 'skip' ? '見送りました' : '植えました';
    status = waitingFor > 0 ? `${what}。あと ${waitingFor} 人を待っています…（変更できます）` : what;
  } else if (!ghost) status = seedMode ? 'ひとつぶだねを植えるマスをタップしてください' : '植えたい場所をタップしてください';
  else if (!ghost.valid) status = 'そこには植えられません。向きや場所を変えてみましょう';
  else status = 'ここでよければ「植える」を押してください';

  const others = players.map((_, s) => s).filter((s) => s !== seat);

  return html`
    <div class="game hatake">
      <div class="hk-table">
        ${others.length > 0 &&
        html`
          <div class="bt-others">
            ${others.map(
              (s) => html`
                <${MiniField} key=${s} player=${players[s]} field=${view.fields[s]} score=${view.scores[s]} done=${view.over ? null : view.submitted[s]} />
              `,
            )}
          </div>
        `}

        ${field &&
        html`
          <div class="board hk-board" style=${`--n:${SIZE}`}>
            ${field.map((value, i) => {
              const inPreview = preview.has(i);
              return html`
                <button
                  key=${i}
                  class=${cx(
                    'cell hk-cell',
                    value === 'rock' && 'is-rock',
                    value && value !== 'rock' && `is-planted hk-${value}`,
                    view.soils.includes(i) && 'is-soil',
                    playing && value === null && 'is-open',
                    inPreview && (ghost ? (ghost.valid ? 'is-ghost' : 'is-bad') : 'is-chosen'),
                    lines.has(i) && 'is-line',
                    fresh.has(i) && 'is-fresh',
                  )}
                  disabled=${!playing || value === 'rock'}
                  onClick=${() => setTapped(i)}
                  aria-label=${`${Math.floor(i / SIZE) + 1}行${(i % SIZE) + 1}列`}
                >
                  ${value === 'rock' ? '🪨' : value ? emojiOf(value) : inPreview ? html`<span class="hk-ghost">${previewEmoji}</span>` : view.soils.includes(i) ? html`<span class="hk-soil">✨</span>` : ''}
                </button>
              `;
            })}
          </div>
        `}
      </div>

      <div class="panel">
        <p class=${cx('status', playing && (!mine || ghost) && 'is-mine')}>${status}</p>

        ${playing &&
        html`
          <div class="hk-tools">
            <div class=${cx('hk-current', seedMode && 'is-off')}>
              <small>今回のたね</small>
              <${ShapeIcon} id=${shape} rot=${rot} flip=${flip} size="lg" />
              <b>${SHAPES[shape].name}</b>
            </div>
            <div class="hk-buttons">
              <button class="btn btn-small" disabled=${seedMode} onClick=${() => setRot((rot + 1) % 4)} aria-label="まわす">⟳ まわす</button>
              <button class="btn btn-small" disabled=${seedMode} onClick=${() => setFlip(!flip)} aria-label="うらがえす">⇄ うらがえす</button>
              <button
                class=${cx('btn btn-small', seedMode && 'is-toggled')}
                disabled=${!canSeed}
                onClick=${() => {
                  setSeedMode(!seedMode);
                  setTapped(null);
                }}
                aria-pressed=${seedMode}
              >
                ${SEED.emoji} ひとつぶだね（のこり ${view.seeds[seat]}）
              </button>
            </div>
          </div>
          <div class="row">
            <button class="btn btn-primary" disabled=${!ghost?.valid} onClick=${confirm}>${mine ? '植え直す' : '植える'}</button>
            <button class="btn hk-skip" disabled=${mine?.kind === 'skip' && !ghost} onClick=${() => { act({ type: 'skip' }); setTapped(null); }}>見送る</button>
          </div>
          ${view.next && html`<p class="hk-next muted">つぎのたね：<${ShapeIcon} id=${view.next} size="sm" /> ${SHAPES[view.next].name}</p>`}
        `}

        ${parts &&
        html`
          <p class="hk-score">
            植えたマス <b>${parts.planted}</b> ＋ そろった列 <b>${parts.lines}</b>×${LINE_POINTS} ＋ ✨ <b>${parts.soil}</b>×${SOIL_POINTS} ＝ <strong>${parts.total}点</strong>
          </p>
        `}
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        全員が同じ畑を持ち、同じ形のたねを、同じ順番で受け取ります。ちがうのは植え方だけ。すき間なく、列がそろうように植えていくパズルです。1人でも遊べます。
      </p>
      <h3>進め方</h3>
      <ul>
        <li>毎ラウンド、<b>たねのふくろ</b>が1つめくられます。ふくろごとに形が決まっています。</li>
        <li>全員が同時に、その形を自分の畑の<b>空いているマス</b>に植えます。<b>まわしたり、うらがえしたり</b>してかまいません。岩 🪨 のマスには植えられません。</li>
        <li>植えられないとき、植えたくないときは<b>見送る</b>ことができます。</li>
        <li>ゲーム中に ${SEEDS} 回だけ、ふくろのかわりに <b>${SEED.emoji} ひとつぶだね</b>を使って、好きな1マスに植えられます。</li>
        <li>ほかの人がどこに植えたかは、全員が決め終わるまで見えません。</li>
      </ul>
      <h3>得点</h3>
      <ul>
        <li>植えたマス1つにつき <b>1点</b>。</li>
        <li>たて・よこの列がすべて埋まるごとに <b>${LINE_POINTS}点</b>（岩も埋まっているものとして数えます）。</li>
        <li>✨ ふかふかの土のマスに植えると <b>${SOIL_POINTS}点</b>。</li>
      </ul>
      <h3>終了</h3>
      <p><b>${ROUNDS}ラウンド</b>で終了。点数が高い人の勝ちです。ふくろは全部で15あり、そのうち10が出ます。</p>
      <h3>コツ</h3>
      <ul>
        <li>1マスだけぽつんと残ると、ひとつぶだねでしか埋まりません。すき間の形に気をつけましょう。</li>
        <li>終わりが近づくと、大きな形はもう入りません。大きい形のための場所を先に残しておくのがコツです。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.scores,
  unit: '点',
  progress: (view) => `ラウンド ${Math.min(view.round, view.maxRounds)} / ${view.maxRounds}`,
  waiting: (view) => !view.over,
  extra: (view, s) => (view.seeds[s] > 0 ? `${SEED.emoji}×${view.seeds[s]}` : ''),
};
