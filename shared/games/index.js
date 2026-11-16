// ゲームの一覧。新しいゲームを足すときは、ここに登録して
// public/js/games/index.js に画面を追加する。

import * as toudai from './toudai.js';
import * as gottsunko from './gottsunko.js';
import * as dokan from './dokan.js';
import * as korokoro from './korokoro.js';
import * as bento from './bento.js';
import * as tataki from './tataki.js';
import * as hitsuji from './hitsuji.js';

export const GAMES = { toudai, gottsunko, dokan, korokoro, bento, tataki, hitsuji };
export const GAME_LIST = Object.values(GAMES).map((g) => g.meta);
