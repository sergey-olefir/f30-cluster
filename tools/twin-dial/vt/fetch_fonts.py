"""VT: download the free candidate faces (SIL OFL 1.1 only) into a new folder under bake/work/twin-dial/refs/.

Every file is taken from the Google Fonts repository's ofl/ tree, which holds only OFL-licensed families; the
family's OFL.txt is downloaded beside its fonts and SOURCES.json records the URL and the licence of every file.
Nothing here is shipped: the chosen faces are copied into tools/fonts-src/ in round 2 with their OFL.txt.

    python -I tools/twin-dial/vt/fetch_fonts.py <out dir> [family ...]
"""
import json
import os
import sys
import urllib.request

API = 'https://api.github.com/repos/google/fonts/contents/ofl/'
FAMILIES = [
    # squarish / wide display faces (scale numerals, the big readouts)
    'saira', 'tektur', 'exo2', 'oxanium', 'unbounded', 'jura', 'play', 'sarpanch', 'russoone', 'chakrapetch',
    'kanit', 'tomorrow', 'quantico', 'aldrich', 'electrolize', 'goldman', 'rajdhani', 'titilliumweb', 'anta',
    'changa', 'spacegrotesk', 'lexend', 'baijamjuree', 'turretroad', 'michroma', 'orbitron',
    # text faces with Cyrillic (labels, the message line)
    'robotoflex', 'opensans', 'notosans', 'firasans', 'ptsans', 'ubuntusans', 'sourcesans3', 'ibmplexsans',
    'golostext', 'onest', 'commissioner', 'manrope', 'mulish', 'rubik', 'inter', 'nunitosans', 'montserrat',
    'wixmadefortext', 'encodesans', 'archivo', 'sofiasans', 'geologica', 'carlito', 'istokweb',
]
RAW = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
UA = {'User-Agent': 'font-fetch-script'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def main():
    out = sys.argv[1]
    fams = sys.argv[2:] or FAMILIES
    os.makedirs(out, exist_ok=True)
    src_path = os.path.join(out, 'SOURCES.json')
    sources = json.load(open(src_path)) if os.path.exists(src_path) else {}
    for fam in fams:
        if ':' in fam:                      # family:File.ttf - straight from the raw tree (no API, no rate limit)
            fam, fn = fam.split(':', 1)
            d = os.path.join(out, fam)
            os.makedirs(d, exist_ok=True)
            for name in (fn, 'OFL.txt'):
                url = RAW + fam + '/' + name
                p = os.path.join(d, name)
                if not os.path.exists(p):
                    try:
                        data = get(url)
                    except Exception as e:                                          # noqa: BLE001
                        print('   %s/%s failed: %s' % (fam, name, e))
                        continue
                    with open(p, 'wb') as f:
                        f.write(data)
                sources[fam + '/' + name] = {'url': url, 'licence': 'SIL OFL 1.1 (ofl/ tree; ' + fam + '/OFL.txt)'}
            print('%-14s %s' % (fam, fn))
            json.dump(sources, open(src_path, 'w'), indent=1, ensure_ascii=False)
            continue
        try:
            listing = json.loads(get(API + fam))
        except Exception as e:                                                      # noqa: BLE001
            print('%-14s listing failed: %s' % (fam, e))
            continue
        files = [x for x in listing if (x['name'].endswith('.ttf') and 'Italic' not in x['name']) or x['name'] == 'OFL.txt']
        # variable files first; statics only when there is no variable one
        var = [x for x in files if '[' in x['name']]
        stat = [x for x in files if x['name'].endswith('.ttf') and '[' not in x['name']]
        pick = (var if var else stat) + [x for x in files if x['name'] == 'OFL.txt']
        d = os.path.join(out, fam)
        os.makedirs(d, exist_ok=True)
        for x in pick:
            p = os.path.join(d, x['name'])
            if not os.path.exists(p):
                try:
                    data = get(x['download_url'])
                except Exception as e:                                              # noqa: BLE001
                    print('   %s failed: %s' % (x['name'], e))
                    continue
                with open(p, 'wb') as f:                                            # only whole files land
                    f.write(data)
            sources[fam + '/' + x['name']] = {'url': x['download_url'], 'licence': 'SIL OFL 1.1 (ofl/ tree; ' + fam + '/OFL.txt)'}
        print('%-14s %s' % (fam, ' '.join(x['name'] for x in pick)))
        json.dump(sources, open(src_path, 'w'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
