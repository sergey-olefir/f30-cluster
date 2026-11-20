'use strict';
/**
 * rv_fields.js - the RV recorder's source table: set S19 "RV" (road view) of the round "Road View" (docs/traffic/BRIEF-TS-signals.md).
 * ONE table drives the subscriptions, the recording, the summaries, the manifest ("signals" of app.json, checked by
 * bench/test-signal-rv.js and `node tools/road-view/rv_manifest.js check`) and design/car/rv_fields.json.
 *
 * Why a separate app: Signal Probe already declares 99 interfaces (the most an app was seen running with on the car is 88) and this
 * set needs six more (the traffic light, two road-scene inputs, the road output, the camera's blockage, the ACC foresight display): 105. The brief says not to
 * grow Signal Probe past 99, so this small recorder declares only this set's 22 interfaces and reuses Signal Probe's recorder and
 * formatter from shared/ (signal_recorder.js, signal_format.js).
 *
 * READ ONLY: "b" an EVENT (declared under "_broadcasts"), "s" a notifier, "rs" a notifier with a NON-ZERO getter id (checked against
 * the catalogue by the test). Never "w", never a method, never settingTrafficlightBraking / settingTrafficlightDriveOff
 * (rws: not declared at all; four other settings are read by their notifier only, "s"), never a navigation interface.
 *
 * An entry:
 *   tag, iface, field, flags   the source; flags "b" | "s" | "rs"
 *   group                      light | signs | function | display | warning | scene | model | objects | camera | context
 *   kind                       "full": every message goes to the recording, unthrottled (small or rare sources);
 *                              "list": the first message of a recording whole, then ONE summary line a second (summary below), and
 *                              the next message whole after each mark (the passenger's "now")
 *   skip                       member names never written or logged (the car's own position and heading on the road output; the
 *                              sign location floats, privacy first)
 *   recEntries                 a list keeps at most this many entries in a recording (the recorder's own cap is 16)
 *   sum                        what a list source's summary line holds (paths into the message; "a[].b" = member b of every entry
 *                              of the list a): count (the message's own object count, max of the second), ids (distinct ids, the
 *                              first 6 sorted), cls { name: path } (distinct values, the first 6), rng { name: path } (min / max),
 *                              len { name: path } (a list's length, max of the second). Every list source also counts its messages
 *                              and the distinct eventDataQualifier values.
 *   log                        while recording, a CHANGE of these members (paths "a.b"; true = the whole value) is also one log line
 *                              ("change <tag> t=..: ..."), at most LOG_CAP lines a source: the limit, no overtaking, the country coding,
 *                              the display's sign, the warning symbol, the functions' states, the settings' availability
 *   trip                       the stalk: the rising edge of bit 0x40 of operationColumnStalks (the TRIP button, seen on the car
 *                              2026-11-18) is a mark, when the setting "tripMark" is on
 *
 * Node 8.16: no ?. / ??, no object spread, no optional catch binding.
 */
const I = {
    TrafficLight: 'de.bmw.environmentalmodel.TrafficLightRecognitionFrontCameraLegacy',
    SignCamera: 'de.bmw.environmentalmodel.SignRecognitionFrontCamera',
    SignCameraLegacy: 'de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy',
    TrafficSignRecognition: 'de.bmw.dass.TrafficSignRecognition',
    DisplayDataServer: 'de.bmw.infotainment.displaydataserver.DisplayDataServer',
    DisplayDataServer2: 'de.bmw.infotainment.displaydata.DisplayDataServer2',
    FASuS: 'de.bmw.infotainment.fasus.FASuS',
    ViewInput: 'de.bmw.dass.AssistedDrivingViewFunctionInput',
    ViewLca: 'de.bmw.dass.driverassistanceapplications.AssistedDrivingViewLateralCollisionAvoidance',
    ViewLateral: 'de.bmw.dass.pad.communication.AssistedDrivingViewLateralFunctionInput',
    RoadOutput: 'de.bmw.dass.pad.communication.RoadOutputAssistedDrivingView',
    DAADataServer: 'de.bmw.environmentalmodel.DAADataServer',
    ObjectsFrontCamera: 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera',
    ObjectsFrontCamera2: 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera2',
    Blockage: 'de.bmw.environmentalmodel.environmentalconditions.BlockageAndWeatherFrontCameraMain',
    Vehicle2: 'de.bmw.infotainment.vehicle.Vehicle2',
    VehicleInformation: 'de.bmw.infrastructure.VehicleInformation',
    Light: 'de.bmw.body.Light',
    CDS2: 'de.bmw.infotainment.vehicle.CDS2',
    // TR-REPORT D.4 (2026-11-20): the ACC foresight display, the fused object list for the road scene, the assistance settings'
    // NOTIFIERS (their availability is the cheapest witness of what the controllers think this car has)
    DisplayForesight: 'de.bmw.dass.DisplayForesight',
    ObjectListSuAAR: 'de.bmw.dass.pad.communication.ObjectListSuAAR',
    SettingsDriverAssistance: 'de.bmw.dass.settingsdriverassistancefunctions.SettingsDriverAssistanceFunctions',
};

