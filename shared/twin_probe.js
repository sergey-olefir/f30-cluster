'use strict';
/**
 * twin_probe.js - twin_dial's probe mode (docs/twin-dial/SPEC.md section 17.1; docs/twin-dial/PROBE-PROTOCOL.md).
 *
 * READ ONLY, LOG ONLY. With app.json "config.probe" on, every field of the probe items P1..P12 (VS's list) that the car
 * might send is subscribed through the app's existing watches, and its raw value is logged ONCE PER CHANGE as numbers,
 * enum names and text LENGTHS. It never reads, logs or keeps the text of a message, a song, a call, a road or an
 * address; never a coordinate; never a byte of a symbol bitmap. Nothing here writes to the car: no setter, no method
 * call, no message injection - the code below never touches the signals object at all, only the handlers the car's
 * notifications are delivered to (bench/test-twin-probe.js greps this file for every way of writing).
 *
 *   const probe = require('./twin_probe').wire(extra, { log, cfg: config.probe, id });
 *   probe.start();  ...  probe.stop();
 *
 * `extra` is the { iface: { field: fn, $instance } } map shared/hud.js hands to the kit's Car: each probe handler is put
 * IN FRONT of whatever handler is already on the field (the app's own still runs, exactly as before), and the
 * interface's instance is set when the probe needs one (HMI_CID, Main_Instance, ...). Never throws: a failing handler
 * logs one warning and the app's own handler still runs (an uncaught exception ends the app on the car).
 *
 * Log line (one per change; "t" = seconds since the probe was wired, "#" = how many lines this field has made):
 *
 *   probe P3 range-tank #2 t=41.3: fuel=38 fuelL=- fuelR=- spare=NICHT_AKTIV range=412 mileage=48215
 *
 * A field that changes faster than minGapMs is logged at most once per gap (the last value wins, "+k" says how many were
 * folded away) and at most maxLines times (the last line says so). A summary says which fields have never spoken.
 *
 * config.probe: true | { only: ["P7", ...] (default all), maxLines (60), minGapMs (1000), summaryS ([30, 120, 600]) }
 */

// Node 8.16 is what the car runs: no BigInt literals, no ?. or ??, no object spread, no optional catch binding
// (bench/test-twin-probe.js checks the source for them).
const VERSION = 1;
const MAX_LINES = 60;
const MIN_GAP_MS = 1000;
const SUMMARY_S = [30, 120, 600];
const MAX_ENTRIES = 24;             // list entries per line, then "+N more"

const isNum = (x) => typeof x === 'number' && isFinite(x);
const none = (x) => x === undefined || x === null;

// ---- value formatters: every one returns a SHORT token that can never carry free text ------------------------------
/** A number (a bigint too), or "-" for none. A string never gets through: "?". */
function fNum(x) {
    if (isNum(x)) return Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000);
    if (typeof x === 'bigint') return String(x).length <= 24 ? String(x) : '?';
    return none(x) ? '-' : '?';
}
/** An enum: its wire number or its NAME (an upper-case identifier), else "?". Only ever applied to enum members. */
function fEnum(x) {
    if (isNum(x)) return String(x);
    if (typeof x === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(x)) return x;
    return none(x) ? '-' : '?';
}
function fBool(x) {
    if (typeof x === 'boolean') return String(x);
    if (x === 0 || x === 1) return String(x === 1);
    return none(x) ? '-' : '?';
}
/** A bitfield: decimal and hex. */
function fHex(x) {
    if (isNum(x) && Number.isInteger(x) && x >= 0) return x ? x + '(0x' + x.toString(16) + ')' : '0';
    return fNum(x);
}
/** The LENGTH of a text (or of a byte buffer / array), never its content. */
function fLen(x) {
    if (typeof x === 'string') return String(x.length);
    if (x && typeof x === 'object' && isNum(x.length)) return String(x.length);
    return none(x) ? '-' : '?';
}
const KIND = { n: fNum, e: fEnum, b: fBool, x: fHex, t: fLen };

