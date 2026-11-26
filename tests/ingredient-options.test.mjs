import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {loadCatalog} from '../dist/catalog-csv.js';
import {reconcileCatalogState} from '../dist/catalog-data.js';
import {ingredientChoices,canonicalIngredient,ingredientSelection,displayIngredients,INGREDIENT_ALIASES,INGREDIENT_FAMILIES,INGREDIENT_COMPOSITES,INGREDIENT_DISPLAY_NAMES,ingredientSelections,matchesIngredientSelection,DIPOTASSIUM_GLYCYRRHIZATE} from '../dist/ingredient-options.js';
import {canIncludeRoutineProduct,meetsIngredientRequirement,optimize,scoreRoutine} from '../dist/optimizer.js';

test('choices include each catalog ingredient independently of guide coverage and exclude invalid fragments',()=>{
  const names=['レチノール','加水分解コラーゲン','アラントイン','濃グリセリン','グリセリン','セラミドNG','トラネキサム酸','ナイアシンアミド','ヒアルロン酸Na','ワセリン'];
  const catalog=[{ingredients:[...names,'1','酸化チタン ハトムギ発酵エキスは別名です',...names]},
    {archived:true,ingredients:['掲載終了成分']}];
  assert.deepEqual(ingredientChoices(catalog),['none','アラントイン','グリセリン','コラーゲン','セラミド','トラネキサム酸','ナイアシンアミド','ヒアルロン酸','レチノール(ビタミンA)','ワセリン']);
  const options=ingredientChoices([{ingredients:['3-O-エチルアスコルビン酸','BG','α-オレフィンオリゴマー']}]);
  assert.equal(options.length,4);
});

test('verified aliases deduplicate choices, match both directions and migrate saved selections',()=>{
  for(const [canonical,aliases] of INGREDIENT_ALIASES){
    for(const name of [canonical,...aliases]){
      assert.equal(canonicalIngredient(name),canonical);
      const product={jan:'alias-product',category:'serum',ingredients:[name],scores:{}};
      const options={ingredient:canonical,ingredientMode:'required',concerns:['dryness']};
      assert(meetsIngredientRequirement([product],options),name);
      assert(canIncludeRoutineProduct(product,options),name);
      assert.equal(scoreRoutine([product],options)-scoreRoutine([product],{...options,ingredient:'none'}),10);
      assert(meetsIngredientRequirement([{...product,ingredients:[canonical]}],{...options,ingredient:name}),name);
      assert.equal(reconcileCatalogState({ingredient:name},[product]).ingredient,ingredientSelection(canonical));
    }
    assert.deepEqual(ingredientChoices([{ingredients:[canonical,...aliases]}]),['none',ingredientSelection(canonical)]);
    assert.deepEqual(displayIngredients([canonical,...aliases]),[canonical]);
  }
  assert.equal(canonicalIngredient('  ヒアルロン酸Ｎａ（２）  '),'ヒアルロン酸Na');
  assert.equal(canonicalIngredient('ツボクサ葉／茎エキス'),'ツボクサ葉/茎エキス');
  assert.equal(canonicalIngredient('ライスパワーNo.11+'),'ライスパワーNo.11+');
});

test('different selection families do not match merely by containing part of the selected name',()=>{
  for(const [selected,other] of [
    ['レチノール','トレチノイン'],['グリセリン','ジグリセリン'],
    ['セリン','メチルセリン'],['アミノ酸','アミノ酸系洗浄成分'],
    ['ヒアルロン酸','水溶性コラーゲン'],['ビタミンC','酢酸トコフェロール'],
    ['カモミラET','カモミラエキス(1)'],['ユーカリエキス','ユーカリ葉油'],
    ['ライスパワーNo.11(米エキスNo.11)','ライスパワーNo.11+'],
    ['ミリスチン酸','ミリスチン酸イソプロピル'],
    ['ココイルグルタミン酸Na','ラウロイルグルタミン酸Na'],
    ['ラウロイルグルタミン酸K','ラウロイルグルタミン酸ジオクチルドデシル'],
    ['ココイルメチルタウリンNa','ココイルメチルタウリンタウリンNa'],
    ['マカデミア種子油','マカデミアナッツ脂肪酸フィトステリル'],
    ['セルロース','ヒドロキシエチルセルロース'],
    ['サリチル酸','4-メトキシサリチル酸カリウム塩'],
    ['PCA-Na','PCA亜鉛'],
    ['アロエエキス(2)','油溶性甘草エキス(2)'],
    ['POE(26)グリセリン','グリセリン'],
  ]){
    assert.notEqual(canonicalIngredient(selected),canonicalIngredient(other));
    const product={jan:'other-product',category:'serum',ingredients:[other],scores:{}};
    const options={ingredient:selected,ingredientMode:'required',concerns:['dryness']};
    assert(!meetsIngredientRequirement([product],options),`${selected} / ${other}`);
    assert(!canIncludeRoutineProduct(product,options),`${selected} / ${other}`);
    assert.equal(scoreRoutine([product],options),scoreRoutine([product],{...options,ingredient:'none'}));
  }
});

