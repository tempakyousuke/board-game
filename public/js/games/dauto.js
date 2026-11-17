// みんなでダウトの画面。

import { html, useState, useEffect, cx } from '../lib.js';
import { FACES, MIN_FACE, WILD, DICE_BY_PLAYERS, countFace, minQuantity } from '/shared/games/dauto.js';
import { Avatar, Die } from '../ui.js';
import { play, useChanged } from '../sound.js';

const CLAIM_FACES = Array.from({ length: FACES - MIN_FACE + 1 }, (_, i) => MIN_FACE + i);

/** 「ふつうは 3〜4個」のような、ざっくりした目安。サイコロ1個が数えられるのは3回に1回。 */
function roughly(dice) {
  const low = Math.floor(dice / 3);
  const high = Math.ceil(dice / 3);
  return low === high ? `${low}個` : `${low}〜${high}個`;
}

function Board({ view, seat, players, act }) {
  const { claim, reveal, phase } = view;
  const playing = seat >= 0 && !view.over;
  const mine = view.myDice;
  // 場に出ている宣言をした人。全員が信じたあとは、次に宣言する人 (view.claimant) とは別人になる。
  const owner = reveal ? reveal.seat : view.claims.length > 0 ? view.claims[view.claims.length - 1].seat : -1;
  const speaker = reveal ? reveal.seat : view.claimant;
  const myClaim = playing && phase === 'claim' && view.claimant === seat;
  const myBetTurn = playing && phase === 'bet' && view.claimant !== seat;
  const waitingFor = view.submitted.filter((done, s) => !done && s !== view.claimant).length;
  const callName = (s) => (s === seat ? 'あなた' : `${players[s]?.name ?? '?'} さん`);

  // 宣言を組み立てているあいだの選択。宣言が進むたびに、えらび直しになる。
  const [pick, setPick] = useState(null);
  const [rolling, setRolling] = useState(false);
  const claimKey = `${view.round}:${view.claims.length}`;
  useEffect(() => setPick(null), [claimKey]);
  useEffect(() => {
    setRolling(true);
    const timer = setTimeout(() => setRolling(false), 450);
    return () => clearTimeout(timer);
  }, [view.round]);

  useChanged(`${claimKey}:${phase}`, () => {
    if (phase === 'bet') play('card');
    else if (phase === 'claim') {
      play(view.claims.length === 0 ? 'dice' : 'up');
      // 宣言の番が来た人にだけ、番の音も鳴らす。
      if (view.claimant === seat) play('turn', { delay: 0.3 });
    } else {
      play('whoosh');
      const lost = reveal.losers.includes(seat);
      play(seat < 0 ? (reveal.truth ? 'chime' : 'fail') : lost ? 'fail' : 'chime', { delay: 0.35 });
    }
  });
  useChanged(view.myBet, (bet) => {
    if (bet !== null) play('pop');
  });

  // ---- 宣言の組み立て ----
  const others = mine ? view.total - mine.length : view.total;
  const usable = CLAIM_FACES.filter((f) => minQuantity(claim, f) <= view.total);
  // 最初は、自分がいちばん多く持っている目をえらんでおく。
  const favorite = mine ? usable.reduce((best, f) => (countFace(mine, f) >= countFace(mine, best) ? f : best), usable[0]) : usable[0];
  const face = pick?.f ?? favorite;
  const minQ = minQuantity(claim, face);
  const qty = Math.min(view.total, Math.max(minQ, pick?.q ?? minQ));

  // ---- いま強調する目 (自分のサイコロのうち、数えられるもの) ----
  const focus = reveal ? reveal.claim.f : myClaim ? face : claim ? claim.f : null;
  const counted = (d) => focus !== null && (d === focus || d === WILD);

  let status;
  if (view.over) status = 'サイコロがなくなった人がいます。ゲーム終了！';
  else if (phase === 'reveal') {
    status = reveal.truth
      ? '宣言は本当でした！「うそ」に賭けた人がサイコロを失います'
      : '宣言はうそでした！ 宣言した人と「本当」に賭けた人がサイコロを失います';
  } else if (phase === 'claim') {
    const believed = view.claims.length > 0;
    if (myClaim) status = believed ? '全員が「本当」に賭けました。もっと大きい宣言をしましょう' : 'あなたの番です。最初の宣言をしましょう';
    else status = believed ? `全員が「本当」に賭けました。${callName(view.claimant)}がもっと大きい宣言をします` : `${callName(view.claimant)}が宣言を考えています`;
  } else if (seat === view.claimant) status = `みんなが賭けています…（あと ${waitingFor} 人）`;
  else if (!myBetTurn) status = `あと ${waitingFor} 人が考えています`;
  else if (view.myBet === null) status = 'この宣言は本当？ それとも、うそ？';
  else status = waitingFor > 0 ? `「${view.myBet ? '本当' : 'うそ'}」に賭けました。あと ${waitingFor} 人を待っています…` : '全員そろいました';

  /** 1人ぶんの行。ふだんは自分のサイコロだけが見え、答え合わせでは全員ぶんを開く。 */
  const row = (s) => {
    const isMe = s === seat;
    const open = reveal ? reveal.hands[s] : isMe ? mine : null;
    const shown = open ? open.length : view.counts[s];
    const lostNow = reveal?.losers.includes(s);
    const bet = reveal ? reveal.bets[s] : null;
    const right = reveal && s !== reveal.seat ? bet === reveal.truth : null;

    let mark = null;
    if (s === speaker) {
      mark = html`<i class="du-tag is-claimant">📣 ${phase === 'claim' ? '宣言中' : '宣言'}</i>`;
    } else if (reveal) {
      mark = html`<i class=${cx('du-tag', bet ? 'is-true' : 'is-false')}>${bet ? '本当' : 'うそ'} ${right ? '◎' : '✕'}</i>`;
    } else if (phase === 'bet') {
      if (isMe && view.myBet !== null) mark = html`<i class=${cx('du-tag', view.myBet ? 'is-true' : 'is-false')}>${view.myBet ? '本当' : 'うそ'}</i>`;
      else mark = html`<i class="du-tag">${view.submitted[s] ? '✅ 賭けた' : '🤔 考え中'}</i>`;
    }

    return html`
      <div key=${s} class=${cx('du-row', isMe && 'is-me', lostNow && 'is-lost')}>
        <span class="du-who">
          <${Avatar} player=${players[s]} size="sm" />
          <span class="du-name">${isMe ? 'あなた' : players[s]?.name ?? '?'}</span>
        </span>
        <span class="du-dice" aria-label=${open ? undefined : `サイコロ ${shown} 個（見えません）`}>
          ${open
            ? open.map((d, i) => html`<${Die} key=${i} value=${d} size=${isMe ? 'md' : 'sm'} rolling=${rolling && !reveal} tone=${counted(d) ? 'hit' : focus !== null ? 'dim' : ''} />`)
            : Array.from({ length: shown }, (_, i) => html`<span key=${i} class="die die-sm du-hidden"><i>?</i></span>`)}
          ${Array.from({ length: Math.max(0, view.dice - shown) }, (_, i) => html`<span key=${`x${i}`} class=${cx('du-gone', isMe && !reveal && 'is-big')}></span>`)}
        </span>
        <span class="du-mark">
          ${mark}
          ${lostNow && html`<b class="du-minus">−1</b>`}
        </span>
      </div>
    `;
  };

  const seats = players.map((_, s) => s);
  const order = seat >= 0 ? [seat, ...seats.filter((s) => s !== seat)] : seats;
  const shownClaim = reveal ? reveal.claim : claim;
  const inPlay = reveal ? reveal.hands.reduce((sum, hand) => sum + hand.length, 0) : view.total;
  const trail = view.claims.slice(0, -1);

  // ---- 賭けるときの手がかり ----
  let hint = null;
  if (mine && claim && myBetTurn) {
    const own = countFace(mine, claim.f);
    const need = claim.q - own;
    if (need <= 0) hint = html`あなたの手元だけで <b>${own}個</b> あります。この宣言は<b>かならず本当</b>です。`;
    else if (need > others) hint = html`ほかの人のサイコロは ${others}個しかありません。この宣言は<b>かならず うそ</b>です。`;
    else {
      hint = html`あなたの手元に <${Die} value=${claim.f} size="xs" /> は <b>${own}個</b>。本当なら、ほかの ${others}個の中に
        <b>${need}個以上</b>あるはず（ふつうは ${roughly(others)}くらい）。`;
    }
  }
  const nextUp = (view.claimant + 1) % view.n === seat;

  return html`
    <div class="game dauto">
      <div class="du-stage">
        <div class=${cx('du-claim', reveal && (reveal.truth ? 'is-true' : 'is-false'))}>
          ${shownClaim
            ? html`
                <span class="du-claim-by"><${Avatar} player=${players[owner]} size="xs" /> ${callName(owner)}の宣言</span>
                <div class="du-claim-main">
                  <${Die} value=${shownClaim.f} size="lg" />
                  <span>が</span>
                  <b>${shownClaim.q}</b>
                  <span>個以上ある！</span>
                </div>
                ${reveal &&
                html`<p class="du-verdict">
                  数えてみると <b>${reveal.real}個</b>。${reveal.truth ? '本当でした！' : 'うそでした！'}
                </p>`}
              `
            : html`<p class="du-claim-empty">${myClaim ? 'あなたが最初の宣言をします' : `${callName(view.claimant)}が最初の宣言を考えています…`}</p>`}
          <small class="du-note"><${Die} value=${WILD} size="xs" /> はどの目にも数えます ・ サイコロは全部で ${inPlay}個</small>
        </div>

        ${trail.length > 0 &&
        !reveal &&
        html`
          <div class="du-trail">
            <span>ここまで</span>
            ${trail.map(
              (c, i) => html`
                <span key=${i} class="du-chip">
                  <${Avatar} player=${players[c.seat]} size="xs" />
                  <${Die} value=${c.f} size="xs" /> ${c.q}個
                </span>
              `,
            )}
          </div>
        `}

        <div class="du-table">${order.map(row)}</div>
      </div>

      <div class="panel">
        <p class=${cx('status', (myClaim || (myBetTurn && view.myBet === null)) && 'is-mine')}>${status}</p>

        ${myClaim &&
        html`
          <div class="du-builder">
            <div class="du-faces">
              ${CLAIM_FACES.map(
                (f) => html`
                  <button
                    key=${f}
                    class=${cx('du-face', f === face && 'is-on')}
                    disabled=${!usable.includes(f)}
                    onClick=${() => setPick({ f, q: pick?.q ?? null })}
                    aria-pressed=${f === face}
                    aria-label=${`${f}の目で宣言する`}
                  >
                    <${Die} value=${f} size="sm" />
                    <small>手元に${countFace(mine, f)}</small>
                  </button>
                `,
              )}
            </div>
            <div class="du-qty">
              <button class="du-step" disabled=${qty <= minQ} onClick=${() => setPick({ f: face, q: qty - 1 })} aria-label="1個へらす">−</button>
              <span class="du-qty-value"><b>${qty}</b>個以上</span>
              <button class="du-step" disabled=${qty >= view.total} onClick=${() => setPick({ f: face, q: qty + 1 })} aria-label="1個ふやす">＋</button>
            </div>
            <p class="du-hint">
              あなたの手元に <${Die} value=${face} size="xs" /> は <b>${countFace(mine, face)}個</b>（<${Die} value=${WILD} size="xs" /> をふくむ）。ほかの
              ${others}個の中には、ふつう ${roughly(others)}くらいあります。
            </p>
            <button class="btn btn-primary btn-block du-declare" onClick=${() => act({ type: 'claim', q: qty, f: face })}>
              📣 「<${Die} value=${face} size="xs" /> が ${qty}個以上ある」と宣言する
            </button>
          </div>
        `}

        ${myBetTurn &&
        html`
          <div class="du-bets">
            <button
              class=${cx('du-bet is-true', view.myBet === true && 'is-on', view.myBet === false && 'is-off')}
              onClick=${() => act({ type: 'bet', believe: true })}
              aria-pressed=${view.myBet === true}
            >
              <b>⭕ 本当</b>
              <small>${shownClaim.q}個以上ある</small>
            </button>
            <button
              class=${cx('du-bet is-false', view.myBet === false && 'is-on', view.myBet === true && 'is-off')}
              onClick=${() => act({ type: 'bet', believe: false })}
              aria-pressed=${view.myBet === false}
            >
              <b>❌ うそ</b>
              <small>${shownClaim.q}個もない</small>
            </button>
          </div>
          ${hint && html`<p class="du-hint">${hint}</p>`}
          ${(nextUp || view.myBet !== null) &&
          html`<p class="du-hint is-soft">
            ${view.myBet !== null && '全員がそろうまでは、えらび直せます。'}
            ${nextUp && '全員が「本当」なら、次はあなたがもっと大きい宣言をします。'}
          </p>`}
        `}

        ${reveal &&
        html`
          <div class="du-result">
            ${reveal.losers.length > 0
              ? html`<p class="du-losers">
                  ${reveal.losers.map((s) => html`<${Avatar} key=${s} player=${players[s]} size="xs" />`)}
                  <span>がサイコロを1個失いました</span>
                </p>`
              : html`<p class="du-losers"><span>全員が当てたので、だれもサイコロを失いません</span></p>`}
            ${seat >= 0 &&
            html`<p class=${cx('du-me', reveal.losers.includes(seat) ? 'is-bad' : 'is-good')}>
              ${reveal.losers.includes(seat)
                ? seat === reveal.seat
                  ? 'うそがばれました…'
                  : '読みが外れました…'
                : seat === reveal.seat && reveal.truth
                  ? `${reveal.losers.length}人を引っかけました！`
                  : seat === reveal.seat
                    ? 'だれも失わずにすみました'
                    : '読みが当たりました！'}
            </p>`}
            ${phase === 'reveal' &&
            seat >= 0 &&
            html`<button class="btn btn-primary btn-block" onClick=${() => act({ type: 'next' })}>つぎのラウンドへ</button>`}
          </div>
        `}

        ${view.over &&
        html`
          <div class="du-tricked">
            <span>本当の宣言で引っかけた人数</span>
            ${seats.map(
              (s) => html`
                <span key=${s} class="du-chip">
                  <${Avatar} player=${players[s]} size="xs" /> ${view.tricked[s]}人
                </span>
              `,
            )}
          </div>
        `}

        <p class="du-legend">賭けを外すとサイコロを1個失います。だれかが0個になったら終了、残りが多い人の勝ち。</p>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules du-rules">
      <p class="rules-lead">
        全員がサイコロをふって、自分のぶんだけを見ます。「全員のサイコロを合わせると、5 が 4個以上ある！」と宣言する人と、それが本当かうそかを見ぬく人たちのだまし合いです。
      </p>
      <h3>準備</h3>
      <ul>
        <li>サイコロは1人 <b>${DICE_BY_PLAYERS[4]}個</b>（2〜3人で遊ぶときは ${DICE_BY_PLAYERS[2]}個）。ラウンドの最初に全員がふり、<b>自分のサイコロだけ</b>を見ます。</li>
        <li><${Die} value=${WILD} size="xs" /> は<b>ワイルド</b>。どの目にも数えます。</li>
      </ul>
      <h3>1. 宣言する</h3>
      <ul>
        <li>番の人が「<b>○の目が、全員あわせて△個以上ある</b>」と宣言します。宣言に使える目は 2〜6 です。</li>
        <li>本当のことを言っても、うそを言ってもかまいません。</li>
      </ul>
      <h3>2. みんなで賭ける</h3>
      <p>宣言した人以外の全員が、<b>同時に、こっそり</b>「本当」か「うそ」に賭けます。</p>
      <ul>
        <li><b>全員が「本当」</b>なら、答え合わせはしません。次の人が<b>もっと大きい宣言</b>（個数を増やすか、同じ個数で大きい目）をします。</li>
        <li><b>1人でも「うそ」</b>に賭けたら、全員のサイコロを公開して答え合わせです。</li>
      </ul>
      <h3>3. 答え合わせ</h3>
      <ul>
        <li>宣言が<b>本当</b>だった：「うそ」に賭けた人が、サイコロを1個ずつ失います。</li>
        <li>宣言が<b>うそ</b>だった：宣言した人と、「本当」に賭けた人が、サイコロを1個ずつ失います。</li>
        <li>全員がふり直して次のラウンドへ。宣言した人の次の人から始めます。</li>
      </ul>
      <h3>終了</h3>
      <ul>
        <li>だれかのサイコロが <b>0個</b>になったら終了。<b>残りが多い人の勝ち</b>です。</li>
        <li>同じ個数なら、本当の宣言で「うそ」と言わせた人数（引っかけた人数）が多い人が上です。</li>
      </ul>
      <h3>こまかいルール</h3>
      <ul>
        <li>これ以上大きい宣言がないとき（全部の個数で 6 の目）は、全員が「本当」でも答え合わせをします。</li>
      </ul>
      <h3>コツ</h3>
      <ul>
        <li>宣言する人のねらいは<b>「本当なのに、うそっぽく聞こえる宣言」</b>。自分がたくさん持っている目で、強気に言ってみましょう。</li>
        <li>サイコロ1個がある目に数えられるのは、3回に1回（その目か <${Die} value=${WILD} size="xs" />）。全部で12個なら、ふつうは4個くらいです。</li>
        <li>全員が信じると、次の人はもっと大きい宣言をしなければなりません。自分が次の番なら、苦しくなる前に「うそ」と言う手もあります。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.counts,
  unit: '個',
  progress: (view) => `ラウンド ${view.round}`,
  waiting: () => false,
  // 賭けは宣言のたびに全員に来るので、いつもの番の音は鳴らさない (宣言の番の音は盤面の側で鳴らす)。
  turnSound: false,
  turnSeats: (view, pending) => (view.phase === 'reveal' ? [] : pending),
  extra: (view, s) => {
    if (view.over) return view.tricked[s] > 0 ? `引っかけ ${view.tricked[s]}人` : '';
    if (view.phase === 'reveal') return view.reveal.losers.includes(s) ? '−1' : '';
    if (s === view.claimant) return view.phase === 'claim' ? '📣 宣言中' : '📣 宣言';
    if (view.phase === 'bet') return view.submitted[s] ? '✅' : '🤔';
    return '';
  },
};
