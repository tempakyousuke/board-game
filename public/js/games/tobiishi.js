// ぐるぐるとびいしの画面。

import { html, useState, useEffect, cx } from '../lib.js';
import { RING, REACH, HAND, ROUNDS, LEAD_BONUS, REVEAL_LEAD_MS, REVEAL_STEP_MS, distance } from '/shared/games/tobiishi.js';
import { Avatar, paletteOf } from '../ui.js';
import { play, useChanged } from '../sound.js';
import { useReplay } from '../replay.js';

const R_TRACK = 82; // 石がならぶ輪
const R_LANE = 63; // 出そろったカードや、自分の手札の位置を見せる内がわの輪
const R_LABEL = 97;

/** 数字 c の、輪の上での位置。60 が真上で、時計回りに進む。 */
function at(c, r) {
  const a = (c / RING) * Math.PI * 2 - Math.PI / 2;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** from から to まで、時計回りの弧。 */
function arc(r, from, to) {
  const [x0, y0] = at(from, r);
  const [x1, y1] = at(to, r);
  const sweep = (to - from + RING) % RING;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${sweep > RING / 2 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function Stone({ card, r, color, big = false, cls = '' }) {
  const [x, y] = at(card, r);
  return html`
    <g class=${cx('tb-stone', big && 'is-top', cls)} transform=${`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
      <circle r=${big ? 7 : 5.4} fill=${color} />
      <text y="0.4">${card}</text>
    </g>
  `;
}

function Ring({ pile, waiting, hand, choice, players, seat, burst }) {
  const top = pile[pile.length - 1].card;
  const colorOf = (s) => (s >= 0 ? paletteOf(players[s]).color : '#8a8f98');
  // 列がどこからどこまでつながっているか (1周をこえたら輪ぜんぶ)。
  let span = 0;
  for (let i = 1; i < pile.length; i++) span += distance(pile[i - 1].card, pile[i].card);
  const mine = paletteOf(players[seat]).color;

  return html`
    <svg class="tb-ring" viewBox="-108 -108 216 216" role="img" aria-label=${`いまの列は ${pile.length}枚、先頭は ${top}`}>
      <circle class="tb-track" r=${R_TRACK} />
      <path class="tb-reach" d=${arc(R_TRACK, top + 0.5, top + REACH + 0.5)} />
      ${pile.length > 1 &&
      (span >= RING ? html`<circle class="tb-chain" r=${R_TRACK} />` : html`<path class="tb-chain" d=${arc(R_TRACK, pile[0].card, top)} />`)}
      ${Array.from({ length: RING }, (_, i) => {
        const c = i + 1;
        const [x, y] = at(c, R_TRACK);
        const [lx, ly] = at(c, R_LABEL);
        return html`
          <g key=${c}>
            <circle class="tb-tick" cx=${x.toFixed(2)} cy=${y.toFixed(2)} r=${c % 5 === 0 ? 1.5 : 0.9} />
            ${c % 5 === 0 && html`<text class="tb-label" x=${lx.toFixed(2)} y=${(ly + 0.5).toFixed(2)}>${c}</text>`}
          </g>
        `;
      })}

      ${hand.map((c) => {
        const [x, y] = at(c, R_LANE);
        const on = c === choice;
        return html`
          <g key=${`h${c}`} class=${cx('tb-mine', on && 'is-on')} transform=${`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
            <circle r=${on ? 6 : 2.6} fill=${mine} />
            ${on && html`<text y="0.4">${c}</text>`}
          </g>
        `;
      })}
      ${waiting.map((step) => html`<${Stone} key=${`w${step.card}`} card=${step.card} r=${R_LANE} color=${colorOf(step.seat)} cls="is-waiting" />`)}

      ${pile.slice(0, -1).map((item) => html`<${Stone} key=${`p${item.card}`} card=${item.card} r=${R_TRACK} color=${colorOf(item.seat)} />`)}
      <${Stone} key=${`p${top}`} card=${top} r=${R_TRACK} color=${colorOf(pile[pile.length - 1].seat)} big />

      <g class=${cx('tb-center', burst && 'is-burst')}>
        <text class="tb-center-label" y="-17">${burst ? 'とどかない！' : 'いまの列'}</text>
        <text class="tb-center-size" y="6">${burst ? `−${burst}` : pile.length}</text>
        <text class="tb-center-unit" y="19">${burst ? '点' : '枚'}</text>
      </g>
    </svg>
  `;
}

function Board({ view, seat, players, act }) {
  const playing = seat >= 0 && !view.over;
  const revealing = view.phase === 'reveal';
  const picking = view.phase === 'pick';
  const steps = view.last?.steps ?? [];
  const name = (s) => (s === seat ? 'あなた' : `${players[s]?.name ?? '?'} さん`);

  const shown = useReplay(revealing, view.last?.id, steps.length, { lead: REVEAL_LEAD_MS, step: REVEAL_STEP_MS }, (i) => {
    const step = steps[i];
    if (step.ok) play('step', { level: Math.min(1, i / 5) });
    else play(step.seat === seat ? 'fail' : 'bonk');
    if (i === steps.length - 1 && view.last.leader >= 0) play(view.last.leader === seat ? 'chime' : 'coin', { delay: 0.35 });
  });
  useChanged(view.phase, (phase) => {
    if (phase === 'reveal') play('card');
    else if (phase === 'roundEnd') play('up');
  });
  useChanged(view.myPick, (card) => {
    if (card !== null) play('place');
  });

  // 見せている最中は、置き終えたところまでの列を組み立てる。
  let pile = view.pile;
  if (revealing) {
    for (const step of steps.slice(0, shown)) pile = step.ok ? [...pile, { card: step.card, seat: step.seat }] : [{ card: step.card, seat: step.seat }];
  }
  const top = pile[pile.length - 1].card;
  const latest = revealing && shown > 0 ? steps[shown - 1] : null;
  const allShown = !revealing || shown >= steps.length;
  const log = revealing ? steps.slice(0, shown) : steps;

  const [choice, setChoice] = useState(null);
  useEffect(() => setChoice(null), [`${view.round}:${view.turn}`]);
  const myPlayed = revealing ? steps.find((step) => step.seat === seat)?.card : null;
  const hand = (view.myHand ?? []).filter((c) => c !== myPlayed).sort((a, b) => distance(top, a) - distance(top, b));
  const selected = choice ?? view.myPick;
  const waitingFor = view.picked.filter((done) => !done).length;

  let status;
  if (view.over) status = 'おつかれさまでした！';
  else if (view.phase === 'roundEnd') status = `ラウンド ${view.round} おわり`;
  else if (revealing) status = shown === 0 ? '出そろいました。近い順に置いていきます…' : allShown && view.last.leader >= 0 ? `いちばん先まで進んだのは ${name(view.last.leader)}！` : '近い順に置いています…';
  else if (seat < 0) status = `あと ${waitingFor} 人が考えています`;
  else if (view.myPick !== null && (choice === null || choice === view.myPick)) {
    status = waitingFor > 0 ? `${view.myPick} を出しました。あと ${waitingFor} 人を待っています…` : '全員そろいました';
  } else status = selected === null ? 'カードを1枚えらんでください' : 'これでよければ「出す」を押してください';

  return html`
    <div class="game tobiishi">
      <div class="tb-stage">
        <${Ring}
          pile=${pile}
          waiting=${revealing ? steps.slice(shown) : []}
          hand=${revealing ? [] : hand}
          choice=${revealing ? null : selected}
          players=${players}
          seat=${seat}
          burst=${latest && !latest.ok ? latest.took : 0}
        />
        <p class="tb-caption">
          先頭 <b>${top}</b> から <b>${REACH}</b> 以内（緑のところ）なら、つながります
        </p>
      </div>

      <div class="panel">
        <p class=${cx('status', playing && picking && (view.myPick === null || (choice !== null && choice !== view.myPick)) && 'is-mine')}>${status}</p>

        ${log.length > 0 &&
        html`
          <div class="tb-log">
            ${!revealing && html`<b class="tb-log-title">さっきの番</b>`}
            ${log.map(
              (step) => html`
                <div key=${step.card} class=${cx('tb-step', step.ok ? 'is-ok' : 'is-bad')}>
                  <${Avatar} player=${players[step.seat]} size="xs" />
                  <b class="tb-num">${step.card}</b>
                  <span>${step.ok ? `+${step.gap} つながった` : `${step.gap} はなれていて届かず`}</span>
                  ${!step.ok && html`<i class="tb-took">${step.took}枚 引き取り</i>`}
                </div>
              `,
            )}
            ${allShown &&
            view.last.leader >= 0 &&
            html`<div class="tb-step is-lead">
              <${Avatar} player=${players[view.last.leader]} size="xs" />
              <span>いちばん先まで進んだ</span>
              <i class="tb-gain">+${LEAD_BONUS}点</i>
            </div>`}
          </div>
        `}

        ${playing &&
        picking &&
        html`
          <div class="tb-hand">
            ${hand.map((c) => {
              const d = distance(top, c);
              return html`
                <button
                  key=${c}
                  class=${cx('tb-card', d <= REACH ? 'is-safe' : 'is-far', c === selected && 'is-on')}
                  onClick=${() => setChoice(c)}
                  aria-pressed=${c === selected}
                  aria-label=${`${c}（先頭から ${d}）`}
                >
                  <b>${c}</b>
                  <small>+${d}</small>
                  <i>${d <= REACH ? '届く' : '橋しだい'}</i>
                </button>
              `;
            })}
          </div>
          <button
            class="btn btn-primary btn-block"
            disabled=${selected === null || selected === view.myPick}
            onClick=${() => act({ type: 'pick', card: selected })}
          >
            ${view.myPick === null ? (selected === null ? 'カードを出す' : `「${selected}」を出す`) : selected !== view.myPick ? `「${selected}」に変える` : '出しました'}
          </button>
        `}

        ${view.phase === 'roundEnd' &&
        html`
          <div class="tb-round">
            <b>このラウンドの点</b>
            <div class="tb-round-list">
              ${players.map(
                (p, s) => html`
                  <span key=${s} class=${cx('tb-chip', view.roundPoints[s] < 0 && 'is-bad')}>
                    <${Avatar} player=${p} size="xs" /> ${view.roundPoints[s] > 0 ? '+' : ''}${view.roundPoints[s]}
                  </span>
                `,
              )}
            </div>
            ${seat >= 0 && html`<button class="btn btn-primary btn-block" onClick=${() => act({ type: 'next' })}>つぎのラウンドへ</button>`}
          </div>
        `}

        ${view.over &&
        html`
          <div class="tb-round">
            <div class="tb-round-list">
              ${players.map(
                (p, s) => html`
                  <span key=${s} class="tb-chip"><${Avatar} player=${p} size="xs" /> 引き取り ${view.taken[s]}枚・先頭 ${view.leads[s]}回</span>
                `,
              )}
            </div>
          </div>
        `}

        <p class="tb-legend">
          届かなかった人は列を全部引き取ります（1枚 −1点）。その番でいちばん先まで進んだ人に +${LEAD_BONUS}点。
        </p>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        全員が同時にカードを1枚出して、1本の列につなげていきます。近いカードなら安全。遠いカードは、ほかの人のカードが「橋」になれば届きます。届かなかった人が、列をまるごと引き取ります。
      </p>
      <h3>準備</h3>
      <ul>
        <li>カードは <b>1〜${RING}</b>。数字は<b>輪</b>になっていて、${RING} の次は 1 です。</li>
        <li>手札は1人 <b>${HAND}枚</b>。場には「列の先頭」になるカードが1枚あります。</li>
      </ul>
      <h3>進め方</h3>
      <ol>
        <li>全員が同時に、手札から1枚えらんで出します。</li>
        <li>出そろったら、先頭から<b>時計回りに近い順</b>に、1枚ずつ置いていきます。</li>
        <li>前のカードから <b>${REACH} 以内</b>なら<b>つながります</b>。列が1枚のびて、そのカードが新しい先頭になります。</li>
        <li>
          ${REACH} より離れていたら<b>届きません</b>。その人は、<b>それまでの列を全部引き取ります</b>（1枚につき −1点）。出したカードが、新しい列の最初の1枚になります。
        </li>
      </ol>
      <h3>ごほうび</h3>
      <p>
        その番で<b>最後に置かれたカードがつながっていたら</b>、その人に <b>+${LEAD_BONUS}点</b>。いちばん先まで進んだごほうびです。最後のカードが届かなかった番は、だれももらえません。
      </p>
      <h3>例</h3>
      <p>
        先頭が 55 で、58・3・9・17 が出たとします。58（+3）、3（+5）、9（+6）、17（+8）と全部つながり、17 を出した人が +${LEAD_BONUS}点。17
        ではなく 30（9 から +21）だったら届かず、その人が列を引き取ります。
      </p>
      <h3>終了</h3>
      <ul>
        <li>手札を出し切ったら1ラウンド終了。<b>${ROUNDS}ラウンド</b>の合計点が高い人の勝ちです。</li>
        <li>同点なら、引き取った枚数が少ない人が上です。</li>
      </ul>
      <h3>コツ</h3>
      <ul>
        <li>緑のところ（先頭から ${REACH} 以内）のカードは、だれが何を出しても必ずつながります。</li>
        <li>少しだけ届かないカードは、だれかが間に置いてくれれば届きます。人数が多いほど橋はかかりやすくなります。</li>
        <li>列が長いときに届かないと大きな失点。先に届かなかった人がいれば、列は短くなっているので傷は浅くてすみます。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.points,
  unit: '点',
  progress: (view) => `ラウンド ${view.round}/${view.maxRounds}・${view.turn}/${view.turns}枚目`,
  waiting: (view) => !view.over && view.phase === 'pick',
  turnSound: false,
  turnSeats: (view, pending) => (view.phase === 'pick' ? pending : []),
  extra: (view, s) => `引取 ${view.taken[s]}枚`,
};