test('ingredient families group selection and matching while keeping all manufacturer names intact',()=>{
  for(const [family,members] of INGREDIENT_FAMILIES){
    const products=members.map((name,i)=>({jan:`family-${i}`,category:'serum',ingredients:[name],scores:{}}));
    const original=structuredClone(products),settings={ingredient:family,ingredientMode:'required',concerns:['dryness']};
    assert.deepEqual(ingredientChoices(products),['none',ingredientSelection(family)]);
    for(const product of products){
      assert(meetsIngredientRequirement([product],settings),product.ingredients[0]);
      assert(canIncludeRoutineProduct(product,settings));
      assert.equal(scoreRoutine([product],settings)-scoreRoutine([product],{...settings,ingredient:'none'}),10);
      assert.equal(reconcileCatalogState({ingredient:product.ingredients[0]},[product]).ingredient,ingredientSelection(family));
    }
    assert.deepEqual(products,original,'selection grouping must not rewrite source names');
  }
  const sodium={jan:'ha-na',category:'serum',ingredients:['ヒアルロン酸Na-2'],scores:{}};
  const hydrolyzed={...sodium,jan:'hydrolyzed',ingredients:['加水分解ヒアルロン酸']};
  assert(meetsIngredientRequirement([hydrolyzed],{ingredient:'ヒアルロン酸Na',ingredientMode:'required'}),'old saved choices migrate to the broad family');
  assert.deepEqual(ingredientChoices([sodium,hydrolyzed]),['none','ヒアルロン酸']);
  assert.notEqual(canonicalIngredient('ヒアルロン酸Na'),canonicalIngredient('加水分解ヒアルロン酸'),'chemical identity is distinct from a selection family');
});

test('grouped ingredient preferences and requirements preserve the exact best combination',()=>{
  const item=(category,jan,cost,points,name)=>({category,jan,brand:'検証',name:jan,referencePrice:cost,referenceUses:30,dailyUses:1,ingredients:[name],scores:{dryness:points}});
  const catalog=[
    item('cleanser','wash-1',80,1,'ヒアルロン酸Na-2'),item('cleanser','wash-2',120,2,'水溶性コラーゲン'),
    item('moisturizer','cream-1',180,2,'セラミド機能成分'),item('moisturizer','cream-2',250,3,'セラミドNP'),
    item('toner','toner-1',120,1,'加水分解ヒアルロン酸'),item('toner','toner-2',200,2,'ビタミンCリン酸Mg'),
    item('serum','serum-1',230,3,'アセチル化ヒアルロン酸ナトリウム'),item('serum','serum-2',300,3,'アスコルビルグルコシド'),
  ];
  for(const [index,name] of ['ココイルグリシンK','ココイルグルタミン酸2Na','ミリスチン酸','マカデミアナッツ油','シリカ','含水シリカ','ミリスチン酸Na','マカデミア種子油'].entries())catalog[index].ingredients.push(name);
  for(const ingredient of ['ヒアルロン酸','ビタミンC','セラミド','コラーゲン','ココイルグリシンNa','ココイルグルタミン酸TEA','ミリスチン酸Na','マカデミア種子油','含水シリカ'])for(const ingredientMode of ['prefer','required'])for(const budget of [300,500,1000]){
    const options={ingredient,ingredientMode,budget,concerns:['dryness'],priority:'any'};
    assert.deepEqual(optimize(catalog,{...options,resultLimit:1}),optimize(catalog,options).slice(0,1));
  }
});

test('all selectable names have a matching active product in their own catalog',async()=>{
  const lists=[];
  for(const folder of ['../catalog/','../catalog-men/']){
    const {products}=await loadCatalog(url=>readFile(url,'utf8'),folder);
    const choices=ingredientChoices(products);lists.push(choices);
    assert(choices.length>70);
    for(const name of choices.slice(1))assert(products.some(p=>meetsIngredientRequirement([p],{ingredient:name,ingredientMode:'required'})),name);
    assert.equal(choices.filter(name=>name===DIPOTASSIUM_GLYCYRRHIZATE).length,1);
    assert(!choices.includes('グリチルリチン酸2K'));assert(!choices.includes('1'));
  }
  assert(lists[0].includes('レチノール(ビタミンA)'));assert(!lists[1].includes('レチノール(ビタミンA)'));
  assert(lists[1].includes('グリシルグリシン'));assert(lists[0].includes('グリシルグリシン'));
});

