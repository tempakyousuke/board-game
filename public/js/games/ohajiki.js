// おはじきリングの盤面。
//
// 動きの再生: サーバーからは「弾く前の配置」と「弾いた速度」が届くので、
// サーバーと同じ計算 (stepPhysics) をこの画面でも回して、止まるまでを見せる。

import { html, useState, useEffect, useRef, cx } from '../lib.js';
import { stepPhysics, ringPoints, clampShot, RINGS, RADIUS, DISC, LAUNCH, FALL, FRICTION, MAX_SPEED, MIN_SPEED, DT } from '/shared/games/ohajiki.js';
import { Avatar, paletteOf } from '../ui.js';
import { play, useChanged } from '../sound.js';

const VIEW = FALL + 0.12; // 盤の外まで少し余白をとって描く
const PULL_TO_SPEED = 3; // 引っぱった長さ (盤の単位) を速さに直す倍率
const RING_COLORS = ['#ffd166', '#f59e6c', '#7cc4e8', '#bfe3a1'];

function Board({ view, seat, players, act }) {
  const [frame, setFrame] = useState(null); // 再生中のおはじき
  const [pull, setPull] = useState(null); // 引っぱっている向きと長さ (盤の座標)
  const svgRef = useRef(null);
  const dragStart = useRef(null);
  const lastHit = useRef(0);
  const seenShot = useRef(view.last?.id ?? 0);

  // 自分の発射位置が画面の下にくるよう、盤をまわして描く。
  const mine = seat >= 0 ? view.launch[seat] : view.launch[0];
  const turnDeg = seat >= 0 ? 90 - (Math.atan2(mine.y, mine.x) * 180) / Math.PI : 0;
  const rad = (turnDeg * Math.PI) / 180;

  // 新しい1発が届いたら、弾く前の配置から動きを再生する。
  useEffect(() => {
    const shot = view.last;
    const id = shot?.id ?? 0;
    if (id === seenShot.current) return undefined;
    seenShot.current = id;
    if (!shot) {
      setFrame(null);
      return undefined;
    }
    const discs = shot.before.map((d) => ({ ...d, vx: 0, vy: 0 }));
    const from = view.launch[shot.seat];
    discs.push({ id: shot.disc, seat: shot.seat, x: from.x, y: from.y, vx: shot.vx, vy: shot.vy });
    play('whoosh');

    let raf = 0;
    let previous = performance.now();
    let owed = 0;
    const tick = (now) => {
      // 画面の更新間隔にかかわらず、実時間と同じ速さで進める。
      owed = Math.min(owed + (now - previous) / 1000, 0.1);
      previous = now;
      let moving = true;
      while (owed >= DT && moving) {
        const result = stepPhysics(discs);
        owed -= DT;
        moving = result.moving;
        if (result.hits > 0 && now - lastHit.current > 70) {
          lastHit.current = now;
          play('place');
        }
        if (result.fell > 0) play('step');
      }
      if (!moving) {
        setFrame(null);
        return;
      }
      setFrame(discs.filter((d) => !d.out).map((d) => ({ id: d.id, seat: d.seat, x: d.x, y: d.y })));
      raf = requestAnimationFrame(tick);
    };
    setFrame(discs.map((d) => ({ id: d.id, seat: d.seat, x: d.x, y: d.y })));
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view.last?.id]);

  useChanged(view.phase, (phase) => {
    if (phase === 'review') play('chime', { delay: 0.2 });
  });

  const animating = frame !== null;
  const myTurn = !view.over && view.phase === 'shoot' && view.turn === seat;
  const canAim = myTurn && !animating;
  const discs = frame ?? view.discs;
  const live = players.map((_, s) => discs.filter((d) => d.seat === s).reduce((sum, d) => sum + ringPoints(d.x, d.y), 0));
  const colorOf = (s) => paletteOf(players[s]).color;
  const name = (s) => players[s]?.name ?? '?';

  /** 画面上の点を、盤をまわす前の座標 (サーバーと同じ向き) に直す。 */
  const toBoard = (clientX, clientY) => {
    const box = svgRef.current.getBoundingClientRect();
    const sx = ((clientX - box.left) / box.width - 0.5) * VIEW * 2;
    const sy = ((clientY - box.top) / box.height - 0.5) * VIEW * 2;
    return { x: sx * Math.cos(-rad) - sy * Math.sin(-rad), y: sx * Math.sin(-rad) + sy * Math.cos(-rad) };
  };

  const onDown = (e) => {
    if (!canAim) return;
    e.preventDefault();
    svgRef.current.setPointerCapture?.(e.pointerId);
    dragStart.current = toBoard(e.clientX, e.clientY);
    setPull({ x: 0, y: 0 });
  };
  const onMove = (e) => {
    if (!dragStart.current) return;
    const now = toBoard(e.clientX, e.clientY);
    // パチンコのように、引っぱった向きと反対へ飛ぶ。
    setPull({ x: dragStart.current.x - now.x, y: dragStart.current.y - now.y });
  };
  const onUp = () => {
    if (!dragStart.current) return;
    dragStart.current = null;
    const shot = pull && clampShot(pull.x * PULL_TO_SPEED, pull.y * PULL_TO_SPEED);
    setPull(null);
    if (shot && canAim) act({ type: 'shoot', vx: shot.vx, vy: shot.vy });
  };

  const aim = pull ? clampShot(pull.x * PULL_TO_SPEED, pull.y * PULL_TO_SPEED) : null;
  const speed = aim ? Math.sqrt(aim.vx * aim.vx + aim.vy * aim.vy) : 0;
  // 何にも当たらなければここまで進む、という目安の線。
  const reach = aim ? (speed * speed) / (2 * FRICTION) : 0;
  const powerPercent = Math.round(((speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * 100);

  let status;
  if (view.over) status = '全部弾き終わりました！';
  else if (view.phase === 'review') status = `${view.end} 回戦おわり。点数を確認しましょう`;
  else if (animating) status = 'コロコロ…';
  else if (myTurn) status = pull ? (aim ? `強さ ${Math.max(0, powerPercent)}%。指をはなすと弾きます` : 'もっと引っぱって！') : 'あなたの番です。盤の上で指を引っぱって、はなしてください';
  else status = `${name(view.turn)} さんの番です`;

  const review = view.phase === 'review' || view.over ? view.history[view.history.length - 1] : null;

  return html`
    <div class="game ohajiki">
      <svg
        ref=${svgRef}
        class=${cx('oh-board', canAim && 'is-aiming')}
        viewBox=${`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`}
        onPointerDown=${onDown}
        onPointerMove=${onMove}
        onPointerUp=${onUp}
        onPointerCancel=${onUp}
        role="img"
        aria-label="おはじきの盤"
      >
        <g transform=${`rotate(${turnDeg})`}>
          <circle r=${FALL} class="oh-table" />
          ${RINGS.slice()
            .reverse()
            .map((ring, i) => html`<circle key=${ring.r} r=${ring.r} fill=${RING_COLORS[RINGS.length - 1 - i]} class="oh-ring" />`)}
          ${view.launch.map(
            (p, s) => html`<circle key=${`l${s}`} cx=${p.x} cy=${p.y} r=${DISC * 1.5} class=${cx('oh-launch', view.turn === s && !animating && 'is-turn')} stroke=${colorOf(s)} />`,
          )}

          ${canAim &&
          html`<circle cx=${mine.x} cy=${mine.y} r=${DISC} fill=${colorOf(seat)} class="oh-disc oh-ready" />`}
          ${aim &&
          html`<line
            x1=${mine.x}
            y1=${mine.y}
            x2=${mine.x + (aim.vx / speed) * reach}
            y2=${mine.y + (aim.vy / speed) * reach}
            class="oh-aim"
            stroke=${colorOf(seat)}
          />`}

          ${discs.map(
            (d) => html`
              <g key=${d.id} transform=${`translate(${d.x} ${d.y})`}>
                <circle r=${DISC} fill=${colorOf(d.seat)} class="oh-disc" />
                <text class="oh-face" transform=${`rotate(${-turnDeg})`} y="0.03">${paletteOf(players[d.seat]).emoji}</text>
              </g>
            `,
          )}
        </g>
        ${RINGS.map((ring, i) => {
          const inner = i === 0 ? 0 : RINGS[i - 1].r;
          return html`<text key=${`p${i}`} class="oh-points" x="0" y=${-(inner + ring.r) / 2 + 0.04}>${ring.points}</text>`;
        })}
      </svg>

      <div class="panel">
        <p class=${cx('status', canAim && 'is-mine')}>${status}</p>

        <div class="oh-scores">
          ${players.map(
            (player, s) => html`
              <div key=${s} class=${cx('oh-score', view.turn === s && view.phase === 'shoot' && 'is-turn')} style=${`--c:${colorOf(s)}`}>
                <${Avatar} player=${player} size="xs" />
                <span class="oh-score-now">この回 <b>${review ? review[s] : live[s]}</b></span>
                <span class="oh-left">${view.phase === 'shoot' ? `のこり ${view.shotsLeft[s]}` : ''}</span>
              </div>
            `,
          )}
        </div>

        ${view.phase === 'review' &&
        seat >= 0 &&
        html`<button class="btn btn-primary btn-block" onClick=${() => act({ type: 'next' })}>
          ${view.end >= view.maxEnds ? '結果を見る' : `${view.end + 1} 回戦へ`}
        </button>`}

        <p class="muted oh-note">
          まんなかから ${RINGS.map((r) => r.points).join('・')} 点。的の外で止まったおはじきは取りのぞかれます。
        </p>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        盤のふちからおはじきを弾いて、的のまんなかをねらいます。相手のおはじきにぶつけて、的の外へ弾き出すこともできます。
      </p>
      <h3>弾き方</h3>
      <ul>
        <li>自分の番になったら、盤の上で<b>指（マウス）を押したまま引っぱって、はなします</b>。</li>
        <li>パチンコのように、<b>引っぱった向きの反対</b>へ飛びます。長く引っぱるほど強くなります。</li>
        <li>引っぱっているあいだ、「何にも当たらなければここまで進む」という目安の線が出ます。</li>
      </ul>
      <h3>ルール</h3>
      <ul>
        <li>順番に1つずつ弾きます。1回戦で弾ける数は、2人なら5つ、3人なら4つ、4人なら3つです。</li>
        <li>おはじきどうしはぶつかって動きます。<b>的の外で止まったおはじき</b>や、盤から落ちたおはじきは取りのぞかれます。</li>
        <li>全員が弾き終わったら、的に残っている自分のおはじきの点を数えます。まんなかから <b>${RINGS.map((r) => r.points).join('・')} 点</b>です。</li>
      </ul>
      <h3>終了</h3>
      <p><b>2回戦</b>の合計点が高い人の勝ち。あとから弾くほうが有利なので、先に弾く人は回ごとに交代します。</p>
      <h3>コツ</h3>
      <ul>
        <li>まっすぐ強く当てると、相手が飛んでいって、自分がその場に残ります。</li>
        <li>まんなかのおはじきは、いちばん強く弾いてようやく外に出るくらい。ふちに近いものほど出しやすくなります。</li>
        <li>最後の1つは、置きにいくか、弾き出しにいくか。点差を見て決めましょう。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  // 動きを見せ終わる前に結果がわかってしまわないよう、上の一覧には終わった回までの合計を出す。
  scores: (view) => view.totals,
  unit: '点',
  progress: (view) => `${view.end} / ${view.maxEnds} 回戦`,
  waiting: () => false,
  turnSeats: (view, pending) => (view.phase === 'shoot' ? pending : []),
  extra: (view, s) => (view.phase === 'shoot' ? `のこり ${view.shotsLeft[s]}` : ''),
};
