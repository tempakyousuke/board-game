// 効果音。音声ファイルは持たず、Web Audio でその場で合成する。
//
// ブラウザは「ユーザーが画面を触るまで音を出せない」ので、最初のタップやキー入力で音の準備をする。
// 音はサーバーからの通知をきっかけに鳴ることが多い (相手が動いた、など) ため、
// それより前に一度でも画面を触っていれば鳴る。

import { useEffect, useRef } from './lib.js';

const STORAGE_KEY = 'bg.sound';
const MASTER_VOLUME = 0.5;

let ctx = null;
let master = null;
let noiseBuffer = null;
let offset = 0; // いま組み立てている音の、開始までの遅れ (秒)
let enabled = readSetting();
const listeners = new Set();
const recent = [];

function readSetting() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function isSoundOn() {
  return enabled;
}

export function setSoundOn(value) {
  enabled = !!value;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* 保存できなくても、この画面のあいだは切り替わる */
  }
  for (const fn of listeners) fn(enabled);
  if (enabled) {
    unlock();
    play('pop');
  }
}

/** 設定が変わったときに呼ばれる関数を登録する。戻り値を呼ぶと解除。 */
export function onSoundChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 最近鳴らした音の名前 (動作確認用)。 */
export function recentSounds() {
  return recent.slice();
}

function unlock() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, unlock, { passive: true });
}

// ---- 音の部品 ------------------------------------------------------------

/** 音程のある音。to を渡すと、その高さまでなめらかに変わる。 */
function tone({ freq, to = null, type = 'sine', start = 0, dur = 0.15, gain = 0.25, attack = 0.006 }) {
  const t0 = ctx.currentTime + offset + start;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** 音程のない「ザッ」「シュッ」という音。フィルターの高さで音色が変わる。 */
function noise({ start = 0, dur = 0.2, gain = 0.2, filter = 'lowpass', freq = 1200, to = null, q = 0.8 }) {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + offset + start;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const biquad = ctx.createBiquadFilter();
  biquad.type = filter;
  biquad.Q.value = q;
  biquad.frequency.setValueAtTime(freq, t0);
  if (to) biquad.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(biquad).connect(env).connect(master);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.03);
}

/** 音をつづけて鳴らす (ドミソ、のような並び)。 */
function notes(freqs, { step = 0.1, dur = 0.16, type = 'triangle', gain = 0.22, last = null }) {
  freqs.forEach((freq, i) => {
    const isLast = i === freqs.length - 1;
    tone({ freq, start: i * step, dur: isLast && last ? last : dur, type, gain });
  });
}

// ---- 音の一覧 ------------------------------------------------------------

