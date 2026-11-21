'use strict';
/**
 * test-road-view.js - Road View in both themes (round "Road View", package TD; docs/traffic/TD-REPORT.md): the traffic light, the
 * wider sign set and the road scene, test modes behind the Діагностика settings diagRoadLight / diagRoadSigns / diagRoadScene.
 *
 *   node bench/test-road-view.js [--no-bench] [--no-gl] [--no-main] [--app twin_dial|f30_cluster]      (BENCH_PORT, default 8984, and +1; ports 8981-8989)
 *
 * Part 1, the decoder (shared/road_view.js) with an injected clock: every light state from the camera's raw codes (TR-REPORT A.3.1's
 *   proposal, each a config key), unknown values, low quality, another light's id, one stray message, stale after 1 s; the
 *   head-up feed's named states (no "go"); no overtaking from the limit's own event; the sign list, its qualifier, its relevance
 *   bit, the legacy codes, each tier's life, an end sign; the strip's order and its at most three; the scene's decoders against
 *   ACC View's own (apps/road_scene/world.js since fixes-1121 RS, read only) on the same input; the rear radars' neighbours; junk never throws.
 * Part 2, the pictures and the places, pure: the layout untouched while off (the same object); the layers' boxes inside the panel,
 *   clear of the telltales, BMW's black box, the gear gap, BMW's message panel and its own sign place; the atlases (RGBA, width a
 *   multiple of 4, up to date with the definitions, red only in the signs whose real colours have it); the shaders (size against
 *   the KOMBI's limit, highp, every sampler bound, GLSL ES 1.00 forms); the words in Ukrainian and English, every letter in
 *   Twin Dial's atlases; Node 8.16 syntax.
 * Part 3 (--no-gl skips), the shaders in headless Chrome's WebGL 1: compiled and linked, and red only inside the light's top lamp.
 * Part 4 (--no-bench skips), the real apps on a bench, one at a time: every switch off = the layers, shaders, uniforms and pixel
 *   memory of the commit this round started from (--no-main skips that comparison), nothing of the new sources subscribed; each
 *   test on = its layers within 8 a connection and 16 MiB in every layout, late watches, the first-message log lines, the light from
 *   the car's raw messages and gone 1 s later, the signs, the scene hidden behind Twin Dial's message card and BMW's map; off again.
 * Mac only, Node 18 or newer. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');
const H = require('./twin-harness');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8984;
const args = process.argv.slice(2);
const RV = require(path.join(ROOT, 'shared', 'road_view.js'));
const SG = require(path.join(ROOT, 'shared', 'road_signs.js'));
const RS = require(path.join(ROOT, 'shared', 'road_shaders.js'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE_COMMIT = 'cfb50e5';         // main when this round began

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const hitCircle = (r, c) => { const x = Math.max(r[0], Math.min(c[0], r[2])), y = Math.max(r[1], Math.min(c[1], r[3])); return (x - c[0]) * (x - c[0]) + (y - c[1]) * (y - c[1]) < c[2] * c[2]; };

/* ===================================================================================================================== */
const CAM = (o) => Object.assign({ trafficLightID: 3, trafficLightPositionX: 40, trafficLightPositionY: 128, trafficLightPositionZ: 50, trafficLightStatus: 1,
    trafficLightArrow: 15, trafficLightIndicateDirection: 1, trafficLightColor: 1, qualityRecognitionTrafficLight: 11 }, o || {});

