#!/usr/bin/env python3
"""DotCade — bakes office & arcade pixel maps (1440x960, 48px tiles) + maps.json"""
import os, json
from PIL import Image, ImageDraw

T = 48; W, H = 30, 20; PW, PH = W*T, H*T
OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'assets')

# Runtime avatars are drawn into a 48x72 envelope and are anchored at their
# feet.  Furniture footprints below deliberately reserve the full visual body
# (not just the desk top's centre tile), so a roaming avatar cannot appear on
# top of a monitor, cabinet or counter. Interactive seats, doors and centred
# cabinet spots stay outside these solids so planners always receive a valid
# feet-anchored destination.
AVATAR_REFERENCE = {'frame': [48, 72], 'footprint': [24, 10], 'anchor': 'feet'}

OFFICE_FURNITURE = [
    {'id': 'plant-upper-left', 'kind': 'plant', 'footprint': [1, 2, 1, 2]},
    {'id': 'recycle-planter', 'kind': 'plant', 'footprint': [11, 2, 2, 2]},
    {'id': 'plant-upper-right', 'kind': 'plant', 'footprint': [27, 2, 2, 2]},
    {'id': 'meeting-table', 'kind': 'table', 'footprint': [3, 5, 6, 2]},
    {'id': 'desk-player', 'kind': 'desk', 'footprint': [24, 3, 3, 2], 'interaction': [25, 5]},
    {'id': 'desk-pm', 'kind': 'desk', 'footprint': [14, 4, 3, 2], 'interaction': [15, 6]},
    {'id': 'desk-dev1', 'kind': 'desk', 'footprint': [19, 4, 3, 2], 'interaction': [20, 6]},
    {'id': 'desk-writer', 'kind': 'desk', 'footprint': [24, 8, 3, 2], 'interaction': [25, 10]},
    {'id': 'desk-designer', 'kind': 'desk', 'footprint': [14, 9, 3, 2], 'interaction': [15, 11]},
    {'id': 'desk-dev2', 'kind': 'desk', 'footprint': [19, 9, 3, 2], 'interaction': [20, 11]},
    {'id': 'game-shelf', 'kind': 'shelf', 'footprint': [2, 13, 4, 2]},
    {'id': 'lounge-sofa', 'kind': 'sofa', 'footprint': [12, 15, 4, 2]},
    {'id': 'coffee-table', 'kind': 'table', 'footprint': [13, 17, 2, 1]},
    {'id': 'pocket-station', 'kind': 'handheldStation', 'footprint': [9, 16, 1, 1], 'interaction': [9, 17]},
    {'id': 'plant-lower-left', 'kind': 'plant', 'footprint': [1, 16, 1, 3]},
    {'id': 'plant-lower-right', 'kind': 'plant', 'footprint': [27, 11, 2, 3]},
]

OFFICE_AISLES = [
    {'id': 'meeting-work-lane', 'tiles': [10, 5, 3, 8]},
    {'id': 'upper-desk-gap', 'tiles': [17, 2, 2, 7]},
    {'id': 'lower-desk-gap', 'tiles': [17, 9, 2, 6]},
    {'id': 'east-service-lane', 'tiles': [22, 10, 2, 7]},
    {'id': 'vehicle-door-lane', 'tiles': [16, 17, 12, 2]},
]

# Occluder crops are measured against the 1440x960 v2 bitmap.  `baseline` is
# the world-space foot y at which an entity starts drawing in front of the
# crop.  A renderer can merge these entries into its existing y-sorted scene
# and redraw the source rectangle at the same destination without maintaining
# a second foreground asset.
OFFICE_OCCLUDERS = [
    {'id': 'meeting-table-front', 'source': [150, 228, 294, 119], 'baseline': 342},
    {'id': 'desk-player-front', 'source': [1134, 151, 162, 139], 'baseline': 260},
    {'id': 'desk-pm-front', 'source': [663, 191, 161, 139], 'baseline': 300},
    {'id': 'desk-dev1-front', 'source': [903, 191, 161, 139], 'baseline': 300},
    {'id': 'desk-writer-front', 'source': [1138, 411, 159, 138], 'baseline': 490},
    {'id': 'desk-designer-front', 'source': [663, 451, 161, 139], 'baseline': 535},
    {'id': 'desk-dev2-front', 'source': [903, 451, 161, 139], 'baseline': 535},
    {'id': 'game-shelf-front', 'source': [96, 611, 202, 117], 'baseline': 728},
    {'id': 'lounge-sofa-front', 'source': [574, 708, 188, 94], 'baseline': 802},
    {'id': 'coffee-table-front', 'source': [615, 816, 101, 47], 'baseline': 863},
]