const SET = { id: 'S19', label: 'RV', name: 'road view' };

const TABLE = [
    // ---- the traffic light: one light per message (nine UInt8, no enum table in the catalogue): every message, raw ----
    { tag: 'tl', group: 'light', iface: I.TrafficLight, field: 'RecognitionTrafficLightCamera', flags: 'b', kind: 'full' },
    // ---- the camera's sign streams (79 sign types): every message; at most 8 signs of the 20 slots; the location floats never ----
    { tag: 'cam-signs', group: 'signs', iface: I.SignCamera, field: 'TrafficSignRecognitionFrontCamera', flags: 'b', kind: 'full', recEntries: 8, skip: ['location'] },
    { tag: 'cam-legacy', group: 'signs', iface: I.SignCameraLegacy, field: 'RecognitionTrafficSignCamera', flags: 'b', kind: 'full' },
    { tag: 'cam-legacy2', group: 'signs', iface: I.SignCameraLegacy, field: 'recognitionTrafficSignCamera2', flags: 'b', kind: 'full', recEntries: 8, skip: ['location'] },
    // ---- the sign function (the source of the limit both themes draw): every output, every message ----
    { tag: 'tsr', group: 'function', iface: I.TrafficSignRecognition, field: 'TrafficSignRecognition', flags: 'b', kind: 'full',
      log: ['presentClassLimitSpeed', 'recognitionNoPassing', 'countryCodingTrafficSign', 'displaySupplementalSign', 'statusStreetTyp'] },
    // ---- the display feeds: DisplayDataServer's vSLISymbol / vSLISpeedValue / vSLIDistanceValues, and DisplayDataServer2's vsliSign
    //      (the 30 values with TRAFFIC_LIGHT_*), vsliValue, vsliDistance, vsliLabel: the whole value every message ----
    { tag: 'hud-data', group: 'display', iface: I.DisplayDataServer, field: 'functionalLibraryData', flags: 'rs', kind: 'full' },
    { tag: 'hud-data2', group: 'display', iface: I.DisplayDataServer2, field: 'functionalLibraryData', flags: 'rs', kind: 'full',
      log: ['xSpeedLimitAssist.vsliSign', 'xSpeedLimitAssist.vsliValue', 'xSpeedLimitAssist.sliValue', 'npiData.npiState', 'npiData.npiLabel', 'warnBrakeCoordinator.wbkSym', 'warnBrakeCoordinator.wbkMode'] },
    // ---- FASuS, read only: the display-symbol request (RequestDisplaySymbol: AMPEL, STOP_SCHILD, ...), the traffic-light functions'
    //      states (StatusTrafficLightAssistance, StatusUCCTrafficLight, StatusUCCRestartTrafficLight), the foresight's traffic-light
    //      suppression, the sign texts and the next limit / no passing ----
    { tag: 'warn-brake', group: 'warning', iface: I.FASuS, field: 'requestWarnBrakeCoordinatorDisplay', flags: 'rs', kind: 'full', log: ['requestDisplaySymbol', 'requestSymbolAttribute'] },
    { tag: 'fas-ext', group: 'warning', iface: I.FASuS, field: 'statusIDriveFASExtended', flags: 'rs', kind: 'full', log: true },
    { tag: 'foresight2', group: 'warning', iface: I.FASuS, field: 'displayForesight2', flags: 'rs', kind: 'full', log: true },
    // TR D.4: the ACC foresight display (notifier only: no getter); with TrafficSignDisplayControl's twin never up on this car
    { tag: 'foresight', group: 'warning', iface: I.DisplayForesight, field: 'displayForesight', flags: 's', kind: 'full', log: ['dispForesightEvent', 'suppressionTrafficLightPrediction', 'dispTakeOverRequestReason'] },
    // TR D.4: the assistance settings' notifiers ONLY (each has a setter; never declared w). settingTrafficlightBraking and
    // settingTrafficlightDriveOff are NOT read at all (the round's rule): their availability stays unknown
    { tag: 'set-stop-sign', group: 'settings', iface: I.SettingsDriverAssistance, field: 'settingStopSignBraking', flags: 's', kind: 'full', log: true },
    { tag: 'set-give-way', group: 'settings', iface: I.SettingsDriverAssistance, field: 'settingGiveWayWarning', flags: 's', kind: 'full', log: true },
    { tag: 'give-way-status', group: 'settings', iface: I.SettingsDriverAssistance, field: 'displayStatusGiveWayWarning', flags: 's', kind: 'full', log: true },
    { tag: 'set-wrong-way', group: 'settings', iface: I.SettingsDriverAssistance, field: 'settingWrongWayAssistant', flags: 's', kind: 'full', log: true },
    { tag: 'sli-text', group: 'function', iface: I.FASuS, field: 'statusSLITextMessage', flags: 'rs', kind: 'full' },
    { tag: 'next-limit', group: 'function', iface: I.FASuS, field: 'statusNextSpeedLimitRecognition', flags: 'rs', kind: 'full' },
    { tag: 'no-passing', group: 'function', iface: I.FASuS, field: 'statusOvertakeRecognition', flags: 'rs', kind: 'full' },
    // ---- the road scene the maker draws: the first message whole, then one summary line a second ----
    { tag: 'view-input', group: 'scene', iface: I.ViewInput, field: 'assistedDrivingViewFunctionInputIbVip', flags: 'b', kind: 'list',
      sum: { ids: 'assistedDrivingViewACCTargetObjectId', cls: { xcc: 'assistedDrivingViewStateXcc', sld: 'assistedDrivingViewDispSLD' } } },
    // TR: the rear radars' lane-change warning, three object ids a side: every message (27 small members)
    { tag: 'lca-input', group: 'scene', iface: I.ViewLca, field: 'assistedDrivingViewLcaInput', flags: 'b', kind: 'full',
      log: ['statusLaneChangeWarning.statusLaneChangeWarningLeft', 'statusLaneChangeWarning.statusLaneChangeWarningRight', 'statusLaneDepartureWarning.directionLaneDepartureWarning'] },
    { tag: 'lateral-input', group: 'scene', iface: I.ViewLateral, field: 'lateralFunctionInputAssistedDrivingView', flags: 'b', kind: 'list',
      sum: { cls: { lsa: 'lsaFunctionStates.lsaState', swa: 'swaFunctionStates.swaState', alg: 'algFunctionStates.algState' } } },
    { tag: 'road-segment', group: 'scene', iface: I.RoadOutput, field: 'roadSegmentUpdate', flags: 'b', kind: 'list', recEntries: 4,
      sum: { len: { segments: 'data.laneSegments', boundaries: 'data.laneBoundaries' }, cls: { lane: 'data.laneSegments[].laneType', road: 'data.laneSegments[].roadType' },
          rng: { egoIdx: 'data.egoVehicleLaneSegmentIndex' } } },
    { tag: 'ego-position', group: 'scene', iface: I.RoadOutput, field: 'egoVehiclePositionUpdate', flags: 'b', kind: 'list', skip: ['posX', 'posY', 'heading'],
      sum: { cls: { q: 'eventDataQualifier' } } },
    // ---- the environment model's lists ----
    { tag: 'merged-objects', group: 'model', iface: I.DAADataServer, field: 'ObjectListMerged', flags: 'b', kind: 'list',
      sum: { len: { objects: 'objectListMergedArrayInfo' }, ids: 'objectListMergedArrayInfo[].objId', cls: { type: 'objectListMergedArrayInfo[].objType' }, rng: { range: 'objectListMergedArrayInfo[].objRange' } } },
    { tag: 'object-info1', group: 'model', iface: I.DAADataServer, field: 'ObjectInformation1', flags: 'b', kind: 'list',
      sum: { count: 'objectRecognition.numberOfObjects', ids: 'objectRecognition.objectRecognitionInfo[].objectID', cls: { type: 'objectRecognition.objectRecognitionInfo[].classificationType' },
          rng: { x: 'objectPosition.objectPositionInfo[].positionX', y: 'objectPosition.objectPositionInfo[].positionY' } } },
    { tag: 'object-info2', group: 'model', iface: I.DAADataServer, field: 'ObjectInformation2', flags: 'b', kind: 'list',
      sum: { count: 'numberOfObjects', rng: { vx: 'objectMovementInfo[].speedAbsoluteX' } } },
    { tag: 'object-lanes', group: 'model', iface: I.DAADataServer, field: 'ObjectAssignment', flags: 'b', kind: 'list',
      sum: { count: 'numberOfObjects', cls: { overall: 'overallAssignmentType', type: 'assignedObjectInfo[].assignmentType' } } },
    { tag: 'lane-info', group: 'model', iface: I.DAADataServer, field: 'LaneInformation', flags: 'b', kind: 'list',
      sum: { cls: { left: 'leftLaneLaneTypeInfo.type', ego: 'egoLaneLaneTypeInfo.type', right: 'rightLaneLaneTypeInfo.type' } } },
    { tag: 'road-model', group: 'model', iface: I.DAADataServer, field: 'RoadModel', flags: 'b', kind: 'list',
      sum: { rng: { egoWidth: 'egoLane.width' }, cls: { segs: 'egoLane.centerLine.numSegments' } } },
    { tag: 'fas-view', group: 'model', iface: I.DAADataServer, field: 'FASView', flags: 'b', kind: 'list', sum: { len: { content: 'content' } } },
    // TR D.4: the fused object list the maker's road scene is drawn from (50 objects; at most 4 written whole)
    { tag: 'suaar-objects', group: 'scene', iface: I.ObjectListSuAAR, field: 'suAARObjectList', flags: 'b', kind: 'list', recEntries: 4,
      sum: { count: 'numberOfObjects', len: { objects: 'objectList' }, ids: 'objectList[].objectID', rng: { x: 'objectList[].objectPosition.x', y: 'objectList[].objectPosition.y' } } },
    // ---- the camera's own object lists (to compare the road scene with) ----
    { tag: 'cam-objects', group: 'objects', iface: I.ObjectsFrontCamera, field: 'ObjectRecognition', flags: 'b', kind: 'list',
      sum: { count: 'numberOfObjects', ids: 'objectRecognitionInfo[].objectID', cls: { type: 'objectRecognitionInfo[].classificationType' } } },
    { tag: 'cam2-objects', group: 'objects', iface: I.ObjectsFrontCamera2, field: 'ObjectRecognition', flags: 'b', kind: 'list',
      sum: { count: 'numberOfObjects', ids: 'objectRecognitionInfo[].objectID', cls: { type: 'objectRecognitionInfo[].classificationType' } } },
    // ---- the camera's state: blocked, weather, day / night ----
    { tag: 'blockage', group: 'camera', iface: I.Blockage, field: 'blockageAndWeatherFrontcameraMain', flags: 'b', kind: 'full' },
    // ---- context: speed (km/h x 1/64, the kit's scale), gear, brake light, indicator, the stalk (TRIP = a mark) ----
    { tag: 'car-speed2', group: 'context', iface: I.Vehicle2, field: 'statusCarSpeed2', flags: 'rs', kind: 'full' },
    { tag: 'gearbox-status', group: 'context', iface: I.VehicleInformation, field: 'statusGearboxDrive', flags: 's', kind: 'full' },
    { tag: 'brake-light', group: 'context', iface: I.Light, field: 'LampExterior', flags: 's', kind: 'full' },
    { tag: 'indicate', group: 'context', iface: I.CDS2, field: 'statusIndicate', flags: 'rs', kind: 'full' },
    { tag: 'stalk', group: 'context', iface: I.Light, field: 'IndicatorSteeringColumn', flags: 's', kind: 'full', trip: { path: 'operationColumnStalks', mask: 0x40, unfilled: 255 } },
];

/** The distinct interfaces with what each declares (one instance, "1", for all of them). */
function interfaces() {
    const m = {};
    TABLE.forEach((f) => {
        const e = m[f.iface] = m[f.iface] || { iface: f.iface, fields: {}, events: [] };
        if (f.flags === 'b') { if (e.events.indexOf(f.field) < 0) e.events.push(f.field); } else e.fields[f.field] = f.flags;
    });
    return Object.keys(m).map((k) => m[k]);
}
/** The "signals" block of app.json that this table needs. */
function manifestSignals() {
    const out = {};
    interfaces().forEach((e) => {
        const o = { _instances: '1' };
        Object.keys(e.fields).sort().forEach((k) => { o[k] = e.fields[k]; });
        if (e.events.length) o._broadcasts = e.events.slice().sort();
        out[e.iface] = o;
    });
    return out;
}

module.exports = { I, SET, TABLE, interfaces, manifestSignals };
