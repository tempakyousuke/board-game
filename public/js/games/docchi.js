// どっち派？あてっこの画面。

import { html, useState, useEffect, cx } from '../lib.js';
import { ROUNDS } from '/shared/games/docchi.js';
import { Avatar } from '../ui.js';
import { play, useChanged } from '../sound.js';

function Board({ view, seat, players, act }) {
  const playing = seat >= 0 && !view.over;
  const [own, setOwn] = useState(null);
  const [guesses, setGuesses] = useState({});

  useEffect(() => {
    setOwn(null);
    setGuesses({});
  }, [view.round]);
  useChanged(view.phase, (phase) => play(phase === 'reveal' ? 'chime' : 'card'));

  const { question, reveal } = view;
  const mine = view.myAnswer;
  const answering = view.phase === 'answer';
  const others = players.map((_, s) => s).filter((s) => s !== seat);
  // 決定したあとでも、まだ全員そろっていなければ選び直せる。
  const myOwn = own ?? mine?.own ?? null;
  const guessOf = (s) => guesses[s] ?? mine?.guesses[s] ?? null;
  const complete = myOwn !== null && others.every((s) => guessOf(s) !== null);
  const dirty = complete && (!mine || mine.own !== myOwn || others.some((s) => mine.guesses[s] !== guessOf(s)));
  const waitingFor = view.submitted.filter((d) => !d).length;
  const last = view.round >= view.maxRounds;

  const submit = () => {
    act({ type: 'answer', own: myOwn, guesses: players.map((_, s) => (s === seat ? null : guessOf(s))) });
  };

  let status;
  if (view.over) status = 'おつかれさまでした！';
  else if (!answering) status = '答え合わせ！';
  else if (seat < 0) status = `あと ${waitingFor} 人が考えています`;
  else if (mine && !dirty) status = waitingFor > 0 ? `決定しました。あと ${waitingFor} 人を待っています…` : '全員そろいました';
  else if (myOwn === null) status = 'まず、あなた自身はどっち？';
  else if (!complete) status = 'みんなはどっちを選ぶと思う？';
  else status = 'これでよければ「決定」を押してください';

  /** 1人ぶんの行。入力中は選べるボタン、答え合わせでは結果を出す。 */
  const row = (s) => {
    const isMe = s === seat;
    const picked = isMe ? myOwn : guessOf(s);
    const actual = reveal ? reveal.own[s] : null;
    const myGuess = reveal && seat >= 0 && !isMe ? reveal.guesses[seat][s] : null;
    return html`
      <div key=${s} class=${cx('dc-row', isMe && 'is-me')}>
        <span class="dc-who">
          <${Avatar} player=${players[s]} size="sm" />
          <span class="dc-name">${isMe ? 'あなた' : players[s].name}</span>
          ${reveal && html`<b class="dc-gain">+${reveal.gained[s]}</b>`}
          ${myGuess !== null && html`<i class=${cx('dc-mark', myGuess === actual ? 'is-hit' : 'is-miss')}>${myGuess === actual ? '◎ あたり' : '✕ はずれ'}</i>`}
        </span>
        ${[0, 1].map((option) => {
          if (reveal) {
            return html`<span key=${option} class=${cx('dc-cell', actual === option && 'is-actual', myGuess === option && 'is-guessed')}>
              ${actual === option ? '●' : ''}
            </span>`;
          }
          return html`
            <button
              key=${option}
              class=${cx('dc-cell dc-pick', picked === option && 'is-on')}
              disabled=${!playing || !answering}
              onClick=${() => (isMe ? setOwn(option) : setGuesses({ ...guesses, [s]: option }))}
              aria-pressed=${picked === option}
              aria-label=${`${isMe ? 'あなた' : players[s].name}: ${question.options[option]}`}
            >
              ${picked === option ? '●' : ''}
            </button>
          `;
        })}
      </div>
    `;
  };

  return html`
    <div class="game docchi">
      <div class="dc-card">
        <h2>${question.text}</h2>
        <div class="dc-options">
          <span class="dc-option is-a">${question.options[0]}</span>
          <span class="dc-vs">or</span>
          <span class="dc-option is-b">${question.options[1]}</span>
        </div>
      </div>

      <div class="panel">
        <p class=${cx('status', playing && answering && (!mine || dirty) && 'is-mine')}>${status}</p>

        <div class="dc-table">
          <div class="dc-row dc-head">
            <span class="dc-who">${reveal ? 'みんなの答え' : seat >= 0 ? 'どっちだと思う？' : ''}</span>
            <span class="dc-cell is-a">${question.options[0]}</span>
            <span class="dc-cell is-b">${question.options[1]}</span>
          </div>
          ${seat >= 0 && row(seat)}
          ${others.map(row)}
        </div>

        ${playing &&
        answering &&
        html`<button class="btn btn-primary btn-block" disabled=${!dirty} onClick=${submit}>${mine ? '答えを変える' : '決定'}</button>`}
        ${playing &&
        !answering &&
        html`<button class="btn btn-primary btn-block" onClick=${() => act({ type: 'next' })}>${last ? '結果を見る' : 'つぎのお題へ'}</button>`}

        <p class="muted dc-note">当てたら +1点。当ててもらえた人にも +1点。</p>
        ${view.over &&
        view.result.detail.bestPair &&
        html`
          <p class="dc-best">
            💞 いちばん通じ合っていたのは
            <b>${view.result.detail.bestPair.pair.map((s) => players[s].name).join(' さんと ')} さん</b>
            （${view.result.detail.bestPair.total} / ${view.result.detail.outOf} 回あたり）
          </p>
        `}
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        「犬派？猫派？」のような二択のお題に答えながら、友達がどっちを選ぶかを当てるゲームです。おたがいをどれだけ分かっているかが試されます。
      </p>
      <h3>進め方</h3>
      <ol>
        <li>二択のお題が出ます。</li>
        <li>全員が同時に、<b>自分の答え</b>と、<b>ほかの人がどっちを選ぶか</b>の予想をこっそり決めます。</li>
        <li>全員が決めたら答え合わせです。</li>
      </ol>
      <h3>得点</h3>
      <ul>
        <li>だれかの答えを<b>当てたら +1点</b>。</li>
        <li>自分の答えを<b>当ててもらえたら +1点</b>。</li>
      </ul>
      <p>当ててもらうと自分にも点が入るので、ひねらず正直に答えるのがいちばんです。</p>
      <h3>終了</h3>
      <p><b>${ROUNDS}問</b>で終了。点の高い人の勝ちです。最後に、いちばん通じ合っていた2人も発表されます。</p>
      <h3>コツ</h3>
      <ul>
        <li>声でおしゃべりしながら遊ぶと盛り上がります。「えっ、そっちなの？」が楽しいゲームです。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.points,
  unit: '点',
  progress: (view) => `お題 ${Math.min(view.round, view.maxRounds)} / ${view.maxRounds}`,
  waiting: (view) => !view.over && view.phase === 'answer',
  turnSound: false,
  turnSeats: (view, pending) => (view.phase === 'answer' ? pending : []),
  extra: () => '',
};
