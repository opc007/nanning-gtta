/**
 * Nanning flavour data. Kept as DATA (no logic) so it can be unit-tested and
 * later swapped for CSV/JSON without touching any system code.
 *
 * Shop names: the owner (opc li) asked for real, well-known 中山路 / 南宁 old
 * shops instead of fictional parodies. Each record carries a `source`:
 *
 *   verified  — a published 中山路 (or named-on-the-street) business
 *   requested — a real Nanning business the owner asked to include; the
 *               flagship is not always on this exact block
 *   local     — a plausible street sign, used where no single famous name
 *               could be verified
 *
 * Verified against public guides (2026-10):
 *   复记老友粉（中山路店）青秀区中山路美食街
 *   中山粉饺（中山路店）中山路小吃街北
 *   梁记卷筒粉 中山路245-1号
 *   中山路夜市烤生蚝 / 蒜蓉生蚝（摊位，约 6 只 ¥20）
 *   冰神糖水、阿光豆浆油条 — named on 中山路 food-street routes
 * Requested real names whose flagship sits elsewhere:
 *   舒记老友粉 — 七星路44号
 *   甘家界柠檬鸭 — 南宁连锁
 *   横州茉莉 — 广西横州茉莉花，街饮用这个名字
 *   荣记、阿婆酸嘢 — owner-named 烧烤 / 酸嘢 signs
 *
 * Prices are mid-2020s street prices in yuan.
 */

export type ShopKind =
  | 'noodle'
  | 'fenjiao'
  | 'roll'
  | 'dessert'
  | 'tea'
  | 'grill'
  | 'suan'
  | 'cold'
  | 'mart'
  | 'luosifen'
  | 'duck'
  | 'breakfast'
  | 'snack'
  | 'seafood'
  | 'rice';

export type ShopSource = 'verified' | 'requested' | 'local';
export type StreetSection = 'north' | 'middle' | 'south';

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  /** Satiety restored (0–100). */
  fill: number;
  /** Short line shown in the purchase toast — local flavour, not a health claim. */
  blurb: string;
}

export interface ShopDef {
  id: string;
  name: string;
  kind: ShopKind;
  source: ShopSource;
  /** Which run of the street a storefront belongs to. Stalls ignore this and sit mid-street. */
  section: StreetSection;
  /** Storefront (always there) or night-market stall (out after 18:00). */
  place: 'shop' | 'stall';
  /** -1 = west side, +1 = east side. Stalls leave this 0; the layout places them in two rows. */
  side: -1 | 0 | 1;
  /** Signboard colour (hex) — drives the emissive neon at night. */
  signColor: number;
  items: ShopItem[];
  /** What the shopkeeper shouts when you trash the place. */
  angry: string[];
  /** Ambient chatter while the shop is intact. */
  idle: string[];
}

const item = (id: string, name: string, price: number, fill: number, blurb: string): ShopItem => ({
  id, name, price, fill, blurb,
});

const shout = (extra: string): string[] => [extra, '赔钱！信唔信我报警！', '你搞乜鬼啊！'];
const chat = (a: string, b: string): string[] => [a, b, '慢慢睇，唔使急'];

function shop(partial: Omit<ShopDef, 'angry' | 'idle'> & { angry?: string[]; idle?: string[] }): ShopDef {
  return {
    angry: partial.angry ?? shout('我嘅铺！'),
    idle: partial.idle ?? chat('今日有新鲜嘅', '食辣唔食辣？'),
    ...partial,
  };
}

const NOODLE_MENU: ShopItem[] = [
  item('lf', '老友粉', 12, 40, '酸笋豆豉，镬气够'),
  item('lfz', '猪杂粉', 15, 48, '粉滑，杂入味'),
  item('lfm', '老友面', 12, 38, '起源于茶馆，暖到出汗'),
  item('egg', '加蛋', 2, 6, '煎蛋盖上去'),
];

