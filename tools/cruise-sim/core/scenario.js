(function () {
'use strict';
// (wrapped in a function: the page loads core/*.js as classic scripts, which share one global scope)
/*
 * Scenario files: load, validate, expand a sweep (SC3).
 *
 *   load(idOrObject) -> a RUNNABLE concrete scenario: a file's id gives its default variant (params at their defaults, no
 *                       sweep, its first reaction case); a concrete id from expand() ("D.brake#v=90,dv=20,a=-1") gives that
 *                       variant; an object is normalized and, if it is a template, resolved the same way
 *   template(idOrObject) -> the normalized file (extends resolved, defaults filled, expressions kept)
 *   validate(s)      -> { ok, errors: [string] }       (a scenario file or a concrete scenario)
 *   expand(s)        -> [concrete scenario]            (sweep x variants x reaction cases, `where` applied)
 *   list()           -> [{ id, family, name, scope, file }]
 *   toConfig(concrete, base) -> run config (scenario.inline = concrete, the concrete's configPatch merged in)
 *   register(array)  -> registers scenario objects (the browser has no file system: the page registers a bundle)
 *
 * A scenario file is the CONTRACT's shape plus these additive keys, all resolved by expand() so that a concrete
 * scenario is plain numbers and the engine never sees them:
 *
 *   params:   { name: number | "=expr" }      evaluated in order; a sweep key "params.x" (or just "x") sets one
 *   "=expr"   any string value starting with "=" is arithmetic over the params: + - * / % ( ) ?: < > <= >= == != && || !
 *             and min max abs round floor ceil sqrt clamp(x,lo,hi) sign pow
 *   "{expr}"  inside any other string: replaced by the value (ids like "p{k}")
 *   { "$repeat": n, "$as": "k", "items": [templates] }   inside an array: n copies of the templates with k = 0..n-1
 *   extends:  "<scenario id>"                 deep merge onto that scenario (arrays replace; "vehicles+" / "events+" append)
 *   sweep:    { key: [values] }               cross product. Keys: "params.x" | "x" (a param) | "config.a.b" (a config patch)
 *                                             | "cond.<group>" (a named patch of PATCHES below) | a scenario path
 *                                             ("vehicles[lead].profile.points[1][1]", [name] picks an element by id)
 *   variants: [ { key: value, ... } ]         zipped cases, crossed with the sweep (each object is one case)
 *   where:    "=expr"                         drops the combinations for which it is false
 *   worstOver:[param names]                   the batch reduces over these by the worst outcome ("at the worst time")
 *   reactions:['react'|'late'|'none']         the driver-reaction cases (default by scope, see DEFAULT_REACTIONS)
 *   decide:   [metric names]                  the metrics that decide it (default by scope); split per reaction case
 *   tags:     [string]                        free labels (e.g. "core" = in the representative set of the first map)
 *   config:   { module: { key: value | "=expr" } }   a config patch every variant carries (e.g. sensor settings)
 *   generator:{ ... }                         family L only: the mixed-driving generator's settings (core/mixed.js)
 *
 * Units: as the CONTRACT (SI, km/h only in names ending _kmh). x0 of a vehicle is its bumper-to-bumper gap ahead of the ego
 * (negative = behind: then it is the gap from its front to our rear).
 */

function metricsMod() { return typeof require !== 'undefined' ? require('./metrics') : self.CS.metrics; }

var FAMILIES = {
  A: 'Free driving', B: 'Approach', C: 'Following', D: 'Lead braking', E: 'Cut-in', F: 'Cut-out',
  G: 'Sensing faults', H: 'Road and envelope', I: 'Driver', J: 'System failures', K: 'Replay', L: 'Mixed driving'
};
var SCOPES = ['in', 'warnOnly', 'outOfEnvelope'];
var REACTIONS = ['react', 'late', 'none'];
var KINDS = ['car', 'truck', 'moto', 'static'];
var PROFILE_TYPES = ['const', 'piecewise', 'accel', 'steps', 'sine', 'stopgo', 'idm', 'replay', 'static'];
var EVENT_KINDS = ['cutIn', 'cutOut', 'laneChange', 'driverVmax', 'driverBrake', 'driverResume', 'driverOverride',
  'driverCancel', 'fault'];
// SC1's core/failures.js kinds (the scenario event { t, kind: 'fault', fault: <kind>, duration?, ...options })
var FAULT_KINDS = ['appStop', 'huRestart', 'gapFreeze', 'sensorBlind', 'commandLost', 'setStuck', 'cruiseDropout', 'stall',
  'ghost', 'rangeCut', 'latencySpike', 'dropBurst', 'degraded'];
var DIMS = { car: [4.6, 1.8], truck: [16.5, 2.55], moto: [2.2, 0.8], static: [4.6, 1.8] };

// Named config patches. The ONE place where a scenario's condition becomes SC1/SC2 config keys: when their modules name a
// key differently, this table changes and no scenario file does.
var PATCHES = {
  'sensing.clear': {},
  'sensing.rain': { sensor: { preset: 'rain' } },
  'sensing.lowSun': { sensor: { preset: 'lowSun' } },
  'sensing.night': { sensor: { preset: 'night' } },
  'reaction.react': { driver: { reactionCase: 'nominal' } },
  'reaction.late': { driver: { reactionCase: 'late' } },
  'reaction.none': { driver: { reactionCase: 'none' } },
  'command.nominal': {},
  'command.worst': { command: { preset: 'worst' } },
  'ego.ours': {},
  'ego.idealAcc': { ego: { mode: 'idealAcc' } },
  'ego.human': { ego: { mode: 'human' } }
};

var DEFAULT_REACTIONS = { 'in': ['none'], warnOnly: ['react', 'late', 'none'], outOfEnvelope: ['react', 'none'] };
var DEFAULT_DECIDE = {
  'in': ['collision', 'minTimeGap_s', 'minTTC_s', 'nuisanceWarnings'],
  warnOnly: ['collision', 'missedWarning', 'warnLeadTime_s'],
  outOfEnvelope: ['collision', 'envelopeExitAnnounced', 'missedWarning']
};
// Metrics judged on the run where the driver does NOT react (the system alone): the warning's timing and need.
var WARN_METRICS = ['missedWarning', 'warnLeadTime_s', 'nuisanceWarnings', 'warnCount', 'envelopeExitAnnounced',
  'faultDetectDelay_s'];

// ---------------------------------------------------------------- expressions
function tokenize(src) {
  var toks = [], i = 0, m;
  var re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|&&|\|\||[-+*\/%()?:<>!,]))/y;
  while (i < src.length) {
    re.lastIndex = i;
    m = re.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(i))) break; throw new Error('bad expression near "' + src.slice(i) + '" in "' + src + '"'); }
    if (m[1] !== undefined) toks.push({ t: 'n', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) toks.push({ t: 'id', v: m[2] });
    else toks.push({ t: 'op', v: m[3] });
    i = re.lastIndex;
  }
  return toks;
}
var FUNCS = {
  min: Math.min, max: Math.max, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, sqrt: Math.sqrt,
  sign: Math.sign, pow: Math.pow, clamp: function (x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
};
function evalExpr(src, env) {
  var toks = tokenize(src), p = 0;
  function peek(v) { return toks[p] && toks[p].t === 'op' && toks[p].v === v; }
  function eat(v) { if (!peek(v)) throw new Error('expected "' + v + '" in "' + src + '"'); p++; }
  function ternary() {
    var c = or();
    if (peek('?')) { p++; var a = ternary(); eat(':'); var b = ternary(); return c ? a : b; }
    return c;
  }
  function or() { var a = and(); while (peek('||')) { p++; var b = and(); a = (a || b) ? 1 : 0; } return a; }
  function and() { var a = cmp(); while (peek('&&')) { p++; var b = cmp(); a = (a && b) ? 1 : 0; } return a; }
  function cmp() {
    var a = add();
    for (;;) {
      var o = toks[p] && toks[p].t === 'op' ? toks[p].v : null;
      if (['<', '>', '<=', '>=', '==', '!='].indexOf(o) < 0) return a;
      p++; var b = add();
      a = (o === '<' ? a < b : o === '>' ? a > b : o === '<=' ? a <= b : o === '>=' ? a >= b : o === '==' ? a === b : a !== b) ? 1 : 0;
    }
  }
  function add() {
    var a = mul();
    while (peek('+') || peek('-')) { var o = toks[p++].v, b = mul(); a = o === '+' ? a + b : a - b; }
    return a;
  }
  function mul() {
    var a = unary();
    while (peek('*') || peek('/') || peek('%')) { var o = toks[p++].v, b = unary(); a = o === '*' ? a * b : o === '/' ? a / b : a % b; }
    return a;
  }
  function unary() {
    if (peek('-')) { p++; return -unary(); }
    if (peek('+')) { p++; return unary(); }
    if (peek('!')) { p++; return unary() ? 0 : 1; }
    return primary();
  }
  function primary() {
    var tk = toks[p++];
    if (!tk) throw new Error('unexpected end of "' + src + '"');
    if (tk.t === 'n') return tk.v;
    if (tk.t === 'op' && tk.v === '(') { var v = ternary(); eat(')'); return v; }
    if (tk.t === 'id') {
      if (peek('(')) {
        p++; var args = [];
        if (!peek(')')) { args.push(ternary()); while (peek(',')) { p++; args.push(ternary()); } }
        eat(')');
        if (!FUNCS[tk.v]) throw new Error('unknown function ' + tk.v + ' in "' + src + '"');
        return FUNCS[tk.v].apply(null, args);
      }
      if (!Object.prototype.hasOwnProperty.call(env, tk.v)) throw new Error('unknown name "' + tk.v + '" in "' + src + '"');
      var x = env[tk.v];
      if (typeof x !== 'number') throw new Error('"' + tk.v + '" is not a number in "' + src + '"');
      return x;
    }
    throw new Error('unexpected "' + tk.v + '" in "' + src + '"');
  }
  var out = ternary();
  if (p !== toks.length) throw new Error('trailing input in "' + src + '"');
  return out;
}

function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

function resolveValue(x, env) {
  if (typeof x === 'string') {
    if (x.charAt(0) === '=') return evalExpr(x.slice(1), env);
    if (x.indexOf('{') >= 0) {
      return x.replace(/\{([^{}]+)\}/g, function (_, e) { var v = evalExpr(e, env); return String(Math.round(v * 1e6) / 1e6); });
    }
    return x;
  }
  if (Array.isArray(x)) {
    var out = [];
    x.forEach(function (el) {
      if (isObj(el) && el.$repeat !== undefined) {
        var n = Math.round(resolveValue(el.$repeat, env)), as = el.$as || 'k';
        for (var k = 0; k < n; k++) {
          var e2 = Object.assign({}, env); e2[as] = k;
          (el.items || [el.item]).forEach(function (it) { out.push(resolveValue(clone(it), e2)); });
        }
      } else out.push(resolveValue(el, env));
    });
    return out;
  }
  if (isObj(x)) {
    var o = {};
    Object.keys(x).forEach(function (k) { o[k] = resolveValue(x[k], env); });
    return o;
  }
  return x;
}

// ---------------------------------------------------------------- paths
function parsePath(path) {
  var parts = [], re = /([^.\[\]]+)|\[([^\]]+)\]/g, m;
  while ((m = re.exec(path))) {
    if (m[1] !== undefined) parts.push(m[1]);
    else parts.push(/^-?\d+$/.test(m[2]) ? parseInt(m[2], 10) : { id: m[2] });
  }
  return parts;
}
function stepInto(cur, key, path) {
  if (isObj(key)) {
    if (!Array.isArray(cur)) throw new Error('[' + key.id + '] on a non-array in ' + path);
    for (var i = 0; i < cur.length; i++) if (cur[i] && cur[i].id === key.id) return i;
    throw new Error('no element with id "' + key.id + '" in ' + path);
  }
  return key;
}
function setPath(obj, path, value) {
  var parts = parsePath(path), cur = obj;
  for (var i = 0; i < parts.length - 1; i++) {
    var k = stepInto(cur, parts[i], path);
    if (cur[k] === undefined || cur[k] === null) cur[k] = typeof parts[i + 1] === 'number' ? [] : {};
    cur = cur[k];
  }
  cur[stepInto(cur, parts[parts.length - 1], path)] = value;
}
function getPath(obj, path) {
  var parts = parsePath(path), cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[stepInto(cur, parts[i], path)];
  }
  return cur;
}

