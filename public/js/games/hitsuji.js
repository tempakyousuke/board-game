// おかえりヒツジの盤面。

import { html, useState, useEffect, useMemo, useRef, cx } from '../lib.js';
import { reachable, fleeFrom, isGate, DOG_STEPS, FLEE_STEPS } from '/shared/games/hitsuji.js';
import { Avatar, paletteOf } from '../ui.js';

const FX_MS = 2200;
const DOG_NAMES = ['A', 'B', 'C', 'D'];

function Board({ view, seat, players, act }) {
  const { size } = view;
  const [dog, setDog] = useState(null);
  const [wanted, setTarget] = useState(null);
  const [fx, setFx] = useState(null);
  const seen = useRef(view.last?.id ?? 0);

  // 犬が動いたら、しばらくのあいだ「だれが逃げたか」を見せる。
  useEffect(() => {
    const id = view.last?.id ?? 0;
    if (id === seen.current) return undefined;
    seen.current = id;
    setTarget(null);
    setFx(view.last);
    const timer = setTimeout(() => setFx(null), FX_MS);
    return () => clearTimeout(timer);
  }, [view.last?.id]);

  const myDogs = view.owner.map((owner, d) => (owner === seat && !view.moved[d] ? d : -1)).filter((d) => d >= 0);
  const playing = seat >= 0 && !view.over;
  const myTurn = playing && myDogs.length > 0;
  // 動かせる犬が1匹だけなら、選ぶ手間をはぶく。
  const active = myTurn ? (myDogs.includes(dog) ? dog : myDogs.length === 1 ? myDogs[0] : null) : null;

  const options = useMemo(() => (active === null ? new Set() : new Set(reachable(view, active))), [active, view.dogs, view.sheep]);
  // 仲間が先に動いて行けなくなった行き先は、選んでいなかったことにする。
  const target = wanted !== null && options.has(wanted) ? wanted : null;
  const preview = useMemo(() => (target !== null ? fleeFrom(view, active, target) : null), [active, target, options]);

  const pick = (cell) => {
    const mine = view.dogs.findIndex((c, d) => c === cell && myDogs.includes(d));
    if (mine >= 0 && mine !== active) {
      setDog(mine);
      setTarget(null);
      return;
    }
    if (options.has(cell)) setTarget(cell);
  };

  const confirm = () => {
    if (active === null || target === null) return;
    act({ type: 'move', dog: active, to: target });
    setTarget(null);
    setDog(null);
  };

  const center = (cell) => `${(cell % size) + 0.5},${Math.floor(cell / size) + 0.5}`;
  const colorOfDog = (d) => paletteOf(players[view.owner[d]]).color;
  const waiting = view.owner.filter((_, d) => !view.moved[d]).length;
  const staying = active !== null && target === view.dogs[active];
  const homeNow = preview ? preview.gone.size : 0;
  const left = view.maxRounds - view.round;

  let status;
  if (view.over) status = view.result.success ? 'みんな帰れました！' : '日が暮れてしまいました…';
  else if (!playing) status = `のこり ${waiting} 匹の犬が動きます`;
  else if (!myTurn) status = 'あなたの犬は動きました。ほかの犬を待っています…';
  else if (active === null) status = '動かす犬をタップしてください';
  else if (target === null) status = `犬${DOG_NAMES[active]} の行き先を選んでください（光っているマス）`;
  else if (preview.moves.length === 0) status = 'ここに動いても、ヒツジは逃げません';
  else status = `ヒツジが ${preview.moves.length} 匹逃げます${homeNow ? `（${homeNow} 匹おかえり！）` : ''}`;

  const arrows = preview ? preview.moves : fx ? [...fx.fled, ...fx.wandered] : [];
  const wandered = new Set(fx ? fx.wandered.map((w) => w.to) : []);
  const welcomed = fx ? [...fx.fled, ...fx.wandered].filter((m) => m.home).map((m) => m.to) : [];

  return html`
    <div class="game hitsuji">
      <div class="board hj-board" style=${`--n:${size}`}>
        ${Array.from({ length: size * size }, (_, i) => {
          const gate = isGate(i);
          const open = myTurn && (options.has(i) || view.dogs.some((c, d) => c === i && myDogs.includes(d)));
          return html`
            <button
              key=${i}
              class=${cx(
                'cell grass',
                (Math.floor(i / size) + (i % size)) % 2 === 1 && 'is-alt',
                gate && 'is-gate',
                active !== null && options.has(i) && 'is-open',
                target === i && 'is-target',
                welcomed.includes(i) && 'is-welcome',
              )}
              disabled=${!open}
              onClick=${() => pick(i)}
              aria-label=${`${Math.floor(i / size) + 1}行${(i % size) + 1}列`}
            >
              ${gate && html`<span class="hj-gate">🏠</span>`}
              ${view.rocks.includes(i) && html`<span class="rock">🪨</span>`}
              ${welcomed.includes(i) && html`<span class="hj-welcome">おかえり！</span>`}
            </button>
          `;
        })}

        <svg class="hj-arrows" viewBox=${`0 0 ${size} ${size}`} aria-hidden="true">
          <defs>
            <marker id="hj-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#fff" />
            </marker>
          </defs>
          ${arrows.map(
            (m, i) => html`<polyline
              key=${i}
              points=${(m.path ?? [m.from, m.to]).map(center).join(' ')}
              class=${cx(preview && 'is-preview')}
              marker-end="url(#hj-head)"
            />`,
          )}
        </svg>

        <div class="hj-pieces">
          ${view.sheep.map((cell, i) => html`
            <div
              key=${`s${view.ids[i]}`}
              class=${cx('hj-piece hj-sheep', wandered.has(cell) && 'is-wander')}
              style=${`left:${((cell % size) * 100) / size}%;top:${(Math.floor(cell / size) * 100) / size}%`}
            >
              <span>🐑</span>
            </div>
          `)}
          ${view.dogs.map((cell, d) => {
            const shown = d === active && target !== null ? target : cell;
            return html`
              <div
                key=${`d${d}`}
                class=${cx('hj-piece hj-dog', view.moved[d] && !view.over && 'is-done', d === active && 'is-active', d === active && target !== null && 'is-ghost')}
                style=${`left:${((shown % size) * 100) / size}%;top:${(Math.floor(shown / size) * 100) / size}%;--c:${colorOfDog(d)}`}
              >
                <span class="hj-dog-token">🐕</span>
                <i class="hj-dog-name">${DOG_NAMES[d]}</i>
              </div>
            `;
          })}
        </div>
      </div>

      <div class="panel">
        <div class="hj-meter">
          <span class="hj-home">🏠 <b>${view.home}</b> / ${view.total} 匹</span>
          <span class="hj-sun" title="のこりのラウンド">
            ${Array.from({ length: view.maxRounds }, (_, i) => html`<i key=${i} class=${cx(i < view.round - 1 && 'is-past', i === view.round - 1 && !view.over && 'is-now')}></i>`)}
          </span>
          <span class="hj-left">${view.over ? '' : left === 0 ? '最後のラウンド！' : `日暮れまで あと${left}`}</span>
        </div>

        <p class=${cx('status', myTurn && 'is-mine')}>${status}</p>

        ${myTurn &&
        html`
          <button class="btn btn-primary btn-block" disabled=${target === null} onClick=${confirm}>
            ${target === null ? '行き先を選んでください' : staying ? 'その場でほえる' : 'ここへ走る'}
          </button>
        `}

        <div class="hj-dogs">
          ${view.dogs.map(
            (_, d) => html`
              <span key=${d} class=${cx('hj-dog-chip', view.moved[d] && 'is-done')} style=${`--c:${colorOfDog(d)}`}>
                <i>${DOG_NAMES[d]}</i>
                <${Avatar} player=${players[view.owner[d]]} size="xs" />
                ${view.moved[d] ? '動いた' : 'まだ'}
              </span>
            `,
          )}
        </div>
        <p class="muted hj-note">
          犬は ${DOG_STEPS} 歩まで。犬のまわり8マスのヒツジは、反対へ ${FLEE_STEPS} マス逃げます。そばに犬がいないヒツジは、ラウンドの終わりにふらふら歩きます。
        </p>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        全員で協力する牧場のゲーム。牧羊犬を動かしてヒツジを追い、日が暮れる前に全部のヒツジを小屋へ帰しましょう。勝つときも負けるときも、みんな一緒です。
      </p>
      <h3>ラウンドの流れ</h3>
      <ul>
        <li>毎ラウンド、<b>すべての犬が1回ずつ</b>動きます。<b>動く順番は自由</b>なので、相談して決めましょう。</li>
        <li>犬は、たて・よこに <b>${DOG_STEPS} 歩まで</b>動けます。ヒツジ・ほかの犬・岩は通れません。動かずに<b>その場でほえる</b>こともできます。</li>
        <li>1〜2人で遊ぶときは犬が2匹います。1人のときは両方を自分で動かします。</li>
      </ul>
      <h3>ヒツジの逃げ方</h3>
      <ul>
        <li>犬が止まったとき、<b>そのまわり8マス</b>にいるヒツジは、犬と<b>反対の方向へ ${FLEE_STEPS} マス</b>逃げます（ななめにも逃げます）。</li>
        <li>壁にぶつかったら、広いほうへ曲がって<b>壁ぞいに走ります</b>。岩やほかの動物にぶつかったら、そこで止まります。</li>
        <li>行き先を選ぶと、ヒツジがどう逃げるかが矢印で出ます。押す前に確かめましょう。</li>
      </ul>
      <h3>小屋とふらふら歩き</h3>
      <ul>
        <li>上のまんなかにある <b>🏠 小屋のマス</b>に入ったヒツジは「おかえり」。もう逃げません。</li>
        <li>ラウンドの終わりに、<b>そばに犬がいないヒツジ</b>は、ふらふらと1マス歩くことがあります（草を食べに、下へ行きがち）。</li>
      </ul>
      <h3>勝敗</h3>
      <p>決められたラウンドのうちに全部のヒツジを小屋に入れたら、<b>全員の勝ち</b>です。早く終えるほど ★ が増えます。日が暮れてしまったら全員の負け。</p>
      <h3>コツ</h3>
      <ul>
        <li>同じヒツジを2匹の犬で続けて押せば、1ラウンドで4マス進められます。順番が大事です。</li>
        <li>上の壁まで押し上げれば、あとは壁ぞいに小屋のほうへ寄っていきます。</li>
        <li>犬をそばに置いておくと、そのヒツジはふらふら歩きません。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: () => null, // 協力ゲームなので、ひとりずつの点はない
  unit: '匹',
  progress: (view) => `ラウンド ${view.round} / ${view.maxRounds}`,
  waiting: (view) => !view.over,
  extra: (view, s) =>
    view.owner
      .map((owner, d) => (owner === s ? `犬${DOG_NAMES[d]}` : null))
      .filter(Boolean)
      .join('・'),
};