/** v[path[0]][path[1]]... or undefined (a path is an array, or one key). */
function dig(v, path) {
    let cur = v;
    const p = Array.isArray(path) ? path : [path];
    for (let i = 0; i < p.length; i++) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = cur[p[i]];
    }
    return cur;
}
/** "label=value label=value ..." from cols [[label, path, kind], ...]. */
function cols(v, cs) {
    return cs.map((c) => c[0] + '=' + KIND[c[2]](dig(v, c[1]))).join(' ');
}
/** "entries=N [..] [..]" for a list field. spec: { member (the union member holding each entry, or null), cols }. */
function listLine(v, spec) {
    if (!Array.isArray(v)) return 'not a list (' + (v === null ? 'null' : typeof v) + ')';
    const one = (el) => {
        const e = spec.member && el && typeof el === 'object' && el[spec.member] && typeof el[spec.member] === 'object' ? el[spec.member] : el;
        return e && typeof e === 'object' ? '[' + cols(e, spec.cols) + ']' : '[?]';
    };
    return 'entries=' + v.length + (v.length ? ' ' + v.slice(0, MAX_ENTRIES).map(one).join(' ') : '') +
        (v.length > MAX_ENTRIES ? ' +' + (v.length - MAX_ENTRIES) + ' more' : '');
}

// ---- the probe table: every field of P1..P12 --------------------------------------------------------------------------
const KI = 'de.bmw.infotainment.KombiIF';
const KI2 = 'de.bmw.infotainment.KombiInterface_2';
const V2 = 'de.bmw.infotainment.vehicle.Vehicle2';
const CDS = 'de.bmw.infotainment.vehicle.CDS';
const CCM = 'de.bmw.infotainment.checkcontrol.CheckControlMaster';
const DOORS = 'de.bmw.body.DoorsWindowsRoofMirrors';
const MEDIA_STATE = 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState';
const MEDIA_SRC = 'de.bmw.infotainment.entertainment.mediasource.MediaSource';
const HMICTX = 'de.bmw.infotainment.hmi.hmicontext.HMIContext';
const HMICTX2 = 'de.bmw.infotainment.hmi.hmicontext2.HMIContext2';
const GUIDANCE = 'de.bmw.infotainment.navigation.guiding.Guidance';
const NAVSTAT = 'de.bmw.infotainment.navigation.navigationstatus.NavigationStatus';

