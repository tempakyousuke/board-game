// つみあげ注意の画面。

import { html, cx } from '../lib.js';
import { SAFE_CARDS, WASABI_CARDS, ROUNDS_BY_PLAYERS } from '/shared/games/tsumiage.js';
import { Avatar, paletteOf } from '../ui.js';
import { play, useChanged } from '../sound.js';
import { BidBox } from './bidbox.js';

function Board({ view, seat, players, act }) {
  const { phase } = view;
  const playing = seat >= 0 && !view.over;
  const c = view.challenger;
  const height = view.tower.length;
  const name = (s) => (s === seat ? 'あなた' : `${players[s]?.name ?? '?'} さん`);
  const myTurn = playing && (phase === 'stack' || phase === 'bid') && view.turn === seat;
  const open = phase === 'result' || view.over;
  const hand = view.myHand;
  const handLeft = hand ? hand.safe + hand.wasabi : 0;
  // いま話題になっている枚数 (宣言中はその数、めくっているあいだは挑戦の数)。
  const marked = phase === 'bid' ? view.bid.amount : phase === 'flip' || open ? view.need : 0;

  useChanged(height, (now, before) => {
    if (now > before) play('place');
  });
  useChanged(view.calls.length, (now, before) => {
    if (now > before) play(view.calls[now - 1].pass ? 'step' : 'up');
  });
  useChanged(view.flipped, (now, before) => {
    if (now <= before) return;
    const card = view.tower[height - now];
    if (card.card === 'wasabi') play(c === seat ? 'fail' : 'boom');
    else play(now === view.need ? 'chime' : 'pop', { level: Math.min(1, now / Math.max(1, view.need)) });
  });
  useChanged(myTurn, (mine) => {
    if (mine) play('turn');
  });
  useChanged(view.round, () => play('card'));

  let status;
  if (view.over) status = 'おつかれさまでした！';
  else if (phase === 'stack') {
    if (view.turn !== seat) status = `${name(view.turn)}の番です`;
    else if (handLeft === 0) status = '置く札がありません。宣言しましょう';
    else status = view.mayDeclare ? '1枚置く？ それとも、めくると宣言する？' : '1枚置きましょう（最初の1周は置くだけ）';
  } else if (phase === 'bid') status = view.turn === seat ? 'もっと多くめくる？ それともパス？' : `${name(view.turn)}が考えています`;
  else if (phase === 'flip') status = `${name(c)}が上から ${view.need}枚 めくります… ${view.flipped} / ${view.need}`;
  else status = view.outcome.success ? `${name(c)}が ${view.need}枚 めくりきりました！` : view.outcome.hit === c ? `${name(c)}が、自分のわさびをめくりました…` : `${name(c)}が、${name(view.outcome.hit)}のわさびをめくりました！`;

  // 塔は上から順に描く。
  const fromTop = view.tower.map((card, i) => ({ ...card, depth: height - i })).reverse();
  const justFlipped = phase === 'flip' || open ? view.flipped : 0;

  return html`
    <div class="game tsumiage">
      <div class="tw-stage">
        <div class="tp-head">
          ${phase === 'stack'
            ? html`<b>塔は ${height}枚</b><span>${view.mayDeclare ? 'だれかが宣言するまで、積んでいきます' : '最初の1周は、全員が1枚ずつ置きます'}</span>`
            : phase === 'bid'
              ? html`<b>いまの宣言 上から ${view.bid.amount}枚</b><span>${name(view.bid.seat)}・塔は ${height}枚</span>`
              : html`<b>上から ${view.need}枚に挑戦</b><span>${name(c)}・めくった数 ${view.flipped} / ${view.need}</span>`}
        </div>

        <div class="tw-tower" role="list" aria-label=${`塔は ${height}枚`}>
          ${height === 0 && html`<p class="tw-empty">まだ1枚も置かれていません</p>`}
          ${fromTop.map((card) => {
            const mine = card.seat === seat;
            const known = card.card !== null;
            const inRange = marked > 0 && card.depth <= marked;
            return html`
              <div
                key=${card.depth}
                role="listitem"
                class=${cx('tw-card', inRange && 'is-marked', card.flipped && 'is-flipped', known && `is-${card.card}`, card.flipped && card.depth === justFlipped && 'is-fresh', mine && 'is-mine')}
                style=${`--c:${paletteOf(players[card.seat]).color}`}
              >
                <span class="tw-depth">${card.depth}</span>
                <${Avatar} player=${players[card.seat]} size="xs" />
                <span class="tw-owner">${mine ? 'あなた' : players[card.seat]?.name ?? '?'}</span>
                <span class="tw-face">
                  ${known ? (card.card === 'wasabi' ? (card.flipped ? '💥 わさび' : 'わさび') : card.flipped ? '✓ たこ焼き' : 'たこ焼き') : '？'}
                </span>
              </div>
            `;
          })}
        </div>

        <div class="tw-hands">
          ${players.map(
            (p, s) => html`
              <span key=${s} class=${cx('tb-chip', (phase === 'stack' || phase === 'bid') && s === view.turn && 'is-turn', view.passed[s] && phase === 'bid' && 'is-pass')}>
                <${Avatar} player=${p} size="xs" /> 残り ${view.handCount[s]}枚${s === c ? '・挑戦' : view.passed[s] && phase === 'bid' ? '・パス' : ''}
              </span>
            `,
          )}
        </div>
      </div>

      <div class="panel">
        <p class=${cx('status', myTurn && 'is-mine')}>${status}</p>

        ${myTurn &&
        phase === 'stack' &&
        html`
          ${handLeft > 0 &&
          html`
            <div class="row">
              <button class="btn tw-put is-safe" disabled=${hand.safe === 0} onClick=${() => act({ type: 'place', card: 'safe' })}>
                たこ焼きを置く<small>残り ${hand.safe}枚</small>
              </button>
              <button class="btn tw-put is-wasabi" disabled=${hand.wasabi === 0} onClick=${() => act({ type: 'place', card: 'wasabi' })}>
                わさびを置く<small>残り ${hand.wasabi}枚</small>
              </button>
            </div>
          `}
          ${view.mayDeclare &&
          html`
            ${handLeft > 0 && html`<p class="tw-or">または</p>`}
            <${BidBox} min=${1} max=${height} label=${(amount) => `上から ${amount}枚 めくる！`} onBid=${(amount) => act({ type: 'bid', amount })} />
          `}
        `}

        ${myTurn &&
        phase === 'bid' &&
        html`
          <${BidBox}
            min=${view.bid.amount + 1}
            max=${height}
            label=${(amount) => `上から ${amount}枚 めくる！`}
            onBid=${(amount) => act({ type: 'bid', amount })}
            onPass=${() => act({ type: 'pass' })}
          />
        `}

        ${view.calls.length > 0 &&
        html`
          <div class="tp-calls">
            <span>宣言の流れ</span>
            ${view.calls.map(
              (call, i) => html`
                <span key=${i} class=${cx('tb-chip', call.pass && 'is-pass')}><${Avatar} player=${players[call.seat]} size="xs" /> ${call.pass ? 'パス' : `${call.amount}枚`}</span>
              `,
            )}
          </div>
        `}

        ${open &&
        html`
          <div class="tb-round">
            <p class=${cx('tp-verdict', view.outcome.success ? 'is-good' : 'is-bad')}>
              ${view.outcome.success
                ? `成功！ ${name(c)}に +${view.need}点`
                : view.outcome.hit === c
                  ? `自滅… ${name(c)}は −${view.need}点`
                  : `わさび！ ${name(c)}の ${view.need}点が、${name(view.outcome.hit)}へ`}
            </p>
            ${phase === 'result' && seat >= 0 && html`<button class="btn btn-primary btn-block" onClick=${() => act({ type: 'next' })}>つぎのラウンドへ</button>`}
          </div>
        `}

        <p class="tb-legend">めくりきれば宣言した数が得点。わさびが出ると、宣言した数だけ失点して、置いた人の得点に。めくるのは上から順です。</p>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        全員で、1本の塔に札を伏せて積んでいきます。中身はたこ焼きか、わさびか。「上から何枚めくれる！」と言い合い、いちばん大きく出た人がめくります。めくる順番は選べません。直前に置いた人を、信じられますか？
      </p>
      <h3>準備</h3>
      <p>各自、<b>たこ焼き ${SAFE_CARDS}枚</b>と<b>わさび ${WASABI_CARDS}枚</b>を持ちます。</p>
      <h3>自分の番</h3>
      <ul>
        <li>手札から1枚を、<b>伏せて塔のいちばん上に置く</b>。または、</li>
        <li>「<b>上から N 枚めくる</b>」と<b>宣言する</b>。</li>
      </ul>
      <p>最初の1周は、全員が置くだけです。手札がなくなった人は、宣言するしかありません。</p>
      <h3>宣言が出たら</h3>
      <ul>
        <li>あとの人は順に、<b>もっと多い枚数</b>を言うか、<b>パス</b>します。</li>
        <li>パスした人はおります。最後まで残った人が<b>挑戦者</b>です。</li>
      </ul>
      <h3>挑戦</h3>
      <ul>
        <li>挑戦者は、塔の<b>上から順に</b>、宣言した枚数をめくります（自動で1枚ずつめくられます）。</li>
        <li>全部たこ焼きなら<b>成功</b>。わさびが出たら、その場で<b>失敗</b>です。</li>
      </ul>
      <h3>得点</h3>
      <ul>
        <li><b>成功</b>：宣言した数が、そのまま得点。</li>
        <li><b>失敗</b>：宣言した数だけ失点。その点は、<b>そのわさびを置いた人</b>のものになります。</li>
        <li>自分のわさびを自分でめくったら、失点するだけです。</li>
      </ul>
      <h3>見えるもの</h3>
      <ul>
        <li>だれが何番目に置いたかは、全員に見えています。</li>
        <li>中身を知っているのは、置いた本人だけです。</li>
      </ul>
      <h3>終了</h3>
      <p>
        最初に置く人が全員に同じ回数まわったら終了（3人は ${ROUNDS_BY_PLAYERS[3]}、4人は ${ROUNDS_BY_PLAYERS[4]}、5人は ${ROUNDS_BY_PLAYERS[5]}、6人は
        ${ROUNDS_BY_PLAYERS[6]} ラウンド）。点の高い人の勝ち。同点なら、挑戦に成功した回数が多い人が上です。
      </p>
      <h3>コツ</h3>
      <ul>
        <li>いちばん上の札の中身を知っているのは、直前に置いた人だけ。その人が強気に上げてきたら、たぶん安全です。たぶん。</li>
        <li>自分のわさびが上の方にあるとき、わざと宣言して、上げてきた人にめくらせる手があります。だれも上げなければ、自分でめくることになります。</li>
        <li>わさびの上に札が積まれるほど、浅い宣言は安全になります。</li>
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
  turnSound: false,
  turnSeats: (view, pending) => (view.phase === 'result' ? [] : pending),
  extra: (view, s) => {
    if (s === view.challenger) return '挑戦';
    if (view.phase === 'bid' && view.passed[s]) return 'パス';
    return `残り ${view.handCount[s]}枚`;
  },
};
