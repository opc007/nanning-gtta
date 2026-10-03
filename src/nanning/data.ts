/**
 * Nanning flavour data. Kept as DATA (no logic) so it can be unit-tested and
 * later swapped for CSV/JSON without touching any system code.
 *
 * IMPORTANT: every shop name here is INVENTED. Nanning's real brands (万国酒家,
 * 舒记, 复记, 家味村 …) are registered trademarks, and this game has you punch
 * people and smash shops. Using a real name would put a real business at risk.
 * The names below are homophone/genre parodies only. If we ever want real
 * brands on screen, that needs a licensing conversation first.
 */

export type ShopKind = 'noodle' | 'tea' | 'dessert' | 'cold' | 'grill' | 'mart' | 'mahjong' | 'netcafe' | 'culture' | 'seafood';

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
  /** Signboard colour (hex) — drives the emissive neon at night. */
  signColor: number;
  items: ShopItem[];
  /** What the shopkeeper shouts when you trash the place. */
  angry: string[];
  /** Ambient chatter while the shop is intact. */
  idle: string[];
}

/** The fictional 中山路 / 水街 tenant mix. */
export const SHOPS: ShopDef[] = [
  {
    id: 'laoyoufen',
    name: '老友粉世家',
    kind: 'noodle',
    signColor: 0xff6b35,
    items: [
      { id: 'lf', name: '老友粉', price: 15, fill: 42, blurb: '酸辣鲜香，镬气一绝' },
      { id: 'lf2', name: '老友猪杂粉', price: 20, fill: 48, blurb: '复记那味，想了没' },
      { id: 'lf3', name: '老友面', price: 14, fill: 38, blurb: '起源于茶馆，暖到出汗' },
      { id: 'dz', name: '生榨米粉', price: 13, fill: 35, blurb: '生榨现做，豆味够' },
    ],
    angry: ['哎哟喂！我的锅！', '你赔我嘅镬气！', '识做啵？信唔信我报警！'],
    idle: ['老友粉出锅咯～', '加辣唔加辣？', '今日嘅汤头够浓'],
  },
  {
    id: 'molihua',
    name: '横州茉莉研社',
    kind: 'tea',
    signColor: 0x2ee6a8,
    items: [
      { id: 'mj', name: '茉莉花奶茶', price: 12, fill: 16, blurb: '横州花香 + 水牛奶底' },
      { id: 'mj2', name: '茉莉鲜奶绿', price: 14, fill: 14, blurb: '三花香，回甘要等三秒' },
      { id: 'mj3', name: '冰柠茉莉', price: 11, fill: 12, blurb: '柠檬捶到出汁为止' },
    ],
    angry: ['我嘅茉莉！', '搞咩啊喂！', '赔钱！赔钱！'],
    idle: ['今日嘅茉莉新到货', '三分糖系啩？', '靓嘢饮嘢啦'],
  },
  {
    id: 'suanye',
    name: '酸嘢阿婆',
    kind: 'dessert',
    signColor: 0xffd23f,
    items: [
      { id: 'sx1', name: '青芒酸嘢', price: 8, fill: 10, blurb: '辣椒粉 + 甘草盐' },
      { id: 'sx2', name: '木瓜酸嘢', price: 8, fill: 10, blurb: '酸甜脆辣，消食神器' },
      { id: 'sx3', name: '菠萝酸嘢', price: 9, fill: 11, blurb: '吃完整个人醒神' },
    ],
    angry: ['我做嘅酸嘢！', '阿婆要报警！', '你赔我个摊！'],
    idle: ['酸嘢嘢，够酸冇？', '青芒刚切好', '来试一碟啦'],
  },
  {
    id: 'liangcha',
    name: '邕城凉茶铺',
    kind: 'cold',
    signColor: 0x3fa9f5,
    items: [
      { id: 'lc', name: '苦丁凉茶', price: 5, fill: 6, blurb: '下火，正苦' },
      { id: 'lc2', name: '茅根竹蔗水', price: 6, fill: 8, blurb: '甜嘅，解腻' },
      { id: 'lc3', name: '五花茶', price: 5, fill: 7, blurb: '喝完今晚睡得着' },
    ],
    angry: ['我煲咗两个钟！', '浪费！', '你赔！'],
    idle: ['凉茶凉茶，苦口啲', '去火冇？', '今晚熬夜？'],
  },
  {
    id: 'shaoqian',
    name: '炭火老张',
    kind: 'grill',
    signColor: 0xff4d4d,
    items: [
      { id: 'sk', name: '烤鸡翅', price: 10, fill: 20, blurb: '炭火逼出油脂' },
      { id: 'sk2', name: '烤生蚝', price: 15, fill: 22, blurb: '蒜蓉堆到起' },
      { id: 'sk3', name: '烤韭菜', price: 6, fill: 8, blurb: '南宁人嘅心头好' },
    ],
    angry: ['我嘅炭！', '生蚝！生蚝啊！', '你赔我嘅海鲜！'],
    idle: ['炭火旺，唔好靠太近', '生蚝新鲜先至甜', '要几串？'],
  },
  {
    id: 'zhimang',
    name: '芝麻糊世家',
    kind: 'dessert',
    signColor: 0xc9a227,
    items: [
      { id: 'zh', name: '芝麻糊', price: 9, fill: 14, blurb: '绵密，烫嘴' },
      { id: 'zh2', name: '芋头糕', price: 7, fill: 15, blurb: '软糯到冇朋友' },
      { id: 'zh3', name: '鸡仔饼', price: 6, fill: 9, blurb: '带去中山路最体面' },
    ],
    angry: ['我个糊！', '阿婆唔见咗个缸！', '赔！'],
    idle: ['芝麻糊，几多钱？', '趁热食，凉咗就唔绵', '鸡仔饼打包冇？'],
  },
  {
    id: 'chaoshan',
    name: '烧仙草',
    kind: 'dessert',
    signColor: 0x8b5cf6,
    items: [
      { id: 'xiancao', name: '烧仙草冻', price: 12, fill: 14, blurb: '加芋圆，QQ弹' },
      { id: 'xiancao2', name: '双皮奶', price: 13, fill: 15, blurb: '奶皮厚到可以刮' },
    ],
    angry: ['我嘅仙草！', '赔！', '你想做咩？'],
    idle: ['仙草冻要唔要加芋圆', '呢杯系热嘅', '好饮冇？'],
  },
  {
    id: 'chaoshi',
    name: '合家欢小超市',
    kind: 'mart',
    signColor: 0x22c55e,
    items: [
      { id: 'bing', name: '老友公仔面', price: 6, fill: 18, blurb: '夜宵神器' },
      { id: 'bing2', name: '冰镇绿豆沙', price: 4, fill: 8, blurb: '冰箱最底层' },
      { id: 'yanjing', name: '鱼罐头', price: 8, fill: 10, blurb: '记得微波炉转一下' },
    ],
    angry: ['我嘅货！', '报警啊！', '你赔钱！'],
    idle: ['要咩？自己揀', '扫码定现金？', '冰嘅喺度'],
  },
  {
    id: 'mahjong',
    name: '雀友茶艺',
    kind: 'mahjong',
    signColor: 0x0ea5e9,
    items: [
      { id: 'cha', name: '一杯功夫茶', price: 8, fill: 4, blurb: '坐一坐，聊两句' },
    ],
    angry: ['雀都散晒！', '赔我台费！', '你搞边科？'],
    idle: ['三位唔够？等一阵', '打不打？', '叹茶最紧要'],
  },
  {
    id: 'netcafe',
    name: '极速网咖',
    kind: 'netcafe',
    signColor: 0xf43f5e,
    items: [
      { id: 'kdj', name: '包夜通宵', price: 20, fill: 5, blurb: '吹到天光' },
    ],
    angry: ['我嘅机！', '赔！', '出去！'],
    idle: ['仲有机，得唔得？', '烟系唔系唔准食？', '网速正唔正？'],
  },
  {
    id: 'wenchuang',
    name: '邕州文创',
    kind: 'culture',
    signColor: 0xfacc15,
    items: [
      { id: 'mo', name: '壮锦小挂件', price: 25, fill: 0, blurb: '送人唔会错' },
      { id: 'mo2', name: '明信片一套', price: 12, fill: 0, blurb: '中山路 / 邕江 / 大桥' },
    ],
    angry: ['我嘅非遗！', '赔！', '你赔我嘅锦绣！'],
    idle: ['呢个系壮锦织嘅', '要唔要盖章？', '慢慢睇'],
  },
  {
    id: 'hailu',
    name: '八桂风物',
    kind: 'seafood',
    signColor: 0xfb7185,
    items: [
      { id: 'hx', name: '海蛎煎', price: 18, fill: 28, blurb: '香到隔条街都闻' },
      { id: 'hx2', name: '老友鱼', price: 38, fill: 40, blurb: '老友粉嘅姐姐' },
    ],
    angry: ['我嘅海鲜！', '赔！', '你赔我啲货！'],
    idle: ['今日有新鲜嘅', '食辣唔食辣？', '慢慢拣'],
  },
];