const TABLE = [
    // ---- P1: which message the cluster shows now, and which frame of how many ----
    { p: 'P1', iface: KI, field: 'statusActiveCCMessage', label: 'active-cc', cols: [
        ['number', 'numberDisplayControlCheckControlMessage', 'n'], ['control', 'displayControlCheckControlMessage', 'n'],
        ['frameNumber', 'numberFrameDisplayControlCheckControlMessage', 'n'], ['frame', 'frameDisplayControlCheckControlMessage', 'n'],
        ['utility', 'utilityDataDisplayControlCheckControlMessage', 'x']] },
    { p: 'P1', iface: V2, field: 'statusDisplayedCCMessage', label: 'displayed-cc', cols: [['number', 'statusNumberCheckControlMessageDisplay', 'n']] },
    { p: 'P1', iface: KI, field: 'statusMenuCCMessage', label: 'menu-cc', cols: [
        ['frameNumber', 'numberFrameCheckControlMessageScroll', 'n'], ['frames', 'quantityFrameCheckControlMessageScroll', 'n'],
        ['id1', 'numberCheckControlMessage1', 'n'], ['id2', 'numberCheckControlMessage2', 'n'], ['id3', 'numberCheckControlMessage3', 'n']] },
    { p: 'P1', iface: KI2, field: 'ccList', label: 'ccList', list: { member: 'cCListElement', cols: [
        ['id', 'cCIdentifer', 'n'], ['colour', 'cCColor', 'e'], ['symbol', 'cCListSymbolID', 'n'], ['indent', 'cCIndentation', 'e'],
        ['ric', 'ricResourceID', 'n'], ['name-len', 'cCShortName', 't']] } },
    // ---- P2: the stored-message marker: the stored lists ----
    { p: 'P2', iface: KI2, field: 'ccListRiskClass', label: 'ccListRiskClass', list: { member: 'cCListRiskClassElement', cols: [
        ['id', 'cCIdentifer', 'n'], ['colour', 'cCColor', 'e'], ['risk', 'cCRiskClass', 'e'], ['symbol', 'cCListSymbolID', 'n'],
        ['name-len', 'cCShortName', 't']] } },
    { p: 'P2', iface: CCM, field: 'basicList', label: 'basicList', list: { member: null, cols: [
        ['id', 'ccmId', 'n'], ['reason', 'reason', 'e'], ['state', 'activeState', 'e'], ['filter', 'filterInformation', 'e']] } },
    // ---- P3: the odometer (first choice: the range struct's own member; the others are alternatives) ----
    { p: 'P3', iface: KI, field: 'statusRangeTankStatus', label: 'range-tank', cols: [
        ['fuel', 'fluidLevelFuelTank', 'n'], ['fuelL', 'fluidLevelFuelTankLeftHand', 'n'], ['fuelR', 'fluidLevelFuelTankRightHand', 'n'],
        ['spare', 'statusFluidLevelFuelTankSpare', 'e'], ['range', 'range', 'n'], ['mileage', 'mileageKilometre', 'n']] },
    { p: 'P3', iface: 'de.bmw.infrastructure.VehicleInformation', field: 'Range', label: 'range-alt', cols: [['mileage', 'mileageKilometre', 'n']] },
    { p: 'P3', iface: 'de.bmw.infrastructure.MileageSupreme', field: 'mileageSupreme', label: 'mileage-supreme', cols: [
        ['mileage', 'mileageSupreme', 'n'], ['qualifier', 'qualifierMileageSupreme', 'e']] },
    { p: 'P3', iface: 'de.bmw.infrastructure.SecureMileage', field: 'mileage', label: 'mileage-secure', cols: [
        ['mileage', 'currentMileage', 'n'], ['alive', 'aliveCounter', 'n'], ['manipulation', 'manipulationState', 'n']] },
    // ---- P4: the trip computer ----
    { p: 'P4', iface: KI, field: 'statusBordcomputerAverage', label: 'bc-average', cols: [
        ['speed1', 'speedAverage1BC1', 'n'], ['cons1', 'consumptionAverage1BC1', 'n'], ['speed2', 'speedAverage2BC2', 'n'],
        ['cons2', 'consumptionAverage2BC2', 'n'], ['speedUnit', 'statusUnitOfMeasurementSpeedBC', 'e'],
        ['consUnit', 'statusUnitOfMeasurementConsumptionBC', 'e']] },
    { p: 'P4', iface: KI, field: 'statusBordcomputerTravelData', label: 'bc-travel', cols: [
        ['hours', 'rideDurationHours', 'n'], ['minutes', 'rideDurationMinutes', 'n'], ['way', 'wayPassed', 'n']] },
    { p: 'P4', iface: KI, field: 'statusBordcomputerTravelStart', label: 'bc-start', cols: [
        ['hour', 'hourDepartureBC', 'n'], ['minute', 'minuteDepartureBC', 'n'], ['day', 'dayDepartureBC', 'n'],
        ['month', 'monthDepartureBC', 'n'], ['year', 'yearDepartureBC', 'n']] },
    { p: 'P4', iface: KI, field: 'statusBordcomputerStatus2', label: 'bc-status2', cols: [
        ['bc2', 'statusBC2BN2020', 'e'], ['reset', 'statusResetBC2BN2020', 'e'], ['limit', 'statusLimitBN2020', 'e'],
        ['boundary', 'boundaryLimitBN2020', 'n'], ['speedUnit', 'statusUnitOfMeasurementSpeedSpeedometerBN2020', 'e']] },
    { p: 'P4', iface: 'de.bmw.infotainment.resetlogic.ResetLogic3', field: 'bcDataAll', label: 'bc-all3', cols: [
        ['speedUnit', ['bcUnits', 'tachoDigital'], 'e'], ['consNowUnit', ['bcUnits', 'currentConsumptionCombustion'], 'e'],
        ['consAvgUnit', ['bcUnits', 'averageConsumptionCombustion'], 'e'], ['active', 'activeResetLogic', 'n'],
        ['available', 'availableResetLogic', 'x'], ['option', ['bcData3', 'resetOption'], 'e'],
        ['tripDay', ['bcData3', 'dateTimeTrip', 'day'], 'n'], ['tripH', ['bcData3', 'dateTimeTrip', 'hour'], 'n'],
        ['tripM', ['bcData3', 'dateTimeTrip', 'minute'], 'n'], ['tripS', ['bcData3', 'dateTimeTrip', 'second'], 'n'],
        ['speedAvg', ['bcData3', 'speedAverage'], 'n'], ['consAvgScale', ['bcData3', 'consumptionCombustionAverageScale'], 'n'],
        ['consAvgDigit', ['bcData3', 'consumptionCombustionAverageDigit'], 'n'], ['consNowScale', ['bcData3', 'consumptionCombustionCurrentScale'], 'n'],
        ['consNowDigit', ['bcData3', 'consumptionCombustionCurrentDigit'], 'n'], ['distance', ['bcData3', 'counterDistance'], 'n'],
        ['resetY', ['bcData3', 'dateTimeReset', 'year'], 'n'], ['resetMo', ['bcData3', 'dateTimeReset', 'month'], 'n'],
        ['resetD', ['bcData3', 'dateTimeReset', 'day'], 'n'], ['resetH', ['bcData3', 'dateTimeReset', 'hour'], 'n'],
        ['resetMi', ['bcData3', 'dateTimeReset', 'minute'], 'n']] },
    // research3/MK: the other trip carriers the catalogue search found (docs/research3/MK-REPORT.md section 2), the wide net
    // for the case where KombiIF and ResetLogic3 both stay silent on the normal build
    { p: 'P4', iface: 'de.bmw.infotainment.resetlogic.ResetLogic', field: 'bcDataAll', label: 'bc-all1', cols: [
        ['option', ['bcData', 'resetOption'], 'e'], ['speedAvg', ['bcData', 'speedAverage'], 'n'], ['consAvg', ['bcData', 'consumptionAverage'], 'n'],
        ['consNow', ['bcData', 'currentConsumption'], 'n'], ['tripDay', ['bcData', 'dateTimeTrip', 'day'], 'n'], ['tripH', ['bcData', 'dateTimeTrip', 'hour'], 'n'],
        ['tripM', ['bcData', 'dateTimeTrip', 'minute'], 'n'], ['resetH', ['bcData', 'dateTimeReset', 'hour'], 'n'], ['resetMi', ['bcData', 'dateTimeReset', 'minute'], 'n'],
        ['speedUnit', ['bcUnits', 'tachoDigital'], 'e'], ['consUnit', ['bcUnits', 'consumption'], 'e']] },
    { p: 'P4', iface: 'de.bmw.infotainment.resetlogic.ResetLogic', field: 'averageConsumption', label: 'bc-avgcons1', cols: [
        ['consNowScale', 'consumptionCombustionCurrentScale', 'n'], ['consNowDigit', 'consumptionCombustionCurrentDigit', 'n'], ['unit', 'combustionUnit', 'e']] },
    { p: 'P4', iface: 'de.bmw.infotainment.resetlogic.ResetLogic2', field: 'bcDataAll', label: 'bc-all2', cols: [
        ['option', ['bcData', 'resetOption'], 'e'], ['speedAvg', ['bcData', 'speedAverage'], 'n'],
        ['consAvgScale', ['bcData', 'consumptionCombustionAverageScale'], 'n'], ['consAvgDigit', ['bcData', 'consumptionCombustionAverageDigit'], 'n'],
        ['tripDay', ['bcData', 'dateTimeTrip', 'day'], 'n'], ['tripH', ['bcData', 'dateTimeTrip', 'hour'], 'n'], ['tripM', ['bcData', 'dateTimeTrip', 'minute'], 'n'],
        ['resetH', ['bcData', 'dateTimeReset', 'hour'], 'n'], ['resetMi', ['bcData', 'dateTimeReset', 'minute'], 'n'], ['speedUnit', ['bcUnits', 'tachoDigital'], 'e']] },
    { p: 'P4', iface: 'de.bmw.infotainment.telematic.journeyhistory.BcPersonal', field: 'driveSegment', label: 'bc-segment', cols: [
        ['segment', 'bcBeSegmentId', 'n'], ['trigger', 'bcBeTriggerReason', 'e'], ['durDrive', 'bcBeDurationDrive', 'n'], ['durMoving', 'bcBeDurationMoving', 'n'],
        ['distance', 'bcBeTripDistanceKm', 'n'], ['speedDrive', 'bcBeSpeedAvgDrive', 'n'], ['speedMoving', 'bcBeSpeedAvgMoving', 'n'], ['fuel', 'bcBeConsFuelVisible', 'n']] },
    { p: 'P4', iface: 'de.bmw.infotainment.lsc.LSCDataSink', field: 'dataCombinedInstrumentCluster', label: 'lsc-cluster', cols: [
        ['speedAvg', 'averageSpeed', 'n'], ['consAvg', 'averageRangeConsumption', 'n'], ['fuel', 'displayActualValueFuelTankFluidLevel', 'n']] },
    // ---- P5: units ----
    { p: 'P5', iface: 'de.bmw.infrastructure.EnvironmentalInformation', field: 'UnitBN2020', label: 'units', cols: [
        ['mileage', 'unitOfMeasurementMileage', 'e']] },
    { p: 'P5', iface: KI, field: 'statusKombiExternalDisplay', label: 'external-display', cols: [
        ['outside', 'displayTemperatureExterior', 'n'], ['range', 'displayRange', 'n'],
        ['tempUnit', 'statusUnitOfMeasurementTemperatureInstrumentPack', 'e']] },
    // ---- P6: cold start to warm ----
    { p: 'P6', iface: KI, field: 'dataInstrumentPack', label: 'engine-verdict', cols: [
        ['verdict', 'engineTemperatureEvaluated', 'e'], ['auxPower', 'presentAuxiliaryConsumerPower', 'n']] },
    { p: 'P6', iface: CDS, field: 'statusEngineTemperature', label: 'coolant', cap: 240, fmt: 'temps' },
    // ---- P7: doors, boot, bonnet ----
    { p: 'P7', iface: DOORS, field: 'CentralLockingSystemAndPanelStatus2', label: 'doors', cols: [
        ['driver', 'statusDoorSwitchDRD', 'e'], ['passenger', 'statusDoorSwitchPSD', 'e'], ['rearDriver', 'statusDoorSwitchDRDR', 'e'],
        ['rearPassenger', 'statusDoorSwitchPSDR', 'e'], ['boot', 'statusContactBootLid', 'e'], ['bonnet', 'statusContactBonnet', 'e'],
        ['boot2', 'statusContactBootLid2', 'e'], ['softClose', 'statusContactSoftCloseAutomatic', 'e'],
        ['locking', 'statusCentralLockingSystem', 'n'], ['hotel', 'statusHotelMode', 'e']] },
    { p: 'P7', iface: 'de.bmw.infotainment.vehicle.A4A', field: 'statusA4ALids', label: 'lids', cols: [['bonnet', 'statusContactBonnet', 'e']] },
    { p: 'P7', iface: V2, field: 'statusZVStatus', label: 'zv-status', cols: [
        ['locking', 'statusCentralLockingSystem', 'n'], ['bootUnlocked', 'statusCentralLockingSystemBootlid', 'e'], ['dwa', 'controlDWAPartial', 'n']] },
    // ---- P8: media (text: lengths only) ----
    { p: 'P8', iface: MEDIA_STATE, field: 'playerMetadata', label: 'player-metadata', instance: 'HMI_CID', cols: [
        ['sink', 'sink', 'e'], ['uiType', 'uiType', 'e'], ['menuEntry', 'menuEntry', 'n'], ['track', 'trackId', 'n'],
        ['line1-type', 'firstLineType', 'e'], ['line1-len', 'firstLineText', 't'], ['line2-type', 'secondLineType', 'e'],
        ['line2-len', 'secondLineText', 't'], ['line3-len', 'threeRowText', 't']] },
    { p: 'P8', iface: MEDIA_SRC, field: 'activeSourceId', label: 'active-source', fmt: 'activeSource' },
    { p: 'P8', iface: MEDIA_SRC, field: 'sources', label: 'sources', fmt: 'sources' },
    // ---- P9: a call ----
    { p: 'P9', iface: 'de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator', field: 'aggregatedCallState', label: 'call-state', fmt: 'enum' },
    { p: 'P9', iface: 'de.bmw.infotainment.a4a.carplay.CarPlayManager', field: 'projectedTelephonyActive', label: 'carplay-call', instance: 'CarPlayManagerInst1', fmt: 'bool' },
    // ---- P10: engine off / on: is there a voltage ----
    { p: 'P10', iface: 'de.bmw.infrastructure.analytics.BasicDataSet', field: 'basicDataSet', label: 'voltage-basic', cap: 240, cols: [
        ['voltage', 'statusVoltageIntelligentBoardnetSensor', 'n']] },
    { p: 'P10', iface: 'com.harman.infotainment.systeminfrastructure.environment.levelmonitor.LevelMonitor', field: 'systemVoltage', label: 'voltage-hu',
        instance: 'Inst1', cap: 240, cols: [['sim', 'simuState', 'b'], ['value', 'value', 'n']] },
    { p: 'P10', iface: CDS, field: 'statusBattery2', label: 'battery-condition', cols: [['condition', 'conditionBatteryChargingCondition', 'n']] },
    // ---- P11: the stalk button / cluster view ----
    { p: 'P11', iface: HMICTX, field: 'currentICWidget', label: 'ic-widget', instance: 'HMI_CID', fmt: 'hex' },
    { p: 'P11', iface: HMICTX, field: 'currentICGraphicalContext', label: 'ic-context', instance: 'HMI_CID', cols: [
        ['focus', 'focusIndex', 'n'], ['list', 'listIndex', 'n'], ['visible', 'visibleContext', 'x']] },
    { p: 'P11', iface: HMICTX2, field: 'currentICWidget', label: 'ic-widget2', instance: '1', cols: [['state', 'StateID', 'n'], ['applet', 'AppletID', 'n']] },
    { p: 'P11', iface: HMICTX2, field: 'currentICGraphicalContext', label: 'ic-context2', instance: '1', cols: [
        ['state', ['VisualContext', 'StateID'], 'n'], ['applet', ['VisualContext', 'AppletID'], 'n'],
        ['focus', ['FocusIndex', 'FocusIndex'], 'n'], ['focusApplet', ['FocusIndex', 'AppletID'], 'n'], ['list', 'ListIndex', 'n']] },
    { p: 'P11', iface: KI, field: 'statusKombiSelection', label: 'kombi-selection', cols: [
        ['packBC', 'statusActivationInstrumentPackBC', 'x'], ['content', 'statusActivationInstrumentPackContent', 'x'],
        ['preselect', 'statusActivationPreselectInstrumentPack', 'e']] },
    { p: 'P11', iface: KI, field: 'statusKombiSelectionAvailability', label: 'kombi-available', cols: [
        ['packBC', 'baseSetupInstrumentPackBC', 'x'], ['content', 'baseSetupInstrumentPackContent', 'x'], ['preselect', 'baseSetupPreselectInstrumentPack', 'n']] },
    { p: 'P11', iface: KI, field: 'statusConfigurationKombi5', label: 'kombi-config', cols: [
        ['content2', 'statusActivationInstrumentPackContent2', 'x'], ['preselect2', 'statusActivationPreselectInstrumentPack2', 'e'],
        ['navDisplay', 'statusNavigationDisplayType', 'e'], ['dzmOrPower', 'statusDZMorPowermeterDisplay', 'e'],
        ['entertainment', 'statusEntertainmentSTGDisplay', 'e']] },
    { p: 'P11', iface: V2, field: 'statusDisplayKombi', label: 'display-kombi', cols: [['view', 'statusDisplayInstrumentPackM', 'e']] },
    // ---- P12: a guided route ----
    { p: 'P12', iface: NAVSTAT, field: 'guidingState', label: 'guiding-state', fmt: 'enum' },
    { p: 'P12', iface: GUIDANCE, field: 'nextIntersection', label: 'next-intersection', instance: 'Main_Instance', fmt: 'intersection' },
];