function deepMerge(a, b) {
  if (!isObj(a) || !isObj(b)) return clone(b);
  var o = clone(a);
  Object.keys(b).forEach(function (k) { o[k] = isObj(o[k]) && isObj(b[k]) ? deepMerge(o[k], b[k]) : clone(b[k]); });
  return o;
}

// ---------------------------------------------------------------- registry
var registry = null, files = {};
function scenarioDir() {
  var path = require('path');
  return path.join(__dirname, '..', 'scenarios');
}
function loadRegistry() {
  if (registry) return registry;
  registry = {};
  if (typeof self !== 'undefined' && self.CS && Array.isArray(self.CS.scenarioBundle)) {
    self.CS.scenarioBundle.forEach(function (s) { registry[s.id] = s; });   // the page: scenarios.bundle.js (bundleJs())
  }
  if (typeof require === 'undefined' || typeof __dirname === 'undefined') return registry;
  var fs = require('fs'), path = require('path'), dir = scenarioDir();
  Object.keys(FAMILIES).forEach(function (fam) {
    var d = path.join(dir, fam);
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d).filter(function (f) { return /\.json$/.test(f); }).sort().forEach(function (f) {
      var file = path.join(d, f), s;
      try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(file + ': ' + e.message); }
      if (registry[s.id]) throw new Error('duplicate scenario id ' + s.id + ' in ' + file);
      registry[s.id] = s; files[s.id] = path.relative(path.join(dir, '..'), file);
    });
  });
  return registry;
}
function register(arr) {
  loadRegistry();
  (Array.isArray(arr) ? arr : [arr]).forEach(function (s) { registry[s.id] = s; });
}
function raw(id) {
  var r = loadRegistry();
  if (!r[id]) throw new Error('unknown scenario ' + id);
  return r[id];
}

