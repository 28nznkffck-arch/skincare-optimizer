import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {optimize,CATEGORIES} from '../dist/optimizer.js';
import {renderProgress} from '../dist/progress-view.js';

function product(category,index,extra={}){
  return {jan:`${category}-${index}`,brand:'試験',name:'通常品',category,referencePrice:100,referenceUses:30,dailyUses:1,
    ingredients:['保湿成分'],scores:{dryness:1,eyeDryness:1},evidence:{},...extra};
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
    const items=catalog.map((item,index)=>({...item,referencePrice:100*((index+seed)%7+1),scores:{dryness:(index+seed)%4,eyeDryness:(index*seed)%4},ingredients:[`成分${index%3}`]}));
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

test('search descriptions name actual categories and remain readable while percent keeps updating',()=>{
  const items=['cleanser','toner','serum','moisturizer'].flatMap(category=>Array.from({length:8},(_,i)=>product(category,i,{name:`${category}-${i}`,scores:{dryness:1}})));
  const originalNow=Date.now;let time=0;
  Date.now=()=>time+=100;
  try {
    for(const extra of [{},{resultLimit:1}]){
      const options={budget:5000,concerns:['dryness'],priority:'thorough',...extra},events=[];
      const result=optimize(items,options,event=>events.push({...event,time}));
      assert.deepEqual(result,optimize(items,options));
      const detailed=events.filter(event=>event.stage==='search' && BigInt(event.completed)>0n && !event.complete);
      assert(detailed.length>0,'a long search must report the category being compared');
      let changedAt=detailed[0].time,previous=detailed[0].current;
      for(const event of detailed){
        assert.equal(event.detail,undefined,'search must not emit pruning explanations for the UI');
        assert.match(event.current,/^(?:洗顔の暫定一位を計算しています|(?:化粧水|美容液|乳液・クリームなど)と組み合わせています)……$/);
        assert.doesNotMatch(event.current,/試験|通常品|上回る可能性|組み合わせを省略/);
        if(event.current!==previous){
          assert(event.time-changedAt>=1000,'category text must stay visible for at least one second');
          previous=event.current;changedAt=event.time;
        }
      }
      assert(detailed.some((event,i)=>i>0 && event.current===detailed[i-1].current && event.percent>detailed[i-1].percent),
        'percent must advance while the category description stays visible');
      const last=events.at(-1);assert.equal(last.percent,100);assert.equal(BigInt(last.evaluated)+BigInt(last.skipped),BigInt(last.total));
      assert.equal(last.current,'組み合わせの探索が完了','completion must immediately replace the held description');
    }
  }finally{Date.now=originalNow;}
});

test('progress panel puts the actual percent beside the bar and the current task below it',()=>{
  const markup=renderProgress({title:'提案の探索',stage:'search',percent:37.5,current:'予算を超える枝を省略',evaluated:'100',skipped:'200',total:'800'});
  assert.match(markup,/class="process-icon"/);assert.match(markup,/あなたに合うスキンケアを検索中/);
  assert.match(markup,/<div class="process-track" role="progressbar"[^>]*aria-valuenow="37.5"[^>]*><span style="width:37.5%"><\/span><\/div>\s*<strong class="process-percent"> 37.50%<\/strong>/);
  assert.match(markup,/予算を超える枝を省略/);assert.doesNotMatch(markup,/評価 100 通り|省略 200 通り/);
  assert.doesNotMatch(renderProgress({current:'候補を集計中'}),/aria-valuenow=/);
  assert.match(renderProgress({current:'候補を集計中'}),/process-percent">  0.00%/);
  assert.match(renderProgress({stage:'loading',percent:25,current:'products.csvの読み込みが完了'}),/商品データを読み込んでいます…/);
  assert.match(renderProgress({percent:0,current:'保湿の候補を評価・整理中'}),/保湿の候補を評価しています…/);
  assert.match(renderProgress({percent:25,current:'prices.csvの照合'},true),/停止時の処理：prices.csvの照合/);
  assert.match(renderProgress({current:'<script>bad</script>'}),/&lt;script&gt;/);
  assert.doesNotMatch(renderProgress({current:'美容液と組み合わせています……',detail:'予算で省略'}),/process-detail/);
  assert.doesNotMatch(renderProgress({current:'美容液と組み合わせています……',detail:'今の有力候補と相性を比較し、上回る可能性のない組み合わせを省いています…'},true),/process-detail|上回る可能性/);
});

test('percentage keeps exactly two decimals and a seven-character field at every digit boundary',async()=>{
  for(const [value,expected] of [[0,'  0.00%'],[9,'  9.00%'],[9.99,'  9.99%'],[10,' 10.00%'],[99.99,' 99.99%'],[100,'100.00%'],[-1,'  0.00%'],[101,'100.00%']]){
    const text=renderProgress({percent:value}).match(/<strong class="process-percent">([^<]+)<\/strong>/)[1];
    assert.equal(text,expected);assert.equal(text.length,7);
  }
  const css=await readFile(new URL('../dist/styles.css',import.meta.url),'utf8');
  const rule=css.match(/\.process-percent\{([^}]+)\}/)[1],meter=css.match(/\.process-meter\{([^}]+)\}/)[1];
  assert.match(rule,/(?:^|;)width:7ch;/);assert.match(rule,/max-width:7ch;/);assert.match(rule,/font:inherit;/);
  assert.match(meter,/grid-template-columns:minmax\(0,1fr\) 7ch;/);assert.match(meter,/font-family:[^;]*monospace;/);
  assert.match(rule,/white-space:pre;/);assert.match(rule,/letter-spacing:0;/);
  for(const page of ['../dist/index.html','../men/index.html']){
    const html=await readFile(new URL(page,import.meta.url),'utf8');
    assert.match(html,/class="process-track" role="progressbar"/);
    assert.match(html,/<strong class="process-percent">  0.00%<\/strong>/);
    assert.doesNotMatch(html,/<progress\b/);
  }
});