test('identical glycyrrhizate names match preferences and requirements without merging other compounds',()=>{
  const item=(jan,category,ingredients)=>({jan,category,ingredients,brand:'検証',name:jan,referencePrice:100,referenceUses:30,dailyUses:1,scores:{dryness:1}});
  const wash=item('wash','cleanser',[]),cream=item('cream','moisturizer',[]);
  for(const spelling of ['グリチルリチン酸2K','グリチルリチン酸二カリウム',DIPOTASSIUM_GLYCYRRHIZATE]){
    const serum=item('serum','serum',[spelling]);serum.scores={};
    const settings={budget:5000,concerns:['dryness'],ingredient:DIPOTASSIUM_GLYCYRRHIZATE,ingredientMode:'required',priority:'any'};
    assert.equal(canonicalIngredient(spelling),DIPOTASSIUM_GLYCYRRHIZATE);
    assert(canIncludeRoutineProduct(serum,settings));assert(meetsIngredientRequirement([serum],settings));
    assert.equal(scoreRoutine([serum],settings)-scoreRoutine([serum],{...settings,ingredient:'none'}),10);
    assert(optimize([wash,cream,serum],{...settings,resultLimit:1})[0].products.some(p=>p.jan==='serum'));
    assert.equal(reconcileCatalogState({ingredient:spelling},[serum]).ingredient,DIPOTASSIUM_GLYCYRRHIZATE);
  }
  assert(!meetsIngredientRequirement([item('other','serum',['グリチルレチン酸ステアリル'])],{ingredient:DIPOTASSIUM_GLYCYRRHIZATE,ingredientMode:'required'}));
  assert.equal(reconcileCatalogState({ingredient:'掲載終了成分'},[cream]).ingredient,'none');
});

test('new ingredient groupings do not equate unrelated chemicals',()=>{for(const [a,b] of [['ステアリン酸','ステアリン酸Mg'],['塩化ナトリウム','塩化Mg'],['クエン酸','クエン酸トリエチル'],['グルタミン酸','D-グルタミン酸'],['ローズマリーエキス','ローズマリー葉油']])assert.notEqual(ingredientSelection(a),ingredientSelection(b));for(const item of ['EDTA-2Na','EDTA-3Na','EDTA-4Na'])assert.equal(ingredientSelection(item),'エデト酸');});

test('glycerin roots are not all interchangeable; verified synonyms are',()=>{for(const [a,b] of [['グリセリン','ステアリン酸グリセリル'],['グリセリン','グリセリルグルコシド'],['グリセリン','エチルヘキシルグリセリン'],['ステアリン酸グリセリル','ステアリン酸グリセリル(SE)'],['BG','PG'],['ジメチコン','ジメチコンクロスポリマー']])assert.notEqual(ingredientSelection(a),ingredientSelection(b));for(const n of ['オクトキシグリセリン','グリセリンモノ2-エチルヘキシルエーテル','グリセリルエチルヘキシルエーテル'])assert.equal(ingredientSelection(n),'エチルヘキシルグリセリン');for(const n of ['トリメチルグリシン','ベタイン'])assert.equal(ingredientSelection(n),'ベタイン');});


test('plant extract labels and vitamin names are grouped only for selection',()=>{
  for(const name of ['アーチチョーク葉エキス','アーティチョーク葉エキス','アーティチョークエキス'])assert.equal(ingredientSelection(name),'アーティチョークエキス');
  const examples={
    'レチノール(ビタミンA)':['ビタミンA','ビタミンA油','レチノール','酢酸レチノール','パルミチン酸レチノール'],
    'ビタミンB6':['ピリドキシンHCl','ピリドキシン塩酸塩','ピリドキシン塩酸塩（ビタミンB6）','塩酸ピリドキシン'],
    'ビタミンC':['アスコルビン酸（活性型ビタミンC）','アスコルビン酸硫酸2Na','ビタミンCリン酸Mg（ビタミンC誘導体）','リン酸L-アスコルビルマグネシウム'],
    'ビタミンE':['天然ビタミンE','トコフェリルグルコシド','酢酸トコフェロール'],
  };
  for(const [name,variants] of Object.entries(examples))for(const variant of variants){
    assert.equal(ingredientSelection(variant),name,variant);
    assert.equal(ingredientChoices([{ingredients:[variant]}])[1],name);
  }
  for(const [a,b] of [['ビタミンA','トレチノイン'],['ビタミンE','ユビキノン'],['ビタミンB6','パンテノール'],['ビタミンC','アスコルビン酸とは無関係の成分']])assert.notEqual(ingredientSelection(a),ingredientSelection(b));
  assert.notEqual(canonicalIngredient('レチノール'),canonicalIngredient('酢酸レチノール'));
});

test('SIMULGEL premix keeps manufacturer text but offers its three real constituents',()=>{
  const combined=INGREDIENT_COMPOSITES[0][0],separate=INGREDIENT_COMPOSITES[0][1];
  assert.deepEqual(ingredientSelections(combined),separate);
  assert.deepEqual(ingredientSelections(combined.replaceAll('/','／')),separate);
  const product={jan:'complex',category:'serum',ingredients:[combined],scores:{}};
  const pristine=structuredClone(product);
  const choices=ingredientChoices([product]);
  for(const name of separate){
    assert(choices.includes(name),name);
    assert(matchesIngredientSelection(combined,name),name);
    assert(meetsIngredientRequirement([product],{ingredient:name,ingredientMode:'required'}),name);
  }
  assert.equal(choices.length,4);
  assert.deepEqual(product,pristine);
  assert.equal(ingredientSelections('(アクリレーツ/アクリル酸アルキル(C10-30))クロスポリマー').length,1);
  assert.equal(ingredientSelections('水添ポリイソブテン').length,1);
});

