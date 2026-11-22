import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const entry=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const men=await readFile(new URL('../men/index.html',import.meta.url),'utf8');
const script=entry.match(/<script id="startup-watchdog">([\s\S]*?)<\/script>/)[1];
function startup(){
  const events={},entryEvents={},timers=new Map();let nextTimer=0,observer;
  const node=tag=>({tag,className:'',children:[],textContent:'',setAttribute(name,value){this[name]=value;},append(...children){this.children.push(...children);},querySelector(selector){return this.children.find(child=>child.className.split(' ').includes(selector.slice(1)))||null;}});
  const root=node('div'),loading=node('main');loading.className='loading';root.children=[loading];root.replaceChildren=(...children)=>{root.children=children;};
  const document={getElementById:id=>id==='app'?root:{addEventListener:(type,fn)=>entryEvents[type]=fn},createElement:node};
  const window={location:{href:'https://example.test/dist/?existing=1'},addEventListener:(type,fn)=>events[type]=fn};
  class Observer{constructor(fn){this.fn=fn;observer=this;}observe(){}disconnect(){this.disconnected=true;}}
  runInNewContext(script,{document,window,URL,Date,MutationObserver:Observer,setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)});
  return {root,node,events,entryEvents,timers,observer};
}

test('both entry pages recover from a failed module or stalled startup',()=>{
  assert.equal(men.match(/<script id="startup-watchdog">([\s\S]*?)<\/script>/)[1],script);
  for(const kind of ['module','timeout','runtime']){
    const s=startup();
    if(kind==='module')s.entryEvents.error();
    if(kind==='timeout'){const timer=[...s.timers.values()][0];assert.equal(timer.delay,25000);timer.fn();}
    if(kind==='runtime')s.events.error({message:'module export unavailable'});
    const panel=s.root.children[0];assert.equal(panel.className,'error');assert.equal(panel.role,'alert');
    const retry=panel.querySelector('.startup-retry');assert.equal(retry.textContent,'もう一度読み込む');
    const url=new URL(retry.href);assert.equal(url.searchParams.get('existing'),'1');assert(url.searchParams.has('_reload'));
    assert(s.observer.disconnected);assert.equal(s.timers.size,0);
  }
});

test('startup watchdog leaves a usable app intact and adds recovery to catalog errors',()=>{
  const s=startup(),panel=s.node('div');panel.className='shell';s.root.replaceChildren(panel);s.observer.fn();
  s.events.error({message:'later event'});assert.equal(s.root.children[0],panel);assert.equal(s.timers.size,0);
  const failure=startup(),error=failure.node('main');error.className='error';error.textContent='products.csv の読み込みに失敗';failure.root.replaceChildren(error);failure.observer.fn();
  assert.equal(failure.root.children[0],error);assert(error.querySelector('.startup-retry'));assert.equal(error.textContent,'products.csv の読み込みに失敗');
});