function list() {
  var r = loadRegistry();
  return Object.keys(r).sort(idOrder).map(function (id) {
    var s = r[id];
    return { id: id, family: s.family, name: s.name, scope: s.scope || 'in', tags: s.tags || [], file: files[id] || null };
  });
}
function idOrder(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// ---------------------------------------------------------------- load / normalize
function resolveExtends(s, seen) {
  if (!s.extends) return clone(s);
  seen = seen || [];
  if (seen.indexOf(s.extends) >= 0) throw new Error('extends cycle at ' + s.extends);
  var base = resolveExtends(raw(s.extends), seen.concat([s.extends]));
  var child = clone(s);
  ['sweep', 'variants', 'where', 'worstOver', 'reactions', 'decide', 'tags'].forEach(function (k) {
    if (child[k] !== undefined) delete base[k];
  });
  var addV = child['vehicles+'], addE = child['events+'];
  delete child['vehicles+']; delete child['events+'];
  var out = deepMerge(base, child);
  if (addV) out.vehicles = (out.vehicles || []).concat(addV);
  if (addE) out.events = (out.events || []).concat(addE);
  out.extendsChain = [s.extends].concat(base.extendsChain || []);
  delete out.extends;
  return out;
}

function normalize(s) {
  s = resolveExtends(s);
  s.scope = s.scope || 'in';
  if (!s.family && s.id) s.family = s.id.charAt(0);
  s.reactions = s.reactions || DEFAULT_REACTIONS[s.scope] || ['none'];
  s.decide = s.decide || DEFAULT_DECIDE[s.scope];
  s.road = s.road || {};
  if (s.road.lanes === undefined) s.road.lanes = 2;
  s.ego = s.ego || {};
  if (s.ego.lane === undefined) s.ego.lane = 0;
  s.vehicles = s.vehicles || [];
  s.events = s.events || [];
  s.params = s.params || {};
  s.tags = s.tags || [];
  return s;
}

function template(idOrObject) {
  return normalize(typeof idOrObject === 'string' ? raw(idOrObject) : idOrObject);
}
function load(idOrObject) {
  if (typeof idOrObject === 'string') {
    var hash = idOrObject.indexOf('#'), slash = idOrObject.lastIndexOf('/');
    var base = hash >= 0 ? idOrObject.slice(0, hash) : (slash > 0 ? idOrObject.slice(0, slash) : idOrObject);
    if (base !== idOrObject) {
      var hit = expand(base).filter(function (c) { return c.id === idOrObject || c.key === idOrObject; })[0];
      if (!hit) throw new Error('unknown scenario variant ' + idOrObject);
      return hit;
    }
  } else if (idOrObject && idOrObject.base !== undefined) return idOrObject;   // already concrete
  var s = template(idOrObject);
  if (s.family === 'L' && s.generator) return expand(s)[0];
  var c = buildConcrete(s, {});
  var r = s.reactions[0];
  c.reaction = r; c.id = c.key; c.decide = decideFor(s, r);
  c.configPatch = deepMerge(c.configPatch, PATCHES['reaction.' + r]);
  return c;
}

// ---------------------------------------------------------------- expand
function classifyKey(key, params) {
  if (key.indexOf('params.') === 0) return { kind: 'param', name: key.slice(7) };
  if (key.indexOf('config.') === 0) return { kind: 'config', path: key.slice(7) };
  if (key.indexOf('cond.') === 0) return { kind: 'cond', group: key.slice(5) };
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && Object.prototype.hasOwnProperty.call(params, key)) return { kind: 'param', name: key };
  return { kind: 'path', path: key };
}
function shortLabel(key) {
  var c = key.replace(/^(params|config|cond)\./, '');
  var parts = parsePath(c), last = parts[parts.length - 1];
  return typeof last === 'number' ? c.replace(/[^A-Za-z0-9]+/g, '_') : String(last.id || last);
}
function fmt(v) { return typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v); }

