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
import * as dauto from './dauto.js';
import * as tobiishi from './tobiishi.js';
import * as fukikobore from './fukikobore.js';
import * as takopa from './takopa.js';
import * as wasabi from './wasabi.js';
import * as tsumiage from './tsumiage.js';
import * as bidama from './bidama.js';

export const GAMES = { toudai, gottsunko, dokan, korokoro, bento, tataki, hitsuji, ninja, noronoro, hatake, docchi, obake, ohajiki, dauto, tobiishi, fukikobore, takopa, wasabi, tsumiage, bidama };
export const GAME_LIST = Object.values(GAMES).map((g) => g.meta);
