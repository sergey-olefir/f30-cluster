/* Cruise simulator — settings (SU2).
 *
 * Generated from the model modules' SCHEMAs (CONTRACT.md "Every model module"): nothing about a
 * parameter is written here. Grouped as the models are: scenario · plant · sensor · estimator ·
 * controller and warning · command path · driver · failures · pass thresholds. Every control shows
 * its unit, default and range; a changed value is marked; each group resets; named presets of the
 * whole setting are saved in the browser, exported and imported as JSON. A change re-runs at once
 * when the run is short, otherwise it waits for the Run button.
 *
 * Writes go through app.setConfig(partial) with WHOLE module objects ({ plant: {...all keys} }),
 * so they mean the same whether the shell merges or replaces at the module level.
 */
(function () {
  'use strict';
  // Browser: siblings resolve when first used, so the page may load the ui files in any order.
  function lazy(n) { return new Proxy({}, { get: function (_, k) { return self.CS[n][k]; } }); }
  const charts = typeof require !== 'undefined' ? require('./charts.js') : lazy('charts');

  const GROUPS = [
    { id: 'scenario', title: 'Scenario', scenario: true },
    { id: 'plant', title: 'Plant (stock cruise)', modules: ['plant'], file: true },
    { id: 'sensor', title: 'Sensor (camera)', modules: ['sensor'] },
    { id: 'estimator', title: 'Estimator', modules: ['estimator'] },
    { id: 'control', title: 'Controller and warning', modules: ['controller', 'warning'] },
    { id: 'command', title: 'Command path', modules: ['command'] },
    { id: 'driver', title: 'Driver', modules: ['driver'] },
    { id: 'failures', title: 'Failures', modules: ['failures'], list: true },
    { id: 'thresholds', title: 'Pass thresholds', modules: ['metrics'] },
  ];
  const MODULE_NAMES = ['plant', 'sensor', 'estimator', 'controller', 'warning', 'command', 'driver', 'failures', 'metrics'];
  const CONFIG_KEY_FALLBACK = { metrics: 'thresholds' };

  // Fields of the run itself (not of a model): the scenario group shows them.
  const RUN_SCHEMA = [
    { key: 'seed', path: ['seed'], label: 'Seed', unit: '', default: 1, min: 0, max: 2147483647, step: 1, help: 'Every random draw of the run comes from this seed' },
    { key: 'duration', path: ['duration'], label: 'Duration', unit: 's', default: 120, min: 1, max: 36000, step: 1, help: 'Defaults to the scenario\'s own duration' },
    { key: 'mode', path: ['ego', 'mode'], label: 'Our car is driven by', unit: '', default: 'ours', options: [
      { value: 'ours', label: 'ours: set-speed controller + stock cruise' }, { value: 'idealAcc', label: 'baseline: ideal adaptive cruise' }, { value: 'human', label: 'baseline: human-like driver' }] },
    { key: 'outDt', path: ['out', 'dt'], label: 'Recorded step', unit: 's', default: 0.05, options: [0.01, 0.02, 0.05, 0.1, 0.2] },
  ];

  const AUTO_RUN_MAX_S = 300;   // simulated seconds a change may re-run without asking
  const STORE_KEY = 'cruise-sim.su2.presets.v1';
  const EPS = 1e-9;

  // ---------------------------------------------------------------------------------------------
  // Modules
  // ---------------------------------------------------------------------------------------------
  /** The modules the page has: { plant: module, ..., scenario } from self.CS (or a given object). */
  function findModules(src) {
    src = src || (typeof self !== 'undefined' && self.CS) || {};
    const out = {};
    MODULE_NAMES.forEach(function (n) { if (src[n] && (src[n].SCHEMA || src[n].PRESETS)) out[n] = src[n]; });
    if (src.scenario) out.scenario = src.scenario;
    return out;
  }

  function configKey(mod, name) { return (mod && mod.NAME) || CONFIG_KEY_FALLBACK[name] || name; }

  function getPath(obj, path) {
    let o = obj;
    for (let i = 0; i < path.length; i++) { if (o === null || o === undefined) return undefined; o = o[path[i]]; }
    return o;
  }

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  function normOptions(opts) {
    if (!opts) return null;
    return opts.map(function (o) { return o !== null && typeof o === 'object' ? { value: o.value, label: o.label !== undefined ? String(o.label) : String(o.value) } : { value: o, label: String(o) }; });
  }

  /** Control type: select | bool | number | text | json (json = free objects / arrays: not shown as a control). */
  function typeOf(s) {
    const t = s.type;
    if (s.options && s.options.length && s.options.every(function (o) { return typeof o === 'boolean'; })) return 'bool';
    if (s.options || t === 'enum') return 'select';
    if (t === 'bool' || t === 'boolean' || typeof s.default === 'boolean') return 'bool';
    if (t === 'object' || t === 'array' || (s.default !== null && typeof s.default === 'object')) return 'json';
    if (t === 'number' || typeof s.default === 'number' || s.min !== undefined && s.min !== null || s.max !== undefined && s.max !== null) return 'number';
    if (t === 'string' || typeof s.default === 'string') return 'text';
    return s.default === null ? 'number' : 'text';
  }

  // Parameters the page sets another way (the plant file loader writes plant.data).
  const HIDDEN = { plant: ['file', 'data'] };
  function hiddenKey(name, s) { return typeOf(s) === 'json' || (HIDDEN[name] || []).indexOf(s.key) >= 0; }

  /** A SCHEMA group name without its module prefix ('plant.dynamics' -> 'Dynamics'; 'plant' -> ''). */
  function sectionTitle(group, name, NAME) {
    let g = String(group || '');
    [name, NAME].forEach(function (p) { if (p && g.indexOf(p + '.') === 0) g = g.slice(p.length + 1); else if (g === p) g = ''; });
    return g ? g.charAt(0).toUpperCase() + g.slice(1) : '';
  }

  function same(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));
    if (a === b) return true;
    if (a && b && typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
    return false;
  }

  /** SCHEMA defaults, overlaid by the selected preset's values (the base a "changed" mark compares to). */
  function baseDefaults(mod, presetName) {
    const d = {};
    (mod.SCHEMA || []).forEach(function (s) { d[s.key] = clone(s.default); });
    const p = mod.PRESETS && presetName && mod.PRESETS[presetName];
    if (p) Object.keys(p).forEach(function (k) { d[k] = clone(p[k]); });
    return d;
  }

  function schemaHas(mod, key) { return (mod.SCHEMA || []).some(function (s) { return s.key === key; }); }

  /**
   * The preset a module part selects. A module whose SCHEMA has a 'preset' key stores it in the
   * config (the plant). A module with PRESETS but no such key (the command path) never stores one:
   * a preset there only writes its values, so this returns undefined and the defaults are the SCHEMA's.
   */
  function presetOf(mod, part) {
    if (!schemaHas(mod, 'preset')) return undefined;
    if (part && part.preset !== undefined && part.preset !== null && part.preset !== '') return part.preset;
    const s = (mod.SCHEMA || []).filter(function (x) { return x.key === 'preset'; })[0];
    return s ? s.default : undefined;
  }

  /** Which of a module's PRESETS the current values match exactly ('' = none). */
  function matchPreset(mod, part) {
    if (!mod.PRESETS) return '';
    const names = Object.keys(mod.PRESETS);
    const defs = baseDefaults(mod, undefined);
    for (let i = 0; i < names.length; i++) {
      const want = Object.assign({}, defs, mod.PRESETS[names[i]]);
      const ok = (mod.SCHEMA || []).every(function (s) { const v = part && part[s.key] !== undefined ? part[s.key] : defs[s.key]; return same(v, want[s.key]); });
      if (ok) return names[i];
    }
    return '';
  }

  function control(s, path, value, def, extra) {
    const c = {
      id: path.join('.'), path: path, key: s.key, label: s.label || s.key, unit: s.unit || '', help: s.help || '',
      type: typeOf(s), options: normOptions(s.options), min: s.min === null ? undefined : s.min, max: s.max === null ? undefined : s.max, step: s.step,
      default: def, value: value === undefined ? def : value, subgroup: s.group || '', allow: s.allow || null,
      nullable: !!(s.nullable || s.default === null),
    };
    if (c.type === 'bool' && c.options) c.options = null;
    c.changed = !same(c.value, c.default);
    return Object.assign(c, extra || {});
  }

  /** The controls of one module part of the config. */
  function moduleControls(name, mod, config) {
    const NAME = configKey(mod, name);
    const part = (config && config[NAME]) || {};
    const preset = presetOf(mod, part);
    const defs = baseDefaults(mod, preset);
    const out = [];
    // A module with PRESETS but no 'preset' in its SCHEMA gets a selector that only writes values.
    if (mod.PRESETS && !schemaHas(mod, 'preset')) {
      const cur = matchPreset(mod, part);
      out.push(control({ key: 'preset', label: 'Preset', unit: '', options: [{ value: '', label: '(custom)' }].concat(Object.keys(mod.PRESETS).map(function (k) { return { value: k, label: k }; })), group: '', help: 'Sets every parameter of this group to the preset\'s values' },
        [NAME, '#preset'], cur, cur, { selector: true, synthetic: true }));
    }
    (mod.SCHEMA || []).forEach(function (s) {
      if (hiddenKey(name, s)) return;
      const sel = s.key === 'preset' || s.key === 'model';
      const def = s.key === 'preset' ? s.default : defs[s.key];
      out.push(control(Object.assign({}, s, { group: sectionTitle(s.group, name, NAME) }), [NAME, s.key], part[s.key], def, { selector: sel }));
    });
    return out;
  }

  function sections(controls) {
    const order = [];
    const by = {};
    controls.forEach(function (c) {
      const g = c.subgroup || '';
      if (!by[g]) { by[g] = []; order.push(g); }
      by[g].push(c);
    });
    return order.map(function (g) { return { title: g, controls: by[g] }; });
  }

  /** Scenario group: the scenario, its variations (from its sweep), then the run fields. */
  /** A scenario id without its variant and reaction: 'D.brake#v=90,a=-1/none' -> 'D.brake'. */
  function baseId(id) { return String(id || '').split('#')[0].split('/')[0]; }

  /** The concrete variants of a catalogue scenario (SC3's scenario.expand), or [] when the catalogue cannot say. */
  function variantsOf(sc, id) {
    if (!sc || typeof sc.expand !== 'function' || !id) return [];
    try { return sc.expand(id) || []; } catch (e) { return []; }
  }

  /**
   * Scenario group: the scenario (the catalogue, by family), its variant (every concrete case of its
   * sweep and reaction cases, as the batch runs them), then the run fields. A variant is selected by
   * its concrete id ('D.brake#v=90,dv=20,a=-1/none'), which core/scenario.js loads as it is.
   */
  function scenarioControls(modules, config) {
    const out = [];
    const sc = modules.scenario;
    const cur = config && config.scenario || {};
    let list = [];
    try { list = sc && sc.list ? sc.list() : []; } catch (e) { list = []; }
    const id = cur.id || (cur.inline && cur.inline.id) || '';
    const base = baseId(id) || (list[0] && list[0].id) || '';
    if (list.length) {
      const opts = list.map(function (s) { return { value: s.id, label: s.id + (s.name ? ' — ' + s.name : ''), family: s.family || String(s.id).charAt(0) }; });
      if (base && !list.some(function (s) { return s.id === base; })) opts.unshift({ value: base, label: base + ' (not in the catalogue)', family: '?' });
      out.push(Object.assign(control({ key: 'id', label: 'Scenario', unit: '', options: opts, group: 'Scenario' }, ['scenario', 'id'], base, list[0].id), { options: opts, changed: false, selector: true }));
    } else {
      out.push(control({ key: 'id', label: 'Scenario id', unit: '', default: '', group: 'Scenario', help: 'The scenario catalogue (core/scenario.js) is not loaded' }, ['scenario', 'id'], id, ''));
    }
    const variants = variantsOf(sc, base);
    if (variants.length > 1) {
      const opts = [{ value: base, label: '(the default variant)' }].concat(variants.map(function (v) {
        return { value: v.id, label: (v.label || v.id.split('#')[1] || v.id) + (v.reaction && v.reaction !== 'none' ? ' · driver ' + v.reaction : v.reaction === 'none' && variants.some(function (x) { return x.reaction && x.reaction !== 'none'; }) ? ' · no reaction' : '') };
      }));
      if (id && id !== base && !variants.some(function (v) { return v.id === id; })) opts.push({ value: id, label: id + ' (not a variant of the catalogue)' });
      out.push(Object.assign(control({ key: 'variant', label: 'Variant', unit: '', options: opts, group: 'Scenario', help: variants.length + ' concrete cases: the sweep of the scenario file crossed with its driver reaction cases' }, ['scenario', '#variant'], id || base, base), { variation: true }));
    }
    let scen = null;
    try { scen = sc && sc.load && (id || base) ? sc.load(id || base) : null; } catch (e) { scen = null; }
    RUN_SCHEMA.forEach(function (s) {
      let def = s.default;
      if (s.key === 'duration' && scen && typeof scen.duration === 'number') def = scen.duration;
      out.push(control(Object.assign({}, s, { group: 'Run' }), s.path, getPath(config, s.path), def));
    });
    return { controls: out, scenario: scen };
  }

  /** Merge a scenario variant's configPatch ({ driver: { reactionCase } }, a sensor preset ...) into the config's modules. */
  function variantPatch(config, patch) {
    const out = {};
    Object.keys(patch || {}).forEach(function (k) {
      const v = patch[k];
      if (isPlain(v) && isPlain(config && config[k])) out[k] = deepAssign(clone(config[k]), v);
      else out[k] = clone(v);
    });
    return out;
  }
  function isPlain(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function deepAssign(a, b) { Object.keys(b).forEach(function (k) { a[k] = isPlain(a[k]) && isPlain(b[k]) ? deepAssign(a[k], b[k]) : clone(b[k]); }); return a; }

  /** The fields of one failure: the module's SCHEMA, or (empty SCHEMA) kind / at / duration from its KINDS. */
  function failureSchema(mod) {
    if (mod.SCHEMA && mod.SCHEMA.length) return mod.SCHEMA;
    const kinds = Object.keys(mod.KINDS || {});
    return [
      { key: 'kind', label: 'Failure', unit: '', default: kinds[0] || 'appStop', options: kinds.length ? kinds : ['appStop'] },
      { key: 'at', label: 'At', unit: 's', default: 20, min: 0, max: 36000, step: 1, allow: ['worst'], help: 'A time, or "worst": searched for the worst outcome' },
      { key: 'duration', label: 'Duration', unit: 's', default: null, min: 0, max: 36000, step: 0.5, nullable: true, help: 'Empty = the kind\'s default' },
    ];
  }

  /** Failures: a list of items, each with the failure fields. */
  function failureItems(mod, config) {
    const NAME = configKey(mod, 'failures');
    const list = Array.isArray(config && config[NAME]) ? config[NAME] : [];
    const sch = failureSchema(mod);
    return list.map(function (item, i) {
      const own = sch.map(function (s) { return control(s, [NAME, i, s.key], item[s.key], s.default); });
      // kind options outside the schema (mode, worstBy, ...) are shown as text so nothing is hidden
      Object.keys(item).forEach(function (k) {
        if (sch.some(function (s) { return s.key === k; })) return;
        own.push(control({ key: k, label: k, unit: '', default: typeof item[k] === 'number' ? item[k] : String(item[k]) }, [NAME, i, k], item[k], item[k]));
      });
      return own;
    });
  }

  /**
   * The settings model: groups -> sections -> controls, every control with its value, default,
   * range and changed mark. Pure; the DOM renders it.
   */
  function buildModel(modules, config) {
    const groups = [];
    GROUPS.forEach(function (g) {
      if (g.scenario) {
        const sc = scenarioControls(modules, config);
        groups.push({ id: g.id, title: g.title, sections: sections(sc.controls), changed: sc.controls.filter(function (c) { return c.changed; }).length, scenario: sc.scenario });
        return;
      }
      const mods = g.modules.filter(function (n) { return modules[n]; });
      if (!mods.length) { groups.push({ id: g.id, title: g.title, missing: g.modules, sections: [], changed: 0 }); return; }
      if (g.list) {
        const mod = modules[mods[0]];
        const items = failureItems(mod, config);
        groups.push({ id: g.id, title: g.title, list: true, configKey: configKey(mod, mods[0]), itemSchema: failureSchema(mod), items: items, sections: [], changed: items.length });
        return;
      }
      const secs = [];
      let changed = 0;
      mods.forEach(function (n) {
        const cs = moduleControls(n, modules[n], config);
        changed += cs.filter(function (c) { return c.changed && !c.selector; }).length;
        sections(cs).forEach(function (s) {
          if (mods.length > 1) s.title = (n === 'warning' ? 'Warning' : n === 'controller' ? 'Controller' : n) + (s.title ? ' · ' + s.title : '');
          secs.push(s);
        });
      });
      const out = { id: g.id, title: g.title, modules: mods, sections: secs, changed: changed };
      if (g.file) {
        const part = config && config[configKey(modules.plant, 'plant')];
        out.file = part && part.data ? part.data : part && part.file ? { name: String(part.file) } : null;
      }
      groups.push(out);
    });
    return { groups: groups };
  }

  // ---------------------------------------------------------------------------------------------
  // Values
  // ---------------------------------------------------------------------------------------------
  /** Text from an input -> { ok, value } or { ok: false, error }. */
  function parseInput(c, raw) {
    if (c.type === 'bool') return { ok: true, value: raw === true || raw === 'true' || raw === 'on' || raw === '1' };
    if (c.type === 'select') {
      const o = (c.options || []).filter(function (x) { return String(x.value) === String(raw); })[0];
      return o ? { ok: true, value: o.value } : { ok: false, error: 'not one of the choices' };
    }
    if (c.type === 'number') {
      const s = String(raw).trim();
      if (c.allow && c.allow.indexOf(s) >= 0) return { ok: true, value: s };
      if (s === 'worst' && c.key === 'at') return { ok: true, value: 'worst' };
      if (s === '') return c.nullable ? { ok: true, value: null } : { ok: false, error: 'empty' };
      const v = Number(s.replace(',', '.').replace('−', '-'));
      if (!isFinite(v)) return { ok: false, error: 'not a number' };
      if (c.min !== undefined && v < c.min - EPS) return { ok: false, error: 'below the range ' + rangeText(c) };
      if (c.max !== undefined && v > c.max + EPS) return { ok: false, error: 'above the range ' + rangeText(c) };
      return { ok: true, value: v };
    }
    return { ok: true, value: String(raw) };
  }

  function rangeText(c) {
    if (c.min === undefined && c.max === undefined) return '';
    return (c.min !== undefined ? charts.fmt(c.min, undefined) : '…') + ' … ' + (c.max !== undefined ? charts.fmt(c.max, undefined) : '…') + (c.unit ? ' ' + c.unit : '');
  }

  function valueText(c, v) {
    if (v === undefined || v === null || v === '') return '—';
    if (c.type === 'bool') return v ? 'on' : 'off';
    if (c.type === 'select') { const o = (c.options || []).filter(function (x) { return String(x.value) === String(v); })[0]; return o ? o.label : String(v); }
    return String(v) + (c.unit && typeof v === 'number' ? ' ' + c.unit : '');
  }

  /** The whole module object with every SCHEMA key explicit (what setConfig receives for a group). */
  /**
   * A module's config object, compact: only what differs from its defaults (the SCHEMA's, overlaid by
   * the selected preset), plus the preset and model when they were chosen. The engine fills the rest,
   * so links stay short and keep their meaning when a default changes.
   */
  function fullModule(mod, name, part, presetOverride) {
    const NAME = configKey(mod, name);
    part = part || {};
    const preset = presetOverride !== undefined ? presetOverride : presetOf(mod, part);
    const defs = baseDefaults(mod, preset);
    const out = {};
    // keys outside the SCHEMA are carried over (the shell or the core may use them)
    Object.keys(part).forEach(function (k) { if (!schemaHas(mod, k) && part[k] !== undefined) out[k] = clone(part[k]); });
    (mod.SCHEMA || []).forEach(function (s) {
      if (s.key === 'preset') { if (preset !== undefined && (presetOverride !== undefined || part.preset !== undefined)) out.preset = preset; return; }
      if (part[s.key] === undefined) return;
      if (s.key === 'model' || !same(part[s.key], defs[s.key])) out[s.key] = clone(part[s.key]);
    });
    return { key: NAME, value: out };
  }

  /** Apply a settings patch: each top-level key replaces the config's whole value; undefined deletes it. */
  function applyPatch(config, patch) {
    const next = clone(config || {}) || {};
    Object.keys(patch || {}).forEach(function (k) { if (patch[k] === undefined) delete next[k]; else next[k] = clone(patch[k]); });
    return next;
  }

  /** The config patch for one control's new value. */
  function patchFor(modules, config, c, value) {
    const head = c.path[0];
    if (head === 'scenario') {
      // a new scenario, or one of its variants: the id says which; the variant brings its own config patch
      const p = { scenario: { id: value } };
      if (c.path[1] === '#variant' && modules.scenario && typeof modules.scenario.load === 'function' && value !== baseId(value)) {
        let conc = null;
        try { conc = modules.scenario.load(value); } catch (e) { conc = null; }
        if (conc && conc.configPatch) Object.assign(p, variantPatch(config, conc.configPatch));
      }
      return p;
    }
    const name = moduleNameOfKey(modules, head);
    if (!name) {
      // a run field (seed, duration, ego.mode, out.dt)
      if (c.path.length === 1) { const p = {}; p[head] = value; return p; }
      const obj = clone((config && config[head]) || {});
      obj[c.path[1]] = value;
      const p = {}; p[head] = obj; return p;
    }
    const mod = modules[name];
    if (Array.isArray(config && config[head]) || typeof c.path[1] === 'number') {
      const list = clone((config && config[head]) || []);
      list[c.path[1]] = Object.assign({}, list[c.path[1]] || {});
      list[c.path[1]][c.path[2]] = value;
      const p = {}; p[head] = list; return p;
    }
    const part = Object.assign({}, (config && config[head]) || {});
    if (c.synthetic && mod.PRESETS) {
      // a preset of a module that does not store one: write its values (SCHEMA defaults + the preset)
      const vals = Object.assign(baseDefaults(mod, undefined), value ? mod.PRESETS[value] || {} : {});
      const keep = filterKeys(part, mod, true);
      const fm = fullModule(mod, name, Object.assign(keep, value ? vals : part));
      const p = {}; p[fm.key] = fm.value; return p;
    }
    if (c.key === 'preset' && mod.PRESETS) {
      // a new preset: every parameter jumps to the preset's value
      const fm = fullModule(mod, name, filterKeys(part, mod, true), value === '' ? undefined : value);
      if (value === '') delete fm.value.preset; else fm.value.preset = value;
      const p = {}; p[fm.key] = fm.value; return p;
    }
    part[c.key] = value;
    const fm = fullModule(mod, name, part);
    const p = {}; p[fm.key] = fm.value; return p;
  }

  /** The part without its SCHEMA parameters (keepExtra) — what survives a preset switch or reset. */
  function filterKeys(part, mod, keepExtra) {
    const out = {};
    const hidden = HIDDEN[mod.NAME] || [];
    Object.keys(part || {}).forEach(function (k) { if (keepExtra && ((!schemaHas(mod, k) && k !== 'preset') || hidden.indexOf(k) >= 0)) out[k] = part[k]; });
    if (part && part.model !== undefined && schemaHas(mod, 'model')) out.model = part.model;
    return out;
  }

  function moduleNameOfKey(modules, key) {
    for (let i = 0; i < MODULE_NAMES.length; i++) {
      const n = MODULE_NAMES[i];
      if (modules[n] && configKey(modules[n], n) === key) return n;
    }
    return null;
  }

  /** The patch that resets a group to its defaults (the selected preset and model are kept). */
  function resetPatch(modules, config, groupId) {
    const g = GROUPS.filter(function (x) { return x.id === groupId; })[0];
    if (!g) return {};
    if (g.scenario) {
      // the scenario stays, its variations and the run fields go back to the engine's / scenario's own
      const p = { scenario: { id: baseId(config && config.scenario && config.scenario.id) } };
      RUN_SCHEMA.forEach(function (s) {
        if (s.path.length === 1) p[s.path[0]] = s.key === 'seed' ? s.default : undefined;
        else {
          const rest = Object.assign({}, (config && config[s.path[0]]) || {}, p[s.path[0]] || {});
          delete rest[s.path[1]];
          p[s.path[0]] = Object.keys(rest).length ? rest : undefined;
        }
      });
      return p;
    }
    const p = {};
    g.modules.forEach(function (n) {
      const mod = modules[n];
      if (!mod) return;
      if (g.list) { p[configKey(mod, n)] = []; return; }
      const part = (config && config[configKey(mod, n)]) || {};
      const keep = filterKeys(part, mod, true);
      const fm = fullModule(mod, n, keep, presetOf(mod, part));
      p[fm.key] = fm.value;
    });
    return p;
  }

  // ---------------------------------------------------------------------------------------------
  // Named presets of the whole setting
  // ---------------------------------------------------------------------------------------------
  /** What a saved preset holds: the run fields, the scenario, and per module only what differs from its defaults. */
  function snapshot(modules, config) {
    config = config || {};
    const out = {};
    ['seed', 'duration'].forEach(function (k) { if (config[k] !== undefined) out[k] = config[k]; });
    ['scenario', 'ego', 'out'].forEach(function (k) { if (config[k] !== undefined) out[k] = clone(config[k]); });
    MODULE_NAMES.forEach(function (n) {
      const mod = modules[n];
      if (!mod) return;
      const NAME = configKey(mod, n);
      const part = config[NAME];
      if (part === undefined) return;
      if (Array.isArray(part)) { if (part.length) out[NAME] = clone(part); return; }
      const preset = presetOf(mod, part);
      const defs = baseDefaults(mod, preset);
      const diff = {};
      Object.keys(part).forEach(function (k) {
        if (!schemaHas(mod, k)) { if (part[k] !== null && part[k] !== undefined) diff[k] = clone(part[k]); return; }
        if (k === 'preset' || k === 'model') { diff[k] = part[k]; return; }
        if (!same(part[k], defs[k])) diff[k] = clone(part[k]);
      });
      if (Object.keys(diff).length) out[NAME] = diff;
    });
    return out;
  }

  /** The config patch that applies a saved preset: every module explicit (defaults + the preset's values). */
  function applySnapshotPatch(modules, snap) {
    const p = {};
    ['seed', 'duration', 'scenario', 'ego', 'out'].forEach(function (k) { if (snap[k] !== undefined) p[k] = clone(snap[k]); });
    MODULE_NAMES.forEach(function (n) {
      const mod = modules[n];
      if (!mod) return;
      const NAME = configKey(mod, n);
      if (n === 'failures') { p[NAME] = clone(snap[NAME] || []); return; }
      const fm = fullModule(mod, n, snap[NAME] || {});
      p[NAME] = fm.value;
    });
    return p;
  }

  /** Check a snapshot against the SCHEMAs: unknown keys and out-of-range values are dropped with a warning. */
  function cleanSnapshot(modules, snap, label) {
    const warnings = [];
    const out = {};
    if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return { snap: null, warnings: [label + ': not an object'] };
    Object.keys(snap).forEach(function (k) {
      const n = moduleNameOfKey(modules, k);
      if (!n) {
        if (['seed', 'duration', 'scenario', 'ego', 'out', 'version', 'dt'].indexOf(k) >= 0) { if (k !== 'version' && k !== 'dt') out[k] = clone(snap[k]); }
        else if (MODULE_NAMES.indexOf(k) >= 0 || k === 'thresholds') warnings.push(label + ': ' + k + ' — that module is not loaded, kept as is'), out[k] = clone(snap[k]);
        else warnings.push(label + ': unknown key "' + k + '" dropped');
        return;
      }
      const mod = modules[n];
      if (Array.isArray(snap[k])) { out[k] = clone(snap[k]); return; }
      const part = {};
      Object.keys(snap[k] || {}).forEach(function (pk) {
        const s = (mod.SCHEMA || []).filter(function (x) { return x.key === pk; })[0];
        if (!s) {
          if (pk === 'preset' && mod.PRESETS && schemaHas(mod, 'preset')) {
            if (snap[k][pk] === '' || mod.PRESETS[snap[k][pk]]) part[pk] = snap[k][pk];
            else warnings.push(label + ': ' + k + '.preset "' + snap[k][pk] + '" does not exist, dropped');
          } else if (n === 'plant' && (pk === 'file' || pk === 'model' || pk === 'preset')) part[pk] = clone(snap[k][pk]);
          else warnings.push(label + ': unknown parameter ' + k + '.' + pk + ' dropped');
          return;
        }
        const c = control(s, [k, pk], undefined, s.default);
        const v = snap[k][pk];
        const r = c.type === 'bool' ? { ok: typeof v === 'boolean', value: v, error: 'not true / false' } : parseInput(c, v);
        if (r.ok) part[pk] = r.value;
        else warnings.push(label + ': ' + k + '.' + pk + ' = ' + JSON.stringify(v) + ' ' + r.error + ', dropped');
      });
      out[k] = part;
    });
    return { snap: out, warnings: warnings };
  }

  function exportPresets(presets) {
    return JSON.stringify({ kind: 'cs-settings-presets', version: 1, presets: presets }, null, 2);
  }

  /**
   * Read a presets file. Accepts SU2's own export, or a bare config / snapshot (it becomes one preset
   * named `fallbackName`). Returns { presets: { name: { saved, config } }, warnings }.
   */
  function importPresets(text, modules, fallbackName) {
    let j;
    try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { presets: {}, warnings: ['not JSON: ' + e.message] }; }
    const out = {};
    let warnings = [];
    if (j && j.kind === 'cs-settings-presets' && j.presets && typeof j.presets === 'object') {
      Object.keys(j.presets).forEach(function (name) {
        const e = j.presets[name] || {};
        const r = cleanSnapshot(modules, e.config || e, name);
        warnings = warnings.concat(r.warnings);
        if (r.snap) out[name] = { saved: e.saved || null, config: r.snap };
      });
    } else if (j && typeof j === 'object' && !Array.isArray(j)) {
      const name = fallbackName || 'imported';
      const r = cleanSnapshot(modules, j, name);
      warnings = r.warnings;
      if (r.snap) out[name] = { saved: null, config: r.snap };
    } else {
      warnings.push('not a presets file');
    }
    return { presets: out, warnings: warnings };
  }

  function makeStore(storage) {
    function get() {
      try { const s = storage && storage.getItem(STORE_KEY); return s ? JSON.parse(s) || {} : {}; } catch (e) { return {}; }
    }
    function put(p) { try { if (storage) storage.setItem(STORE_KEY, JSON.stringify(p)); return true; } catch (e) { return false; } }
    return {
      list: get,
      save: function (name, snap, when) { const p = get(); p[name] = { saved: when || new Date().toISOString(), config: snap }; return put(p); },
      remove: function (name) { const p = get(); delete p[name]; return put(p); },
      merge: function (more) { const p = get(); Object.keys(more).forEach(function (k) { p[k] = more[k]; }); return put(p); },
    };
  }

  /** Re-run at once only when the run is short (and is not a mixed-driving hour). */
  function isShortRun(config, scen) {
    const d = config && config.duration !== undefined ? +config.duration : scen && scen.duration ? +scen.duration : RUN_SCHEMA[1].default;
    const fam = (scen && scen.family) || (config && config.scenario && String(config.scenario.id || '').charAt(0));
    return d <= AUTO_RUN_MAX_S && fam !== 'L';
  }

  /** A control's controls signature: the DOM is rebuilt only when the set of controls changes. */
  function signature(model) {
    return model.groups.map(function (g) {
      return g.id + ':' + (g.list ? 'n' + g.items.length : g.sections.map(function (s) {
        return s.controls.map(function (c) { return c.id + (c.variation ? '[' + c.options.length + ':' + (c.options[1] && c.options[1].value) + ']' : ''); }).join(',');
      }).join('|')) + (g.missing ? '!' : '') + (g.file ? 'F' : '');
    }).join(';');
  }

  // ---------------------------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------------------------
  const CSS = [
    '.su2-settings .su2-group { border: 1px solid var(--su2-border); border-radius: 6px; margin: 0 0 8px; background: var(--su2-surface); }',
    '.su2-settings .su2-group > summary { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; list-style: none; margin: 0; color: var(--su2-ink); font-size: 13px; }',
    '.su2-settings .su2-group > summary::-webkit-details-marker { display: none; }',
    '.su2-settings .su2-group > summary::before { content: "▸"; color: var(--su2-muted); width: 10px; }',
    '.su2-settings .su2-group[open] > summary::before { content: "▾"; }',
    '.su2-settings .su2-group-title { font-weight: 600; }',
    '.su2-settings .su2-count { font-size: 11px; color: var(--su2-ink); border: 1px solid var(--su2-changed); border-radius: 10px; padding: 0 6px; }',
    '.su2-settings .su2-group > summary .su2-reset { margin-left: auto; font-size: 12px; min-height: 22px; padding: 0 8px; }',
    '.su2-settings .su2-body { padding: 4px 10px 10px; }',
    '.su2-settings .su2-sec { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--su2-muted); margin: 8px 0 2px; }',
    '.su2-settings .su2-row { display: grid; grid-template-columns: minmax(150px, 1.3fr) minmax(170px, 2fr) minmax(90px, 1fr); gap: 4px 10px; align-items: center; padding: 3px 0 3px 8px; border-left: 3px solid transparent; }',
    '.su2-settings .su2-row.su2-changed { border-left-color: var(--su2-changed); }',
    '.su2-settings .su2-row.su2-changed .su2-label::after { content: " •"; color: var(--su2-changed); font-weight: 700; }',
    '.su2-settings .su2-row.su2-bad input { border-color: var(--su2-s7); outline: 1px solid var(--su2-s7); }',
    '.su2-settings .su2-label { font-size: 13px; }',
    '.su2-settings .su2-ctl { display: flex; align-items: center; gap: 6px; min-width: 0; }',
    '.su2-settings .su2-ctl input[type="number"] { width: 92px; text-align: right; font-variant-numeric: tabular-nums; }',
    '.su2-settings .su2-ctl input[type="range"] { flex: 1; min-width: 60px; accent-color: var(--su2-s0); }',
    '.su2-settings .su2-ctl select { max-width: 100%; }',
    '.su2-settings .su2-unit { font-size: 12px; color: var(--su2-ink2); white-space: nowrap; }',
    '.su2-settings .su2-meta { font-size: 11px; color: var(--su2-muted); font-variant-numeric: tabular-nums; }',
    '.su2-settings .su2-err { grid-column: 2 / 4; font-size: 11px; color: var(--su2-s7); }',
    '.su2-settings .su2-top { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin: 0 0 8px; }',
    '.su2-settings .su2-top input[type="search"] { flex: 1; min-width: 140px; background: var(--su2-surface); border: 1px solid var(--su2-axis); border-radius: 5px; padding: 2px 6px; min-height: 26px; color: var(--su2-ink); font: inherit; }',
    '.su2-settings .su2-presets { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 8px; }',
    '.su2-settings .su2-item { border-top: 1px dashed var(--su2-grid); padding-top: 4px; margin-top: 4px; }',
    '.su2-settings .su2-dirty { color: var(--su2-ink); font-size: 12px; }',
    '.su2-settings .su2-dirty::before { content: "● "; color: var(--su2-changed); }',
    '.su2-settings .su2-hidden { display: none; }',
  ].join('\n');

  function mount(el, app, opts) {
    opts = opts || {};
    const h = charts.h;
    charts.ensureStyle(el.ownerDocument, 'su2-style-settings', CSS);
    el.classList.add('su2', 'su2-settings');
    el.innerHTML = '';
    let storage = null;
    try { storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null); } catch (e) { storage = null; }
    const store = makeStore(storage);
    const openState = { scenario: true, plant: true };
    const errors = {};
    let sig = '';
    let model = null;
    const inputs = {};      // control id -> { row, c, set(value) }
    let autoRun = true;
    let dirty = false;
    let runTimer = 0;

    const search = h('input', { type: 'search', placeholder: 'Find a setting…', 'aria-label': 'Find a setting', oninput: applyFilter });
    if (typeof app.autoRun === 'boolean') autoRun = app.autoRun;
    const autoCb = h('input', { type: 'checkbox', checked: autoRun, onchange: function () { autoRun = autoCb.checked; if (typeof app.autoRun === 'boolean') app.autoRun = autoRun; } });
    const runBtn = h('button', { type: 'button', class: 'su2-primary', onclick: function () { dirty = false; showDirty(); if (app.run) app.run(); } }, ['Run']);
    const dirtyNote = h('span', { class: 'su2-dirty su2-hidden', text: 'changed since the last run' });
    const top = h('div', { class: 'su2-top' }, [search, h('label', { class: 'su2-chip', title: 'Re-run at once after a change when the run is at most ' + AUTO_RUN_MAX_S + ' s of simulated time' }, [autoCb, 'Re-run on change (short runs)']), runBtn, dirtyNote]);

    const presetSel = h('select', { 'aria-label': 'Saved presets' });
    const presetMsg = h('span', { class: 'su2-note' });
    const presetsBar = h('div', { class: 'su2-presets' }, [
      h('span', { class: 'su2-note', text: 'Presets:' }), presetSel,
      h('button', { type: 'button', onclick: loadPreset }, ['Apply']),
      h('button', { type: 'button', onclick: savePreset }, ['Save as…']),
      h('button', { type: 'button', onclick: deletePreset }, ['Delete']),
      h('button', { type: 'button', onclick: exportAll, title: 'All saved presets as one JSON file' }, ['Export']),
      h('button', { type: 'button', onclick: importFile, title: 'A presets file, or a run config JSON' }, ['Import…']),
      h('button', { type: 'button', onclick: exportCurrent, title: 'The current setting as a run config JSON' }, ['Config JSON']),
      presetMsg,
    ]);
    const body = h('div');
    el.appendChild(top);
    el.appendChild(presetsBar);
    el.appendChild(body);

    function modules() { return findModules(opts.modules); }
    function cfg() { return app.config || {}; }

    function refreshPresetList(select) {
      const p = store.list();
      presetSel.innerHTML = '';
      const names = Object.keys(p).sort();
      if (!names.length) presetSel.appendChild(h('option', { value: '', text: '(none saved)' }));
      names.forEach(function (n) { presetSel.appendChild(h('option', { value: n, text: n + (p[n].saved ? ' — ' + String(p[n].saved).slice(0, 10) : '') })); });
      if (select) presetSel.value = select;
    }
    function flash(msg) { presetMsg.textContent = msg; }
    function savePreset() {
      const name = (typeof prompt !== 'undefined' ? prompt('Name of the preset', presetSel.value || '') : '') || '';
      if (!name.trim()) return;
      const ok = store.save(name.trim(), snapshot(modules(), cfg()));
      refreshPresetList(name.trim());
      flash(ok ? 'Saved "' + name.trim() + '" in this browser.' : 'This browser does not keep data here: use Export.');
    }
    function loadPreset() {
      const p = store.list()[presetSel.value];
      if (!p) return;
      commit(applySnapshotPatch(modules(), p.config));
      flash('Applied "' + presetSel.value + '".');
    }
    function deletePreset() {
      if (!presetSel.value) return;
      store.remove(presetSel.value);
      refreshPresetList();
      flash('Deleted.');
    }
    function exportAll() { charts.downloadText('cruise-sim-presets.json', exportPresets(store.list())); }
    function exportCurrent() { charts.downloadText('cruise-sim-config.json', JSON.stringify(cfg(), null, 2)); }
    function importFile() {
      charts.pickFile().then(function (f) {
        if (!f) return;
        return f.text().then(function (txt) {
          const r = importPresets(txt, modules(), f.name.replace(/\.json$/i, ''));
          const names = Object.keys(r.presets);
          if (names.length) store.merge(r.presets);
          refreshPresetList(names[0]);
          flash('Imported ' + names.length + ' preset(s)' + (r.warnings.length ? '; ' + r.warnings.length + ' warning(s): ' + r.warnings.slice(0, 3).join('; ') + (r.warnings.length > 3 ? '…' : '') : '.'));
        });
      }).catch(function (e) { flash('Import failed: ' + e.message); });
    }

    function commit(patch) {
      const next = applyPatch(cfg(), patch);
      // SU1's shell (it has isShort) re-runs a short run itself: we only say whether it may
      const shellRuns = typeof app.isShort === 'function';
      if (typeof app.setConfig === 'function') app.setConfig(next, { replace: true, run: shellRuns ? (autoRun ? 'auto' : false) : false });
      if (shellRuns) { dirty = !(autoRun && app.isShort()); showDirty(); return; }
      const m = model && model.groups[0] && model.groups[0].scenario;
      if (autoRun && isShortRun(next, m)) {
        clearTimeout(runTimer);
        runTimer = setTimeout(function () { dirty = false; showDirty(); if (app.run) app.run(); }, 250);
      } else { dirty = true; showDirty(); }
    }
    function showDirty() { dirtyNote.classList.toggle('su2-hidden', !dirty); }

    function setValue(c, raw) {
      const r = parseInput(c, raw);
      if (!r.ok) { errors[c.id] = r.error; markError(c.id); return; }
      delete errors[c.id];
      markError(c.id);
      commit(patchFor(modules(), cfg(), c, r.value));
    }
    function markError(id) {
      const it = inputs[id];
      if (!it) return;
      it.row.classList.toggle('su2-bad', !!errors[id]);
      it.err.textContent = errors[id] ? errors[id] : '';
      it.err.classList.toggle('su2-hidden', !errors[id]);
    }

    function rowFor(c) {
      const label = h('label', { class: 'su2-label', text: c.label, title: c.help || c.id, for: 'su2-in-' + c.id });
      const ctl = h('div', { class: 'su2-ctl' });
      const meta = h('div', { class: 'su2-meta' });
      const err = h('div', { class: 'su2-err su2-hidden' });
      let setter;
      if (c.type === 'bool') {
        const cb = h('input', { type: 'checkbox', id: 'su2-in-' + c.id, onchange: function () { setValue(c, cb.checked); } });
        ctl.appendChild(cb);
        setter = function (v) { cb.checked = !!v; };
      } else if (c.type === 'select') {
        const sel = h('select', { id: 'su2-in-' + c.id, onchange: function () { setValue(c, sel.value); } });
        const fams = {};
        const useGroups = c.options.some(function (o) { return o.family; });
        c.options.forEach(function (o) {
          const opt = h('option', { value: String(o.value), text: o.label });
          if (useGroups) {
            if (!fams[o.family]) { fams[o.family] = h('optgroup', { label: 'Family ' + o.family }); sel.appendChild(fams[o.family]); }
            fams[o.family].appendChild(opt);
          } else sel.appendChild(opt);
        });
        ctl.appendChild(sel);
        setter = function (v) { if (document.activeElement !== sel) sel.value = String(v === undefined || v === null ? '' : v); };
      } else if (c.type === 'number') {
        const inp = h('input', { type: 'text', inputmode: 'decimal', id: 'su2-in-' + c.id, size: 8, style: { width: '92px', textAlign: 'right' } });
        inp.addEventListener('change', function () { setValue(c, inp.value); });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') setValue(c, inp.value); });
        let rng = null;
        if (isFinite(c.min) && isFinite(c.max) && c.max > c.min && (c.max - c.min) / (c.step || (c.max - c.min) / 100) <= 2000) {
          rng = h('input', { type: 'range', min: c.min, max: c.max, step: c.step || 'any', 'aria-label': c.label + ' slider', tabindex: '-1' });
          rng.addEventListener('input', function () { inp.value = rng.value; });
          rng.addEventListener('change', function () { setValue(c, rng.value); });
          ctl.appendChild(rng);
        }
        ctl.appendChild(inp);
        if (c.unit) ctl.appendChild(h('span', { class: 'su2-unit', text: c.unit }));
        const kmh = c.unit === 'm/s' ? h('span', { class: 'su2-unit' }) : null;
        if (kmh) ctl.appendChild(kmh);
        setter = function (v) {
          if (document.activeElement !== inp) inp.value = v === undefined || v === null ? '' : String(v);
          if (rng && typeof v === 'number' && document.activeElement !== rng) rng.value = String(v);
          if (kmh) kmh.textContent = typeof v === 'number' ? '= ' + charts.fmt(v * 3.6, 1) + ' km/h' : '';
        };
      } else {
        const inp = h('input', { type: 'text', id: 'su2-in-' + c.id, onchange: function () { setValue(c, inp.value); } });
        ctl.appendChild(inp);
        setter = function (v) { if (document.activeElement !== inp) inp.value = v === undefined || v === null ? '' : String(v); };
      }
      const row = h('div', { class: 'su2-row', 'data-id': c.id, 'data-text': (c.label + ' ' + c.id + ' ' + c.help).toLowerCase() }, [label, ctl, meta, err]);
      inputs[c.id] = { row: row, c: c, set: setter, meta: meta, err: err };
      updateRow(c);
      return row;
    }

    function updateRow(c) {
      const it = inputs[c.id];
      if (!it) return;
      it.c = c;
      it.set(c.value);
      it.row.classList.toggle('su2-changed', !!c.changed && !c.selector);
      const rt = rangeText(c);
      it.meta.textContent = 'default ' + valueText(c, c.default) + (rt ? ' · ' + rt : '');
      it.meta.title = c.help || '';
      markError(c.id);
    }

    function groupEl(g) {
      const reset = h('button', { type: 'button', class: 'su2-reset', title: g.list ? 'Remove every failure' : 'Every parameter of this group back to its default (the preset stays selected)' }, [g.list ? 'Clear' : 'Reset group']);
      reset.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); commit(resetPatch(modules(), cfg(), g.id)); });
      const count = h('span', { class: 'su2-count' + (g.changed ? '' : ' su2-hidden'), text: g.list ? String(g.changed) : g.changed + ' changed' });
      const sum = h('summary', null, [h('span', { class: 'su2-group-title', text: g.title }), count, reset]);
      const det = h('details', { class: 'su2-group', 'data-group': g.id }, [sum]);
      if (openState[g.id]) det.open = true;
      det.addEventListener('toggle', function () { openState[g.id] = det.open; });
      const b = h('div', { class: 'su2-body' });
      det.appendChild(b);
      det._count = count;
      if (g.missing) {
        b.appendChild(h('div', { class: 'su2-note', text: 'Module not loaded yet (' + g.missing.join(', ') + '): no settings to show.' }));
        return det;
      }
      if (g.file !== undefined) {
        const info = h('span', { class: 'su2-note', text: g.file ? 'Identified plant loaded: ' + (g.file.name || 'unnamed') + ' — results use it (assumed: false)' : 'Assumed plant (a preset). Load an identified plant JSON to replace it.' });
        const loadBtn = h('button', { type: 'button' }, ['Load identified plant…']);
        loadBtn.addEventListener('click', function () {
          charts.pickFile().then(function (f) {
            if (!f) return;
            return charts.readFileJson(f).then(function (j) {
              const mods = modules();
              const NAME = configKey(mods.plant, 'plant');
              const part = Object.assign({}, cfg()[NAME] || {}, { file: Object.assign({ name: f.name }, j) });
              const p = {}; p[NAME] = part; commit(p);
            });
          }).catch(function (e) { info.textContent = 'Could not load: ' + e.message; });
        });
        const clr = h('button', { type: 'button', disabled: !g.file }, ['Use the preset']);
        clr.addEventListener('click', function () { const mods = modules(); const NAME = configKey(mods.plant, 'plant'); const part = Object.assign({}, cfg()[NAME] || {}, { file: null }); const p = {}; p[NAME] = part; commit(p); });
        b.appendChild(h('div', { class: 'su2-presets' }, [loadBtn, clr, info]));
      }
      if (g.list) {
        g.items.forEach(function (item, i) {
          const wrap = h('div', { class: 'su2-item' });
          const rm = h('button', { type: 'button', text: 'Remove failure ' + (i + 1) });
          rm.addEventListener('click', function () {
            const list = (cfg()[g.configKey] || []).slice(); list.splice(i, 1);
            const p = {}; p[g.configKey] = list; commit(p);
          });
          item.forEach(function (c) { wrap.appendChild(rowFor(c)); });
          wrap.appendChild(rm);
          b.appendChild(wrap);
        });
        const add = h('button', { type: 'button', text: '+ Add a failure' });
        add.addEventListener('click', function () {
          const it = {}; g.itemSchema.forEach(function (s) { it[s.key] = clone(s.default); });
          const list = (cfg()[g.configKey] || []).concat([it]);
          const p = {}; p[g.configKey] = list; commit(p);
        });
        b.appendChild(h('div', { style: { marginTop: '6px' } }, [add, ' ', h('span', { class: 'su2-note', text: g.items.length ? '' : 'No failure injected.' })]));
        return det;
      }
      g.sections.forEach(function (s) {
        if (s.title) b.appendChild(h('div', { class: 'su2-sec', text: s.title }));
        s.controls.forEach(function (c) { b.appendChild(rowFor(c)); });
      });
      return det;
    }

    function render() {
      model = buildModel(modules(), cfg());
      const s = signature(model);
      if (s !== sig) {
        sig = s;
        Object.keys(inputs).forEach(function (k) { delete inputs[k]; });
        body.innerHTML = '';
        model.groups.forEach(function (g) { body.appendChild(groupEl(g)); });
        applyFilter();
        return;
      }
      model.groups.forEach(function (g) {
        const det = body.querySelector('[data-group="' + g.id + '"]');
        if (det && det._count) { det._count.textContent = g.list ? String(g.changed) : g.changed + ' changed'; det._count.classList.toggle('su2-hidden', !g.changed); }
        const all = g.list ? [].concat.apply([], g.items) : [].concat.apply([], g.sections.map(function (x) { return x.controls; }));
        all.forEach(updateRow);
      });
    }

    function applyFilter() {
      const q = search.value.trim().toLowerCase();
      Object.keys(inputs).forEach(function (id) { const it = inputs[id]; it.row.classList.toggle('su2-hidden', !!q && it.row.getAttribute('data-text').indexOf(q) < 0); });
      body.querySelectorAll('details.su2-group').forEach(function (d) {
        if (q) { d.open = !!d.querySelector('.su2-row:not(.su2-hidden)'); }
        else d.open = !!openState[d.getAttribute('data-group')];
      });
    }

    const offs = [
      charts.listen(app, 'config', render),
      charts.listen(app, 'result', function () { dirty = false; showDirty(); }),
    ];
    refreshPresetList();
    render();
    return {
      destroy: function () { offs.forEach(function (o) { o(); }); clearTimeout(runTimer); el.innerHTML = ''; },
      refresh: function () { sig = ''; render(); },
    };
  }

  const settings = {
    GROUPS: GROUPS, RUN_SCHEMA: RUN_SCHEMA, AUTO_RUN_MAX_S: AUTO_RUN_MAX_S, STORE_KEY: STORE_KEY,
    findModules: findModules, buildModel: buildModel, baseDefaults: baseDefaults, parseInput: parseInput, rangeText: rangeText,
    patchFor: patchFor, resetPatch: resetPatch, fullModule: fullModule, applyPatch: applyPatch, baseId: baseId, variantsOf: variantsOf, variantPatch: variantPatch, typeOf: typeOf, sectionTitle: sectionTitle, matchPreset: matchPreset, failureSchema: failureSchema, snapshot: snapshot, applySnapshotPatch: applySnapshotPatch,
    cleanSnapshot: cleanSnapshot, exportPresets: exportPresets, importPresets: importPresets, makeStore: makeStore,
    isShortRun: isShortRun, signature: signature, mount: mount,
  };
  if (typeof module !== 'undefined') module.exports = settings; else (self.CS = self.CS || {})['settings'] = settings;
})();