function cross(axes) {
  var out = [{}];
  axes.forEach(function (ax) {
    var next = [];
    out.forEach(function (o) { ax.values.forEach(function (v) { var c = Object.assign({}, o); c[ax.key] = v; next.push(c); }); });
    out = next;
  });
  return out;
}

function decideFor(s, reaction) {
  if (s.decideByCase && s.decideByCase[reaction]) return s.decideByCase[reaction].slice();
  if (s.scope === 'in' || s.reactions.length === 1) return s.decide.slice();
  if (reaction === 'late') return [];
  var hasNone = s.reactions.indexOf('none') >= 0, hasReact = s.reactions.indexOf('react') >= 0;
  return s.decide.filter(function (m) {
    var w = WARN_METRICS.indexOf(m) >= 0;
    if (reaction === 'none') return w || !hasReact;
    if (reaction === 'react') return !w || !hasNone;
    return true;
  });
}

function expand(sIn) {
  var s = template(sIn);
  if (s.family === 'L' && s.generator) {
    var mixed = typeof require !== 'undefined' ? require('./mixed') : self.CS.mixed;
    return mixed.generate(s);
  }
  var axes = Object.keys(s.sweep || {}).map(function (k) { return { key: k, values: s.sweep[k] }; });
  var combos = cross(axes);
  var variants = s.variants && s.variants.length ? s.variants : [{}];
  var out = [];
  combos.forEach(function (combo) {
    variants.forEach(function (vr) {
      var assign = Object.assign({}, combo, vr);
      var c = buildConcrete(s, assign);
      if (!c) return;
      s.reactions.forEach(function (r) {
        var cc = clone(c);
        cc.reaction = r;
        cc.id = c.key + (s.reactions.length > 1 || r !== 'none' ? '/' + r : '');
        cc.configPatch = deepMerge(cc.configPatch, PATCHES['reaction.' + r]);
        cc.decide = decideFor(s, r);
        out.push(cc);
      });
    });
  });
  return out;
}

