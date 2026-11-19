import json, re, subprocess
src=open('../scripts/verify.py').read(); exec(src[:src.index('# --- dedupe')]); exec(src[src.index('UA="Mozilla'):src.index('def work(r):')])
ring=json.load(open('county.geojson'))['features'][0]['geometry']['coordinates'][0]
def inside(lat,lng):
    c=False;j=len(ring)-1
    for i in range(len(ring)):
        xi,yi=ring[i];xj,yj=ring[j]
        if (yi>lat)!=(yj>lat) and lng<(xj-xi)*(lat-yi)/(yj-yi)+xi: c=not c
        j=i
    return c
def census(a):
    a=re.sub(r'^\D*?(?=\d{1,5}\s+[A-Za-z])','',a); a=re.sub(r'(?i)\b(?:Hwy|Highway)\s*(\d+)',r'Highway \1',a)
    out=subprocess.run(["curl","-sS","-m","30","-G","https://geocoding.geo.census.gov/geocoder/locations/onelineaddress","--data-urlencode","address="+a,"-d","benchmark=Public_AR_Current","-d","format=json"],capture_output=True,text=True).stdout
    try:
        m=json.loads(out)['result']['addressMatches']; return (m[0]['coordinates']['y'],m[0]['coordinates']['x'],m[0]['matchedAddress']) if m else None
    except Exception: return None
P='/home/user/ChurchApp/public/churches.json'
data=json.load(open(P)); by={r['church_id']:r for r in data}
found={int(k):v for k,v in json.load(open('pass2.json')).items()}
# search-found candidates
for line in open('cand2.tsv'):
    cid,u=line.strip().split('\t'); cid=int(cid)
    if cid in found and found[cid]['level']=='address': continue
    try: res=check(by[cid],u)
    except Exception: res=None
    if res and (cid not in found or res['level']=='address'): found[cid]=dict(res,by='search')
for cid,v in found.items(): v.setdefault('by','domain check')
# address fixes found via search
for line in open('addr2.tsv'):
    cid,a=line.strip().split('\t'); r=by[int(cid)]; g=census(a)
    if g and inside(g[0],g[1]):
        print(f"ADDR {r['name']}: {r['address']} -> {g[2]}"); r['address']=g[2].title().replace(', Ga,',', GA'); r['lat'],r['lng']=g[0],g[1]; r['address_approx']=False; r['location_note']=''
    else: print('ADDR FAIL',r['name'],a,g)
def street_key(a):
    m=re.match(r'\D{0,40}?(\d{1,5})\s+(.*)',a)
    if not m: return None
    w=[x for x in toks(m.group(2)) if x not in ('n','s','e','w','north','south','east','west','st','street','rd','road','dr','drive','ave','hwy','highway','ga','us','state','rte','route','blvd','pkwy','parkway','ln','lane','trl','trail')]
    return m.group(1), (w[0] if w else '')
for cid,res in sorted(found.items()):
    r=by[cid]; sa=res.get('site_addresses') or []
    rk=street_key(r['address']) if not r.get('address_approx') and not r['address'].upper().startswith('PO') else None
    sk=street_key(sa[0]) if sa else None
    verdict='accept'
    if res['level']=='area' and rk and sk and rk[0]!=sk[0]: verdict='reject: site shows different street address'
    g=None
    if verdict=='accept' and sa and (r.get('address_approx') or res['level']=='area'):
        g=census(sa[0])
        if g:
            d=dist(r['lat'],r['lng'],g[0],g[1])
            if not inside(g[0],g[1]): verdict='reject: site address outside county'
            elif r.get('address_approx') and d>3: verdict=f'reject: site address {d:.1f} mi from pin'
    print(f"{cid:3} {r['name'][:38]:38} {res['level']:7} {res['url'][:45]:45} {verdict}  site={sa[:1]}")
    if verdict!='accept': continue
    r['website']=res['url']; r['website_verified']=res['level']
    r['website_check']={'address':"website shows this church's street address",'area':'website names this church and a Coweta County town/ZIP'}[res['level']]
    if g and r.get('address_approx'):
        r['address']=g[2].title().replace(', Ga,',', GA'); r['lat'],r['lng']=g[0],g[1]; r['address_approx']=False; r['location_note']=''
        print('     address updated from website ->',r['address'])
# directory-listed, site blocks automated check
r=by[117]; r['website']='https://www.smmcatholic.org'; r['website_verified']='listed'; r['website_check']='listed for this parish by several Catholic directories (site blocks automated checks)'
# dedupe: same normalized name, and same website or within 1.5 mi
keep=[]
for r in data:
    d=next((k for k in keep if norm(k['name'])==norm(r['name']) and ((k['website'] and k['website']==r['website']) or dist(k['lat'],k['lng'],r['lat'],r['lng'])<1.5)),None)
    if not d: d=next((k for k in keep if k['website'] and k['website']==r['website'] and dist(k['lat'],k['lng'],r['lat'],r['lng'])<2),None)
    if d:
        print('MERGE',r['church_id'],r['name'],r['address'],'into',d['church_id'],d['name'],d['address'])
        if d.get('address_approx') and not r.get('address_approx'): d.update({k:r[k] for k in ('address','lat','lng','address_approx')})
        if not d['website'] and r['website']: d.update({k:r[k] for k in ('website','website_verified','website_check')})
        d['source']=d['source'] if r['source'] in d['source'] else d['source']+'; '+r['source']
        continue
    keep.append(r)
for i,r in enumerate(keep,1): r['church_id']=i
json.dump(keep,open(P,'w'),indent=1,ensure_ascii=False)
from collections import Counter
print('total',len(keep),'websites',sum(1 for r in keep if r['website']),Counter(r['website_verified'] for r in keep),'approx',sum(1 for r in keep if r.get('address_approx')))