// ---- the fields whose line needs more than a column list ------------------------------------------------------------
function fmtTemps(v) {
    const one = (label, raw) => {
        const s = fNum(raw);
        const c = isNum(raw) && raw >= 0 && raw < 255 ? ' (' + (raw - 48) + ' C)' : '';
        return label + '=' + s + c;
    };
    return one('coolant-raw', dig(v, 'temperatureEngineDrive')) + ' ' + one('oil-raw', dig(v, 'temperatureEngineOilDrive'));
}
/** The next manoeuvre: how many elements of which kind, a text's LENGTH only. Measures its own parse time (P12). */
function fmtIntersection(v, st) {
    const t0 = process.hrtime();
    let out;
    if (!v || typeof v !== 'object') out = 'not a struct (' + (v === null ? 'null' : typeof v) + ')';
    else {
        const els = dig(v, ['intersection', 'elements']);
        const kinds = Array.isArray(els) ? els.slice(0, MAX_ENTRIES).map((el) => {
            if (!el || typeof el !== 'object') return '[?]';
            if (!none(el.text)) return '[text len=' + fLen(el.text) + ']';
            if (!none(el.spacer)) return '[spacer=' + fEnum(el.spacer) + ']';
            if (el.icon && typeof el.icon === 'object') return '[icon text-len=' + fLen(el.icon.text) + ']';
            return '[?]';
        }).join(' ') : '[not a list]';
        const icons = dig(v, 'serviceIcons');
        out = 'elements=' + (Array.isArray(els) ? els.length : '-') + ' ' + kinds +
            ' serviceIcons=' + (Array.isArray(icons) ? icons.length : '-') +
            ' distance-len=' + fLen(dig(v, ['distance', 'distance'])) + ' unit=' + fEnum(dig(v, ['distance', 'unit'])) +
            ' raw=' + fNum(dig(v, ['distance', 'rawDistance']));
    }
    const d = process.hrtime(t0), us = d[0] * 1e6 + Math.round(d[1] / 1000);
    st.parseUs = Math.max(st.parseUs || 0, us);
    return out + ' parse<=' + (Math.ceil(st.parseUs / 10) / 100) + 'ms';
}