function buildConcrete(s, assign) {
  var body = clone(s);
  ['sweep', 'variants', 'where', 'reactions', 'decideByCase', 'extendsChain'].forEach(function (k) { delete body[k]; });
  delete body.config;
  var params = clone(s.params), configPatch = {}, label = [], variant = {};
  var keys = Object.keys(assign);
  keys.forEach(function (k) {
    var c = classifyKey(k, params), v = assign[k];
    variant[k] = v;
    if (c.kind === 'param') params[c.name] = v;
    label.push(shortLabel(k) + '=' + fmt(v));
  });
  // params in declaration order, then the sweep's raw values keep precedence
  var env = {};
  Object.keys(params).forEach(function (k) {
    var v = params[k];
    env[k] = typeof v === 'string' ? resolveValue(v, env) : v;
  });
  if (s.where !== undefined && !resolveValue(s.where, env)) return null;
  if (s.config) configPatch = deepMerge(configPatch, resolveValue(s.config, env));
  keys.forEach(function (k) {
    var c = classifyKey(k, params), v = resolveValue(assign[k], env);
    if (c.kind === 'config') setPath(configPatch, c.path, v);
    else if (c.kind === 'cond') {
      var p = PATCHES[c.group + '.' + v];
      if (!p) throw new Error(s.id + ': unknown condition ' + c.group + '.' + v);
      configPatch = deepMerge(configPatch, p);
    } else if (c.kind === 'path') setPath(body, k, v);
  });
  delete body.params;
  var res = resolveValue(body, env);
  res.vehicles.forEach(function (v) {
    var d = DIMS[v.kind || 'car'] || DIMS.car;
    if (v.kind === undefined) v.kind = 'car';
    if (v.length === undefined) v.length = d[0];
    if (v.width === undefined) v.width = d[1];
    if (v.lane === undefined) v.lane = 0;
    if (v.kind === 'static') { v.v0_kmh = 0; if (!v.profile) v.profile = { type: 'const' }; }
  });
  res.events.sort(function (a, b) { return a.t - b.t; });
  res.base = s.id;
  res.params = env;
  res.variant = variant;
  res.label = label.join(',');
  res.key = s.id + (label.length ? '#' + res.label : '');
  var worst = s.worstOver || [];
  res.groupKey = s.id + '#' + label.filter(function (l, i) {
    var k = keys[i], c = classifyKey(k, s.params);
    return worst.indexOf(c.name || k) < 0;
  }).join(',');
  res.configPatch = configPatch;
  if (s.duration !== undefined) res.duration = resolveValue(s.duration, env);
  return res;
}

