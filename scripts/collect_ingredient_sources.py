"""Collect complete ingredient labels, without a selectable-ingredient vocabulary.

Research utility; requires lxml. It writes a checkpoint, not the product CSV.
python scripts/collect_ingredient_sources.py --output /path/to/collected.json
"""
import argparse
import concurrent.futures
import csv
import hashlib
import json
import re
import threading
import unicodedata
import urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from lxml import html

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT.parent/'ingredient-work'
CACHE=WORK/'cache'
CACHE.mkdir(parents=True,exist_ok=True)
locks={}
guard=threading.Lock()

def normalize(value):
    return re.sub(r'\s+','',unicodedata.normalize('NFKC',value)).replace('®','').replace('™','')

def fetch(url):
    key=hashlib.sha256(url.encode()).hexdigest()
    with guard:lock=locks.setdefault(key,threading.Lock())
    with lock:
        meta=CACHE/(key+'.json');body=CACHE/(key+'.html')
        if meta.exists():
            data=json.loads(meta.read_text())
            if body.exists() or data.get('error'):return data
        data={'url':url,'checkedAt':'2026-11-23'}
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(req,timeout=25) as response:
                raw=response.read();data.update(status=response.status,finalUrl=response.url)
            try:value=raw.decode('utf-8')
            except UnicodeDecodeError:value=raw.decode('cp932',errors='replace')
            body.write_text(value);data.update(path=str(body),sha256=hashlib.sha256(raw).hexdigest())
        except Exception as error:data['error']=str(error)
        meta.write_text(json.dumps(data,ensure_ascii=False))
        return data

def label_text(node):
    clone=html.fromstring(html.tostring(node))
    for br in clone.xpath('.//br'):br.tail='\n'+(br.tail or '')
    return clone.text_content().strip()

def label_parts(node):
    original=label_text(node)
    clone=html.fromstring(html.tostring(node))
    for sup in clone.xpath('.//sup'):
        if re.search(r'[※＊*☆★†‡]',sup.text_content()):sup.drop_tree()
    for br in clone.xpath('.//br'):br.tail='\n'+(br.tail or '')
    clean=clone.text_content().strip()
    clean=re.split(r'[＊*]は|※[;；：:]|※商品の|※表示|\n\s*[☆★※＊*†‡]|ハトムギ[^\n]*エキスは',clean)[0]
    clean=re.sub(r'^(?:配合成分|全成分|成分)[：:；;\s]*','',clean)
    clean=re.sub(r'^【(?:全)?成分】\s*','',clean)
    clean=re.sub(r'[【＜<](?:有効成分|その他(?:の)?成分)[】＞>]','、',clean)
    clean=re.sub(r'(?:有効成分|その他(?:の)?成分)[：:]','、',clean)
    clean=re.sub(r'[※＊*☆★†‡](?:[0-9０-９]+)?','',clean).replace('､','、')
    delimiter='、' if '、' in clean else ('・' if clean.count('・')>clean.count(',') else ',')
    names=[];buf='';depth=0
    for i,char in enumerate(clean):
        if char in '(（[［':depth+=1
        elif char in ')）]］':depth=max(0,depth-1)
        numeric=(char in ',、' and (re.fullmatch(r'\d+(?:[,、]\d+)*',buf.strip()) or re.fullmatch(r'\d+[－-][ぁ-んァ-ヶ一-龯]+[－-]\d+',buf.strip())) and i+1<len(clean) and clean[i+1].isdigit())
        locant=(char==',' and re.fullmatch(r'[NOS](?:,[NOS])*',buf.strip()) and re.match(r'[NOS][-－,，]',clean[i+1:]))
        if char==delimiter and depth==0 and not numeric and not locant:
            if buf.strip():names.append(re.sub(r'\s+',' ',buf.strip()))
            buf=''
        else:buf+=char
    if buf.strip():names.append(re.sub(r'\s+',' ',buf.strip()))
    names=[re.sub(r'\s+','',name) if re.search(r'[ぁ-んァ-ヶ一-龯]',name) else name for name in names]
    return original,names

