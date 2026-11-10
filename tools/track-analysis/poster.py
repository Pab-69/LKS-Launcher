"""One clean image per layout to check: track, limits, paint, clips (numbered), line, gates, legend, scale."""
import sys, os, math, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import analysis as v2, render as R
from PIL import Image, ImageDraw

NAMES = {'arg23': "Val d'Argenton 2023", 'arg24': "Val d'Argenton 2024", 'cal': 'Calmont', 'cha': 'Charade', 'cro': 'Croix-en-Ternois', 'vdv': 'Val de Vienne', 'eng': 'Englishtown', 'kart': 'Kart Volan', 'pge': 'PGE Narodowy', 'bik': 'Bikernieki'}

def poster(key, out, maxw=2400, maxh=2400):
    res = v2.analyze(key, verbose=False)
    c = res['course']['course']
    # exactly what the launcher has: the exported line and limits
    res['line'] = np.array(c['refLine'], float)
    res['limits'] = [np.array(l, float) for l in c['limits']]
    allp = np.vstack([res['line']] + [np.array(c[k]) for k in ('staging', 'start', 'finish') if c.get(k)] + [np.array(cl['path']) if cl.get('path') else np.array([[cl['x'], cl['z']]]) for cl in c['clips']])
    x0, z0 = allp.min(0) - 25; x1, z1 = allp.max(0) + 25
    ppm = min(maxw / (x1 - x0), maxh / (z1 - z0))
    im = R.draw(res, (x0, z0, x1, z1), ppm, labels=False)
    d = ImageDraw.Draw(im, 'RGBA')
    v = R.View((x0, z0, x1, z1), ppm)
    f = R.font(max(18, min(30, int(ppm * 1.6))))
    # numbered clips, as in the launcher
    for i, cl in enumerate(c['clips']):
        col = R.COL['inner' if cl['kind'] != 'outer' else 'outer']
        a, b = v.p(cl['x'], cl['z']); rr = max(14, cl['r'] * ppm)
        txt = f"{i + 1}"
        tw = d.textlength(txt, font=f)
        bx, by = a + rr + 6, b - 18
        d.rounded_rectangle([bx - 4, by - 2, bx + tw + 6, by + 30], 6, fill=(0, 0, 0, 190), outline=col + (255,), width=2)
        d.text((bx + 1, by), txt, fill=col + (255,), font=f)
    # gates labels
    for k, lab in (('staging', 'DÉPART'), ('start', 'DÉBUT DU DRIFT'), ('finish', 'ARRIVÉE')):
        if not c.get(k): continue
        a, b = v.p(*c[k][1])
        tw = d.textlength(lab, font=f)
        d.rounded_rectangle([a + 6, b - 16, a + 18 + tw, b + 18], 6, fill=(0, 0, 0, 190), outline=R.COL[k] + (255,), width=2)
        d.text((a + 12, b - 14), lab, fill=R.COL[k] + (255,), font=f)
    # legend + clip list + scale on a side panel
    PW = 560
    out_im = Image.new('RGB', (im.width + PW, max(im.height, 1100)), R.COL['bg'])
    out_im.paste(im, (0, 0))
    d2 = ImageDraw.Draw(out_im)
    X = im.width + 30; Y = 30
    d2.text((X, Y), NAMES[key], fill=(255, 255, 255), font=R.font(40)); Y += 60
    d2.text((X, Y), f"Parcours {round(float(np.hypot(*np.diff(res['line'], axis=0).T).sum()))} m", fill=(200, 200, 200), font=R.font(22)); Y += 50
    leg = [('limit', 'Limites de piste'), ('paint', 'Marquage peint au sol'), ('line', 'Ligne (centre de la voiture)'), ('inner', 'Clip corde (avant de la voiture)'), ('outer', 'Clip / zone extérieur (arrière)'), ('staging', 'Ligne de départ'), ('start', 'Début du drift'), ('finish', 'Arrivée'), ('wall', 'Mur / barrière')]
    for k, lab in leg:
        d2.rectangle([X, Y + 6, X + 40, Y + 18], fill=R.COL[k]); d2.text((X + 55, Y), lab, fill=(230, 230, 230), font=R.font(22)); Y += 36
    Y += 20
    d2.text((X, Y), 'Clips', fill=(255, 255, 255), font=R.font(28)); Y += 44
    for i, cl in enumerate(c['clips']):
        col = R.COL['inner' if cl['kind'] != 'outer' else 'outer']
        kind = 'corde' if cl['kind'] != 'outer' else 'extérieur'
        shape = f"zone {round(float(np.hypot(*np.diff(np.array(cl['path']), axis=0).T).sum()))} m" if cl.get('path') else f"point, rayon {cl['r']} m"
        d2.text((X, Y), f"{i + 1}. {cl['name']} : {kind}, {shape}", fill=col, font=R.font(22)); Y += 34
    Y += 30
    # scale bar
    for m in (100, 50, 20, 10, 5):
        if m * ppm <= PW - 80: break
    d2.rectangle([X, Y, X + m * ppm, Y + 10], fill=(230, 230, 230)); d2.text((X, Y + 16), f'{m} m', fill=(230, 230, 230), font=R.font(22))
    out_im.save(out, quality=90)
    return out

if __name__ == '__main__':
    os.makedirs(sys.argv[2], exist_ok=True)
    for k in sys.argv[1].split(','):
        print(poster(k, os.path.join(sys.argv[2], NAMES[k].replace("'", '').replace(' ', '-') + '.jpg')))
