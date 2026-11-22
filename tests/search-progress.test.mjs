import test from 'node:test';
import assert from 'node:assert/strict';
import {optimize,CATEGORIES} from '../dist/optimizer.js';
import {renderProgress} from '../dist/progress-view.js';

function product(category,index,extra={}){
  return {jan:`${category}-${index}`,brand:'試験',name:'通常品',category,referencePrice:100,referenceUses:30,dailyUses:1,
    keyIngredients:['保湿成分'],scores:{dryness:1,eyeDryness:1},evidence:{},...extra};
}
const catalog=[product('makeupRemover',0,{doubleCleanseNotNeeded:true}),product('makeupRemover',1),
  product('cleanser',0),product('cleanser',1),product('toner',0),product('toner',1),product('serum',0),
  product('moisturizer',0),product('moisturizer',1),product('eyeCare',0)];

test('progress counts full candidate combinations, including skipped branches, without changing results',()=>{
  const cases=[
    [{budget:5000,resultLimit:1},24n],
    [{budget:150,resultLimit:1},24n],
    [{budget:5000},24n],
    [{budget:Infinity,resultLimit:1,objective:'minimumMonthly'},24n],
    [{budget:5000,resultLimit:1,useMakeupRemover:true,concerns:['dryness','eyeDryness']},144n],
    [{budget:5000,resultLimit:1,useMakeupRemover:true,priority:'simple',concerns:['dryness','eyeDryness']},48n],
    [{budget:5000,resultLimit:1,ingredient:'ない成分',ingredientMode:'required'},24n],
    [{budget:5000,resultLimit:1,locked:{toner:'toner-0'}},8n],
  ];
  for(const [setting,total] of cases){
    const options={concerns:['dryness'],priority:'any',...setting},events=[];
    const result=optimize(catalog,options,event=>events.push(event));
    assert.deepEqual(result,optimize(catalog,options));
    const search=events.filter(event=>event.stage==='search'),last=search.at(-1);
    assert.equal(BigInt(last.total),total);assert.equal(BigInt(last.evaluated)+BigInt(last.skipped),total);
    assert.equal(last.percent,100);assert(last.complete);
    let previous=0;
    for(const event of search){
      const completed=BigInt(event.evaluated)+BigInt(event.skipped);
      assert(completed<=total);assert.equal(event.percent,Number(completed*10000n/total)/100);
      assert(event.percent>=previous);previous=event.percent;
    }
  }
});

test('single-item budget filtering credits all combinations containing the removed item',()=>{
  const expensive=catalog.map(item=>item.category==='serum'?{...item,referencePrice:10000}:item),events=[];
  optimize(expensive,{budget:5000,concerns:['dryness'],resultLimit:1},event=>events.push(event));
  const last=events.at(-1);assert.equal(last.total,'24');assert(BigInt(last.skipped)>=12n);assert.equal(last.percent,100);
});

test('mixed constraints and overrides preserve accounting and the exact result',()=>{
  for(let seed=0;seed<24;seed++){
    const items=catalog.map((item,index)=>({...item,referencePrice:100*((index+seed)%7+1),scores:{dryness:(index+seed)%4,eyeDryness:(index*seed)%4},keyIngredients:[`成分${index%3}`]}));
    const options={budget:[0,300,1000,5000][seed%4],concerns:seed%2?['dryness','eyeDryness']:['dryness'],
      useMakeupRemover:seed%3===0,priority:['simple','any','thorough'][seed%3],
      resultLimit:seed%2?1:undefined,objective:seed%5===0?'minimumMonthly':undefined,
      ingredient:seed%4===0?'成分0':'none',ingredientMode:'required',
      excluded:seed%3===0?['toner-0']:[],overrides:seed%2?{'cleanser-1':{price:0}}:{}};
    const events=[],withProgress=optimize(items,options,event=>events.push(event));
    assert.deepEqual(withProgress,optimize(items,options));
    const last=events.at(-1);assert.equal(BigInt(last.evaluated)+BigInt(last.skipped),BigInt(last.total));assert.equal(last.percent,100);
  }
});

