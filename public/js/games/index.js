// ゲームごとの画面部品の一覧。ルールなどの情報は shared/games 側の meta を使う。

import { GAMES } from '/shared/games/index.js';
import toudai from './toudai.js';
import gottsunko from './gottsunko.js';
import dokan from './dokan.js';
import korokoro from './korokoro.js';
import bento from './bento.js';
import tataki from './tataki.js';

const SCREENS = { toudai, gottsunko, dokan, korokoro, bento, tataki };

export const GAME_UI = Object.fromEntries(
  Object.keys(GAMES).map((id) => [id, { meta: GAMES[id].meta, ...SCREENS[id] }]),
);
export const GAME_METAS = Object.values(GAME_UI).map((g) => g.meta);
