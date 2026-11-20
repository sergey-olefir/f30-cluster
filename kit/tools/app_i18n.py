"""bimmer-lab addition (r1120 LN): apps that speak several languages and switch at run time.

An app.json with "i18n": true takes its words from the repo's string tables, shared/i18n/<lang>.json (one per language,
stable keys; shared/lang.js is the run-time side). The build then:

  - writes every RHMI string bundle in the language of that HMI language: <xx>_<YY>.json gets table <xx> when there is one,
    every other bundle the default table (uk). With the setting "Мова / Language" on Авто and the head unit in Ukrainian or
    English, the HMI shows the right words with nothing done at run time;
  - ships the tables (javascript/i18n/<lang>.json) and the RHMI words of each language (javascript/i18n/rhmi.json), which the
    app writes into its string bundle when the language chosen is not the head unit's (shared/lang.js attach).

The keys of app.json's texts name their place, never the text (kept the same as shared/lang.js specKeys):
  <id>.title, <id>.screen.<NAME>, <id>.btn.<NAME>, <id>.item.<NAME>, <id>.set.<key>, <id>.set.<key>.<value> (an option or a
  number's label), <id>.set.<key>.unit, <id>.group.<first key of the run>; the language row itself is kit.lang / kit.lang.<v>.
A key missing in a table falls back to the default table, then to app.json's own text (bench/test-i18n.js fails on any gap).
Fixed-language builds (--language ru / zh-CN) are untouched: this runs only for the default build.
"""
import copy
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
TABLE_DIR = os.path.join(ROOT, 'shared', 'i18n')
DEFAULT = 'uk'
PREF_KEY = 'lang'


def enabled(spec):
    return spec.get('i18n') is True and os.path.isdir(TABLE_DIR)


def tables():
    out = {}
    for f in sorted(os.listdir(TABLE_DIR)):
        if f.endswith('.json'):
            with open(os.path.join(TABLE_DIR, f), encoding='utf-8') as fh:
                out[f[:-5]] = json.load(fh)
    out.setdefault(DEFAULT, {})
    return out


def spec_keys(spec):
    """[(key, path)] of every text a person reads in app.json (shared/lang.js specKeys, the same order and keys)."""
    i, out = spec['id'], []
    out.append((i + '.title', ('title',)))
    for n, sc in enumerate(spec.get('screens', [])):
        if isinstance(sc.get('title'), str):
            out.append((i + '.screen.' + sc['name'], ('screens', n, 'title')))
        for j, b in enumerate(sc.get('buttons', [])):
            if b[1]:
                out.append((i + '.btn.' + b[0], ('screens', n, 'buttons', j, 1)))
        for j, it in enumerate(sc.get('items', [])):
            if it[0] not in ('setting', 'settings') and len(it) > 2 and isinstance(it[2], str) and it[2]:
                out.append((i + '.item.' + it[1], ('screens', n, 'items', j, 2)))
    group, group_key = None, None
    for n, s in enumerate(spec.get('settings', [])):
        if s.get('group') and s.get('group') != group:
            group_key = i + '.group.' + s['key']
        group = s.get('group') or None
        if s.get('group'):
            out.append((group_key, ('settings', n, 'group')))
        if s['key'] == PREF_KEY:
            continue
        out.append((i + '.set.' + s['key'], ('settings', n, 'label')))
        for j, o in enumerate(s.get('options', [])):
            out.append((i + '.set.' + s['key'] + '.' + str(o[0]), ('settings', n, 'options', j, 1)))
        for k in (s.get('labels') or {}):
            out.append((i + '.set.' + s['key'] + '.' + k, ('settings', n, 'labels', k)))
        if s.get('unit'):
            out.append((i + '.set.' + s['key'] + '.unit', ('settings', n, 'unit')))
    return out


def augment(spec):
    """The settings screen build.py adds by itself (build_ui), made explicit so its title has a key (<id>.screen.SETTINGS)."""
    screens = spec.setdefault('screens', [])
    if spec.get('settings') and not any(sc.get('settings') is True or sc.get('kind') == 'settings' for sc in screens):
        screens.append({'name': 'SETTINGS', 'kind': 'settings', 'title': 'Settings'})
    return spec


def _get(o, p):
    for k in p:
        o = o[k]
    return o


def _set(o, p, v):
    for k in p[:-1]:
        o = o[k]
    o[p[-1]] = v


def word(tbls, lang, key, fallback):
    for t in (tbls.get(lang, {}), tbls.get(DEFAULT, {})):
        if key in t:
            return t[key]
    return fallback


def localize(spec, lang, tbls):
    """A copy of spec with its texts in `lang`; returns (spec, missing keys)."""
    s = copy.deepcopy(spec)
    missing = []
    for key, path in spec_keys(spec):
        src = _get(spec, path)
        if key not in tbls.get(lang, {}):
            missing.append(key)
        _set(s, path, word(tbls, lang, key, src))
    for src, st in zip(spec.get('settings', []), s.get('settings', [])):
        if src.get('group'):
            st['groupName'] = src['group']           # build.py names the heading's component by the source text
        if st['key'] == PREF_KEY:
            st['label'] = word(tbls, lang, 'kit.lang', st['label'])
            for o in st.get('options', []):
                o[1] = word(tbls, lang, 'kit.lang.' + str(o[0]), o[1])
    return s, missing


def finish_strings(strings, lang, tbls):
    """The kit's own words inside the bundle: " (default)" (markDefault rows) and the generated settings screen's title."""
    mark = word(tbls, lang, 'kit.default', '(default)')
    for k, v in list(strings.items()):
        if isinstance(v, str) and ' (default)' in v:
            strings[k] = v.replace(' (default)', ' ' + mark)


def bundle_lang(hmi, tbls):
    """The table an HMI language's bundle gets: its own when we have one (uk_UA -> uk, en_GB -> en), else the default."""
    full = hmi.replace('_', '-')
    if full in tbls:
        return full
    short = hmi.split('_')[0]
    return short if short in tbls else DEFAULT
