import argparse
import csv
import json
import math
import re
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
RETAILER_PRIORITY = (
    'マツキヨココカラオンライン', 'ツルハグループe-shop', 'ウエルシア',
)
CATEGORIES = {
    'メイク落とし': 'makeupRemover', '洗顔': 'cleanser', '化粧水': 'toner',
    '美容液': 'serum', '保湿': 'moisturizer', '目元ケア': 'eyeCare',
}
FEELS = {'さっぱり': 'light', 'しっとり': 'moist', 'とてもしっとり': 'rich'}
CONCERNS = {
    '毛穴の目立ち': 'pores', '黒ずみ・角栓': 'blackheads', 'くすみ': 'dullness',
    'シミ': 'spots', 'そばかす': 'freckles', '色ムラ': 'unevenTone',
    '目元の乾燥': 'eyeDryness', 'クマ': 'darkCircles', 'シワ': 'wrinkles',
    '小ジワ': 'fineLines', 'ハリ不足・たるみ': 'firmness', 'ベタつき': 'oiliness',
    'テカリ': 'shine', 'ニキビ': 'acne', '赤み': 'redness', '肌荒れ': 'irritation',
    '乾燥': 'dryness',
}


def jan_code(value):
    if not re.fullmatch(r'[0-9]{13}', value):
        raise ValueError('JANは13桁の数字で入力してください')
    total = sum(int(digit) * (1 if i % 2 == 0 else 3) for i, digit in enumerate(value))
    if total % 10:
        raise ValueError(f'JAN {value} のチェックディジットが一致しません')
    return value


def number(value):
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError('0以上の数値を入力してください')
    return int(result) if result.is_integer() else result


def positive(value):
    result = number(value)
    if result <= 0:
        raise ValueError('0より大きい数値を入力してください')
    return result


def whole_number(value):
    result = number(value)
    if not isinstance(result, int):
        raise ValueError('整数を入力してください')
    return result


def positive_integer(value):
    result = whole_number(value)
    if not result:
        raise ValueError('1以上の整数を入力してください')
    return result


def score(value):
    result = whole_number(value)
    if result > 3:
        raise ValueError('点数は0〜3です')
    return result


def https_url(value):
    url = urlsplit(value)
    if url.scheme != 'https' or not url.hostname or any(ch.isspace() for ch in value):
        raise ValueError('httpsのURLを入力してください')
    return value


def date_string(value):
    if not re.fullmatch(r'[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}', value):
        raise ValueError('日付はYYYY-MM-DDで入力してください')
    return date(*map(int, re.split('[-/]', value))).isoformat()


def ingredients(value):
    parts = [part.strip() for part in value.split('|')]
    if not all(parts):
        raise ValueError('成分名を | で区切って入力してください')
    return parts


def concentrations(value):
    items = json.loads(value)
    if not isinstance(items, list) or any(
        not isinstance(item, dict) or not item.get('name') or not item.get('unit')
        or type(item.get('value')) not in (int, float) or not positive(str(item['value']))
        or not https_url(item.get('sourceUrl', '')) for item in items
    ):
        raise ValueError('配合濃度は成分名・数値・単位・出典URLの配列で入力してください')
    return items


def boolean(value):
    return {'true': True, 'false': False}[value.lower()]


def retailer_name(value):
    return {'マツキヨ': RETAILER_PRIORITY[0], 'ツルハ': RETAILER_PRIORITY[1]}.get(value, value)