def extract(doc,row,url):
    host=urlsplit(url).hostname;nodes=[];selector='';variant=''
    if host=='www.kao-kirei.com':
        selector='product ingredient description'
        nodes=doc.xpath('//dl[dt[contains(.,"成分・素材")]]/dd')
        if not nodes:nodes=doc.xpath('//tr[td[1][normalize-space(.)="成分" or normalize-space(.)="成分・素材"]]/td[2]')
    elif host=='jp.rohto.com' and '/seib/seib' in url:
        selector='official ingredient popup: active and other ingredients'
        nodes=doc.xpath('//*[contains(@class,"popupContentWrp")]/p[contains(@class,"textLeft01")]')
        # These two paragraphs are two parts of ONE label, never alternative variants.
        if nodes:
            parts=[label_parts(e) for e in nodes]
            return {'rawText':'\n'.join(p[0] for p in parts),'ingredients':[n for p in parts for n in p[1]],'selector':selector,'variant':variant}
    elif host=='www.shiseido.co.jp':
        selector='product detail: ingredient row for selected type'
        options=doc.xpath('//select[@id="js-productSelect"]/option');tables=doc.xpath('//dl[starts-with(@id,"select-contents")]')
        if len(tables)>1 and options:
            name=normalize(row['商品名']);ranked=[]
            for opt in options:
                label=normalize(opt.text_content());markers=[label]+re.findall(r'\(([^)]+)\)',label)
                markers += next(([m] for m in ['とてもしっとり','しっとり','さっぱり','みずみずしい'] if m in label),[])
                score=max([len(m) for m in markers if m and (m in name or name in m)]+[0])
                ranked.append((score,opt.get('value'),opt.text_content()))
            ranked.sort(reverse=True)
            if ranked[0][0] and (len(ranked)<2 or ranked[0][0]>ranked[1][0]):
                tables=[e for e in tables if e.get('id')==ranked[0][1]];variant=ranked[0][2].strip()
        for table in tables or [doc]:nodes+=table.xpath('.//*[contains(@class,"text__table__row")][dt[normalize-space(.)="成分"]]/dd')
    elif host=='sekkisei.jp':selector='#comment4';nodes=doc.xpath('//*[@id="comment4"]')
    elif host=='maison.kose.co.jp':
        selector='product blend panel';nodes=doc.xpath('//*[contains(@class,"p-product-detail__blend")]//*[contains(@class,"p-product-detail__text")]')
    elif host=='carte-beauty.com':
        selector='ingredient label paragraph';nodes=[e for e in doc.xpath('//*[contains(@class,"block-goods-ingredients--body")]/p') if label_text(e).startswith('配合成分')]
    elif host=='online.daiichisankyo-hc.co.jp':selector='#ingredients .bg__white';nodes=doc.xpath('//*[@id="ingredients"]//*[contains(@class,"bg__white")]')
    elif host=='www.mandom.co.jp':
        selector='product 配合成分 table'
        for heading in doc.xpath('//h4[normalize-space(.)="配合成分"]'):nodes+=heading.getparent().xpath('.//tr[th[normalize-space(.)="成分"]]/td')
    elif host=='www.kobayashi.co.jp':
        selector='product ingredient table'
        for table in doc.xpath('//table[.//th[normalize-space(.)="有効成分" or normalize-space(.)="成分" or normalize-space(.)="全成分"]]'):
            parts=[label_parts(td) for tr in table.xpath('.//tr') if any(normalize(th.text_content()) in ['有効成分','その他の成分','その他成分','成分','全成分'] for th in tr.xpath('./th')) for td in tr.xpath('./td')]
            if parts:
                e=html.Element('p');e.text='、'.join(p[0] for p in parts);nodes.append(e)
        if not nodes:
            options=[]
            for e in doc.xpath('//li[starts-with(normalize-space(.),"その他の成分")]'):
                parent=e.getparent();heading=parent.getprevious();label=normalize(heading.text_content()).split('(販売名',1)[0] if heading is not None else ''
                name=normalize(row['商品名']);score=len(label) if label and (label in name or name in label) else 0
                value='、'.join(re.sub(r'^(?:有効成分|その他の成分)\s*','',label_text(n)) for n in parent.xpath('./li'))
                node=html.Element('p');node.text=value;options.append((score,node,label))
            options.sort(key=lambda p:p[0],reverse=True)
            if options and options[0][0] and (len(options)==1 or options[0][0]>options[1][0]):nodes=[options[0][1]];variant=options[0][2]
            else:nodes=[option[1] for option in options]
        if not nodes:
            for block in doc.xpath('//div[contains(@class,"bikou")]'):
                parent=block.getparent().getparent()
                if parent.xpath('.//h3[normalize-space(.)="成分"]'):nodes+=block.xpath('./p')
    elif host=='onlineshop.finetoday.com':
        selector='product information accordion'
        for e in doc.xpath('//*[contains(@class,"accordion__content")]'):
            value=label_text(e)
            if '成分：' in value:
                node=html.Element('p');node.text=value.split('成分：',1)[1];nodes.append(node)
    elif host=='brand.shiseido.co.jp' and '-full-ingredients.html' in url:
        selector='full ingredients popup';nodes=doc.xpath('//*[contains(@class,"full-ingredients-dl")]')
        if not nodes:nodes=[e for e in doc.xpath('//*[contains(@class,"content-asset")]') if label_text(e).count(',')>3]
    elif host=='www.orbis.co.jp':
        selector='product full ingredient modal';nodes=[e for e in doc.xpath('//*[contains(@class,"productModal02__item__list__text")]') if '【その他の成分】' in e.text_content()]
    elif host=='www.chantilly.co.jp':selector='full ingredient table';nodes=doc.xpath('//tr[th[contains(.,"全成分")]]/td')
    elif host=='www.chinoshiosya.com':selector='#component .text_box';nodes=doc.xpath('//*[@id="component"]//*[contains(@class,"text_box")]')
    elif host=='bulk.co.jp':
        selector='.ingredients_box .comment'
        nodes=doc.xpath('//*[contains(@class,"ingredients_box")]//*[contains(@class,"comment")]/p')
        if nodes:
            parts=[label_parts(e) for e in nodes]
            return {'rawText':'\n'.join(p[0] for p in parts),'ingredients':[n for p in parts for n in p[1]],'selector':selector,'variant':variant}
    elif host=='proudmen.jp':
        selector='product ingredient paragraph'
        for e in doc.xpath('//div[@class="page-width"]'):
            value=label_text(e)
            if value.startswith('原産国：') and '成分：' in value:
                node=html.Element('p');node.text=value.split('成分：',1)[1];nodes.append(node)
    elif host=='www.ishizawa-lab.co.jp':
        selector='product full-ingredient table';details=doc.xpath('//details[contains(@class,"p-seibunAccordion")]');ranked=[];name=normalize(row['商品名'])
        for d in details:
            title=normalize(''.join(d.xpath('./summary//text()')))
            score=max([len(m) for m in ['スクラブ','泡洗顔','ローション','ウォッシュ','スポッツ'] if m in name and m in title]+[0]);ranked.append((score,d))
        ranked.sort(key=lambda pair:pair[0],reverse=True)
        if len(ranked)==1 or (ranked and ranked[0][0]>ranked[1][0]):
            names=[label_text(e) for e in ranked[0][1].xpath('.//tr/td[1]')]
            if names:return {'rawText':label_text(ranked[0][1]),'ingredients':names,'selector':selector,'variant':variant}
    elif host=='www.matsukiyococokara-online.com' and '/product/view/id/' in url:
        selector='same-JAN retail ingredient paragraph'
        nodes=[e for e in doc.xpath('//*[contains(@class,"p-explanation__txt")]/p') if label_text(e).startswith(('【成分】','【全成分】','【有効成分】','【その他の成分】','【その他成分】'))]
        if nodes and any(label_text(e).startswith('【有効成分】') for e in nodes) and any(label_text(e).startswith(('【その他の成分】','【その他成分】')) for e in nodes):
            parts=[label_parts(e) for e in nodes]
            return {'rawText':'\n'.join(p[0] for p in parts),'ingredients':[n for p in parts for n in p[1]],'selector':selector,'variant':variant}
        if not nodes:
            for heading in doc.xpath('//h3[normalize-space(.)="成分・分量"]'):
                container=heading.getparent()
                for _ in range(3):
                    found=container.xpath('.//*[contains(@class,"p-explanation__txt")]/p')
                    if found:nodes+=found;break
                    container=container.getparent()
                    if container is None:break
    elif host=='shop.tsuruha.co.jp':
        selector='same-JAN retailer specification ingredient row'
        for tr in doc.xpath('//tr'):
            cells=tr.xpath('./th|./td')
            if len(cells)==2 and normalize(cells[0].text_content()) in ['成分','全成分','成分・分量']:nodes.append(cells[1])
    elif host=='sundrug-online.com':
        selector='same-JAN retail 成分／分量 panel'
        for title in doc.xpath('//b[normalize-space(.)="成分／分量"]'):
            nodes+=title.getparent().getparent().getparent().xpath('.//div[contains(@class,"rte")]')
    candidates=[]
    for node in nodes:
        raw,names=label_parts(node)
        if names and all(not n.isdigit() for n in names):
            if not any(c['ingredients']==names for c in candidates):candidates.append({'rawText':raw,'ingredients':names,'selector':selector,'variant':variant})
    if len(candidates)==1:return candidates[0]
    return None

