#!/usr/bin/env python3
"""DotCade — avatar sheet slicer.
Slices 3 uploaded 4x5 sheets into per-direction transparent sprites,
generates hue-shifted variants for 20 arcade visitors, face icons, manifest.
"""
import os, json, colorsys
from PIL import Image

U = '/root/.claude/uploads/92d6f32f-b632-5f82-a23c-218506559c28/'
SHEETS = {
    'A': U + 'fa961358-9A15FBECE27245EAB26F8819598D90FC.png',  # adults 1254x1254
    'B': U + 'bf4be55f-20F5D9A4F018421C86C3CE0F09350BEA.png',  # teens 1024x1536
    'C': U + 'ed0fc681-0ED11FC4279F4D8E8E8119B40DE7E456.png',  # staff 1024x1536
}
DIRS = ['down', 'right', 'left', 'up']  # column order verified visually
OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'assets', 'sprites')

# character id -> (sheet, row)
ROSTER = {
    # office team
    'player':   ('A', 0),  # suit + watch, team lead
    'pm':       ('C', 2),  # navy blazer + clipboard
    'dev1':     ('C', 1),  # black </> hoodie, glasses
    'dev2':     ('B', 2),  # green jacket, satchel
    'designer': ('C', 3),  # blue bob, palette bag
    'writer':   ('C', 4),  # auburn bun, notebook
    # arcade visitor bases
    'v01': ('B', 4),  # mint overalls kid
    'v02': ('B', 0),  # varsity girl
    'v03': ('B', 1),  # red hoodie headband boy
    'v04': ('B', 3),  # orange cap headphones boy
    'v05': ('A', 1),  # hoodie + crossbody bag student
    'v06': ('A', 4),  # headset glasses woman (streamer)
    'v07': ('A', 3),  # red jacket woman
    'v08': ('C', 0),  # maroon jacket man
    'v09': ('A', 2),  # gray senior man
}
# variants: id -> (base, hue_shift_deg, val_mul)
VARIANTS = {
    'v10': ('v02', 150, 1.00), 'v11': ('v03', 210, 1.00), 'v12': ('v04', 120, 0.96),
    'v13': ('v01', 200, 1.00), 'v14': ('v05', 160, 1.02), 'v15': ('v06', 250, 1.00),
    'v16': ('v07', 190, 0.97), 'v17': ('v08', 140, 1.04), 'v18': ('v09', 0, 0.92),
    'v19': ('v05', 300, 0.95), 'v20': ('v07', 90, 1.05),
}

def flood_bg(im, thr=30):
    """Remove background connected to border (adaptive: multi-sample palette)."""
    im = im.convert('RGBA'); w, h = im.size; px = im.load()
    samples = [px[2, 2][:3], px[w-3, 2][:3], px[2, h-3][:3], px[w-3, h-3][:3],
               px[w//2, 2][:3], px[w//2, h-3][:3], px[2, h//2][:3], px[w-3, h//2][:3]]
    from collections import deque
    seen = bytearray(w * h); q = deque()
    def near(p):
        for c0 in samples:
            if abs(p[0]-c0[0]) + abs(p[1]-c0[1]) + abs(p[2]-c0[2]) < thr * 3:
                return True
        return False
    for x in range(w):
        for y in (0, h - 1):
            if near(px[x, y][:3]): q.append((x, y)); seen[y*w+x] = 1
    for y in range(h):
        for x in (0, w - 1):
            if near(px[x, y][:3]) and not seen[y*w+x]: q.append((x, y)); seen[y*w+x] = 1
    while q:
        x, y = q.popleft(); px[x, y] = (0, 0, 0, 0)
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx, ny = x+dx, y+dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny*w+nx] and near(px[nx, ny][:3]):
                seen[ny*w+nx] = 1; q.append((nx, ny))
    return im

def hue_shift(im, deg, vmul=1.0):
    if deg == 0 and vmul == 1.0: return im.copy()
    im = im.copy(); px = im.load(); w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0: continue
            hh, ss, vv = colorsys.rgb_to_hsv(r/255, g/255, b/255)
            hd = hh * 360
            skin = (5 <= hd <= 50 and ss < 0.62 and vv > 0.45)   # protect skin
            dark = vv < 0.16                                       # protect outlines
            if not skin and not dark and ss > 0.18:
                hh = ((hd + deg) % 360) / 360
                vv = min(1.0, vv * vmul)
            r2, g2, b2 = colorsys.hsv_to_rgb(hh, ss, vv)
            px[x, y] = (int(r2*255), int(g2*255), int(b2*255), a)
    return im

def main():
    os.makedirs(OUT, exist_ok=True)
    cells = {}  # (sheet,row,dir) -> RGBA trimmed
    sheets = {k: Image.open(p).convert('RGB') for k, p in SHEETS.items()}
    for k, im in sheets.items():
        w, h = im.size; cw, ch = w // 4, h // 5
        for r in range(5):
            for c in range(4):
                cell = im.crop((c*cw, r*ch, (c+1)*cw, (r+1)*ch))
                cell = flood_bg(cell)
                bbox = cell.getbbox()
                cell = cell.crop(bbox)
                # halve with NEAREST to keep pixel look
                cell = cell.resize((cell.width // 2, cell.height // 2), Image.NEAREST)
                cells[(k, r, DIRS[c])] = cell

    manifest = {}
    def emit(cid, base_cells, shift=0, vmul=1.0):
        d = os.path.join(OUT, cid); os.makedirs(d, exist_ok=True)
        sizes = {}
        for dr in DIRS:
            img = base_cells[dr]
            if shift or vmul != 1.0: img = hue_shift(img, shift, vmul)
            img.save(os.path.join(d, f'{dr}.png'))
            sizes[dr] = [img.width, img.height]
            if dr == 'down':
                # face icon: top 42% square-ish crop
                fh = int(img.height * 0.42)
                icon = img.crop(((img.width - min(img.width, fh)) // 2, 0,
                                 (img.width + min(img.width, fh)) // 2, fh))
                icon = icon.resize((96, 96), Image.NEAREST)
                icon.save(os.path.join(d, 'face.png'))
        manifest[cid] = {'sizes': sizes}

    for cid, (sh, row) in ROSTER.items():
        emit(cid, {dr: cells[(sh, row, dr)] for dr in DIRS})
    for cid, (base, deg, vm) in VARIANTS.items():
        sh, row = ROSTER[base]
        emit(cid, {dr: cells[(sh, row, dr)] for dr in DIRS}, deg, vm)

    with open(os.path.join(OUT, 'sprites.json'), 'w') as f:
        json.dump(manifest, f)
    print('emitted', len(manifest), 'characters ->', os.path.abspath(OUT))

if __name__ == '__main__':
    main()
