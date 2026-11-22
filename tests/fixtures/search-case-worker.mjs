import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {loadCatalog} from '../../dist/catalog-csv.js';
import {getBudgetRange,mergeCatalogData} from '../../dist/catalog-data.js';
import {CONCERNS,optimize} from '../../dist/optimizer.js';
const data=await loadCatalog(url=>readFile(url,'utf8'),workerData.men?'../catalog-men/':'../catalog/');
const catalog=mergeCatalogData(data.products,data.pricing,data.usage);
let progress;
const options={...workerData,resultLimit:1};
if(workerData.all){options.concerns=Object.keys(CONCERNS);options.budget=getBudgetRange(catalog).max;}
const result=optimize(catalog,options,event=>{progress=event;})[0];
parentPort.postMessage({result:result?{score:result.score,monthly:result.monthly,jans:result.products.map(p=>p.jan)}:null,progress,budget:options.budget});
