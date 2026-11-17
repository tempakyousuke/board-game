// ドカン！導火線の盤面。

import { html, cx } from '../lib.js';
import { Avatar } from '../ui.js';
import { play, useChanged } from '../sound.js';

const CARD_NAMES = ['A', 'B', 'C'];

function Board({ view, seat, players, act }) {
  const { cardMin, cardMax, total } = view;
  const known = view.myPeek;
  const unknownCards = known ? 2 : 3;
  // 自分の知っている情報から言える、導火線の長さの範囲。
  const minLength = (known?.value ?? 0) + cardMin * unknownCards;
  const maxLength = (known?.value ?? 0) + cardMax * unknownCards;
  const trackMax = cardMax * 3;
  const revealed = view.fuse !== null;
  const length = revealed ? view.fuse.reduce((a, b) => a + b, 0) : null;
  const myTurn = view.phase === 'play' && view.turn === seat;
  const boom = view.boom;

  // 火が進むほど音が高くなる。爆発したら、その音だけを鳴らす。
  useChanged(view.history.length, (now, before) => {
    if (now <= before || view.boom) return;
    const last = view.history[now - 1];
    if (last.pass) play('step');
    else play('fuse', { level: Math.min(1, view.total / trackMax) });
  });
  useChanged(!!view.boom, (exploded) => {
    if (exploded) play('boom');
  });
  useChanged(view.round, () => play('card'));

  let status;
  if (view.phase === 'play') {
    status = myTurn ? 'あなたの番です。火をいくつ進めますか？' : `${players[view.turn]?.name ?? '?'} さんの番です`;
  } else {
    status = `${players[boom.seat]?.name ?? '?'} さんがドカン！`;
  }

  const peekers = (index) => view.peek.map((p, s) => (p === index ? s : -1)).filter((s) => s >= 0);

  return html`
    <div class="game dokan">
      <div class=${cx('dk-stage', boom && 'is-boom')}>
        <div class="dk-cards">
          ${CARD_NAMES.map((name, index) => {
            const mine = known && known.index === index;
            const value = revealed ? view.fuse[index] : mine ? known.value : null;
            return html`
              <div key=${index} class=${cx('dk-card', value !== null && 'is-open', mine && 'is-mine')}>
                <span class="dk-card-name">カード${name}</span>
                <span class="dk-card-value">${value ?? '?'}</span>
                <span class="dk-card-who">
                  ${peekers(index).map((s) => html`<${Avatar} key=${s} player=${players[s]} size="xs" />`)}
                  ${peekers(index).length === 0 && html`<small>だれも見ていない</small>`}
                </span>
              </div>
            `;
          })}
          <div class="dk-sum">
            <span>合計 =</span>
            <b>${revealed ? length : '？'}</b>
            <small>導火線の長さ</small>
          </div>
        </div>

        ${known &&
        !revealed &&
        html`
          <p class="dk-hint">
            あなたが見たのは <b>カード${CARD_NAMES[known.index]} = ${known.value}</b>。 導火線の長さは
            <b>${minLength}〜${maxLength}</b> のどこかです。
          </p>
        `}

        <div class="dk-track" style=${`--n:${trackMax}`} role="img" aria-label=${`火は ${total} まで進んでいます`}>
          ${Array.from({ length: trackMax }, (_, i) => {
            const step = i + 1;
            const burned = step <= total;
            const head = step === total;
            const end = revealed ? step === length : false;
            const danger = !revealed && step >= minLength && step <= maxLength;
            const beyond = revealed ? step > length : step > maxLength;
            return html`
              <span
                key=${step}
                class=${cx('dk-step', burned && 'is-burned', head && 'is-head', danger && 'is-danger', beyond && 'is-beyond', end && 'is-end')}
              >
                ${head && !boom && html`<i class="dk-flame">🔥</i>`}
                ${end && html`<i class="dk-bomb">${boom ? '💥' : '💣'}</i>`}
                ${step % 5 === 0 && html`<em>${step}</em>`}
              </span>
            `;
          })}
        </div>
        <div class="dk-total">
          <span>いまの火</span>
          <b>${total}</b>
          ${!revealed && html`<small>安全なのは ${minLength - 1} まで</small>`}
        </div>
      </div>

      <div class="panel">
        <p class=${cx('status', myTurn && 'is-mine', boom && 'is-boom')}>${status}</p>

        ${myTurn &&
        html`
          <div class="dk-actions">
            ${[1, 2, 3].map((add) => {
              const next = total + add;
              const safe = next < minLength;
              const doomed = next >= maxLength;
              return html`
                <button key=${add} class=${cx('dk-add', safe ? 'is-safe' : doomed ? 'is-doomed' : 'is-risky')} onClick=${() => act({ type: 'add', n: add })}>
                  <b>+${add}</b>
                  <small>火は ${next} に</small>
                  <i>${safe ? '安全' : doomed ? '確実にドカン' : 'キケン'}</i>
                </button>
              `;
            })}
            <button class="dk-add is-pass" disabled=${view.passLeft[seat] === 0} onClick=${() => act({ type: 'pass' })}>
              <b>パス</b>
              <small>0点</small>
              <i>${view.passLeft[seat] > 0 ? '1回だけ' : '使用ずみ'}</i>
            </button>
          </div>
        `}

        ${view.phase !== 'play' &&
        html`
          <div class="dk-result">
            <p>
              導火線は <b>${boom.fuse.join(' + ')} = ${boom.length}</b>。火が <b>${boom.total}</b> に届いて爆発しました。
            </p>
            <div class="dk-gains">
              ${boom.gained.map(
                (gain, s) => html`
                  <span key=${s} class=${cx('dk-gain', gain < 0 && 'is-bad')}>
                    <${Avatar} player=${players[s]} size="xs" />
                    <b>${gain > 0 ? `+${gain}` : gain}</b>
                    ${s === boom.seat && boom.lost > 0 && html`<small>（${boom.lost}点を没収）</small>`}
                  </span>
                `,
              )}
            </div>
            ${view.phase === 'reveal' &&
            seat >= 0 &&
            html`<button class="btn btn-primary btn-block" onClick=${() => act({ type: 'next' })}>つぎのラウンドへ</button>`}
          </div>
        `}

        ${view.history.length > 0 &&
        html`
          <div class="dk-history">
            <b>このラウンド</b>
            <div class="dk-history-items">
              ${view.history.map(
                (h, i) => html`
                  <span key=${i} class=${cx('dk-move', h.pass && 'is-pass')}>
                    <${Avatar} player=${players[h.seat]} size="xs" />
                    ${h.pass ? 'パス' : `+${h.add}`}
                  </span>
                `,
              )}
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
        爆弾の導火線に、みんなで少しずつ火を進めます。導火線の長さを正確に知っている人はいません。ギリギリまで進めて点をかせぎ、爆発はほかの人に押しつけましょう。
      </p>
      <h3>導火線の長さ</h3>
      <ul>
        <li>裏向きのカード3枚（それぞれ 4〜9）の<b>合計</b>が導火線の長さです。つまり 12〜27 のどこか。</li>
        <li>各プレイヤーは、3枚のうち<b>1枚だけ</b>こっそり見ています。だれがどのカードを見たかは全員にわかります。</li>
      </ul>
      <h3>自分の番</h3>
      <ul>
        <li>火を <b>1・2・3</b> のどれかだけ進めます。<b>進めた数がそのまま、このラウンドの得点</b>になります。</li>
        <li>または、ラウンドに1回だけ<b>パス</b>できます（0点）。</li>
      </ul>
      <h3>ドカン！</h3>
      <ul>
        <li>火が導火線の長さに届いたら爆発です。</li>
        <li>爆発させた人は、このラウンドでためた得点を<b>すべて失い、さらに −3点</b>。</li>
        <li>ほかの人は、このラウンドでためた得点をそのまま受け取ります。</li>
        <li>次のラウンドは、爆発させた人から始めます。</li>
      </ul>
      <h3>終了</h3>
      <p><b>5ラウンド</b>遊んで、合計点が高い人の勝ち。同点なら、爆発させた回数が少ない人が上です。</p>
      <h3>コツ</h3>
      <ul>
        <li>ほかの人の進め方をよく見ましょう。強気に3進める人は大きいカードを見ているのかも。それともハッタリ？</li>
        <li>パスは1回きり。本当に危なくなるまで取っておくか、早めに使って様子を見るか。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.points,
  unit: '点',
  progress: (view) => `ラウンド ${view.round} / ${view.maxRounds}`,
  waiting: () => false,
  turnSeats: (view, pending) => (view.phase === 'play' ? pending : []),
  extra: (view, s) => html`
    ${view.phase === 'play' && html`<span title="このラウンドでためた点">+${view.roundPoints[s]}</span>`}
    ${view.phase === 'play' && view.passLeft[s] > 0 && html` <i class="mini-tag">パス</i>`}
    ${view.booms[s] > 0 && ` ${'💥'.repeat(view.booms[s])}`}
  `,
};
