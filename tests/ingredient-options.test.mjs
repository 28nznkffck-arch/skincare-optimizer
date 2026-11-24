import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {loadCatalog} from '../dist/catalog-csv.js';
import {reconcileCatalogState} from '../dist/catalog-data.js';
import {ingredientChoices,canonicalIngredient,ingredientSelection,displayIngredients,INGREDIENT_ALIASES,INGREDIENT_FAMILIES,INGREDIENT_COMPOSITES,ingredientSelections,matchesIngredientSelection,DIPOTASSIUM_GLYCYRRHIZATE} from '../dist/ingredient-options.js';
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
    assert.deepEqual(ingredientChoices(products),['none',family]);
    for(const product of products){
      assert(meetsIngredientRequirement([product],settings),product.ingredients[0]);
      assert(canIncludeRoutineProduct(product,settings));
      assert.equal(scoreRoutine([product],settings)-scoreRoutine([product],{...settings,ingredient:'none'}),10);
      assert.equal(reconcileCatalogState({ingredient:product.ingredients[0]},[product]).ingredient,family);
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

test('new ingredient groupings do not equate unrelated chemicals',()=>{for(const [a,b] of [['ステアリン酸','ステアリン酸Mg'],['塩化ナトリウム','塩化Mg'],['クエン酸','クエン酸トリエチル'],['グルタミン酸','D-グルタミン酸'],['ローズマリーエキス','ローズマリー葉油']])assert.notEqual(ingredientSelection(a),ingredientSelection(b));for(const item of ['EDTA-2Na','EDTA-3Na','EDTA-4Na'])assert.equal(ingredientSelection(item),'EDTA');});

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
    'PEG水添ヒマシ油':['PEG-20水添ヒマシ油','PEG-60水添ヒマシ油','PEG60水添ヒマシ油','POE硬化ヒマシ油'],
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
    'PCA-Na':['PCA-Na','DL-PCA・Na液','DL-ピロリドンカルボン酸ナトリウム液'],
    'PPG-9ジグリセリル':['PPG-9ジグリセリル','ポリオキシプロピレンジグリセリルエーテル'],
    'トウキエキス(1)':['トウキエキス-1','トウキエキス(1)'],
    'イソステアリン酸POEグリセリル':['イソステアリン酸ポリオキシエチレングリセリル','イソステアリン酸PEG-8グリセリル','イソステアリン酸PEG-20グリセリル','イソステアリン酸PEG-60グリセリル'],
  }))for(const name of names)assert.equal(ingredientSelection(name),want,name);
  for(const [a,b] of [['PCA-Na','PCA'],['PPG-9ジグリセリル','PPG-14ジグリセリル'],['イソステアリン酸POEグリセリル','ステアリン酸PEG-60グリセリル'],['トウキエキス(1)','トウキ葉エキス']])
    assert.notEqual(ingredientSelection(a),ingredientSelection(b));
});