const FENJIAO_MENU: ShopItem[] = [
  item('fj', '粉饺一碟', 10, 28, '皮薄，馅是肉'),
  item('yx', '鸭血汤', 6, 12, '一碗暖的'),
  item('set', '一碟一碗套餐', 15, 45, '粉饺配汤，够一餐'),
];

const GRILL_MENU: ShopItem[] = [
  item('oyster', '生蚝 6 只', 20, 22, '蒜蓉堆到起'),
  item('wing', '鸡翅', 6, 14, '炭火逼出油脂'),
  item('chive', '韭菜', 4, 8, '南宁人嘅心头好'),
  item('beer', '啤酒', 6, 4, '冰嘅，先饮再算'),
];

const TEA_MENU: ShopItem[] = [
  item('jasmine', '茉莉奶茶', 12, 12, '横州花香'),
  item('buffalo', '水牛奶茶', 14, 14, '水牛奶底，厚'),
  item('lemon', '柠檬茶', 10, 10, '柠檬捶到出汁'),
];

const SUAN_MENU: ShopItem[] = [
  item('mango', '青芒酸嘢', 8, 8, '辣椒粉加甘草盐'),
  item('papaya', '木瓜酸嘢', 9, 8, '脆，解腻'),
  item('pine', '菠萝酸嘢', 10, 8, '酸完会醒'),
];

