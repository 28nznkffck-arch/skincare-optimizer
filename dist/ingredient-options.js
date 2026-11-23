export const DIPOTASSIUM_GLYCYRRHIZATE='グリチルリチン酸ジカリウム';

// 成分の同義語確認用。商品の成分表示にはこの変換を使わない。
// 同定根拠と、まとめない誘導体・原料規格は docs/ingredient-guide.md を参照。
const normalizeName=value=>value.normalize('NFKC').trim().replace(/[‐‑−]/g,'-').replace(/\s+/g,' ');
export const INGREDIENT_ALIASES=[
  [DIPOTASSIUM_GLYCYRRHIZATE,['グリチルリチン酸2K','グリチルリチン酸二カリウム']],
  ['ヒアルロン酸Na',['ヒアルロン酸Na-2','ヒアルロン酸Naー2','ヒアルロン酸Na(2)','ヒアルロン酸ナトリウム(2)']],
  ['アセチルヒアルロン酸Na',['アセチル化ヒアルロン酸Na','アセチル化ヒアルロン酸ナトリウム']],
  ['DPG',['ジプロピレングリコール']],
  ['アスコルビルグルコシド',['L-アスコルビン酸 2-グルコシド','L-アスコルビン酸2-グルコシド']],
  ['リン酸アスコルビルMg',['ビタミンCリン酸Mg']],
  ['酢酸トコフェロール',['酢酸DL-α-トコフェロール','酢酸dl-α-トコフェロール','トコフェロール酢酸エステル']],
  ['セラミド機能成分',['セチルPGヒドロキシエチルパルミタミド','ヘキサデシロキシPGヒドロキシエチルヘキサデカナミド']],
  ['エチルヘキサン酸セチル',['2-エチルヘキサン酸セチル']],
  ['テトラエチルヘキサン酸ペンタエリスリチル',['テトラ2-エチルヘキサン酸ペンタエリトリット']],
  ['キシリトール',['キシリット']],
  ['酸化亜鉛',['酸化Zn']],
  ['二酸化炭素',['炭酸ガス']],
  ['ホホバ種子油',['ホホバ油']],
  ['ミネラルオイル',['流動パラフィン']],
  ['ユビキノン',['ユビデカレノン']],
];
const aliases=new Map(INGREDIENT_ALIASES.flatMap(([name,values])=>[name,...values].map(value=>[normalizeName(value),name])));
export function canonicalIngredient(value){
  if(typeof value!=='string')return value;
  const name=normalizeName(value);
  return aliases.get(name)||name;
}

export function displayIngredients(values=[]){
  return [...new Set(values.map(canonicalIngredient).filter(name=>typeof name==='string'&&name))];
}

