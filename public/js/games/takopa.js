// ロシアンたこパの画面。「わさび係はだれだ」も同じ盤面を使う (view.mode で出し分ける)。

import { html, useState, useEffect, cx } from '../lib.js';
import { SLOTS, BET_REWARD, ROUNDS_BY_PLAYERS } from '/shared/games/takopa.js';
import { Avatar } from '../ui.js';
import { play, useChanged } from '../sound.js';
import { BidBox } from './bidbox.js';

const SLOT_NAMES = ['1番目（手前）', '2番目', '3番目（奥）'];

/** たこ焼き1個。kind: null = 中身がわからない / 'safe' / 'wasabi'。eaten: もう食べられた。 */
function Piece({ kind, eaten, fresh }) {
  const label = eaten ? (kind === 'wasabi' ? 'わさび入りだった' : '食べた（セーフ）') : kind === 'wasabi' ? 'わさび入り' : kind === 'safe' ? 'ふつうのたこ焼き' : '中身はわからない';
  return html`
    <span class=${cx('tp-piece', kind && `is-${kind}`, eaten && 'is-eaten', fresh && 'is-fresh')} role="img" aria-label=${label}>
      ${eaten ? (kind === 'wasabi' ? '💥' : '✓') : kind === 'wasabi' ? 'わ' : kind === null ? '?' : ''}
    </span>
  `;
}

/** 仕込みの見本: わさびを slot 番目に入れた皿。 */
function PlatePreview({ slot }) {
  return html`<span class="tp-plate is-small">${Array.from({ length: SLOTS }, (_, k) => html`<${Piece} key=${k} kind=${slot === k + 1 ? 'wasabi' : 'safe'} />`)}</span>`;
}