function decoderChecks() {
    console.log('part 1: the decoder (shared/road_view.js)');
    const C = RV.cfgOf({});
    const L = (o) => RV.lightOfCam(C.lightCfg, CAM(o));
    // ---- one message of the camera's light
    ok(L({ trafficLightColor: 1 }).state === 'red' && L({ trafficLightColor: 4 }).state === 'redAmber' && L({ trafficLightColor: 2 }).state === 'amber' &&
        L({ trafficLightColor: 3 }).state === 'green', 'the camera\'s colours (assumed 1 red, 4 red + amber, 2 amber, 3 green) give their states');
    ok(L({ trafficLightColor: 3, trafficLightArrow: 1 }).arrow === 'left' && L({ trafficLightColor: 3, trafficLightArrow: 2 }).arrow === 'straight' &&
        L({ trafficLightColor: 3, trafficLightArrow: 3 }).arrow === 'right' && L({ trafficLightColor: 3, trafficLightArrow: 15 }).arrow === null, 'the arrow (assumed 1 left, 2 straight, 3 right; 15 none)');
    ok(L({ trafficLightColor: 2, trafficLightStatus: 2 }).state === 'flashAmber', 'amber with Status 2 (assumed "flashing") is flashing amber');
    ok(L({ trafficLightID: 63 }).state === 'none' && L({ trafficLightColor: 15 }).state === 'none' && L({ trafficLightColor: 0 }).state === 'none' &&
        L({ trafficLightColor: 9 }).state === 'none' && L({ trafficLightStatus: 3 }).state === 'none' && L({ trafficLightStatus: 0 }).state === 'none',
        'no light (id 63), colour unknown / unfilled / not in the table, Status 0 / 3 (dark): nothing');
    ok(L({ qualityRecognitionTrafficLight: 2 }).state === 'none' && L({ qualityRecognitionTrafficLight: 6 }).state === 'uncertain' && L({ qualityRecognitionTrafficLight: 15 }).state === 'red',
        'quality below 4: nothing; 4..7: uncertain (no colour); unfilled 15: no veto');
    ok(L({ trafficLightIndicateDirection: 2 }).state === 'uncertain' && L({ trafficLightIndicateDirection: 2 }).arrow === null && L({ trafficLightIndicateDirection: 15 }).state === 'red',
        'a light the camera says governs another direction: uncertain (never our colour); unfilled direction: no veto');
    ok(!RV.lightOfCam(C.lightCfg, null).sure && RV.lightOfCam(C.lightCfg, 'x').state === 'none' && RV.lightOfCam(C.lightCfg, {}).state === 'none' && L({ trafficLightColor: '3' }).state === 'green',
        'junk is nothing; a numeric string is read');
    // ---- the head-up feed (named)
    const V = (s) => RV.lightOfVsli(C.lightCfg, { xSpeedLimitAssist: { vsliSign: s } }).state;
    ok(V('TRAFFIC_LIGHT_RED') === 'red' && V('TRAFFIC_LIGHT_RED_YELLOW') === 'redAmber' && V('TRAFFIC_LIGHT_YELLOW') === 'amber' && V('TRAFFIC_LIGHT_GREEN') === 'green' &&
        V('TRAFFIC_LIGHT_UNSURE') === 'uncertain' && V('TRAFFIC_LIGHT_WITHOUT_PREDICTION') === 'uncertain' && V(11) === 'red', 'DisplayDataServer2 vsliSign names (and numbers) give the states');
    ok(V('TRAFFIC_LIGHT_GO_REQUEST') === 'green' && V('TRAFFIC_LIGHT_GREEN_SIGN') === 'none' && V('NO_VSLI') === 'none' && V('SPEED_LIMIT') === 'none',
        'GO_REQUEST is only its colour (green: never a "go"); the green-arrow plate and every other value: no light');
    // ---- the tracker: confirmation, stale, id change, flashing by rhythm
    let t = 0;
    const lines = [];
    const tr = RV.create({ light: 'car', signs: 'car', scene: 'car' }, { clock: () => t, log: { info: (s) => lines.push(s), warn: (s) => lines.push('W ' + s) } });
    tr.start();
    tr.lightCam(CAM({ trafficLightColor: 1 }));
    ok(tr.view(t).light.state === 'none', 'one message of a new light shows nothing yet (a stray message is not a light)');
    t += 100; tr.lightCam(CAM({ trafficLightColor: 1 }));
    ok(tr.view(t).light.state === 'red' && tr.view(t).light.sure, 'two in a row: red');
    t += 100; tr.lightCam(CAM({ trafficLightColor: 3 }));
    ok(tr.view(t).light.state === 'red', 'one stray green keeps red');
    t += 100; tr.lightCam(CAM({ trafficLightColor: 3 }));
    ok(tr.view(t).light.state === 'green', 'a second green: green');
    t += 1100;
    ok(tr.view(t).light.state === 'none', 'no message for 1.1 s: nothing (stale after 1 s, never a frozen lamp)');
    t += 100; tr.lightCam(CAM({ trafficLightColor: 1 })); t += 100; tr.lightCam(CAM({ trafficLightColor: 1 }));
    t += 100; tr.lightCam(CAM({ trafficLightColor: 1, trafficLightID: 7 }));
    ok(tr.view(t).light.state === 'none', 'another light (a new id): the old one is gone at once, the new one confirmed from the start');
    t += 100; tr.lightCam(CAM({ trafficLightColor: 1, trafficLightID: 7 }));
    ok(tr.view(t).light.state === 'red', '... and shown on its second message');
    // flashing amber from its rhythm: amber, dark, amber within 2.6 s
    const seq = [2, 2, 15, 15, 2, 2, 15, 15, 2];
    seq.forEach((c) => { t += 300; tr.lightCam(CAM({ trafficLightColor: c, trafficLightID: 9 })); });
    ok(tr.view(t).light.state === 'flashAmber', 'amber that comes and goes (Status steady) is flashing amber, its dark phase included');
    t += 300; tr.lightCam(CAM({ trafficLightColor: 15, trafficLightID: 9 }));
    ok(tr.view(t).light.state === 'flashAmber', 'the dark phase of a flashing amber still shows flashing amber');
    t += 4000;
    ok(tr.view(t).light.state === 'none', 'and goes with the light');
    ok(lines.some((l) => /^road: first lightCam \(TrafficLightRecognitionFrontCameraLegacy\.RecognitionTrafficLightCamera\) id 3 colour 1 status 1 quality 11$/.test(l)),
        'the first message of the source is one log line (numbers only): a drive with the test on answers "does the car send it"');
    ok(lines.filter((l) => /^road: light cam /.test(l)).length >= 2 && lines.every((l) => !/^W /.test(l)), 'state changes are logged with their raw codes, rate-limited; no warning');
    // ---- no overtaking from the limit's own event
    const NP = (x) => RV.noPassOfTsr(C.signsCfg, { recognitionNoPassing: x });
    ok(NP(1) === 'on' && NP(0) === 'none' && NP(2) === null && NP(15) === null && NP(undefined) === null && RV.noPassOfTsr(C.signsCfg, null) === null,
        'recognitionNoPassing (assumed): 1 on; 0 a filled nothing; 2 (trucks only) and 15 (unfilled) say nothing');
    t += 1000; tr.tsr({ recognitionNoPassing: 1, presentClassLimitSpeed: 10 });
    ok(tr.view(t).signs.some((s) => s.id === 'noOvertaking' && s.src === 'tsr'), 'no overtaking from the limit\'s event (the most likely new sign: TR-REPORT 0.4)');
    t += 300000;
    ok(tr.view(t).signs.some((s) => s.id === 'noOvertaking'), 'it holds while the stretch lasts (5 min later, no message since)');
    t += 1000; tr.tsr({ recognitionNoPassing: 0 });
    ok(!tr.view(t).signs.some((s) => s.id === 'noOvertaking'), 'a filled 0 ends it at once');
    // ---- the sign list
    const camEv = (types, q) => ({ eventDataQualifier: q || 'EVENT_DATA_AVAILABLE', trafficSign: types.map((x) => ({ type: x, value: 0 })) });
    ok(JSON.stringify(RV.signsOfCam(C.signsCfg, camEv(['STOP_SIGN', 'DS_CHILDREN', 'SPEED_LIMIT', 'DS_BEND_LEFT', 'SIGNAL_UNFILLED']))) === '["stop","children"]',
        'the camera\'s list: our signs kept (the limit and types outside the set are not ours to draw)');
    ok(RV.signsOfCam(C.signsCfg, camEv(['STOP_SIGN'], 'EVENT_DATA_NOT_AVAILABLE')).length === 0 && RV.signsOfCam(C.signsCfg, camEv(['STOP_SIGN'], 'EVENT_DATA_AVAILABLE_REDUCED')).length === 1,
        'a list whose qualifier is not "available" says nothing');
    ok(JSON.stringify(RV.signsOfCam2(C.signsCfg, { trafficSign: [{ type: 'GIVE_WAY', relevance: 1 }, { type: 'NO_ENTRY', relevance: 16 }, { type: 'DS_ROAD_WORKS', relevance: 65535 }] })) === '["giveWay","roadWorks"]',
        'the list with relevance bits: a sign without RELEVANTSIGN (bit 1) is not ours; unfilled bits: kept');
    ok(JSON.stringify(RV.signsOfLeg(C.signsCfg, { trafficSignType: 20, qualityRecognitionTrafficSign: 1 })) === '["stop"]' && RV.signsOfLeg(C.signsCfg, { trafficSignType: 20, qualityRecognitionTrafficSign: 3 }).length === 0 &&
        RV.signsOfLeg(C.signsCfg, { trafficSignType: 63 }).length === 0, 'the legacy raw sign (assumed: the same numbers): 20 stop; quality 3 / type 63 nothing');
    ok(Object.keys(RV.SIGNS).every((id) => SG.ORDER.indexOf(id) >= 0) && SG.ORDER.length === Object.keys(RV.SIGNS).length, 'every sign of the set has its drawing (' + SG.ORDER.length + ')');
    t += 1000; tr.signCam(camEv(['STOP_SIGN', 'DS_PEDESTRIAN_CROSSING', 'CITY_LIMIT_START_OF']));
    let ids = tr.view(t).signs.map((s) => s.id).sort().join();
    ok(ids === 'crossing,stop,town', 'a list seen: its signs are in force (' + ids + ')');
    t += 8500; ids = tr.view(t).signs.map((s) => s.id).sort().join();
    ok(ids === 'crossing,town', 'a point rule goes after 8 s, a warning stays 10 s, a town entry 10 s (' + ids + ')');
    t += 2000;
    ok(tr.view(t).signs.length === 0, 'after 10 s: none (short stale times: TR-REPORT 0.4)');
    tr.signCam(camEv(['NO_PASSING_SIGN'])); t += 1000; tr.signCam(camEv(['WITHDRAWAL_NO_PASSING_SIGN']));
    ids = tr.view(t).signs.map((s) => s.id).join();
    ok(ids === 'noOvertakingEnd', 'an end sign clears its start sign at once (' + ids + ')');
    // ---- the strip
    const st = (light, signs, o) => RV.strip({ light: { state: light }, signs: signs.map((x, i) => ({ id: x, tier: RV.SIGNS[x].tier, age: i })) }, o).map((x) => x.id).join();
    ok(st('none', [], { limit: true }) === '' && st('none', ['stop'], { limit: true }) === 'stop' && st('none', ['children', 'stop'], { limit: true }) === 'stop,children' &&
        st('red', [], { limit: true }) === 'light' && st('green', [], { limit: false }) === 'light', 'the combinations: limit alone, + rule, + rule + warning, + light, the light alone');
    ok(st('red', ['children', 'stop'], { limit: true }) === 'light,stop' && st('red', ['children', 'stop'], { limit: false }) === 'light,stop,children' &&
        st('none', ['noOvertaking', 'stop'], { limit: true }) === 'stop' && st('red', ['lightAhead'], { limit: true }) === 'light',
        'at most three with the limit; the order light, rule (a point rule first), warning; "lights ahead" says nothing beside a light');
    ok(RV.strip({ light: { state: 'none' }, signs: [] }, { limit: true, noPass: true })[0].theirs === true, 'the theme\'s own no-overtaking sign counts as the rule');
    // ---- the scene: the same decoders as ACC View's
    const Wo = require(path.join(ROOT, 'apps', 'road_scene', 'world.js'));
    const lanesEv = { laneBoundaryFront: [1.8, -1.7, 5.2, -5.3].map((y, i) => ({ modelQualifier: i === 3 ? 'LANE_BOUNDARY_MODEL_NOT_AVAILABLE' : 0, existenceProbability: 0.9, pointSegment1: { y },
        baseSegment1: { angle: 0.01, curvature: 0.002 }, parametersSegment1: { validLength: 60, curvatureChange: 0.0001 }, parametersSegment2: { validLength: 20 } })),
        laneBoundaryPropertiesFront: [{ typeInfo: { type: 'DASHED' } }, { typeInfo: { type: 'SOLID' } }, { typeInfo: { type: 'ROAD_EDGE' } }, { typeInfo: { type: 'DASHED' } }] };
    const recEv = { objectRecognitionInfo: [{ classificationType: 'CAR_WITH_OR_WITHOUT_TRAILER', objectID: 4 }, { classificationType: 'PEDESTRIAN', objectID: 5 }, { classificationType: 'ROAD_BOUNDARY', objectID: 6 }, { classificationType: 3, objectID: 7 }] };
    const posEv = { numberOfObjects: 4, objectPositionInfo: [{ positionX: 30, positionY: 0.2 }, { positionX: 12, positionY: -4 }, { positionX: 20, positionY: 6 }, { positionX: 150, positionY: 0 }] };
    const mine = RV.lanesOf(C.sceneCfg, lanesEv), theirs = Wo.laneModel(Wo.cfgOf({}), lanesEv);
    ok(mine && theirs && JSON.stringify(mine.lines) === JSON.stringify(theirs.lines), 'the lanes: the same lines as ACC View\'s laneModel on the same event (' + mine.lines.length + ' lines)');
    const om = RV.objectsOf(C.sceneCfg, recEv, posEv).map((o) => [o.id, o.cls, o.x, o.y]), ot = Wo.camObjects(Wo.cfgOf({}), recEv, posEv).map((o) => [o.id, o.cls, o.x, o.y]);
    ok(JSON.stringify(om) === JSON.stringify(ot) && om.length === 2, 'the objects: the same as ACC View\'s camObjects (a road boundary is not a road user; 150 m is out of range)');
    ok(JSON.stringify(RV.egoOf(mine)) === JSON.stringify(Wo.egoOf(theirs)), 'our lane: the same as ACC View\'s egoOf');
    t += 1000;
    const t2 = RV.create({ scene: 'car' }, { clock: () => t, log: { info() {} } });
    t2.start();
    ok(t2.view(t).scene.data === 'none', 'the scene before any message: "none"');
    t += 11000;
    ok(t2.view(t).scene.data === 'absent', '10 s with nothing at all: "absent" (the page says "Немає даних")');
    t2.lanes(lanesEv); t2.objRec(recEv); t2.objPos(posEv);
    let sc = t2.view(t).scene;
    ok(sc.data === 'ok' && sc.lanes.lines.length === 3 && sc.objects.length === 2 && sc.lead && sc.lead.x === 30, 'lanes and road users: the scene, the car in our lane is the one ahead');
    t2.lca({ statusLaneChangeWarning: { statusLaneChangeWarningLeft: 'WARNING_LEFT', statusLaneChangeWarningRight: 0, objectId1LaneChangeWarningRight: 0 } });
    sc = t2.view(t).scene;
    ok(sc.objects.filter((o) => o.side).length === 1 && sc.objects.some((o) => o.side && o.y > 0) && sc.lead.x === 30, 'the rear radars\' left warning: one neutral vehicle beside us on the left (not the one ahead)');
    ok(RV.sidesOfLca(C.sceneCfg, { statusLaneChangeWarning: { statusLaneChangeWarningLeft: 0, statusLaneChangeWarningRight: 0, objectId2LaneChangeWarningRight: 17 } }).right === true &&
        RV.sidesOfLca(C.sceneCfg, { statusLaneChangeWarning: { objectId1LaneChangeWarningLeft: 4294967295 } }).left === false && RV.sidesOfLca(C.sceneCfg, {}) === null,
        'a filled object id marks its side; 0 / 0xFFFFFFFF do not; no struct says nothing');
    t += 1600;
    sc = t2.view(t).scene;
    ok(!sc.lanes && sc.objects.length === 0 && sc.data === 'stale', 'silence: lanes gone after 1.5 s, road users faded out after 1.1 s ("stale": never frozen)');
    // ---- the capture package's scenarios replay through the same decoder
    const TLC = ['t_ms', 'trafficLightID', 'trafficLightPositionX', 'trafficLightPositionY', 'trafficLightPositionZ', 'trafficLightStatus', 'trafficLightArrow', 'trafficLightIndicateDirection', 'trafficLightColor', 'qualityRecognitionTrafficLight'];
    const scen = { kind: 'light', columns: TLC, frames: [[0, 3, 60, 128, 50, 1, 15, 1, 1, 11], [150, 3, 58, 128, 50, 1, 15, 1, 1, 11], [300, 3, 56, 128, 50, 1, 15, 1, 3, 11], [450, 3, 54, 128, 50, 1, 15, 1, 3, 11]] };
    const rl = RV.fromScenario(scen);
    t += 1000;
    const t4 = RV.create({ light: 'replay', signs: 'replay' }, { clock: () => t, log: { info() {} } });
    t4.start();
    const t0r = t, states = [];
    rl.forEach((m) => { t = t0r + m.t; t4.replay(m); states.push(t4.view(t).light.state); });
    RV.fromScenario({ kind: 'sign', stream: 'cam-legacy2', type: 'GIVE_WAY', value: 0, columns: ['t_ms', 'value', 'variable', 'supp1', 'supp2'], frames: [[0, 0, false, null, null]] }).forEach((m) => t4.replay(m));
    ok(rl.length === 4 && rl[0].iface === RV.IF.lightCam && states.join() === 'none,red,red,green' && t4.view(t).signs.some((x) => x.id === 'giveWay') &&
        RV.fromScenario({ kind: 'other', frames: [] }).length === 0 && RV.fromScenario(null).length === 0,
        'a scenario of the capture package (rv_analyse.py: a light track, a sign sighting) replays through the same decoder: ' + states.join(' '));
    // ---- the demo cycles every state; junk never throws
    const seen = {};
    t += 1000;
    const t3 = RV.create({ light: 'demo', signs: 'demo', scene: 'demo' }, { clock: () => t, log: { info() {} } });
    t3.start(); t3.demo({ light: true, signs: true, scene: true });
    const sceneSeen = {};
    for (let i = 0; i < 400; i++) { t += 100; const v = t3.view(t); seen[v.light.state + (v.light.arrow ? ':' + v.light.arrow : '')] = true; sceneSeen[v.demo] = true; }
    ok(['red', 'redAmber', 'amber', 'green', 'green:left', 'flashAmber', 'uncertain', 'none'].every((k) => seen[k]), 'the demo walks every light state: ' + Object.keys(seen).join(' '));
    ok(['empty', 'ahead', 'traffic', 'lightRed', 'lightGreen', 'nolanes'].every((k) => sceneSeen[k]), 'the demo walks the six scene situations');
    let threw = false;
    try {
        [null, undefined, 1, 'x', [], {}, { trafficSign: 'x' }, { statusLaneChangeWarning: 5 }, { laneBoundaryFront: [null, 1] }, { objectPositionInfo: [null] }].forEach((j) => {
            tr.lightCam(j); tr.dds2(j); tr.signCam(j); tr.signLeg(j); tr.signCam2(j); tr.tsr(j); tr.lanes(j); tr.objRec(j); tr.objPos(j); tr.lca(j); tr.replay(j); tr.view(t);
        });
    } catch (e) { threw = true; }
    ok(!threw, 'junk of every kind into every entry: nothing throws');
}