OFFICE_RESERVED = [
    {'id': 'office-bike', 'kind': 'bicycle', 'tile': [21, 16], 'radiusTiles': 1.1},
    {'id': 'office-scooter', 'kind': 'scooter', 'tile': [25, 16], 'radiusTiles': 1.05},
    {'id': 'office-book-a', 'kind': 'book', 'tile': [9, 11]},
    {'id': 'office-book-b', 'kind': 'book', 'tile': [18, 16]},
    {'id': 'office-trash', 'kind': 'trashbin', 'tile': [27, 6]},
]

ARCADE_FURNITURE = [
    {'id': 'plant-top-left', 'kind': 'plant', 'footprint': [1, 2, 2, 3]},
    *[
        {'id': f'cabinet-top-{i}', 'kind': 'cabinet', 'footprint': [tx, 2, 3, 3], 'interaction': [tx + 1, 5]}
        for i, tx in enumerate((3, 8, 13, 18, 23))
    ],
    {'id': 'plant-top-right', 'kind': 'plant', 'footprint': [27, 2, 2, 3]},
    {'id': 'cabinet-east-5', 'kind': 'cabinet', 'footprint': [27, 6, 2, 4], 'interaction': [26, 7]},
    {'id': 'cabinet-east-6', 'kind': 'cabinet', 'footprint': [27, 10, 2, 4], 'interaction': [26, 11]},
    {'id': 'cabinet-east-7', 'kind': 'cabinet', 'footprint': [27, 14, 2, 4], 'interaction': [26, 15]},
    {'id': 'prize-counter', 'kind': 'counter', 'footprint': [2, 15, 5, 3]},
    {'id': 'lounge-sofa', 'kind': 'sofa', 'footprint': [12, 10, 6, 2]},
    {'id': 'coffee-table', 'kind': 'table', 'footprint': [14, 12, 2, 1]},
    {'id': 'poster-kiosk-blue', 'kind': 'display', 'footprint': [23, 15, 2, 2]},
    # Keep x=26 open: it is the established interaction spot for cabinet 7.
    {'id': 'poster-kiosk-red', 'kind': 'display', 'footprint': [25, 15, 1, 2]},
    {'id': 'plant-bottom-left', 'kind': 'plant', 'footprint': [1, 15, 1, 3]},
]

ARCADE_AISLES = [
    {'id': 'cabinet-front-lane', 'tiles': [2, 5, 24, 2]},
    {'id': 'east-service-lane', 'tiles': [25, 5, 2, 9]},
    {'id': 'lounge-west-lane', 'tiles': [10, 7, 2, 8]},
    {'id': 'vehicle-exit-lane', 'tiles': [8, 17, 19, 2]},
]


ARCADE_OCCLUDERS = [
    {'id': 'lounge-sofa-front', 'source': [568, 470, 294, 120], 'baseline': 590},
    {'id': 'coffee-table-front', 'source': [662, 600, 98, 52], 'baseline': 651},
    {'id': 'prize-counter-front', 'source': [95, 702, 244, 146], 'baseline': 847},
]

ARCADE_RESERVED = [
    {'id': 'arcade-bike', 'kind': 'bicycle', 'tile': [21, 15], 'radiusTiles': 1.1},
    {'id': 'arcade-scooter', 'kind': 'scooter', 'tile': [18, 15], 'radiusTiles': 1.05},
    {'id': 'arcade-book', 'kind': 'book', 'tile': [17, 17]},
    {'id': 'arcade-trash', 'kind': 'trashbin', 'tile': [27, 18]},
]

