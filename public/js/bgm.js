// BGM。public/bgm/ に置いた曲を、シャッフルした順番で1曲ずつ流す。
//
// 曲の一覧はサーバーが /bgm/list.json で返すので、曲を増やすときはファイルを置くだけでいい。
// 全曲流し終えたら並べ直す (直前の曲がすぐまた来ないようにする)。
// ブラウザは画面を触るまで音を出せないので、最初のタップやキー入力で再生を始める。

const STORAGE_KEY = 'bg.bgm';
const VOLUME = 0.3;

let enabled = readSetting();
let audio = null;
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

export function isBgmOn() {
  return enabled;
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
  for (const fn of listeners) fn({ on: enabled, track: currentTrack() });
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
  audio.volume = VOLUME;
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
  else if (enabled) audio.play().catch(() => {});
});
