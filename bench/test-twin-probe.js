'use strict';
/**
 * test-twin-probe.js - twin_dial's probe mode (shared/twin_probe.js, docs/twin-dial/PROBE-PROTOCOL.md): read only, log only.
 *
 *   node bench/test-twin-probe.js
 *
 *   1. the source: no write of any kind (no setter, no method call, no requestDefaultSymbols, no message injection), Node 8
 *      syntax only (the car runs 8.16), every probe field declared in apps/twin_dial/probe/probe.json and nothing else.
 *   2. the declarations: the probe block, the normal block (a stand-in for SPEC section 11) and the two merged by
 *      tools/twin-dial/probe_build.py all pass tools/signals/check_signals.py (skipped, and said so, without the car's
 *      catalogue); `on` then `off` gives back exactly the normal app.json; apps/twin_dial/app.json too once it is there.
 *   3. every P-item's line from injected values, exact; once per change; the app's own handler behind it still runs; text
 *      only as a length (canary strings in every text member, in capitals too, never reach the log); rate limit, line cap,
 *      summary, a throwing or hostile value, an instance clash.
 *   4. on the bench (the real hud.js on the built f30_cluster, config patched in a COPY of the build, no port, no
 *      cluster-render): config.probe off -> nothing (f30_cluster is untouched); on -> every item's line, the same lines as
 *      step 3, the app's own handler still runs; as twin_dial (the old 0.7.18 probes are off: no ccListRiskClass /
 *      basicList handler, no requestDefaultSymbols) and, with legacyProbes true, they are on again.
 * Mac only, Node 18 or newer. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, fork } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CATALOGUE = path.join(ROOT, 'reference', 'car', '2026-11-15', 'someip', 'someip-interfaces.json');
const CHECK = path.join(ROOT, 'tools', 'signals', 'check_signals.py');
const BUILD = path.join(ROOT, 'tools', 'twin-dial', 'probe_build.py');
const PROBE_JSON = path.join(ROOT, 'apps', 'twin_dial', 'probe', 'probe.json');
const SRC = path.join(ROOT, 'shared', 'twin_probe.js');
const TP = require(SRC);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-probe-'));

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const KI = 'de.bmw.infotainment.KombiIF';

// ---- the injected values: invented numbers and invented words (every text is a CANARY that must never reach a log) ----
// [P, interface, field, label, raw value as the binding hands it over, the exact line body]
const V = [];
const add = (p, iface, field, label, value, body) => V.push({ p, iface, field, label, value, body });
const KI2 = 'de.bmw.infotainment.KombiInterface_2', V2 = 'de.bmw.infotainment.vehicle.Vehicle2', CDS = 'de.bmw.infotainment.vehicle.CDS';
add('P1', KI, 'statusActiveCCMessage', 'active-cc', {
    numberDisplayControlCheckControlMessage: 15, displayControlCheckControlMessage: 1, numberFrameDisplayControlCheckControlMessage: 1,
    frameDisplayControlCheckControlMessage: 1, utilityDataDisplayControlCheckControlMessage: 4096,
}, 'number=15 control=1 frameNumber=1 frame=1 utility=4096(0x1000)');
add('P1', V2, 'statusDisplayedCCMessage', 'displayed-cc', { statusNumberCheckControlMessageDisplay: 15 }, 'number=15');
add('P1', KI, 'statusMenuCCMessage', 'menu-cc', {
    numberFrameCheckControlMessageScroll: 1, quantityFrameCheckControlMessageScroll: 2, numberCheckControlMessage1: 15,
    numberCheckControlMessage2: 14, numberCheckControlMessage3: 0,
}, 'frameNumber=1 frames=2 id1=15 id2=14 id3=0');
add('P1', KI2, 'ccList', 'ccList', [
    { cCListElement: { cCIdentifer: 15, cCShortName: 'CANARY_NAME_ONE', cCColor: 'WHITE', cCListSymbolID: 2, cCIndentation: 'INDENT_LEVEL_0', ricResourceID: 7 } },
    { cCListElement: { cCIdentifer: 0, cCShortName: 'CANARY', cCColor: 'GREEN', cCListSymbolID: 6, cCIndentation: 'INDENT_LEVEL_0', ricResourceID: 0 } },
], 'entries=2 [id=15 colour=WHITE symbol=2 indent=INDENT_LEVEL_0 ric=7 name-len=15] [id=0 colour=GREEN symbol=6 indent=INDENT_LEVEL_0 ric=0 name-len=6]');
add('P2', KI2, 'ccListRiskClass', 'ccListRiskClass', [
    { cCListRiskClassElement: { cCIdentifer: 201, cCShortName: 'CANARY_RISK', cCColor: 'YELLOW', cCRiskClass: 'RK30', cCListSymbolID: 44 } },
], 'entries=1 [id=201 colour=YELLOW risk=RK30 symbol=44 name-len=11]');
add('P2', 'de.bmw.infotainment.checkcontrol.CheckControlMaster', 'basicList', 'basicList', [
    { ccmId: 301, reason: 'CCM_SHOWN_BY_IC', requestorDiagAddr: 64, timeStamp_s: 1763300000, timeStamp_ms: 5, syncMethod: 0, filterInformation: 'D0', activeState: 'AKTIV' },
    { ccmId: 302, reason: 2, filterInformation: 1, activeState: 1 },
], 'entries=2 [id=301 reason=CCM_SHOWN_BY_IC state=AKTIV filter=D0] [id=302 reason=2 state=1 filter=1]');
add('P3', KI, 'statusRangeTankStatus', 'range-tank', {
    fluidLevelFuelTank: 38, fluidLevelFuelTankLeftHand: 255, fluidLevelFuelTankRightHand: 255, statusFluidLevelFuelTankSpare: 'NICHT_AKTIV',
    range: 412, mileageKilometre: 48215,
}, 'fuel=38 fuelL=255 fuelR=255 spare=NICHT_AKTIV range=412 mileage=48215');
add('P3', 'de.bmw.infrastructure.VehicleInformation', 'Range', 'range-alt', { mileageKilometre: 48215 }, 'mileage=48215');
add('P3', 'de.bmw.infrastructure.MileageSupreme', 'mileageSupreme', 'mileage-supreme', { mileageSupreme: 48216, qualifierMileageSupreme: 'EVENT_DATA_AVAILABLE' }, 'mileage=48216 qualifier=EVENT_DATA_AVAILABLE');
add('P3', 'de.bmw.infrastructure.SecureMileage', 'mileage', 'mileage-secure', { currentMileage: 48215, aliveCounter: 3, manipulationState: 0 }, 'mileage=48215 alive=3 manipulation=0');
add('P4', KI, 'statusBordcomputerAverage', 'bc-average', {
    speedAverage1BC1: 412, consumptionAverage1BC1: 68, speedAverage2BC2: 65535, consumptionAverage2BC2: 65535,
    statusUnitOfMeasurementSpeedBC: 'KM_S_H__KM', statusUnitOfMeasurementConsumptionBC: 'VERBRAUCH_IN_L_S_100KM',
}, 'speed1=412 cons1=68 speed2=65535 cons2=65535 speedUnit=KM_S_H__KM consUnit=VERBRAUCH_IN_L_S_100KM');
add('P4', KI, 'statusBordcomputerTravelData', 'bc-travel', { rideDurationHours: 0, rideDurationMinutes: 43, wayPassed: 124 }, 'hours=0 minutes=43 way=124');
add('P4', KI, 'statusBordcomputerTravelStart', 'bc-start', { hourDepartureBC: 14, minuteDepartureBC: 0, dayDepartureBC: 17, monthDepartureBC: 11, yearDepartureBC: 2026 },
    'hour=14 minute=0 day=17 month=11 year=2026');
add('P4', KI, 'statusBordcomputerStatus2', 'bc-status2', {
    statusBC2BN2020: 'BC2_LAEUFT', statusResetBC2BN2020: 'AUS', statusLimitBN2020: 'KEINE_AKTION', boundaryLimitBN2020: 0,
    statusUnitOfMeasurementSpeedSpeedometerBN2020: 'KM_S_H', warningMemoBN2020: 'CANARY_MEMBER',
}, 'bc2=BC2_LAEUFT reset=AUS limit=KEINE_AKTION boundary=0 speedUnit=KM_S_H');
add('P4', 'de.bmw.infotainment.resetlogic.ResetLogic3', 'bcDataAll', 'bc-all3', {
    bcUnits: { tachoDigital: 'KILOMETERS', currentConsumptionCombustion: 'CONSUMPTION_KM', averageConsumptionCombustion: 'CONSUMPTION_KM' },
    activeResetLogic: 1, availableResetLogic: 7,
    bcData3: {
        resetOption: 'STARTOFDRIVING', dateTimeReset: { year: 26, month: 11, day: 17, hour: 14, minute: 0, second: 0 },
        dateTimeTrip: { day: 0, hour: 0, minute: 43, second: 12 }, speedAverage: 412, consumptionCombustionCurrentScale: 1,
        consumptionCombustionCurrentDigit: 90, consumptionCombustionAverageScale: 1, consumptionCombustionAverageDigit: 68, counterDistance: 1240,
    },
}, 'speedUnit=KILOMETERS consNowUnit=CONSUMPTION_KM consAvgUnit=CONSUMPTION_KM active=1 available=7(0x7) option=STARTOFDRIVING tripDay=0 tripH=0 tripM=43 tripS=12 ' +
    'speedAvg=412 consAvgScale=1 consAvgDigit=68 consNowScale=1 consNowDigit=90 distance=1240 resetY=26 resetMo=11 resetD=17 resetH=14 resetMi=0');
add('P5', 'de.bmw.infrastructure.EnvironmentalInformation', 'UnitBN2020', 'units', { unitOfMeasurementMileage: 'KILOMETER' }, 'mileage=KILOMETER');
add('P5', KI, 'statusKombiExternalDisplay', 'external-display', { displayTemperatureExterior: 75, displayRange: 412, statusUnitOfMeasurementTemperatureInstrumentPack: 'C' },
    'outside=75 range=412 tempUnit=C');
add('P6', KI, 'dataInstrumentPack', 'engine-verdict', { engineTemperatureEvaluated: 'COLD', presentAuxiliaryConsumerPower: 3 }, 'verdict=COLD auxPower=3');
add('P6', CDS, 'statusEngineTemperature', 'coolant', { temperatureEngineDrive: 126, temperatureEngineOilDrive: 255 }, 'coolant-raw=126 (78 C) oil-raw=255');
add('P7', 'de.bmw.body.DoorsWindowsRoofMirrors', 'CentralLockingSystemAndPanelStatus2', 'doors', {
    statusCentralLockingSystem: 5, statusDoorSwitchDRD: 'FAT_IST_OFFEN', statusDoorSwitchPSD: 'BEIFAHRERTUER_IST_GESCHLOSSEN',
    statusDoorSwitchDRDR: 0, statusDoorSwitchPSDR: 0, statusContactBootLid: 'HK_IST_GESCHLOSSEN', statusContactBonnet: 'MOTORHAUBE_GESCHLOSSEN',
    statusHotelMode: 'HOTELSTELLUNG_NICHT_AKTIV', statusContactSoftCloseAutomatic: 'SCA_VORRASTE_GESCHLOSSEN', statusContactBootLid2: 'KLAPPE_2_GESCHLOSSEN',
}, 'driver=FAT_IST_OFFEN passenger=BEIFAHRERTUER_IST_GESCHLOSSEN rearDriver=0 rearPassenger=0 boot=HK_IST_GESCHLOSSEN bonnet=MOTORHAUBE_GESCHLOSSEN ' +
    'boot2=KLAPPE_2_GESCHLOSSEN softClose=SCA_VORRASTE_GESCHLOSSEN locking=5 hotel=HOTELSTELLUNG_NICHT_AKTIV');
add('P7', 'de.bmw.infotainment.vehicle.A4A', 'statusA4ALids', 'lids', { statusContactBonnet: 'MOTORHAUBE_OFFEN' }, 'bonnet=MOTORHAUBE_OFFEN');
add('P7', V2, 'statusZVStatus', 'zv-status', { statusCentralLockingSystem: 5, statusCentralLockingSystemBootlid: 'HECKKLAPPE_NICHT_LOGISCH_ENTRIEGELT', controlDWAPartial: 0 },
    'locking=5 bootUnlocked=HECKKLAPPE_NICHT_LOGISCH_ENTRIEGELT dwa=0');
// P8 order matters (the active source before the list: "unknown", then the list: found; then another active one)
add('P8', 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState', 'playerMetadata', 'player-metadata', {
    sink: 'FRONT', uiType: 'TWO_LINES', menuEntry: 12345, trackId: 7, firstLineText: 'ARTIST_CANARY', firstLineType: 'ARTIST',
    secondLineText: 'TITLE_CANARY_LONG', secondLineType: 'TITLE', threeRowText: '',
}, 'sink=FRONT uiType=TWO_LINES menuEntry=12345 track=7 line1-type=ARTIST line1-len=13 line2-type=TITLE line2-len=17 line3-len=0');
add('P8', 'de.bmw.infotainment.entertainment.mediasource.MediaSource', 'activeSourceId', 'active-source', 'SRC_CANARY_B', 'len=12 matches-source-entry=unknown');
add('P8', 'de.bmw.infotainment.entertainment.mediasource.MediaSource', 'sources', 'sources', [
    { sourceId: 'SRC_CANARY_A', displayText: 'RADIO_CANARY', iconPath: 'ICON_CANARY', selectable: true, insertionOrder: 1, playerType: 'TUNER_FM', instanceId: '1', keyValueMap: { key: 'K', value: 'CANARY_V' } },
    { sourceId: 'SRC_CANARY_B', displayText: 'USB', selectable: true, insertionOrder: 2, playerType: 'MEDIA_PLAYER', instanceId: '2' },
], 'entries=2 [#0 type=TUNER_FM selectable=true order=1 id-len=12 text-len=12 instance-len=1] [#1 type=MEDIA_PLAYER selectable=true order=2 id-len=12 text-len=3 instance-len=1] active-is-entry=1');
add('P9', 'de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator', 'aggregatedCallState', 'call-state', 'INCOMING', 'state=INCOMING');
add('P9', 'de.bmw.infotainment.a4a.carplay.CarPlayManager', 'projectedTelephonyActive', 'carplay-call', true, 'active=true');
add('P10', 'de.bmw.infrastructure.analytics.BasicDataSet', 'basicDataSet', 'voltage-basic', { statusVoltageIntelligentBoardnetSensor: 1420, statusOtherCanary: 'CANARY_Z' }, 'voltage=1420');
add('P10', 'com.harman.infotainment.systeminfrastructure.environment.levelmonitor.LevelMonitor', 'systemVoltage', 'voltage-hu', { simuState: false, value: 12850 }, 'sim=false value=12850');
add('P10', CDS, 'statusBattery2', 'battery-condition', { conditionBatteryChargingCondition: 2 }, 'condition=2');
add('P11', 'de.bmw.infotainment.hmi.hmicontext.HMIContext', 'currentICWidget', 'ic-widget', 1234, 'widget=1234(0x4d2)');
add('P11', 'de.bmw.infotainment.hmi.hmicontext.HMIContext', 'currentICGraphicalContext', 'ic-context', { focusIndex: 0, listIndex: -1, visibleContext: 65537 }, 'focus=0 list=-1 visible=65537(0x10001)');
add('P11', 'de.bmw.infotainment.hmi.hmicontext2.HMIContext2', 'currentICWidget', 'ic-widget2', { StateID: 12, AppletID: 3 }, 'state=12 applet=3');
add('P11', 'de.bmw.infotainment.hmi.hmicontext2.HMIContext2', 'currentICGraphicalContext', 'ic-context2',
    { VisualContext: { StateID: 12, AppletID: 3 }, FocusIndex: { FocusIndex: 0, AppletID: 3 }, ListIndex: -1 }, 'state=12 applet=3 focus=0 focusApplet=3 list=-1');
add('P11', KI, 'statusKombiSelection', 'kombi-selection', {
    statusActivationInstrumentPackBC: 255, statusActivationInstrumentPackContent: 5, statusActivationPreselectInstrumentPack: 'ANZEIGE_RADIOBUTTON__ALLES_EIN__AKTIV',
}, 'packBC=255(0xff) content=5(0x5) preselect=ANZEIGE_RADIOBUTTON__ALLES_EIN__AKTIV');
add('P11', KI, 'statusKombiSelectionAvailability', 'kombi-available', { baseSetupInstrumentPackBC: 1023, baseSetupInstrumentPackContent: 3, baseSetupPreselectInstrumentPack: 0 },
    'packBC=1023(0x3ff) content=3(0x3) preselect=0');
add('P11', KI, 'statusConfigurationKombi5', 'kombi-config', {
    statusActivationInstrumentPackContent2: 16, statusActivationPreselectInstrumentPack2: 'ANZEIGE_RADIOBUTTON_STANDARD_AKTIV',
    statusNavigationDisplayType: 'ANZEIGE_RADIOBUTTON_KARTENANSICHT_AKTIV', statusDZMorPowermeterDisplay: 'BEDIENUNG_RADIOBUTTON_DZM_AKTIV',
    statusEntertainmentSTGDisplay: 'ANZEIGE_RADIOBUTTON_KOMBI_AKTIV',
}, 'content2=16(0x10) preselect2=ANZEIGE_RADIOBUTTON_STANDARD_AKTIV navDisplay=ANZEIGE_RADIOBUTTON_KARTENANSICHT_AKTIV dzmOrPower=BEDIENUNG_RADIOBUTTON_DZM_AKTIV ' +
    'entertainment=ANZEIGE_RADIOBUTTON_KOMBI_AKTIV');
add('P11', V2, 'statusDisplayKombi', 'display-kombi', { statusDisplayInstrumentPackM: 'STANDARD_VIEW' }, 'view=STANDARD_VIEW');
add('P12', 'de.bmw.infotainment.navigation.navigationstatus.NavigationStatus', 'guidingState', 'guiding-state', 'ACTIVE', 'state=ACTIVE');
add('P12', 'de.bmw.infotainment.navigation.guiding.Guidance', 'nextIntersection', 'next-intersection', {
    intersection: { elements: [{ text: 'STREET_CANARY' }, { spacer: 'SLASH' }, { icon: { text: 'A 9', iconHandle: { valid: true, id: 'shield-A9', url: 'URL_CANARY' } } }] },
    serviceIcons: [], distance: { distance: '12', unit: 'KM', rawDistance: 12000.5 },
}, /^elements=3 \[text len=13\] \[spacer=SLASH\] \[icon text-len=3\] serviceIcons=0 distance-len=2 unit=KM raw=12000\.5 parse<=[0-9.]+ms$/);
const CANARIES = /CANARY|ARTIST_|TITLE_|SRC_|STREET|URL_|RADIO_/;      // none of these, nor any of their parts, may reach a log

/** A probe on a fake clock, its log in `lines`; feed(iface, field, value) calls the handler the way the car's watch does. */
function mk(cfg, prev) {
    const lines = [], extra = {};
    const clock = { t: 1000000 };
    if (prev) Object.keys(prev).forEach((i) => { extra[i] = Object.assign({}, prev[i]); });
    const pr = TP.wire(extra, { log: { info: (s) => lines.push(s), warn: (s) => lines.push('WARN ' + s) }, cfg, now: () => clock.t });
    const feed = (iface, field, v) => { if (!extra[iface] || !extra[iface][field]) throw new Error('no handler on ' + iface + '.' + field); extra[iface][field](v); };
    return { lines, extra, clock, pr, feed, p: () => lines.filter((l) => /^probe: P\d/.test(l)) };
}
const bodyOf = (line) => String(line).replace(/^probe: P\d+ \S+ #\d+ t=[0-9.]+: /, '');

async function main() {
    // ---------------------------------------------------------------------------------------------------------------
    console.log('1. the source: no write, Node 8 syntax, the table and probe.json say the same');
    const src = fs.readFileSync(SRC, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    ok(!/setValue|callMethod|signals\.set|signals\.call|\.call\(|ctx\.signals|requestDefaultSymbols|standardCCMessage|extendedCCMessage|newCCMessage|operationBordcomputer|kombiSelection\b/.test(code),
        'twin_probe.js (comments left out) has no setter, no method call, no requestDefaultSymbols, no message injection and never touches ctx.signals');
    ok(!/\?\.|\?\?|catch\s*\{|\.\.\.\w|\bBigInt\(|\d+n\b|\.flat\(|\.flatMap\(|Object\.fromEntries|Object\.entries|\.padEnd|async\s|await\s/.test(code),
        'twin_probe.js uses only what Node 8.16 has (no ?. ?? bigint literal, spread, optional catch binding, flat, entries)');
    const pj = readJson(PROBE_JSON);
    const decl = [];
    Object.keys(pj.signals).forEach((i) => Object.keys(pj.signals[i]).filter((k) => !k.startsWith('_')).forEach((f) => decl.push(i + '.' + f + ':' + pj.signals[i][f])));
    const flags = decl.map((d) => d.split(':')[1]);
    ok(flags.every((f) => /^(rs|s|r)$/.test(f)) && !decl.some((d) => /w/.test(d.split(':')[1])), 'probe.json: only r and s flags (' + decl.length + ' fields), no "w"');
    ok(!Object.keys(pj.signals).some((i) => Object.keys(pj.signals[i]).some((k) => k === '_methods' || k === '_broadcasts')), 'probe.json: no _methods, no _broadcasts');
    const tableKeys = TP.TABLE.map((f) => f.iface + '.' + f.field).sort(), declKeys = decl.map((d) => d.split(':')[0]).sort();
    ok(JSON.stringify(tableKeys) === JSON.stringify(declKeys), 'every field the probe subscribes is declared in probe.json, and nothing else is (' + tableKeys.length + ' fields, ' + Object.keys(pj.signals).length + ' interfaces)');
    const insts = TP.TABLE.filter((f) => f.instance).every((f) => String(pj.signals[f.iface]._instances) === f.instance);
    ok(insts, 'the instances the probe sets (HMI_CID, Main_Instance, ...) are the ones probe.json declares');
    ok(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12'].every((p) => TP.TABLE.some((f) => f.p === p)), 'every item P1..P12 has at least one field');
    ok(V.every((v) => TP.TABLE.some((f) => f.iface === v.iface && f.field === v.field && f.label === v.label)) && TP.TABLE.every((f) => V.some((v) => v.iface === f.iface && v.field === f.field)),
        'this test injects a value for every field of the table (' + V.length + ')');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('2. the declarations: probe block, normal block, merged');
    if (!fs.existsSync(CATALOGUE)) console.log('  skip: ' + path.relative(ROOT, CATALOGUE) + ' is not here');
    const vs = readJson(path.join(ROOT, 'design', 'twin-dial', 'vs', 'signals.json'));
    // a stand-in for SPEC section 11: VS's block minus what round 2 does not draw (doors, battery, cluster view, next turn, CheckControlMaster)
    const drop = { 'de.bmw.body.DoorsWindowsRoofMirrors': 1, 'de.bmw.infotainment.vehicle.A4A': 1, 'de.bmw.infotainment.hmi.hmicontext.HMIContext': 1, 'de.bmw.infotainment.checkcontrol.CheckControlMaster': 1 };
    const normalSig = {};
    Object.keys(vs.signals).filter((i) => !drop[i]).forEach((i) => { normalSig[i] = Object.assign({}, vs.signals[i]); });
    ['statusBattery2'].forEach((f) => delete normalSig['de.bmw.infotainment.vehicle.CDS'][f]);
    ['statusZVStatus'].forEach((f) => delete normalSig['de.bmw.infotainment.vehicle.Vehicle2'][f]);
    ['statusKombiSelection', 'statusKombiSelectionAvailability', 'statusConfigurationKombi5'].forEach((f) => delete normalSig['de.bmw.infotainment.KombiIF'][f]);
    delete normalSig['de.bmw.infotainment.navigation.guiding.Guidance'].nextIntersection;
    delete normalSig['de.bmw.infrastructure.VehicleInformation'].Range;
    const normal = { id: 'twin_dial', title: 'Twin Dial', version: '0.1.0', shared: ['hud.js', 'shaders.js'], config: { target: 'panel', tankLitres: 59 }, signals: normalSig };
    const fileN = path.join(tmp, 'normal.json'), fileP = path.join(tmp, 'probe-on.json'), fileBack = path.join(tmp, 'normal-back.json');
    fs.writeFileSync(fileN, JSON.stringify(normal, null, 2) + '\n');
    const py = (args) => spawnSync('python3', [BUILD].concat(args), { encoding: 'utf8' });
    let r = py(['on', '--app', fileN, '--out', fileP]);
    ok(r.status === 0, 'probe_build.py on (stand-in app.json): ' + (r.stdout || r.stderr).trim());
    const on = readJson(fileP);
    ok(on.config.probe && on.config.probe.minGapMs === 1000 && on.config.legacyProbes === false && on._probeBuild, 'the probe build has config.probe, legacyProbes false and says what it added');
    ok(TP.TABLE.every((f) => on.signals[f.iface] && on.signals[f.iface][f.field]), 'every probe field is in the merged signals');
    ok(on.shared.indexOf('twin_probe.js') >= 0 && normal.shared.indexOf('twin_probe.js') < 0, 'twin_probe.js is added to "shared" (the build packs only what it lists)');
    r = py(['on', '--app', fileN, '--out', path.join(tmp, 'v.json'), '--version', '0.1.1']);
    ok(r.status === 0 && readJson(path.join(tmp, 'v.json')).version === '0.1.1', 'on --version sets the probe build\'s version');
    r = py(['off', '--app', path.join(tmp, 'v.json'), '--out', path.join(tmp, 'v-off.json')]);
    ok(r.status === 0 && JSON.stringify(readJson(path.join(tmp, 'v-off.json'))) === JSON.stringify(normal), 'off restores the version too (exactly the normal app.json)');
    const probeOnly = Object.keys(pj.signals).filter((i) => !normal.signals[i]);
    ok(probeOnly.length >= 6 && !normal.config.probe && probeOnly.every((i) => !normal.signals[i]),
        'the normal block has no config.probe and none of the ' + probeOnly.length + ' interfaces only the probe build adds');
    r = py(['off', '--app', fileP, '--out', fileBack]);
    ok(r.status === 0 && JSON.stringify(readJson(fileBack)) === JSON.stringify(normal), 'probe_build.py off gives back exactly the normal app.json (on, then off: ' + (r.stdout || r.stderr).trim() + ')');
    r = py(['on', '--app', fileP, '--out', path.join(tmp, 'twice.json')]);
    ok(/already so/.test(r.stdout) && JSON.stringify(readJson(path.join(tmp, 'twice.json'))) === JSON.stringify(on), 'on twice changes nothing');
    const bad = path.join(tmp, 'bad-probe.json');
    fs.writeFileSync(bad, JSON.stringify({ signals: { 'de.bmw.infotainment.KombiIF': { statusActiveCCMessage: 'rws' } } }));
    r = spawnSync('python3', [BUILD, 'on', '--app', fileN, '--probe', bad, '--out', path.join(tmp, 'x.json')], { encoding: 'utf8' });
    ok(r.status !== 0 && /only r and s/.test(r.stdout + r.stderr), 'a probe file with a "w" flag is refused');
    fs.writeFileSync(bad, JSON.stringify({ signals: { 'de.bmw.infotainment.KombiInterface_2': { ccList: 'rs', _methods: ['requestDefaultSymbols'] } } }));
    r = spawnSync('python3', [BUILD, 'on', '--app', fileN, '--probe', bad, '--out', path.join(tmp, 'x.json')], { encoding: 'utf8' });
    ok(r.status !== 0 && /calls nothing/.test(r.stdout + r.stderr), 'a probe file with a method (requestDefaultSymbols) is refused');
    if (fs.existsSync(CATALOGUE)) {
        // every column of the table against the catalogue's own types: a TEXT member is only ever read as a length ('t'), a number
        // as a number, an enum as an enum, a bool as a bool - so the one formatter that prints a name (enum) can never be handed text
        const cat = readJson(CATALOGUE), DT = cat.datatypes;
        const base = (ref) => { let r = ref, n = 0; while (DT[r] && DT[r].type === 'typedef' && n++ < 8) r = DT[r].dataRef; return r; };
        const kindOfRef = (ref) => {
            const r = base(ref), t = DT[r];
            if (t) return t.type;                                             // enum | struct | union | array | map
            if (/^Utf|^ByteBuffer/.test(r)) return 'text';
            if (r === 'Bool') return 'bool';
            return /^(U?Int\d+|Float|Double)$/.test(r) ? 'num' : 'unknown:' + r;
        };
        /** The kind of the member at `path` below the type `ref` (a struct or union), or an error word. */
        const walkType = (ref, path) => {
            let cur = ref;
            for (const k of path) {
                const t = DT[base(cur)];
                if (!t || !t.members) return 'no members at ' + k;
                const mem = t.members.find((x) => x.name === k);
                if (!mem) return 'no member ' + k;
                cur = mem.dataRef;
            }
            return kindOfRef(cur);
        };
        const want = { n: 'num', x: 'num', e: 'enum', b: 'bool', t: 'text' };
        const bad = [];
        const fieldRef = (f) => cat.interfaces[f.iface] && cat.interfaces[f.iface].fields[f.field] && cat.interfaces[f.iface].fields[f.field].dataRef;
        let nCols = 0;
        TP.TABLE.forEach((f) => {
            const ref = fieldRef(f);
            if (!ref) { bad.push(f.iface + '.' + f.field + ': not in the catalogue'); return; }
            const root = f.list ? (f.list.member ? [f.list.member] : []) : [];
            (f.cols || (f.list && f.list.cols) || []).forEach((c) => {
                nCols++;
                const got = walkType(ref, root.concat(Array.isArray(c[1]) ? c[1] : [c[1]]));
                if (got !== want[c[2]]) bad.push(f.label + '.' + c[0] + ' (' + c[2] + '): the catalogue says ' + got);
            });
            const rootKind = kindOfRef(ref);
            const wantRoot = { enum: 'enum', bool: 'bool', hex: 'num', activeSource: 'text', sources: 'struct', temps: 'struct', intersection: 'struct' }[f.fmt];
            if (f.fmt && rootKind !== wantRoot) bad.push(f.label + ' (' + f.fmt + '): the catalogue says ' + rootKind);
        });
        const walks = [
            ['de.bmw.infotainment.entertainment.mediasource.MediaSource', 'sources', ['sourceId'], 'text'], ['de.bmw.infotainment.entertainment.mediasource.MediaSource', 'sources', ['displayText'], 'text'],
            ['de.bmw.infotainment.entertainment.mediasource.MediaSource', 'sources', ['instanceId'], 'text'], ['de.bmw.infotainment.entertainment.mediasource.MediaSource', 'sources', ['playerType'], 'enum'],
            ['de.bmw.infotainment.entertainment.mediasource.MediaSource', 'sources', ['selectable'], 'bool'], ['de.bmw.infotainment.entertainment.mediasource.MediaSource', 'sources', ['insertionOrder'], 'num'],
            [CDS, 'statusEngineTemperature', ['temperatureEngineDrive'], 'num'], [CDS, 'statusEngineTemperature', ['temperatureEngineOilDrive'], 'num'],
            ['de.bmw.infotainment.navigation.guiding.Guidance', 'nextIntersection', ['distance', 'distance'], 'text'], ['de.bmw.infotainment.navigation.guiding.Guidance', 'nextIntersection', ['distance', 'unit'], 'enum'],
            ['de.bmw.infotainment.navigation.guiding.Guidance', 'nextIntersection', ['distance', 'rawDistance'], 'num'],
            ['de.bmw.infotainment.navigation.guiding.Guidance', 'nextIntersection', ['intersection', 'elements'], 'union'],
            ['de.bmw.infotainment.navigation.guiding.Guidance', 'nextIntersection', ['intersection', 'elements', 'text'], 'text'],
            ['de.bmw.infotainment.navigation.guiding.Guidance', 'nextIntersection', ['intersection', 'elements', 'spacer'], 'enum'],
            ['de.bmw.infotainment.navigation.guiding.Guidance', 'nextIntersection', ['intersection', 'elements', 'icon', 'text'], 'text'],
        ];
        walks.forEach((w) => {
            const ref = cat.interfaces[w[0]].fields[w[1]].dataRef;
            const got = walkType(ref, w[2]);
            if (got !== w[3]) bad.push(w[1] + '.' + w[2].join('.') + ': wanted ' + w[3] + ', the catalogue says ' + got);
        });
        ok(bad.length === 0, 'the table against the catalogue\'s types (' + nCols + ' columns + ' + walks.length + ' custom members): no text member is read as a number, enum or bool' + (bad.length ? ' - ' + bad.join('; ') : ''));
        const chk = (file, what) => {
            const o = spawnSync('python3', [CHECK, CATALOGUE, file], { encoding: 'utf8' });
            const out = (o.stdout || '') + (o.stderr || '');
            ok(o.status === 0 && /all declarations pass/.test(out), 'check_signals.py: ' + what + ' - ' + (out.trim().split('\n').pop()));
            if (o.status !== 0) out.split('\n').filter((l) => /FAIL/.test(l)).forEach((l) => console.log('    ' + l));
        };
        chk(PROBE_JSON, 'the probe block alone (apps/twin_dial/probe/probe.json)');
        chk(fileN, 'the normal block (SPEC section 11 stand-in)');
        chk(fileP, 'the merged probe build');
        const real = path.join(ROOT, 'apps', 'twin_dial', 'app.json');
        if (fs.existsSync(real)) {
            const o = spawnSync('python3', [BUILD, 'check', '--app', real], { encoding: 'utf8' });
            ok(o.status === 0, 'apps/twin_dial/app.json, both states (probe_build.py check): ' + (o.stdout || o.stderr).trim().replace(/\n/g, ' | '));
            ok(!readJson(real)._probeBuild, 'apps/twin_dial/app.json is the NORMAL build (no _probeBuild marker, no config.probe)');
        } else console.log('  skip: apps/twin_dial/app.json is not on this branch (package C): the lead runs `python3 tools/twin-dial/probe_build.py check` after the merge');
    }

    // ---------------------------------------------------------------------------------------------------------------
    console.log('3. every P-item\'s line from injected values (fake clock)');
    const a = mk({ minGapMs: 0 });
    ok(a.lines.length === 1 && /^probe: twin_probe 1 on: 40 fields of P1\.\.P12, read only/.test(a.lines[0]), 'the intro line: ' + a.lines[0]);
    V.forEach((v) => {
        a.clock.t += 1500;
        a.feed(v.iface, v.field, v.value);
        const got = a.p().filter((l) => new RegExp('^probe: ' + v.p + ' ' + v.label + ' #1 ').test(l));
        const body = got.length === 1 ? bodyOf(got[0]) : '(' + got.length + ' lines)';
        ok(got.length === 1 && (v.body instanceof RegExp ? v.body.test(body) : body === v.body), v.p + ' ' + v.label + ': ' + body);
    });
    ok(!CANARIES.test(a.lines.join('\n')), 'no text of a message, source, song, road or address in the log (canary words in every text member, capitals too)');
    ok(!/12000|STREET|A 9/.test(a.lines.filter((l) => /next-intersection/.test(l)).join('') .replace(/raw=12000\.5/, '')), 'the road text and the shield text of P12 are lengths only');
    const st = a.pr.stats();
    ok(st.length === 40 && st.every((s) => s.events === 1 && s.lines === 1), 'stats(): 40 fields, one event and one line each');
    ok(/t=1\.5:/.test(a.p()[0]) && /t=\d+\.\d:/.test(a.p()[10]), 't= counts seconds from the probe\'s start: ' + a.p()[0].replace(/^probe: /, ''));

    console.log('   once per change, the rest');
    const b = mk({ minGapMs: 0 });
    const act = V[0];
    b.feed(act.iface, act.field, act.value); b.feed(act.iface, act.field, JSON.parse(JSON.stringify(act.value))); b.feed(act.iface, act.field, act.value);
    ok(b.p().length === 1, 'the same value three times: one line');
    b.feed(act.iface, act.field, Object.assign({}, act.value, { numberDisplayControlCheckControlMessage: 0 }));
    b.feed(act.iface, act.field, act.value);
    ok(b.p().length === 3 && /#3 /.test(b.p()[2]) && /number=15/.test(b.p()[2]), 'a change and back: two more lines, numbered #2 and #3');
    // P8: the active source, the list, then another active source
    const c = mk({ minGapMs: 0 });
    const m = (f) => V.find((v) => v.field === f);
    c.feed(m('activeSourceId').iface, 'activeSourceId', 'SRC_CANARY_B');
    c.feed(m('sources').iface, 'sources', m('sources').value);
    c.feed(m('activeSourceId').iface, 'activeSourceId', 'SRC_CANARY_A');
    c.feed(m('activeSourceId').iface, 'activeSourceId', 'SRC_CANARY_Z');
    const ps = c.p().map(bodyOf);
    ok(ps[0] === 'len=12 matches-source-entry=unknown' && /active-is-entry=1$/.test(ps[1]) && ps[2] === 'len=12 matches-source-entry=0' && ps[3] === 'len=12 matches-source-entry=none',
        'P8: which sources entry is the active one is said as a number (unknown, 1, 0, none), never as text');
    ok(!CANARIES.test(c.lines.join('\n')), 'P8: no source id or name in the log');
    // the app's own handler runs behind the probe, and runs even when the probe throws
    const seen = [];
    const prev = { [KI]: { statusActiveCCMessage: (v) => seen.push(v) } };
    const d = mk({ minGapMs: 0 }, prev);
    d.feed(KI, 'statusActiveCCMessage', V[0].value);
    ok(seen.length === 1 && seen[0] === V[0].value && d.p().length === 1, 'the handler already on the field still runs, with the same value, behind the probe');
    const nasty = { get numberDisplayControlCheckControlMessage() { throw new Error('getter boom'); } };
    let threw = false;
    try { d.feed(KI, 'statusActiveCCMessage', nasty); } catch (e) { threw = true; }
    ok(!threw && seen.length === 2 && d.lines.some((l) => /^WARN probe: P1 active-cc: getter boom/.test(l)), 'a value that throws while it is read: one warning, no throw, the app\'s handler still runs');
    d.feed(KI, 'statusActiveCCMessage', nasty);
    ok(d.lines.filter((l) => /getter boom/.test(l)).length === 1, '... and the warning comes once per field');
    // hostile and odd values: nothing but numbers, enum names, lengths
    const e = mk({ minGapMs: 0 });
    const hostile = [null, undefined, 'Canary string', 42, [], [1, 2], { x: 'Canary obj', y: { z: 'Canary deep' } }, true, 'canary_lower', new Array(5000).fill('Canary')];
    let hostileThrew = false;
    TP.TABLE.forEach((f) => hostile.forEach((h) => { try { e.feed(f.iface, f.field, h); } catch (x) { hostileThrew = true; } }));
    ok(!hostileThrew, 'null, undefined, strings, numbers, arrays and objects where structs belong: no handler throws');
    ok(!/canary/i.test(e.lines.join('\n')), 'and none of their text is logged');
    const enumTrap = mk({ minGapMs: 0 });
    enumTrap.feed(KI, 'statusRangeTankStatus', { fluidLevelFuelTank: 'ALL_CAPS_TEXT', mileageKilometre: 'MORE_TEXT', range: 412, statusFluidLevelFuelTankSpare: 'free text' });
    ok(/fuel=\? fuelL=- fuelR=- spare=\? range=412 mileage=\?$/.test(bodyOf(enumTrap.p()[0])), 'a text where a number or an enum belongs prints "?" (the all-capitals one too): ' + bodyOf(enumTrap.p()[0]));
    const big = mk({ minGapMs: 0 });
    const many = []; for (let i = 0; i < 40; i++) many.push({ cCListElement: { cCIdentifer: i, cCColor: 'RED', cCShortName: 'x' } });
    big.feed(KI2, 'ccList', many);
    ok(/entries=40 .* \+16 more$/.test(bodyOf(big.p()[0])) && (bodyOf(big.p()[0]).match(/\[id=/g) || []).length === 24, 'a list of 40: 24 entries and "+16 more"');
    big.feed(KI2, 'ccList', 'CANARY_NOT_A_LIST');
    ok(/not a list \(string\)$/.test(bodyOf(big.p()[1])) && !/CANARY/.test(big.lines.join('')), 'a list field that is not a list says so, and nothing of it');
    const bi = mk({ minGapMs: 0 });
    bi.feed(KI, 'statusBordcomputerTravelData', { rideDurationHours: 0, rideDurationMinutes: 1, wayPassed: typeof BigInt === 'function' ? BigInt(7) : 7 });
    ok(/way=7$/.test(bodyOf(bi.p()[0])), 'a 64-bit integer (bigint) is printed as a number');

    console.log('   rate limit, cap, summary, subset, instance');
    const f = mk({ minGapMs: 1000 });
    const cool = V.find((v) => v.field === 'statusEngineTemperature');
    const temp = (n) => ({ temperatureEngineDrive: n, temperatureEngineOilDrive: 255 });
    f.feed(cool.iface, cool.field, temp(60)); f.clock.t += 200;
    f.feed(cool.iface, cool.field, temp(61)); f.clock.t += 200;
    f.feed(cool.iface, cool.field, temp(62));
    ok(f.p().length === 1, 'a field that changes faster than minGapMs: one line now');
    f.clock.t += 500; f.pr.tick();
    ok(f.p().length === 1, '... nothing before the gap has passed (900 ms)');
    f.clock.t += 200; f.pr.tick();
    ok(f.p().length === 2 && /coolant-raw=62 \(14 C\) .*\(\+1 folded\)$/.test(f.p()[1]), '... then the LAST value once, saying one was folded: ' + (f.p()[1] || '').replace(/^probe: /, ''));
    f.feed(cool.iface, cool.field, temp(63)); f.clock.t += 100; f.feed(cool.iface, cool.field, temp(62));
    f.clock.t += 2000; f.pr.tick();
    ok(f.p().length === 2, 'a value that flaps back to what was logged is not logged again');
    const g = mk({ minGapMs: 0, maxLines: 3 });
    for (let i = 0; i < 6; i++) g.feed(act.iface, act.field, Object.assign({}, act.value, { numberDisplayControlCheckControlMessage: i }));
    ok(g.p().length === 3 && /\(the last line for this field\)$/.test(g.p()[2]), 'maxLines 3: three lines, the third says it is the last');
    const h = mk({ minGapMs: 0, summaryS: [30, 120] });
    h.feed(act.iface, act.field, act.value); h.feed(V[1].iface, V[1].field, V[1].value);
    h.clock.t += 31000; h.pr.tick(); h.pr.tick();
    const sum = h.lines.filter((l) => /summary t=30/.test(l));
    ok(sum.length === 2 && /2 of 40 fields have spoken: P1 active-cc\(1 events, 1 lines\), P1 displayed-cc/.test(sum[0]) && /silent: .*P7 doors.*P12 next-intersection/.test(sum[1]),
        'the summary at 30 s says which fields spoke and which are silent (and only once)');
    h.clock.t += 100000; h.pr.tick();
    ok(h.lines.filter((l) => /summary t=120/.test(l)).length === 2, 'the next summary comes at its time');
    const only = mk({ only: ['P3', 'P7'], minGapMs: 0 });
    ok(only.pr.stats().every((s) => s.p === 'P3' || s.p === 'P7') && !only.extra[KI2] && only.extra[KI].statusRangeTankStatus && !only.extra[KI].statusBordcomputerAverage,
        'config.probe.only ["P3","P7"]: only those items are subscribed');
    const inst = mk({ minGapMs: 0 }, { 'de.bmw.infotainment.navigation.guiding.Guidance': { $instance: 'Other' } });
    ok(inst.lines.some((l) => /WARN probe: P12 next-intersection: the app already watches Guidance instance Other, not Main_Instance: skipped/.test(l)) && inst.extra['de.bmw.infotainment.navigation.guiding.Guidance'].$instance === 'Other' && !inst.extra['de.bmw.infotainment.navigation.guiding.Guidance'].nextIntersection,
        'an interface the app already watches on another instance is left alone, with a warning');
    ok(a.extra['de.bmw.infotainment.hmi.hmicontext.HMIContext'].$instance === 'HMI_CID' && a.extra['de.bmw.infotainment.navigation.guiding.Guidance'].$instance === 'Main_Instance' &&
        a.extra['de.bmw.infotainment.hmi.hmimediastate.HmiMediaState'].$instance === 'HMI_CID', 'the instances HMI_CID and Main_Instance are set for the interfaces that need them');
    const tmr = mk({ minGapMs: 0 });
    tmr.pr.start(); tmr.pr.start(); tmr.pr.stop(); tmr.pr.stop();
    ok(true, 'start() twice and stop() twice are harmless');

    // ---------------------------------------------------------------------------------------------------------------
    console.log('4. on the bench: the real hud.js, a copy of the f30_cluster build with the config patched');
    const sdk = path.join(ROOT, 'oap-sdk');
    if (!fs.existsSync(path.join(sdk, 'index.js'))) {
        fs.mkdirSync(sdk, { recursive: true });
        fs.writeFileSync(path.join(sdk, 'index.js'), "'use strict';\n// BENCH_STUB: stands in for BMW's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n");
        fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'oap-sdk', version: '0.0.0-bench-stub', main: 'index.js' }) + '\n');
    }
    const bo = spawnSync('python3', [path.join(ROOT, 'kit', 'tools', 'build.py'), 'f30_cluster'], { cwd: ROOT, encoding: 'utf8' });
    ok(bo.status === 0, 'kit build of f30_cluster (stage for the bench copies)');
    if (bo.status !== 0) { console.log(bo.stderr); return; }
    const STAGE = path.join(ROOT, 'dist', 'f30_cluster');
    /** A copy of the staged app with spec patched ({ id, config: {...} }) and twin_probe.js added, run as the bench runs it. */
    async function runApp(name, patch, run) {
        const stage = path.join(tmp, 'stage-' + name, 'f30_cluster');
        fs.mkdirSync(path.dirname(stage), { recursive: true });
        fs.cpSync(STAGE, stage, { recursive: true });
        const js = path.join(stage, 'source', 'javascript');
        const sp = path.join(js, 'kit', 'app-spec.json');
        const spec = readJson(sp);
        if (patch.id) spec.id = patch.id;
        spec.config = Object.assign({}, spec.config, patch.config || {});
        Object.keys(patch.config || {}).forEach((k) => { if (patch.config[k] === undefined) delete spec.config[k]; });
        fs.writeFileSync(sp, JSON.stringify(spec));
        fs.copyFileSync(SRC, path.join(js, 'twin_probe.js'));
        const dataDir = path.join(tmp, 'data-' + name);
        let out = '';
        const child = fork(path.join(__dirname, 'run-app.js'), [stage, dataDir], {
            cwd: tmp, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: Object.assign({}, process.env, { HUD_CLUSTER_SOCKET: path.join(tmp, 'no-cluster-render-' + name + '.sock') }),
        });
        child.stdout.on('data', (x) => { out += x; }); child.stderr.on('data', (x) => { out += x; });
        let exited = false;
        child.on('exit', () => { exited = true; });
        const t0 = Date.now();
        const feed = (iface, field, value) => child.send({ t: 'fake', v: { feed: { iface, field, value } } });
        try {
            // up = the app is loaded AND the engine has made its watches (car.js logs "signal KombiIF subscribed" once the last
            // of them is registered), so a value fed now reaches every handler; feeding earlier would pass "nothing logged" vacuously
            while (!(/bench: app loaded from/.test(out) && /signal KombiIF subscribed/.test(out)) && !exited && Date.now() - t0 < 60000) await sleep(100);
            await run({ feed, text: () => out, lines: (re) => out.split('\n').filter((l) => re.test(l)), exited: () => exited, t0 });
        } finally { try { child.kill('SIGKILL'); } catch (x) { /* gone */ } }
        return out;
    }
    const feedAll = async (app) => { for (const v of V) { app.feed(v.iface, v.field, v.value); await sleep(15); } await sleep(400); };
    const probeLines = (app) => app.lines(/probe: P\d+ /).map((l) => l.replace(/^.*?probe: /, 'probe: '));

    // A. config.probe off: the app is as it is. (f30_cluster's own app.json has none)
    await runApp('off', {}, async (app) => {
        ok(!app.exited() && /signal KombiIF subscribed/.test(app.text()), 'the unpatched f30_cluster starts and has made its watches');
        await feedAll(app);
        ok(app.lines(/probe: P\d|twin_probe/).length === 0, 'config.probe off: not one probe line, not even the intro, when every probe field is fed');
        app.feed(KI2, 'ccListRiskClass', [{ cCListRiskClassElement: { cCIdentifer: 9, cCColor: 'RED', cCRiskClass: 'RK90', cCListSymbolID: 1 } }]);
        await sleep(300);
        ok(app.lines(/probe: ccListRiskClass: 1 entry: \[id 9 colour RED risk RK90 symbol 1\]/).length === 1, 'f30_cluster\'s own 0.7.18 probes still log (ccListRiskClass), unchanged');
    });
    // B. config.probe on, the app is f30_cluster (so its own handlers exist: statusActiveCCMessage logs "active cc: ...")
    await runApp('on', { config: { probe: { minGapMs: 0, summaryS: [2] } } }, async (app) => {
        ok(!app.exited(), 'config.probe on: the app starts');
        ok(app.lines(/probe: twin_probe 1 on: 40 fields/).length === 1, 'the intro line is in the app\'s log');
        await feedAll(app);
        const got = probeLines(app);
        const okAll = V.every((v) => {
            const l = got.filter((x) => new RegExp('^probe: ' + v.p + ' ' + v.label + ' #1 t=[0-9.]+: ').test(x));
            const body = l.length === 1 ? bodyOf(l[0]) : '';
            return l.length === 1 && (v.body instanceof RegExp ? v.body.test(body) : body === v.body);
        });
        ok(okAll, 'all ' + V.length + ' fields: one line each, the same body as step 3');
        ok(app.lines(/active cc: number 15 control 1 frame 1\/1 utility 4096/).length >= 1, 'the app\'s own handler behind the probe still runs (its "active cc:" line)');
        ok(!CANARIES.test(app.text().replace(/bench: [^\n]*/g, '')), 'no canary word anywhere in the app\'s output');
        ok(app.lines(/probe: ccListRiskClass:|probe: basicList:/).length >= 1, 'as f30_cluster the legacy 0.7.18 probes are still on (legacyProbes not set)');
        await sleep(2300);
        ok(app.lines(/probe: summary t=2: 40 of 40 fields have spoken/).length === 1 && app.lines(/summary t=2: silent: none/).length === 1, 'the summary line comes from the app\'s own timer: all 40 fields have spoken');
    });
    // C and D together: as twin_dial. C: the old probes are off; D: legacyProbes true turns them back on (proof the gate is what holds them back)
    const symRe = /probe: cc symbols: /;
    const risk = [{ cCListRiskClassElement: { cCIdentifer: 9, cCColor: 'RED', cCRiskClass: 'RK90', cCListSymbolID: 1 } }];
    const runC = runApp('twin', { id: 'twin_dial', config: { probe: { minGapMs: 0 } } }, async (app) => {
        await sleep(100);
        app.feed(KI2, 'ccListRiskClass', risk);
        app.feed('de.bmw.infotainment.checkcontrol.CheckControlMaster', 'basicList', V.find((v) => v.field === 'basicList').value);
        await sleep(12000);
        ok(!app.exited(), 'as twin_dial: the app runs');
        ok(app.lines(/probe: P2 ccListRiskClass #1 .*id=9 colour=RED risk=RK90 symbol=1/).length === 1 && app.lines(/probe: P2 basicList #1 /).length === 1, 'as twin_dial: ccListRiskClass and basicList come as P2 lines');
        ok(app.lines(/probe: ccListRiskClass:|probe: basicList:/).length === 0, 'as twin_dial: the 0.7.18 handlers for ccListRiskClass and basicList are NOT wired');
        ok(app.lines(symRe).length === 0 && app.lines(/requestDefaultSymbols/).length === 0, 'as twin_dial: requestDefaultSymbols is never called (12 s after start, the f30 probe would have run at 8 s)');
    });
    const runD = runApp('twin-legacy', { id: 'twin_dial', config: { probe: { minGapMs: 0 }, legacyProbes: true } }, async (app) => {
        await sleep(100);
        app.feed(KI2, 'ccListRiskClass', risk);
        const end = Date.now() + 14000;
        while (!app.lines(symRe).length && Date.now() < end) await sleep(200);
        ok(app.lines(/probe: ccListRiskClass: 1 entry/).length === 1 && app.lines(symRe).length >= 1,
            'legacyProbes true (the control run): the old probes and the symbol call are back, so the "off" check above can fail');
    });
    await Promise.all([runC, runD]);
}

main().then(() => {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp stays */ }
    process.exit(failed ? 1 : 0);
}).catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
