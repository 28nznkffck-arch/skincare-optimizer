import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadCatalog} from '../dist/catalog-csv.js';
import {mergeCatalogData} from '../dist/catalog-data.js';
import {optimize} from '../dist/optimizer.js';

test('worker preserves exact recommendations and the minimum-cost explanation',async()=>{
  const data=await loadCatalog(url=>readFile(url,'utf8'));
  const all=mergeCatalogData(data.products,data.pricing,data.usage);
  const catalog=['cleanser','moisturizer','toner','serum'].flatMap(category=>all.filter(p=>p.category===category).slice(0,3));
  const messages=[],original=globalThis.self;
  globalThis.self={postMessage:message=>messages.push(message)};
  try {
    await import('../dist/routine-worker.js?parity');
    const options={budget:5000,concerns:['dryness'],priority:'any'};
    self.onmessage({data:{catalog,options}});
    assert.deepEqual(messages[0],{routine:optimize(catalog,{...options,resultLimit:1})[0]||null,minimumMonthly:null});
    self.onmessage({data:{catalog,options:{...options,budget:0}}});
    assert.equal(messages[1].routine,null);
    assert.equal(messages[1].minimumMonthly,optimize(catalog,{...options,budget:Infinity,objective:'minimumMonthly',resultLimit:1})[0].monthly);
  } finally {if(original===undefined)delete globalThis.self;else globalThis.self=original;}
});
