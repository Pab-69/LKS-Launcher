"""Download the files of the group's tracks needed for the analysis (models, AI lines, ini), without the textures.

  python3 fetch.py            # every track of the manifest into tracks/
"""
import json, os, re, sys, time, urllib.request, ssl
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import zipremote as Z

CFG = json.load(open(os.path.join(HERE, '..', '..', 'lks.config.json')))
OUT = os.environ.get('LKS_TRACKS', os.path.join(HERE, 'tracks'))
SKIP = re.compile(r'texture|\.dds$|skins/', re.I)
ctx = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE')) if os.environ.get('SSL_CERT_FILE') else None


def main():
    manifest = json.load(urllib.request.urlopen(CFG['manifestUrl'], context=ctx))
    for t in manifest.get('tracks', []):
        url, tid = t['url'], t['id']
        for e in Z.central(url, Z.size_of(url)):
            n = e['name']
            if n.endswith('/') or SKIP.search(n) or not n.lower().endswith(('.kn5', '.ai', '.ini', '.json')): continue
            dest = os.path.join(OUT, tid, *[x for x in n.split('/') if x not in ('', '..')])
            if os.path.exists(dest) and os.path.getsize(dest) == e['usize']: continue
            for k in range(6):
                try:
                    Z.extract(url, e, os.path.join(OUT, tid)); break
                except Exception as err:
                    if '429' not in str(err): raise
                    time.sleep(10 * (k + 1))
            print(dest, round(e['usize'] / 1e6, 1), 'Mo')


if __name__ == '__main__':
    main()
