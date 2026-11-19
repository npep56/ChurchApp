import re, json, subprocess, html, csv, io
UA="Mozilla/5.0 (X11; Linux x86_64) Chrome/124"
get=lambda u: subprocess.run(["curl","-sSL","-m","30","-A",UA,u],capture_output=True,text=True).stdout
rows={}
for city in ["newnan","senoia","sharpsburg","grantville","moreland","turin","haralson","palmetto","sargent","whitesburg","luthersville"]:
    s=get(f"https://www.christianity.com/church-directory/georgia/{city}")
    for href,name,body in re.findall(r'<a href="(/church-directory/[a-z0-9-]+-\d+)" class="font-bold text-xl">(.*?)</a>(.*?)(?=<a href="/church-directory/[a-z0-9-]+-\d+" class="font-bold text-xl">|$)',s,re.S):
        a=re.search(r'<div class="leading-none">(.*?)</div>\s*<div class="mt-1">(.*?)</div>',body,re.S)
        ph=re.search(r'href="tel:([^"]+)"',body)
        den=re.findall(r'</svg>\s*<div>\s*([^<]{3,60}?)\s*</div>',body)
        if not a: continue
        m=re.match(r'(.*?),\s*GA,\s*(\d{5})',html.unescape(a.group(2).strip()))
        rows[href]={"key":href.split('-')[-1],"name":html.unescape(name.strip()),"street":html.unescape(a.group(1).strip()),
          "city":m.group(1) if m else "","zip":m.group(2) if m else "","phone":ph.group(1) if ph else "","denomination":den[0] if den else ""}
rows=list(rows.values())
# Census batch geocode
buf=io.StringIO(); w=csv.writer(buf)
for r in rows: w.writerow([r["key"],r["street"],r["city"],"GA",r["zip"]])
open("batch.csv","w").write(buf.getvalue())
res=subprocess.run(["curl","-sS","-m","300","-F","addressFile=@batch.csv","-F","benchmark=Public_AR_Current","https://geocoding.geo.census.gov/geocoder/locations/addressbatch"],capture_output=True,text=True).stdout
geo={}
for line in csv.reader(io.StringIO(res)):
    if len(line)>=6 and line[2]=="Match":
        lng,lat=map(float,line[5].split(",")); geo[line[0]]=(lat,lng,line[4])
for r in rows:
    g=geo.get(r["key"])
    if g: r["lat"],r["lng"],r["matched"]=g
json.dump(rows,open("cdir.json","w"),indent=1)
print("rows",len(rows),"geocoded",len(geo))
