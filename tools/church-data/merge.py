import json, re, math, subprocess, time, urllib.parse
ring=json.load(open('county.geojson'))['features'][0]['geometry']['coordinates'][0]
def inside(lat,lng):
    c=False;j=len(ring)-1
    for i in range(len(ring)):
        xi,yi=ring[i];xj,yj=ring[j]
        if (yi>lat)!=(yj>lat) and lng<(xj-xi)*(lat-yi)/(yj-yi)+xi: c=not c
        j=i
    return c
def dist(a,b,c,d):
    R=3958.8;p=math.pi/180
    h=math.sin((c-a)*p/2)**2+math.cos(a*p)*math.cos(c*p)*math.sin((d-b)*p/2)**2
    return 2*R*math.asin(math.sqrt(h))
STOP={'church','of','the','and','inc','ministries','ministry','fellowship','international','ga','newnan','umc','united','methodist','baptist','first','st','saint','christ','god','in','at'}
def toks(n): return set(re.findall(r'[a-z0-9]+',n.lower().replace('&',' ')))
def sim(a,b):
    A,B=toks(a),toks(b)
    if not A or not B: return 0
    core=len((A-STOP)&(B-STOP)); full=len(A&B)/len(A|B)
    return full + (0.3 if core else 0)
cd=json.load(open('cdir.json')); osm=json.load(open('inside.json'))
UA="church-route-planner/1.0 (personal route planning)"
for r in cd:
    if 'lat' in r: continue
    for q in [f"{r['street']}, {r['city']}, GA {r['zip']}", f"{r['name']}, {r['city']}, GA"]:
        u="https://nominatim.openstreetmap.org/search?"+urllib.parse.urlencode({"q":q,"format":"jsonv2","limit":1,"countrycodes":"us"})
        d=json.loads(subprocess.run(["curl","-sS","-m","30","-A",UA,u],capture_output=True,text=True).stdout or "[]"); time.sleep(1.1)
        if d: r['lat'],r['lng']=float(d[0]['lat']),float(d[0]['lon']); r['geo_src']='nominatim'; break
final=[]; used=set(); dropped=[]; nogeo=[]
for r in cd:
    if 'lat' not in r: nogeo.append(r); continue
    if not inside(r['lat'],r['lng']): dropped.append(f"{r['name']} ({r['street']}, {r['city']})"); continue
    best=None
    for i,o in enumerate(osm):
        if i in used or not o['name']: continue
        d=dist(r['lat'],r['lng'],o['lat'],o['lng']); s=sim(r['name'],o['name'])
        if (s>=0.5 and d<1.5) or (s>=0.3 and d<0.4) or (d<0.08 and s>0):
            if not best or s-d/5>best[0]: best=(s-d/5,i)
    rec={'name':r['name'],'address':f"{r['street']}, {r['city']}, GA {r['zip']}",'city':r['city'],'lat':r['lat'],'lng':r['lng'],
         'phone':r['phone'],'denomination':r['denomination'],'website':'','sources':['christianity.com directory']}
    if best:
        o=osm[best[1]]; used.add(best[1])
        rec['lat'],rec['lng']=o['lat'],o['lng']; rec['sources'].append('OpenStreetMap '+o['osm'])
        if o['website']: rec['website']=o['website']
        rec['osm_name']=o['name']
    final.append(rec)
for i,o in enumerate(osm):
    if i in used or not o['name']: continue
    street=' '.join(x for x in [o['house'],o['road']] if x)
    city=o['city'] or 'Newnan'
    final.append({'name':o['name'],'address':', '.join(x for x in [street,city+', GA'+(' '+o['zip'] if o['zip'] else '')] if x),'city':city,
      'lat':o['lat'],'lng':o['lng'],'phone':'','denomination':o['denomination'],'website':o['website'],'sources':['OpenStreetMap '+o['osm']],'address_approx':not o['house']})
json.dump(final,open('merged.json','w'),indent=1)
print('final',len(final),'| dir inside',sum(1 for f in final if 'christianity.com directory' in f['sources']),'| matched both',len(used),'| osm-only',len(final)-len([f for f in final if 'christianity.com directory' in f['sources']]))
print('dropped outside county:',len(dropped)); [print('  ',x) for x in dropped]
print('no geocode:',[(r['name'],r['street']) for r in nogeo])