// ---------------------------------------------------------------- validate
function validate(s) {
  var errors = [], concrete = s && s.base !== undefined;
  function err(m) { errors.push((s && s.id ? s.id + ': ' : '') + m); }
  if (!isObj(s)) return { ok: false, errors: ['not an object'] };
  if (typeof s.id !== 'string' || !/^[A-L]\.[A-Za-z0-9.+\-_]+/.test(s.id)) err('id must look like "D.brake.hard"');
  if (s.family && s.id && s.id.charAt(0) !== s.family) err('family ' + s.family + ' does not match the id');
  if (s.family && !FAMILIES[s.family]) err('unknown family ' + s.family);
  if (!s.extends) {
    if (typeof s.name !== 'string' || !s.name) err('name missing');
    if (typeof s.description !== 'string' || !s.description) err('description missing');
  }
  if (s.scope !== undefined && SCOPES.indexOf(s.scope) < 0) err('scope must be one of ' + SCOPES.join(', '));
  if (s.reactions) s.reactions.forEach(function (r) { if (REACTIONS.indexOf(r) < 0) err('unknown reaction case ' + r); });
  var known = metricsMod().METRICS.map(function (m) { return m.key; });
  (s.decide || []).forEach(function (m) { if (known.indexOf(m) < 0) err('decide: unknown metric ' + m); });
  if (s.decideByCase) Object.keys(s.decideByCase).forEach(function (r) {
    s.decideByCase[r].forEach(function (m) { if (known.indexOf(m) < 0) err('decideByCase: unknown metric ' + m); });
  });
  if (s.family === 'L' && s.generator) return { ok: errors.length === 0, errors: errors };
  if (!concrete) {
    if (s.extends) { try { raw(s.extends); } catch (e) { err('extends: ' + e.message); } }
    if (s.sweep !== undefined) {
      if (!isObj(s.sweep)) err('sweep must be an object');
      else Object.keys(s.sweep).forEach(function (k) {
        if (!Array.isArray(s.sweep[k]) || !s.sweep[k].length) err('sweep ' + k + ' must be a non-empty array');
      });
    }
    // a file is valid when its expansion is
    try {
      var cs = expand(s);
      if (!cs.length) err('the sweep expands to nothing');
      for (var i = 0; i < cs.length; i++) {
        var v = validate(cs[i]);
        if (!v.ok) { v.errors.slice(0, 3).forEach(function (e) { err('variant ' + cs[i].id + ': ' + e); }); break; }
      }
    } catch (e) { err(e.message); }
    return { ok: errors.length === 0, errors: errors };
  }
  // concrete
  checkNumbers(s, '', err);
  if (!(s.duration > 0)) err('duration must be > 0 s');
  if (!(s.ego && s.ego.v0_kmh >= 0)) err('ego.v0_kmh missing');
  if (!(s.ego && s.ego.vMax_kmh > 0)) err('ego.vMax_kmh missing');
  ['grade', 'curvature', 'speedLimit'].forEach(function (k) {
    var tb = s.road && s.road[k];
    if (tb === undefined) return;
    if (!Array.isArray(tb)) { err('road.' + k + ' must be [[x, value], ...]'); return; }
    for (var i = 1; i < tb.length; i++) if (!(tb[i][0] >= tb[i - 1][0])) err('road.' + k + ' x must not decrease');
  });
  var ids = {};
  (s.vehicles || []).forEach(function (v) {
    if (!v.id) err('a vehicle has no id');
    if (ids[v.id]) err('duplicate vehicle id ' + v.id);
    ids[v.id] = true;
    if (KINDS.indexOf(v.kind) < 0) err(v.id + ': unknown kind ' + v.kind);
    if (typeof v.x0 !== 'number') err(v.id + ': x0 missing');
    if (v.lane < 0 || v.lane >= s.road.lanes) err(v.id + ': lane ' + v.lane + ' outside the road');
    var p = v.profile;
    if (!p || PROFILE_TYPES.indexOf(p.type) < 0) { err(v.id + ': profile.type must be one of ' + PROFILE_TYPES.join(', ')); return; }
    if (p.type === 'piecewise' || p.type === 'accel') {
      if (!Array.isArray(p.points) || !p.points.length) err(v.id + ': profile.points missing');
      else for (var i = 1; i < p.points.length; i++) if (!(p.points[i][0] >= p.points[i - 1][0])) err(v.id + ': profile times must not decrease');
      if (p.type === 'piecewise') p.points.forEach(function (pt) { if (pt[1] < 0) err(v.id + ': negative speed ' + pt[1]); });
    }
    if (p.type === 'sine' && !(p.period_s > 0)) err(v.id + ': sine period_s must be > 0');
    if (p.type === 'replay' && typeof p.file !== 'string' && !p.data && !p.points) err(v.id + ': replay file missing');
    if (p.type === 'const' && !(v.v0_kmh >= 0)) err(v.id + ': a const profile needs the vehicle\'s v0_kmh');
  });
  (s.events || []).forEach(function (e) {
    if (EVENT_KINDS.indexOf(e.kind) < 0) err('unknown event kind ' + e.kind);
    if (!(e.t >= 0)) err(e.kind + ': t must be >= 0');
    if ((e.kind === 'cutIn' || e.kind === 'cutOut' || e.kind === 'laneChange') && e.vehicle !== 'ego' && !ids[e.vehicle]) err(e.kind + ': unknown vehicle ' + e.vehicle);
    if (e.kind === 'fault' && FAULT_KINDS.indexOf(e.fault) < 0) err('unknown fault ' + e.fault);
    if (e.kind === 'driverVmax' && !(e.vMax_kmh > 0)) err('driverVmax needs vMax_kmh');
  });
  if (!Array.isArray(s.decide)) err('decide missing');
  return { ok: errors.length === 0, errors: errors };
}
function checkNumbers(x, path, err) {
  if (typeof x === 'number') { if (!isFinite(x)) err(path + ' is not finite'); return; }
  if (typeof x === 'string') { if (x.charAt(0) === '=') err(path + ' unresolved expression ' + x); return; }
  if (Array.isArray(x)) { x.forEach(function (e, i) { checkNumbers(e, path + '[' + i + ']', err); }); return; }
  if (isObj(x)) Object.keys(x).forEach(function (k) {
    if (k === 'configPatch' || k === 'variant') return;
    checkNumbers(x[k], path ? path + '.' + k : k, err);
  });
}

