/*
 * Run as: node --expose-internals node8-check.js <file>   (or with the source on stdin and no file)
 * Parses the file with acorn at ecmaVersion 2017 (Node 8.16: no ?. ?? object spread, class fields,
 * optional catch binding, logical assignment, numeric separators, regex lookbehind / named groups) and prints
 * JSON { ok, error, identifiers: [...], members: [...] } — the names a source refers to, for the global and
 * newer-API checks of tests/node8.test.js (copied from the cruise simulator). Node's own bundled acorn: no dependency is installed.
 */
'use strict';
var fs = require('fs');
var acorn;
try { acorn = require('internal/deps/acorn/acorn/dist/acorn'); } catch (e) {
  try { acorn = require('acorn'); } catch (e2) { process.stdout.write(JSON.stringify({ ok: false, unavailable: true, error: 'no acorn' })); process.exit(0); }
}
var src = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
var ast;
try { ast = acorn.parse(src, { ecmaVersion: 2017, sourceType: 'script', allowHashBang: false }); } catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: e.message })); process.exit(0);
}
var ids = {}; var mem = {};
(function walk(n, parent, key) {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'Identifier') {
    var isProp = parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
      (parent.type === 'Property' && key === 'key' && !parent.computed));
    if (!isProp) ids[n.name] = true;
  }
  if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') mem[n.property.name] = true;
  for (var k in n) {
    if (k === 'loc' || k === 'start' || k === 'end') continue;
    var v = n[k];
    if (Array.isArray(v)) v.forEach(function (c) { walk(c, n, k); });
    else if (v && typeof v.type === 'string') walk(v, n, k);
  }
})(ast, null, null);
process.stdout.write(JSON.stringify({ ok: true, identifiers: Object.keys(ids).sort(), members: Object.keys(mem).sort() }));
