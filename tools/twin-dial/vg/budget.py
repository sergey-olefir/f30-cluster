"""VG: the Twin Dial's render budget (layers per connection, pixel memory, switch peak) from design/twin-dial/vg/budget.json.

    python3 tools/twin-dial/vg/budget.py [design/twin-dial/vg/budget.json]

Pixel memory as shared/hud.js counts it: an RGBA8 image layer or scene texture costs w*h*8 bytes (4 bytes, counted
twice by cluster-render), an R8 one w*h*2. Effect layers cost nothing. Limits: 8 layers per connection, 16 MiB
service-wide (shared with every other app), 16 assets per client (design/overlay/constraints.json).
"""
import json
import sys

MiB = 1024 * 1024


def cost(item):
    if item.get('kind') == 'effect':
        return 0
    bpp = 1 if item.get('format') == 'r8' else 4
    return item['w'] * item['h'] * bpp * 2


def main():
    b = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'design/twin-dial/vg/budget.json'))
    total = 0
    for conn, items in b['connections'].items():
        layers = [i for i in items if i.get('layer', True)]
        assets = [i for i in items if i.get('kind') != 'effect']
        px = sum(cost(i) for i in items)
        total += px
        print('connection %s: %d layers (limit 8), %d assets (limit 16), %.2f MiB' % (conn, len(layers), len(assets), px / MiB))
        for i in items:
            print('   %-22s %-7s %-5s %5s x %-4s %6.2f MiB  %s' % (i['id'], i.get('kind', 'image'), i.get('format', 'rgba8'),
                  i.get('w', '-'), i.get('h', '-'), cost(i) / MiB, i.get('what', '')))
    opt = sum(cost(i) for i in b.get('optional', []))
    print('steady: %.2f MiB of 16 (%.2f MiB with the optional panels: %s)' % (total / MiB, (total + opt) / MiB,
          ', '.join(i['id'] for i in b.get('optional', []))))
    # the switch peak: hud.js _sceneNeeds drops unused scene textures BEFORE creating new ones; sheets are re-made whole
    sheets = sum(cost(i) for items in b['connections'].values() for i in items if i.get('kind') == 'sheet')
    print('switch peak (drop-before-create keeps scene textures single; sheets old + new): %.2f MiB' %
          ((total + opt + sheets) / MiB))


if __name__ == '__main__':
    main()