class TwinProbe {
    constructor(extra, opts) {
        const o = opts || {};
        this.log = o.log;
        this.now = typeof o.now === 'function' ? o.now : Date.now;
        const cfg = o.cfg && typeof o.cfg === 'object' ? o.cfg : {};
        this.maxLines = isNum(cfg.maxLines) && cfg.maxLines > 0 ? Math.floor(cfg.maxLines) : MAX_LINES;
        this.minGap = isNum(cfg.minGapMs) && cfg.minGapMs >= 0 ? cfg.minGapMs : MIN_GAP_MS;
        this.summaryS = Array.isArray(cfg.summaryS) ? cfg.summaryS.filter(isNum).sort((a, b) => a - b) : SUMMARY_S;
        this.only = Array.isArray(cfg.only) ? cfg.only.map(String) : null;
        this.t0 = this.now();
        this.timer = null;
        this.summaries = 0;
        this.media = { active: null, ids: null };       // P8: in memory only, to say which source entry is the active one
        this.fields = [];
        TABLE.forEach((f) => {
            if (this.only && this.only.indexOf(f.p) < 0) return;
            const e = extra[f.iface] = extra[f.iface] || {};
            if (f.instance) {
                if (e.$instance && String(e.$instance) !== f.instance) {
                    this._warn(f.p + ' ' + f.label + ': the app already watches ' + f.iface.split('.').pop() + ' instance ' + e.$instance + ', not ' + f.instance + ': skipped');
                    return;
                }
                e.$instance = f.instance;
            }
            const st = { f, n: 0, events: 0, last: undefined, lastAt: -Infinity, pending: null, skipped: 0, warned: false, parseUs: 0, cap: f.cap || this.maxLines };
            const prev = e[f.field];
            e[f.field] = (v) => {
                try { this._value(st, v); } catch (err) {
                    if (!st.warned) { st.warned = true; this._warn(f.p + ' ' + f.label + ': ' + String(err && err.message || err).slice(0, 120)); }
                }
                if (prev) prev(v);
            };
            this.fields.push(st);
        });
        this._info('twin_probe ' + VERSION + ' on: ' + this.fields.length + ' fields of ' + (this.only ? this.only.join(',') : 'P1..P12') +
            ', read only; text only as lengths, never coordinates or bitmaps');
    }

