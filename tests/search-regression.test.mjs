import assert from 'node:assert/strict';
import test from 'node:test';
import {Worker} from 'node:worker_threads';

test('six concerns with a large budget and makeup removal finish without enumerating billions of candidates',async()=>{
  const worker=new Worker(new URL('./fixtures/search-case-worker.mjs',import.meta.url),{workerData:{
    budget:26100,concerns:['acne','firmness','eyeDryness','brightness','dullness','blackheads'],
    priority:'any',useMakeupRemover:true,
  }});
  const completed=await new Promise((resolve,reject)=>{
    let received=false;
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('The reported high-budget case did not finish within 20 seconds.'));},20000);
    worker.once('message',value=>{received=true;clearTimeout(timer);resolve(value);});
    worker.once('error',error=>{clearTimeout(timer);reject(error);});
    worker.once('exit',code=>{clearTimeout(timer);if(!received)reject(new Error(`Search worker exited before returning a result: ${code}`));});
  });
  // A 144-point routine is known to fit these conditions. Added products may improve it.
  assert(completed.result.score>=144);assert(completed.result.monthly<=26100);
  assert.equal(completed.progress.percent,100);assert(BigInt(completed.progress.total)>=7092316800n);
  assert.equal(BigInt(completed.progress.evaluated)+BigInt(completed.progress.skipped),BigInt(completed.progress.total));
});
