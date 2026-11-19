'use strict';
// A minimal DOM for SU2's mount() smoke tests under Node: elements with attributes, classes, children,
// events, innerHTML (kept as text), a small selector engine (tag, .class, [attr="v"], :not(.class)),
// canvases whose 2d context records calls, requestAnimationFrame on a manual queue.
// Not a browser: it proves the views build, react to app events and call app correctly.

function makeDom() {
  const raf = [];
  const ctxCalls = { count: 0 };
  function Elem(tag) {
    const e = {
      tagName: String(tag).toUpperCase(), nodeType: 1, attrs: {}, children: [], style: {}, parentNode: null,
      hidden: false, disabled: false, checked: false, value: '', open: false, _text: '', _html: '', _l: {},
      clientWidth: 800, clientHeight: 140, offsetWidth: 120, offsetHeight: 40, width: 300, height: 150,
    };
    e.classList = {
      _s: new Set(),
      add() { for (const c of arguments) this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); },
    };
    Object.defineProperty(e, 'className', { get() { return [...e.classList._s].join(' '); }, set(v) { e.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); } });
    Object.defineProperty(e, 'textContent', {
      get() { return e._text + e._html.replace(/<[^>]*>/g, '') + e.children.map((c) => c.textContent).join(''); },
      set(v) { e._text = String(v); e._html = ''; e.children = []; },
    });
    Object.defineProperty(e, 'innerHTML', {
      get() { return e._html; },
      set(v) {
        e._html = String(v); e._text = ''; e.children = [];
        if (e._html) { const raw = Elem(/^<svg/.test(e._html) ? 'svg' : 'raw'); raw._html = e._html; raw.parentNode = e; e.children.push(raw); }
      },
    });
    Object.defineProperty(e, 'firstChild', { get() { return e.children[0] || null; } });
    Object.defineProperty(e, 'id', { get() { return e.attrs.id || ''; }, set(v) { e.attrs.id = v; } });
    e.ownerDocument = null;
    e.setAttribute = (k, v) => {
      v = String(v);
      if (k === 'class') { e.className = v; return; }
      e.attrs[k] = v;
      if (k === 'checked') e.checked = true;
      if (k === 'value') e.value = v;
      if (k === 'hidden') e.hidden = true;
      if (k === 'disabled') e.disabled = true;
    };
    e.getAttribute = (k) => (k === 'class' ? e.className : k in e.attrs ? e.attrs[k] : null);
    e.removeAttribute = (k) => { delete e.attrs[k]; };
    e.appendChild = (c) => { if (c.parentNode) c.remove(); e.children.push(c); c.parentNode = e; return c; };
    e.remove = () => { if (e.parentNode) { e.parentNode.children = e.parentNode.children.filter((x) => x !== e); e.parentNode = null; } };
    e.addEventListener = (k, fn) => { (e._l[k] = e._l[k] || []).push(fn); };
    e.removeEventListener = (k, fn) => { e._l[k] = (e._l[k] || []).filter((f) => f !== fn); };
    e.dispatch = (k, ev) => (e._l[k] || []).slice().forEach((fn) => fn(Object.assign({ preventDefault() {}, stopPropagation() {}, target: e, clientX: 100, clientY: 50, deltaX: 0, deltaY: 0, pointerId: 1 }, ev || {})));
    e.click = () => { if (!e.disabled) e.dispatch('click'); };
    e.setPointerCapture = () => {};
    e.getBoundingClientRect = () => ({ left: 0, top: 0, width: e.clientWidth, height: e.clientHeight, right: e.clientWidth, bottom: e.clientHeight });
    e.querySelectorAll = (sel) => { const out = []; walk(e, (n) => { if (n !== e && matches(n, sel)) out.push(n); }); return out; };
    e.querySelector = (sel) => e.querySelectorAll(sel)[0] || null;
    e.getContext = () => recordingContext(ctxCalls);
    return e;
  }
  function walk(n, fn) { fn(n); n.children.forEach((c) => walk(c, fn)); }
  // selector: a comma list of compounds: tag? (.class | [attr="v"] | :not(.class))*
  function matches(n, sel) {
    return sel.split(',').some((part) => {
      const s = part.trim();
      const re = /^([a-zA-Z0-9]*)((?:\.[\w-]+|\[[^\]]+\]|:not\(\.[\w-]+\))*)$/.exec(s);
      if (!re) throw new Error('mini-dom: unsupported selector ' + s);
      if (re[1] && n.tagName !== re[1].toUpperCase()) return false;
      const bits = re[2].match(/\.[\w-]+|\[[^\]]+\]|:not\(\.[\w-]+\)/g) || [];
      return bits.every((b) => {
        if (b[0] === '.') return n.classList.contains(b.slice(1));
        if (b[0] === '[') { const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(b); return m[2] === undefined ? n.getAttribute(m[1]) !== null : n.getAttribute(m[1]) === m[2]; }
        return !n.classList.contains(b.slice(6, -1));
      });
    });
  }
  const document = {
    createElement: (t) => { const e = Elem(t); e.ownerDocument = document; return e; },
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), children: [], classList: { contains() { return false; } }, getAttribute() { return null; }, remove() {} }),
    getElementById: (id) => { let f = null; walk(document.documentElement, (n) => { if (!f && n.attrs && n.attrs.id === id) f = n; }); return f; },
    activeElement: null,
  };
  document.documentElement = Elem('html');
  document.head = Elem('head');
  document.body = Elem('body');
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);
  [document.documentElement, document.head, document.body].forEach((e) => { e.ownerDocument = document; });
  const window = { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2 };
  function flush(max) { let n = 0; while (raf.length && n++ < (max || 100)) raf.shift()(0); }
  return {
    document: document, window: window, ctxCalls: ctxCalls, flush: flush, matches: matches,
    globals: {
      document: document, window: window, devicePixelRatio: 2,
      requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; },
      cancelAnimationFrame: () => {},
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
    },
  };
}

function recordingContext(calls) {
  const ctx = {};
  return new Proxy(ctx, {
    get(o, k) { if (k in o) return o[k]; return function () { calls.count++; calls[k] = (calls[k] || 0) + 1; }; },
    set(o, k, v) { o[k] = v; return true; },
  });
}

function install(dom) { Object.keys(dom.globals).forEach((k) => { global[k] = dom.globals[k]; }); }

module.exports = { makeDom: makeDom, install: install };