/** Storefronts, north → south, west side then east side within a section. */
export const SHOPS: ShopDef[] = [
  // ── 北段：粉、粉饺、糖水，白天也开 ────────────────────────────────────
  shop({
    id: 'fuji',
    name: '复记老友粉',
    kind: 'noodle',
    source: 'verified',
    section: 'north',
    place: 'shop',
    side: -1,
    signColor: 0xff6b35,
    items: NOODLE_MENU,
    idle: chat('老友粉出锅咯', '复记辣椒酱，唔嗜辣少放'),
    angry: shout('我嘅镬！复记几十年啊！'),
  }),
  shop({
    id: 'zhongshan-fenjiao',
    name: '中山粉饺',
    kind: 'fenjiao',
    source: 'verified',
    section: 'north',
    place: 'shop',
    side: -1,
    signColor: 0xe8b84a,
    items: FENJIAO_MENU,
    idle: chat('粉饺出笼', '黄皮酱要唔要'),
  }),
  shop({
    id: 'liangji',
    name: '梁记卷筒粉',
    kind: 'roll',
    source: 'verified',
    section: 'north',
    place: 'shop',
    side: -1,
    signColor: 0xf0d78c,
    items: [
      item('roll', '肉末卷筒粉', 10, 30, '配黄皮酱'),
      item('rollc', '玉米卷筒粉', 10, 28, '现蒸现卷'),
      item('wp', '黄皮酱', 2, 2, '酸甜，淋上去'),
    ],
    idle: chat('卷筒粉，趁热', '下午卖完就收'),
  }),
  shop({
    id: 'bingshen',
    name: '冰神糖水',
    kind: 'dessert',
    source: 'verified',
    section: 'north',
    place: 'shop',
    side: -1,
    signColor: 0xf472b6,
    items: [
      item('tang', '糖水', 12, 16, '一碗甜的收尾'),
      item('ses', '芝麻糊', 9, 14, '绵，烫嘴'),
      item('taro', '芋头糕', 8, 15, '软糯'),
    ],
    idle: chat('糖水趁热', '芝麻糊凉咗就唔绵'),
  }),
  shop({
    id: 'aguang',
    name: '阿光豆浆油条',
    kind: 'breakfast',
    source: 'verified',
    section: 'north',
    place: 'shop',
    side: -1,
    signColor: 0xf5e6c8,
    items: [
      item('soy', '豆浆', 4, 8, '现磨'),
      item('yt', '油条', 3, 10, '泡进汤里'),
      item('set', '豆浆油条', 6, 16, '早餐就呢份'),
    ],
    idle: chat('油条刚起锅', '豆浆要甜定咸'),
  }),
  shop({
    id: 'shengzha',
    name: '生榨米粉',
    kind: 'breakfast',
    source: 'local',
    section: 'north',
    place: 'shop',
    side: -1,
    signColor: 0xf6d7a8,
    items: [
      item('sz', '生榨米粉', 10, 32, '米浆现榨，带点发酵香'),
      item('szm', '加肉末', 3, 8, '碎肉盖面'),
    ],
    idle: chat('生榨先至有味', '酸是发酵香，唔系坏'),
  }),
  shop({
    id: 'shuji',
    name: '舒记老友粉',
    kind: 'noodle',
    source: 'requested',
    section: 'north',
    place: 'shop',
    side: 1,
    signColor: 0xff8a3d,
    items: [
      item('beef', '老友牛肉粉', 16, 46, '现炒牛肉，扁粉'),
      item('lf', '老友粉', 12, 40, '酸辣鲜香'),
      item('tripe', '牛杂粉', 16, 44, '同一锅汤'),
      item('egg', '加蛋', 2, 6, '煎蛋'),
    ],
    idle: chat('牛肉粉要等一阵', '油条要唔要'),
    angry: shout('舒记嘅粉！'),
  }),
  shop({
    id: 'yongzhou-laoyou',
    name: '邕州老友粉',
    kind: 'noodle',
    source: 'local',
    section: 'north',
    place: 'shop',
    side: 1,
    signColor: 0xe85d2c,
    items: NOODLE_MENU,
    idle: chat('第三间粉，味唔同', '汤头今日够浓'),
  }),
  shop({
    id: 'huangpi',
    name: '黄皮酱粉饺',
    kind: 'fenjiao',
    source: 'local',
    section: 'north',
    place: 'shop',
    side: 1,
    signColor: 0xd4a017,
    items: FENJIAO_MENU,
    idle: chat('黄皮酱粉饺', '一碟一碗够唔够'),
  }),
  shop({
    id: 'zhima',
    name: '阿婆芝麻糊',
    kind: 'dessert',
    source: 'local',
    section: 'north',
    place: 'shop',
    side: 1,
    signColor: 0xc9a227,
    items: [
      item('zh', '芝麻糊', 9, 14, '绵密，烫嘴'),
      item('peanut', '花生糊', 9, 14, '香，要慢慢食'),
      item('cake', '鸡仔饼', 6, 9, '打包都得'),
    ],
    idle: chat('芝麻糊，几多钱', '趁热食'),
  }),
  shop({
    id: 'ganjiajie',
    name: '甘家界柠檬鸭',
    kind: 'duck',
    source: 'requested',
    section: 'north',
    place: 'shop',
    side: 1,
    signColor: 0xf5d76e,
    items: [
      item('duck', '柠檬鸭', 48, 55, '咸柠檬酸荞头焖鸭'),
      item('rice', '配米饭', 3, 12, '汁泡饭'),
      item('half', '柠檬鸭小份', 28, 36, '一个人食得完'),
    ],
    idle: chat('柠檬鸭要等', '汁够酸先至正'),
    angry: shout('我嘅柠檬鸭！'),
  }),
  shop({
    id: 'wonton',
    name: '中山云吞',
    kind: 'snack',
    source: 'local',
    section: 'north',
    place: 'shop',
    side: 1,
    signColor: 0xf8e1b0,
    items: [
      item('wt', '云吞', 12, 24, '一碗汤的'),
      item('nm', '云吞面', 14, 32, '面加云吞'),
    ],
    idle: chat('云吞现包', '汤清定要浓'),
  }),

  // ── 中段：夜市门面，烧烤外摆 ──────────────────────────────────────────
  shop({
    id: 'rongji',
    name: '荣记烧烤',
    kind: 'grill',
    source: 'requested',
    section: 'middle',
    place: 'shop',
    side: -1,
    signColor: 0xff4d4d,
    items: GRILL_MENU,
    idle: chat('荣记炭火旺', '生蚝新鲜先至甜'),
    angry: shout('我嘅炭！我嘅生蚝！'),
  }),
  shop({
    id: 'oyster-shop',
    name: '中山路烤生蚝',
    kind: 'grill',
    source: 'verified',
    section: 'middle',
    place: 'shop',
    side: -1,
    signColor: 0xff6b4a,
    items: GRILL_MENU,
    idle: chat('蒜蓉生蚝，六只二十', '炭够热先落蚝'),
  }),
  shop({
    id: 'charcoal-oyster',
    name: '炭火生蚝',
    kind: 'grill',
    source: 'local',
    section: 'middle',
    place: 'shop',
    side: -1,
    signColor: 0xe23b3b,
    items: GRILL_MENU,
    idle: chat('生蚝六只起', '啤酒冰紧'),
  }),
  shop({
    id: 'tianluo',
    name: '田螺鸭脚煲',
    kind: 'seafood',
    source: 'local',
    section: 'middle',
    place: 'shop',
    side: -1,
    signColor: 0xd4522a,
    items: [
      item('pot', '田螺鸭脚煲', 48, 50, '麻辣，配腐竹酸笋'),
      item('fen', '加粉', 4, 12, '粉吸汤'),
    ],
    idle: chat('煲要等', '手套喺度，唔好搞一手油'),
  }),
  shop({
    id: 'jialou',
    name: '假蒌夹',
    kind: 'snack',
    source: 'local',
    section: 'middle',
    place: 'shop',
    side: -1,
    signColor: 0x6aaa3a,
    items: [
      item('jl', '假蒌夹', 8, 12, '叶子包馅，煎到香'),
      item('jl3', '假蒌夹三件', 20, 28, '够分'),
    ],
    idle: chat('假蒌刚煎好', '趁脆食'),
  }),
  shop({
    id: 'beefball',
    name: '牛肉丸',
    kind: 'snack',
    source: 'local',
    section: 'middle',
    place: 'shop',
    side: -1,
    signColor: 0xc47a4a,
    items: [
      item('bb', '牛肉丸', 12, 20, '有弹性先至对'),
      item('soup', '丸子汤', 10, 16, '清汤'),
    ],
    idle: chat('牛肉丸现打', '要汤定干'),
  }),
  shop({
    id: 'bazhen',
    name: '八珍伊面',
    kind: 'snack',
    source: 'local',
    section: 'middle',
    place: 'shop',
    side: 1,
    signColor: 0xe8c07a,
    items: [
      item('bz', '八珍伊面', 18, 36, '料比粉贵'),
      item('small', '小份伊面', 12, 24, '一个人'),
    ],
    idle: chat('八珍今日齐', '伊面要煮透'),
  }),
  shop({
    id: 'niuzha',
    name: '老友炒牛杂',
    kind: 'snack',
    source: 'local',
    section: 'middle',
    place: 'shop',
    side: 1,
    signColor: 0xd4652f,
    items: [
      item('nz', '炒牛杂', 28, 36, '老友味，干香'),
      item('fen', '配粉', 4, 12, '拌匀食'),
    ],
    idle: chat('牛杂要快手', '辣可以加'),
  }),
  shop({
    id: 'xiajie',
    name: '霞姐瓦煲饭',
    kind: 'rice',
    source: 'local',
    section: 'middle',
    place: 'shop',
    side: 1,
    signColor: 0xc4843a,
    items: [
      item('pot', '瓦煲饭', 22, 42, '锅巴先至是重点'),
      item('pot2', '腊味瓦煲饭', 26, 46, '腊肠腊肉'),
    ],
    idle: chat('煲饭要等十分钟', '锅巴焦香'),
  }),
  shop({
    id: 'xiaochao',
    name: '街坊小炒',
    kind: 'rice',
    source: 'local',
    section: 'middle',
    place: 'shop',
    side: 1,
    signColor: 0xd98a4a,
    items: [
      item('fry', '小炒黄牛肉', 32, 40, '一碟下饭'),
      item('veg', '清炒时蔬', 16, 14, '解腻'),
      item('rice', '米饭', 3, 12, '添饭得'),
    ],
    idle: chat('小炒要猛火', '米饭自由添'),
  }),
  shop({
    id: 'kaoyu',
    name: '烤鱼档',
    kind: 'seafood',
    source: 'local',
    section: 'middle',
    place: 'shop',
    side: 1,
    signColor: 0xe25b3a,
    items: [
      item('fish', '烤鱼', 38, 44, '一条，辣或者不辣'),
      item('fishs', '烤鱼小份', 22, 28, '半条'),
    ],
    idle: chat('鱼今日活的', '辣度你讲'),
  }),
  shop({
    id: 'luwei',
    name: '卤味熟食',
    kind: 'snack',
    source: 'local',
    section: 'middle',
    place: 'shop',
    side: 1,
    signColor: 0x8b4518,
    items: [
      item('lu', '卤味拼盘', 18, 26, '鸭翅豆腐豆干'),
      item('wing', '卤鸭翅', 8, 14, '一只'),
    ],
    idle: chat('卤水够味', '要热定凉'),
  }),

  // ── 南段：奶茶、螺蛳粉、便利、凉茶 ────────────────────────────────────
  shop({
    id: 'hengzhou',
    name: '横州茉莉奶茶',
    kind: 'tea',
    source: 'requested',
    section: 'south',
    place: 'shop',
    side: -1,
    signColor: 0x2ee6a8,
    items: TEA_MENU,
    idle: chat('横州茉莉新到', '三分糖系啩'),
    angry: shout('我嘅茉莉！'),
  }),
  shop({
    id: 'ama-milk',
    name: '阿嫲水牛奶',
    kind: 'tea',
    source: 'local',
    section: 'south',
    place: 'shop',
    side: -1,
    signColor: 0x7ee0c0,
    items: TEA_MENU,
    idle: chat('水牛奶今日厚', '少冰得'),
  }),
  shop({
    id: 'luosifen',
    name: '中山路螺蛳粉',
    kind: 'luosifen',
    source: 'local',
    section: 'south',
    place: 'shop',
    side: -1,
    signColor: 0xc45c26,
    items: [
      item('ls', '螺蛳粉', 16, 42, '酸笋臭得正直'),
      item('ls2', '加炸蛋', 3, 8, '蛋要焦边'),
      item('mild', '少酸笋', 16, 40, '第一次食可以少放'),
    ],
    idle: chat('螺蛳粉出味', '酸笋自己加'),
    angry: shout('我煲嘅汤底！'),
  }),
  shop({
    id: 'wuhua',
    name: '五花凉茶',
    kind: 'cold',
    source: 'local',
    section: 'south',
    place: 'shop',
    side: -1,
    signColor: 0x3fa9f5,
    items: [
      item('wh', '五花茶', 6, 7, '下火'),
      item('mg', '茅根竹蔗水', 6, 8, '甜，解腻'),
      item('kd', '苦丁凉茶', 5, 6, '正苦'),
    ],
    idle: chat('凉茶凉茶，苦口啲', '去火冇'),
  }),
  shop({
    id: 'mart',
    name: '中山路士多',
    kind: 'mart',
    source: 'local',
    section: 'south',
    place: 'shop',
    side: -1,
    signColor: 0x22c55e,
    items: [
      item('noodle', '公仔面', 6, 18, '夜宵备用'),
      item('water', '矿泉水', 2, 2, '冰柜最底层'),
      item('bean', '绿豆沙', 4, 8, '冰镇'),
    ],
    idle: chat('要咩自己拣', '扫码定现金'),
    angry: shout('我嘅货！'),
  }),
  shop({
    id: 'peanut',
    name: '花生糊',
    kind: 'dessert',
    source: 'local',
    section: 'south',
    place: 'shop',
    side: -1,
    signColor: 0xd4b483,
    items: [
      item('ph', '花生糊', 8, 14, '香，绵'),
      item('zh', '芝麻糊', 9, 14, '黑芝麻'),
    ],
    idle: chat('糊要热食', '花生今日新磨'),
  }),
  shop({
    id: 'yongcha',
    name: '邕城柠檬茶',
    kind: 'tea',
    source: 'local',
    section: 'south',
    place: 'shop',
    side: 1,
    signColor: 0x34d399,
    items: TEA_MENU,
    idle: chat('柠檬茶走冰得', '茉莉定柠檬'),
  }),
  shop({
    id: 'liuzhou',
    name: '柳味螺蛳粉',
    kind: 'luosifen',
    source: 'local',
    section: 'south',
    place: 'shop',
    side: 1,
    signColor: 0xb4532a,
    items: [
      item('ls', '螺蛳粉', 15, 42, '柳州味，汤红'),
      item('extra', '加腐竹', 3, 6, '吸汤'),
    ],
    idle: chat('粉先烫', '汤底自己辣'),
  }),
  shop({
    id: 'kuding',
    name: '苦丁凉茶铺',
    kind: 'cold',
    source: 'local',
    section: 'south',
    place: 'shop',
    side: 1,
    signColor: 0x38bdf8,
    items: [
      item('kd', '苦丁凉茶', 5, 6, '苦完会回甘'),
      item('wh', '五花茶', 6, 7, '温和啲'),
    ],
    idle: chat('苦丁，敢唔敢', '回甘要等一阵'),
  }),
  shop({
    id: 'fruit',
    name: '街口水果',
    kind: 'snack',
    source: 'local',
    section: 'south',
    place: 'shop',
    side: 1,
    signColor: 0xf59e0b,
    items: [
      item('mix', '水果切', 12, 10, '芒果木瓜西瓜'),
      item('mango', '芒果', 8, 8, '一个'),
    ],
    idle: chat('芒果够甜', '切好咗'),
  }),
  shop({
    id: 'tangshui',
    name: '糖水铺',
    kind: 'dessert',
    source: 'local',
    section: 'south',
    place: 'shop',
    side: 1,
    signColor: 0xec4899,
    items: [
      item('ts', '糖水', 12, 16, '红豆芋圆'),
      item('dn', '双皮奶', 13, 15, '奶皮厚'),
      item('xc', '烧仙草', 12, 14, '加芋圆'),
    ],
    idle: chat('糖水热定冰', '芋圆要Q'),
  }),
  shop({
    id: 'mart2',
    name: '夜市小卖部',
    kind: 'mart',
    source: 'local',
    section: 'south',
    place: 'shop',
    side: 1,
    signColor: 0x16a34a,
    items: [
      item('beer', '啤酒', 6, 4, '冰'),
      item('water', '水', 2, 2, '一瓶'),
      item('snack', '饼干', 5, 8, '垫肚'),
    ],
    idle: chat('冰嘅喺柜入面', '夜间都开'),
  }),
];

