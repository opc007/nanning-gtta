/**
 * Real shop names stay on by default. `?names=fictional` (or
 * VITE_SHOP_NAMES=fictional) swaps in a made-up sign so a public build can
 * drop trademarks without editing the shop table. Shops with no fallback
 * keep their real name.
 */

export type ShopNameMode = 'real' | 'fictional';

/** Homophone / generic signs. Not the registered names. */
export const SHOP_FALLBACK: Record<string, string> = {
  fuji: '复味粉店',
  'zhongshan-fenjiao': '街口粉饺',
  liangji: '巷口卷筒粉',
  bingshen: '冰甜糖水',
  aguang: '晨光豆浆',
  shengzha: '现榨米粉',
  shuji: '叔味老友粉',
  'yongzhou-laoyou': '邕味老友粉',
  huangpi: '黄皮粉饺档',
  zhima: '芝麻糊档',
  ganjiajie: '柠檬鸭小馆',
  wonton: '云吞面档',
  rongji: '炭火烧烤档',
  'oyster-shop': '生蚝摊',
  'charcoal-oyster': '炭火生蚝档',
  tianluo: '田螺煲',
  jialou: '假蒌夹档',
  beefball: '牛肉丸档',
  bazhen: '八珍面档',
  niuzha: '牛杂粉档',
  xiajie: '瓦煲饭小馆',
  xiaochao: '街坊小炒',
  kaoyu: '烤鱼档',
  luwei: '卤味档',
  hengzhou: '茉莉奶茶档',
  'ama-milk': '水牛奶茶',
  luosifen: '螺蛳粉档',
  wuhua: '凉茶铺',
  mart: '街口士多',
  peanut: '花生糊档',
  yongcha: '柠檬茶档',
  liuzhou: '螺蛳粉小馆',
  kuding: '苦丁凉茶',
  fruit: '街口水果',
  tangshui: '糖水铺',
  mart2: '夜市小卖部',
};

export function shopNameModeFrom(search: string, envValue?: string): ShopNameMode {
  const q = new URLSearchParams(search).get('names');
  const raw = q ?? envValue ?? 'real';
  return raw === 'fictional' ? 'fictional' : 'real';
}

export function displayShopName(id: string, realName: string, mode: ShopNameMode): string {
  if (mode === 'fictional') return SHOP_FALLBACK[id] ?? realName;
  return realName;
}
