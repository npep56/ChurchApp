import json, re, subprocess, csv, io, time, urllib.parse
src=open('../scripts/verify.py').read(); exec(src[:src.index('with ThreadPoolExecutor')].replace("merged = json.load(open('merged.json'))","merged = json.load(open('merged.json'))"))
ring=json.load(open('county.geojson'))['features'][0]['geometry']['coordinates'][0]
def inside(lat,lng):
    c=False;j=len(ring)-1
    for i in range(len(ring)):
        xi,yi=ring[i];xj,yj=ring[j]
        if (yi>lat)!=(yj>lat) and lng<(xj-xi)*(lat-yi)/(yj-yi)+xi: c=not c
        j=i
    return c
def census(addr):
    a=re.sub(r'^\D*?(?=\d)','',addr)  # drop junk before number
    a=re.sub(r'(?i)\b(?:US\s*)?(?:Hwy|Highway|GA-?)\s*(\d+)',r'GA Highway \1',a)
    out=subprocess.run(["curl","-sS","-m","30","-G","https://geocoding.geo.census.gov/geocoder/locations/onelineaddress","--data-urlencode","address="+a,"-d","benchmark=Public_AR_Current","-d","format=json"],capture_output=True,text=True).stdout
    try:
        m=json.loads(out)['result']['addressMatches']
        if m: return m[0]['coordinates']['y'],m[0]['coordinates']['x'],m[0]['matchedAddress']
    except Exception: pass
    return None
def nomi(q):
    u="https://nominatim.openstreetmap.org/search?"+urllib.parse.urlencode({"q":q,"format":"jsonv2","limit":1,"countrycodes":"us"})
    time.sleep(1.1)
    try:
        d=json.loads(subprocess.run(["curl","-sS","-m","30","-A","church-route-planner/1.0",u],capture_output=True,text=True).stdout)
        if d: return float(d[0]['lat']),float(d[0]['lon']),d[0]['display_name']
    except Exception: pass
    return None
recs=json.load(open('verified.json'))
by={r['idx']:r for r in recs}
# manual fixes from review
r33=by[33]; r168=by[168]
r33.update(website='https://www.newhopenewnan.com',website_verified=r168['website_verified'],site_addresses=r168['site_addresses'],website_found_by='domain check')
r33['sources']=sorted(set(r33['sources']+r168['sources'])); recs=[r for r in recs if r['idx']!=168]
by[29]['website']='https://www.cogua.com/newnan'
# PO box / ungeocoded directory churches -> try website guesses to find a street address
cd=json.load(open('cdir.json'))
extra=[]
for c in cd:
    if 'lat' in c: continue
    if c['city'].lower() in ('whitesburg','luthersville','palmetto'): continue
    nm=norm(c['name'])
    if any(norm(r['name'])==nm for r in recs): continue
    extra.append({'idx':1000+len(extra),'name':c['name'],'address':f"{c['street']}, {c['city']}, GA {c['zip']}",'city':c['city'],'phone':c['phone'],'denomination':c['denomination'],'website':'','sources':['christianity.com directory'],'cands':[]})
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(16) as ex: res=list(ex.map(work, extra))
for e,(i,r,fs) in zip(extra,res):
    e.pop('cands',None); e.pop('_area',None)
    e['website']=r['url'] if r else ''; e['website_verified']=r['level'] if r else ''; e['site_addresses']=r['site_addresses'] if r else []
    e['website_found_by']='domain check' if r else ''
    g=None
    if not e['address'].upper().startswith('PO BOX'): g=census(e['address'])
    for a in e['site_addresses']:
        if g: break
        g=census(a)
    if not g and not e['address'].upper().startswith('PO BOX'):
        g=nomi(f"{e['name']}, {e['city']}, Georgia") or nomi(e['address'])
    if g and not inside(g[0],g[1]): print('  outside county ->',e['name'],g); g=None
    if g:
        e['lat'],e['lng']=g[0],g[1]
        if e['address'].upper().startswith('PO BOX'): e['address']=g[2].title().replace(', Ga,',', GA')
    print('extra',e['name'],'|',e['address'],'|',e['website'],e['site_addresses'][:1],'|',g)
recs+= [e for e in extra if 'lat' in e]
# geocode site addresses; check county; update approximate addresses
for r in recs:
    r['site_in_county']=None
    for a in r.get('site_addresses',[]):
        g=census(a)
        if not g: continue
        ok=inside(g[0],g[1]); r['site_in_county']=ok
        d=dist(r['lat'],r['lng'],g[0],g[1])
        if ok and (r.get('address_approx') or r['address'].upper().startswith('PO BOX')):
            print(f"update {r['name']}: {r['address']} -> {g[2]} (moved {d:.1f} mi)")
            r['address']=g[2].title().replace(', Ga,',', GA'); r['lat'],r['lng']=g[0],g[1]; r['address_approx']=False
        if not ok: print('SITE ADDRESS OUTSIDE COUNTY:',r['name'],a,g)
        break
json.dump(recs,open('final.json','w'),indent=1)
print('final',len(recs),'websites',sum(1 for r in recs if r['website']))