function stall(
  id: string,
  name: string,
  kind: ShopKind,
  source: ShopSource,
  signColor: number,
  items: ShopItem[],
  idleLine: string,
): ShopDef {
  return shop({
    id,
    name,
    kind,
    source,
    section: 'middle',
    place: 'stall',
    side: 0,
    signColor,
    items,
    idle: chat(idleLine, '十八点后先出摊'),
    angry: shout('我个摊！'),
  });
}

/** ~24 night-market stalls. Laid out in two rows down the middle of the street. */
export const STALLS: ShopDef[] = [
  stall('apo-suan', '阿婆酸嘢', 'suan', 'requested', 0xffd23f, SUAN_MENU, '酸嘢够酸冇'),
  stall('apo-mango', '阿婆酸嘢·青芒', 'suan', 'requested', 0xf5c542, SUAN_MENU, '青芒刚切'),
  stall('apo-pine', '阿婆酸嘢·菠萝', 'suan', 'local', 0xf0d060, SUAN_MENU, '菠萝蘸辣椒盐'),
  stall('oyster-1', '中山路生蚝摊', 'grill', 'verified', 0xff5a3c, GRILL_MENU, '生蚝六只二十'),
  stall('oyster-2', '蒜蓉生蚝摊', 'grill', 'verified', 0xff6a45, GRILL_MENU, '蒜蓉堆满'),
  stall('wings', '烤翅老摊', 'grill', 'local', 0xe23b3b, GRILL_MENU, '鸡翅六蚊一串'),
  stall('chive', '韭菜烤档', 'grill', 'local', 0x3f9d4a, GRILL_MENU, '韭菜四蚊'),
  stall('skewer', '烤肉串摊', 'grill', 'local', 0xd4522a, GRILL_MENU, '串好先烤'),
  stall('squid', '烤鱿鱼摊', 'grill', 'local', 0xe07a3a, [
    item('sq', '烤鱿鱼', 12, 16, '刷酱'),
    item('beer', '啤酒', 6, 4, '冰'),
  ], '鱿鱼要烤到卷'),
  stall('eggplant', '烤茄子摊', 'grill', 'local', 0x7a4aa0, [
    item('eg', '烤茄子', 8, 12, '蒜蓉'),
    item('chive', '韭菜', 4, 8, '一起烤'),
  ], '茄子软咗先食'),
  stall('corn', '烤玉米摊', 'grill', 'local', 0xe8c04a, [
    item('corn', '烤玉米', 6, 10, '甜'),
    item('corn2', '烤玉米加辣', 7, 10, '辣椒面'),
  ], '玉米热'),
  stall('gluten', '烤面筋摊', 'grill', 'local', 0xc47a3a, [
    item('mj', '烤面筋', 5, 8, '甜辣'),
    item('mj3', '面筋三串', 12, 16, '够啃'),
  ], '面筋有弹性'),
  stall('snail', '炒田螺摊', 'seafood', 'local', 0xb4532a, [
    item('sn', '炒田螺', 15, 18, '紫苏，辣'),
    item('sns', '小份田螺', 10, 12, '试味'),
  ], '田螺吸一吸'),
  stall('potato', '炸洋芋', 'snack', 'local', 0xe0b13c, [
    item('p', '炸洋芋', 8, 12, '辣椒盐'),
    item('pl', '洋芋加辣', 9, 12, '更辣'),
  ], '刚起锅，小心烫'),
  stall('icefen', '冰粉摊', 'dessert', 'local', 0x7dd3fc, [
    item('ice', '冰粉', 8, 10, '红糖水'),
    item('ice2', '冰粉加芋圆', 10, 12, 'Q'),
  ], '冰粉解辣'),
  stall('tofu', '烤豆腐摊', 'grill', 'local', 0xf0d8a8, [
    item('tf', '烤豆腐', 5, 8, '刷酱'),
    item('tf3', '豆腐三串', 12, 14, '外焦'),
  ], '豆腐要烤干身'),
  stall('lu-stall', '卤味摊', 'snack', 'local', 0x8a5a2a, [
    item('lu', '卤味', 12, 18, '现捞'),
    item('dou', '卤豆干', 6, 8, '一袋'),
  ], '卤水滚紧'),
  stall('beer-stall', '啤酒摊', 'snack', 'local', 0xf5d76e, [
    item('beer', '啤酒', 6, 4, '冰镇'),
    item('beer2', '啤酒两瓶', 10, 6, '一起开'),
  ], '啤酒冰'),
  stall('scallop', '烤扇贝摊', 'grill', 'local', 0xff7a59, [
    item('sc', '烤扇贝', 15, 16, '蒜蓉'),
    item('oy', '生蚝 6 只', 20, 22, '一起烤'),
  ], '扇贝新鲜'),
  stall('oyster-3', '加蒜生蚝摊', 'grill', 'verified', 0xff4d3a, GRILL_MENU, '蒜可以再加'),
  stall('enoki', '烤金针菇', 'grill', 'local', 0xd4a017, [
    item('en', '烤金针菇', 6, 8, '锡纸'),
    item('chive', '韭菜', 4, 8, '配一串'),
  ], '金针菇出汁'),
  stall('lemon-stall', '柠檬茶摊', 'tea', 'local', 0x2ee6a8, [
    item('lemon', '柠檬茶', 10, 10, '街边捶'),
    item('jasmine', '茉莉奶茶', 12, 12, '横州花'),
  ], '柠檬现捶'),
  stall('sesame-stall', '芝麻糊摊', 'dessert', 'local', 0xc9a227, [
    item('zh', '芝麻糊', 8, 14, '小碗，烫'),
    item('ph', '花生糊', 8, 14, '香'),
  ], '糊要趁热'),
  stall('fruit-suan', '酸嘢水果档', 'suan', 'local', 0xf0c14a, SUAN_MENU, '酸嘢解酒'),
];