/** 南宁白话 / 粤语 flavored street chatter. Deliberately loose parodic slang. */
export const CHATTER: string[] = [
  '落雨大，水浸街，阿哥担柴上街卖。',
  '友仔，食粉唔？',
  '今日好热啊，饮咗支茶先。',
  '中山路几时都咁多人。',
  '骑楼底好凉快，唔好走咁快。',
  '你食辣唔？我嘅粉好辣。',
  '晚上去水街啦，啱开街。',
  '半城绿树半城楼，冇假嘅。',
  '打边炉喂？落雨啰。',
  '邕江边风好舒服。',
  '揾钱辛苦，买碗粉食先。',
  '夜市嘅嘢贵唔贵？',
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
  { id: 'zhongshan', name: '中山路', subtitle: '百年骑楼 · 美食一条街' },
  { id: 'yeshi', name: '中山路夜市', subtitle: '越夜越精彩' },
  { id: 'xiang', name: '金狮巷 · 银狮巷', subtitle: '三街两巷 · 青砖明清' },
  { id: 'shuijie', name: '水街', subtitle: '邕江边上 · 百年商埠' },
  { id: 'chaoyang', name: '朝阳路', subtitle: '商圈主干道 · 可开车' },
  { id: 'zhonggulou', name: '钟鼓楼广场', subtitle: '明代钟鼓楼 · 邕州今韵' },
  { id: 'jixiechang', name: '机械厂文创园', subtitle: '红砖厂房 · 1952 文创' },
  { id: 'yongjiang', name: '邕江', subtitle: '百里秀美邕江' },
  { id: 'daqiao', name: '南宁大桥', subtitle: '白色拱肋 · 蝶翼' },
];

/** Food/collectible names that show up in the eat log. */
export const EAT_LOG: string[] = [
  '老友粉下肚，浑身舒坦。',
  '茉莉花的香气还在嘴边。',
  '酸嘢够酸，够辣，够脆。',
  '凉茶苦口，回甘来了。',
  '生蚝的蒜蓉味还在嘴里。',
  '芝麻糊绵得化不开。',
  '烧仙草的芋圆还 Q 弹。',
  '这一碗下去，够顶到半夜。',
];