def collect(row,previous,quotes):
    jan=row['JAN'];product_url=row['公式URL'];result={'jan':jan,'productUrl':product_url,'checkedAt':'2026-11-23','status':'unverified','ingredients':[]}
    attempts=[]
    direct_rohto=['https://jp.rohto.com/seib/seib?kw='+jan[-6:]] if urlsplit(product_url).hostname=='jp.rohto.com' else []
    urls=list(dict.fromkeys([previous.get('sourceUrl'),product_url]+direct_rohto+quotes+['https://www.matsukiyococokara-online.com/store/catalog/product/view/id/'+jan]))
    urls=[url for url in urls if url]
    for position,url in enumerate(urls):
        response=fetch(url)
        if response.get('error'):attempts.append({'url':url,'reason':response['error']});continue
        doc=html.fromstring(Path(response['path']).read_text())
        secondary=[]
        if urlsplit(url).hostname=='jp.rohto.com' and '/seib/' not in url:
            links=re.findall(r"SB_open\('([^']+)'\)",Path(response['path']).read_text())
            if len(set(links))==1:secondary=[urljoin(url,links[0])]
        elif urlsplit(url).hostname=='brand.shiseido.co.jp' and '-full-ingredients.html' not in url:
            links=doc.xpath('//a[contains(@href,"-full-ingredients.html")]/@href')
            if len(set(links))==1:secondary=[urljoin(url,links[0])]
        for target in secondary:
            if target not in urls:urls.insert(position+1,target)
        parsed=extract(doc,row,url)
        if parsed:
            result.update(status='full',sourceUrl=url,sourceSha256=response['sha256'],sourceKind='manufacturer' if urlsplit(url).hostname not in ['www.matsukiyococokara-online.com','shop.tsuruha.co.jp','www.e-welcia.com','sundrug-online.com'] else 'retailer',**parsed)
            return result
        attempts.append({'url':url,'reason':'A unique product-specific full-ingredient label could not be identified'})
    result.update(reason='商品別の全成分を確定できず確認中。原本を取得するまで全成分確認済みとしない。',attempts=attempts)
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);parser.add_argument('--limit',type=int);args=parser.parse_args()
    jobs=[]
    for folder in ['catalog','catalog-men']:
        baseline=WORK/(folder+'-baseline.json')
        prior={r['jan']:r for r in json.loads(baseline.read_text())} if baseline.exists() else {}
        with (ROOT/folder/'products.csv').open(encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f))
        quotes={}
        with (ROOT/folder/'prices.csv').open(encoding='utf-8-sig',newline='') as f:
            for r in csv.DictReader(f):quotes.setdefault(r['JAN'],[]).append(r['価格の出典URL'])
        jobs.extend((folder,row,prior.get(row['JAN'],{}),quotes.get(row['JAN'],[])) for row in rows)
    if args.limit:jobs=jobs[:args.limit]
    results=[]
    def run(job):
        folder,row,prior,quotes=job
        try:return dict(folder=folder,**collect(row,prior,quotes))
        except Exception as error:return {'folder':folder,'jan':row['JAN'],'productUrl':row['公式URL'],'checkedAt':'2026-11-23','status':'unverified','ingredients':[],'reason':str(error)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for i,record in enumerate(pool.map(run,jobs),1):
            results.append(record)
            if i%25==0 or i==len(jobs):
                args.output.write_text(json.dumps(results,ensure_ascii=False,indent=2));print(json.dumps({'processed':i,'total':len(jobs),'full':sum(r['status']=='full' for r in results)},ensure_ascii=False),flush=True)
    args.output.write_text(json.dumps(results,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
