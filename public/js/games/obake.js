// おばけ神経衰弱の盤面。

import { html, useState, useEffect, useRef, cx } from '../lib.js';
import { FACES, GOLD_POINTS, GHOST_PRANKS } from '/shared/games/obake.js';
import { Avatar, paletteOf } from '../ui.js';
import { play } from '../sound.js';

const BANNER_MS = 2600;

function Board({ view, seat, players, act }) {
  const [banner, setBanner] = useState(null);
  const seen = useRef(view.event?.id ?? 0);
  const timer = useRef(null);

  // できごとに合わせて音を鳴らし、おばけのいたずらはしばらく大きく知らせる。
  useEffect(() => {
    const event = view.event;
    const id = event?.id ?? 0;
    if (id === seen.current) return;
    seen.current = id;
    if (event.type === 'flip') play('card');
    else if (event.type === 'match') play(FACES[event.face].points > 1 ? 'chime' : 'coin');
    else if (event.type === 'miss') play('down');
    else if (event.type === 'ghost') play('fail');
    else if (event.type === 'peek') play('pop');
    else if (event.type === 'shuffle') play('whoosh');
    if (event.type === 'ghost' || event.type === 'shuffle') {
      setBanner(event);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setBanner(null), BANNER_MS);
    }
  }, [view.event?.id]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const myTurn = !view.over && view.turn === seat;
  const canPick = myTurn && (view.phase === 'flip' || view.phase === 'peek');
  const name = (s) => players[s]?.name ?? '?';
  const shuffled = new Set(banner?.type === 'shuffle' ? banner.cells : []);
  const event = view.event;

  let status;
  if (view.over) status = 'カードがなくなりました！';
  else if (view.phase === 'ghost') status = `👻 おばけだ！ ${name(view.turn)} さんの番はここまで`;
  else if (view.phase === 'miss') status = 'ざんねん、はずれ。場所をおぼえておこう';
  else if (view.phase === 'peek') status = myTurn ? '🔍 裏のカードを1枚、こっそりのぞけます' : `${name(view.turn)} さんがこっそり1枚のぞきます`;
  else if (myTurn) status = view.flipped.length === 0 ? 'あなたの番です。1枚めくってください' : 'もう1枚めくってください';
  else status = `${name(view.turn)} さんの番です`;

  return html`
    <div class="game obake">
      <div class="ob-wrap">
        <div class="ob-grid" style=${`--cols:${view.cols}`}>
          ${view.cards.map((card, i) => {
            const open = card.face !== null && card.state !== 'gone';
            const peeked = view.peekCard === i && card.state === 'down';
            return html`
              <button
                key=${i}
                class=${cx(
                  'ob-card',
                  card.state === 'gone' && 'is-gone',
                  open && 'is-open',
                  card.face === 'obake' && open && 'is-ghost',
                  canPick && card.state === 'down' && 'is-pickable',
                  shuffled.has(i) && 'is-shuffled',
                  peeked && 'is-peeked',
                )}
                disabled=${!(canPick && card.state === 'down')}
                onClick=${() => act({ type: view.phase === 'peek' ? 'peek' : 'flip', card: i })}
                aria-label=${`${i + 1}番目のカード${open ? `: ${FACES[card.face].emoji}` : card.state === 'gone' ? '（なし）' : '（裏）'}`}
              >
                <span class="ob-inner">
                  <span class="ob-back">？</span>
                  <span class="ob-front">${card.face && card.state !== 'gone' ? FACES[card.face].emoji : ''}</span>
                </span>
                ${peeked && html`<i class="ob-eye">👀</i>`}
              </button>
            `;
          })}
        </div>
      </div>

      <div class="panel">
        ${banner &&
        html`
          <div class="ob-banner">
            ${banner.type === 'ghost'
              ? '👻 おばけだ〜！'
              : banner.left
                ? '👻 光っているカードを入れかえて、おばけは帰っていった'
                : '👻 おばけが、光っているカードを入れかえた！'}
          </div>
        `}
        <p class=${cx('status', canPick && 'is-mine', view.phase === 'ghost' && 'is-boom')}>${status}</p>

        ${event?.type === 'match' &&
        !view.over &&
        html`<p class="ob-note">${name(event.seat)} さんが ${FACES[event.face].emoji} をそろえました（+${FACES[event.face].points}点）。もう一度めくれます</p>`}
        ${view.peekSeat >= 0 &&
        view.peekCard !== null &&
        html`<p class="ob-note">${view.peekSeat === seat ? '👀 のついたカードの中身は、あなたにだけ見えています' : `${name(view.peekSeat)} さんが 👀 のカードをのぞきました`}</p>`}

        <div class="ob-taken">
          ${players.map(
            (player, s) => html`
              <div key=${s} class=${cx('ob-taken-row', s === seat && 'is-me')} style=${`--c:${paletteOf(player).color}`}>
                <${Avatar} player=${player} size="xs" />
                <span class="ob-taken-cards">
                  ${view.taken[s].map((face, i) => html`<i key=${i} class=${cx(FACES[face].points > 1 && 'is-gold')}>${FACES[face].emoji}</i>`)}
                  ${view.taken[s].length === 0 && html`<small class="muted">まだなし</small>`}
                </span>
              </div>
            `,
          )}
        </div>
        <p class="muted ob-legend">
          ペアは1点。👑 と 💎 は ${GOLD_POINTS}点。🔍 をとると1枚のぞけます。👻 は ${GHOST_PRANKS} 回いたずらすると帰ります。
        </p>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        おなじみの神経衰弱に、いたずら好きのおばけがまぎれこみました。せっかくおぼえたカードの場所を、おばけがこっそり入れかえてしまいます。
      </p>
      <h3>進め方</h3>
      <ul>
        <li>自分の番に、裏向きのカードを <b>2枚</b>めくります。</li>
        <li><b>同じ絵</b>なら、そのペアをもらって、<b>もう一度</b>めくれます。</li>
        <li>ちがう絵なら、少しのあいだ全員に見せてから裏に戻して、次の人の番です。</li>
      </ul>
      <h3>とくべつなカード</h3>
      <ul>
        <li><b>👑・💎</b>：このペアは <b>${GOLD_POINTS}点</b>（ほかのペアは1点）。</li>
        <li><b>🔍</b>：このペアをとると、裏向きのカードを<b>1枚だけこっそりのぞけます</b>。中身は自分にしか見えません。</li>
        <li>
          <b>👻 おばけ</b>（2枚）：めくってしまったら、その番はそこでおしまい。おばけは裏向きのカードを2枚まきこんで、<b>場所を入れかえます</b>。どのカードが動いたかは全員にわかりますが、どこへ行ったかはわかりません。
        </li>
        <li>おばけは <b>${GHOST_PRANKS} 回</b>いたずらをすると、満足して帰っていきます（カードがなくなります）。</li>
      </ul>
      <h3>終了</h3>
      <p>ペアがすべてなくなったら終了。点の高い人の勝ちです。同点なら、とったペアの数が多い人が上です。</p>
      <h3>コツ</h3>
      <ul>
        <li>おばけが入れかえた場所は、また1からおぼえ直し。入れかわった3枚のどれかに、おばけがまだいます。</li>
        <li>👑 と 💎 の場所は、ほかの人も必死におぼえています。先にとられる前に。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.points,
  unit: '点',
  progress: (view) => {
    const left = view.cards.filter((c) => c.state !== 'gone').length;
    return `のこり ${left} 枚`;
  },
  waiting: () => false,
  extra: (view, s) => `ペア ${view.taken[s].length}`,
};