test('empty candidate sets complete with zero work and large counts retain integer precision',()=>{
  for(const items of [[],catalog.filter(item=>item.category!=='cleanser')]){
    const events=[];assert.deepEqual(optimize(items,{concerns:['dryness'],resultLimit:1},event=>events.push(event)),[]);
    assert.equal(events.at(-1).total,'0');assert.equal(events.at(-1).percent,100);
  }
  const n=2000,large=CATEGORIES.flatMap(category=>Array.from({length:n},(_,index)=>product(category,index,{referencePrice:10000}))),events=[];
  optimize(large,{budget:1,concerns:['dryness','eyeDryness'],useMakeupRemover:true,resultLimit:1},event=>events.push(event));
  const total=2000n**2n*2001n**4n,last=events.at(-1);
  assert(total>BigInt(Number.MAX_SAFE_INTEGER));assert.equal(last.total,String(total));assert.equal(last.skipped,String(total));assert.equal(last.evaluated,'0');assert.equal(last.percent,100);
});

test('search updates identify actual candidate products without changing results or counts',()=>{
  const items=['cleanser','toner','serum','moisturizer'].flatMap(category=>Array.from({length:8},(_,i)=>product(category,i,{name:`${category}-${i}`,scores:{dryness:1}})));
  const originalNow=Date.now;let time=0;
  Date.now=()=>time+=100;
  try {
    for(const extra of [{},{resultLimit:1}]){
      const options={budget:5000,concerns:['dryness'],priority:'thorough',...extra},events=[];
      const result=optimize(items,options,event=>events.push(event));
      assert.deepEqual(result,optimize(items,options));
      const detailed=events.filter(event=>event.detail);
      assert(detailed.length>0,'a long search must report the candidates being compared');
      for(const event of detailed){
        assert(items.some(item=>event.current.includes(`「${item.brand} ${item.name}」`)));
        assert.match(event.current,/組み合わせを確認しています/);
      }
      assert(new Set(detailed.map(event=>event.current)).size>1,'candidate descriptions must follow the actual search');
      const last=events.at(-1);assert.equal(last.percent,100);assert.equal(BigInt(last.evaluated)+BigInt(last.skipped),BigInt(last.total));
    }
  }finally{Date.now=originalNow;}
});

test('progress panel puts the actual percent beside the bar and the current task below it',()=>{
  const markup=renderProgress({title:'提案の探索',stage:'search',percent:37.5,current:'予算を超える枝を省略',evaluated:'100',skipped:'200',total:'800'});
  assert.match(markup,/class="process-icon"/);assert.match(markup,/あなたに合うスキンケアを検索中/);
  assert.match(markup,/<progress[^>]*value="37.5"[^>]*>[\s\S]*?<\/progress>\s*<strong class="process-percent">37.5%<\/strong>/);
  assert.match(markup,/予算を超える枝を省略/);assert.doesNotMatch(markup,/評価 100 通り|省略 200 通り/);
  assert.doesNotMatch(renderProgress({current:'候補を集計中'}),/value="/);
  assert.match(renderProgress({stage:'loading',percent:25,current:'products.csvの読み込みが完了'}),/商品データを読み込んでいます…/);
  assert.match(renderProgress({percent:0,current:'保湿の候補を評価・整理中'}),/保湿の候補を評価しています…/);
  assert.match(renderProgress({percent:25,current:'prices.csvの照合'},true),/停止時の処理：prices.csvの照合/);
  assert.match(renderProgress({current:'<script>bad</script>'}),/&lt;script&gt;/);
  assert.match(renderProgress({current:'候補を比較',detail:'<b>予算を確認</b>'}),/&lt;b&gt;予算を確認&lt;\/b&gt;/);
});
