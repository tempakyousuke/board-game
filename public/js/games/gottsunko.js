// ごっつんこ探検隊の盤面。

import { html, useState, useMemo, useEffect, useRef, cx } from '../lib.js';
import { reachable } from '/shared/games/gottsunko.js';
import { Avatar, paletteOf } from '../ui.js';

const FX_MS = 2800;

function Gem({ value, spawned = false }) {
  const tier = value >= 6 ? 5 : value >= 4 ? 4 : value;
  return html`<span class=${cx('gem', `gem-${tier}`, spawned && 'is-new')}><b>${value}</b></span>`;
}

function Board({ view, seat, players, act }) {
  const { size, n } = view;
  const [sel, setSel] = useState(null);
  const [push, setPush] = useState(false);
  const [fx, setFx] = useState(null);
  const seenRound = useRef(view.lastRound?.round ?? 0);

  // ラウンドが解決されたら、しばらくのあいだ結果の演出を出す。
  useEffect(() => {
    const round = view.lastRound?.round ?? 0;
    if (round === seenRound.current) return undefined;
    seenRound.current = round;
    setSel(null);
    setPush(false);
    setFx(view.lastRound);
    const timer = setTimeout(() => setFx(null), FX_MS);
    return () => clearTimeout(timer);
  }, [view.lastRound?.round]);

  const playing = seat >= 0 && !view.over;
  const mine = view.myChoice;
  const options = useMemo(
    () => (playing ? new Set(reachable(size, view.pos[seat])) : new Set()),
    [playing, size, view.pos[seat]],
  );
  const target = sel ?? mine?.to ?? null;
  const wantPush = sel !== null ? push : (mine?.push ?? push);
  const dirty = sel !== null && (!mine || mine.to !== sel || mine.push !== push);
  const waitingFor = view.submitted.filter((done) => !done).length;

  const submit = () => {
    if (sel === null) return;
    act({ type: 'choose', to: sel, push: push && view.push[seat] > 0 });
  };

  const pick = (cell) => {
    if (mine && sel === null) setPush(mine.push);
    setSel(cell);
  };

  // 同じマスに複数人いるときは少しずつずらして描く。
  const stackIndex = view.pos.map((cell, s) => view.pos.slice(0, s).filter((c) => c === cell).length);
  const stackSize = view.pos.map((cell) => view.pos.filter((c) => c === cell).length);
  const moveBySeat = fx ? Object.fromEntries(fx.moves.map((m) => [m.seat, m])) : {};
  const spawnedCells = new Set(fx ? fx.spawned.map((g) => g.cell) : []);
  const clashCells = new Map(fx ? fx.clashes.map((c) => [c.cell, c]) : []);

  let status;
  if (view.over) status = '探検おわり！';
  else if (seat < 0) status = `あと ${waitingFor} 人が行き先を考えています`;
  else if (!mine) status = sel === null ? '行き先を選んでください（光っているマス）' : '「決定」を押すと確定します';
  else if (dirty) status = '行き先を変えるなら「変更する」を押してください';
  else status = waitingFor > 0 ? `決定しました。あと ${waitingFor} 人を待っています…` : '全員そろいました';

  const from = playing ? view.pos[seat] : null;
  const center = (cell) => [(cell % size) + 0.5, Math.floor(cell / size) + 0.5];

  return html`
    <div class="game gottsunko">
      <div class="board gk-board" style=${`--n:${size}`}>
        ${view.gems.map((gem, i) => {
          const open = playing && options.has(i);
          const clash = clashCells.get(i);
          return html`
            <button
              key=${i}
              class=${cx('cell sand', open && 'is-open', target === i && 'is-target', clash && 'is-clash')}
              disabled=${!open}
              onClick=${() => pick(i)}
              aria-label=${`${Math.floor(i / size) + 1}行${(i % size) + 1}列${gem ? ` 宝石${gem}` : ''}`}
            >
              ${gem > 0 && html`<${Gem} value=${gem} spawned=${spawnedCells.has(i)} />`}
              ${clash && html`<span class="clash-mark">💥</span>`}
              ${clash?.grown && html`<span class="grow-mark">+1</span>`}
            </button>
          `;
        })}

        ${target !== null &&
        from !== null &&
        html`
          <svg class="gk-arrow" viewBox=${`0 0 ${size} ${size}`} aria-hidden="true">
            <line
              x1=${center(from)[0]}
              y1=${center(from)[1]}
              x2=${center(target)[0]}
              y2=${center(target)[1]}
              stroke=${paletteOf(players[seat]).color}
            />
          </svg>
        `}

        <div class="gk-pieces">
          ${view.pos.map((cell, s) => {
            const move = moveBySeat[s];
            const r = Math.floor(cell / size);
            const c = cell % size;
            const bounced = move && move.outcome === 'bounce';
            const dx = bounced ? (move.to % size) - c : 0;
            const dy = bounced ? Math.floor(move.to / size) - r : 0;
            const spread = stackSize[s] > 1 ? (stackIndex[s] - (stackSize[s] - 1) / 2) * 26 : 0;
            return html`
              <div
                key=${s}
                class=${cx('gk-piece', bounced && 'is-bounced', s === seat && 'is-me')}
                style=${`left:${(c * 100) / size}%;top:${(r * 100) / size}%;--dx:${dx};--dy:${dy};--spread:${spread}%;--c:${paletteOf(players[s]).color}`}
              >
                <span class="gk-token">${paletteOf(players[s]).emoji}</span>
                ${view.submitted[s] && !view.over && html`<span class="gk-ready">✓</span>`}
                ${move && move.gain > 0 && html`<span class="gk-gain">+${move.gain}</span>`}
                ${move && move.push && html`<span class="gk-push">💪</span>`}
              </div>
            `;
          })}
        </div>
      </div>

      <div class="panel">
        <p class=${cx('status', playing && (!mine || dirty) && 'is-mine')}>${status}</p>

        ${playing &&
        html`
          <div class="row">
            <button
              class=${cx('choice choice-push', wantPush && 'is-on')}
              disabled=${view.push[seat] === 0}
              onClick=${() => {
                if (sel === null && mine) setSel(mine.to);
                setPush(!wantPush);
              }}
              aria-pressed=${wantPush}
            >
              <span class="choice-icon">💪</span>
              <span>
                <b>おしのけ${wantPush ? 'を使う' : ''}</b>
                <small>かぶっても押し勝つ／のこり ${view.push[seat]}</small>
              </span>
            </button>
            <button class="btn btn-primary" disabled=${sel === null || !dirty} onClick=${submit}>
              ${mine ? '変更する' : '決定'}
            </button>
          </div>
        `}

        ${view.lastRound &&
        html`
          <div class="round-log">
            <b>ラウンド ${view.lastRound.round} の結果</b>
            <div class="round-log-items">
              ${view.lastRound.moves.map((m) => {
                let text;
                if (m.outcome === 'bounce') text = m.push ? '💥 おしのけ同士でごっつんこ' : '💥 ごっつんこ';
                else if (m.outcome === 'push') text = `💪 押し勝ち${m.gain ? ` +${m.gain}` : ''}`;
                else text = m.gain ? `+${m.gain}` : '移動';
                return html`
                  <span key=${m.seat} class=${cx('round-log-item', m.outcome === 'bounce' && 'is-bad', m.gain > 0 && 'is-good')}>
                    <${Avatar} player=${players[m.seat]} size="xs" />
                    ${text}
                  </span>
                `;
              })}
            </div>
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
        全員が同時に行き先を決めて、宝石を集めます。同じマスをねらうと「ごっつんこ」。みんなの考えを読んで、すき間をぬいましょう。
      </p>
      <h3>ラウンドの流れ</h3>
      <ol>
        <li>全員がこっそり、行き先のマスを1つ選びます。行けるのは<b>いまいる場所から2歩以内</b>（ななめ1マスは2歩ぶん）。</li>
        <li>全員が決めたら、いっせいに移動します。</li>
      </ol>
      <h3>移動の結果</h3>
      <ul>
        <li><b>そのマスを選んだのが自分だけ</b>なら移動成功。宝石があれば手に入れます（数字が点数）。</li>
        <li>
          <b>2人以上が同じマスを選ぶと「ごっつんこ」</b>。全員がもとの場所にはね返され、そこの宝石は <b>+1</b> 育ちます。
        </li>
      </ul>
      <h3>おしのけ 💪</h3>
      <ul>
        <li>1人 <b>2回まで</b>。行き先と一緒にこっそり使います。</li>
        <li>ごっつんこになったとき、おしのけを使ったのが<b>1人だけ</b>なら、その人が押し勝って宝石を取ります。</li>
        <li>2人以上が使っていたら、やっぱり全員はね返されます。使ったぶんは、どうなっても戻りません。</li>
      </ul>
      <h3>終了</h3>
      <p>毎ラウンド新しい宝石がわいてきます。<b>10ラウンド</b>で終了し、宝石の合計点が高い人の勝ちです。</p>
      <h3>コツ</h3>
      <ul>
        <li>大きな宝石はみんながねらいます。あえて小さい宝石を確実に取るのも立派な作戦。</li>
        <li>ごっつんこで育った宝石は、おしのけの使いどころ。でも相手も同じことを考えているかも…</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.score,
  unit: '点',
  progress: (view) => `ラウンド ${Math.min(view.round, view.maxRounds)} / ${view.maxRounds}`,
  waiting: (view) => !view.over,
  extra: (view, s) => `💪×${view.push[s]}`,
};