    _info(s) { try { this.log.info('probe: ' + s); } catch (e) { /* a failing log: nothing to do */ } }
    _warn(s) { try { this.log.warn('probe: ' + s); } catch (e) { /* a failing log: nothing to do */ } }
    _t() { return Math.round((this.now() - this.t0) / 100) / 10; }

    /** The line's body for a value: columns, a list, or the field's own formatter. */
    _body(st, v) {
        const f = st.f;
        if (f.cols) return cols(v, f.cols);
        if (f.list) return listLine(v, f.list);
        switch (f.fmt) {
            case 'enum': return 'state=' + fEnum(v);
            case 'bool': return 'active=' + fBool(v);
            case 'hex': return 'widget=' + fHex(v);
            case 'temps': return fmtTemps(v);
            case 'intersection': return fmtIntersection(v, st);
            case 'activeSource': {
                this.media.active = typeof v === 'string' ? v : null;       // kept in memory for the match below, never logged
                return 'len=' + fLen(v) + ' matches-source-entry=' + this._mediaMatch();
            }
            case 'sources': {
                const ids = [];
                const line = !Array.isArray(v) ? 'not a list (' + (v === null ? 'null' : typeof v) + ')' : (() => {
                    v.forEach((el) => ids.push(el && typeof el === 'object' && typeof el.sourceId === 'string' ? el.sourceId : null));
                    this.media.ids = ids;
                    return 'entries=' + v.length + ' ' + v.slice(0, MAX_ENTRIES).map((el, i) => (el && typeof el === 'object'
                        ? '[#' + i + ' type=' + fEnum(el.playerType) + ' selectable=' + fBool(el.selectable) + ' order=' + fNum(el.insertionOrder) +
                          ' id-len=' + fLen(el.sourceId) + ' text-len=' + fLen(el.displayText) + ' instance-len=' + fLen(el.instanceId) + ']' : '[?]')).join(' ') +
                        (v.length > MAX_ENTRIES ? ' +' + (v.length - MAX_ENTRIES) + ' more' : '');
                })();
                return line + (Array.isArray(v) ? ' active-is-entry=' + this._mediaMatch() : '');
            }
            default: return '?';
        }
    }
    /** Which sources entry carries the active source id: its index, "none", or "unknown" (one of the two not read yet). */
    _mediaMatch() {
        const m = this.media;
        if (m.active === null || m.ids === null) return 'unknown';
        const i = m.ids.indexOf(m.active);
        return i < 0 ? 'none' : String(i);
    }