/* ===================================================================================================================== */
const BMW = {
    blackBox: [1420, 320, 1611, 440], belt: [587, 665, 626, 720], parkLamp: [1838, 217, 1900, 260], gearGap: [1380, 660, 1460, 720],
    tdPanel: [696, 595.75, 1226, 704], f30Panel: [699, 600, 1223, 701], f30StockSign: [538.45, 621.2, 44],
};

function pureChecks() {
    console.log('part 2: the places, the atlases, the shaders, the words (pure)');
    const dir = H.tree('twin_dial');
    const UI = require(path.join(dir, 'road_ui.js'));
    // ---- off: the layout untouched
    const lay = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8'));
    const lay6 = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', 'wb_comfort.json'), 'utf8'));
    const layD = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', 'wb_dials.json'), 'utf8'));
    const hudOf = (look, c) => ({ config: { roadView: Object.assign({ look }, c || {}) }, log: H.nolog });
    ok(UI.extend(hudOf('td'), lay) === lay && UI.extend(hudOf('6wb'), lay6) === lay6 && UI.extend({ config: {} }, lay) === lay,
        'every test off: the build gets the SAME layout object (nothing added, nothing copied)');
    const diff = spawnSync('git', ['diff', '--quiet', BASE_COMMIT, '--', 'apps/f30_cluster/hud/layouts', 'apps/twin_dial/hud/layouts', 'design/gen_6wb.py', 'design/gen_twin.py'], { cwd: ROOT });
    ok(diff.status === 0, 'the layout files and their generators are byte-identical to ' + BASE_COMMIT);
    const onT = UI.extend(hudOf('td', { light: 'demo', signs: 'car', scene: 'demo' }), lay), on6 = UI.extend(hudOf('6wb', { light: 'demo', signs: 'demo', scene: 'demo' }), lay6);
    const onD = UI.extend(hudOf('6wb', { light: 'demo', scene: 'demo' }), layD);
    const added = (L0, L1) => L1.widgets.slice(L0.widgets.length);
    ok(added(lay, onT).map((w) => w.id).join() === 'rv_light,rv_signs,rv_scene' && added(lay6, on6).map((w) => w.id).join() === 'rv_strip,rv_scene' &&
        added(layD, onD).map((w) => w.id).join() === 'rv_strip' && onT.widgets.length === lay.widgets.length + 3,
        'on: Twin Dial + light, signs, scene; 6WB Comfort + strip, scene; 6WB Dials + G20 + the strip only (its centre is BMW\'s own)');
    // ---- the places
    const boxes = added(lay, onT).concat(added(lay6, on6)).map((w) => ({ id: w.id + (w.rv.look === 'td' ? '@td' : '@6wb'), r: [w.x, w.y, w.x + w.w, w.y + w.h], look: w.rv.look }));
    const visible = require(path.join(ROOT, 'shared', 'visible.js'));
    ok(boxes.every((b) => b.r[0] >= 0 && b.r[1] >= 0 && b.r[2] <= 1920 && b.r[3] <= 720) && boxes.every((b) => !visible.check([{ id: b.id, x: b.r[0], y: b.r[1], w: b.r[2] - b.r[0], h: b.r[3] - b.r[1] }], 'panel').length),
        'every Road View layer is inside the panel and in the visible area (no hood, black box, belt or lamp warning)');
    const clear = boxes.every((b) => !hit(b.r, BMW.blackBox) && !hit(b.r, BMW.belt) && !hit(b.r, BMW.parkLamp) && !hit(b.r, BMW.gearGap) &&
        !hit(b.r, b.look === 'td' ? BMW.tdPanel : BMW.f30Panel) && (b.look === 'td' || !hitCircle(b.r, BMW.f30StockSign)));
    ok(clear, 'no layer meets BMW\'s black box, belt, parking lamp, the gear gap (no layer over it at all), BMW\'s message panel or its own sign place');
    const td = UI.LOOKS.td, s6 = UI.LOOKS['6wb'];
    const slotBox = (g, s, sz) => [g.x + s.cx - sz / 2, g.y + s.cy - sz / 2, g.x + s.cx + sz / 2, g.y + s.cy + sz / 2];
    // the light's housing is 0.42 (Twin Dial) / 0.44 (6WB) of its height wide (shared/road_shaders.js)
    ok(slotBox(td.strip[0], td.strip[0].slots[0], 58 * 0.42)[0] >= 1300 + 48 && slotBox(td.strip[0], td.strip[0].slots[0], 58 * 0.42)[2] <= 1380 &&
        slotBox(s6.strip[0], s6.strip[0].slots[0], 88)[0] >= 395 && slotBox(s6.strip[0], s6.strip[0].slots[1], 40)[2] <= 567,
        'the light sits right of Twin Dial\'s limit sign and left of the gear gap; the 6WB places sit right of the limit sign, the third left of the "260" figure (x 567)');
    ok(td.scene.y >= 326 + 8 && td.scene.y + td.scene.h <= 595 && td.scene.x >= 729 && td.scene.x + td.scene.w <= 1191 && s6.scene.x >= 747 && s6.scene.x + s6.scene.w <= 1173 && s6.scene.y + s6.scene.h <= 452,
        'the scenes: Twin Dial\'s under its page title and meta line, inside the page; the 6WB\'s between the dials, above the horizon');
    ok(UI.SOURCES.filter((x) => x[1] === 'RecognitionTrafficLightCamera')[0][2].indexOf('scene') >= 0 && UI.SOURCES.filter((x) => x[1] === 'functionalLibraryData')[0][2].indexOf('scene') >= 0,
        'the scene test alone reads the camera\'s light too (it draws the light over our lane)');
    ok(td.strip.every((g) => g.conn === 2) && td.scene.conn === 1 && s6.conn === 3, 'connections: Twin Dial 2 (strip) and 1 (scene); f30 its 4th (every 6WB layout uses at most 7 on the first three)');
    // ---- the atlases
    ['f30_cluster', 'twin_dial'].forEach((app) => {
        const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'hud', 'scene', 'rv_signs.json'), 'utf8'));
        const buf = Buffer.from(j.rgba, 'base64');
        ok(j.w % 4 === 0 && buf.length === j.w * j.h * 4 && !j.r8 && !j.format, app + ': rv_signs.json is RGBA8 ' + j.w + 'x' + j.h + ' (width a multiple of 4; colour needs RGBA, nothing here is a mask), ' + (j.w * j.h * 8 / 1048576).toFixed(2) + ' MiB of pixel memory');
        const look = app === 'twin_dial' ? 'td' : '6wb';
        ok(JSON.stringify(SG.ORDER.map((id) => SG.cellOf(id, UI.LOOKS[look].atlas.cell, UI.LOOKS[look].atlas.cols))) === JSON.stringify(SG.ORDER.map((id) => j.cells[id])), app + ': the runtime\'s cells are the baked table\'s');
        const redIn = {};
        SG.ORDER.forEach((id) => {
            const c = j.cells[id];
            let n = 0;
            for (let y = c[1]; y < c[1] + c[3]; y++) for (let x = c[0]; x < c[0] + c[2]; x++) { const o = (y * j.w + x) * 4; if (buf[o + 3] > 128 && buf[o] > 150 && buf[o + 1] < 70 && buf[o + 2] < 70) n++; }
            redIn[id] = n;
        });
        ok(SG.ORDER.every((id) => (redIn[id] > 0) === (SG.coloursOf(id).indexOf('red') >= 0 || id === 'lightAhead')), app + ': red only in the signs whose real colours have it (' + SG.ORDER.filter((id) => redIn[id]).length + ' of ' + SG.ORDER.length + ')');
    });
    const bake = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'road', 'bake_signs.js'), '--check'], { encoding: 'utf8' });
    ok(bake.status === 0, 'both atlases are what the vector definitions make now (tools/road/bake_signs.js --check)');
    // ---- the shaders
    Object.keys(RS.SOURCES).forEach((n) => {
        const src = RS.SOURCES[n], sh = RS.shipped(n);
        const samplers = (sh.match(/uniform sampler2D (\w+)/g) || []).map((x) => x.split(' ').pop());
        ok(sh.length < 8000 && /precision highp float/.test(sh) && !/#version|\btexture\(|\bround\(|\bin vec|\bout vec|%|\bswitch\b|\[\s*\]/.test(sh) && /gl_FragColor/.test(sh) &&
            samplers.every((s) => s === 'u_atlas'), n + ': ' + sh.length + ' B shipped (the KOMBI resets near 26.7 KB), highp, GLSL ES 1.00 forms, samplers ' + (samplers.join(' ') || 'none') + ' (u_atlas bound by road_ui.create)');
        void src;
    });
    const uiSrc = fs.readFileSync(path.join(ROOT, 'shared', 'road_ui.js'), 'utf8');
    ok(/c\.bind\(ref, 'u_atlas', a\.ref\)/.test(uiSrc) && /if \(w\.type === 'rvstrip'\) \{\s*const a = hud\._scene\('rv_signs'/.test(uiSrc), 'every strip layer binds its atlas when it is made (RAMSES draws nothing with an unbound sampler)');
    // ---- the words
    const I = require(path.join(dir, 'lang.js'));
    const textRaster = require(path.join(dir, 'hud_text.js'));
    const keys = UI.WORD_KEYS;
    ok(keys.every((k) => I.tl('uk', k) !== k && I.tl('en', k) !== k && I.tl('uk', k) !== I.tl('en', k) || k === 'rv.demo'), 'every word of the page in Ukrainian and English: ' + keys.map((k) => I.tl('uk', k) + ' / ' + I.tl('en', k)).join(', '));
    const miss = [];
    ['uk', 'en'].forEach((L) => keys.forEach((k) => Array.from(I.tl(L, k)).forEach((ch) => { Object.keys(UI.FONTS).forEach((f) => { if (ch !== ' ' && !textRaster.loadFont(UI.FONTS[f]).metrics.glyphs[ch]) miss.push(ch + '@' + UI.FONTS[f]); }); })));
    ok(!miss.length, 'every letter of the page\'s words is in Twin Dial\'s atlases (td_title, td_body, td_val)' + (miss.length ? ': ' + miss.slice(0, 6).join(' ') : ''));
    const { THEMES } = require(path.join(dir, 'hud_themes.js'));
    const P = ['absent', 'nolanes', 'ok'].map((d) => UI.paintPage(THEMES.twin, d, 'demo'));
    ok(P.every((p) => p.ink.every((i) => i.box[0] >= UI.PAGE.x && i.box[2] <= UI.PAGE.x + UI.PAGE.w && i.box[1] >= UI.PAGE.y && i.box[3] <= UI.PAGE.y + UI.PAGE.h)) && P[0].ink.length === 3 && P[2].ink.length === 2,
        'the page\'s words inside the page layer: title, mode, and "no data" / "no lane lines" when they apply');
    ok(['uk', 'en'].every((L) => ['f30_cluster', 'twin_dial'].every((a) => ['diagRoadLight', 'diagRoadSigns', 'diagRoadScene'].every((k) => I.tl(L, a + '.set.' + k) !== a + '.set.' + k &&
        ['off', 'car', 'demo', 'replay'].every((o) => I.tl(L, a + '.set.' + k + '.' + o) !== a + '.set.' + k + '.' + o)))), 'the three Діагностика settings and their options in both languages, both apps');
    // ---- units: nothing of ours carries one
    ok(!/units|_mi\(|mph|kmh/.test(uiSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no unit in anything Road View draws (the limit\'s own figure follows shared/units.js as before)');
    // ---- Node 8.16 syntax
    const CHECK = path.join(ROOT, 'tools', 'cruise-sim', 'tests', 'stubs', 'sc2-node8-check.js');
    const files = ['shared/road_view.js', 'shared/road_ui.js', 'shared/road_signs.js', 'shared/road_shaders.js', 'shared/hud.js', 'shared/twin_pages.js', 'shared/diag_settings.js'];
    const bad = [];
    files.forEach((f) => {
        const r = spawnSync(process.execPath, ['--expose-internals', CHECK, path.join(ROOT, f)], { encoding: 'utf8' });
        let j = null; try { j = JSON.parse(r.stdout); } catch (e) { j = { ok: false, error: 'no answer' }; }
        if (j.unavailable) return;
        if (!j.ok) bad.push(f + ': ' + j.error);
        else ['flat', 'flatMap', 'fromEntries', 'matchAll', 'replaceAll', 'allSettled', 'trimStart', 'trimEnd', 'finally', 'hasOwn', 'findLast', 'padStart'].forEach((m) => { if (j.members.indexOf(m) >= 0 && /^shared\/road_/.test(f)) bad.push(f + ' .' + m); });
    });
    ok(!bad.length, files.length + ' files parse as ES2017 (Node 8.16) and the new ones use no newer built-in' + (bad.length ? ': ' + bad.join('; ') : ''));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
}

/* ===================================================================================================================== */
function glChecks() {
    console.log('part 3: the shaders in headless Chrome (WebGL 1, GLSL ES 1.00)');
    if (!fs.existsSync(CHROME)) { console.log('  (no Chrome: skipped)'); return; }
    const at = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'hud', 'scene', 'rv_signs.json'), 'utf8'));
    const SH = {};
    Object.keys(RS.SOURCES).forEach((n) => { SH[n] = RS.shipped(n); });
    // per case: shader, canvas w/h, uniforms; the red check's allowed box (layer px) or null (no red at all)
    const cases = [];
    const lamp = (cx, cy, H) => [cx - H * 0.2, cy - H * 0.5, cx + H * 0.2, cy - H * 0.05];
    [['rv_strip_6wb', 3], ['rv_strip_td', 2]].forEach(([n, k]) => {
        for (let s = 1; s <= 6; s++) {
            const it = [[40, 50, 84, 2]].concat(new Array(k - 1).fill([0, 0, 0, 0]));
            cases.push({ n, w: 120, h: 100, s, u: { u_it: [].concat.apply([], it), u_ce: new Array(k * 4).fill(0), u_lt: [s, s === 4 ? 1 : 0, 0, 0], u_asz: [at.w, at.h], u_k: [1, 0, 0, 0], u_fg: [0.9, 0.9, 0.9] },
                allow: s <= 2 ? lamp(40, 50, 84) : null });
        }
    });
    [['rv_scene_td'], ['rv_scene_6wb']].forEach(([n]) => {
        for (const s of [0, 1, 4, 6]) {
            cases.push({ n, w: 400, h: 260, s, u: { u_view: [0.06, 34, 4, 100], u_ln: [5.25, 0, 0, 4, 1.75, 0, 0, 2, -1.75, 0, 0, 2, -5.25, 0, 0, 4], u_lp: [110, 1, 0, 0, 110, 1, 0, 0, 110, 1, 0, 0, 110, 1, 0, 0],
                u_ego: [0, 0, 0, 1.75], u_ob: [18, 0, 11, 1, 30, 3.5, 2, 1, 45, -3.5, 1, 1, 25, -6.5, 4, 1].concat(new Array(16).fill(0)), u_lt: [s, 0, 40, 0], u_fl: [0, 1, 0, 0], u_fg: [0.9, 0.9, 0.9], u_dim: [0.55, 0.57, 0.6], u_k: [1, 0, 0, 0] },
                allow: s === 1 || s === 2 ? [150, 0, 250, 140] : null });
        }
    });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-gl-'));
    const html = '<!doctype html><meta charset="utf-8"><body><pre id="o">running</pre><script>\n' +
        'const SH = ' + JSON.stringify(SH) + ';\nconst CASES = ' + JSON.stringify(cases) + ';\nconst AT = { w: ' + at.w + ', h: ' + at.h + ', b64: "' + at.rgba + '" };\n' +
        'const VS = "attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }";\n' +
        'const out = []; const c = document.createElement("canvas"); const gl = c.getContext("webgl", { premultipliedAlpha: false });\n' +
        'out.push("webgl " + (gl ? gl.getParameter(gl.SHADING_LANGUAGE_VERSION) : "none"));\n' +
        'const raw = atob(AT.b64); const px = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) px[i] = raw.charCodeAt(i);\n' +
        'const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, AT.w, AT.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);\n' +
        'gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);\n' +
        'const progs = {};\n' +
        'const mk = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };\n' +
        'for (const n of Object.keys(SH)) { const v = mk(gl.VERTEX_SHADER, VS), f = mk(gl.FRAGMENT_SHADER, SH[n]); const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);\n' +
        ' progs[n] = p; out.push("prog " + n + " compile " + gl.getShaderParameter(f, gl.COMPILE_STATUS) + " link " + gl.getProgramParameter(p, gl.LINK_STATUS) + " log " + JSON.stringify(gl.getShaderInfoLog(f) || "")); }\n' +
        'const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);\n' +
        'CASES.forEach((k, ci) => { const p = progs[k.n]; c.width = k.w; c.height = k.h; gl.viewport(0, 0, k.w, k.h); gl.useProgram(p);\n' +
        ' const l = gl.getAttribLocation(p, "a_pos"); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);\n' +
        ' const U = Object.assign({ u_size: [k.w, k.h] }, k.u); const info = {}; const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < nu; i++) { const a = gl.getActiveUniform(p, i); info[a.name.replace(/\\[0\\]$/, "")] = a; }\n' +
        ' Object.keys(U).forEach((name) => { const a = info[name]; if (!a) return; const loc = gl.getUniformLocation(p, name) || gl.getUniformLocation(p, name + "[0]"); const v = new Float32Array(U[name]);\n' +
        '  if (a.type === gl.FLOAT_VEC4) gl.uniform4fv(loc, v); else if (a.type === gl.FLOAT_VEC3) gl.uniform3fv(loc, v); else if (a.type === gl.FLOAT_VEC2) gl.uniform2fv(loc, v); else if (a.type === gl.FLOAT) gl.uniform1fv(loc, v); });\n' +
        ' if (info.u_atlas) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(gl.getUniformLocation(p, "u_atlas"), 0); }\n' +
        ' gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); const q = new Uint8Array(k.w * k.h * 4); gl.readPixels(0, 0, k.w, k.h, gl.RGBA, gl.UNSIGNED_BYTE, q);\n' +
        ' let lit = 0, red = 0, out1 = 0; for (let y = 0; y < k.h; y++) for (let x = 0; x < k.w; x++) { const o = ((k.h - 1 - y) * k.w + x) * 4; if (q[o + 3] > 60) lit++; if (q[o + 3] > 120 && q[o] > 150 && q[o + 1] < 80 && q[o + 2] < 80) { red++; const A = k.allow; if (!A || x < A[0] || x > A[2] || y < A[1] || y > A[3]) out1++; } }\n' +
        ' out.push("case " + ci + " " + k.n + " s " + k.s + " lit " + lit + " red " + red + " outside " + out1); });\n' +
        'document.getElementById("o").textContent = out.join("\\n");\n</script>';
    const file = path.join(work, 'gl.html');
    fs.writeFileSync(file, html);
    const r = spawnSync(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--virtual-time-budget=8000', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 90000 });
    const dom = (r.stdout || '').replace(/&quot;/g, '"');
    ok(/webgl WebGL GLSL ES 1\.0/.test(dom), 'headless Chrome has WebGL 1 (GLSL ES 1.00)');
    Object.keys(SH).forEach((n) => {
        const m = new RegExp('prog ' + n + ' compile (\\w+) link (\\w+)').exec(dom);
        ok(m && m[1] === 'true' && m[2] === 'true', n + ': compiles and links as GLSL ES 1.00 in WebGL');
    });
    const rows = (dom.match(/case \d+ \S+ s \d+ lit \d+ red \d+ outside \d+/g) || []).map((l) => { const a = l.split(' '); return { n: a[2], s: +a[4], lit: +a[6], red: +a[8], out: +a[10] }; });
    ok(rows.length === cases.length, 'every case drawn (' + rows.length + ' of ' + cases.length + ')');
    ok(rows.every((x) => x.out === 0), 'red ONLY inside the light\'s top lamp (red, red + amber) and nowhere at all in the other states: ' + rows.filter((x) => x.out).map((x) => x.n + ' s' + x.s + ' ' + x.out + ' px').join(', '));
    ok(rows.filter((x) => x.s === 1).every((x) => x.red > 20) && rows.filter((x) => x.n.indexOf('strip') > 0 && x.s >= 1).every((x) => x.lit > 200), 'the red lamp is lit in every look; every strip state draws its housing');
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* tmp */ }
}

/* ===================================================================================================================== */
function req(port, method, url, body, timeout) {
    return new Promise((resolve) => {
        const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const r = http.request({ host: '127.0.0.1', port, path: url, method, timeout: timeout || 8000, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, (res) => {
            const ch = [];
            res.on('data', (d) => ch.push(d));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(ch) }));
        });
        r.on('error', () => resolve(null));
        r.on('timeout', () => { r.destroy(); resolve(null); });
        if (data) r.write(data);
        r.end();
    });
}
function sceneOf(port) {
    return new Promise((resolve) => {
        const r = http.get({ host: '127.0.0.1', port, path: '/events', timeout: 8000 }, (res) => {
            let buf = '';
            res.on('data', (d) => {
                buf += d.toString('utf8');
                const i = buf.indexOf('data: {"t":"scene"');
                if (i >= 0) { const j = buf.indexOf('\n', i); if (j > 0) { r.destroy(); try { resolve(JSON.parse(buf.slice(i + 6, j))); } catch (e) { resolve(null); } } }
            });
        });
        r.on('error', () => resolve(null));
        r.on('timeout', () => { r.destroy(); resolve(null); });
    });
}
function layersOf(sc) {
    const per = {}, rects = [];
    (sc && sc.layers || []).forEach((l) => {
        if (l.kind === 'asset') return;
        const m = /_(\d+)$/.exec(String(l.app || '')), conn = String(m ? Number(m[1]) - 1 : 0);
        per[conn] = (per[conn] || 0) + 1;
        rects.push({ key: l.key, conn, kind: l.kind, r: [l.x, l.y, l.x + l.w, l.y + l.h], fs: l.fs });
    });
    return { per, rects, n: Object.keys(per).reduce((a, k) => a + per[k], 0) };
}
/** The scene as structure: per layer its kind, class, z, box, shader hash, uniform names and binds (the clock's text aside). */
function structure(sc) {
    return (sc && sc.layers || []).map((l) => [l.app, l.kind, l.class, l.z, l.x, l.y, l.w, l.h, l.iw, l.ih, l.format, l.fs ? crypto.createHash('sha1').update(String(l.fs)).digest('hex').slice(0, 12) : '',
        Object.keys(l.uniforms || {}).sort().join(','), Object.keys(l.binds || {}).sort().join(',')].join('|')).sort();
}