PRODUCT_FIELDS = {
    'ブランド': ('brand', str), '商品名': ('name', str),
    '品目': ('category', CATEGORIES.__getitem__), 'メーカー': ('manufacturer', str),
    '企業グループ': ('makerGroup', str), '内容量': ('volume', positive),
    '単位': ('unit', {'mL': 'mL', 'g': 'g'}.__getitem__),
    '使用感の分類': ('feel', FEELS.__getitem__), '使用感メモ': ('tone', str),
    '公式URL': ('sourceUrl', https_url), '主要成分': ('keyIngredients', ingredients),
    '商品説明': ('explanation', str), '敏感肌向け': ('sensitiveSkin', boolean),
    'オールインワン': ('allInOne', boolean), 'ふき取り': ('wipeOff', boolean),
    '落ちにくいメイク対応': ('waterproof', boolean),
    '洗顔料なしで提案': ('doubleCleanseNotNeeded', boolean),
    '洗顔の根拠メモ': ('cleansingGuidance', str),
    '1日使用回数（試算）': ('dailyUses', number), '1本の仮使用回数': ('demoUses', positive),
    '試算価格（円）': ('demoPrice', whole_number), '使用方法メモ': ('usage', str),
}
USAGE_FIELDS = {
    '1回量の目安': ('doseDescription', str), '使用量の出典URL': ('sourceUrl', https_url),
    '使用量の出典種別': ('sourceKind', str), '使用量の確認日': ('verifiedAt', date_string),
    '使い切り日数': ('durationDays', positive), '使い切り日数の基準回数／日': ('referenceDailyUses', positive),
    '個包装の回数': ('verifiedUses', positive_integer), '使用回数の根拠': ('referenceBasis', str),
    '使用回数の確認状況': ('usageCountStatus', str), '使用量メモ': ('note', str),
    '品目平均から除外': ('excludeFromCategoryAverages', boolean),
}
EVIDENCE_FIELDS = {
    '公式情報確認済み': ('officialSource', boolean),
    '公式情報の確認日': ('verifiedAt', date_string), '公式情報の確認メモ': ('sourceAccess', str),
    '有効成分': ('activeIngredients', ingredients), '配合濃度（JSON）': ('concentrations', concentrations),
    '敏感肌のパッチテスト確認済み': ('sensitiveSkinPatchTested', boolean),
}
PRICE_FIELDS = {
    '販売店': ('retailer', retailer_name), '税込価格（円）': ('priceJPY', whole_number),
    '価格の出典URL': ('url', https_url), '価格の確認日': ('verifiedAt', date_string),
    '価格の確認方法': ('verificationMethod', str),
}
SCORE_FIELDS = {heading: (key, score) for heading, key in CONCERNS.items()}
PRODUCT_COLUMNS = ('JAN', '掲載状態', *PRODUCT_FIELDS, *USAGE_FIELDS, *EVIDENCE_FIELDS)
PRICE_COLUMNS = ('JAN', *PRICE_FIELDS)
SCORE_COLUMNS = ('JAN', *SCORE_FIELDS, '採点メモ')


def table(folder, name, columns):
    path = folder / name
    with path.open(encoding='utf-8-sig', newline='') as file:
        reader = csv.DictReader(file, restval='', strict=True)
        headers = reader.fieldnames or []
        if len(headers) != len(columns) or set(headers) != set(columns):
            missing = '、'.join(sorted(set(columns) - set(headers)))
            unknown = '、'.join(sorted(set(headers) - set(columns)))
            raise ValueError(f'{name}: 列名が一致しません（不足 {missing or "なし"}／未定義 {unknown or "なし"}）')
        for row in reader:
            location = f'{name}:{reader.line_num}'
            if None in row:
                raise ValueError(f'{location}: 列数が多すぎます')
            if not any(value.strip() for value in row.values()):
                continue
            try:
                jan = jan_code(row['JAN'].strip())
            except ValueError as error:
                raise ValueError(f'{location}: {error}') from error
            yield jan, row, location


def read_fields(row, fields, location, required=()):
    result = {}
    for heading, (key, convert) in fields.items():
        raw = row[heading].strip()
        if not raw:
            if key in required:
                raise ValueError(f'{location}: {heading}が空欄です')
            continue
        try:
            result[key] = convert(raw)
        except (ValueError, TypeError, KeyError) as error:
            raise ValueError(f'{location}: {heading}の値 {raw!r} を読み取れません（{error}）') from error
    return result


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def matches_generated_data(path, data):
    try:
        current = read_json(path)
    except (FileNotFoundError, UnicodeError, json.JSONDecodeError):
        return False
    return json.dumps(current, sort_keys=True) == json.dumps(data, sort_keys=True)


def retailer_order(quote):
    retailer = quote['retailer']
    if retailer in RETAILER_PRIORITY:
        return RETAILER_PRIORITY.index(retailer), retailer
    return len(RETAILER_PRIORITY), retailer


