// どっち派？あてっこ — 友達がどっちを選ぶかを当てるパーティーゲーム (2〜6人)
//
// ・毎ラウンド、二択のお題が出る (犬派？猫派？ など)。
// ・全員が同時に「自分の答え」と「ほかの人がどっちを選ぶか」をこっそり決める。
// ・答え合わせ。当てたら自分に +1点、当ててもらえた人にも +1点。
//   当ててもらうと得をするので、正直に答えるのがいちばん。
// ・8ラウンドで終了。点の高い人の勝ち。最後に、いちばん通じ合っていた2人も発表する。

import { assert, makeResult } from './common.js';
import { shuffle } from '../rng.js';
import { QUESTIONS } from './docchi-questions.js';

export const meta = {
  id: 'docchi',
  name: 'どっち派？あてっこ',
  emoji: '🤝',
  tagline: '犬派？猫派？ あの人ならどっちを選ぶか、当てられる？',
  minPlayers: 2,
  maxPlayers: 6,
  time: '5〜10分',
  tags: ['わいわい', 'おしゃべり', '同時プレイ'],
};

export const ROUNDS = 8;

export function setup({ n, rng }) {
  return {
    n,
    round: 1,
    maxRounds: ROUNDS,
    // 同じゲームの中でお題がかぶらないよう、先に順番を決めておく。
    questions: shuffle(
      rng,
      QUESTIONS.map((_, i) => i),
    ).slice(0, ROUNDS),
    phase: 'answer', // answer: 全員がこっそり答える / reveal: 答え合わせ
    answers: new Array(n).fill(null), // { own: 0|1, guesses: (0|1|null)[] }
    points: new Array(n).fill(0),
    // hits[i][j] = i が j の答えを当てた回数
    hits: Array.from({ length: n }, () => new Array(n).fill(0)),
    reveal: null,
    over: false,
    result: null,
  };
}

export function act(state, seat, action) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && typeof action.type === 'string', '不明な操作です');

  if (action.type === 'next') {
    assert(state.phase === 'reveal', 'まだ次のお題には進めません');
    if (state.round >= state.maxRounds) return finish(state);
    state.round++;
    state.phase = 'answer';
    state.answers = new Array(state.n).fill(null);
    state.reveal = null;
    return;
  }

  assert(action.type === 'answer', '不明な操作です');
  assert(state.phase === 'answer', 'いまは答え合わせ中です');
  const { own, guesses } = action;
  assert(own === 0 || own === 1, '自分の答えを選んでください');
  assert(Array.isArray(guesses) && guesses.length === state.n, 'みんなの答えを予想してください');
  for (let other = 0; other < state.n; other++) {
    if (other === seat) continue;
    assert(guesses[other] === 0 || guesses[other] === 1, 'みんなの答えを予想してください');
  }
  state.answers[seat] = { own, guesses: guesses.map((g, other) => (other === seat ? null : g)) };
  if (state.answers.every((a) => a !== null)) resolve(state);
}

function resolve(state) {
  const { n } = state;
  const gained = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (state.answers[i].guesses[j] === state.answers[j].own) {
        state.hits[i][j]++;
        gained[i]++; // 当てた
        gained[j]++; // 当ててもらえた
      }
    }
  }
  for (let s = 0; s < n; s++) state.points[s] += gained[s];
  state.reveal = {
    own: state.answers.map((a) => a.own),
    guesses: state.answers.map((a) => a.guesses),
    gained,
  };
  state.phase = 'reveal';
}

function finish(state) {
  state.over = true;
  // いちばん通じ合っていた2人 (おたがいに当てた回数の合計が多い組)。
  let best = null;
  for (let i = 0; i < state.n; i++) {
    for (let j = i + 1; j < state.n; j++) {
      const total = state.hits[i][j] + state.hits[j][i];
      if (!best || total > best.total) best = { pair: [i, j], total };
    }
  }
  state.result = makeResult(state.points.slice(), { unit: '点', detail: { bestPair: best, outOf: state.maxRounds * 2 } });
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  const [text, a, b] = QUESTIONS[state.questions[state.round - 1]];
  return {
    n: state.n,
    round: state.round,
    maxRounds: state.maxRounds,
    question: { text, options: [a, b] },
    phase: state.phase,
    submitted: state.answers.map((ans) => ans !== null),
    // 自分の答えと予想は、答え合わせまで本人にしか見せない。
    myAnswer: mine ? state.answers[seat] : null,
    reveal: state.reveal,
    points: state.points,
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  if (state.phase === 'reveal') return Array.from({ length: state.n }, (_, s) => s);
  return state.answers.map((a, s) => (a === null ? s : -1)).filter((s) => s >= 0);
}

export function bot(state, seat, rng) {
  if (state.phase === 'reveal') return { type: 'next' };
  const coin = () => (rng() < 0.5 ? 0 : 1);
  return {
    type: 'answer',
    own: coin(),
    guesses: Array.from({ length: state.n }, (_, other) => (other === seat ? null : coin())),
  };
}