test('registered products with the specified mixed polymer raw label remain searchable by all components',async()=>{
  let seen=0;
  for(const folder of ['../catalog/','../catalog-men/']){
    const {products}=await loadCatalog(url=>readFile(url,'utf8'),folder);
    for(const product of products){
      const premix=product.ingredients.find(name=>ingredientSelections(name).length===3);
      if(!premix)continue;
      seen++;
      for(const part of INGREDIENT_COMPOSITES[0][1]){
        assert(meetsIngredientRequirement([product],{ingredient:part,ingredientMode:'required'}),product.jan+' / '+part);
      }
      assert(product.ingredients.includes(premix),'the source ingredient text is preserved');
    }
  }
  assert(seen>=10,'registered mixed raw labels must not silently disappear');
});

test('retinol is the friendly vitamin A label and legacy selections migrate',()=>{
  for(const n of ['ビタミンA','レチノール','レチノール(ビタミンA)','酢酸レチノール','パルミチン酸レチノール','ビタミンA油'])assert.equal(ingredientSelection(n),'レチノール(ビタミンA)');
  assert.equal(ingredientChoices([{ingredients:['レチノール','ビタミンA油']}]).join('|'),'none|レチノール(ビタミンA)');
  assert.notEqual(canonicalIngredient('ビタミンA油'),canonicalIngredient('レチノール'));
  const product={jan:'retinol',category:'serum',ingredients:['レチノール'],scores:{}};
  for(const term of ['ビタミンA','レチノール(ビタミンA)'])assert(meetsIngredientRequirement([product],{ingredient:term,ingredientMode:'required'}));
});

test('source typo and alternate sodium spellings resolve without matching chemically distinct salts',()=>{
  for(const n of ['グリチルリチリン酸ジカリウム','グリチルリチン酸2K','グリチルリチン酸２Ｋ','グリチルリチン酸ジカリウム'])
    assert.equal(ingredientSelection(n),DIPOTASSIUM_GLYCYRRHIZATE,n);
  for(const n of ['グリチルリチン酸アンモニウム','グリチルレチン酸ステアリル'])assert.notEqual(ingredientSelection(n),DIPOTASSIUM_GLYCYRRHIZATE,n);
  const p={jan:'typo',category:'serum',ingredients:['グリチルリチリン酸ジカリウム'],scores:{}};
  assert(meetsIngredientRequirement([p],{ingredient:DIPOTASSIUM_GLYCYRRHIZATE,ingredientMode:'required'}));
});

test('other label variations are grouped but different chemistry remains distinct',()=>{
  for(const [base,variants] of Object.entries({
    'ポリオキシエチレン水添ヒマシ油':['PEG-20水添ヒマシ油','PEG-60水添ヒマシ油','PEG60水添ヒマシ油','POE硬化ヒマシ油'],
    'オリーブ油':['オリブ油','オリーブ果実油'],
    'ツバキエキス':['ツバキ花エキス','ツバキ葉エキス'],
    'ステアリン酸ソルビタン':['ステアリン酸ソルビタン','モノステアリン酸ソルビタン'],
    'アロエエキス':['アロエエキス-2','アロエエキス(2)'],
  }))for(const n of variants)assert.equal(ingredientSelection(n),base,n);
  for(const [a,b] of [['グリチルリチン酸ジカリウム','グリチルリチン酸アンモニウム'],['ステアリン酸ソルビタン','ジステアリン酸ソルビタン'],['オリーブ油','オリーブ葉エキス'],['ローズマリー油','ローズマリーエキス'],['PEG水添ヒマシ油','ヒマシ油']])
    assert.notEqual(ingredientSelection(a),ingredientSelection(b),a+' vs '+b);
});

test('distinct cosmetic and quasi-drug names map to the same chemical without changing source labels',()=>{
  const pairs=[
    ['ニコチン酸アミド','ナイアシンアミド'],
    ['トリエチルヘキサノイン','トリエチルヘキサン酸グリセリル'],
    ['デカメチルシクロペンタシロキサン','シクロペンタシロキサン'],
    ['マカデミアナッツ油脂肪酸フィトステリル','マカデミアナッツ脂肪酸フィトステリル'],
    ['ジラウラミドグルタミドリシンNa','ジラウロイルグルタミン酸リシンNa'],
    ['ポリオキシプロピレン(9)ジグリセリルエーテル','PPG-9ジグリセリル'],
    ['トリ(カプリル・カプリン・ミリスチン・ステアリン酸)グリセリル','トリ(カプリル酸/カプリン酸/ミリスチン酸/ステアリン酸)グリセリル'],
  ];
  for(const [a,b] of pairs){
    assert.equal(canonicalIngredient(a),b);
    assert.equal(ingredientSelection(a),ingredientSelection(b));
    const item={jan:'alias',category:'serum',ingredients:[a],scores:{}};
    assert(meetsIngredientRequirement([item],{ingredient:b,ingredientMode:'required'}));
  }
  for(const [a,b] of [['ニコチン酸','ナイアシンアミド'],['PCA','PCA-Na'],['シクロペンタシロキサン','ジメチコン'],['トリエチルヘキサノイン','トリオクタン酸グリセリル'],['ヒアルロン酸','グリセリン']])
    assert.notEqual(ingredientSelection(a),ingredientSelection(b));
});