def layout_meta(furniture, aisles, occluders, reserved):
    return {
        'avatarReference': AVATAR_REFERENCE,
        'minAisleTiles': 2,
        'furniture': furniture,
        'aisles': aisles,
        'occluders': occluders,
        # Runtime props stay on walkable floor. They should contribute only a
        # small local steering cost, never become static A* walls.
        'reserved': reserved,
        'dynamicAvoid': [
            {'id': item['id'], 'tile': item['tile'], 'radiusTiles': item.get('radiusTiles', 0.65)}
            for item in reserved
        ],
    }

def block_furniture(block, furniture):
    for item in furniture:
        block(*item['footprint'])

# ---------- tiny 5x5 pixel font ----------
FONT = {
 'A':"01110 10001 11111 10001 10001",'B':"11110 10001 11110 10001 11110",
 'C':"01111 10000 10000 10000 01111",'D':"11110 10001 10001 10001 11110",
 'E':"11111 10000 11110 10000 11111",'G':"01111 10000 10111 10001 01111",
 'I':"11111 00100 00100 00100 11111",'K':"10001 10010 11100 10010 10001",
 'L':"10000 10000 10000 10000 11111",'M':"10001 11011 10101 10001 10001",
 'N':"10001 11001 10101 10011 10001",'O':"01110 10001 10001 10001 01110",
 'P':"11110 10001 11110 10000 10000",'R':"11110 10001 11110 10010 10001",
 'S':"01111 10000 01110 00001 11110",'T':"11111 00100 00100 00100 00100",
 'U':"10001 10001 10001 10001 01110",'V':"10001 10001 10001 01010 00100",
 'W':"10001 10001 10101 11011 10001",'Y':"10001 01010 00100 00100 00100",
 'Z':"11111 00010 00100 01000 11111",'F':"11111 10000 11110 10000 10000",
 'H':"10001 10001 11111 10001 10001",'!':"00100 00100 00100 00000 00100",
 ' ':"00000 00000 00000 00000 00000",
 '★':"00100 01110 11111 01110 10101",'♥':"01010 11111 11111 01110 00100",
}
def text_px(d, x, y, s, col, scale=3, spacing=1):
    cx = x
    for ch in s:
        rows = FONT.get(ch, FONT[' ']).split()
        for ry, row in enumerate(rows):
            for rx, c in enumerate(row):
                if c == '1':
                    d.rectangle([cx+rx*scale, y+ry*scale, cx+rx*scale+scale-1, y+ry*scale+scale-1], fill=col)
        cx += (5+spacing)*scale
    return cx

def rect(d, x0, y0, x1, y1, fill, outline=None, ow=3):
    d.rectangle([x0, y0, x1, y1], fill=fill)
    if outline:
        for i in range(ow):
            d.rectangle([x0+i, y0+i, x1-i, y1-i], outline=outline)

def shadow(d, x0, y0, x1, y1):
    d.rectangle([x0, y0, x1, y1], fill=(20, 16, 28, 70))

