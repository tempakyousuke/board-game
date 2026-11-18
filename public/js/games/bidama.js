// ビーだま工場の画面。
// はじめての人でも「見ればわかる」ように、機械には名前とひとことを出し、
// 玉を流す前に「何が起きるか」を順番に見せ、流れている玉そのものを列の上で動かす。

import { html, useState, useEffect, cx } from '../lib.js';
import { ANY, ROUNDS, TRAY, REVEAL_LEAD_MS, REVEAL_STEP_MS, flow, land, canPay, payment, traySize } from '/shared/games/bidama.js';
import { Avatar } from '../ui.js';
import { play, useChanged } from '../sound.js';
import { useReplay } from '../replay.js';

const COLOR_NAMES = ['赤', '青', '黄', '緑'];
// 色だけに頼らないよう、玉の中に形も入れる。
const GLYPHS = ['●', '◆', '▲', '■'];
const KIND_NAMES = { star: '得点', paint: '色がえ', bonus: 'おまけ', none: 'かざり' };

function Ball({ color, size = 'md' }) {
  if (color === ANY) return html`<span class=${cx('bd-ball is-any', `bd-ball-${size}`)} role="img" aria-label="どの色でも">◎</span>`;
  return html`<span class=${cx('bd-ball', `c${color}`, `bd-ball-${size}`)} role="img" aria-label=${`${COLOR_NAMES[color]}の玉`}>${GLYPHS[color]}</span>`;
}

/** 機械のはたらきを、絵で1行に書く。 */
function Effect({ m, size = 'sm' }) {
  if (m.kind === 'none') return html`<span class="bd-effect is-none">✨</span>`;
  return html`
    <span class="bd-effect">
      <${Ball} color=${m.in} size=${size} />
      <i class="bd-arrow">▶</i>
      ${m.kind === 'star' && html`<b class="bd-star">${'★'.repeat(m.gain)}</b>`}
      ${m.kind === 'paint' && html`<${Ball} color=${m.out} size=${size} />`}
      ${m.kind === 'bonus' && html`<b class="bd-plus">＋</b><${Ball} color=${m.out} size=${size} />${m.out2 !== undefined && html`<${Ball} color=${m.out2} size=${size} />`}`}
    </span>
  `;
}

const inName = (m) => (m.in === ANY ? 'どの色' : COLOR_NAMES[m.in]);
/** 機械のはたらきを、短い文で。 */
const say = (m) => {
  if (m.kind === 'star') return `${inName(m)}が通ると ★${m.gain}`;
  if (m.kind === 'paint') return `${inName(m)}を ${COLOR_NAMES[m.out]}に変える`;
  if (m.kind === 'bonus') return `${inName(m)}が通ると ${COLOR_NAMES[m.out]}${m.out2 !== undefined ? `と${COLOR_NAMES[m.out2]}` : ''}が出る`;
  return '動かない。点が高い';
};
const describe = (m) => `${KIND_NAMES[m.kind]}の機械。${say(m)}`;

/** 流したときに起きることを、1つずつ言葉にする。 */
const tell = (step) => {
  if (step.land) return `${COLOR_NAMES[step.color]}の玉が皿へ`;
  const head = `${step.index + 1}番`;
  if (step.kind === 'star') return `${head}で ★${step.stars}`;
  if (step.kind === 'paint') return `${head}で ${COLOR_NAMES[step.to]}に変わる`;
  return `${head}で ${step.spawn.map((c) => COLOR_NAMES[c]).join('と')}の玉が出る`;
};

function Cost({ cost }) {
  return html`<span class="bd-cost">${cost.flatMap((count, c) => Array.from({ length: count }, (_, i) => html`<${Ball} key=${`${c}-${i}`} color=${c} size="xs" />`))}</span>`;
}