    _value(st, v) {
        st.events++;
        const body = this._body(st, v);
        // the parse time in a P12 line changes with every call: compare what the car said, not how long it took
        const key = st.f.fmt === 'intersection' ? body.replace(/ parse<=[0-9.]+ms$/, '') : body;
        if (key === st.last) { st.pending = null; return; }
        if (st.n >= st.cap) return;
        const t = this.now();
        if (t - st.lastAt < this.minGap) { if (st.pending !== null) st.skipped++; st.pending = { body, key }; return; }
        this._emit(st, body, key, t);
    }

    _emit(st, body, key, t) {
        st.n++;
        const f = st.f;
        this._info(f.p + ' ' + f.label + ' #' + st.n + ' t=' + this._t() + ': ' + body +
            (st.skipped ? ' (+' + st.skipped + ' folded)' : '') + (st.n >= st.cap ? ' (the last line for this field)' : ''));
        st.last = key; st.lastAt = t; st.pending = null; st.skipped = 0;
    }

    /** Called about once a second: lines held back by minGapMs go out; the summaries at their times. */
    tick() {
        const t = this.now();
        this.fields.forEach((st) => {
            if (st.pending && st.pending.key !== st.last && st.n < st.cap && t - st.lastAt >= this.minGap) this._emit(st, st.pending.body, st.pending.key, t);
        });
        while (this.summaries < this.summaryS.length && (t - this.t0) / 1000 >= this.summaryS[this.summaries]) {
            this._summary(this.summaryS[this.summaries]);
            this.summaries++;
        }
    }

