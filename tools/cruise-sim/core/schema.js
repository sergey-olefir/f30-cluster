'use strict';
// Settings-schema helpers (SC1). Every model module exports SCHEMA: an array of fields
//   { key, label, unit, default, min, max, step, group, help, options?, type?, nullable? }
// `type` is inferred from `default` when absent: number, bool (boolean), string, enum (when `options` is given),
// object / array (free JSON, not checked). `options` is an array of values or of { value, label }.
// `nullable: true` (or a default of null) lets the value be null ("off" / "not set").
//
//   defaults(SCHEMA)                 -> { key: default }   (deep copies of object defaults)
//   merge(SCHEMA, partial[, opts])   -> defaults overlaid by partial; an unknown key throws
//                                       (opts.ignore: keys that may be present and are dropped, e.g. ['preset','file'])
//   validate(SCHEMA, params)         -> [ 'message', ... ]   (empty = valid; range, type, enum and unknown-key checks)
//   check(SCHEMA, params, where)     -> params, or throws with every message of validate()
//   field(SCHEMA, key)               -> the field or undefined
//   withPreset(SCHEMA, PRESETS, name, partial[, opts]) -> merge(SCHEMA, Object.assign({}, PRESETS[name], partial))
//   KMH = 1 / 3.6                    (m/s per km/h; SI inside, km/h only at the edges)

const KMH = 1 / 3.6;

function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v));
}

function typeOf(f) {
  if (f.type) return f.type;
  if (f.options) return 'enum';
  const d = f.default;
  if (typeof d === 'number') return 'number';
  if (typeof d === 'boolean') return 'bool';
  if (typeof d === 'string') return 'string';
  if (Array.isArray(d)) return 'array';
  if (d === null) return 'number';
  return 'object';
}

function optionValues(f) {
  return (f.options || []).map(o => (o !== null && typeof o === 'object' && 'value' in o) ? o.value : o);
}

function defaults(SCHEMA) {
  const o = {};
  for (const f of SCHEMA) o[f.key] = clone(f.default);
  return o;
}

function field(SCHEMA, key) {
  for (const f of SCHEMA) if (f.key === key) return f;
  return undefined;
}

function merge(SCHEMA, partial, opts) {
  const out = defaults(SCHEMA);
  if (!partial) return out;
  const ignore = (opts && opts.ignore) || [];
  const unknown = [];
  for (const k of Object.keys(partial)) {
    if (ignore.indexOf(k) >= 0) continue;
    if (!field(SCHEMA, k)) { unknown.push(k); continue; }
    if (partial[k] !== undefined) out[k] = clone(partial[k]);
  }
  if (unknown.length) throw new Error('unknown setting' + (unknown.length > 1 ? 's' : '') + ': ' + unknown.join(', ') +
    ((opts && opts.where) ? ' (in ' + opts.where + ')' : ''));
  return out;
}

function validate(SCHEMA, params) {
  const errs = [];
  if (!params || typeof params !== 'object') return ['params is not an object'];
  for (const k of Object.keys(params)) if (!field(SCHEMA, k)) errs.push(k + ': unknown setting');
  for (const f of SCHEMA) {
    const v = params[f.key];
    const nullable = f.nullable || f.default === null;
    if (v === undefined) { errs.push(f.key + ': missing'); continue; }
    if (v === null) { if (!nullable) errs.push(f.key + ': null not allowed'); continue; }
    const t = typeOf(f);
    if (t === 'number') {
      if (typeof v !== 'number' || !isFinite(v)) { errs.push(f.key + ': not a finite number (' + v + ')'); continue; }
      if (typeof f.min === 'number' && v < f.min) errs.push(f.key + ': ' + v + ' below min ' + f.min);
      if (typeof f.max === 'number' && v > f.max) errs.push(f.key + ': ' + v + ' above max ' + f.max);
    } else if (t === 'bool') {
      if (typeof v !== 'boolean') errs.push(f.key + ': not a boolean');
    } else if (t === 'string') {
      if (typeof v !== 'string') errs.push(f.key + ': not a string');
    } else if (t === 'enum') {
      if (optionValues(f).indexOf(v) < 0) errs.push(f.key + ': ' + JSON.stringify(v) + ' not one of ' + JSON.stringify(optionValues(f)));
    } else if (t === 'array') {
      if (!Array.isArray(v)) errs.push(f.key + ': not an array');
    }
  }
  return errs;
}

function check(SCHEMA, params, where) {
  const errs = validate(SCHEMA, params);
  if (errs.length) throw new Error((where ? where + ': ' : '') + errs.join('; '));
  return params;
}

function withPreset(SCHEMA, PRESETS, name, partial, opts) {
  const base = (name && PRESETS && PRESETS[name]) || {};
  if (name && PRESETS && !PRESETS[name]) throw new Error('unknown preset ' + JSON.stringify(name));
  return merge(SCHEMA, Object.assign({}, base, partial || {}), opts);
}

const schema = { defaults, merge, validate, check, field, withPreset, typeOf, optionValues, clone, KMH };
if (typeof module !== 'undefined') module.exports = schema; else (self.CS = self.CS || {})['schema'] = schema;