test('remaining source forms map to their families, not all superficially similar compounds',()=>{
  for(const [want,names] of Object.entries({
    'ヒアルロン酸':['アセチルヒアルロン酸Na(スーパーヒアルロン酸)','アセチル化ヒアルロン酸ナトリウム(スーパーヒアルロン酸)','ヒアルロン酸クロスポリマーNa(3Dヒアルロン酸)','ヒアルロン酸ヒドロキシプロピルトリモニウム(肌吸着型ヒアルロン酸)'],
    'ピロリドンカルボン酸ナトリウム':['PCA-Na','DL-PCA・Na液','DL-ピロリドンカルボン酸ナトリウム液'],
    'ポリオキシプロピレン(9)ジグリセリルエーテル':['PPG-9ジグリセリル','ポリオキシプロピレンジグリセリルエーテル'],
    'トウキエキス(1)':['トウキエキス-1','トウキエキス(1)'],
    'イソステアリン酸ポリオキシエチレングリセリル':['イソステアリン酸ポリオキシエチレングリセリル','イソステアリン酸PEG-8グリセリル','イソステアリン酸PEG-20グリセリル','イソステアリン酸PEG-60グリセリル'],
  }))for(const name of names)assert.equal(ingredientSelection(name),want,name);
  for(const [a,b] of [['PCA-Na','PCA'],['PPG-9ジグリセリル','PPG-14ジグリセリル'],['イソステアリン酸POEグリセリル','ステアリン酸PEG-60グリセリル'],['トウキエキス(1)','トウキ葉エキス']])
    assert.notEqual(ingredientSelection(a),ingredientSelection(b));
});

test('polysorbate chemical names and PVP are reconciled with source spellings',()=>{
  const aliases=[
    ['ポリソルベート20','ラウリン酸POE(20)ソルビタン','モノラウリン酸ポリオキシエチレンソルビタン(20E.O.)'],
    ['ポリソルベート60','モノステアリン酸ポリオキシエチレンソルビタン'],
    ['ポリソルベート80','オレイン酸POE(20)ソルビタン','モノオレイン酸ポリオキシエチレンソルビタン(20E.O.)'],
    ['ポリソルベート85','トリオレイン酸POE(20)ソルビタン'],
    ['PVP','ポリビニルピロリドン'],
    ['ビスジグリセリルポリアシルアジペート-2','アジピン酸ジグリセリル混合脂肪酸エステル'],
  ];
  for(const [canonical,...labels] of aliases)for(const label of labels){
    assert.equal(canonicalIngredient(label),canonical,label);
    const p={jan:'poly',category:'serum',ingredients:[label],scores:{}};
    assert(meetsIngredientRequirement([p],{ingredient:canonical,ingredientMode:'required'}));
  }
  for(const [a,b] of [['ポリソルベート20','ポリソルベート80'],['ポリソルベート80','ポリソルベート85'],['ポリソルベート80','オレイン酸POE(6)ソルビタン'],['ポリソルベート60','ステアリン酸ソルビタン']])
    assert.notEqual(ingredientSelection(a),ingredientSelection(b));
});

