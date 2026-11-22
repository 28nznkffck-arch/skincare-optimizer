export const DIPOTASSIUM_GLYCYRRHIZATE='グリチルリチン酸ジカリウム';

// 表示・成分指定用。元のメーカー表記はCSVと商品オブジェクトに残す。
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
function reading(name){
  let value=name.normalize('NFKC');
  const prefix=prefixes.find(([text])=>value.startsWith(text));
  if(prefix)value=prefix[1]+value.slice(prefix[0].length);
  return value.replace(/^\d+/,number=>numbers[number]||number)
    .replace(/^[A-Za-z]+/,word=>[...word.toUpperCase()].map(char=>letters[char.charCodeAt(0)-65]).join(''))
    .replace(/[ァ-ヶ]/g,char=>String.fromCharCode(char.charCodeAt(0)-0x60));
}

export function ingredientChoices(catalog){
  const names=new Set();
  for(const product of catalog){
    if(product.archived)continue;
    for(const value of product.keyIngredients||[]){
      const name=canonicalIngredient(value);
      // 数値だけの断片や、説明文が混ざった欄を選択肢として表示しない。
      if(typeof name!=='string' || !/[A-Za-zぁ-んァ-ヶ一-龯]/u.test(name) || /[。\r\n]|(?:エキス|成分)は/.test(name))continue;
      names.add(name);
    }
  }
  return ['none',...[...names].sort((a,b)=>collator.compare(reading(a),reading(b))||collator.compare(a,b))];
}
