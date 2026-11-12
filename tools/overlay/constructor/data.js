// Overlay constructor: loading and validating the data files (no build, no deps).
// Paths are repo-relative; the page lives at tools/overlay/constructor/, so ROOT climbs three levels.
'use strict';
window.OC = window.OC || {};
(function (OC) {
  const ROOT = '../../../';
  OC.ROOT = ROOT;
  OC.PANEL_W = 1920;
  OC.PANEL_H = 720;

  const REL = ['over', 'under', 'gone', 'unknown'];
  const SAF = ['critical', 'info', 'cosmetic'];
  const GROUPS = ['telltale', 'bottom-row', 'map-nav', 'assist-message', 'structure', 'overlay'];
  const KINDS = ['dial', 'text', 'icon', 'background', 'needle', 'sign', 'arc', 'hole'];
  const ANCHORS = ['speedo', 'tacho', 'mini.fuel', 'mini.oil', 'window'];
  OC.ENUM = { REL, SAF, GROUPS, KINDS, ANCHORS, DECISIONS: ['keep-clear', 'reveal', 'cover', 'redraw', 'drop'] };

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isPt = (p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
  const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every(isNum) && b[2] > b[0] && b[3] > b[1];
  const isPoly = (p) => Array.isArray(p) && p.length >= 3 && p.every(isPt);
  OC.isBox = isBox;
  OC.isPoly = isPoly;

  // ---- sha256 (crypto.subtle on localhost; a small JS fallback otherwise) ----
  function jsSha256(bytes) {
    const primes = [];
    for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n);
    const frac = (x) => ((x - Math.floor(x)) * 4294967296) >>> 0;
    const K = primes.map((p) => frac(Math.cbrt(p)));
    let H = primes.slice(0, 8).map((p) => frac(Math.sqrt(p)));
    const l = bytes.length;
    const nb = (((l + 9) + 63) >> 6) << 6;
    const m = new Uint8Array(nb);
    m.set(bytes);
    m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(nb - 4, (l * 8) >>> 0);
    dv.setUint32(nb - 8, Math.floor((l * 8) / 4294967296));
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < nb; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + 4 * i);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      const v = [a, b, c, d, e, f, g, h];
      H = H.map((x, i) => (x + v[i]) | 0);
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  OC.jsSha256 = jsSha256;
  OC.sha256 = async function (buf) {
    try {
      if (window.crypto && crypto.subtle) {
        const d = await crypto.subtle.digest('SHA-256', buf);
        return 'sha256:' + Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* fall through */ }
    return 'sha256:' + jsSha256(new Uint8Array(buf));
  };

  // ---- fetching ----
  async function fetchRaw(path) {
    let r;
    try {
      r = await fetch(ROOT + path, { cache: 'no-store' });
    } catch (e) {
      return { ok: false, why: 'could not fetch (' + e.message + ')' };
    }
    if (!r.ok) return { ok: false, status: r.status, why: 'HTTP ' + r.status + (r.status === 404 ? ', file missing' : '') };
    return { ok: true, buf: await r.arrayBuffer() };
  }
  OC.fetchRaw = fetchRaw;

  function parse(buf, path, errs) {
    try {
      return JSON.parse(new TextDecoder().decode(buf));
    } catch (e) {
      errs.push(path + ': not valid JSON (' + e.message + ')');
      return null;
    }
  }

  function needObject(doc, path, kind, req, errs) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      errs.push(path + ': not a JSON object');
      return false;
    }
    if (doc.kind !== kind) {
      errs.push(path + ': "kind" is ' + JSON.stringify(doc.kind) + ', expected "' + kind + '"');
      return false;
    }
    const miss = req.filter((k) => !(k in doc));
    if (miss.length) errs.push(path + ': missing required field(s) ' + miss.map((k) => '"' + k + '"').join(', '));
    return true;
  }

  function checkG20(doc, path, errs, warns) {
    if (!needObject(doc, path, 'g20-elements', ['schema_version', 'mode', 'target', 'panel', 'photos', 'elements'], errs)) return null;
    if (!Array.isArray(doc.elements)) {
      errs.push(path + ': "elements" is not an array');
      return null;
    }
    const out = [];
    const seen = new Set();
    doc.elements.forEach((e, i) => {
      const where = path + ' elements[' + i + ']' + (e && e.id ? ' (' + e.id + ')' : '');
      if (!e || typeof e !== 'object') return errs.push(where + ': not an object, skipped');
      const bad = [];
      if (typeof e.id !== 'string' || !e.id) bad.push('id');
      if (!isBox(e.bbox)) bad.push('bbox');
      if (!REL.includes(e.relation)) bad.push('relation');
      if (!SAF.includes(e.safety)) bad.push('safety');
      if (e.poly != null && !isPoly(e.poly)) bad.push('poly');
      if (bad.length) return errs.push(where + ': missing or invalid ' + bad.join(', ') + '; element skipped');
      if (seen.has(e.id)) return errs.push(where + ': duplicate id, skipped');
      const soft = ['group', 'name', 'colour', 'states', 'evidence', 'relation_basis'].filter((k) => !(k in e));
      if (soft.length) warns.push(where + ': missing ' + soft.join(', '));
      if (!GROUPS.includes(e.group)) warns.push(where + ': unknown group ' + JSON.stringify(e.group));
      seen.add(e.id);
      out.push(e);
    });
    return out;
  }

  function checkWb(doc, path, errs, warns) {
    if (!needObject(doc, path, 'wb-elements', ['schema_version', 'mode', 'target', 'panel', 'anchors', 'elements'], errs)) return null;
    if (!Array.isArray(doc.elements)) {
      errs.push(path + ': "elements" is not an array');
      return null;
    }
    const anchors = {};
    (Array.isArray(doc.anchors) ? doc.anchors : []).forEach((a, i) => {
      if (!a || typeof a.id !== 'string' || !isPt(a.centre)) return errs.push(path + ' anchors[' + i + ']: needs id and centre [x, y]; skipped');
      anchors[a.id] = a;
    });
    const out = [];
    const seen = new Set();
    doc.elements.forEach((e, i) => {
      const where = path + ' elements[' + i + ']' + (e && e.id ? ' (' + e.id + ')' : '');
      if (!e || typeof e !== 'object') return errs.push(where + ': not an object, skipped');
      const bad = [];
      if (typeof e.id !== 'string' || !e.id) bad.push('id');
      if (!isBox(e.bbox)) bad.push('bbox');
      if (!KINDS.includes(e.kind)) bad.push('kind');
      if (!isNum(e.z)) bad.push('z');
      if (e.mask != null && typeof e.mask !== 'string') bad.push('mask');
      if (bad.length) return errs.push(where + ': missing or invalid ' + bad.join(', ') + '; element skipped');
      if (seen.has(e.id)) return errs.push(where + ': duplicate id, skipped');
      if (e.anchor != null && !anchors[e.anchor]) {
        warns.push(where + ': anchor ' + JSON.stringify(e.anchor) + ' is not defined in "anchors"; treated as none');
        e.anchor = null;
      }
      const soft = ['source', 'cluster', 'movable', 'anchor'].filter((k) => !(k in e));
      if (soft.length) warns.push(where + ': missing ' + soft.join(', '));
      if (e.hole && !isBox(e.hole.rect)) {
        warns.push(where + ': hole.rect invalid, hole ignored');
        e.hole = null;
      }
      seen.add(e.id);
      out.push(e);
    });
    return { elements: out, anchors };
  }

  const DEFAULT_CONSTRAINTS = {
    geometry: { R: 335, speedo_centre: [412, 380], tacho_centre: [1508, 380] },
    hood: [[0, 200], [100, 145], [200, 94], [300, 52], [400, 33], [500, 24], [600, 19], [700, 13], [800, 12], [900, 13], [1000, 14], [1100, 13], [1200, 15], [1300, 20], [1400, 28], [1500, 33], [1600, 48], [1700, 88], [1800, 139], [1900, 205], [1920, 225]],
    rects: { BLACK_BOX: [1420, 320, 1611, 440], BELT: [587, 665, 626, 720], GEAR: [1392, 664, 1428, 706] },
  };

  function checkConstraints(doc, path, errs, warns) {
    const c = JSON.parse(JSON.stringify(DEFAULT_CONSTRAINTS));
    c.visible = null;
    if (!doc) return c;
    if (!needObject(doc, path, 'constraints', ['schema_version', 'panel', 'platform', 'visibility', 'bmw_over'], errs)) return c;
    const g = doc.geometry || {};
    if (isNum(g.R) && isPt(g.speedo_centre) && isPt(g.tacho_centre)) c.geometry = { R: g.R, speedo_centre: g.speedo_centre, tacho_centre: g.tacho_centre };
    else warns.push(path + ': geometry (R, speedo_centre, tacho_centre) missing; using R 335, (412,380), (1508,380)');
    const v = doc.visibility || {};
    if (v.hood && Array.isArray(v.hood.polyline) && v.hood.polyline.every(isPt)) c.hood = v.hood.polyline;
    else warns.push(path + ': visibility.hood.polyline missing; using the built-in copy');
    if (v.visible_area && isPoly(v.visible_area.poly)) c.visible = v.visible_area.poly;
    const b = doc.bmw_over || {};
    for (const k of ['BLACK_BOX', 'BELT', 'GEAR']) {
      if (b[k] && isBox(b[k].rect)) c.rects[k] = b[k].rect;
      else warns.push(path + ': bmw_over.' + k + '.rect missing; using the built-in copy');
    }
    c.platform = doc.platform || null;
    return c;
  }

  // Loads the three JSON files. Never throws; problems go to errs / warns.
  OC.loadData = async function (dataset, customDir) {
    const dir = customDir || (dataset === 'sample' ? 'design/overlay/sample/' : 'design/overlay/');
    const files = { g20: dir + 'g20_comfort.json', wb: dir + 'wb_comfort.json', constraints: 'design/overlay/constraints.json' };
    const errs = [];
    const warns = [];
    const [rg, rw, rc] = await Promise.all([fetchRaw(files.g20), fetchRaw(files.wb), fetchRaw(files.constraints)]);
    const out = { files, errs, warns, g20doc: null, wbdoc: null, g20: [], wb: [], anchors: {}, sha: {}, raw: {} };
    if (!rg.ok) errs.push(files.g20 + ': ' + rg.why);
    if (!rw.ok) errs.push(files.wb + ': ' + rw.why);
    if (!rc.ok) warns.push(files.constraints + ': ' + rc.why + '; using built-in hood, dial and BMW-over geometry');
    if (rg.ok) {
      out.raw.g20 = rg.buf;
      out.sha.g20 = await OC.sha256(rg.buf);
      out.g20doc = parse(rg.buf, files.g20, errs);
      if (out.g20doc) {
        const r = checkG20(out.g20doc, files.g20, errs, warns);
        if (r) out.g20 = r;
        else out.g20doc = null; // file-level problem (wrong kind, no elements array): fatal
      }
    }
    if (rw.ok) {
      out.raw.wb = rw.buf;
      out.sha.wb = await OC.sha256(rw.buf);
      out.wbdoc = parse(rw.buf, files.wb, errs);
      if (out.wbdoc) {
        const r = checkWb(out.wbdoc, files.wb, errs, warns);
        if (r) {
          out.wb = r.elements;
          out.anchors = r.anchors;
        } else out.wbdoc = null;
      }
    }
    const cdoc = rc.ok ? parse(rc.buf, files.constraints, warns) : null;
    out.constraints = checkConstraints(cdoc, files.constraints, warns, warns);
    return out;
  };

  function loadImage(url) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = url;
    });
  }
  OC.loadImage = loadImage;

  // Mask PNG -> {w, h, bin (alpha >= 64), alpha}. Grey PNGs without an alpha channel use their luminance.
  OC.loadMask = async function (path) {
    const im = await loadImage(ROOT + path);
    if (!im) return null;
    const w = im.naturalWidth;
    const h = im.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, w, h).data;
    const n = w * h;
    let allOpaque = true;
    let anyDark = false;
    for (let i = 0; i < n; i++) {
      if (d[4 * i + 3] !== 255) { allOpaque = false; break; }
      if (d[4 * i] < 255) anyDark = true;
    }
    const lum = allOpaque && anyDark;
    const alpha = new Uint8ClampedArray(n);
    const bin = new Uint8Array(n);
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = lum ? d[4 * i] : d[4 * i + 3];
      alpha[i] = a;
      if (a >= 64) { bin[i] = 1; area++; }
    }
    return { w, h, alpha, bin, area, fromLuminance: lum };
  };

  // Photos: bake/work/overlay/rect/H.json lists what package B rectified; only those PNGs are requested.
  OC.loadPhotoIndex = async function () {
    const r = await fetchRaw('bake/work/overlay/rect/H.json');
    if (!r.ok) return null;
    try {
      return JSON.parse(new TextDecoder().decode(r.buf));
    } catch (e) {
      return null;
    }
  };
})(window.OC);
