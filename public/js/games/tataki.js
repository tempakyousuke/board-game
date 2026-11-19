// たたき売り！の盤面。

import { html, useEffect, useRef, cx } from '../lib.js';
import { CATEGORIES, SET_BONUS, SET_KINDS, START_COINS, categoriesFor } from '/shared/games/tataki.js';
import { Avatar } from '../ui.js';
import { play, useChanged } from '../sound.js';

function ItemChip({ item, fav = false }) {
  if (item.lucky && !item.cat) return html`<span class="tk-chip is-lucky">🎁</span>`;
  return html`
    <span class=${cx('tk-chip', fav && 'is-fav')}>
      ${CATEGORIES[item.cat].emoji}<b>${item.value}</b>${item.lucky && html`<small>🎁</small>`}
    </span>
  `;
}

function Board({ view, seat, players, act }) {
  const { item, phase, price } = view;
  const playing = seat >= 0 && !view.over;
  const myFav = seat >= 0 ? view.fav[seat] : null;
  const hidden = item.lucky && !item.cat;
  const isFav = !hidden && item.cat === myFav;
  const coins = seat >= 0 ? view.coins[seat] : 0;
  const canBuy = playing && phase === 'falling' && coins >= price;
  const sale = phase === 'sold' || view.over ? view.lastSale : null;
  const buyRef = useRef(null);

  // 値下がりのたびに音が低くなっていく。売れたら木づちの音。
  useChanged(`${view.lot}:${phase}:${price}`, () => {
    if (view.over) return;
    if (phase === 'falling') play('tick', { level: price / view.startPrice });
    else if (phase === 'intro') play('card');
    else if (view.lastSale.seat < 0) play('unsold');
    else {
      play('sold');
      if (view.lastSale.seat === seat) play('coin', { delay: 0.3 });
    }
  });

  const buy = () => {
    if (canBuy) act({ type: 'buy', lot: view.lot });
  };

  // PC ではスペースキーでも買える。
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.querySelector('.modal')) return;
      e.preventDefault();
      buyRef.current?.click();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  let status;
  if (view.over) status = '本日の市はおしまい！';
  else if (phase === 'intro') status = 'まもなく値下がりが始まります…';
  else if (phase === 'falling') status = playing ? (coins >= price ? '買うなら今？ もう少し待つ？' : 'まだ手持ちでは買えません') : '値下がり中…';
  else status = sale.seat >= 0 ? `${players[sale.seat]?.name ?? '?'} さんが ${sale.price} コインで買いました！` : 'だれも買わず、売れ残りました';

  const sold = sale && sale.lot === view.lot ? sale : null;

  return html`
    <div class="game tataki">
      <div class=${cx('tk-stage', `is-${view.over ? 'over' : phase}`)}>
        <div class="tk-lot">
          <span>${Math.min(view.lot + 1, view.lots)} / ${view.lots} 品目</span>
          ${view.upcoming.length > 0 &&
          html`<span class="tk-next">このあと ${view.upcoming.map((it, i) => html`<${ItemChip} key=${i} item=${it} fav=${it.cat === myFav} />`)}</span>`}
        </div>

        <div class="tk-item">
          <span class=${cx('tk-emoji', hidden && 'is-lucky')}>${hidden ? '🎁' : CATEGORIES[item.cat].emoji}</span>
          <div class="tk-item-text">
            <b>${hidden ? '福袋' : CATEGORIES[item.cat].name}${item.lucky && !hidden ? '（福袋の中身）' : ''}</b>
            ${hidden
              ? html`<span>中身は買ってのお楽しみ（2〜6点）</span>`
              : html`<span class="tk-value">
                  ${isFav
                    ? html`<s>${item.value}点</s> <strong>${item.value * 2}点</strong> <i class="tk-fav">お目当て ×2</i>`
                    : html`<strong>${item.value}点</strong>`}
                </span>`}
          </div>
        </div>

        <div class="tk-price">
          <span class="tk-price-num" key=${`${view.lot}:${price}`}>${sold && sold.seat >= 0 ? sold.price : price}</span>
          <span class="tk-price-unit">コイン</span>
        </div>
        ${sold
          ? html`
              <div class=${cx('tk-sold', sold.seat < 0 && 'is-unsold')}>
                ${sold.seat >= 0
                  ? html`<${Avatar} player=${players[sold.seat]} size="sm" /> <b>${players[sold.seat]?.name}</b> が落札！`
                  : '売れ残り…'}
              </div>
            `
          : html`
              <div class="tk-bar">
                ${phase === 'falling' && html`<i key=${`${view.lot}:${price}`} style=${`animation-duration:${view.tickMs}ms`}></i>`}
                ${phase === 'intro' && html`<i class="is-full"></i>`}
              </div>
            `}
      </div>

      <div class="panel">
        <p class=${cx('status', canBuy && 'is-mine')}>${status}</p>

        ${playing &&
        html`
          <button ref=${buyRef} class="tk-buy" disabled=${!canBuy} onClick=${buy}>
            <b>買う！</b>
            <small>${phase === 'falling' ? `${price} コインで` : ''}（手持ち ${coins} コイン）</small>
          </button>
        `}

        <div class="tk-table">
          ${players.map((player, s) => {
            const kinds = new Set(view.bought[s].map((b) => b.cat)).size;
            return html`
              <div key=${s} class=${cx('tk-row', s === seat && 'is-me')}>
                <${Avatar} player=${player} size="sm" />
                <span class="tk-row-fav" title="お目当て">♥${CATEGORIES[view.fav[s]].emoji}</span>
                <span class="tk-row-coins">🪙${view.coins[s]}</span>
                <span class="tk-row-items">
                  ${view.bought[s].map((b, i) => html`<${ItemChip} key=${i} item=${b} fav=${b.cat === view.fav[s]} />`)}
                  ${view.bought[s].length === 0 && html`<small class="muted">まだ何も買っていません</small>`}
                </span>
                ${kinds >= SET_KINDS && html`<span class="tk-row-set">${SET_KINDS}種類 +${SET_BONUS}</span>`}
              </div>
            `;
          })}
        </div>
        <p class="muted tk-note">
          ♥ はお目当て（点数2倍）。全員ちがう種類です。${view.cats.length > SET_KINDS ? `品物は ${view.cats.length}種類。そのうち ` : ''}${SET_KINDS}種類そろえると +${SET_BONUS}点。コインは点になりません。
        </p>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        品物の値段が、1秒ごとにどんどん下がっていきます。待てば待つほど安くなるけれど、だれかが先に「買う！」と言ったらおしまい。度胸とがまんの競りです。
      </p>
      <h3>進め方</h3>
      <ul>
        <li>品物が1つずつ出てきます。値段は高いところから始まり、<b>1秒ごとに1コインずつ</b>下がります。</li>
        <li>最初に<b>「買う！」</b>を押した人が、そのときの値段で手に入れます。</li>
        <li>1コインになってもだれも買わなければ、売れ残りです。</li>
        <li>順番はありません。全員が同じ品物を同時に見ています。</li>
      </ul>
      <h3>コイン</h3>
      <p>全員 <b>${START_COINS}コイン</b> 持って始めます。<b>残したコインは点になりません</b>。使い切るつもりで、でも使いどころは選びましょう。</p>
      <h3>得点</h3>
      <ul>
        <li>買った品物に書かれた点数が、そのまま得点です。</li>
        <li>自分の<b>「お目当て」</b>の種類の品物は<b>点数が2倍</b>になります。お目当ては<b>全員ちがう種類</b>で、全員に見えています。</li>
        <li>
          品物はふつう 4種類（${categoriesFor(4).map((id) => CATEGORIES[id].emoji).join('')}）。5人で遊ぶときは ${CATEGORIES[categoriesFor(5)[4]].emoji}、6人で遊ぶときは
          ${CATEGORIES[categoriesFor(6)[5]].emoji} も加わります。
        </li>
        <li>ちがう種類を <b>${SET_KINDS}種類</b>そろえると <b>+${SET_BONUS}点</b>。</li>
        <li>🎁 <b>福袋</b>は、買うまで中身がわかりません（2〜6点のどれか）。</li>
      </ul>
      <h3>終了</h3>
      <p>すべての品物が出終わったら終了。得点が高い人の勝ちです。同点なら、コインを多く残した人が上になります。</p>
      <h3>コツ</h3>
      <ul>
        <li>「このあと」に出る品物が見えています。お目当てが控えているなら、コインを取っておきましょう。</li>
        <li>ほかの人のお目当てと手持ちのコインを見れば、いくらまで下がりそうかが読めます。</li>
        <li>終わりが近いと、みんな余ったコインを使いたがります。最後の品物は高くなりがち。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.points,
  unit: '点',
  progress: (view) => `${Math.min(view.lot + 1, view.lots)} / ${view.lots} 品目`,
  waiting: () => false,
  extra: (view, s) => `🪙${view.coins[s]} ♥${CATEGORIES[view.fav[s]].emoji}`,
};