/** 皿。6個ぶんのくぼみに、色の順で玉をならべる。 */
function Tray({ tray, size = 'sm' }) {
  const balls = tray.flatMap((count, c) => new Array(count).fill(c));
  return html`
    <span class="bd-tray" aria-label=${`皿の玉 ${balls.length}個`}>
      ${Array.from({ length: TRAY }, (_, i) => (i < balls.length ? html`<${Ball} key=${i} color=${balls[i]} size=${size} />` : html`<i key=${i} class=${cx('bd-hole', `bd-ball-${size}`)}></i>`))}
    </span>
  `;
}

/** あと何個あれば買えるか (2個で1個ぶんの払い方もふくめて)。 */
function shortBy(tray, cost) {
  const missing = cost.reduce((a, v, c) => a + Math.max(0, v - tray[c]), 0);
  const surplus = cost.reduce((a, v, c) => a + Math.max(0, tray[c] - v), 0);
  return Math.max(0, missing * 2 - surplus);
}

function Board({ view, seat, players, act }) {
  const { phase } = view;
  const playing = seat >= 0 && !view.over;
  const picking = phase === 'pick';
  const revealing = phase === 'reveal';
  const me = seat >= 0 ? view.players[seat] : null;
  const myResult = seat >= 0 && view.last ? view.last.results[seat] : null;
  const mySteps = revealing && myResult ? (myResult.kind === 'flow' ? myResult.steps : [{ build: true }]) : [];

  const shown = useReplay(revealing && seat >= 0, view.last?.id, mySteps.length, { lead: REVEAL_LEAD_MS, step: REVEAL_STEP_MS }, (i) => {
    const step = mySteps[i];
    if (step.build) play('up');
    else if (step.land) play('step');
    else if (step.stars) play('coin');
    else play('pop', { level: Math.min(1, i / 6) });
  });
  useChanged(phase, (now) => {
    if (now === 'reveal') play('card');
  });
  useChanged(view.myPick ? JSON.stringify(view.myPick) : '', (now) => {
    if (now) play('place');
  });

  // ---- えらんでいる手 (まだ出していない) ----
  const [sel, setSel] = useState(null);
  useEffect(() => setSel(null), [view.round]);
  const current = sel ?? view.myPick;
  const selCard = current?.kind === 'build' ? view[current.row][current.index] : null;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const dirty = current !== null && !same(current, view.myPick);

  // ---- 自分の列の見え方 ----
  // 見せている最中: 動いたところまで。えらんでいる最中: さしこむ機械を仮に置く / 流したときに動く機械を光らせる。
  let line = me ? me.line.map((m) => ({ m })) : [];
  let tray = me ? me.tray.slice() : null;
  let stars = me ? me.stars : 0;
  let rolling = null; // いま転がっている玉 { color, at } (at = 機械の番号。-1 は入口、列の長さは出口)
  let story = null; // 流す前に見せる「こうなります」
  let happened = []; // 見せている最中に、起きたこと
  if (me && revealing && myResult) {
    if (myResult.kind === 'flow') {
      const done = myResult.steps.slice(0, shown ?? 0);
      for (const step of done) {
        if (step.land) land(tray, step.color);
        else {
          line[step.index].fired = true;
          stars += step.stars;
        }
      }
      happened = done;
      const now = done[done.length - 1];
      if (!now) rolling = { color: myResult.color, at: -1 };
      else if (!now.land) {
        line[now.index].now = true;
        rolling = { color: now.kind === 'paint' ? now.to : now.color, at: now.index };
      }
    } else if ((shown ?? 0) >= 1) {
      line.splice(myResult.pos, 0, { m: myResult.card, fresh: true });
      tray = myResult.tray.slice();
    }
  } else if (me && picking && current) {
    if (current.kind === 'flow') {
      const r = flow(me.line, current.color);
      for (const step of r.steps) if (!step.land) line[step.index].will = true;
      story = r;
    } else if (selCard) {
      line.splice(current.pos, 0, { m: selCard, ghost: true });
    }
  }

  const waitingFor = view.picked.filter((done) => !done).length;
  const affordableCount = me && picking ? [...view.small, ...view.large].filter((m) => canPay(me.tray, m.cost)).length : 0;
  let status;
  if (view.over) status = 'おつかれさまでした！';
  else if (revealing) {
    if (!myResult) status = 'みんなの機械が動いています…';
    else if (myResult.kind === 'build') status = '機械をつくりました';
    else status = (shown ?? 0) >= mySteps.length ? `★${myResult.stars}・玉${myResult.landed.length}個 もらいました` : '玉が流れています…';
  } else if (seat < 0) status = `あと ${waitingFor} 人が考えています`;
  else if (view.myPick && !dirty) status = waitingFor > 0 ? `えらびました。あと ${waitingFor} 人を待っています…` : '全員そろいました';
  else status = current ? 'これでよければ「決定」を押してください' : '① 玉を流す か、② 機械をつくる か、どちらか1つ';

  // いまの場面に合わせた、ひとことの案内。
  let hint = null;
  if (playing && picking && !current) {
    hint =
      affordableCount > 0
        ? `皿の玉で、機械が ${affordableCount}台 つくれます（明るいカード）。つくると、次から連鎖が長くなります。`
        : '場の玉を1個えらんでみましょう。どの機械が動くか、先に見えます。';
  }

  const pickFlow = (color) => setSel({ kind: 'flow', color });
  const pickCard = (row, index) => setSel({ kind: 'build', row, index, pos: me.line.length });
  const movePos = (pos) => setSel({ ...current, pos });

  const shopCard = (m, row, index) => {
    const affordable = me ? canPay(me.tray, m.cost) : false;
    const short = me ? shortBy(me.tray, m.cost) : 0;
    const on = current?.kind === 'build' && current.row === row && current.index === index;
    return html`
      <button
        key=${m.id}
        class=${cx('bd-card', `is-${m.kind}`, m.big && 'is-big', on && 'is-on', playing && picking && !affordable && 'is-poor')}
        disabled=${!playing || !picking || !affordable}
        onClick=${() => pickCard(row, index)}
        aria-pressed=${on}
        aria-label=${`${describe(m)}。${m.vp}点`}
      >
        <span class="bd-card-top"><i class="bd-kind">${KIND_NAMES[m.kind]}</i><b class="bd-vp">${m.vp}点</b></span>
        <${Effect} m=${m} />
        <span class="bd-say">${say(m)}</span>
        <span class="bd-price"><small>代金</small><${Cost} cost=${m.cost} /></span>
        ${me && picking && html`<span class=${cx('bd-afford', affordable && 'is-ok')}>${affordable ? 'つくれる' : `あと${Math.ceil(short / 2)}個ほど`}</span>`}
      </button>
    `;
  };

  /** 列の中の機械1台。 */
  const lineItem = (item, i) => html`
    <span
      key=${item.m.id + (item.ghost ? 'g' : '')}
      class=${cx('bd-machine', `is-${item.m.kind}`, item.m.big && 'is-big', item.fired && 'is-fired', item.now && 'is-now', item.will && 'is-will', item.ghost && 'is-ghost', item.fresh && 'is-fresh')}
      title=${describe(item.m)}
    >
      <small class="bd-no">${i + 1}</small>
      ${rolling && rolling.at === i && html`<span class="bd-rolling"><${Ball} color=${rolling.color} size="sm" /></span>`}
      <${Effect} m=${item.m} />
      <i class="bd-kind">${item.ghost ? 'ここに入る' : KIND_NAMES[item.m.kind]}</i>
    </span>
  `;

  // さしこむ場所をえらぶ「＋」。仮に置いた機械のところには出さない。
  const choosingPos = playing && picking && current?.kind === 'build' && selCard;
  const slots = [];
  if (me) {
    const real = me.line.length;
    let ri = 0; // もとの列での位置
    line.forEach((item, i) => {
      if (choosingPos && !item.ghost && ri !== current.pos) {
        slots.push(html`<button key=${`slot${ri}`} class="bd-slot" onClick=${((pos) => () => movePos(pos))(ri)} aria-label=${`${ri + 1}番目にさしこむ`}>＋</button>`);
      }
      slots.push(lineItem(item, i));
      if (!item.ghost) ri++;
    });
    if (choosingPos && current.pos !== real) slots.push(html`<button key="slotEnd" class="bd-slot" onClick=${() => movePos(real)} aria-label="右はしにさしこむ">＋</button>`);
  }

  const others = players.map((_, s) => s).filter((s) => s !== seat);
  const summary = (r) => {
    if (r.kind === 'build') return html`🔧 「${KIND_NAMES[r.card.kind]}」の機械をつくった <${Effect} m=${r.card} size="xs" />`;
    const fired = r.steps.filter((s) => !s.land).length;
    return html`<${Ball} color=${r.color} size="xs" /> を流して、機械が ${fired}台 動いた${r.stars > 0 ? html`（<b class="bd-star">★${r.stars}</b>）` : ''}`;
  };
  const paid = selCard && me ? payment(me.tray, selCard.cost) : null;
  const landingNow = happened.length > 0 && happened[happened.length - 1].land;

  return html`
    <div class="game bidama">
      <div class="bd-stage">
        <div class="bd-market">
          <p class="bd-how">毎周、<b>①</b> か <b>②</b> の<b>どちらか1つ</b>をえらびます（全員同時）</p>

          <div class="bd-sec">
            <b class="bd-sec-no">①</b>
            <span><b>玉を流す</b>：1個えらぶと、あなたの列を左から右へ流れます</span>
          </div>
          <div class="bd-marbles">
            ${view.marbles.map(
              (color, i) => html`
                <button
                  key=${i}
                  class=${cx('bd-pick', current?.kind === 'flow' && current.color === color && 'is-on')}
                  disabled=${!playing || !picking}
                  onClick=${() => pickFlow(color)}
                  aria-label=${`${COLOR_NAMES[color]}の玉を流す`}
                >
                  <${Ball} color=${color} size="lg" />
                  <small>${COLOR_NAMES[color]}</small>
                </button>
              `,
            )}
          </div>

          <div class="bd-sec">
            <b class="bd-sec-no">②</b>
            <span><b>機械をつくる</b>：皿の玉を代金にして、列にさしこみます</span>
          </div>
          <div class="bd-shop">${view.small.map((m, i) => shopCard(m, 'small', i))}</div>
          <div class="bd-shop">${view.large.map((m, i) => shopCard(m, 'large', i))}</div>
        </div>

        ${me &&
        html`
          <div class="bd-mine">
            <div class="bd-mine-head">
              <b>あなたの列</b>
              <span>玉は左から右へ。色の合う機械が動きます</span>
            </div>
            <div class="bd-line">
              <span class="bd-in">
                ${rolling && rolling.at === -1 ? html`<${Ball} color=${rolling.color} size="sm" />` : '入口'} ▶
              </span>
              ${slots}
              <span class="bd-out">▶ 皿へ</span>
            </div>
            <div class="bd-traybox">
              <span class=${cx('bd-traylabel', landingNow && 'is-now')}>皿 ${traySize(tray)}/${TRAY}</span>
              <${Tray} tray=${tray} size="md" />
              <small>機械をつくる材料</small>
              <span class="bd-total"><b class="bd-star">★${stars}</b> ＋ 機械 ${me.vp}点</span>
            </div>
          </div>
        `}
      </div>

      <div class="panel">
        <p class=${cx('status', playing && picking && (!view.myPick || dirty) && 'is-mine')}>${status}</p>
        ${hint && html`<p class="bd-hint">💡 ${hint}</p>`}

        ${story &&
        html`
          <div class="bd-story">
            <b>この玉を流すと…</b>
            <ol>
              <li><${Ball} color=${current.color} size="xs" /> ${COLOR_NAMES[current.color]}の玉が入口から入る</li>
              ${story.steps.map((step, i) => html`<li key=${i} class=${cx(step.land && 'is-land', step.stars > 0 && 'is-star')}>${tell(step)}</li>`)}
            </ol>
            <p>
              あわせて ${story.stars > 0 ? html`<b class="bd-star">★${story.stars}</b> と ` : ''}玉 <b>${story.landed.length}個</b>${story.steps.length === story.landed.length ? '（動く機械はありません）' : ''}
            </p>
          </div>
        `}
        ${selCard &&
        picking &&
        paid &&
        html`
          <div class="bd-story">
            <b>「${KIND_NAMES[selCard.kind]}」の機械をつくると…</b>
            <ol>
              <li>
                代金 <${Cost} cost=${paid} /> を皿から払う${traySize(paid) > traySize(selCard.cost) ? '（足りない色は、ほかの玉2個で1個ぶん）' : ''}
              </li>
              <li>列の <b>${current.pos + 1}番目</b>にさしこむ（列の「＋」で場所を変えられます）</li>
              <li>${selCard.vp}点。これからは「${say(selCard)}」</li>
            </ol>
          </div>
        `}

        ${playing &&
        picking &&
        html`
          <button class="btn btn-primary btn-block" disabled=${!dirty} onClick=${() => act({ type: 'pick', ...current })}>
            ${!current ? '玉か機械をえらんでください' : !dirty ? 'えらびました' : current.kind === 'flow' ? `決定：${COLOR_NAMES[current.color]}の玉を流す` : `決定：この機械を ${current.pos + 1}番目につくる`}
          </button>
        `}

        ${revealing &&
        happened.length > 0 &&
        html`
          <div class="bd-story is-live">
            <ol>
              ${happened.map((step, i) => html`<li key=${i} class=${cx(step.land && 'is-land', step.stars > 0 && 'is-star')}>${tell(step)}</li>`)}
            </ol>
          </div>
        `}

        <div class="bd-others">
          ${others.length > 0 && html`<b class="bd-others-title">ほかの人の列</b>`}
          ${others.map((s) => {
            const p = view.players[s];
            const r = view.last && (!picking || view.last.round === view.round - 1) ? view.last.results[s] : null;
            return html`
              <div key=${s} class="bd-other">
                <div class="bd-other-head">
                  <${Avatar} player=${players[s]} size="xs" />
                  <span class="bd-other-name">${players[s]?.name ?? '?'}</span>
                  <span class="bd-star">★${p.stars}</span>
                  <${Tray} tray=${p.tray} size="xs" />
                </div>
                <div class="bd-other-line">${p.line.map((m) => html`<span key=${m.id} class=${cx('bd-mini', `is-${m.kind}`, m.big && 'is-big')} title=${describe(m)}><${Effect} m=${m} size="xs" /></span>`)}</div>
                ${r && html`<div class="bd-other-last">${summary(r)}</div>`}
              </div>
            `;
          })}
        </div>

        <p class="tb-legend">${ROUNDS}周で終わり。<b>★</b> と <b>機械の点</b> の合計が多い人の勝ち。どの機械も、1周に動くのは1回です。</p>
      </div>
    </div>
  `;
}

