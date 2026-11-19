# 把童軍總會進程／專科章 PDF 文字轉成 CSV（類別,級別或章名,大項或分類,項目內容）
import re, sys, csv, os
SRC, OUT = sys.argv[1], sys.argv[2]  # SRC：放 kin/scout/scoutbadge/rover.raw.txt 的資料夾（pdftotext 產生）
CN = '一二三四五六七八九十百'
def lines(name):
    out = []
    for l in open(os.path.join(SRC, name + '.raw.txt'), encoding='utf-8'):
        l = l.strip().replace('　', ' ')
        if not l or re.fullmatch(r'\d{1,3}', l): continue
        out.append(l)
    return out
NEW = re.compile(r'^([壹貳參叁肆伍陸]、|（[壹貳參叁肆]）|[' + CN + r']+、|[（(][' + CN + r']+[)）]、?|\d+[.．、]|\(\d+\)\.?|[A-Ha-h]\.)')
def join(ls):
    """把 PDF 換行造成的斷行接回去：不是編號開頭的行接到上一行"""
    res = []
    for l in ls:
        if res and not NEW.match(l): res[-1] += l
        else: res.append(l)
    return [re.sub(r'\s+', ' ', x).strip() for x in res]
def strip_mark(s): return NEW.sub('', s, count=1).strip()
rows = []; levels = []; SECNOW = ['']
def add(cat, unit, sec, text): rows.append([cat, unit, sec, text.strip(), SECNOW[0]])

# ── 稚齡：進程 ──
SECNOW[0] = '稚齡'
L = join(lines('kin'))
i = next(k for k, x in enumerate(L) if x.startswith('一、地球'))
j = next(k for k, x in enumerate(L) if '技能章合格標準' in x and k > i)
cur = None; desc = []
for x in L[i:j]:
    m = re.match(r'^[一二三四]、(地球|星星|月亮|太陽)：?(.*)', x)
    if m: cur = m.group(1); levels.append(['稚齡', cur, '進程', '', m.group(2)]); continue
    if x.startswith('進程內容'): continue
    if re.match(r'^\d+[.．]', x): add('進程', cur, '－', strip_mark(x))
    else: levels[-1][4] += x
# ── 稚齡：技能章 ──
cat = None; badge = None
for x in L[j:]:
    m = re.match(r'^[一二三]、(.+類)', x)
    if m: cat = m.group(1); continue
    m = re.match(r'^[（(][' + CN + r']+[)）](.+)', x)
    if m and cat:
        t = m.group(1); nm, _, rest = t.partition('：')
        badge = nm.strip(); levels.append(['稚齡', badge, '技能章', cat, ''])
        if rest.strip(): add('技能章', badge, cat, rest)
        continue
    if re.match(r'^\d+[.．]', x) and badge: add('技能章', badge, cat, strip_mark(x))
# ── 童軍、行義：進程 ──
SECNOW[0] = '童軍、行義'
L = join(lines('scout'))
LV = {'初級童軍': '初級', '中級童軍': '中級', '高級童軍': '高級', '獅級童軍': '獅級', '長城級童軍': '長城', '國花級童軍': '國花'}
cur = None; sec = '－'; sub = None; inlist = False; mode = None
for k, x in enumerate(L):
    m = re.match(r'^[壹貳參叁肆伍陸]、(\S+?童軍)：?(.*)$', x)
    if m and m.group(1) in LV:
        cur = LV[m.group(1)]; levels.append(['童軍、行義', cur, '進程', '', m.group(2)]); mode = 'desc'; sec = '－'; sub = None; continue
    if not cur: continue
    if mode == 'desc':
        if not re.match(r'^[' + CN + r']+、', x):
            levels[-1][4] += x; continue
        mode = 'items'; levels[-1][4] = re.sub(r'\S{2,4}童軍合格標準如下：?$', '', levels[-1][4])
    m = re.match(r'^[' + CN + r']+、(.*)', x)
    if m:
        t = m.group(1)
        if len(t) <= 8 and t.endswith('方面'): sec = t; sub = None; continue
        add('進程', cur, '－', t); sub = 'lv'; continue   # 獅級以上：一、二、就是項目
    m = re.match(r'^[（(][' + CN + r']+[)）](.*)', x)
    if m:
        t = m.group(1)
        if sub == 'lv': rows[-1][3] += ' ' + t; continue
        nxt = L[k + 1] if k + 1 < len(L) else ''
        if len(t) <= 10 and not re.match(r'^(能|會|知道|明瞭|了解|瞭解|曾|具)', t) and not t.endswith('。'):
            sub = t; inlist = False; continue                # 小標題（如「記號」）
        add('進程', cur, sec, t); sub = None; inlist = '下列' in t; continue
    if re.match(r'^\d+[.．、]', x):
        t = strip_mark(x)
        if sub == 'lv' or inlist: rows[-1][3] += ' ' + x; continue
        add('進程', cur, sub or sec, t); continue
    # 小標題下的說明句（後面的 1. 2. 是選項，併入同一項）
    if sub and sub != 'lv': add('進程', cur, sub, x); inlist = True
