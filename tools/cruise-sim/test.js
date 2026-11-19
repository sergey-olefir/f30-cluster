#!/usr/bin/env node
'use strict';
// The test runner of the cruise simulator (SC1): runs every tests/*.test.js in its own Node process, one after the other.
//
//   node tools/cruise-sim/test.js [word ...]     only the files whose name contains one of the words
//   node tools/cruise-sim/test.js -v             print every file's whole output (otherwise only the failing ones)
//
// A file passes when it exits 0. Counts come from its "# pass N" / "# fail M" lines (tests/harness.js prints them);
// a file without them counts as one test. Prints one line per file and the totals; exits 1 on any failure.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, 'tests');
const args = process.argv.slice(2);
const verbose = args.indexOf('-v') >= 0;
const words = args.filter(a => a !== '-v');
const files = fs.readdirSync(dir).filter(f => /\.test\.js$/.test(f)).sort()
  .filter(f => !words.length || words.some(w => f.indexOf(w) >= 0));

let totPass = 0, totFail = 0, badFiles = 0;
const t0 = Date.now();
for (const f of files) {
  const t1 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { cwd: __dirname, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const mp = /^# pass (\d+)$/m.exec(out), mf = /^# fail (\d+)$/m.exec(out);
  let pass = mp ? +mp[1] : 0, fail = mf ? +mf[1] : 0;
  const ok = r.status === 0 && !r.error;
  if (!mp && !mf) { if (ok) pass = 1; else fail = 1; }
  if (!ok && fail === 0) fail = 1;
  totPass += pass; totFail += fail;
  if (!ok) badFiles++;
  console.log((ok ? 'PASS ' : 'FAIL ') + f.padEnd(28) + String(pass).padStart(4) + ' passed' + (fail ? ', ' + fail + ' failed' : '') +
    '  (' + ((Date.now() - t1) / 1000).toFixed(1) + ' s)' + (r.error ? '  ' + r.error.message : ''));
  if (verbose || !ok) console.log(out.split('\n').filter(l => verbose || !/^ok - /.test(l)).map(l => '    ' + l).join('\n'));
}
console.log('total: ' + totPass + ' passed, ' + totFail + ' failed, ' + files.length + ' files (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
process.exit(totFail || badFiles ? 1 : 0);
