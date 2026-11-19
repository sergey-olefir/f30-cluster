'use strict';
/**
 * tools/acc-view: ACC View on the bench, to look at (round 1120, package AA).
 *
 *   node tools/acc-view/bench.js [--port 8940]        then open http://localhost:8940 and switch "Демо" or "Показувати" on
 *
 * The app lives outside apps/ (the Store globs "apps/*"), so it gets a bench tree of its own in a temporary folder: a copy of
 * bench/, links to shared/ and kit/, apps/acc_view linked to tools/acc-view/app/acc_view, a stub oap-sdk (never ship a build made
 * with it). Values go in as the tests feed them: POST /fake { front: { gap, speed, obj, qual } }, POST /fake { feed: { iface,
 * field, value } } for DisplayDataServer.functionalLibraryData, POST /signals { mode: 'manual', values: { speed } }.
 */
const path = require('path');
const { spawn } = require('child_process');
const { makeRoot } = require('./test-acc-view');

const args = process.argv.slice(2);
const port = args.indexOf('--port') >= 0 ? args[args.indexOf('--port') + 1] : '8940';
const { root } = makeRoot();
const env = Object.assign({}, process.env, { BENCH_PORT: String(port), BENCH_LAYER_CAP: '8' });
const srv = spawn(process.execPath, [path.join(root, 'bench', 'server.js'), 'acc_view'], { cwd: root, env, stdio: 'inherit' });
srv.on('exit', (c) => process.exit(c || 0));
