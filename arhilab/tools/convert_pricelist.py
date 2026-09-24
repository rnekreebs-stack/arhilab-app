"""Convert the approved Arhilab workbook into an importable JSON catalog.

Usage: python3 convert_pricelist.py source.xlsx output.json [existing-catalog.json]
Requires openpyxl on the conversion computer. No spreadsheet is modified.
"""
import hashlib
import json
import sys
from pathlib import Path
from openpyxl import load_workbook

TIERS = {'Эконом': 'economy', 'Стандарт': 'standard', 'Премиум': 'premium'}

def rows(sheet):
    return [r for r in list(sheet.values)[1:] if r and r[0] is not None]

def positive(value, label):
    result = float(value or 0)
    if not 0 <= result < 1e12:
        raise ValueError(f'Invalid {label}: {value}')
    return result

def convert(source, output, existing=None):
    book = load_workbook(source, read_only=True, data_only=True)
    for title in ('Мастер-прайс', 'База материалов', 'Комплектации'):
        if title not in book:
            raise ValueError(f'Missing worksheet: {title}')
    previous = json.loads(Path(existing).read_text(encoding='utf-8')) if existing else {'works': [], 'materials': []}
    old_works = {(w['category'], w['name']): w['id'] for w in previous['works']}
    old_materials = {m['name']: m['id'] for m in previous['materials']}
    materials, names = [], {}
    for r in rows(book['База материалов']):
        name = str(r[1] or '').strip()
        if not name or name in names:
            raise ValueError('Empty or duplicate SKU name: ' + name)
        cost = positive(r[4], name)
        item = {'id': old_materials.get(name, 'sku-' + hashlib.sha256(name.encode()).hexdigest()[:16]),
                'category': str(r[0]), 'name': name, 'store': str(r[2] or ''),
                'unit': str(r[3] or 'шт.'), 'cost': cost,
                'price': round(cost * 1.08 + 1e-8, 2),
                'source': str(r[8] or ''), 'note': str(r[9] or '')}
        names[name] = item
        materials.append(item)
    works, by_key = [], {}
    for r in rows(book['Мастер-прайс']):
        key, category, name = str(r[0]), str(r[1]), str(r[2])
        if key in by_key: raise ValueError('Duplicate work key: ' + key)
        item = {'id': old_works.get((category, name), 'work-' + hashlib.sha256(key.encode()).hexdigest()[:16]),
                'key': key, 'category': category, 'name': name, 'unit': str(r[3] or ''),
                'price': positive(r[4], name), 'cost': positive(r[5], name),
                'note': str(r[8] or ''), 'tiers': {}}
        by_key[key] = item; works.append(item)
    for r in rows(book['Комплектации']):
        key, tier = str(r[1]), TIERS.get(r[3])
        if key not in by_key or tier is None: raise ValueError('Unknown work or tier: ' + str(r[:4]))
        work = by_key[key]
        if tier in work['tiers']: raise ValueError('Duplicate tier: ' + key + ' ' + tier)
        product_names = [str(x).strip() for x in r[4:7] if x]
        if any(x not in names for x in product_names):
            raise ValueError('Unmatched material in ' + key + ': ' + str(product_names))
        cost = positive(r[7], key)
        if bool(product_names) != bool(cost):
            raise ValueError('Missing materials or price in ' + key + ' ' + tier)
        work['tiers'][tier] = {'materialIds': [names[x]['id'] for x in product_names],
                               'materialCost': cost, 'materialPrice': round(cost * 1.08 + 1e-8, 2),
                               'note': str(r[10] or '')}
    for work in works:
        if set(work['tiers']) != set(TIERS.values()):
            raise ValueError('Incomplete tier mapping: ' + work['key'])
        linked = [bool(work['tiers'][t]['materialIds']) for t in TIERS.values()]
        if len(set(linked)) != 1:
            raise ValueError('Some material tiers absent for ' + work['key'])
    data = {'format': 'ArhilabCatalog-2', 'sourceSha256': hashlib.sha256(Path(source).read_bytes()).hexdigest(),
            'works': works, 'materials': materials}
    Path(output).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    linked = sum(bool(w['tiers']['standard']['materialIds']) for w in works)
    print(f'{len(works)} works, {len(materials)} unique SKU, {linked} tiered works; '
          f'{len(works)-linked} require manual selection. Written: {output}')

if __name__ == '__main__':
    if len(sys.argv) not in (3,4): raise SystemExit(__doc__)
    convert(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv)==4 else None)