function Rules() {
  const sample = [
    { kind: 'paint', in: 1, out: 0 },
    { kind: 'star', in: 0, gain: 1 },
    { kind: 'bonus', in: 0, out: 2 },
    { kind: 'star', in: 2, gain: 1 },
  ];
  const machine = (m, i) => html`<span key=${i} class=${cx('bd-machine', `is-${m.kind}`)}><small class="bd-no">${i + 1}</small><${Effect} m=${m} /><i class="bd-kind">${KIND_NAMES[m.kind]}</i></span>`;
  return html`
    <div class="rules bd-rules">
      <p class="rules-lead">玉を流すと、ならべた機械がつぎつぎ動きます。玉をためて機械をふやし、もっと長い連鎖に。</p>
      <h3>3行でわかる</h3>
      <ol>
        <li>玉を1個えらぶと、<b>自分の機械の列を、左から右へ</b>流れます。</li>
        <li><b>色の合う機械</b>が動いて、★ や玉がもらえます。流れきった玉は皿にたまります。</li>
        <li>皿の玉で<b>機械をつくって</b>、列をのばします。${ROUNDS}周で、★ と機械の点が多い人の勝ち。</li>
      </ol>
      <h3>毎周やること</h3>
      <p>全員が同時に、次の<b>どちらか1つ</b>をえらびます。場の玉と機械は全員共通で、同じものを何人がえらんでもかまいません。</p>
      <ul>
        <li><b>① 玉を流す</b>：場の玉を1個えらびます。</li>
        <li><b>② 機械をつくる</b>：皿の玉を払って場の機械をつくり、自分の列の<b>好きな場所</b>にさしこみます。</li>
      </ul>
      <h3>機械は3種類</h3>
      <ul class="bd-kinds">
        <li>${machine(sample[1], 0)} <b>得点</b>：その色の玉が通ると、★ をもらいます。</li>
        <li>${machine(sample[0], 0)} <b>色がえ</b>：玉の色が変わります。変わったあとの色で、右の機械を動かします。</li>
        <li>${machine(sample[2], 0)} <b>おまけ</b>：玉がもう1個出ます。出た玉は、その機械の右から流れます。</li>
      </ul>
      <p>
        <${Ball} color=${ANY} size="sm" /> の機械は、どの色の玉でも動きます。「かざり」は動きませんが、点が高い機械です。どの機械も、<b>1周に動くのは1回</b>だけです。
      </p>
      <h3>例</h3>
      <p class="bd-example">${sample.map(machine)}</p>
      <p>この列に<b>青い玉</b>を流すと…</p>
      <ol>
        <li>1番で 赤に変わる</li>
        <li>2番で ★1</li>
        <li>3番で 黄の玉が出る</li>
        <li>赤の玉が皿へ</li>
        <li>出てきた黄の玉が、4番で ★1</li>
        <li>黄の玉が皿へ</li>
      </ol>
      <p>4台が動いて ★2個。皿には赤と黄の玉が入ります。もし1番と2番が逆だったら、青い玉は2番を素通りしてしまいます。<b>ならべる順番</b>が大事です。</p>
      <h3>皿と代金</h3>
      <ul>
        <li>皿の玉は、機械をつくる材料です。入るのは <b>${TRAY}個</b>まで。いっぱいのときに玉が入ると、いちばん多い色の玉が1個おしだされます。</li>
        <li>機械の代金は、カードにならんだ玉です。<b>足りない色は、ほかの玉2個で1個ぶん</b>にできます。</li>
      </ul>
      <h3>場の入れかわり</h3>
      <ul>
        <li>玉は、毎周ぜんぶ入れかわります。</li>
        <li>だれかがつくった機械は場からなくなり、新しい機械が入ります。だれもつくらなかった段は、いちばん左の1枚が流れていきます。</li>
      </ul>
      <h3>終了</h3>
      <p><b>${ROUNDS}周</b>で終わり。<b>★ ＋ 機械の点</b> の多い人の勝ちです。同点なら、★ の多い人が上です。</p>
      <h3>コツ</h3>
      <ul>
        <li>「色がえ」や「おまけ」は左に、「得点」は右に置くと、連鎖がつながりやすくなります。</li>
        <li>玉をえらぶと、何が起きるかが先に出ます。いろいろ試してから決めましょう。</li>
        <li>何でもつくればよいわけではありません。つくる周は、玉を流せない周です。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.scores,
  unit: '点',
  progress: (view) => `${view.round} / ${view.maxRounds} 周`,
  waiting: (view) => !view.over && view.phase === 'pick',
  turnSound: false,
  turnSeats: (view, pending) => (view.phase === 'pick' ? pending : []),
  extra: (view, s) => `★${view.players[s].stars}・${view.players[s].line.length}台`,
};
