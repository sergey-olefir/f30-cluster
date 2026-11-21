'use strict';
/**
 * tools/road-scene/emu_run.js - Road Scene in the kit's app emulator (round fixes-1121 RS; tools/shots/acc/emu_run.js for road_scene) (kit/tools/emu.js: the car's GPU draw engine as WebAssembly
 * in a browser), on a private copy of the tree so no other emulator on this checkout is disturbed; headless Chrome shows
 * the page for a while; the app's log lines (the kit's "display: N fps sent, renderer ..." and ours "scene: gpu page ...")
 * are printed.
 *
 *   node tools/road-scene/emu_run.js [--port 8838] [--seconds 40] [--demo-ms 500] [--shot out.png] [--still] [--no-chrome]
 *
 * --still: no demo (the page with no data: nothing moves). Never ships anything; the copy holds a BENCH_STUB oap-sdk.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function tree(o) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'road-scene-emu-'));
    const r = path.join(work, 'root');
    fs.mkdirSync(r);
    const copy = (src, dst) => { execFileSync('cp', ['-R', src, dst]); };
    copy(path.join(ROOT, 'kit'), path.join(r, 'kit'));
    fs.symlinkSync(path.join(ROOT, 'shared'), path.join(r, 'shared'));
    fs.mkdirSync(path.join(r, 'apps'));
    copy(path.join(ROOT, 'apps', 'road_scene'), path.join(r, 'apps', 'road_scene'));
    const spec = JSON.parse(fs.readFileSync(path.join(r, 'apps', 'road_scene', 'app.json'), 'utf8'));
    spec.config.demoMs = o.demoMs;
    fs.writeFileSync(path.join(r, 'apps', 'road_scene', 'app.json'), JSON.stringify(spec, null, 2));
    const sdk = path.join(r, 'oap-sdk');
    fs.mkdirSync(sdk);
    fs.writeFileSync(path.join(sdk, 'index.js'), "'use strict';\n// BENCH_STUB: stands in for BMW's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n");
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'oap-sdk', version: '0.0.0-bench-stub', main: 'index.js' }) + '\n');
    const data = path.join(r, 'preview', 'emu', 'road_scene');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ demoCycle: !o.still, show: false }));
    return { work, root: r };
}

/** o: { port, seconds, demoMs, still, noChrome, shot, gl } -> a promise of the emulator's output and the app's log lines ('app ...'). */
function run(o) {
    const PORT = o.port || 8838, SECONDS = o.seconds || 40;
    return new Promise((resolve) => {
        const { work, root } = tree(Object.assign({ demoMs: 500 }, o));
        let out = '';
        const emu = spawn(process.execPath, [path.join(root, 'kit', 'tools', 'emu.js'), 'road_scene', '--port', String(PORT)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
        emu.stdout.on('data', (c) => { out += c; });
        emu.stderr.on('data', (c) => { out += c; });
        setTimeout(() => {
            const cargs = ['--headless=new', o.gl || '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-frame-rate-limit', '--window-size=1920,900', '--timeout=' + (SECONDS * 1000)];
            if (o.shot) cargs.push('--screenshot=' + path.resolve(o.shot));
            cargs.push('http://localhost:' + PORT + '/');
            // --no-chrome: no page draws; the emulator then counts each frame as drawn when it comes, at its FPS cap (the
            // app's own rate, the renderer taken out of the measure)
            const ch = o.noChrome ? spawn('sleep', [String(SECONDS)], { stdio: 'ignore' }) : spawn(CHROME, cargs, { stdio: 'ignore' });
            // the app's log comes to the pages over the emulator's WebSocket (Node 22's own client; the page does the ticking)
            try {
                const ws = new WebSocket('ws://localhost:' + PORT + '/ws');
                ws.onmessage = (ev) => {
                    if (typeof ev.data !== 'string') return;
                    try { const m = JSON.parse(ev.data); if (m.t === 'log') m.lines.forEach((l) => { out += 'app ' + l[1] + '\n'; }); } catch (e) { /* not json */ }
                };
                ch.on('exit', () => { try { ws.close(); } catch (e) { /* gone */ } });
            } catch (e) { out += '(no websocket client: ' + e.message + ')\n'; }
            ch.on('exit', () => {
                emu.kill('SIGTERM');
                setTimeout(() => {
                    const logs = execFileSync('find', [root, '-name', 'road_scene.log*', '-not', '-path', '*/node_modules/*'], { encoding: 'utf8' }).split('\n').filter(Boolean).sort().reverse();
                    logs.forEach((f) => { try { out += '\n' + fs.readFileSync(f, 'utf8'); } catch (e) { /* gone */ } });
                    if (!logs.length) out += '\n(no app log)';
                    try { execFileSync('rm', ['-rf', work]); } catch (e) { /* left */ }
                    resolve(out);
                }, 500);
            });
        }, 12000);
    });
}

module.exports = { run };
if (require.main === module) run({ port: Number(arg('--port', 8838)), seconds: Number(arg('--seconds', 40)), demoMs: Number(arg('--demo-ms', 500)), shot: arg('--shot', null), still: argv.indexOf('--still') >= 0, noChrome: argv.indexOf('--no-chrome') >= 0, gl: process.env.EMU_GL }).then((out) => { process.stdout.write(process.env.EMU_ALL ? out : out.split('\n').filter((l) => /scene: (gpu|show)|acc: state|beam: state|display:|fps|error|Error|renderd/i.test(l)).join('\n') + '\n'); });
