// かくれんぼ忍者の盤面。

import { html, useState, useEffect, useRef, cx } from '../lib.js';
import { neighbors } from '/shared/games/ninja.js';
import { Avatar, paletteOf } from '../ui.js';

const FX_MS = 3200;
const GUARD_NAMES = ['A', 'B', 'C', 'D'];

function Board({ view, seat, players, act }) {
  const { size } = view;
  const [guard, setGuard] = useState(null);
  const [wanted, setTarget] = useState(null);
  const [fx, setFx] = useState(null);
  const seen = useRef(view.event?.id ?? 0);
  const fxTimer = useRef(null);

  // 煙玉やつかまえた瞬間は、しばらく大きく知らせる。
  // (そのあいだにほかの見張りが動いても、表示は消さない)
  useEffect(() => {
    const id = view.event?.id ?? 0;
    if (id === seen.current) return;
    seen.current = id;
    setTarget(null);
    if (view.event.type !== 'smoke' && view.event.type !== 'caught') return;
    setFx(view.event);
    clearTimeout(fxTimer.current);
    fxTimer.current = setTimeout(() => setFx(null), FX_MS);
  }, [view.event?.id]);
  useEffect(() => () => clearTimeout(fxTimer.current), []);

  const isNinja = seat === view.ninjaSeat;
  const playing = seat >= 0 && !view.over;
  const ninjaTurn = playing && isNinja && view.phase === 'ninja';
  const myGuards =
    playing && !isNinja && view.phase === 'guards'
      ? view.guardOwner.map((owner, g) => (owner === seat && !view.moved[g] ? g : -1)).filter((g) => g >= 0)
      : [];
  const active = myGuards.length === 0 ? null : myGuards.includes(guard) ? guard : myGuards.length === 1 ? myGuards[0] : null;
  const myTurn = ninjaTurn || myGuards.length > 0;

  // いま動かせる行き先。
  let options = [];
  if (ninjaTurn) options = [view.ninja, ...neighbors(size, view.ninja)].filter((c) => !view.guards.includes(c));
  else if (active !== null) {
    const from = view.guards[active];
    options = [from, ...neighbors(size, from)].filter((c) => c === from || !view.guards.includes(c));
  }
  const target = wanted !== null && options.includes(wanted) ? wanted : null;
  const possible = new Set(view.over ? [] : view.possible);
  const origin = ninjaTurn ? view.ninja : active !== null ? view.guards[active] : null;

  const pick = (cell) => {
    const mine = view.guards.findIndex((c, g) => c === cell && myGuards.includes(g));
    if (mine >= 0 && mine !== active) {
      setGuard(mine);
      setTarget(null);
      return;
    }
    if (options.includes(cell)) setTarget(cell);
  };

  const confirm = () => {
    if (target === null) return;
    if (ninjaTurn) act({ type: 'sneak', to: target });
    else act({ type: 'patrol', guard: active, to: target });
    setTarget(null);
    setGuard(null);
  };

  const ninjaName = players[view.ninjaSeat]?.name ?? '?';
  const left = view.maxRounds - view.round;
  let status;
  if (view.over) status = view.result.headline;
  else if (view.phase === 'ninja') {
    status = isNinja ? (target === null ? 'あなたの番です。どこへ動きますか？' : 'ここでよければ決定してください') : `忍者（${ninjaName} さん）がこっそり動いています…`;
  } else if (isNinja) status = '見張りが動いています。見つかりませんように…';
  else if (myGuards.length === 0) status = seat < 0 ? '見張りが動いています' : 'あなたの見張りは動きました。ほかの見張りを待っています…';
  else if (active === null) status = '動かす見張りをタップしてください';
  else if (target === null) status = `見張り${GUARD_NAMES[active]} の行き先を選んでください`;
  else status = possible.has(target) && target !== origin ? 'ここに忍者がいるかも！ 踏みこみますか？' : 'ここでよければ決定してください';

  let label = '行き先を選んでください';
  if (target !== null) {
    if (target === origin) label = ninjaTurn ? 'じっと息をひそめる' : 'この部屋にとどまる';
    else label = ninjaTurn ? 'この部屋へ忍びこむ' : 'この部屋へ踏みこむ';
  }

  const center = (cell) => `${(cell % size) + 0.5},${Math.floor(cell / size) + 0.5}`;
  const colorOfGuard = (g) => paletteOf(players[view.guardOwner[g]]).color;
  const footAge = new Map(view.footprints.map((cell, i) => [cell, i]).reverse());
  const showTrail = view.trail && (view.over || isNinja);

  return html`
    <div class="game ninja">
      <div class="board nj-board" style=${`--n:${size}`}>
        ${Array.from({ length: size * size }, (_, i) => {
          const open = myTurn && (options.includes(i) || view.guards.some((c, g) => c === i && myGuards.includes(g)));
          const age = footAge.get(i);
          return html`
            <button
              key=${i}
              class=${cx(
                'cell room',
                possible.has(i) && 'is-possible',
                options.includes(i) && myTurn && 'is-open',
                target === i && 'is-target',
                view.smokeAt === i && 'is-smoke',
              )}
              disabled=${!open}
              onClick=${() => pick(i)}
              aria-label=${`${Math.floor(i / size) + 1}行${(i % size) + 1}列${possible.has(i) ? ' 忍者がいるかも' : ''}`}
            >
              ${possible.has(i) && html`<span class="nj-maybe">？</span>`}
              ${age !== undefined && html`<span class=${cx('nj-foot', `is-age${age}`)}>👣</span>`}
              ${view.smokeAt === i && html`<span class="nj-smoke">💨</span>`}
            </button>
          `;
        })}

        ${showTrail &&
        html`
          <svg class="nj-trail" viewBox=${`0 0 ${size} ${size}`} aria-hidden="true">
            <polyline points=${(view.over ? view.trail : view.trail.slice(-4)).map(center).join(' ')} />
          </svg>
        `}

        <div class="nj-pieces">
          ${view.guards.map((cell, g) => {
            const shown = g === active && target !== null ? target : cell;
            return html`
              <div
                key=${`g${g}`}
                class=${cx('nj-piece nj-guard', view.moved[g] && view.phase === 'guards' && !view.over && 'is-done', g === active && 'is-active')}
                style=${`left:${((shown % size) * 100) / size}%;top:${(Math.floor(shown / size) * 100) / size}%;--c:${colorOfGuard(g)}`}
              >
                <span class="nj-token">💂</span>
                <i class="nj-name">${GUARD_NAMES[g]}</i>
              </div>
            `;
          })}
          ${view.ninja !== null &&
          html`
            <div
              key="ninja"
              class=${cx('nj-piece nj-ninja', view.over && view.result.detail.reason === 'caught' && 'is-caught')}
              style=${`left:${(((ninjaTurn && target !== null ? target : view.ninja) % size) * 100) / size}%;top:${(Math.floor((ninjaTurn && target !== null ? target : view.ninja) / size) * 100) / size}%`}
            >
              <span class="nj-token">🥷</span>
            </div>
          `}
        </div>

        ${fx &&
        html`<div class=${cx('nj-flash', `is-${fx.type}`)}>${fx.type === 'smoke' ? '💨 ドロン！ 煙玉で逃げられた！' : '🎉 つかまえた！'}</div>`}
      </div>

      <div class="panel">
        <div class="nj-meter">
          <span class=${cx('nj-role', isNinja ? 'is-ninja' : 'is-guard')}>
            ${seat < 0 ? '👀 観戦中' : isNinja ? '🥷 あなたは忍者' : '💂 あなたは見張り'}
          </span>
          <span class="nj-night" title="夜明けまでのラウンド">
            ${Array.from({ length: view.maxRounds }, (_, i) => html`<i key=${i} class=${cx(i < view.round - 1 && 'is-past', i === view.round - 1 && !view.over && 'is-now')}></i>`)}
          </span>
          <span class="nj-left">${view.over ? '' : left === 0 ? '🌅 最後のラウンド' : `夜明けまで あと${left}`}</span>
        </div>

        <p class=${cx('status', myTurn && 'is-mine')}>${status}</p>

        ${myTurn &&
        html`<button class="btn btn-primary btn-block" disabled=${target === null} onClick=${confirm}>${label}</button>`}

        <div class="nj-legend">
          <span><b class="nj-key is-possible">？</b> 忍者がいるかもしれない部屋${isNinja ? '（見張りにはこう見えています）' : ''}</span>
          <span><b class="nj-key">👣</b> ${view.lag} 手前に忍者がいた部屋</span>
          <span><b class="nj-key">💨</b> 煙玉 のこり ${view.smoke}</span>
        </div>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        1人が忍者になって城にしのびこみ、ほかの全員は見張りになって追いかけます。忍者の姿は見えません。手がかりは、少し遅れて浮かび上がる足あとだけ。
      </p>
      <h3>役割</h3>
      <ul>
        <li>ゲームが始まると、だれか1人が <b>🥷 忍者</b>に選ばれます。ほかの人は <b>💂 見張り</b>です。</li>
        <li>見張りは全部で3人。2人で遊ぶときは見張り役の人が3人とも動かし、3人のときは2人で分けて動かします。</li>
      </ul>
      <h3>ラウンドの流れ</h3>
      <ol>
        <li>
          <b>忍者が動く</b>：となりの部屋（たて・よこ）へ1歩、またはその場でじっとします。見張りのいる部屋には入れません。どこへ動いたかは見張りには見えません。
        </li>
        <li>
          <b>見張りが動く</b>：それぞれ1歩ずつ（とどまってもよい）。動く順番は自由です。
        </li>
      </ol>
      <h3>足あと 👣</h3>
      <ul>
        <li>忍者が <b>2手前にいた部屋</b>に、足あとが浮かび上がります。いまの居場所は、そこから2歩以内のどこかです。</li>
        <li>
          足あとや見張りの動きから言える「忍者がいるかもしれない部屋」には <b>？</b> が出ます。これは全員に（忍者にも）見えています。
        </li>
      </ul>
      <h3>つかまえる・逃げる</h3>
      <ul>
        <li>見張りが<b>忍者のいる部屋に踏みこむ</b>と、つかまえます。</li>
        <li>
          忍者は<b>1回だけ煙玉</b>を持っています。踏みこまれても、自動的にとなりの部屋へ逃げます（どの部屋から逃げたかは全員にわかります）。
        </li>
      </ul>
      <h3>勝敗</h3>
      <p><b>14ラウンド</b>逃げ切れば忍者の勝ち。それまでにつかまえれば見張り全員の勝ちです。</p>
      <h3>コツ</h3>
      <ul>
        <li>見張りは、？の部屋をはさみうちにしましょう。外れても、踏みこんだ部屋は候補から消えます。</li>
        <li>忍者は、足あとが出る前に引き返すと裏をかけます。角に追いこまれないよう、逃げ道の多い部屋を選びましょう。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: () => null,
  unit: '',
  progress: (view) => `ラウンド ${view.round} / ${view.maxRounds}`,
  waiting: (view) => !view.over && view.phase === 'guards',
  extra: (view, s) => {
    if (s === view.ninjaSeat) return '🥷 忍者';
    const mine = view.guardOwner.map((owner, g) => (owner === s ? GUARD_NAMES[g] : null)).filter(Boolean);
    return `💂 見張り${mine.join('・')}`;
  },
};