    _summary(s) {
        const heard = this.fields.filter((st) => st.events > 0), silent = this.fields.filter((st) => st.events === 0);
        this._info('summary t=' + s + ': ' + heard.length + ' of ' + this.fields.length + ' fields have spoken: ' +
            (heard.map((st) => st.f.p + ' ' + st.f.label + '(' + st.events + ' events, ' + st.n + ' lines)').join(', ') || 'none'));
        this._info('summary t=' + s + ': silent: ' + (silent.map((st) => st.f.p + ' ' + st.f.label).join(', ') || 'none'));
    }

    /** { p, label, events, lines, silent } per field (tests; the summary line is the same data). */
    stats() {
        return this.fields.map((st) => ({ p: st.f.p, label: st.f.label, iface: st.f.iface, field: st.f.field, events: st.events, lines: st.n, silent: st.events === 0 }));
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => { try { this.tick(); } catch (e) { this._warn('tick: ' + (e && e.message || e)); } }, 1000);
        if (this.timer && this.timer.unref) this.timer.unref();
    }
    stop() { clearInterval(this.timer); this.timer = null; }
}

/** Wire the probe into `extra` ({ iface: { field: fn } }); returns the TwinProbe (start() / stop() / tick() / stats()). */
function wire(extra, opts) { return new TwinProbe(extra, opts); }

module.exports = { wire, TwinProbe, TABLE, VERSION, fNum, fEnum, fBool, fHex, fLen };
