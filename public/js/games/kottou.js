// はったり骨董市の画面。

import { html, useState, useEffect, cx } from '../lib.js';
import { MAX_VALUE, TURNS_AS_DEALER } from '/shared/games/kottou.js';
import { Avatar } from '../ui.js';
import { play, useChanged } from '../sound.js';
import { BidBox } from './bidbox.js';

/** 損得の書き方: +3両 / −2両 / ±0両 */
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}両`;

/** 言い値と本当の価値をくらべた、ひとこと。 */
function askKind(ask, value) {
  if (ask > value) return { label: 'はったり', tone: 'is-bluff' };
  if (ask === value) return { label: 'ぴったり', tone: 'is-even' };
  return { label: `${value - ask}両 安く言った`, tone: 'is-low' };
}

/** 親が言い値を決める。えらんだ値で、スルーされたとき・買われたときの損得を先に見せる。 */
function AskPicker({ value, onAsk }) {
  const [amount, setAmount] = useState(null);
  useEffect(() => setAmount(null), [value]);
  const kept = amount === null ? null : value - amount;
  // 上乗せされると、いちばん安くて 言い値+1 で買われる。それが高づかみなら、その分が自分に入る。
  const sold = amount === null || amount >= MAX_VALUE ? null : Math.max(0, amount + 1 - value);
  return html`
    <div class="kt-ask">
      <div class="kt-nums" role="group" aria-label="言い値">
        ${Array.from({ length: MAX_VALUE }, (_, i) => i + 1).map(
          (v) => html`
            <button key=${v} class=${cx('kt-num', v === amount && 'is-on', v === value && 'is-true')} aria-pressed=${v === amount} onClick=${() => setAmount(v)}>
              ${v}${v === value && html`<small>価値</small>`}
            </button>
          `,
        )}
      </div>
      ${amount === null
        ? html`<p class="kt-preview">いくらで買うと言いますか？ 本当の価値と関係なく、いくらでも言えます。</p>`
        : html`
            <div class="kt-preview">
              <span>だれも乗らなければ <b class=${kept > 0 ? 'is-plus' : kept < 0 ? 'is-minus' : ''}>${signed(kept)}</b>（自分が ${amount}両で買い取る）</span>
              ${sold === null
                ? html`<span>${MAX_VALUE}両より上は言えないので、だれも乗れません</span>`
                : html`<span>${amount + 1}両で買われたら <b class=${sold > 0 ? 'is-plus' : ''}>${signed(sold)}</b>${sold > 0 ? '（相手の高づかみ）' : '（相手のもうけ）'}</span>`}
            </div>
          `}
      <button class="btn btn-primary btn-block" disabled=${amount === null} onClick=${() => onAsk(amount)}>
        📣 ${amount === null ? '言い値をえらぶ' : `「${amount}両で買う」と言う`}
      </button>
    </div>
  `;
}

function Board({ view, seat, players, act }) {
  const { phase, dealer } = view;
  const playing = seat >= 0 && !view.over;
  const name = (s) => (s === seat ? 'あなた' : `${players[s]?.name ?? '?'} さん`);
  const iAmDealer = seat === dealer;
  const myTurn = playing && (phase === 'declare' || phase === 'bid') && view.turn === seat;
  const open = phase === 'reveal' || view.over;
  const out = view.outcome;
  // 親のとなりから順に、1回ずつ。
  const order = Array.from({ length: view.n - 1 }, (_, i) => (dealer + 1 + i) % view.n);
  const callOf = (s) => view.calls.find((call) => call.seat === s);

  useChanged(view.round, () => play('card'));
  useChanged(view.ask, (now) => {
    if (now > 0) play('bark');
  });
  useChanged(view.calls.length, (now, before) => {
    if (now > before) play(view.calls[now - 1].pass ? 'step' : 'up');
  });
  useChanged(phase, (now) => {
    if (now !== 'reveal' || !out) return;
    const mine = seat >= 0 ? out.gains[seat] : 0;
    if (mine > 0) play('chime', { delay: 0.5 });
    else if (mine < 0) play('fail', { delay: 0.5 });
    else play('sold', { delay: 0.5 });
  });
  useChanged(myTurn, (mine) => {
    if (mine) play('turn');
  });

  let status;
  if (view.over) status = 'おつかれさまでした！';
  else if (phase === 'declare') status = iAmDealer ? 'あなたが親です。この品を、いくらで買うと言う？' : `親の${name(dealer)}が、言い値を考えています`;
  else if (phase === 'bid') status = view.turn === seat ? `もっと高い値で買う？ それともスルー？` : `${name(view.turn)}が考えています`;
  else if (out.buyer === dealer) status = `だれも乗らず、親の${name(dealer)}が買い取りました`;
  else status = `${name(out.buyer)}が ${out.price}両で買いました`;

  // 結果の文。
  let verdict = null;
  if (open && out) {
    const gain = out.gains[out.buyer];
    if (out.buyer === dealer) {
      verdict = {
        tone: gain > 0 ? 'is-good' : gain < 0 ? 'is-bad' : '',
        text:
          gain > 0
            ? `親の${name(dealer)}が、${out.value}両の品を ${out.price}両で買い取り。${signed(gain)}`
            : gain < 0
              ? `はったりが空ぶり。親の${name(dealer)}が、${out.value}両の品を ${out.price}両で買い取り。${signed(gain)}`
              : `親の${name(dealer)}が、ちょうどの値で買い取り。${signed(0)}`,
      };
    } else if (gain < 0) {
      verdict = { tone: 'is-bad', text: `高づかみ！ ${name(out.buyer)}は ${signed(gain)}。その ${-gain}両は、親の${name(dealer)}のものに` };
    } else if (gain > 0) {
      verdict = { tone: 'is-good', text: `掘り出し物！ ${name(out.buyer)}が、${out.value}両の品を ${out.price}両で。${signed(gain)}` };
    } else {
      verdict = { tone: '', text: `${name(out.buyer)}が、ちょうどの値で買いました。${signed(0)}` };
    }
  }

  // この親が、これまでにどう言ってきたか。
  const record = view.history.filter((h) => h.dealer === dealer && h.round !== view.round);

  return html`
    <div class="game kottou">
      <div class="kt-stage">
        <div class="tp-head">
          <b>${view.round}品目 ${view.item.name}</b>
          <span>親は ${name(dealer)}${iAmDealer || open ? '' : '（本当の価値を知っているのは、親だけ）'}</span>
        </div>

        <div class="kt-lot">
          <div class="kt-item" aria-hidden="true">${view.item.emoji}</div>
          <div class=${cx('kt-value', view.value === null ? 'is-hidden' : open ? 'is-open' : 'is-mine')} key=${`${view.round}:${open}`}>
            <small>本当の価値</small>
            <b>${view.value === null ? '？' : view.value}</b>
            <small>${view.value === null ? '1〜10両のどれか' : open ? '両' : '両・あなただけが知っている'}</small>
          </div>
        </div>

        <div class="kt-flow">
          <span class=${cx('kt-call is-dealer', phase === 'declare' && 'is-turn', open && out.buyer === dealer && 'is-buyer')}>
            <${Avatar} player=${players[dealer]} size="xs" />
            <span class="kt-call-who">親</span>
            <b>${phase === 'declare' ? '…' : `${view.ask}両`}</b>
          </span>
          ${order.map((s) => {
            const call = callOf(s);
            const turn = phase === 'bid' && view.turn === s;
            return html`
              <span key=${s} class=${cx('kt-call', turn && 'is-turn', call?.pass && 'is-pass', call && !call.pass && 'is-raise', open && out.buyer === s && 'is-buyer')}>
                <${Avatar} player=${players[s]} size="xs" />
                <b>${call ? (call.pass ? 'スルー' : `${call.amount}両`) : turn ? '…' : ''}</b>
              </span>
            `;
          })}
        </div>
        <p class="kt-now">
          ${phase === 'declare'
            ? '親が言い値を決めたら、となりから順に1回ずつ答えます'
            : open
              ? `${out.price}両で売れました`
              : view.high
                ? `いまの値は ${view.price}両（${name(view.high.seat)}）`
                : `親の言い値は ${view.ask}両。だれも乗らなければ、親が買い取ります`}
        </p>
      </div>

      <div class="panel">
        <p class=${cx('status', myTurn && 'is-mine')}>${status}</p>

        ${myTurn && phase === 'declare' && html`<${AskPicker} value=${view.value} onAsk=${(amount) => act({ type: 'ask', amount })} />`}

        ${myTurn &&
        phase === 'bid' &&
        html`
          <${BidBox}
            min=${view.price + 1}
            max=${MAX_VALUE}
            label=${(amount) => `${amount}両で買う！`}
            onBid=${(amount) => act({ type: 'raise', amount })}
            onPass=${() => act({ type: 'pass' })}
            passLabel="スルー"
            passNote="本当の価値が買った値より上ならもうけ。下なら損で、その分は親のものになります。"
          />
        `}

        ${verdict &&
        html`
          <div class="tb-round">
            <p class=${cx('tp-verdict', verdict.tone)}>本当の価値は ${out.value}両。${verdict.text}</p>
            ${!view.over && html`<p class="kt-next">まもなく、つぎの品物へ…</p>`}
          </div>
        `}

        ${!open &&
        !iAmDealer &&
        html`
          <div class="kt-record">
            <span class="kt-record-title">${name(dealer)}が親だったとき</span>
            ${record.length === 0
              ? html`<span class="kt-record-none">まだ記録がありません</span>`
              : record.map((h) => {
                  const kind = askKind(h.ask, h.value);
                  return html`<span key=${h.round} class=${cx('kt-tag', kind.tone)}>言い値 ${h.ask} → 本当は ${h.value}（${kind.label}）</span>`;
                })}
          </div>
        `}

        ${view.history.length > 0 &&
        html`
          <details class="kt-history" open=${view.over}>
            <summary>これまでの品物（${view.history.length}）</summary>
            <ol>
              ${view.history
                .slice()
                .reverse()
                .map((h) => {
                  const kind = askKind(h.ask, h.value);
                  const gain = h.gains[h.buyer];
                  return html`
                    <li key=${h.round}>
                      <span class="kt-h-item">${h.item.emoji}</span>
                      <span class="kt-h-main">
                        <span><${Avatar} player=${players[h.dealer]} size="xs" /> 言い値 <b>${h.ask}</b> → 本当は <b>${h.value}</b></span>
                        <span class=${cx('kt-tag', kind.tone)}>${kind.label}</span>
                      </span>
                      <span class="kt-h-sale">
                        <${Avatar} player=${players[h.buyer]} size="xs" /> ${h.buyer === h.dealer ? '買い取り' : `${h.price}両`}
                        <b class=${gain > 0 ? 'is-plus' : gain < 0 ? 'is-minus' : ''}>${signed(gain)}</b>
                      </span>
                    </li>
                  `;
                })}
            </ol>
          </details>
        `}

        <p class="tb-legend">買った人の得点は「本当の価値 − 払った値」。親でない人が高づかみをすると、その損した分が親の得点になります。</p>
      </div>
    </div>
  `;
}

function Rules() {
  const turns = [2, 3, 4, 5, 6].map((n) => `${n}人は ${TURNS_AS_DEALER[n]}回`).join('、');
  return html`
    <div class="rules">
      <p class="rules-lead">
        骨董市に、品物が1つずつ出てきます。本当の価値を知っているのは、親だけ。親が「5両で買う」と言ったら、それは掘り出し物を安く手に入れたいのか、ガラクタを高く売りつけたいのか。
      </p>
      <h3>3行でわかる</h3>
      <ul>
        <li>親だけが本当の価値（1〜${MAX_VALUE}両）を見て、<b>言い値</b>を言う。</li>
        <li>ほかの人は順番に1回ずつ、<b>もっと高い値で買う</b>か、<b>スルー</b>。</li>
        <li>いちばん高い値を言った人が買う。だれも言わなければ、<b>親が言い値で買い取る</b>。</li>
      </ul>
      <h3>進め方</h3>
      <ol>
        <li>親は、本当の価値と関係なく、1〜${MAX_VALUE}両の好きな値を言えます。</li>
        <li>親のとなりの人から順に、いまの値より高い値を言うか、スルーします。答えるのは1人1回だけです。</li>
        <li>1周したら売れて、本当の価値が全員に見えます。</li>
      </ol>
      <h3>得点</h3>
      <ul>
        <li>買った人：<b>本当の価値 − 払った値</b>。高く買いすぎると、マイナスです。</li>
        <li>親でない人が<b>高づかみ</b>（価値より高く買うこと）をしたら、その損した分が<b>親の得点</b>になります。</li>
        <li>親が自分で買い取ったときも、得点は「本当の価値 − 言い値」。はったりをスルーされると、自分が損をします。</li>
      </ul>
      <p>例：価値 3両の品に、親が「6両」と言う。だれかが 7両で買えば、その人は −4両、親は +4両。全員にスルーされたら、親が 6両で買い取って −3両。</p>
      <h3>終了</h3>
      <p>全員が同じ回数だけ親をしたら終了（${turns}）。合計の高い人の勝ち。同点なら、高づかみの少ない人が上です。</p>
      <h3>コツ</h3>
      <ul>
        <li>親のねらいは2つ。良い品を安く言って自分で買い取るか、安い品を高く言ってだれかに買わせるか。</li>
        <li>売れたあとは、言い値と本当の価値が全員に見えます。その人が親のときにどう言ってきたかは、画面に出ています。</li>
        <li>CPU も、あなたの言い方のくせを見ています。はったりが続くと乗ってこなくなり、安く言うのが続くと横取りされます。</li>
        <li>1 や 2 のような安すぎる言い値は、ほぼ必ず横取りされます。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.points,
  unit: '両',
  progress: (view) => `${view.round} / ${view.maxRounds} 品目`,
  waiting: () => false,
  turnSound: false,
  extra: (view, s) => {
    if (view.over) return '';
    if (s === view.dealer) return view.phase === 'declare' ? '親' : `親 ${view.ask}両`;
    const call = view.calls.find((c) => c.seat === s);
    if (!call) return '';
    return call.pass ? 'スルー' : `${call.amount}両`;
  },
};