export function Board({ view, seat, players, act }) {
  const { phase, mode } = view;
  const role = mode === 'role';
  const playing = seat >= 0 && !view.over;
  const c = view.challenger;
  const name = (s) => (s === seat ? 'あなた' : `${players[s]?.name ?? '?'} さん`);
  const myTurn = playing && ((phase === 'bid' && view.turn === seat) || (phase === 'eat' && c === seat));
  const eatenTotal = view.log.length;
  const last = view.log[eatenTotal - 1];
  const open = phase === 'result' || view.over;

  const [choice, setChoice] = useState(null);
  useEffect(() => setChoice(null), [view.round]);
  const picked = choice ?? view.myChoice;

  useChanged(`${view.round}:${phase}`, () => {
    if (phase === 'setup' || phase === 'bet') play('card');
    else if (phase === 'bid') play('start');
  });
  useChanged(view.calls.length, (now, before) => {
    if (now > before) play(view.calls[now - 1].pass ? 'step' : 'up');
  });
  useChanged(eatenTotal, (now, before) => {
    if (now <= before) return;
    if (last.wasabi) play(c === seat ? 'fail' : 'boom');
    else play(now === view.need ? 'chime' : 'pop', { level: Math.min(1, now / Math.max(1, view.need)) });
  });
  useChanged(myTurn, (mine) => {
    if (mine) play('turn');
  });
  useChanged(`${view.myChoice}:${view.myBet}`, () => {
    if (view.myChoice !== null || view.myBet !== null) play('place');
  });

  // ---- いま何をする場面か ----
  const waitingSetup = view.ready.filter((done) => !done).length;
  const waitingBets = view.betDone.filter((done, s) => !done && s !== c).length;
  const ownLeft = c >= 0 ? Math.max(0, Math.min(SLOTS, view.need) - view.eaten[c]) : 0;
  let status;
  if (view.over) status = 'おつかれさまでした！';
  else if (phase === 'setup') {
    if (seat < 0) status = `皿を仕込んでいます…（あと ${waitingSetup} 人）`;
    else if (view.myChoice !== null && (choice === null || choice === view.myChoice)) status = waitingSetup > 0 ? `仕込みました。あと ${waitingSetup} 人を待っています…` : '全員そろいました';
    else status = role ? 'もし「わさび係」になったら、何番目に入れる？' : '皿を仕込みます。わさび入りを入れる？';
  } else if (phase === 'bid') {
    if (view.turn === seat) status = view.bid ? '何個食べられる？ 上げるか、パスか' : 'あなたが親です。最初の宣言をしましょう';
    else status = `${name(view.turn)}が考えています`;
  } else if (phase === 'bet') {
    if (seat === c) status = `みんなが賭けています…（あと ${waitingBets} 人）`;
    else if (seat < 0) status = `あと ${waitingBets} 人が賭けています`;
    else if (view.myBet === null) status = `${name(c)}が ${view.need}個に挑戦。成功する？ 失敗する？`;
    else status = waitingBets > 0 ? `「${view.myBet ? '成功' : '失敗'}」に賭けました。あと ${waitingBets} 人を待っています…` : '全員そろいました';
  } else if (phase === 'eat') {
    if (seat === c) status = ownLeft > 0 ? `まず自分の皿から食べます（あと ${view.need - eatenTotal}個）` : `どの皿から食べる？（あと ${view.need - eatenTotal}個）`;
    else status = `${name(c)}が食べています… ${eatenTotal} / ${view.need}個`;
  } else status = view.outcome.success ? `${name(c)}が ${view.need}個 食べきりました！` : view.outcome.hit === c ? `${name(c)}が、自分のわさびに当たりました…` : `${name(c)}が、${name(view.outcome.hit)}のわさびに当たりました！`;

  /** その皿を、いま食べられるか (挑戦者だけ)。 */
  const canEat = (s) => playing && phase === 'eat' && seat === c && view.eaten[s] < SLOTS && (ownLeft > 0 ? s === seat : s !== seat);

  const row = (s) => {
    const isMe = s === seat;
    const plate = view.plates?.[s];
    const lastCall = [...view.calls].reverse().find((call) => call.seat === s);
    const gain = view.outcome?.gains[s] ?? 0;
    return html`
      <div key=${s} class=${cx('tp-row', isMe && 'is-me', s === c && 'is-challenger', phase === 'bid' && s === view.turn && 'is-turn', view.passed[s] && phase === 'bid' && 'is-out')}>
        <span class="tp-who">
          <${Avatar} player=${players[s]} size="sm" />
          <span class="tp-name">${isMe ? 'あなた' : players[s]?.name ?? '?'}</span>
          ${s === view.dealer && html`<i class="tp-tag is-dealer">親</i>`}
          ${s === c && html`<i class="tp-tag is-challenger">🍴 挑戦</i>`}
          ${phase === 'bid' && lastCall && html`<i class=${cx('tp-tag', lastCall.pass ? 'is-pass' : 'is-bid')}>${lastCall.pass ? 'パス' : `${lastCall.amount}個`}</i>`}
          ${open && role && s === view.trapper && html`<i class="tp-tag is-wasabi">わさび係</i>`}
          ${open && view.bets[s] !== null && html`<i class=${cx('tp-tag', view.bets[s] === view.outcome.success ? 'is-hit' : 'is-miss')}>${view.bets[s] ? '成功' : '失敗'}に賭けた ${view.bets[s] === view.outcome.success ? '◎' : '✕'}</i>`}
          ${open && gain !== 0 && html`<b class=${cx('tp-gain', gain < 0 && 'is-bad')}>${gain > 0 ? '+' : ''}${gain}</b>`}
        </span>
        <span class="tp-plate">
          ${Array.from({ length: SLOTS }, (_, k) => {
            const eaten = k < view.eaten[s];
            const fresh = last && last.plate === s && last.slot === k && phase !== 'setup';
            const preview = phase === 'setup' && isMe && picked !== null && !role ? (picked === k + 1 ? 'wasabi' : 'safe') : null;
            return html`<${Piece} key=${k} kind=${plate ? plate[k] : preview} eaten=${eaten} fresh=${fresh} />`;
          })}
        </span>
        ${canEat(s) && html`<button class="btn btn-primary btn-small tp-eat" onClick=${() => act({ type: 'eat', plate: s })}>食べる</button>`}
      </div>
    `;
  };

  const seats = players.map((_, s) => s);
  const order = seat >= 0 ? [seat, ...seats.filter((s) => s !== seat)] : seats;
  const options = role ? [1, 2, 3] : [0, 1, 2, 3];

  return html`
    <div class="game takopa">
      <div class="tp-stage">
        <div class="tp-head">
          ${phase === 'setup'
            ? html`<b>仕込み中</b><span>親は ${name(view.dealer)}（最初に宣言します）</span>`
            : phase === 'bid'
              ? html`<b>${view.bid ? `いまの宣言 ${view.bid.amount}個` : 'まだ宣言なし'}</b>
                  <span>${view.bid ? `${name(view.bid.seat)}・全部で ${view.maxBid}個` : `全部で ${view.maxBid}個`}</span>`
              : html`<b>${view.need}個に挑戦</b><span>${name(c)}・食べた数 ${eatenTotal} / ${view.need}</span>`}
        </div>
        ${role &&
        view.myRole &&
        !open &&
        html`<p class=${cx('tp-role', view.myRole === 'wasabi' && 'is-wasabi')}>
          ${view.myRole === 'wasabi' ? 'あなたが「わさび係」です。あなたの皿にだけ、わさびが入っています' : 'あなたの皿は安全です。わさびは、ほかのだれか1人の皿にあります'}
        </p>`}
        <div class="tp-table">${order.map(row)}</div>
        <p class="tp-caption">皿は左が手前。食べるのは、どの皿も手前から</p>
      </div>

      <div class="panel">
        <p class=${cx('status', (myTurn || (playing && phase === 'setup' && (view.myChoice === null || (choice !== null && choice !== view.myChoice))) || (playing && phase === 'bet' && seat !== c && view.myBet === null)) && 'is-mine')}>${status}</p>

        ${playing &&
        phase === 'setup' &&
        html`
          <div class="tp-options">
            ${options.map(
              (slot) => html`
                <button key=${slot} class=${cx('tp-option', picked === slot && 'is-on')} onClick=${() => setChoice(slot)} aria-pressed=${picked === slot}>
                  <${PlatePreview} slot=${slot} />
                  <small>${slot === 0 ? 'わさびなし' : SLOT_NAMES[slot - 1]}</small>
                </button>
              `,
            )}
          </div>
          <button class="btn btn-primary btn-block" disabled=${picked === null || picked === view.myChoice} onClick=${() => act({ type: 'plate', slot: picked })}>
            ${view.myChoice === null ? 'この皿で出す' : picked !== view.myChoice ? 'この皿に変える' : '仕込みました'}
          </button>
          ${seat === view.dealer && html`<p class="tp-note">あなたは親なので、最初に「1個以上」を宣言することになります。</p>`}
        `}

        ${playing &&
        phase === 'bid' &&
        view.turn === seat &&
        html`
          <${BidBox}
            min=${(view.bid?.amount ?? 0) + 1}
            max=${view.maxBid}
            label=${(amount) => `${amount}個 食べられる！`}
            onBid=${(amount) => act({ type: 'bid', amount })}
            onPass=${view.bid ? () => act({ type: 'pass' }) : null}
            passNote=${view.bid ? null : '親は、最初の宣言をパスできません。'}
          />
          <p class="tp-note">挑戦するときは、まず自分の皿を手前から食べます（${SLOTS}個まで）。それより多いぶんは、ほかの人の皿から。</p>
        `}

        ${playing &&
        phase === 'bet' &&
        seat !== c &&
        html`
          <div class="du-bets">
            <button class=${cx('du-bet is-true', view.myBet === true && 'is-on', view.myBet === false && 'is-off')} onClick=${() => act({ type: 'bet', success: true })} aria-pressed=${view.myBet === true}>
              <b>⭕ 成功する</b>
              <small>${view.need}個 食べきる・当たれば +${view.rules.betSuccess}点</small>
            </button>
            <button class=${cx('du-bet is-false', view.myBet === false && 'is-on', view.myBet === true && 'is-off')} onClick=${() => act({ type: 'bet', success: false })} aria-pressed=${view.myBet === false}>
              <b>❌ 失敗する</b>
              <small>わさびに当たる・当たれば +${view.failPrize}点</small>
            </button>
          </div>
          ${view.myBet !== null && waitingBets > 0 && html`<p class="tp-note">全員がそろうまでは、えらび直せます。</p>`}
        `}

        ${view.calls.length > 0 &&
        phase !== 'setup' &&
        html`
          <div class="tp-calls">
            <span>宣言の流れ</span>
            ${view.calls.map(
              (call, i) => html`
                <span key=${i} class=${cx('tb-chip', call.pass && 'is-pass')}><${Avatar} player=${players[call.seat]} size="xs" /> ${call.pass ? 'パス' : `${call.amount}個`}</span>
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
                  : role
                    ? `わさび！ ${name(c)}は −${view.need}点。わさび係は ${name(view.outcome.hit)}でした`
                    : `わさび！ ${name(c)}は −${view.need}点。${name(view.outcome.hit)}に +${eatenTotal}点（食べた数）`}
            </p>
            ${phase === 'result' && seat >= 0 && html`<button class="btn btn-primary btn-block" onClick=${() => act({ type: 'next' })}>つぎのラウンドへ</button>`}
          </div>
        `}

        <p class="tb-legend">
          食べきれば宣言した数が得点。わさびに当たると、宣言した数だけ失点。${role
            ? `賭けは、「成功」を当てると +${view.rules.betSuccess}点、「失敗」を当てると宣言した数の半分。わさび係への加点はありません。`
            : `仕込んだ人には、挑戦者が食べた数だけ得点。賭けが当たると +${view.rules.betSuccess}点。`}
        </p>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        たこ焼きの皿に、こっそり「わさび入り」を仕込みます。「何個食べられる！」と数を言い合い、いちばん大きく出た人が本当に食べます。わさびを入れた人は、平気な顔でだれかに食べさせましょう。
      </p>
      <h3>1. 仕込み</h3>
      <ul>
        <li>全員が同時に、自分の皿（たこ焼き ${SLOTS}個）をこっそり用意します。</li>
        <li>わさび入りは <b>0個か1個</b>。入れるなら、何番目に置くかも決めます。食べるのは手前（1番目）からです。</li>
      </ul>
      <h3>2. 宣言</h3>
      <ul>
        <li>親から順に、「<b>◯個食べられる</b>」と宣言します。前の人より多い数を言うか、<b>パス</b>します。</li>
        <li>パスした人は、このラウンドの宣言からおります。最後まで残った人が<b>挑戦者</b>です。</li>
        <li>親は、最初の宣言をパスできません（1個以上を言います）。</li>
      </ul>
      <h3>3. 賭け</h3>
      <p>挑戦者以外の全員が、同時にこっそり「<b>成功</b>」か「<b>失敗</b>」に賭けます。当たると <b>+${BET_REWARD}点</b>。</p>
      <h3>4. 挑戦</h3>
      <ul>
        <li><b>まず自分の皿</b>を、手前から食べます（${SLOTS}個まで）。</li>
        <li>足りないぶんは、<b>ほかの人の皿</b>から1個ずつ。どの皿からでもよいですが、どの皿も手前から食べます。</li>
        <li>宣言した数を食べきれば<b>成功</b>。わさび入りを食べたら、その場で<b>失敗</b>です。</li>
      </ul>
      <h3>得点</h3>
      <ul>
        <li><b>成功</b>：宣言した数が、そのまま得点。</li>
        <li><b>失敗</b>：宣言した数だけ失点します。</li>
        <li>
          <b>わさびを仕込んだ人</b>：挑戦者が<b>そこまでに食べた数</b>（わさび入りの1個もふくむ）が得点になります。大きく宣言させても、早く当たれば少しです。
        </li>
        <li>自分のわさびを自分で食べたら、失点するだけです。</li>
      </ul>
      <h3>終了</h3>
      <p>
        親が全員に同じ回数まわったら終了（3人は ${ROUNDS_BY_PLAYERS[3]}、4人は ${ROUNDS_BY_PLAYERS[4]}、5人は ${ROUNDS_BY_PLAYERS[5]}、6人は
        ${ROUNDS_BY_PLAYERS[6]} ラウンド）。点の高い人の勝ち。同点なら、挑戦に成功した回数が多い人が上です。
      </p>
      <h3>コツ</h3>
      <ul>
        <li>わさびを入れていない人は、自分の皿のぶん（${SLOTS}個）までは安全に宣言できます。すぐにパスする人は、あやしいかも。</li>
        <li>わさびを入れた人は、だれかがもっと大きい数を言ってくれないと、自分で食べることになります。</li>
        <li>大きく宣言するほど、成功の得点も、失敗の失点も大きくなります。</li>
      </ul>
    </div>
  `;
}

export const config = {
  scores: (view) => view.points,
  unit: '点',
  progress: (view) => `ラウンド ${view.round} / ${view.maxRounds}`,
  waiting: (view) => !view.over && (view.phase === 'setup' || view.phase === 'bet'),
  // 仕込みと賭けは全員が同時なので、いつもの番の音は鳴らさない (宣言と挑戦の番は盤面の側で鳴らす)。
  turnSound: false,
  turnSeats: (view, pending) => (view.phase === 'result' ? [] : pending),
  extra: (view, s) => {
    if (view.phase === 'setup') return s === view.dealer ? '親' : '';
    if (s === view.challenger) return '🍴 挑戦';
    if (view.phase === 'bid') return view.passed[s] ? 'パス' : s === view.turn ? '考え中' : '';
    return '';
  },
};

export default { Board, Rules, ...config };