class Bench {
    constructor(root, app, port, config) { this.root = root; this.app = app; this.port = port; this.config = config; }
    async start() {
        const tmp = this.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-bench-'));
        const data = path.join(tmp, 'data');
        fs.mkdirSync(data);
        this.stop_ = path.join(tmp, 'STOP'); this.logf = path.join(tmp, 'bench.log');
        const env = Object.assign({}, process.env, { BENCH_PORT: String(this.port), BENCH_DATA_DIR: data });
        if (this.config) env.BENCH_CONFIG = JSON.stringify(this.config);
        this.kid = spawn('python3', ['-I', path.join(ROOT, 'tools', 'shots', 'bounded.py'), '10800', this.stop_, this.logf, '--', 'node', path.join(this.root, 'bench', 'server.js'), this.app], { cwd: this.root, env, stdio: 'ignore' });
        return this.until((q) => q.ready && (this.app !== 'twin_dial' || q.activeName === 'twin') && /widgets, \d+ layers/.test(this.log()), 2400000);     // a sleeping Mac builds slowly
    }
    log() { try { return fs.readFileSync(this.logf, 'utf8'); } catch (e) { return ''; } }
    async probe() { const r = await req(this.port, 'GET', '/probe'); try { return r && r.status === 200 ? JSON.parse(r.body.toString('utf8')) : null; } catch (e) { return null; } }
    post(u, b) { return req(this.port, 'POST', u, b); }
    set(key, value) { return this.post('/setting', { key, value }); }
    feed(iface, field, value) { return this.post('/fake', { feed: { iface, field, value } }); }
    async until(fn, ms) { const end = Date.now() + ms; let p = null; while (Date.now() < end) { p = await this.probe(); try { if (p && fn(p)) return p; } catch (e) { /* not yet */ } await sleep(250); } return null; }
    scene() { return sceneOf(this.port); }
    async stop() {
        fs.writeFileSync(this.stop_, 'done\n');
        await new Promise((r) => { this.kid.on('exit', r); setTimeout(r, 15000); });
        try { fs.rmSync(this.tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
    }
}

const NEW_IFACES = /TrafficLightRecognitionFrontCameraLegacy|DisplayDataServer2|SignRecognitionFrontCameraLegacy|LaneBoundaries|ObjectRecognitionFrontCamera|AssistedDrivingViewLateralCollisionAvoidance/;

/** The commit this round began from, as a folder of its own (git archive), to run its bench beside ours. */
function mainTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-main-'));
    const tar = execFileSync('git', ['archive', '--format=tar', BASE_COMMIT], { cwd: ROOT, maxBuffer: 512 << 20 });
    execFileSync('tar', ['-x', '-C', dir], { input: tar, maxBuffer: 512 << 20 });
    if (fs.existsSync(path.join(ROOT, 'oap-sdk'))) fs.symlinkSync(path.join(ROOT, 'oap-sdk'), path.join(dir, 'oap-sdk'));
    return dir;
}

async function offCompare(app, settle) {
    // every switch off: our scene against the base commit's, structure for structure
    let main = null, ours = null;
    const dir = mainTree();
    try {
        for (const [root, tag] of [[dir, 'main'], [ROOT, 'ours']]) {
            const b = new Bench(root, app, PORT + 1, null);
            const p = await b.start();
            if (!p) { console.log('  (' + tag + ' bench did not come up)'); await b.stop(); continue; }
            await settle(b);
            const sc = await b.scene();
            const s = { st: structure(sc), px: sc && sc.pixels, log: b.log() };
            if (tag === 'main') main = s; else ours = s;
            await b.stop();
        }
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ } }
    if (!main || !ours) { ok(false, app + ': both benches came up for the off comparison'); return; }
    const a = main.st.join('\n'), b = ours.st.join('\n');
    ok(a === b && main.px === ours.px, app + ', every switch off: the same ' + ours.st.length + ' layers as ' + BASE_COMMIT + ' (kind, class, z, box, shader, uniforms, binds) and the same pixel memory (' + (ours.px / 1048576).toFixed(2) + ' MiB)' +
        (a === b ? '' : ': ' + main.st.filter((x) => ours.st.indexOf(x) < 0).slice(0, 2).join(' / ') + ' <> ' + ours.st.filter((x) => main.st.indexOf(x) < 0).slice(0, 2).join(' / ')));
    ok(!NEW_IFACES.test(ours.log), app + ', off: none of the new sources is named in the bench log (nothing subscribed)');
}

