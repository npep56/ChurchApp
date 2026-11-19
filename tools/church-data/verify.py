# Find + verify church websites. A site is accepted only if its pages name the church AND
# show a Coweta County location (matching street address = "address", else Coweta town/ZIP = "area").
import json, re, math, subprocess, sys, html as H
from concurrent.futures import ThreadPoolExecutor
merged = json.load(open('merged.json'))
cand_raw = [l.rstrip('\n').split('\t') for l in open('cand.tsv') if l.strip()]
COWETA_TOWNS = ['newnan','senoia','sharpsburg','grantville','moreland','turin','haralson','sargent','roscoe','raymond','madras','handy','corinth','coweta']
COWETA_ZIPS = ['30263','30264','30265','30271','30275','30276','30277','30220','30229','30259','30289']
GENERIC = {'church','of','the','and','inc','ministries','ministry','fellowship','international','intl','baptist','methodist','united','first','umc','ame','cme','christian','christ','god','in','at','community','chapel','st','saint','mt','mount','new','missionary','memorial','center','worship','life','holiness','presbyterian','lutheran','episcopal','catholic','assembly','full','gospel','temple','tabernacle','church-','a'}
def dist(a,b,c,d):
    p=math.pi/180;h=math.sin((c-a)*p/2)**2+math.cos(a*p)*math.cos(c*p)*math.sin((d-b)*p/2)**2
    return 7917.6*math.asin(math.sqrt(h))
def toks(n): return re.findall(r'[a-z0-9]+', n.lower().replace('&',' and ').replace("'", ''))
def norm(n): return ' '.join(t for t in toks(n) if t not in ('church','inc','the'))
# --- dedupe
recs=[]
for i,m in enumerate(merged):
    m['idx']=i
    dup=next((r for r in recs if norm(r['name'])==norm(m['name']) and dist(r['lat'],r['lng'],m['lat'],m['lng'])<0.8), None)
    if dup:
        dup.setdefault('dups',[]).append(i); dup['sources']=sorted(set(dup['sources']+m['sources']))
        if not dup['website'] and m['website']: dup['website']=m['website']
        continue
    recs.append(m)
byidx={}
for r in recs:
    byidx[r['idx']]=r
    for d in r.get('dups',[]): byidx[d]=r
for r in recs: r['cands']=[r['website']] if r['website'] else []
for i,u in cand_raw:
    r=byidx[int(i)]
    if u not in r['cands']: r['cands'].append(u)
# --- domain guesses
def guesses(r):
    t=[x for x in toks(r['name']) if x not in ('the','inc')]
    t=['mt' if x=='mount' else 'st' if x=='saint' else x for x in t]
    city=(r.get('city') or 'newnan').lower().replace(' ','')
    full=''.join(t); noch=''.join(x for x in t if x!='church')
    out=[full, noch, noch+city, full+city, noch+'ga', city+noch]
    s=' '.join(t)
    if 'first baptist' in s: out+=['fbc'+city, 'firstbaptist'+city, 'fbc'+city+'ga']
    if 'united methodist' in s:
        core=''.join(x for x in t if x not in ('united','methodist','church'))
        out+=[core+'umc', core+'umc'+city, core+'methodist', city+core+'umc' if core!=city else city+'umc', 'first'+city+'umc' if 'first' in s else core+'unitedmethodist']
    if 'baptist' in s and 'first' not in s:
        core=''.join(x for x in t if x not in ('baptist','church'))
        out+=[core+'baptist', core+'baptistchurch', core+'bc', core+'baptist'+city]
    if 'methodist' in s and 'united' not in s:
        core=''.join(x for x in t if x not in ('methodist','church'))
        out+=[core+'umc', core+'methodist']
    seen=[];[seen.append(o) for o in out if o and len(o)>4 and o not in seen]
    return [f"https://{d}.{tld}" for d in seen[:12] for tld in ('org','com')]
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
def fetch(u, t=12):
    p=subprocess.run(["curl","-sSL","-m",str(t),"--max-filesize","3000000","-A",UA,"-w","\n__FINAL__%{url_effective} %{http_code}",u],capture_output=True)
    out=p.stdout.decode('utf-8','ignore'); m=re.search(r'\n__FINAL__(\S+) (\d+)$',out)
    if not m: return None,None,0
    return out[:m.start()], m.group(1), int(m.group(2))
def text(h):
    h=re.sub(r'(?is)<(script|style|noscript)[^>]*>.*?</\1>',' ',h); h=re.sub(r'(?s)<[^>]+>',' ',h)
    return re.sub(r'\s+',' ',H.unescape(h))