// 「使ってみたい成分」のまとまり。同一化学物質という意味ではなく、
// この仲間のいずれかを含む商品を選ぶための分類。メーカーの表示名とは別管理。
export const INGREDIENT_FAMILIES=[
  ['ヒアルロン酸',['ヒアルロン酸','ヒアルロン酸Na','アセチルヒアルロン酸Na','加水分解ヒアルロン酸','ヒアルロン酸クロスポリマーNa','ヒアルロン酸ヒドロキシプロピルトリモニウム','乳酸球菌/ヒアルロン酸発酵液']],
  ['コラーゲン',['コラーゲン','コラーゲン・トリペプチドF','加水分解コラーゲン','加水分解コラーゲン末','水溶性コラーゲン','水溶性コラーゲン(F)','水溶性コラーゲン液','サクシニルアテロコラーゲン液']],
  ['セラミド',['セラミド','セラミド機能成分','セラミド2','セラミド6II','セラミドAP','セラミドNG','セラミドNP','N-ステアロイルジヒドロスフィンゴシン']],
  ['グリセリン',['グリセリン','濃グリセリン']],
  ['ビタミンC',['ビタミンC','ビタミンC誘導体','アスコルビン酸','アスコルビルグルコシド','リン酸アスコルビルMg','アスコルビン酸リン酸エステルナトリウム','3-O-エチルアスコルビン酸','3-グリセリルアスコルビン酸','パルミチン酸アスコルビルリン酸3Na','ビタミンCテトライソパルミテート']],
  ['ビタミンE',['ビタミンE','トコフェロール','酢酸トコフェロール']],
  ['コエンザイムQ10',['ユビキノン','ユビデカレノン']],
  // (2)は脚注ではなく原料規格の区分。選択用の名前だけを簡潔にする。
  ['アロエエキス',['アロエエキス(2)']],
  ['油溶性甘草エキス',['油溶性甘草エキス(2)']],
  ['スクワラン',['スクワラン','植物性スクワラン','シュガースクワラン']],
  ['ソルビトール',['ソルビトール','ソルビット液']],
  ['グリチルレチン酸ステアリル',['グリチルレチン酸ステアリル','グリチルレチン酸ステアリルSW']],
  ['アルギニン',['アルギニン','L-アルギニン']],
  ['セリン',['セリン','L-セリン']],
  // 対イオン・中和度の違いは選択用にまとめる。化学的な同義語にはしない。
  // 酸・塩・エステルを末尾の文字列だけで変換せず、確認した成分を明示する。
  ['ココイルグリシン',['ココイルグリシンNa','ココイルグリシンK']],
  ['ココイルグルタミン酸',['ココイルグルタミン酸Na','ココイルグルタミン酸2Na','ココイルグルタミン酸TEA']],
  ['ラウロイルグルタミン酸',['ラウロイルグルタミン酸Na','ラウロイルグルタミン酸K']],
  ['パーム核脂肪酸',['パーム核脂肪酸Na','パーム核脂肪酸K']],
  ['ミリスチン酸',['ミリスチン酸','ミリスチン酸Na']],
  ['シリカ',['シリカ','含水シリカ','無水ケイ酸']],
  ['セルロース',['セルロース','結晶セルロース']],
  ['マカデミア種子油',['マカデミア種子油','マカデミアナッツ油']],
  ['ツボクサエキス',['ツボクサエキス','ツボクサ葉/茎エキス','ツボクサ葉エキス']],
  ['ハトムギエキス',['ハトムギエキス','ハトムギ種子エキス','ハトムギ種子水','ヨクイニンエキス','ヨクイニン水','油溶性ヨクイニンエキス']],
  ['カミツレエキス',['カミツレエキス','カミツレ花エキス','カモミラエキス(1)']],
  ['ユーカリエキス',['ユーカリエキス','ユーカリ葉エキス']],
  ['ショウガエキス',['ショウガエキス','ショウガ根エキス','ショウキョウエキス']],
  ['チャ葉エキス',['チャ葉エキス','チャエキス(1)']],
  ['酵母エキス',['酵母エキス','酵母エキス(1)','酵母エキス(3)']],
];
const families=new Map(INGREDIENT_FAMILIES.flatMap(([name,members])=>members.map(member=>[canonicalIngredient(member),name])));
export function ingredientSelection(value){
  const name=canonicalIngredient(value);
  return families.get(name)||name;
}
export function matchesIngredientSelection(value,selection){
  return Boolean(selection&&selection!=='none'&&ingredientSelection(value)===ingredientSelection(selection));
}

const prefixes=[
  ['温泉水','おんせんすい'],['加水分解','かすいぶんかい'],['海シルト','かいしると'],
  ['含水','がんすい'],['結晶','けっしょう'],['酵母','こうぼ'],['酢酸','さくさん'],
  ['酸化','さんか'],['植物性','しょくぶつせい'],['水添','すいてん'],['水溶性','すいようせい'],
  ['炭酸','たんさん'],['炭','すみ'],['窒素','ちっそ'],['二酸化','にさんか'],
  ['乳酸','にゅうさん'],['濃','のう'],['変性','へんせい'],['無水','むすい'],
  ['油溶性','ゆようせい'],['卵黄','らんおう'],['流動','りゅうどう'],['α','あるふぁ'],
];
const letters=['えー','びー','しー','でぃー','いー','えふ','じー','えいち','あい','じぇー','けー','える','えむ','えぬ','おー','ぴー','きゅー','あーる','えす','てぃー','ゆー','ぶい','だぶりゅー','えっくす','わい','ぜっと'];
const numbers={'2':'に','3':'さん','4':'よん','10':'じゅう'};
const collator=new Intl.Collator('ja',{numeric:true});
export function ingredientReading(name){
  let value=name.normalize('NFKC');
  const prefix=prefixes.find(([text])=>value.startsWith(text));
  if(prefix)value=prefix[1]+value.slice(prefix[0].length);
  return value.replace(/^\d+/,number=>numbers[number]||number)
    .replace(/^[A-Za-z]+/,word=>[...word.toUpperCase()].map(char=>letters[char.charCodeAt(0)-65]).join(''))
    .replace(/[ァ-ヶ]/g,char=>String.fromCharCode(char.charCodeAt(0)-0x60));
}
export const compareIngredients=(a,b)=>collator.compare(ingredientReading(a),ingredientReading(b))||collator.compare(a,b);

export function ingredientChoices(catalog){
  const names=new Set();
  for(const product of catalog){
    if(product.archived)continue;
    for(const value of product.keyIngredients||[]){
      const name=ingredientSelection(value);
      // 数値だけの断片や、説明文が混ざった欄を選択肢として表示しない。
      if(typeof name!=='string' || !/[A-Za-zぁ-んァ-ヶ一-龯]/u.test(name) || /[。\r\n]|(?:エキス|成分)は/.test(name))continue;
      names.add(name);
    }
  }
  return ['none',...[...names].sort(compareIngredients)];
}
