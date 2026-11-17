// ふきこぼれ注意！の画面。

import { html, useState, useEffect, cx } from '../lib.js';
import { LIMIT, MAX_CARD, EXACT_BONUS, POTS, REVEAL_LEAD_MS, REVEAL_STEP_MS, potSum, lightest } from '/shared/games/fukikobore.js';
import { Avatar, paletteOf } from '../ui.js';
import { play, useChanged } from '../sound.js';
import { useReplay } from '../replay.js';

const POT_NAMES = ['A', 'B', 'C'];

function Board({ view, seat, players, act }) {
  const playing = seat >= 0 && !view.over;
  const revealing = view.phase === 'reveal';
  const picking = view.phase === 'pick';
  const steps = view.last?.steps ?? [];
  const names = (seats) => seats.map((s) => (s === seat ? 'あなた' : players[s]?.name ?? '?')).join('・');

  const shown = useReplay(revealing, view.last?.id, steps.length, { lead: REVEAL_LEAD_MS, step: REVEAL_STEP_MS }, (i) => {
    const step = steps[i];
    if (step.result === 'over') play(step.seats.includes(seat) ? 'fail' : 'boom');
    else if (step.result === 'exact') play('chime');
    else play('pop', { level: Math.min(1, step.after / LIMIT) });
  });
  useChanged(view.phase, (phase) => {
    if (phase === 'reveal') play('card');
  });
  useChanged(view.myPick, (card) => {
    if (card !== null) play('place');
  });

  // 見せている最中は、入れ終えたところまでのなべを組み立てる。
  // いまちょうど見せている1手であふれた (ぴったりだった) なべは、空にする前の姿で止めておく。
  let pots = view.pots;
  let event = null;
  if (revealing) {
    pots = view.pots.map((pot) => pot.slice());
    steps.slice(0, shown).forEach((step, i) => {
      for (const s of step.seats) pots[step.pot].push({ value: step.value, seat: s });
      if (step.result === 'ok') return;
      if (i === shown - 1) event = step;
      else pots[step.pot] = [];
    });
  }
  const target = lightest(event ? pots.map((pot, i) => (i === event.pot ? [] : pot)) : pots);
  const room = LIMIT - potSum(pots[target]);
  const log = revealing ? steps.slice(0, shown) : steps;

  const [choice, setChoice] = useState(null);
  useEffect(() => setChoice(null), [view.turn]);
  const myPlayed = revealing ? steps.find((step) => step.seats.includes(seat))?.value : null;
  const hand = seat >= 0 ? view.hands[seat].filter((v) => v !== myPlayed) : [];
  const selected = choice ?? view.myPick;
  const waitingFor = view.picked.filter((done) => !done).length;

  let status;
  if (view.over) status = 'おつかれさまでした！';
  else if (revealing) status = shown === 0 ? '出そろいました。小さい順に入れていきます…' : event?.result === 'over' ? 'ふきこぼれ！' : event?.result === 'exact' ? `ぴったり ${LIMIT}！` : '小さい順に入れています…';
  else if (seat < 0) status = `あと ${waitingFor} 人が考えています`;
  else if (view.myPick !== null && (choice === null || choice === view.myPick)) {
    status = waitingFor > 0 ? `${view.myPick} を出しました。あと ${waitingFor} 人を待っています…` : '全員そろいました';
  } else status = selected === null ? 'カードを1枚えらんでください' : 'これでよければ「出す」を押してください';

  return html`
    <div class="game fukikobore">
      <div class="fk-stage">
        <div class="fk-pots">
          ${pots.map((pot, i) => {
            const sum = potSum(pot);
            const state = event && event.pot === i ? event.result : null;
            const next = !view.over && !state && i === target;
            return html`
              <div key=${i} class=${cx('fk-pot', next && 'is-next', state === 'over' && 'is-over', state === 'exact' && 'is-exact')}>
                <span class="fk-pot-name">なべ ${POT_NAMES[i]}</span>
                <span class="fk-pot-sum"><b>${sum}</b><small>/ ${LIMIT}</small></span>
                <span class="fk-gauge" aria-hidden="true"><i style=${`width:${Math.min(100, (sum / LIMIT) * 100)}%`}></i></span>
                <span class="fk-pot-note">
                  ${state === 'over' ? `あふれた！ ${event.took}枚` : state === 'exact' ? `ぴったり！ +${EXACT_BONUS}点` : next ? `つぎはここ（あと ${LIMIT - sum}）` : `あと ${LIMIT - sum}`}
                </span>
                <span class="fk-items">
                  ${pot.map((item, k) => html`<i key=${k} class="fk-item" style=${`--c:${paletteOf(players[item.seat]).color}`}>${item.value}</i>`)}
                </span>
              </div>
            `;
          })}
        </div>

        ${revealing &&
        html`
          <div class="fk-queue">
            <span>出そろったカード</span>
            ${steps.map(
              (step, i) => html`
                <span key=${step.value} class=${cx('fk-play', i < shown && 'is-done', i === shown - 1 && 'is-now')}>
                  <b>${step.value}</b>
                  ${step.seats.map((s) => html`<${Avatar} key=${s} player=${players[s]} size="xs" />`)}
                </span>
              `,
            )}
          </div>
        `}

        <div class="fk-hands">
          ${players.map(
            (p, s) => html`
              <div key=${s} class=${cx('fk-row', s === seat && 'is-me')}>
                <${Avatar} player=${p} size="xs" />
                <span class="fk-left">
                  ${Array.from({ length: MAX_CARD }, (_, i) => {
                    const v = i + 1;
                    const gone = !view.hands[s].includes(v) || (revealing && steps.some((step) => step.value === v && step.seats.includes(s)));
                    return html`<i key=${v} class=${cx(gone && 'is-gone')}>${v}</i>`;
                  })}
                </span>
              </div>
            `,
          )}
        </div>
      </div>

      <div class="panel">
        <p class=${cx('status', playing && picking && (view.myPick === null || (choice !== null && choice !== view.myPick)) && 'is-mine')}>${status}</p>

        ${log.length > 0 &&
        html`
          <div class="tb-log">
            ${!revealing && html`<b class="tb-log-title">さっきの番</b>`}
            ${log.map(
              (step) => html`
                <div key=${step.value} class=${cx('tb-step', step.result === 'over' ? 'is-bad' : step.result === 'exact' ? 'is-lead' : 'is-ok')}>
                  <b class="tb-num">${step.value}</b>
                  ${step.seats.map((s) => html`<${Avatar} key=${s} player=${players[s]} size="xs" />`)}
                  <span>なべ${POT_NAMES[step.pot]}：${step.before} → ${step.after}</span>
                  ${step.result === 'over' && html`<i class="tb-took">${step.seats.length > 1 ? `${step.seats.length}人とも ` : ''}${step.took}枚 引き取り</i>`}
                  ${step.result === 'exact' && html`<i class="tb-gain">ぴったり +${EXACT_BONUS}点</i>`}
                </div>
              `,
            )}
          </div>
        `}

        ${playing &&
        picking &&
        html`
          <div class="fk-cards">
            ${hand.map(
              (v) => html`
                <button
                  key=${v}
                  class=${cx('tb-card', v === room ? 'is-exact' : v < room ? 'is-safe' : 'is-far', v === selected && 'is-on')}
                  onClick=${() => setChoice(v)}
                  aria-pressed=${v === selected}
                >
                  <b>${v}</b>
                  <i>${v === room ? 'ぴったり' : v < room ? '入る' : 'あふれる'}</i>
                </button>
              `,
            )}
          </div>
          <p class="fk-hint">
            「入る」は、いまの なべ${POT_NAMES[target]}（あと ${room}）に、自分が最初に入れた場合です。先に小さいカードが入ると、あふれることがあります。
          </p>
          <button
            class="btn btn-primary btn-block"
            disabled=${selected === null || selected === view.myPick}
            onClick=${() => act({ type: 'pick', card: selected })}
          >
            ${view.myPick === null ? (selected === null ? 'カードを出す' : `「${selected}」を出す`) : selected !== view.myPick ? `「${selected}」に変える` : '出しました'}
          </button>
        `}

        ${view.over &&
        html`
          <div class="tb-round">
            <div class="tb-round-list">
              ${players.map(
                (p, s) => html`
                  <span key=${s} class="tb-chip"><${Avatar} player=${p} size="xs" /> 引き取り ${view.taken[s]}枚・ぴったり ${view.exacts[s]}回</span>
                `,
              )}
            </div>
          </div>
        `}

        <p class="tb-legend">
          ${LIMIT} をこえたら、入れた人がなべの中身を全部引き取ります（1枚 −1点）。ぴったり ${LIMIT} なら +${EXACT_BONUS}点。
        </p>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        全員が同じ 1〜${MAX_CARD} のカードを持っています。同時に1枚ずつ出して、なべに入れていきます。なべをあふれさせた人が、中身をまるごと引き取ります。大きいカードを、いつ出すかが勝負です。
      </p>
      <h3>準備</h3>
      <ul>
        <li>手札は全員おなじ。<b>1〜${MAX_CARD} が1枚ずつ</b>です。だれが何を残しているかは、いつでも見えます。</li>
        <li>なべは ${POTS}つ。最初は空です。</li>
      </ul>
      <h3>進め方</h3>
      <ol>
        <li>全員が同時に、手札から1枚えらんで出します。</li>
        <li>出そろったら、<b>数字の小さい順</b>に、なべへ入れていきます。</li>
        <li>入るのは、そのとき<b>いちばん中身（合計）の軽いなべ</b>です。同じ重さなら左のなべ。</li>
        <li><b>同じ数字</b>を出した人がいたら、まとめて同じなべに入ります。</li>
      </ol>
      <h3>ふきこぼれ</h3>
      <ul>
        <li>なべの合計が <b>${LIMIT} をこえたら</b>ふきこぼれ。入れた人が、<b>なべの中身を全部引き取ります</b>（1枚につき −1点）。なべは空になります。</li>
        <li>同じ数字でいっしょに入れた人は、<b>全員がそれぞれ</b>同じ枚数ぶん失点します。</li>
      </ul>
      <h3>ぴったり</h3>
      <p>合計を<b>ちょうど ${LIMIT}</b> にしたら <b>+${EXACT_BONUS}点</b>。なべは空になります。</p>
      <h3>終了</h3>
      <ul>
        <li>${MAX_CARD}枚すべて出し切ったら終了。点の高い人の勝ちです。</li>
        <li>同点なら、引き取った枚数が少ない人が上です。</li>
      </ul>
      <h3>コツ</h3>
      <ul>
        <li>小さいカードは先に入るので安全。大きいカードは後から入るので、前の人のぶんだけ苦しくなります。</li>
        <li>なべが空になった直後は、大きいカードを出すチャンス。ただし、みんなが同じことを考えます。</li>
        <li>ほかの人が 10 や 9 をもう出したかどうかを、見ておきましょう。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.points,
  unit: '点',
  progress: (view) => `${view.turn} / ${view.turns} 枚目`,
  waiting: (view) => !view.over && view.phase === 'pick',
  turnSound: false,
  turnSeats: (view, pending) => (view.phase === 'pick' ? pending : []),
  extra: (view, s) => `引取 ${view.taken[s]}枚`,
};
