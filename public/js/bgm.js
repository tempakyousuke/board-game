// BGM。public/bgm/ に置いた曲を、シャッフルした順番で1曲ずつ流す。
//
// 曲の一覧はサーバーが /bgm/list.json で返すので、曲を増やすときはファイルを置くだけでいい。
// 全曲流し終えたら並べ直す (直前の曲がすぐまた来ないようにする)。
// ブラウザは画面を触るまで音を出せないので、最初のタップやキー入力で再生を始める。

const STORAGE_KEY = 'bg.bgm';
const VOLUME_KEY = 'bg.bgmVolume';
const DEFAULT_VOLUME = 55; // 0〜100。実際の音量は2乗するので、55 で 0.3 くらい
const MAX_GAIN = 1;

let enabled = readSetting();
let volume = readVolume();
let audio = null;
let ctx = null;
let gain = null;
let tracks = null; // 曲のファイル名の一覧。読み込み前は null
let queue = [];
let current = null;
let loading = null;
const listeners = new Set();

function readSetting() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function readVolume() {
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY));
    if (localStorage.getItem(VOLUME_KEY) !== null && value >= 0 && value <= 100) return value;
  } catch {
    /* 読めなければ初期値 */
  }
  return DEFAULT_VOLUME;
}

export function isBgmOn() {
  return enabled;
}

/** 音量 (0〜100)。 */
export function getBgmVolume() {
  return volume;
}

export function setBgmVolume(value) {
  volume = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    /* 保存できなくても、この画面のあいだは変わる */
  }
  applyVolume();
  emit();
}

// 耳に自然に聞こえるよう、つまみの位置を2乗して音量にする。
function gainValue() {
  return (volume / 100) ** 2 * MAX_GAIN;
}

function applyVolume() {
  if (gain) gain.gain.value = gainValue();
  else if (audio) audio.volume = Math.min(1, gainValue());
}

/** いま流れている曲の名前 (拡張子なし)。流れていなければ null。 */
export function currentTrack() {
  return current ? current.replace(/\.[^.]+$/, '') : null;
}

export function setBgmOn(value) {
  enabled = !!value;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* 保存できなくても、この画面のあいだは切り替わる */
  }
  if (enabled) start();
  else audio?.pause();
  emit();
}

/** 設定や曲が変わったときに呼ばれる関数を登録する。戻り値を呼ぶと解除。 */
export function onBgmChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn({ on: enabled, track: currentTrack(), volume });
}

function loadTracks() {
  if (!loading) {
    loading = fetch('/bgm/list.json')
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => [])
      .then((list) => {
        tracks = Array.isArray(list) ? list : [];
      });
  }
  return loading;
}

function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  // 並べ直した直後に、さっきと同じ曲が来ないようにする。
  if (out.length > 1 && out[0] === current) out.push(out.shift());
  return out;
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  // iPhone は audio.volume を無視するので、Web Audio を通して音量を変える。
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (AudioContext) {
    try {
      ctx = new AudioContext();
      gain = ctx.createGain();
      ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination);
    } catch {
      ctx = null;
      gain = null;
    }
  }
  applyVolume();
  audio.addEventListener('ended', next);
  // 読めない曲があっても止まらず次へ進む。
  audio.addEventListener('error', () => {
    if (enabled && current) setTimeout(next, 1000);
  });
  return audio;
}

function next() {
  if (!tracks?.length) return;
  if (!queue.length) queue = shuffled(tracks);
  current = queue.shift();
  const el = ensureAudio();
  el.src = `/bgm/${encodeURIComponent(current)}`;
  emit();
  if (enabled && !document.hidden) el.play().catch(() => {});
}

async function start() {
  if (!enabled) return;
  await loadTracks();
  if (!enabled || !tracks.length) return;
  if (!current) {
    next();
    return;
  }
  if (audio.paused && !document.hidden) audio.play().catch(() => {});
}

// 最初に画面を触ったときに流し始める。再生に失敗したら (まだ許可されていない)、次に触ったときにまた試す。
function onGesture() {
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  if (!enabled) return;
  if (audio && !audio.paused) return;
  start();
}
for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, onGesture, { passive: true });
}

// 別のタブに移ったら止め、戻ってきたら続きから流す。
document.addEventListener('visibilitychange', () => {
  if (!audio || !current) return;
  if (document.hidden) audio.pause();
  else if (enabled) {
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    audio.play().catch(() => {});
  }
});
