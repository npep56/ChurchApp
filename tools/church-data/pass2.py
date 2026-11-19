# Second pass: wider domain guesses for churches still without a verified website.
import json, re, sys
src=open('../scripts/verify.py').read(); exec(src[:src.index('# --- dedupe')]); exec(src[src.index('UA="Mozilla'):src.index('def work(r):')])
from concurrent.futures import ThreadPoolExecutor
data=json.load(open('/home/user/ChurchApp/public/churches.json'))
ABBR={'baptist':'b','church':'c','methodist':'m','united':'u','first':'f','community':'c','christian':'c','fellowship':'f','presbyterian':'p','lutheran':'l','missionary':'m','assembly':'a','god':'g','of':'o'}
def guesses2(r):
    t=[x for x in toks(r['name']) if x not in ('the','inc','and')]
    t=['mt' if x=='mount' else 'st' if x=='saint' else x for x in t]
    city=r['city'].lower().replace(' ','')
    core=[x for x in t if x not in ('church','baptist','methodist','united','umc','of','ame','cme','missionary')]
    c=''.join(core); full=''.join(t); noch=''.join(x for x in t if x!='church')
    init=''.join(x[0] for x in t if x not in ('of',))
    out=[full,noch,'the'+noch,'the'+full,noch+'ga',full+'ga',noch+city,full+city,noch+'church',c+'church',c+'church'+city,c+city,c+'ga',
         init+city, init+'ga', init+'online', '-'.join(t), '-'.join(x for x in t if x!='church')]
    if 'mt' in t: out+=[x.replace('mt','mount') for x in out[:6]]
    if 'baptist' in t: out+=[c+'baptist',c+'baptistchurch',c+'baptistga',c+'bc',c+'bcga',c+'bc'+city,c+'baptist'+city]
    if 'methodist' in t or 'umc' in t: out+=[c+'umc',c+'umc'+city,c+'umcga',c+'methodist',c+'unitedmethodist']
    if 'ame' in t: out+=[c+'ame',c+'amechurch',c+'ame'+city]
    seen=[]; [seen.append(o) for o in out if o and len(o)>4 and o not in seen]
    return [f"https://{d}.{tld}" for d in seen for tld in ('org','com','net','church')]
todo=[r for r in data if not r['website'] and not re.fullmatch(r'(?i)(holiness church|pentecostal church of god|trinity church|new hope church|emanuel church|west side church|harmony church|eastwood church|go church)',r['name'])]
print('checking',len(todo),'churches', sum(len(guesses2(r)) for r in todo),'urls',flush=True)
def quick_alive(u):
    p=subprocess.run(["curl","-sS","-o","/dev/null","-m","6","-L","-A",UA,"-w","%{http_code}",u],capture_output=True,text=True)
    return p.stdout.strip() not in ('','000') and int(p.stdout.strip() or 0)<400
def work2(r):
    for u in guesses2(r):
        if not quick_alive(u): continue
        try: res=check(r,u)
        except Exception: res=None
        if res: return r['church_id'],res,u
    return r['church_id'],None,None
found={}
with ThreadPoolExecutor(32) as ex:
    for cid,res,u in ex.map(work2,todo):
        if res: found[cid]=res; print('FOUND',cid,next(r['name'] for r in data if r['church_id']==cid),'|',res['level'],res['url'],res['site_addresses'][:1],flush=True)
json.dump(found,open('pass2.json','w'),indent=1)
print('found',len(found))