test('lysine variants and conchiolin source names stay within their own families',()=>{
  for(const name of ['リシン','リシンHCl','リシンHCI','塩酸リジン'])assert.equal(ingredientSelection(name),'リシン');
  assert.equal(canonicalIngredient('塩酸リジン'),'リシンHCl');
  for(const name of ['加水分解コンキオリン','加水分解コンキオリン液','加水分解コンキオリンタンパク'])
    assert.equal(ingredientSelection(name),'加水分解コンキオリン');
  assert.notEqual(ingredientSelection('リシン'),ingredientSelection('グリシン'));
});

 test('friendly display names retain saved names and separate distinct ingredients',()=>{
 for(const [a,b] of INGREDIENT_DISPLAY_NAMES){assert.equal(ingredientSelection(a),ingredientSelection(b),a);assert(matchesIngredientSelection(a,b),a);assert(matchesIngredientSelection(b,a),b);}
 for(const [a,b] of [['ヒスチジン','アルギニン'],['BG','DPG'],['PG','PPG-7'],['PCA','PCA-Na'],['PPG-9ジグリセリル','PPG-14ジグリセリル']])assert.notEqual(ingredientSelection(a),ingredientSelection(b));
 assert.notEqual(canonicalIngredient('ヒスチジン'),canonicalIngredient('ヒスチジンHCl'));
 });

 test('v0.9.35 plant names and source spelling groups',()=>{
 for(const [a,b] of [["オランダカラシエキス","クレソンエキス"],["オランダガラシ葉/茎エキス","クレソンエキス"],["メリアアザジラクタ葉エキス","ニーム葉エキス"],["エイジツエキス","ノイバラ果実エキス"],["オウバクエキス","キハダ樹皮エキス"],["ゴレンシ葉エキス","スターフルーツ葉エキス"],["トウニンエキス","モモ種子エキス"],["トウヒエキス","ビターオレンジ果皮エキス"],["セイヨウトチノキ種子エキス","マロニエエキス"],["フユムシナツクサタケエキス","冬虫夏草エキス"],["クララエキス(1)","クララ根エキス"],["チンピエキス","ミカン果皮エキス"],["ウンシュウミカン果皮エキス","ミカン果皮エキス"],["チンピエキス(マンダリンクリア)","ミカン果皮エキス"],["マンダリンオレンジ果皮エキス","ミカン果皮エキス"],["ニンジンエキス","高麗人参エキス"],["人参エキス","高麗人参エキス"],["オタネニンジン根エキス","高麗人参エキス"],["イノシット","イノシトール"],["セトステアリルアルコール","セテアリルアルコール"],["エチルカルビトール","エトキシジグリコール"],["o-シメン-5-オール","イソプロピルメチルフェノール"],["コカミドジエタノールアミン","ヤシ油脂肪酸ジエタノールアミド"],["コカミドメチルモノエタノールアミン","ヤシ油脂肪酸N-メチルエタノールアミド"],["メトキシケイヒ酸オクチル","メトキシケイヒ酸エチルヘキシル"],["パラメトキシケイ皮酸2-エチルヘキシル","メトキシケイヒ酸エチルヘキシル"],["合成フルオロフロゴパイト","合成金雲母"],["カルボマ―","カルボマー"],["べへネス-20","ベヘネス-20"],["ブルラン","プルラン"],["ベヘニン酸","ベヘン酸"],["黄4","黄色4号"],["青1","青色1号"],["赤227","赤色227号"],["ガゴメエキス(エラスリッチ®)","ガゴメエキス"],["アルピニアカツマダイ種子エキス(アルピニアホワイト)","アルピニアカツマダイ種子エキス"],["加水分解ダイズタンパク(コラプラス®、コラネット®)","加水分解ダイズタンパク"],["加水分解ダイズタンパク(コラプラス®)","加水分解ダイズタンパク"],["大豆たん白加水分解物(2)","加水分解ダイズタンパク"],["大豆たん白水解物-2","加水分解ダイズタンパク"],["ヨクイニンエキス(ハトムギエキス)","ハトムギエキス"],["パラオキシ安息香酸メチル","メチルパラベン"],["パラオキシ安息香酸プロピル","プロピルパラベン"],["ヒドロキシエタンジホスホン酸液","エチドロン酸"],["マクロゴール4000","ポリエチレングリコール"],["ティーツリーオイル","ティーツリー葉油"],["水溶性コラーゲン液-3","コラーゲン"],["水溶性コラーゲン液(魚起原)","コラーゲン"],["サクシノイルアテロコラーゲン","コラーゲン"],["水溶性コラーゲンクロスポリマー","コラーゲン"],["L-テアニン","テアニン"],["無水カフェイン","カフェイン"],["エーデルワイス花/葉エキス","エーデルワイスエキス"],["酵母エキス-3","酵母エキス"],["サクラ葉抽出液","サクラ葉エキス"],["チョウジ抽出液","チョウジエキス"],["シソエキス(1)","シソ葉エキス"],["ラベンダーエキス(1)","ラベンダー花エキス"],["ユーカリ油","ユーカリ葉油"],["ブクリョウタケエキス","ブクリョウエキス"],["レイシ子実体エキス","レイシエキス"],["メマツヨイグサ抽出液","メマツヨイグサ種子エキス"],["タマリンドガム","タマリンドシードガム"],["チューベロースポリサッカライド液","チューベロース多糖体"],["チューベロースポリサッカライド液-ブチレングリコール","チューベロース多糖体"],["ヒマシ脂肪酸ナトリウム","ヒマシ油脂肪酸"],["ヒマシ油脂肪酸カリウム","ヒマシ油脂肪酸"],["水添大豆リン脂質","水添レシチン"],["水素添加大豆リン脂質","水添レシチン"],["サラシミツロウ","ミツロウ"],["プルーン酵素分解物","プルーン分解物"],["ヤエヤマアオキ果汁","ノニ果汁"],["ミリスチン酸デカグリセリル","ミリスチン酸ポリグリセリル-10"],["(エイコサン二酸/テトラデカン二酸)デカグリセリル液","(エイコサン二酸/テトラデカン二酸)ポリグリセリル-10"],["2-アミノ-2-メチル-1-プロパノール","アミノメチルプロパノール"],["2-アミノ-2-メチル-1,3-プロパンジオール","アミノメチルプロパンジオール"],["リン酸モノセチル","リン酸セチル"],["リン酸一水素ナトリウム","リン酸"],["リン酸二水素ナトリウム","リン酸"],["ココイルメチルタウリンタウリンナトリウム","ココイルメチルタウリンナトリウム"],["ヤシ油脂肪酸メチルタウリンナトリウム","ココイルメチルタウリンナトリウム"],["親油型モノステアリン酸グリセリル","ステアリン酸グリセリル"],["テトラ2-エチルヘキサン酸ペンタエリスリット","テトラエチルヘキサン酸ペンタエリスリチル"],["dl-カンフル","カンフル"],["l-メントール","メントール"],["水酸化カリウム液(A)","水酸化ナトリウム・カリウム"],["ポリ塩化ジメチルジメチレンピロリジニウム液","ポリクオタニウム-6"],["塩化ジメチルジアリルアンモニウム・アクリルアミド共重合体液","ポリクオタニウム-7"],["2-メタクリロイルオキシエチルホスホリルコリン・メタクリル酸ブチル共重合体液","ポリクオタニウム-51"],["メタクリロイルオキシエチルホスホリルコリン・メタクリル酸ブチル共重合体液","ポリクオタニウム-51"],["酸化Cr","酸化クロム"],["硫酸Ba","硫酸バリウム"],["ステアリン酸グリセリル(SE)","ステアリン酸グリセリル(自己乳化型)"]]){assert.equal(ingredientSelection(a),ingredientSelection(b),a);assert(matchesIngredientSelection(a,b),a);}
 assert.equal(ingredientSelection('ニンジン根エキス'),'ニンジン根エキス');assert.equal(ingredientSelection('ニンジンエキス'),'高麗人参エキス');assert(!matchesIngredientSelection('ニンジン根エキス','高麗人参エキス'));
 });