def build_catalog(folder):
    metadata = read_json(folder / 'metadata.json')
    products, usages, retired = {}, {}, set()
    required = ('brand', 'name', 'category', 'volume', 'unit', 'sourceUrl', 'dailyUses')
    for jan, row, location in table(folder, 'products.csv', PRODUCT_COLUMNS):
        if jan in products:
            raise ValueError(f'{location}: JAN {jan} が商品マスター内で重複しています')
        status = row['掲載状態'].strip() or '掲載中'
        if status not in ('掲載中', '掲載終了'):
            raise ValueError(f'{location}: 掲載状態は「掲載中」か「掲載終了」です')
        if status == '掲載終了':
            retired.add(jan)
        product = {'jan': jan, **read_fields(row, PRODUCT_FIELDS, location, required)}
        product.setdefault('keyIngredients', [])
        evidence = read_fields(row, EVIDENCE_FIELDS, location)
        if evidence:
            product['evidence'] = evidence
        products[jan] = product

        usage = read_fields(row, USAGE_FIELDS, location)
        if usage:
            if 'sourceUrl' not in usage:
                raise ValueError(f'{location}: 使用量の出典URLが空欄です')
            if ('durationDays' in usage) != ('referenceDailyUses' in usage):
                raise ValueError(f'{location}: 使い切り日数と基準回数は一緒に入力してください')
            usages[jan] = {'doseDescription': None, **usage}
        count = usage.get('verifiedUses') or usage.get('durationDays', 0) * usage.get('referenceDailyUses', 0)
        if count:
            product.setdefault('demoUses', count)
        if 'demoUses' not in product:
            raise ValueError(f'{location}: 使用回数を出典から算出できない場合は1本の仮使用回数を入力してください')

    quotes = {}
    for jan, row, location in table(folder, 'prices.csv', PRICE_COLUMNS):
        if jan not in products:
            raise ValueError(f'{location}: JAN {jan} が商品マスターにありません')
        quote = {'jan': jan, **read_fields(row, PRICE_FIELDS, location, ('retailer', 'priceJPY', 'url', 'verifiedAt'))}
        url = urlsplit(quote['url'])
        if url.hostname == 'www.matsukiyococokara-online.com':
            match = re.fullmatch(r'/store/catalog/product/view/id/([0-9]{13})/?', url.path)
            if match and match[1] != jan:
                raise ValueError(f'{location}: JAN {jan} が価格ページのJAN {match[1]} と一致しません')
        by_retailer = quotes.setdefault(jan, {})
        if quote['retailer'] in by_retailer:
            raise ValueError(f'{location}: JAN {jan} と販売店の組み合わせが重複しています')
        by_retailer[quote['retailer']] = quote

    scores = {}
    for jan, row, location in table(folder, 'scores.csv', SCORE_COLUMNS):
        if jan not in products:
            raise ValueError(f'{location}: JAN {jan} が商品マスターにありません')
        if jan in scores:
            raise ValueError(f'{location}: JAN {jan} が肌悩み別点数表で重複しています')
        scores[jan] = read_fields(row, SCORE_FIELDS, location)

    active_products, archived_products, prices = [], [], {}
    for jan, product in products.items():
        quote = min(quotes.get(jan, {}).values(), key=retailer_order, default=None)
        if quote is not None:
            prices[jan] = quote
            product.setdefault('demoPrice', quote['priceJPY'])
        if 'demoPrice' not in product:
            raise ValueError(f'JAN {jan} の販売店価格または試算価格を入力してください')
        product['scores'] = scores.get(jan, {})
        (archived_products if jan in retired else active_products).append(product)

    product_db = {'meta': metadata['products'], 'products': active_products}
    if archived_products:
        product_db['archivedProducts'] = archived_products
    return {
        'products.json': product_db,
        'pricing.json': {'meta': metadata['pricing'], 'prices': prices},
        'usage.json': {'meta': metadata['usage'], 'usages': usages},
    }


def main():
    parser = argparse.ArgumentParser(description='JANで管理するCSVからアプリ用の商品データを生成')
    parser.add_argument('--check', action='store_true', help='公開用JSONと編集用CSVの一致を検証')
    args = parser.parse_args()
    try:
        data = build_catalog(ROOT / 'catalog')
        output_dir = ROOT / 'dist' / 'data'
        changes = {
            name: db for name, db in data.items()
            if not matches_generated_data(output_dir / name, db)
        }
        if args.check:
            if changes:
                files = '、'.join(changes)
                raise ValueError(f'{files} が編集用CSVと一致しません。npm run catalog:build を実行してください')
        elif changes:
            output_dir.mkdir(parents=True, exist_ok=True)
            with TemporaryDirectory(dir=output_dir) as temporary:
                for name, db in changes.items():
                    content = json.dumps(db, ensure_ascii=False, indent=2) + '\n'
                    (Path(temporary) / name).write_text(content, encoding='utf-8', newline='\n')
                for name in changes:
                    (Path(temporary) / name).replace(output_dir / name)
        catalog = data['products.json']
        print(f"商品DB: {len(catalog['products'])}品掲載、{len(catalog.get('archivedProducts', []))}品掲載終了")
    except (OSError, ValueError, csv.Error) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