// ---------------------------------------------------------------- config
function toConfig(concrete, base) {
  var cfg = deepMerge(base || {}, concrete.configPatch || {});
  var inline = clone(concrete);
  delete inline.configPatch;
  cfg.scenario = { id: concrete.id, inline: inline };
  if (concrete.duration !== undefined) cfg.duration = concrete.duration;
  return cfg;
}

// a JS file that registers every scenario: for the page opened from the disk (file:// cannot fetch JSON)
function bundleJs() {
  var r = loadRegistry();
  return '// generated by core/scenario.js bundleJs(): every scenario file of tools/cruise-sim/scenarios\n' +
    '(self.CS = self.CS || {}).scenarioBundle = ' + JSON.stringify(Object.keys(r).sort().map(function (k) { return r[k]; })) + ';\n';
}

var X = {
  FAMILIES: FAMILIES, SCOPES: SCOPES, REACTIONS: REACTIONS, PATCHES: PATCHES, FAULT_KINDS: FAULT_KINDS,
  EVENT_KINDS: EVENT_KINDS, PROFILE_TYPES: PROFILE_TYPES, DEFAULT_DECIDE: DEFAULT_DECIDE, DEFAULT_REACTIONS: DEFAULT_REACTIONS,
  WARN_METRICS: WARN_METRICS,
  load: load, template: template, validate: validate, expand: expand, list: list, toConfig: toConfig, register: register, bundleJs: bundleJs,
  evalExpr: evalExpr, resolveValue: resolveValue, setPath: setPath, getPath: getPath, deepMerge: deepMerge, raw: raw,
  _reset: function () { registry = null; files = {}; }
};
if (typeof module !== 'undefined') module.exports = X; else (self.CS = self.CS || {}).scenario = X;
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var arg = process.argv[2];
  if (arg === '--bundle') process.stdout.write(bundleJs());
  else if (arg === '--list') list().forEach(function (e) { console.log(e.id + '\t' + e.scope + '\t' + e.name); });
  else if (arg) { var cs = expand(arg); console.log(JSON.stringify(cs, null, 1)); }
  else console.log('usage: node core/scenario.js --list | --bundle | <scenario id>');
}
})();