test('v0.9.36 surfactant and polymer label groups',()=>{
 for(const [a,b] of [["トリイソステアリン","トリイソステアリン酸グリセリル"],["ラウリルヒドロキシスルホベタイン液","ラウリルヒドロキシスルタイン"],["ステアリン酸ポリオキシエチレンソルビタン","ポリソルベート60"],["トリイソステアリン酸ジグリセリル","トリイソステアリン酸ポリグリセリル-2"],["セテス-6","ポリオキシエチレンセチルエーテル"],["セテス-10","ポリオキシエチレンセチルエーテル"],["セテス-20","ポリオキシエチレンセチルエーテル"],["セテス-25","ポリオキシエチレンセチルエーテル"],["ステアレス-2","ポリオキシエチレンステアリルエーテル"],["ステアレス-4","ポリオキシエチレンステアリルエーテル"],["ベヘネス-2","ポリオキシエチレンベヘニルエーテル"],["ベヘネス-20","ポリオキシエチレンベヘニルエーテル"],["イソセテス-10","ポリオキシエチレンイソセチルエーテル"],["イソセテス-20","ポリオキシエチレンイソセチルエーテル"],["オクチルドデセス-16","ポリオキシエチレンオクチルドデシルエーテル"],["オクチルドデセス-20","ポリオキシエチレンオクチルドデシルエーテル"],["オクチルドデセス-25","ポリオキシエチレンオクチルドデシルエーテル"],["ラウレス-4","ポリオキシエチレンラウリルエーテル"],["ラウレス-7","ポリオキシエチレンラウリルエーテル"],["ラウレス-21","ポリオキシエチレンラウリルエーテル"],["ポリオキシエチレンラウリルエーテル(7E.O.)","ポリオキシエチレンラウリルエーテル"],["ラウレス-4カルボン酸","ポリオキシエチレンラウリルエーテル酢酸"],["ラウレス-6カルボン酸","ポリオキシエチレンラウリルエーテル酢酸"],["コレス-10","ポリオキシエチレンコレステリルエーテル"],["ラウリルジメチルアミノ酢酸ベタイン","ラウリルベタイン"],["ジリノール酸ジ(フィトステリル/イソステアリル/セチル/ステアリル/ベヘニル)","ダイマージリノール酸(フィトステリル/イソステアリル/セチル/ステアリル/ベヘニル)"],["N-ラウロイル-L-グルタミン酸ジ(フィトステリル・ベヘニル・2-オクチルドデシル)","ラウロイルグルタミン酸ジ(オクチルドデシル/フィトステリル/ベヘニル)"],["N-ラウロイル-L-グルタミン酸ジ(フィトステリル・2-オクチルドデシル)","ラウロイルグルタミン酸ジ(フィトステリル/オクチルドデシル)"],["トリイソステアリン酸ポリエチレングリコール-20グリセリル","トリイソステアリン酸ポリオキシエチレングリセリル"],["ポリオキシエチレンポリオキシプロピレンデシルテトラデシルエーテル","ポリオキシエチレン・ポリオキシプロピレンデシルテトラデシルエーテル"],["ポリオキシプロピレン-6デシルテトラデセス-20","ポリオキシエチレン・ポリオキシプロピレンデシルテトラデシルエーテル"],["ポリオキシプロピレン-6デシルテトラデセス-30","ポリオキシエチレン・ポリオキシプロピレンデシルテトラデシルエーテル"],["ポリオキシプロピレン-13デシルテトラデセス-24","ポリオキシエチレン・ポリオキシプロピレンデシルテトラデシルエーテル"],["ポリオキシエチレン(17)ポリオキシプロピレン(17)ブチルエーテル","ポリオキシエチレン・ポリオキシプロピレンブチルエーテル"],["ポリオキシエチレンポリオキシプロピレンブチルエーテル(37E.O.)(38P.O.)","ポリオキシエチレン・ポリオキシプロピレンブチルエーテル"],["ポリオキシプロピレン-7ブテス-10","ポリオキシエチレン・ポリオキシプロピレンブチルエーテル"],["ポリオキシプロピレン-17ブテス-17","ポリオキシエチレン・ポリオキシプロピレンブチルエーテル"],["ポリオキシプロピレン-26ブテス-26","ポリオキシエチレン・ポリオキシプロピレンブチルエーテル"],["ポリオキシプロピレン-30ブテス-30","ポリオキシエチレン・ポリオキシプロピレンブチルエーテル"],["イソステアリン酸ポリエチレングリコール-20ソルビタン","イソステアリン酸ポリオキシエチレンソルビタン"],["イソステアリン酸ポリオキシエチレン(20)ソルビタン","イソステアリン酸ポリオキシエチレンソルビタン"],["イソステアリン酸ポリエチレングリコール-50水添ヒマシ油","イソステアリン酸ポリオキシエチレン水添ヒマシ油"],["イソステアリン酸ポリオキシエチレン硬化ヒマシ油","イソステアリン酸ポリオキシエチレン水添ヒマシ油"],["ステアリン酸硬化ヒマシ油","ステアリン酸水添ヒマシ油"],["PCAイソステアリン酸ポリエチレングリコール-40水添ヒマシ油","ピログルタミン酸イソステアリン酸ポリオキシエチレン水添ヒマシ油"],["ポリオキシエチレンヤシ油脂肪酸グリセリル","ヤシ油脂肪酸ポリオキシエチレングリセリル"],["ポリエチレングリコール-7グリセリルココエート","ヤシ油脂肪酸ポリオキシエチレングリセリル"],["ヤシ油脂肪酸ポリエチレングリコール-7グリセリル","ヤシ油脂肪酸ポリオキシエチレングリセリル"],["ポリオキシエチレン(20)ヤシ油脂肪酸ソルビタン","ヤシ油脂肪酸ポリオキシエチレンソルビタン"],["ポリエチレングリコール-20ソルビタンココエート","ヤシ油脂肪酸ポリオキシエチレンソルビタン"],["モノステアリン酸ポリオキシエチレングリセリル","ステアリン酸ポリオキシエチレングリセリル"],["ステアリン酸ポリエチレングリコール-5グリセリル","ステアリン酸ポリオキシエチレングリセリル"],["ステアリン酸ポリエチレングリコール-60グリセリル","ステアリン酸ポリオキシエチレングリセリル"],["ポリエチレングリコール-3コカミド","ポリオキシエチレンコカミド"],["ポリエチレングリコール-6コカミド","ポリオキシエチレンコカミド"],["ポリエチレングリコール-5フィトステロール","ポリオキシエチレンフィトステロール"],["ポリエチレングリコール-30フィトステロール","ポリオキシエチレンフィトステロール"],["メチルグルセス-10","ポリオキシエチレンメチルグルコシド"],["メチルグルセス-20","ポリオキシエチレンメチルグルコシド"],["ポリオキシプロピレン-10メチルグルコース","ポリオキシプロピレンメチルグルコシド"],["ポリオキシエチレン・ジメチコン共重合体","ポリオキシエチレンジメチコン"],["ポリエチレングリコール-3ジメチコン","ポリオキシエチレンジメチコン"],["ポリエチレングリコール-10ジメチコン","ポリオキシエチレンジメチコン"],["ポリエチレングリコール-12ジメチコン","ポリオキシエチレンジメチコン"],["ポリエチレングリコール-10メチルエーテルジメチコン","ポリオキシエチレンメチルエーテルジメチコン"],["ポリエチレングリコール-11メチルエーテルジメチコン","ポリオキシエチレンメチルエーテルジメチコン"],["ジメチルジステアリルアンモニウムヘクトライト","ジステアルジモニウムヘクトライト"],["テトラオレイン酸ソルベス-30","テトラオレイン酸ポリオキシエチレンソルビット"],["(アクリル酸ナトリウム/アクリロイルジメチルタウリンナトリウム)コポリマー","アクリル酸ナトリウム・アクリロイルジメチルタウリン酸ナトリウム共重合体"],["架橋型N,N-ジメチルアクリルアミド-2-アクリルアミド-2-メチルプロパンスルホン酸ナトリウム共重合体","(ジメチルアクリルアミド/アクリロイルジメチルタウリンナトリウム)クロスポリマー"],["(アクリレーツ/VA)コポリマー","アクリレーツ・酢酸ビニル共重合体"],["(アクリロイルジメチルタウリンアンモニウム/VP)コポリマー","アクリロイルジメチルタウリンアンモニウム・ビニルピロリドン共重合体"],["パラオキシ安息香酸エステル","パラベン"],["香料NBc0034/1","香料"],["プラセンタエキス-1","プラセンタエキス"]]){assert.equal(ingredientSelection(a),ingredientSelection(b),a);assert(matchesIngredientSelection(a,b),a);}
 for(const [a,b] of [["ニンジン根エキス","高麗人参エキス"],["ポリオキシエチレンラウリルエーテル","ラウレス硫酸ナトリウム"],["ポリオキシエチレンセチルエーテル","ポリオキシエチレンステアリルエーテル"],["ポリソルベート60","ポリソルベート80"],["トリイソステアリン酸グリセリル","トリイソステアリン酸ポリグリセリル-2"],["ラウリルベタイン","ラウリルヒドロキシスルタイン"],["メチルパラベン","プロピルパラベン"],["ポリオキシエチレンフィトステロール","ポリオキシエチレンフィトスタノール"]])assert.notEqual(ingredientSelection(a),ingredientSelection(b),a);
});