const IFC = { light: 'de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy', tsr: 'de.bmw.dass.TrafficSignRecognition', cam: 'de.bmw.environmentalmodel.SignRecognitionFrontCamera',
    lanes: 'de.bmw.environmentalmodel.LaneBoundaries' };
const TSR = (nopass, cls) => ({ presentWithdrawalLimitSpeed: 1, recognitionNoPassing: nopass, nextWithdrawalLimitSpeed: 3, presentClassLimitSpeed: cls, nextClassLimitSpeed: 254, countryCodingTrafficSign: 0,
    displayTextMessage: 0, unitOfMeasurementSpeedLimit: 0, displayTextMessageNpi: 0, statusDataMatchingCameraADAS: 0, statusStreetTyp: 0, evaluationStreetTyp: 0, displaySupplementalSign: 0,
    triggerPresentClassLimitSpeed: 0, displaySpeedNPIDistance: 255, controlSLIWarning: 0 });

async function benchApp(app) {
    console.log('part 4: ' + app + ' on a bench (port ' + PORT + ')');
    const settle = async (b) => { await b.post('/signals', { mode: 'manual', values: { speed: 40, rpm: 1500, gear: 3, engine: 2, condition: 10 } }); if (app === 'f30_cluster') { await b.set('byMode', false); } else { await b.set('tab', '1'); await b.post('/fake', { scene: 'car-rest' }); } await sleep(2500); };     // Twin Dial: the message list read, at rest (the machine starts blind)
    if (args.indexOf('--no-main') < 0) await offCompare(app, settle);
    const b = new Bench(ROOT, app, PORT, null);
    const p0 = await b.start();
    ok(!!p0, app + ': the bench is up');
    if (!p0) { console.log(b.log().split('\n').slice(-12).join('\n')); await b.stop(); return; }
    try {
        await settle(b);
        let sc = await b.scene(), L0 = layersOf(sc);
        let p = await b.probe();
        ok(p.road && p.road.look === (app === 'twin_dial' ? 'td' : '6wb') && !p.road.modes.light && !p.road.modes.signs && !p.road.modes.scene && !p.road.widgets.length && !Object.keys(p.road.subs).length,
            app + ', off (the default): no Road View layer, no subscription; the two events already received carry an inert tap (' + p.road.taps.length + ')');
        const px0 = sc.pixels;
        // ---- on: demo, every layout
        for (const k of ['diagRoadLight', 'diagRoadSigns', 'diagRoadScene']) await b.set(k, 'demo');
        p = await b.until((q) => q.road && q.road.widgets.length >= 2, 20000);
        await sleep(1200);
        const layouts = app === 'twin_dial' ? [[null, 'twin']] : [['wb_comfort', 'wb_comfort'], ['wb_sport', 'wb_sport'], ['wb_eco', 'wb_eco'], ['g20', 'wb_dials']];
        const counts = [];
        for (const [lay, name] of layouts) {
            if (lay === 'g20') { await b.set('hudLayout', 'wb_comfort'); await b.set('g20', true); } else if (lay) { await b.set('g20', false); await b.set('hudLayout', lay); }
            await b.until((q) => q.activeName === name && q.road && q.road.widgets.length >= 1, 15000);
            await sleep(1200);
            sc = await b.scene();
            const L = layersOf(sc);
            p = await b.probe();
            counts.push(name + ' ' + Object.keys(L.per).sort().map((k) => L.per[k]).join('/') + ' ' + (sc.pixels / 1048576).toFixed(2) + ' MiB [' + p.road.widgets.map((w) => w.id).join(',') + ']');
            ok(Object.keys(L.per).every((k) => L.per[k] <= 8) && L.n <= 32 && sc.pixels <= 16 * 1048576 && !(sc.layers || []).some((l) => l.state === 'refused' || l.state === 'waiting'),
                app + ' ' + name + ', all three tests on: ' + counts[counts.length - 1] + ' (<= 8 a connection, <= 16 MiB, nothing refused)');
        }
        if (app === 'f30_cluster') { await b.set('g20', false); await b.set('hudLayout', 'wb_comfort'); await b.until((q) => q.activeName === 'wb_comfort', 15000); await sleep(1000); }
        sc = await b.scene();
        p = await b.probe();
        const L1 = layersOf(sc);
        const ours = L1.rects.filter((x) => /rv_/.test(String((p.road.widgets.filter((w) => w.box[0] === x.r[0] && w.box[1] === x.r[1])[0] || {}).id)));
        ok(ours.length === (app === 'twin_dial' ? 3 : 2) && ours.every((x) => x.kind === 'effect') && L1.n - L0.n === ours.length && sc.pixels - px0 <= (app === 'twin_dial' ? 0.6 : 1.5) * 1048576,
            app + ': ' + ours.length + ' effect layers more (' + L0.n + ' -> ' + L1.n + '), pixel memory +' + ((sc.pixels - px0) / 1048576).toFixed(2) + ' MiB (the sign atlas only)');
        ok(L1.rects.every((x) => !(x.kind !== 'asset' && /rv_/.test(String(x.fs || '')) && hit(x.r, BMW.gearGap))) && ours.every((x) => !hit(x.r, BMW.gearGap) && !hit(x.r, app === 'twin_dial' ? BMW.tdPanel : BMW.f30Panel)),
            app + ': no Road View layer over the gear gap or BMW\'s message panel');
        // ---- car mode: late watches, the light from raw messages, stale, the signs
        for (const k of ['diagRoadLight', 'diagRoadSigns', 'diagRoadScene']) await b.set(k, 'off');
        await b.until((q) => q.road && !q.road.widgets.length, 15000);
        for (const k of ['diagRoadLight', 'diagRoadSigns', 'diagRoadScene']) await b.set(k, 'car');
        p = await b.until((q) => q.road && q.road.modes.light === 'car' && q.road.modes.scene === 'car' && q.road.widgets.length >= 2, 20000);
        await sleep(1500);
        const lg = b.log();
        ok(!!p && Object.keys(p.road.subs).length === 8 && Object.keys(p.road.subs).every((k) => p.road.subs[k] === 'late') && /road: watch TrafficLightRecognitionFrontCameraLegacy\.RecognitionTrafficLightCamera ok/.test(lg) &&
            /road: watch LaneBoundaries\.LaneBoundaries ok/.test(lg), app + ': switched to "car data": the 8 new sources watched late, once each (read only)');
        const cam = (col) => b.feed(IFC.light, 'RecognitionTrafficLightCamera', { trafficLightID: 3, trafficLightPositionX: 40, trafficLightPositionY: 128, trafficLightPositionZ: 50, trafficLightStatus: 1,
            trafficLightArrow: 15, trafficLightIndicateDirection: 1, trafficLightColor: col, qualityRecognitionTrafficLight: 11 });
        await b.feed(IFC.tsr, 'TrafficSignRecognition', TSR(0, 10));
        await cam(1); await sleep(80); await cam(1); await sleep(120);
        p = await b.probe();
        const lightNow = p.road.view && p.road.view.light;
        ok(lightNow && lightNow.state === 'red' && p.road.items.some((i) => i.kind === 'light'), app + ': two raw camera messages (colour 1): red beside the limit');
        await sleep(1300);
        p = await b.probe();
        ok(p.road.view.light.state === 'none' && !p.road.items.some((i) => i.kind === 'light'), app + ': 1.3 s without a message: the light is gone (stale), nothing frozen');
        ok(/road: first lightCam \(TrafficLightRecognitionFrontCameraLegacy\.RecognitionTrafficLightCamera\) id 3 colour 1/.test(b.log()), app + ': the first message logged once: "road: first lightCam ..."');
        await b.feed(IFC.tsr, 'TrafficSignRecognition', TSR(1, 10));
        await b.feed(IFC.cam, 'TrafficSignRecognitionFrontCamera', { eventDataQualifier: 'EVENT_DATA_AVAILABLE', trafficSign: [{ type: 'DS_CHILDREN', value: 0 }] });
        await sleep(400);
        p = await b.probe();
        ok(p.road.items.map((i) => i.id).join() === 'noOvertaking,children', app + ': no overtaking from the limit\'s event and a warning from the camera\'s list: ' + p.road.items.map((i) => i.id).join());
        const lanes = { laneBoundaryFront: [5.25, 1.75, -1.75, -5.25].map((y) => ({ modelQualifier: 0, existenceProbability: 0.9, pointSegment1: { y }, baseSegment1: { angle: 0, curvature: 0 }, parametersSegment1: { validLength: 80 } })),
            laneBoundaryPropertiesFront: [{ typeInfo: { type: 'ROAD_EDGE' } }, { typeInfo: { type: 'DASHED' } }, { typeInfo: { type: 'DASHED' } }, { typeInfo: { type: 'ROAD_EDGE' } }] };
        await b.feed(IFC.lanes, 'LaneBoundaries', lanes);
        await sleep(400);
        p = await b.probe();
        const sw = p.road.widgets.filter((w) => w.type === 'rvscene')[0];
        ok(sw && p.road.view.scene.data === 'ok' && p.road.view.scene.lines === 4 && sw.shown === 1, app + ': the lanes from the raw event: the scene shows (' + (sw && sw.data) + ', shown ' + (sw && sw.shown) + ')');
        if (app === 'twin_dial') {
            await b.post('/fake', { scene: 'car-door' });        // the car's own sequence: the list names a message, the cluster displays it
            await sleep(1200);
            await b.feed(IFC.lanes, 'LaneBoundaries', lanes);         // fresh lanes (they go stale after 1.5 s): the scene has something to show
            await sleep(300);
            p = await b.probe();
            const s2 = p.road.widgets.filter((w) => w.type === 'rvscene')[0];
            ok(s2 && s2.shown === 0 && p.road.view.scene.data === 'ok', 'twin_dial: a check-control message shows: the scene steps aside (the message card is never covered)');
            await b.post('/fake', { scene: 'car-door-closing' }); await b.post('/fake', { scene: 'car-door-closed' });
            await b.feed(IFC.lanes, 'LaneBoundaries', lanes);
            await sleep(1500);
            p = await b.probe();
            ok(p.road.widgets.filter((w) => w.type === 'rvscene')[0].shown === 1, 'twin_dial: the message gone: the scene is back');
            await b.set('tab', '3');
            await b.feed(IFC.lanes, 'LaneBoundaries', lanes);
            await sleep(900);
            p = await b.probe();
            ok(p.road.widgets.filter((w) => w.type === 'rvscene')[0].shown === 0, 'twin_dial: on another tab the scene is not shown');
            await b.set('tab', '1');
        } else {
            await b.set('stockMap', true);
            await b.feed(IFC.lanes, 'LaneBoundaries', lanes);
            await sleep(900);
            p = await b.probe();
            ok(p.road.widgets.filter((w) => w.type === 'rvscene')[0].shown === 0, 'f30_cluster: BMW\'s map shown through the centre window: the scene steps aside (BMW\'s map is never covered)');
            await b.set('stockMap', false);
        }
        // replay: a scenario file of the capture package in the data folder (config.roadView.replay's name)
        const TLC = ['t_ms', 'trafficLightID', 'trafficLightPositionX', 'trafficLightPositionY', 'trafficLightPositionZ', 'trafficLightStatus', 'trafficLightArrow', 'trafficLightIndicateDirection', 'trafficLightColor', 'qualityRecognitionTrafficLight'];
        const frames = [];
        for (let i = 0; i < 40; i++) frames.push([i * 100, 5, 60 - i, 128, 50, 1, 15, 1, 1, 11]);
        fs.writeFileSync(path.join(b.tmp, 'data', 'road_replay.jsonl'), JSON.stringify({ kind: 'light', columns: TLC, frames }));
        await b.set('diagRoadLight', 'replay');
        await b.until((q) => q.road && q.road.modes.light === 'replay', 15000);
        p = await b.until((q) => q.road && q.road.view && q.road.view.light && q.road.view.light.state === 'red', 8000);
        ok(!!p && /road: replay road_replay\.jsonl: 40 lines/.test(b.log()), app + ': "запис": a light track of the capture package played from the data folder (red, from its raw codes)');
        await b.set('diagRoadLight', 'car');
        await b.until((q) => q.road && q.road.modes.light === 'car', 15000);
        // units: the same items in mph
        await b.set('units', 'mi');
        await b.feed(IFC.tsr, 'TrafficSignRecognition', TSR(1, 10));
        await sleep(1200);
        p = await b.probe();
        ok(p.road.items.map((i) => i.id).join().indexOf('noOvertaking') === 0, app + ': in mph the strip is the same (Road View carries no unit)');
        await b.set('units', 'km');
        // ---- off again
        for (const k of ['diagRoadLight', 'diagRoadSigns', 'diagRoadScene']) await b.set(k, 'off');
        p = await b.until((q) => q.road && !q.road.widgets.length, 15000);
        await sleep(1000);
        sc = await b.scene();
        const L2 = layersOf(sc);
        ok(!!p && L2.n === L0.n && JSON.stringify(L2.per) === JSON.stringify(L0.per) && Math.abs(sc.pixels - px0) < 1, app + ': switched off again: ' + L2.n + ' layers ' + JSON.stringify(L2.per) + ', pixel memory as before (the atlas dropped)');
        await cam(1); await cam(1); await sleep(200);
        p = await b.probe();
        ok(!p.road.items.length && !p.road.tracker, app + ': off: the values that still arrive are ignored (the watches stay until the app restarts)');
        const errs = b.log().split('\n').filter((l) => /\bERROR\b|uncaught|too many layers|pixel memory is full|refused|road: .*(threw|error)/.test(l) && !/WARN layout/.test(l));
        ok(!errs.length, app + ': no error, no refusal in the bench log' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
        const rl = b.log().split('\n').filter((l) => /\broad: /.test(l)).map((l) => l.split('road: ')[1]);
        ok(rl.length > 5 && rl.every((l) => !/[a-z]{3,} [a-z]{3,} [a-z]{3,} [a-z]{3,} [a-z]{3,} [A-Z][a-z]/.test(l)), app + ': ' + rl.length + ' "road:" log lines, numbers, enum names and our own words only');
    } finally { await b.stop(); }
}

/* ===================================================================================================================== */
(async () => {
    decoderChecks();
    pureChecks();
    if (args.indexOf('--no-gl') < 0) glChecks();
    if (args.indexOf('--no-bench') < 0) {
        const only = args.indexOf('--app') >= 0 ? args[args.indexOf('--app') + 1] : null;      // --app twin_dial | f30_cluster: one app's bench only
        for (const app of ['twin_dial', 'f30_cluster']) if (!only || only === app) await benchApp(app);
    }
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL the test threw: ' + (e && e.stack || e)); process.exit(1); });
