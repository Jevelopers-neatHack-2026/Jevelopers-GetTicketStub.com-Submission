#!/usr/bin/env python3
"""Rebuild editable submission diagrams from the reviewed local artwork."""
from pathlib import Path
import base64
from html import escape

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'docs/assets/submission'
CREAM, INK, MOSS, ORANGE = '#F4ECDD', '#17140F', '#26302A', '#E4572E'


def svg(title, width, height, body, dark=False):
    bg, fg = (INK, CREAM) if dark else (CREAM, INK)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title">
<title id="title">{escape(title)}</title>
<rect width="{width}" height="{height}" rx="20" fill="{bg}"/>
<style>text{{font-family:'Inter Tight',Arial,sans-serif;fill:{fg}}}.title{{font-family:Fraunces,Georgia,serif;font-size:34px;font-weight:600}}.label{{font-size:28px;font-weight:600}}.note{{font-size:20px}}</style>
<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="{fg}"/></marker></defs>
{body}</svg>\n'''


def text(x, y, value, cls='note', **attrs):
    extra=' '.join(f'{k}="{v}"' for k,v in attrs.items())
    return f'<text x="{x}" y="{y}" class="{cls}" {extra}>{escape(value)}</text>'


def main():
    encoded=base64.b64encode((ASSETS/'journey-art.jpg').read_bytes()).decode()
    body=f'<defs><image id="art" width="1254" height="1254" xlink:href="data:image/jpeg;base64,{encoded}"/></defs>'
    body+=text(30,52,'From an event to a keepsake','title')
    steps=[('Add an event','A link, or a sample.',0,0),('Check its story','Review and correct facts.',627,0),('Style the artwork','Choose what feels right.',0,627),('Keep your stub','Download the image.',627,627)]
    for i,(label,note,cx,cy) in enumerate(steps):
        y=85+i*192
        body+=f'<svg x="24" y="{y}" width="170" height="170" viewBox="{cx} {cy} 627 627"><use xlink:href="#art"/></svg>'
        body+=text(216,y+53,f'0{i+1}','note')+text(216,y+96,label,'label')+text(216,y+131,note)
        if i<3:body+=f'<path d="M224 {y+150}v30" stroke="{INK}" stroke-width="2" marker-end="url(#arrow)"/>'
    body+=text(30,888,'Illustrated flow · Demo facts and art are samples.')
    (ASSETS/'journey.svg').write_text(svg('Add an event, check its story, style the artwork, keep your stub. Demo uses samples.',640,925,body))
    for dark in (False,True):
        fg=CREAM if dark else INK; card=MOSS if dark else '#FFF9EF'
        body=text(30,52,'Inside the customer app','title')
        items=[('Event input','A public link or a sample.'),('Studio','Check facts and choose a style.'),('Server routes','Handle research, art, and replies.'),('Pages + model providers','Live mode only; samples in the demo.'),('Digital keepsake','Return to the studio to save or download.')]
        for i,(label,note) in enumerate(items):
            y=85+i*140
            body+=f'<rect x="30" y="{y}" width="620" height="100" rx="14" fill="{card}" stroke="{fg}" stroke-opacity=".2"/>'
            body+=text(52,y+39,label,'label')+text(52,y+73,note)
            if i<4:body+=f'<path d="M340 {y+105}v27" stroke="{fg}" stroke-width="2" marker-end="url(#arrow)"/>'
        body+=text(30,804,'Source structure; a full live run is not verified.')
        suffix='-dark' if dark else ''
        (ASSETS/f'system{suffix}.svg').write_text(svg('Customer app flow: event input, studio, server routes, pages and model providers, digital keepsake.',680,840,body,dark))
        body=text(30,52,'Three tools. Three clear jobs.','title')
        rows=[('neatlogs','See the run','Steps, errors, and model calls.','Proof: four trace screenshots.'),('Entire','Understand the code','Map files and their links.','Proof: public graph output.'),('cfo.ai','Plan the business','Prices, costs, and funding needs.','Proof: plan and forecast workbook.')]
        for i,(brand,label,line,proof) in enumerate(rows):
            y=90+i*195
            body+=f'<rect x="24" y="{y}" width="632" height="172" rx="14" fill="{card}" stroke="{fg}" stroke-opacity=".2"/>'
            body+=text(48,y+39,brand,'label')+text(48,y+76,label,'label')+text(48,y+113,line)+text(48,y+146,proof)
            if brand in ('Entire','cfo.ai'):
                name='entire' if brand=='Entire' else 'cfo'
                logo=base64.b64encode((ASSETS/f'{name}-official.svg').read_bytes()).decode()
                body+=f'<rect x="450" y="{y+16}" width="174" height="52" rx="8" fill="{INK}"/><image x="468" y="{y+28}" width="138" height="27" xlink:href="data:image/svg+xml;base64,{logo}"/>'
        body+=text(30,710,'Scope and limits are in the evidence guide.')
        (ASSETS/f'tools{suffix}.svg').write_text(svg('neatlogs records run steps, Entire maps code, cfo.ai plans the business. See evidence qualifications.',680,748,body,dark))


if __name__=='__main__':main()