const SOUNDS = {
  // 進行
  start: () => notes([523, 659, 784], { step: 0.09, dur: 0.18 }),
  turn: () => notes([659, 880], { step: 0.1, dur: 0.14, last: 0.26 }),
  win: () => notes([523, 659, 784, 1047, 1319], { step: 0.11, dur: 0.16, last: 0.55, gain: 0.25 }),
  lose: () => notes([392, 330, 262], { step: 0.17, dur: 0.26, type: 'sine', last: 0.45 }),
  join: () => notes([587, 784], { step: 0.07, dur: 0.1, type: 'sine', gain: 0.18 }),
  emote: () => tone({ freq: 700, to: 1050, dur: 0.1, gain: 0.16 }),
  error: () => tone({ freq: 140, dur: 0.16, type: 'square', gain: 0.07 }),

  // 置く・取る
  place: () => {
    tone({ freq: 440, to: 220, dur: 0.09, gain: 0.35 });
    noise({ dur: 0.03, gain: 0.1, filter: 'highpass', freq: 2200 });
  },
  pop: () => tone({ freq: 380, to: 760, dur: 0.08, gain: 0.26 }),
  card: () => {
    noise({ dur: 0.06, gain: 0.14, filter: 'highpass', freq: 2600 });
    tone({ freq: 300, to: 200, dur: 0.05, gain: 0.12 });
  },
  coin: () => {
    tone({ freq: 988, dur: 0.07, type: 'square', gain: 0.09 });
    tone({ freq: 1319, start: 0.07, dur: 0.3, type: 'square', gain: 0.09 });
  },
  chime: () => {
    tone({ freq: 1047, dur: 0.5, gain: 0.18 });
    tone({ freq: 1568, start: 0.08, dur: 0.5, gain: 0.15 });
  },
  up: () => notes([523, 659, 784], { step: 0.06, dur: 0.1, type: 'sine', gain: 0.18 }),
  down: () => notes([392, 311], { step: 0.09, dur: 0.14, type: 'sine', gain: 0.18 }),

  // ぶつかる・失敗
  bonk: () => {
    tone({ freq: 180, to: 70, dur: 0.22, gain: 0.45 });
    noise({ dur: 0.08, gain: 0.2, freq: 900 });
  },
  fail: () => {
    tone({ freq: 311, to: 233, dur: 0.22, type: 'sawtooth', gain: 0.09 });
    tone({ freq: 233, to: 147, start: 0.22, dur: 0.38, type: 'sawtooth', gain: 0.09 });
  },
  boom: () => {
    noise({ dur: 0.9, gain: 0.6, freq: 1400, to: 80 });
    tone({ freq: 120, to: 35, dur: 0.7, gain: 0.6 });
  },

  // 動く
  whoosh: () => noise({ dur: 0.28, gain: 0.14, filter: 'bandpass', freq: 500, to: 2400 }),
  step: () => tone({ freq: 150, to: 105, dur: 0.07, gain: 0.3 }),
  sneak: () => noise({ dur: 0.2, gain: 0.06, filter: 'highpass', freq: 3200 }),
  smoke: () => noise({ dur: 0.6, gain: 0.3, filter: 'bandpass', freq: 2600, to: 300 }),
  bark: () => {
    tone({ freq: 430, to: 250, dur: 0.09, type: 'square', gain: 0.09 });
    tone({ freq: 480, to: 270, start: 0.13, dur: 0.1, type: 'square', gain: 0.09 });
  },
  caught: () => {
    noise({ dur: 0.35, gain: 0.25, filter: 'highpass', freq: 3000 });
    notes([784, 988, 1175], { step: 0.07, dur: 0.14, last: 0.4 });
  },

  // サイコロ・時間
  dice: () => {
    for (let i = 0; i < 6; i++) {
      noise({ start: i * 0.055 + Math.random() * 0.02, dur: 0.03, gain: 0.18, filter: 'bandpass', freq: 1700 + Math.random() * 1600, q: 3 });
    }
  },
  // level は 0〜1。導火線は進むほど、競りは安くなるほど音が変わる。
  fuse: ({ level = 0 }) => {
    tone({ freq: 280 + level * 520, dur: 0.07, type: 'square', gain: 0.07 });
    noise({ dur: 0.12, gain: 0.05, filter: 'highpass', freq: 4000 });
  },
  tick: ({ level = 0.5 }) => tone({ freq: 420 + level * 620, dur: 0.045, type: 'triangle', gain: 0.14 }),
  sold: () => {
    tone({ freq: 400, to: 200, dur: 0.08, gain: 0.4 });
    tone({ freq: 400, to: 200, start: 0.13, dur: 0.08, gain: 0.4 });
  },
  unsold: () => tone({ freq: 196, to: 147, dur: 0.3, type: 'triangle', gain: 0.18 }),
};

/**
 * 効果音を鳴らす。
 * @param {keyof typeof SOUNDS} name
 * @param {{ delay?: number, level?: number }} options delay は秒
 */
export function play(name, options = {}) {
  recent.push(name);
  if (recent.length > 30) recent.shift();
  if (!enabled || !SOUNDS[name] || !ctx || ctx.state !== 'running') return;
  offset = options.delay ?? 0;
  try {
    SOUNDS[name](options);
  } catch {
    /* 音が出せなくてもゲームは続ける */
  }
  offset = 0;
}

/**
 * 値が変わったときだけ onChange を呼ぶ。画面を開いた直後 (最初の描画) は呼ばないので、
 * リロードしたときに過去のできごとの音が鳴ることはない。
 */
export function useChanged(value, onChange) {
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value) return;
    const before = prev.current;
    prev.current = value;
    onChange(value, before);
  }, [value]);
}