BAD_HOSTS=('facebook.com','sermonaudio.com','google.com','churcheslist','christianity.com','faithstreet','mapquest','yelp')
def check(r, url):
    body,final,code=fetch(url)
    if not body or code>=400: return None
    host=re.sub(r'^https?://(www\.)?','',final).split('/')[0].lower()
    if any(p in host for p in ('godaddy','sedo','afternic','hugedomains','dan.com','parking','bodis')): return None
    pages=[body]
    for href in re.findall(r'href=["\']([^"\'#]+)["\']',body):
        if re.search(r'(?i)contact|about|visit|location|direction|find-us|new-here|im-new|plan', href) and len(pages)<4:
            full=href if href.startswith('http') else re.sub(r'(https?://[^/]+).*',r'\1',final)+'/'+href.lstrip('/')
            if host in full:
                b,_,c=fetch(full,10)
                if b and c<400: pages.append(b)
    tx=text(' '.join(pages)).lower(); tx2=re.sub(r'[^a-z0-9 ]',' ',tx)
    title=re.search(r'(?is)<title[^>]*>(.*?)</title>',body); title=text(title.group(1)) if title else ''
    distinct=[x for x in toks(r['name']) if x not in GENERIC]
    nm_tokens=[x for x in toks(r['name']) if x not in ('the','inc','of','and')]
    name_ok = all(re.search(r'\b'+re.escape(x)+r'\b',tx2) for x in (distinct or nm_tokens))
    if not distinct:  # generic name like "First Baptist Church": need full phrase
        name_ok = (' '.join(nm_tokens) in tx2)
    if not name_ok: return None
    level=None
    m=re.match(r'(\d+)\s+(.*?),',r['address'])
    if m:
        num=m.group(1); words=[w for w in toks(m.group(2)) if w not in ('n','s','e','w','st','rd','dr','ave','hwy','highway','road','street','drive','ln','blvd','pkwy','trl','ste') and not w.isdigit()]
        if words and re.search(r'\b'+num+r'\s+(?:[a-z.]+\s+){0,3}?'+re.escape(words[0]), tx2): level='address'
    zips=[z for z in COWETA_ZIPS if z in tx2]
    towns=[t for t in COWETA_TOWNS if re.search(r'\b'+t+r'\b',tx2)]
    if not level and (zips or (towns and re.search(r'\b(ga|georgia)\b',tx2))): level='area'
    if not level: return None
    addrs=re.findall(r'(\d{1,5}\s+[A-Za-z0-9 .\'-]{3,45}?,?\s+(?:'+'|'.join(t.title() for t in COWETA_TOWNS)+r')\s*,?\s+(?:GA|Georgia)\.?\s*(?:3\d{4})?)', text(' '.join(pages)))
    root=re.sub(r'(https?://[^/]+).*',r'\1',final)
    if any(b in host for b in BAD_HOSTS): root=final
    return {'url':root if host not in ('sites.google.com',) and 'snappages' not in host else final,'level':level,'site_addresses':list(dict.fromkeys(a.strip() for a in addrs))[:3],'title':title[:80]}
def work(r):
    tried=[]
    for u in r['cands'] + guesses(r):
        if u in tried: continue
        tried.append(u)
        try: res=check(r,u)
        except Exception: res=None
        if res and (res['level']=='address' or u in r['cands']): return r['idx'],res,u in r['cands']
        if res and res['level']=='area': r.setdefault('_area',res)
    return r['idx'], r.get('_area'), False
with ThreadPoolExecutor(24) as ex:
    results={i:(res,fromsearch) for i,res,fromsearch in ex.map(work, recs)}
for r in recs:
    res,fs=results[r['idx']]
    r.pop('cands',None); r.pop('_area',None)
    r['website']=res['url'] if res else ''
    r['website_verified']=res['level'] if res else ''
    r['site_addresses']=res['site_addresses'] if res else []
    r['website_found_by']=('search/OSM' if fs else 'domain check') if res else ''
json.dump(recs,open('verified.json','w'),indent=1)
print('records',len(recs),'websites',sum(1 for r in recs if r['website']),'address-level',sum(1 for r in recs if r['website_verified']=='address'))
for r in recs:
    if r['website']: print(f"{r['idx']:3} {r['website_verified']:7} {r['name'][:40]:40} {r['website']}  {r['site_addresses'][:1]}")
