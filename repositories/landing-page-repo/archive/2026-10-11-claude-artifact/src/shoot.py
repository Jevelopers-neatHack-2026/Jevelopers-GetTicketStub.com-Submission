import asyncio, sys, os, json, threading, http.server, functools
from playwright.async_api import async_playwright
SITE='/home/claude/ts/site'; TEST='/home/claude/ts/test'
OUT=sys.argv[1] if len(sys.argv)>1 else '/home/claude/ts/test/shots'
VW=int(os.environ.get('VW','1440')); VH=int(os.environ.get('VH','900')); PORT=os.environ.get('PORT','8765')
os.makedirs(OUT,exist_ok=True)
body=open(f'{SITE}/index.html').read()
WR=f'_w{PORT}.html'
open(f'{SITE}/{WR}','w').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'+body+'</body></html>')
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',int(PORT)),functools.partial(H,directory=SITE))
threading.Thread(target=srv.serve_forever,daemon=True).start()
MAP={'https://cdn.jsdelivr.net/npm/three@0.160.0/':f'{TEST}/node_modules/three/','https://cdn.jsdelivr.net/npm/lenis@1.1.13/':f'{TEST}/node_modules/lenis/'}
async def route(r):
    u=r.request.url
    for k,v in MAP.items():
        if u.startswith(k):
            return await r.fulfill(path=v+u[len(k):].split('?')[0], headers={'content-type':'application/javascript','access-control-allow-origin':'*'})
    if u.startswith('https://local.fonts/f/'):
        return await r.fulfill(path=f'{TEST}/f/'+u.split('/f/')[1], headers={'content-type':'font/woff2','access-control-allow-origin':'*'})
    if u.startswith('https://fonts.googleapis.com'):
        return await r.fulfill(path=f'{TEST}/fonts.css', headers={'content-type':'text/css'})
    if u.startswith('https://fonts.gstatic.com'): return await r.abort()
    return await r.continue_()
async def main():
    shots=json.loads(os.environ.get('SHOTS','[]'))
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg=await b.new_page(viewport={'width':VW,'height':VH}); pg.set_default_timeout(240000)
        logs=[]
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.route('**/*', route)
        await pg.goto(f"http://127.0.0.1:{PORT}/{WR}")
        try: await pg.wait_for_function("document.documentElement.classList.contains('ready')", timeout=90000)
        except Exception as e: logs.append('NOT READY '+str(e)[:100])
        await pg.wait_for_timeout(1500)
        for name, target in shots:
            js = """([sel,pr])=>{const el=document.querySelector(sel); const r=el.getBoundingClientRect(); const top=r.top+scrollY; const span=Math.max(0,r.height-innerHeight); return top+span*pr;}"""
            y = target if isinstance(target,(int,float)) else await pg.evaluate(js, target)
            await pg.evaluate(f"window.scrollTo(0,{y})")
            await pg.wait_for_timeout(int(os.environ.get('WAIT','1600')))
            if os.environ.get('EVAL'): logs.append('EVAL: '+str(await pg.evaluate(os.environ['EVAL'])))
            await pg.screenshot(path=f'{OUT}/{name}.jpg', type='jpeg', quality=80)
        print('\n'.join(logs[:40]))
        await b.close()
asyncio.run(main())