# ── 童軍、行義：專科章 ──
L = join(lines('scoutbadge'))
cat = None; badge = None
for x in L:
    m = re.match(r'^（[壹貳參叁肆]）(.+類)', x)
    if m: cat = m.group(1); continue
    m = re.match(r'^[' + CN + r']+、(.+)', x)
    if m and cat: badge = m.group(1).strip(); levels.append(['童軍、行義', badge, '專科章', cat, '']); continue
    if not badge: continue
    m = re.match(r'^[（(][' + CN + r']+[)）](.*)', x)
    if m: add('專科章', badge, cat, m.group(1)); continue
    if rows and rows[-1][1] == badge: rows[-1][3] += ' ' + x
# ── 羅浮：進程 ──
SECNOW[0] = '羅浮'
L = join(lines('rover'))
i = next(k for k, x in enumerate(L) if x.startswith('八、羅浮童軍之進程'))
j = next(k for k, x in enumerate(L) if x.startswith('九、徽章'))
cur = None; path = None
for x in L[i + 1:j]:
    m = re.match(r'^（[一二三]）、?\s*(見習羅浮|授銜羅浮|服務羅浮)', x)
    if m: cur = m.group(1); levels.append(['羅浮', cur, '進程', '', '']); path = None; continue
    m = re.match(r'^(\d)、\s*(.*)', x)
    if m:
        t = m.group(2)
        if cur == '見習羅浮': path = '途徑' + m.group(1); levels[-1][4] += '【' + path + '】' + t
        elif t.startswith('進程'): path = None
        else: levels[-1][4] += t
        continue
    m = re.match(r'^\((\d)\)\.?\s*(.*)', x)
    if m:
        t = m.group(2); head, _, rest = t.partition('：')
        if cur == '服務羅浮' and head in ('基本要求', '主題活動'): path = head; continue
        add('進程', cur, path or '－', t); continue
    if re.match(r'^[A-H]\.', x) and cur == '服務羅浮' and path:
        add('進程', cur, path, strip_mark(x)); continue
    if rows and rows[-1][1] == cur: rows[-1][3] += ' ' + x
os.makedirs(OUT, exist_ok=True)
SEC = {'稚齡': '稚齡', '童軍、行義': '童軍行義', '羅浮': '羅浮'}
def owner(r): return r[4]
for s, f in SEC.items():
    with open(os.path.join(OUT, f + '.csv'), 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh); w.writerow(['類別', '級別或章名', '大項或分類', '項目內容'])
        for r in rows:
            if owner(r) == s: w.writerow(r[:4])
with open(os.path.join(OUT, 'levels.csv'), 'w', encoding='utf-8', newline='') as fh:
    w = csv.writer(fh); w.writerow(['分團', '名稱', '類別', '分類', '晉級條件'])
    for r in levels: w.writerow([r[0], r[1], r[2], r[3], re.sub(r'\s+', '', r[4])])
from collections import Counter
c = Counter((owner(r), r[0]) for r in rows); print(c)
print('levels', Counter((l[0], l[2]) for l in levels))