/** 南宁白话 / 粤语 flavored street chatter. The street is the whole map now. */
export const CHATTER: string[] = [
  '落雨大，水浸街，阿哥担柴上街卖。',
  '友仔，食粉未？复记定舒记？',
  '今日好热啊，饮杯横州茉莉先。',
  '中山路几时都咁多人。',
  '骑楼底好凉快，高一级，慢慢行。',
  '你食辣唔？螺蛳粉好辣。',
  '十八点后档口先出，生蚝要排队。',
  '酸嘢够酸，解得烧烤。',
  '横巷入面有位坐，窄啲。',
  '揾钱辛苦，买碗粉食先。',
  '北段粉店白天都开。',
  '南段凉茶苦，饮完再返去烧烤。',
];

export const CHATTER_REACT: string[] = [
  '哎哟喂！',
  '你搞边科！',
  '神经病啊！',
  '救命啊！',
  '走啦走啦！',
];

export const COP_SHOUT: string[] = [
  '唔好动！',
  '全部人唔好郁！',
  '你已经被通缉！',
  '趴低！',
];

/** Map-sign / area labels used by the HUD when the player crosses a zone. */
export interface AreaDef {
  id: string;
  name: string;
  subtitle: string;
}

export const AREAS: AreaDef[] = [
  { id: 'north', name: '中山路', subtitle: '北段 · 粉店粉饺糖水' },
  { id: 'middle', name: '中山路夜市', subtitle: '中段 · 烧烤生蚝' },
  { id: 'south', name: '中山路', subtitle: '南段 · 奶茶螺蛳粉凉茶' },
  { id: 'alley', name: '横巷', subtitle: '死胡同 · 窄，可以躲' },
  { id: 'minzu', name: '民族大道', subtitle: '北口 · 车只在护栏外' },
  { id: 'taoyuan', name: '桃源路', subtitle: '南口 · 车只在护栏外' },
];

/** Food lines that show up in the eat log. */
export const EAT_LOG: string[] = [
  '老友粉下肚，酸笋还在。',
  '粉饺蘸了黄皮酱。',
  '横州茉莉的香气还在嘴边。',
  '酸嘢够酸，够辣，够脆。',
  '生蚝的蒜蓉味还在。',
  '芝麻糊绵得化不开。',
  '螺蛳粉的酸笋是故意的。',
  '凉茶苦口，回甘来了。',
  '这一碗下去，够顶到半夜。',
];