# ---------------- OFFICE ----------------
def build_office():
    img = Image.new('RGBA', (PW, PH)); d = ImageDraw.Draw(img, 'RGBA')
    FLOOR1, FLOOR2 = (206, 168, 116), (198, 159, 106)
    PLANK = (184, 146, 96); WALL = (236, 228, 210); WALLSH = (214, 204, 182)
    WALLTOP = (166, 172, 190); BASE = (168, 132, 88); OUTL = (52, 44, 40)
    col = ['.'*W for _ in range(H)]; col = [list(r) for r in col]
    def block(x, y, w=1, h=1):
        for yy in range(y, y+h):
            for xx in range(x, x+w):
                if 0 <= xx < W and 0 <= yy < H: col[yy][xx] = '#'
    # floor
    for ty in range(H):
        for tx in range(W):
            c = FLOOR1 if (tx+ty) % 2 == 0 else FLOOR2
            d.rectangle([tx*T, ty*T, tx*T+T-1, ty*T+T-1], fill=c)
            d.line([tx*T, ty*T+T-1, tx*T+T-1, ty*T+T-1], fill=PLANK)
    # walls: top band 2 rows + side/bottom thin
    d.rectangle([0, 0, PW-1, 2*T-1], fill=WALL)
    d.rectangle([0, 2*T-10, PW-1, 2*T-1], fill=WALLSH)
    d.rectangle([0, 0, PW-1, 14], fill=WALLTOP)
    d.rectangle([0, 2*T, PW-1, 2*T+8], fill=BASE)  # baseboard
    for x in range(W): block(x, 0); block(x, 1)
    for y in range(H): block(0, y); block(W-1, y)
    for x in range(W): block(x, H-1)
    # side walls visual
    d.rectangle([0, 0, T//2-1, PH-1], fill=WALL); d.rectangle([T//2-8, 0, T//2-1, PH-1], fill=WALLSH)
    d.rectangle([PW-T//2, 0, PW-1, PH-1], fill=WALL); d.rectangle([PW-T//2, 0, PW-T//2+7, PH-1], fill=WALLSH)
    d.rectangle([0, PH-T//2, PW-1, PH-1], fill=WALL); d.rectangle([0, PH-T//2, PW-1, PH-T//2+7], fill=WALLSH)
    # windows on top wall
    for wx in (11, 14, 17, 20):
        x0 = wx*T+6; y0 = 16; x1 = wx*T+T*2-30; y1 = 2*T-22
        rect(d, x0, y0, x1, y1, (150, 205, 235), (90, 96, 112), 3)
        d.rectangle([x0+6, y0+6, x0+26, y0+16], fill=(215, 240, 250))
        d.line([(x0+x1)//2, y0, (x0+x1)//2, y1], fill=(90, 96, 112), width=3)
    # meeting rug
    rug = (91, 123, 213); rug2 = (81, 110, 194)
    rect(d, 2*T, 3*T, 10*T-1, 9*T-1, rug, (60, 82, 150), 4)
    for ty in range(3, 9):
        for tx in range(2, 10):
            if (tx+ty) % 2: d.rectangle([tx*T+4, ty*T+4, tx*T+T-5, ty*T+T-5], fill=rug2)
    # whiteboard on wall (meeting)
    rect(d, 3*T, 10, 7*T, 2*T-26, (250, 250, 252), (110, 116, 128), 4)
    d.line([3*T+16, 30, 5*T, 30], fill=(80, 120, 220), width=4)
    d.line([3*T+16, 46, 6*T, 46], fill=(230, 120, 90), width=4)
    d.line([3*T+16, 62, 4*T+30, 62], fill=(60, 60, 70), width=4)
    text_px(d, 7*T+14, 22, 'PLAN', (60, 60, 80), 3)
    # meeting table 3..8 x 5..6
    shadow(d, 3*T+6, 5*T+10, 9*T-2, 7*T+6)
    rect(d, 3*T, 5*T, 9*T-8, 7*T-8, (172, 128, 84), OUTL, 3)
    d.rectangle([3*T+8, 5*T+8, 9*T-16, 5*T+26], fill=(196, 152, 104))
    block(3, 5, 6, 2)
    # meeting chairs
    def chair(tx, ty, facing):
        cx, cy = tx*T, ty*T
        shadow(d, cx+10, cy+30, cx+T-10, cy+T-4)
        rect(d, cx+10, cy+12, cx+T-11, cy+T-8, (226, 88, 88), OUTL, 3)
        if facing == 'down': d.rectangle([cx+10, cy+2, cx+T-11, cy+16], fill=(190, 66, 66), outline=OUTL)
        if facing == 'up':   d.rectangle([cx+10, cy+T-14, cx+T-11, cy+T-2], fill=(190, 66, 66), outline=OUTL)
    for sx in (4, 6, 8): chair(sx, 4, 'down')
    for sx in (4, 6, 8): chair(sx, 7, 'up')
    chair(2, 5, 'down')
    # desks
    def desk(tx, ty, wide=3, deco=None):
        x0, y0 = tx*T, ty*T
        shadow(d, x0+4, y0+T-8, x0+wide*T-4, y0+T+8)
        rect(d, x0, y0, x0+wide*T-1, y0+T+10, (188, 148, 100), OUTL, 3)
        d.rectangle([x0+6, y0+6, x0+wide*T-7, y0+22], fill=(210, 170, 118))
        # monitor(s)
        mx = x0 + wide*T//2 - 30
        rect(d, mx, y0-26, mx+60, y0+14, (44, 46, 58), OUTL, 3)
        d.rectangle([mx+6, y0-20, mx+54, y0+6], fill=(120, 220, 190))
        d.rectangle([mx+24, y0+14, mx+36, y0+22], fill=(60, 60, 70))
        if deco == 'flag':
            d.rectangle([x0+wide*T-26, y0-30, x0+wide*T-22, y0+6], fill=(90, 90, 100))
            d.polygon([(x0+wide*T-22, y0-30), (x0+wide*T-2, y0-24), (x0+wide*T-22, y0-16)], fill=(240, 190, 60), outline=OUTL)
        if deco == 'plant':
            d.rectangle([x0+8, y0-14, x0+22, y0+4], fill=(150, 100, 70), outline=OUTL)
            d.polygon([(x0+15, y0-30), (x0+4, y0-12), (x0+26, y0-12)], fill=(96, 168, 92), outline=OUTL)
        block(tx, ty, wide, 1)
    def deskchair(tx, ty):
        cx, cy = tx*T, ty*T
        shadow(d, cx+12, cy+30, cx+T-12, cy+T-2)
        rect(d, cx+10, cy+8, cx+T-11, cy+T-10, (72, 104, 190), OUTL, 3)
        d.rectangle([cx+14, cy+T-14, cx+T-15, cy+T-4], fill=(56, 82, 152))
    desk(24, 4, 3, 'flag'); deskchair(25, 5)     # player
    desk(14, 5); deskchair(15, 6)                # pm
    desk(19, 5); deskchair(20, 6)                # dev1
    desk(19, 10); deskchair(20, 11)              # dev2
    desk(14, 10, 3, 'plant'); deskchair(15, 11)  # designer
    desk(24, 9); deskchair(25, 10)               # writer
    # game shelf 2..5 x 13..14
    shadow(d, 2*T+4, 15*T-8, 6*T-4, 15*T+6)
    rect(d, 2*T, 13*T, 6*T-1, 15*T-6, (126, 94, 66), OUTL, 4)
    for row in range(2):
        d.rectangle([2*T+8, 13*T+10+row*44, 6*T-9, 13*T+40+row*44], fill=(88, 64, 44))
    text_px(d, 2*T+14, 13*T-20, 'GAME', (250, 220, 90), 3)
    block(2, 13, 4, 2)
    # sofa + coffee table (12..15, 15..16)
    shadow(d, 12*T+4, 16*T+20, 16*T-4, 16*T+34)
    rect(d, 12*T, 15*T+14, 16*T-8, 16*T+30, (110, 170, 130), OUTL, 3)
    d.rectangle([12*T, 15*T+2, 16*T-8, 15*T+22], fill=(92, 148, 112), outline=OUTL)
    for i in range(4): d.line([12*T+i*46+10, 15*T+30, 12*T+i*46+10, 16*T+24], fill=(86, 138, 104), width=3)
    block(12, 15, 4, 2)
    rect(d, 13*T, 17*T+6, 15*T-10, 17*T+40, (172, 128, 84), OUTL, 3); block(13, 17, 2, 1)
    # water cooler & pantry
    rect(d, 11*T+10, 3*T+2, 11*T+38, 3*T+30, (200, 226, 240), OUTL, 3)
    d.rectangle([11*T+14, 3*T+30, 11*T+34, 4*T-6], fill=(150, 158, 172), outline=OUTL)
    block(11, 3)
    # plants
    def plant(tx, ty):
        x0, y0 = tx*T, ty*T
        shadow(d, x0+8, y0+T-12, x0+T-8, y0+T-2)
        d.rectangle([x0+12, y0+22, x0+T-13, y0+T-6], fill=(178, 96, 70), outline=OUTL)
        d.polygon([(x0+T//2, y0-14), (x0+4, y0+26), (x0+T-5, y0+26)], fill=(88, 160, 84), outline=OUTL)
        d.polygon([(x0+T//2-14, y0-4), (x0+T//2+14, y0-4), (x0+T//2, y0+20)], fill=(112, 186, 102))
        block(tx, ty)
    plant(1, 2); plant(28, 2); plant(1, 17); plant(12, 3); plant(28, 12)
    # arcade door (bottom right)
    dx0, dy0 = 26*T, 18*T+10
    rect(d, dx0-8, dy0-8, dx0+2*T+8, PH-1, (30, 26, 44), (250, 120, 200), 4)
    text_px(d, dx0-2, dy0+18, 'ARCADE', (120, 240, 255), 3, 0)
    d.polygon([(dx0+T-6, dy0+56), (dx0+T+18, dy0+56), (dx0+T+6, dy0+72)], fill=(250, 220, 90))
    for xx in (26, 27): col[19][xx] = '.'  # door tiles walkable (portal)
    # poster
    rect(d, 22*T, 12, 23*T+20, 2*T-30, (250, 210, 90), (140, 100, 40), 3)
    text_px(d, 22*T+8, 22, 'GO!', (200, 60, 60), 3)
    # Re-apply the canonical runtime footprints after decorative drawing.
    # This includes the rear half of each v2 desk, which used to be visually
    # occupied but pathfinding-open and allowed avatars through monitors.
    block_furniture(block, OFFICE_FURNITURE)
    return img, col

# ---------------- ARCADE ----------------
CABCOLORS = [(238, 96, 96), (96, 160, 238), (250, 200, 80), (120, 210, 130),
             (200, 120, 240), (90, 220, 210), (240, 140, 80), (140, 150, 250)]
def build_arcade():
    img = Image.new('RGBA', (PW, PH)); d = ImageDraw.Draw(img, 'RGBA')
    CARPET1, CARPET2 = (44, 36, 74), (38, 31, 64)
    WALL = (26, 21, 46); OUTL = (16, 12, 28)
    col = [list('.'*W) for _ in range(H)]
    def block(x, y, w=1, h=1):
        for yy in range(y, y+h):
            for xx in range(x, x+w):
                if 0 <= xx < W and 0 <= yy < H: col[yy][xx] = '#'
    # carpet with confetti
    import random; rnd = random.Random(7)
    for ty in range(H):
        for tx in range(W):
            c = CARPET1 if (tx+ty) % 2 == 0 else CARPET2
            d.rectangle([tx*T, ty*T, tx*T+T-1, ty*T+T-1], fill=c)
    for _ in range(420):
        x, y = rnd.randrange(PW), rnd.randrange(2*T, PH-T)
        cc = rnd.choice([(255, 120, 180), (120, 220, 255), (250, 230, 120), (140, 250, 160), (180, 140, 255)])
        d.rectangle([x, y, x+5, y+5], fill=cc+(120,))
    # walls
    d.rectangle([0, 0, PW-1, 2*T-1], fill=WALL)
    for x in range(W): block(x, 0); block(x, 1)
    for y in range(H): block(0, y); block(W-1, y)
    for x in range(W): block(x, H-1)
    d.rectangle([0, PH-T//2, PW-1, PH-1], fill=WALL)
    d.rectangle([0, 0, T//2-1, PH-1], fill=WALL); d.rectangle([PW-T//2, 0, PW-1, PH-1], fill=WALL)
    # neon border strips
    for yy, ccol in ((2*T, (255, 90, 190)), (2*T+6, (90, 230, 255))):
        d.rectangle([T//2, yy, PW-T//2, yy+4], fill=ccol)
    d.rectangle([T//2, PH-T//2-6, PW-T//2, PH-T//2-2], fill=(255, 90, 190))
    # marquee sign
    text_px(d, 10*T, 18, 'DOTCADE', (255, 230, 120), 5, 1)
    text_px(d, 8*T+10, 64, '★', (255, 120, 200), 4); text_px(d, 21*T, 64, '★', (120, 230, 255), 4)
    cabinets = []
    def cabinet(i, tx, ty, facing):
        c = CABCOLORS[i % len(CABCOLORS)]
        x0, y0 = tx*T, ty*T; x1, y1 = x0+2*T-1, y0+2*T-1
        shadow(d, x0+4, y1-6, x1-4, y1+10)
        rect(d, x0+2, y0-18, x1-2, y1-8, tuple(int(v*0.55) for v in c), OUTL, 4)
        rect(d, x0+8, y0-14, x1-8, y0+6, c, OUTL, 3)          # marquee
        scr = None
        if facing == 'down':
            scr = (x0+14, y0+12, x1-14, y0+2*T-28)
            rect(d, scr[0]-4, scr[1]-4, scr[2]+4, scr[3]+4, (20, 20, 30), OUTL, 3)
            d.rectangle(scr, fill=(10, 14, 24))
            # control deck
            rect(d, x0+10, y1-26, x1-10, y1-6, tuple(int(v*0.75) for v in c), OUTL, 3)
            d.ellipse([x0+22, y1-22, x0+34, y1-10], fill=(250, 240, 240), outline=OUTL)
            d.ellipse([x1-34, y1-22, x1-22, y1-10], fill=(255, 220, 90), outline=OUTL)
        else:  # facing left
            scr = (x0+10, y0+14, x0+2*T-30, y1-22)
            rect(d, scr[0]-4, scr[1]-4, scr[2]+4, scr[3]+4, (20, 20, 30), OUTL, 3)
            d.rectangle(scr, fill=(10, 14, 24))
        block(tx, ty, 2, 2)
        # v2 top cabinets are three visual tiles wide; keep the interaction
        # point centred in front instead of pinning the avatar to the left leg.
        spot = (tx+1, ty+2) if facing == 'down' else (tx-1, ty)
        cabinets.append({'id': i, 'tiles': [tx, ty, 2, 2], 'screen': list(scr), 'spot': list(spot), 'facing': facing})
    for i, tx in enumerate((3, 8, 13, 18, 23)):
        cabinet(i, tx, 3, 'down')
    for j, ty in enumerate((7, 11, 15)):
        cabinet(5+j, 27, ty, 'left')
    # entrance door left
    rect(d, 2, 9*T-8, T//2+6, 11*T+8, (60, 50, 90), (255, 230, 120), 3)
    text_px(d, 10, 9*T-40, 'IN', (140, 250, 160), 3)
    for yy in (9, 10): col[yy][0] = '.'; col[yy][1] = '.'
    # prize counter bottom-left
    shadow(d, 2*T+4, 18*T-10, 7*T-4, 18*T+4)
    rect(d, 2*T, 16*T, 7*T-1, 18*T-12, (150, 110, 190), OUTL, 4)
    d.rectangle([2*T+8, 16*T+8, 7*T-9, 16*T+40], fill=(178, 138, 216))
    for i in range(4):
        bx = 2*T+16+i*52
        d.ellipse([bx, 15*T+18, bx+30, 15*T+46], fill=CABCOLORS[i], outline=OUTL)
    text_px(d, 2*T+20, 16*T+52, 'PRIZE', (255, 240, 160), 3)
    block(2, 16, 5, 2)
    # vending machines bottom-right
    for i, tx in enumerate((23, 25)):
        tw = 2 if i == 0 else 1
        x0 = tx*T
        x1 = x0 + tw*T - 5
        rect(d, x0+4, 15*T, x1, 17*T-6, (70, 130, 220) if i == 0 else (230, 90, 110), OUTL, 4)
        d.rectangle([x0+12, 15*T+10, x1-10, 16*T+18], fill=(200, 230, 250))
        for r in range(3):
            d.rectangle([x0+16, 15*T+16+r*22, x1-16, 15*T+30+r*22], fill=(120, 160, 210) if i == 0 else (240, 170, 120))
        block(tx, 15, tw, 2)
    # center sofas + table
    shadow(d, 12*T+4, 11*T+22, 18*T-4, 11*T+36)
    rect(d, 12*T, 10*T+16, 18*T-10, 11*T+30, (226, 120, 90), OUTL, 3)
    d.rectangle([12*T, 10*T+2, 18*T-10, 10*T+24], fill=(200, 100, 74), outline=OUTL)
    block(12, 10, 6, 2)
    rect(d, 14*T, 12*T+10, 16*T-6, 13*T-2, (60, 50, 90), OUTL, 3); block(14, 12, 2, 1)
    # dance floor tiles center
    for ty in range(6, 9):
        for tx in range(12, 18):
            cc = [(255, 120, 180, 60), (120, 220, 255, 60), (250, 230, 120, 60), (140, 250, 160, 60)][(tx+ty) % 4]
            d.rectangle([tx*T+4, ty*T+4, tx*T+T-5, ty*T+T-5], fill=cc)
    # v2 cabinets are visually three tiles wide/tall even though the legacy
    # interaction shell remains 2x2.  Reserve their rendered body and keep the
    # two-tile service lanes around them open.
    block_furniture(block, ARCADE_FURNITURE)
    return img, col, cabinets

def main():
    os.makedirs(OUT, exist_ok=True)
    office, ocol = build_office()
    arcade, acol, cabinets = build_arcade()
    office.save(os.path.join(OUT, 'map_office.png'))
    arcade.save(os.path.join(OUT, 'map_arcade.png'))
    maps = {
        'tile': T, 'w': W, 'h': H,
        'office': {
            'collision': [''.join(r) for r in ocol],
            'spawn': [13, 12],
            'seats': {
                'player':   {'desk': [25, 5], 'face': 'up'},
                'pm':       {'desk': [15, 6], 'face': 'up'},
                'dev1':     {'desk': [20, 6], 'face': 'up'},
                'dev2':     {'desk': [20, 11], 'face': 'up'},
                'designer': {'desk': [15, 11], 'face': 'up'},
                'writer':   {'desk': [25, 10], 'face': 'up'},
            },
            'meeting': {
                'seats': [[4, 4], [6, 4], [8, 4], [4, 7], [6, 7], [8, 7]],
                'faces': ['down', 'down', 'down', 'up', 'up', 'up'],
                'head':  [2, 7], 'headFace': 'right',
                'zone': [2, 3, 8, 6]
            },
            'shelf': {'tiles': [2, 13, 4, 2], 'front': [[2, 15], [3, 15], [4, 15], [5, 15]]},
            'door': {'tiles': [[26, 19], [27, 19]], 'approach': [[26, 18], [27, 18]]},
            'wander': [2, 3, 27, 16],
            'layout': layout_meta(OFFICE_FURNITURE, OFFICE_AISLES, OFFICE_OCCLUDERS, OFFICE_RESERVED)
        },
        'arcade': {
            'collision': [''.join(r) for r in acol],
            'spawn': [2, 9],
            'door': {'tiles': [[0, 9], [0, 10]], 'approach': [[1, 9], [1, 10]]},
            'cabinets': cabinets,
            'wander': [2, 3, 27, 17],
            'layout': layout_meta(ARCADE_FURNITURE, ARCADE_AISLES, ARCADE_OCCLUDERS, ARCADE_RESERVED)
        }
    }
    with open(os.path.join(OUT, 'maps.json'), 'w') as f:
        json.dump(maps, f, indent=2)
    print('maps baked')

if __name__ == '__main__':
    main()
