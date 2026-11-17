// ゲームの一覧。新しいゲームを足すときは、ここに登録して
// public/js/games/index.js に画面を追加する。

import * as toudai from './toudai.js';
import * as gottsunko from './gottsunko.js';
import * as dokan from './dokan.js';
import * as korokoro from './korokoro.js';
import * as bento from './bento.js';
import * as tataki from './tataki.js';
import * as hitsuji from './hitsuji.js';
import * as ninja from './ninja.js';
import * as noronoro from './noronoro.js';
import * as hatake from './hatake.js';
import * as docchi from './docchi.js';
import * as obake from './obake.js';
import * as ohajiki from './ohajiki.js';

export const GAMES = { toudai, gottsunko, dokan, korokoro, bento, tataki, hitsuji, ninja, noronoro, hatake, docchi, obake, ohajiki };
export const GAME_LIST = Object.values(GAMES).map((g) => g.meta);
