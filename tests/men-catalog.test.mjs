import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadCatalog} from '../dist/catalog-csv.js';
import {mergeCatalogData} from '../dist/catalog-data.js';
import {optimize} from '../dist/optimizer.js';

const read = url => readFile(url, 'utf8');

test('male catalog is separate, JAN-valid and contains priced cleanser/moisturizer choices', async () => {
  const female = await loadCatalog(read);
  const male = await loadCatalog(read, '../catalog-men/');
  const jans = new Set(female.products.map(p => p.jan));
  assert.equal(male.products.length, 9);
  assert.ok(male.products.every(p => !jans.has(p.jan)));
  assert.equal(new Set(male.products.map(p=>p.jan)).size, male.products.length);
  for (const p of male.products) {
    assert.ok(['メンズビオレ','ニベアメン'].includes(p.brand));
    assert.equal(male.pricing.prices[p.jan]?.jan, p.jan);
    assert.ok(p.sourceUrl.startsWith('https://www.kao-kirei.com/'));
  }
  const products = mergeCatalogData(male.products, male.pricing, male.usage);
  for (const concern of ['dryness','pores','acne']) {
    const options={budget:5000,concerns:[concern],priority:'any',skinType:'unknown',finish:'any',ingredient:'none'};
    // Verify at least that the basic required two categories can be selected.
    const result=optimize(products,options);
    assert.ok(result.length>0, `No routine for ${concern}`);
    assert.ok(result[0].products.some(p=>p.category==='cleanser'));
    assert.ok(result[0].products.some(p=>p.category==='moisturizer'));
  }
});
