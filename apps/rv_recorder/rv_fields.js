'use strict';
/**
 * rv_fields.js - the RV recorder's source table. ONE table drives the subscriptions, the recording, the summaries, the manifest
 * ("signals" of app.json, checked by bench/test-signal-rv.js and `node tools/road-view/rv_manifest.js check`) and
 * design/car/rv_fields.json.
 *
 * The recording choices (one per drive; the menu's "Набір для запису" row picks it, settings key recSet):
 *   S19 "RV"      road view (round "Road View", docs/traffic/BRIEF-TS-signals.md): the traffic light, the signs, the display feeds,
 *                 the road scene and the environment model, the context;
 *   S20 "CAM"     (fixes-1121 CR, the owner's "камери, світлофори ...") everything the front camera publishes that our apps or
 *                 reports name: the object lists, the lanes (four interfaces), the signs, the traffic light, the high-beam light
 *                 objects and verdict, blockage and weather, the environment model's lists, the assisted-driving-view inputs, the
 *                 rear radars' lane-change ids, Road Scene's path sources, the context;
 *   S21 "CRUISE"  the cruise and limiter state and the driver's use of it: the display feeds, the multimodal service's availability
 *                 (does a unit answer 13203), the speed-limit-assist and cruise settings (notifier only), FASuS's displays and
 *                 foresight, the vehicle ahead, the pedal and the brake, the context (the cruise keys are on no interface: CC-REPORT R6);
 *   S22 "NAV"     the route's metrics, nothing personal: distance and time to the destination and to the next manoeuvre, the
 *                 manoeuvre type, the road class and the map's flags, the route's limits and the foresight, the lane guidance, the
 *                 guidance state and provider (BMW navigation or CarPlay), the context.
 * Why a separate app: Signal Probe declares 106 interfaces (the most an app was seen running with on the car is 88); this one
 * declares only these sets' interfaces and reuses Signal Probe's recorder and formatter from shared/ (signal_recorder.js,
 * signal_format.js). Only the chosen set's interfaces are subscribed, at its first recording.
 *
 * READ ONLY: "b" an EVENT (declared under "_broadcasts"), "s" a notifier, "rs" a notifier with a NON-ZERO getter id (checked against
 * the catalogue by the test). Never "w", never a method (Signal Probe's S16 keeps the one approved method, queryContent), never
 * settingTrafficlightBraking / settingTrafficlightDriveOff, never a navigation position, destination, road name or coordinate.
 *
 * An entry:
 *   tag, iface, field, flags   the source; flags "b" | "s" | "rs"
 *   sets                       the recording choices it belongs to (default ['S19'])
 *   instance                   the interface instance (default "1"; the guidance interfaces are "Main_Instance")
 *   group                      light | signs | function | display | warning | settings | scene | model | objects | lanes | beam | camera
 *                              | motion | cruise | nav | context
 *   kind                       "full": every message goes to the recording, unthrottled (small or rare sources);
 *                              "list": the first message of a recording whole, then ONE summary line a second (summary below), and
 *                              the next message whole after each mark (the passenger's "now")
 *   pick                       NAV: { name: path } - ONLY these members are kept, everything else is dropped before the recording and
 *                              the log see the value (an allow-list: a destination's position, a road name, an id never pass). Paths:
 *                              "a.b" a member, "a.0.b" an entry of a list, "a.*.b" the first member that is there (a union), "" the
 *                              value itself, "a#n" a list's length, "a.[].b#mask" a list of bools as a bit mask, "@a" the name of the
 *                              union member a holds. A text becomes its length; a struct or a list is never kept whole
 *   skip                       member names never written or logged (the car's own position and heading on the road output; the
 *                              sign location floats, privacy first)
 *   recEntries                 a list keeps at most this many entries in a recording (the recorder's own cap is 16)
 *   everyMs                    a heavy "full" source writes at most one message every everyMs (the first after a mark always; the rest
 *                              counted): the lanes at 5 Hz, the chassis' curvature at 10 Hz
 *   recSame                    ms: a sample with the same values as the source's last written line, less than this after it, is folded
 *                              (shared/signal_recorder.js; beam HS's light objects)
 *   sum                        what a list source's summary line holds (paths into the message; "a[].b" = member b of every entry
 *                              of the list a): count (the message's own object count, max of the second), ids (distinct ids, the
 *                              first 6 sorted), cls { name: path } (distinct values, the first 6), rng { name: path } (min / max),
 *                              len { name: path } (a list's length, max of the second). Every list source also counts its messages
 *                              and the distinct eventDataQualifier values.
 *   log                        while recording, a CHANGE of these members (paths "a.b"; true = the whole value) is also one log line
 *                              ("change <tag> t=..: ..."), at most LOG_CAP lines a source
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
    // fixes-1121 CR: CAM - the lanes, the camera's own object list, its light objects and weather; Road Scene's path sources
    LaneBoundaries: 'de.bmw.environmentalmodel.LaneBoundaries',
    LaneBoundariesLegacy: 'de.bmw.environmentalmodel.LaneBoundariesLegacy',
    LaneBoundariesLegacy2: 'de.bmw.environmentalmodel.LaneBoundariesLegacy2',
    Lanes: 'de.bmw.environmentalmodel.Lanes',
    ObjectlistTCP: 'de.bmw.sensors.objects.RecogFrontCameraObjectlist',
    RecogLight: 'de.bmw.sensors.objects.RecogFrontCameraLightDetection',
    Weather: 'de.bmw.environmentalmodel.environmentalconditions.Weather',
    CentralOdometry: 'de.bmw.chassis.CentralOdometryProvision',
    XView: 'de.bmw.infotainment.drivingexcitement.XView',
    // fixes-1121 CR: the context every choice records (the gaps of the lead's comparison, 2026-11-21)
    VehicleCondition: 'de.bmw.infrastructure.VehicleCondition',
    CDS: 'de.bmw.infotainment.vehicle.CDS',
    Vehicle: 'de.bmw.infotainment.vehicle.Vehicle',
    EnvironmentalInformation: 'de.bmw.infrastructure.EnvironmentalInformation',
    // fixes-1121 CR: CRUISE
    Multimodal: 'de.bmw.dass.driverassistanceapplications.MultimodalControlDriverAssistance',
    GapVehicleAhead: 'de.bmw.dass.GapVehicleAhead',
    AcceleratorPedal: 'de.bmw.powertrain.AcceleratorPedal',
    VehicleStabilization: 'de.bmw.chassis.VehicleStabilizationManagement',
    Powertrain: 'de.bmw.powertrain.Powertrain',
    // fixes-1121 CR: NAV (read only; an allow-list of members per source: `pick`)
    NavigationStatus: 'de.bmw.infotainment.navigation.navigationstatus.NavigationStatus',
    Guidance: 'de.bmw.infotainment.navigation.guiding.Guidance',
    ProjectedModeGuiding: 'de.bmw.infotainment.navigation.projectedmodeguiding.ProjectedModeGuiding',
    LaneGuiding: 'de.bmw.infotainment.LaneGuiding',
    NavigationCAN: 'de.bmw.infotainment.navigation.NavigationCAN',
    CCP: 'de.bmw.infotainment.navigation.externalize.adasng.CCP',
};

const SETS = [
    { id: 'S19', label: 'RV', name: 'road view' },
    { id: 'S20', label: 'CAM', name: 'camera, lanes, light, objects' },
    { id: 'S21', label: 'CRUISE', name: 'cruise and limiter' },
    { id: 'S22', label: 'NAV', name: 'route metrics' },
];
const SET = SETS[0];               // road TS: the first choice, S19 (the TS protocol's drive)
const RV = 'S19', CAM = 'S20', CRUISE = 'S21', NAV = 'S22';
const ALL = [RV, CAM, CRUISE, NAV];
const MI = 'Main_Instance';

// the guidance's distance to a manoeuvre / waypoint, its time, its kind: the members NAV keeps of a union "maneuver.*"
const MANEUVER = { kind: '@maneuver', toDest: 'maneuver.*.distanceToDestination', dist: 'maneuver.*.formattedDistance.rawDistance', distUnit: 'maneuver.*.formattedDistance.unit',
    distLen: 'maneuver.*.formattedDistance.distance', time: 'maneuver.*.travelTime', delay: 'maneuver.*.travelTimeDelay', step: 'maneuver.*.guidingStep',
    type: 'maneuver.*.combinedManeuverType', restriction: 'maneuver.*.maneuverRestriction', direction: 'maneuver.*.direction', geometry: 'maneuver.*.detailedGeometry',
    branch: 'maneuver.*.branchType', unreliable: 'maneuver.*.unreliable', limit: 'maneuver.*.speedLimitAssistInfo.value.reason.speedLimitInfo.speedLimit',
    limitUnit: 'maneuver.*.speedLimitAssistInfo.value.reason.speedLimitInfo.speedUnit', limitSuggestion: 'maneuver.*.speedLimitAssistInfo.value.suggestionType' };
// a destination's metrics (nextDestinationInfo, ProjectedModeGuiding.waypoints): never its position, its direction or its id
const DESTINATION = { travel: 'travelTime', delay: 'delayTime', delayStatus: 'delayStatus', dist: 'formattedDistance.rawDistance', distUnit: 'formattedDistance.unit',
    distLen: 'formattedDistance.distance', toFinal: 'distanceFromCurrentToFinalDestination', flag: 'isCheckeredFlag', stopover: 'stopOverNumber', charging: 'isChargingStation',
    etaInvalid: 'estimatedArrivalTime.time.invalid', etaH: 'estimatedArrivalTime.time.hour', etaM: 'estimatedArrivalTime.time.minute' };
const LANES = { rows: 'rows#n', carLane: 'carPositionLaneIndex', lanes: 'rows.0.lanes#n', highlighted: 'rows.0.lanes.[].isHighlighted#mask', recommended: 'rows.0.recommendedCarPositionLaneIndex',
    toDest: 'rows.0.distanceToDestination', rowLength: 'rows.0.length', progress: 'rows.0.bargraphProgress', follow0: 'rows.0.lanes.0.directionToFollow', follow1: 'rows.0.lanes.1.directionToFollow',
    follow2: 'rows.0.lanes.2.directionToFollow', follow3: 'rows.0.lanes.3.directionToFollow', unreliable: 'rows.0.unreliable' };

const TABLE = [
    // ---- the traffic light: one light per message (nine UInt8, no enum table in the catalogue): every message, raw ----
    { tag: 'tl', sets: [RV, CAM], group: 'light', iface: I.TrafficLight, field: 'RecognitionTrafficLightCamera', flags: 'b', kind: 'full' },
    // ---- the camera's sign streams (79 sign types): every message; at most 8 signs of the 20 slots; the location floats never ----
    { tag: 'cam-signs', sets: [RV, CAM], group: 'signs', iface: I.SignCamera, field: 'TrafficSignRecognitionFrontCamera', flags: 'b', kind: 'full', recEntries: 8, skip: ['location'] },
    { tag: 'cam-legacy', sets: [RV, CAM], group: 'signs', iface: I.SignCameraLegacy, field: 'RecognitionTrafficSignCamera', flags: 'b', kind: 'full' },
    { tag: 'cam-legacy2', sets: [RV, CAM], group: 'signs', iface: I.SignCameraLegacy, field: 'recognitionTrafficSignCamera2', flags: 'b', kind: 'full', recEntries: 8, skip: ['location'] },
    // ---- the sign function (the source of the limit both themes draw): every output, every message ----
    { tag: 'tsr', sets: [RV, CAM, CRUISE, NAV], group: 'function', iface: I.TrafficSignRecognition, field: 'TrafficSignRecognition', flags: 'b', kind: 'full',
      log: ['presentClassLimitSpeed', 'recognitionNoPassing', 'countryCodingTrafficSign', 'displaySupplementalSign', 'statusStreetTyp'] },
    // ---- the display feeds: DisplayDataServer's vSLISymbol / vSLISpeedValue / vSLIDistanceValues and the cruise's own values, and
    //      DisplayDataServer2's vsliSign (the 30 values with TRAFFIC_LIGHT_*), vsliValue, ldmSetSpeed: the whole value every message ----
    { tag: 'hud-data', sets: [RV, CRUISE], group: 'display', iface: I.DisplayDataServer, field: 'functionalLibraryData', flags: 'rs', kind: 'full',
      log: ['activeCruiseControl.symbolACC', 'statusLimiter', 'ldmSym', 'cruiseCtrlSpeedHUD'] },
    { tag: 'hud-data2', sets: [RV, CRUISE], group: 'display', iface: I.DisplayDataServer2, field: 'functionalLibraryData', flags: 'rs', kind: 'full',
      log: ['xSpeedLimitAssist.vsliSign', 'xSpeedLimitAssist.vsliValue', 'xSpeedLimitAssist.sliValue', 'npiData.npiState', 'npiData.npiLabel', 'warnBrakeCoordinator.wbkSym', 'warnBrakeCoordinator.wbkMode',
          'ldmSetSpeed.ldmSetSpeedValue', 'ldmIconId', 'ldmIconState'] },
    // ---- FASuS, read only: the display-symbol request (RequestDisplaySymbol: AMPEL, STOP_SCHILD, ...), the functions' states
    //      (StatusTrafficLightAssistance, ...), the foresight, the sign texts and the next limit / no passing ----
    { tag: 'warn-brake', sets: [RV, CRUISE], group: 'warning', iface: I.FASuS, field: 'requestWarnBrakeCoordinatorDisplay', flags: 'rs', kind: 'full', log: ['requestDisplaySymbol', 'requestSymbolAttribute'] },
    { tag: 'fas-ext', sets: [RV, CAM, CRUISE], group: 'warning', iface: I.FASuS, field: 'statusIDriveFASExtended', flags: 'rs', kind: 'full', log: true },
    { tag: 'foresight2', sets: [RV, CRUISE, NAV], group: 'warning', iface: I.FASuS, field: 'displayForesight2', flags: 'rs', kind: 'full', log: true },
    // TR D.4: the ACC foresight display (notifier only: no getter); with TrafficSignDisplayControl's twin never up on this car
    { tag: 'foresight', sets: [RV, CRUISE, NAV], group: 'warning', iface: I.DisplayForesight, field: 'displayForesight', flags: 's', kind: 'full', log: ['dispForesightEvent', 'suppressionTrafficLightPrediction', 'dispTakeOverRequestReason'] },
    // TR D.4: the assistance settings' notifiers ONLY (each has a setter; never declared w). settingTrafficlightBraking and
    // settingTrafficlightDriveOff are NOT read at all (the round's rule): their availability stays unknown
    { tag: 'set-stop-sign', group: 'settings', iface: I.SettingsDriverAssistance, field: 'settingStopSignBraking', flags: 's', kind: 'full', log: true },
    { tag: 'set-give-way', group: 'settings', iface: I.SettingsDriverAssistance, field: 'settingGiveWayWarning', flags: 's', kind: 'full', log: true },
    { tag: 'give-way-status', group: 'settings', iface: I.SettingsDriverAssistance, field: 'displayStatusGiveWayWarning', flags: 's', kind: 'full', log: true },
    { tag: 'set-wrong-way', group: 'settings', iface: I.SettingsDriverAssistance, field: 'settingWrongWayAssistant', flags: 's', kind: 'full', log: true },
    { tag: 'sli-text', sets: [RV, CRUISE], group: 'function', iface: I.FASuS, field: 'statusSLITextMessage', flags: 'rs', kind: 'full' },
    { tag: 'next-limit', sets: [RV, CRUISE, NAV], group: 'function', iface: I.FASuS, field: 'statusNextSpeedLimitRecognition', flags: 'rs', kind: 'full' },
    { tag: 'no-passing', group: 'function', iface: I.FASuS, field: 'statusOvertakeRecognition', flags: 'rs', kind: 'full' },
    // ---- the road scene the maker draws: the first message whole, then one summary line a second ----
    { tag: 'view-input', sets: [RV, CAM], group: 'scene', iface: I.ViewInput, field: 'assistedDrivingViewFunctionInputIbVip', flags: 'b', kind: 'list',
      sum: { ids: 'assistedDrivingViewACCTargetObjectId', cls: { xcc: 'assistedDrivingViewStateXcc', sld: 'assistedDrivingViewDispSLD' } } },
    // TR: the rear radars' lane-change warning, three object ids a side: every message (27 small members)
    { tag: 'lca-input', sets: [RV, CAM], group: 'scene', iface: I.ViewLca, field: 'assistedDrivingViewLcaInput', flags: 'b', kind: 'full',
      log: ['statusLaneChangeWarning.statusLaneChangeWarningLeft', 'statusLaneChangeWarning.statusLaneChangeWarningRight', 'statusLaneDepartureWarning.directionLaneDepartureWarning'] },
    { tag: 'lateral-input', sets: [RV, CAM], group: 'scene', iface: I.ViewLateral, field: 'lateralFunctionInputAssistedDrivingView', flags: 'b', kind: 'list',
      sum: { cls: { lsa: 'lsaFunctionStates.lsaState', swa: 'swaFunctionStates.swaState', alg: 'algFunctionStates.algState' } } },
    { tag: 'road-segment', sets: [RV, CAM], group: 'scene', iface: I.RoadOutput, field: 'roadSegmentUpdate', flags: 'b', kind: 'list', recEntries: 4,
      sum: { len: { segments: 'data.laneSegments', boundaries: 'data.laneBoundaries' }, cls: { lane: 'data.laneSegments[].laneType', road: 'data.laneSegments[].roadType' },
          rng: { egoIdx: 'data.egoVehicleLaneSegmentIndex' } } },
    { tag: 'ego-position', sets: [RV, CAM], group: 'scene', iface: I.RoadOutput, field: 'egoVehiclePositionUpdate', flags: 'b', kind: 'list', skip: ['posX', 'posY', 'heading'],
      sum: { cls: { q: 'eventDataQualifier' } } },
    // ---- the environment model's lists ----
    { tag: 'merged-objects', sets: [RV, CAM], group: 'model', iface: I.DAADataServer, field: 'ObjectListMerged', flags: 'b', kind: 'list',
      sum: { len: { objects: 'objectListMergedArrayInfo' }, ids: 'objectListMergedArrayInfo[].objId', cls: { type: 'objectListMergedArrayInfo[].objType' }, rng: { range: 'objectListMergedArrayInfo[].objRange' } } },
    { tag: 'object-info1', sets: [RV, CAM], group: 'model', iface: I.DAADataServer, field: 'ObjectInformation1', flags: 'b', kind: 'list',
      sum: { count: 'objectRecognition.numberOfObjects', ids: 'objectRecognition.objectRecognitionInfo[].objectID', cls: { type: 'objectRecognition.objectRecognitionInfo[].classificationType' },
          rng: { x: 'objectPosition.objectPositionInfo[].positionX', y: 'objectPosition.objectPositionInfo[].positionY' } } },
    { tag: 'object-info2', sets: [RV, CAM], group: 'model', iface: I.DAADataServer, field: 'ObjectInformation2', flags: 'b', kind: 'list',
      sum: { count: 'numberOfObjects', rng: { vx: 'objectMovementInfo[].speedAbsoluteX' } } },
    { tag: 'object-lanes', sets: [RV, CAM], group: 'model', iface: I.DAADataServer, field: 'ObjectAssignment', flags: 'b', kind: 'list',
      sum: { count: 'numberOfObjects', cls: { overall: 'overallAssignmentType', type: 'assignedObjectInfo[].assignmentType' } } },
    { tag: 'lane-info', sets: [RV, CAM], group: 'model', iface: I.DAADataServer, field: 'LaneInformation', flags: 'b', kind: 'list',
      sum: { cls: { left: 'leftLaneLaneTypeInfo.type', ego: 'egoLaneLaneTypeInfo.type', right: 'rightLaneLaneTypeInfo.type' } } },
    { tag: 'road-model', sets: [RV, CAM], group: 'model', iface: I.DAADataServer, field: 'RoadModel', flags: 'b', kind: 'list',
      sum: { rng: { egoWidth: 'egoLane.width' }, cls: { segs: 'egoLane.centerLine.numSegments' } } },
    { tag: 'fas-view', sets: [RV, CAM], group: 'model', iface: I.DAADataServer, field: 'FASView', flags: 'b', kind: 'list', sum: { len: { content: 'content' } } },
    // TR D.4: the fused object list the maker's road scene is drawn from (50 objects; at most 4 written whole)
    { tag: 'suaar-objects', sets: [RV, CAM], group: 'scene', iface: I.ObjectListSuAAR, field: 'suAARObjectList', flags: 'b', kind: 'list', recEntries: 4,
      sum: { count: 'numberOfObjects', len: { objects: 'objectList' }, ids: 'objectList[].objectID', rng: { x: 'objectList[].objectPosition.x', y: 'objectList[].objectPosition.y' } } },
    // ---- the camera's own object lists (to compare the road scene with) ----
    { tag: 'cam-objects', sets: [RV, CAM], group: 'objects', iface: I.ObjectsFrontCamera, field: 'ObjectRecognition', flags: 'b', kind: 'list',
      sum: { count: 'numberOfObjects', ids: 'objectRecognitionInfo[].objectID', cls: { type: 'objectRecognitionInfo[].classificationType' } } },
    { tag: 'cam2-objects', sets: [RV, CAM], group: 'objects', iface: I.ObjectsFrontCamera2, field: 'ObjectRecognition', flags: 'b', kind: 'list',
      sum: { count: 'numberOfObjects', ids: 'objectRecognitionInfo[].objectID', cls: { type: 'objectRecognitionInfo[].classificationType' } } },
    // ---- the camera's state: blocked, weather, day / night ----
    { tag: 'blockage', sets: [RV, CAM], group: 'camera', iface: I.Blockage, field: 'blockageAndWeatherFrontcameraMain', flags: 'b', kind: 'full' },
    // ---- context: speed (km/h x 1/64, the kit's scale), gear, brake light, indicator, the stalk (TRIP = a mark) ----
    { tag: 'car-speed2', sets: ALL, group: 'context', iface: I.Vehicle2, field: 'statusCarSpeed2', flags: 'rs', kind: 'full' },
    { tag: 'gearbox-status', sets: ALL, group: 'context', iface: I.VehicleInformation, field: 'statusGearboxDrive', flags: 's', kind: 'full' },
    { tag: 'brake-light', sets: ALL, group: 'context', iface: I.Light, field: 'LampExterior', flags: 's', kind: 'full' },
    { tag: 'indicate', sets: ALL, group: 'context', iface: I.CDS2, field: 'statusIndicate', flags: 'rs', kind: 'full' },
    { tag: 'stalk', sets: ALL, group: 'context', iface: I.Light, field: 'IndicatorSteeringColumn', flags: 's', kind: 'full', trip: { path: 'operationColumnStalks', mask: 0x40, unfilled: 255 } },

    // ==== fixes-1121 CR: the context of CAM, CRUISE and NAV (the lead's gaps and the owner's "anything else useful") ====
    { tag: 'condition', sets: [CAM, CRUISE, NAV], group: 'context', iface: I.VehicleCondition, field: 'VehicleCondition', flags: 's', kind: 'full', log: true },
    { tag: 'engine-status', sets: [CAM, CRUISE, NAV], group: 'context', iface: I.CDS, field: 'statusEngineStatus', flags: 'rs', kind: 'full', log: true },
    { tag: 'light-status', sets: [CAM, CRUISE, NAV], group: 'context', iface: I.Vehicle2, field: 'statusLightStatus', flags: 'rs', kind: 'full', log: true },
    { tag: 'lamps', sets: [CAM, CRUISE, NAV], group: 'context', iface: I.Light, field: 'LampExterior2', flags: 's', kind: 'full', log: ['controlFunctionMainBeam', 'controlFunctionDippedBeamLeftHand'] },
    { tag: 'day-night', sets: [CAM, CRUISE, NAV], group: 'context', iface: I.Vehicle, field: 'statusDayNightChangeOver', flags: 'rs', kind: 'full', log: ['dayNightChangeOver'] },
    { tag: 'outside-temp', sets: [CAM, CRUISE, NAV], group: 'context', iface: I.EnvironmentalInformation, field: 'ExteriorTemperature', flags: 's', kind: 'full' },

    // ==== CAM (S20): the lanes ====
    // LaneBoundaries: the four front boundaries Road Scene, f30_cluster and Twin Dial read (clothoids and their type), every message
    // (5 a second, the front boundaries and their properties; the rear ones and the deviations left out: 60 % of the camera's bytes else)
    { tag: 'lanes', sets: [CAM], group: 'lanes', iface: I.LaneBoundaries, field: 'LaneBoundaries', flags: 'b', kind: 'full', recEntries: 4, everyMs: 200,
      skip: ['laneBoundaryRear', 'laneBoundaryDeviationsFront', 'laneBoundaryDeviationsRear'] },
    { tag: 'lane-change', sets: [CAM], group: 'lanes', iface: I.LaneBoundaries, field: 'LaneChange', flags: 'b', kind: 'full' },
    { tag: 'lanes-detection', sets: [CAM], group: 'lanes', iface: I.Lanes, field: 'LanesDetection', flags: 'b', kind: 'list', sum: {} },
    { tag: 'lanes-change2', sets: [CAM], group: 'lanes', iface: I.Lanes, field: 'LaneChange', flags: 'b', kind: 'full' },
    { tag: 'lanes-vcurv', sets: [CAM], group: 'lanes', iface: I.Lanes, field: 'VerticalCurvatureEgoLane', flags: 'b', kind: 'list', sum: {} },
    { tag: 'lm-list', sets: [CAM], group: 'lanes', iface: I.LaneBoundariesLegacy, field: 'LaneList', flags: 'b', kind: 'list', sum: {} },
    { tag: 'lm-left', sets: [CAM], group: 'lanes', iface: I.LaneBoundariesLegacy, field: 'LaneMarkingEGOLeftHandGeometry', flags: 'b', kind: 'full' },
    { tag: 'lm-right', sets: [CAM], group: 'lanes', iface: I.LaneBoundariesLegacy, field: 'LaneMarkingEGORightHandGeometry', flags: 'b', kind: 'full' },
    { tag: 'lm2-list', sets: [CAM], group: 'lanes', iface: I.LaneBoundariesLegacy2, field: 'laneMarkingList', flags: 'b', kind: 'list', sum: {} },
    { tag: 'lm2-left', sets: [CAM], group: 'lanes', iface: I.LaneBoundariesLegacy2, field: 'laneMarkingEgoLeftHandGeometry', flags: 'b', kind: 'full' },
    { tag: 'lm2-right', sets: [CAM], group: 'lanes', iface: I.LaneBoundariesLegacy2, field: 'laneMarkingEgoRightHandGeometry', flags: 'b', kind: 'full' },
    // ==== CAM: the camera's objects with their positions, its own object list with the lamps per object (beam HS: 6 kept) ====
    { tag: 'cam-position', sets: [CAM], group: 'objects', iface: I.ObjectsFrontCamera, field: 'ObjectPosition', flags: 'b', kind: 'list',
      sum: { count: 'numberOfObjects', rng: { x: 'objectPositionInfo[].positionX', y: 'objectPositionInfo[].positionY' } } },
    { tag: 'cam2-position', sets: [CAM], group: 'objects', iface: I.ObjectsFrontCamera2, field: 'ObjectPosition', flags: 'b', kind: 'list',
      sum: { count: 'numberOfObjects', rng: { x: 'objectPositionInfo[].positionX', y: 'objectPositionInfo[].positionY' } } },
    { tag: 'objlist', sets: [CAM], group: 'objects', iface: I.ObjectlistTCP, field: 'objectlistTCP', flags: 'b', kind: 'list', recEntries: 6,
      skip: ['existence', 'x_std_dev', 'y_std_dev', 'z_std_dev', 'orientation_std_dev', 'covariance_xy', 'acceleration_absolute', 'shape'],
      sum: { count: 'numberOfObjects', len: { objects: 'objectListSmall' } } },
    // ==== CAM: the camera's high-beam verdict and its light objects (beam HS's S18 set: every message; an object repeating itself folded) ====
    { tag: 'hb-control', sets: [CAM], group: 'beam', iface: I.RecogLight, field: 'controlHighBeamAssistant', flags: 'b', kind: 'full', log: ['controlHighBeam', 'reasonSwitchOffHighBeam'] },
    { tag: 'hb-meid1', sets: [CAM], group: 'beam', iface: I.RecogLight, field: 'mEObjectID1', flags: 'b', kind: 'full', recSame: 1000 },
    { tag: 'hb-meid2', sets: [CAM], group: 'beam', iface: I.RecogLight, field: 'mEObjectID2', flags: 'b', kind: 'full', recSame: 1000 },
    { tag: 'weather', sets: [CAM], group: 'camera', iface: I.Weather, field: 'RecognitionWeather', flags: 's', kind: 'full', log: true },
    // ==== CAM: Road Scene's path sources (fixes-1121 AL): the chassis' curvature (an event), the road wheels' and the driver's steering
    //      angle, the head unit's yaw rate ====
    { tag: 'curvature', sets: [CAM], group: 'motion', iface: I.CentralOdometry, field: 'curvatureAndSlipSideAngle', flags: 'b', kind: 'full', everyMs: 100 },
    { tag: 'steer-axle', sets: [CAM], group: 'motion', iface: I.XView, field: 'statusFrontAxleSteeringAngle', flags: 'rs', kind: 'full' },
    { tag: 'steering', sets: [CAM, CRUISE], group: 'motion', iface: I.XView, field: 'statusSteeringAngleDriver', flags: 'rs', kind: 'full' },
    { tag: 'yaw-hu', sets: [CAM], group: 'motion', iface: I.CDS2, field: 'statusYawVelocityVehicle', flags: 'rs', kind: 'full' },

    // ==== CRUISE (S21): does a unit answer the multimodal service, the settings (notifier only: getter id 0), BMW's SET offer ====
    { tag: 'assist-avail', sets: [CRUISE], group: 'cruise', iface: I.Multimodal, field: 'functionAvailabilityDriverAssistance', flags: 'rs', kind: 'full', log: true },
    { tag: 'set-sla', sets: [CRUISE], group: 'cruise', iface: I.SettingsDriverAssistance, field: 'settingSpeedLimitAssist', flags: 's', kind: 'full', log: true },
    { tag: 'set-dcc', sets: [CRUISE], group: 'cruise', iface: I.SettingsDriverAssistance, field: 'settingDCC', flags: 's', kind: 'full', log: true },
    { tag: 'set-offset', sets: [CRUISE], group: 'cruise', iface: I.SettingsDriverAssistance, field: 'settingOffsetSpeed', flags: 's', kind: 'full', log: true },
    { tag: 'sla-country', sets: [CRUISE], group: 'cruise', iface: I.SettingsDriverAssistance, field: 'displayStatusSpeedLimitAssist', flags: 's', kind: 'full', log: true },
    { tag: 'fas-foresight', sets: [CRUISE], group: 'cruise', iface: I.FASuS, field: 'displayForesight', flags: 's', kind: 'full',
      log: ['displayOperationTakeOverSuggestionSpeed2', 'displayTakeOverSuggestionSpeed', 'statusISA', 'displaySpeedForesight'] },
    { tag: 'ldm-guidance', sets: [CRUISE], group: 'cruise', iface: I.FASuS, field: 'displayDriverAssistenceSystemLongitudinalGuidance', flags: 's', kind: 'full',
      log: ['activeFunctionDriverAssistenceSystemLDM', 'valueRequestSpeed', 'statusISA2'] },
    { tag: 'status-fas', sets: [CRUISE], group: 'cruise', iface: I.FASuS, field: 'statusFAS', flags: 's', kind: 'full' },
    { tag: 'front-vehicle', sets: [CRUISE], group: 'cruise', iface: I.GapVehicleAhead, field: 'DataFrontVehicle', flags: 's', kind: 'full' },
    // the driver's pedal and brake (an override, a cancel)
    { tag: 'accel-pedal', sets: [CRUISE], group: 'cruise', iface: I.AcceleratorPedal, field: 'AngleAcceleratorPedal', flags: 's', kind: 'full' },
    { tag: 'brake-driver', sets: [CRUISE], group: 'cruise', iface: I.VehicleStabilization, field: 'StabilizationManagement', flags: 's', kind: 'full' },
    { tag: 'brake-switch', sets: [CRUISE], group: 'cruise', iface: I.Powertrain, field: 'InformationVehicleDrive', flags: 's', kind: 'full' },
    { tag: 'drive-torque', sets: [CRUISE], group: 'cruise', iface: I.Powertrain, field: 'WheelMomentDrive4', flags: 's', kind: 'full' },

    // ==== NAV (S22): route metrics; every source an allow-list of members (`pick`), texts as lengths, never a position ====
    { tag: 'guiding-state', sets: [NAV], group: 'nav', iface: I.NavigationStatus, field: 'guidingState', flags: 'rs', kind: 'full', pick: { state: '' }, log: true },
    { tag: 'guidance-state', sets: [NAV], group: 'nav', iface: I.Guidance, instance: MI, field: 'guidanceState', flags: 'rs', kind: 'full', pick: { state: '' }, log: true },
    { tag: 'guiding-provider', sets: [NAV], group: 'nav', iface: I.Guidance, instance: MI, field: 'guidingProvider', flags: 'rs', kind: 'full', pick: { provider: '' }, log: true },
    { tag: 'on-guidable-road', sets: [NAV], group: 'nav', iface: I.Guidance, instance: MI, field: 'isOnGuidableRoad', flags: 'rs', kind: 'full', pick: { on: '' } },
    { tag: 'next-intersection', sets: [NAV], group: 'nav', iface: I.Guidance, instance: MI, field: 'nextIntersection', flags: 'rs', kind: 'full',
      pick: { elements: 'intersection.elements#n', dist: 'distance.rawDistance', distUnit: 'distance.unit', distLen: 'distance.distance' } },
    { tag: 'dart', sets: [NAV], group: 'nav', iface: I.Guidance, instance: MI, field: 'conclusiveDart', flags: 'rs', kind: 'full', pick: MANEUVER, log: ['kind', 'type', 'direction'] },
    { tag: 'next-destination', sets: [NAV], group: 'nav', iface: I.Guidance, instance: MI, field: 'nextDestinationInfo', flags: 'rs', kind: 'full', pick: DESTINATION },
    { tag: 'lane-guidance', sets: [NAV], group: 'nav', iface: I.Guidance, instance: MI, field: 'currentLaneGuiding', flags: 'rs', kind: 'full', pick: LANES },
    { tag: 'road', sets: [NAV], group: 'nav', iface: I.Guidance, instance: MI, field: 'currentRoad', flags: 'rs', kind: 'full', pick: { elements: 'elements#n', firstLen: 'elements.0.text' } },
    { tag: 'travelled-dist', sets: [NAV], group: 'nav', iface: I.Guidance, instance: MI, field: 'travelledDistance', flags: 'rs', kind: 'full', pick: { dist: 'rawDistance', unit: 'unit' } },
    { tag: 'travelled-time', sets: [NAV], group: 'nav', iface: I.Guidance, instance: MI, field: 'travelledTime', flags: 'rs', kind: 'full', pick: { time: '' } },
    // CarPlay's route as BMW's guidance service sees it (the projected mode): the waypoint's metrics, the lanes, a route change
    { tag: 'pm-waypoints', sets: [NAV], group: 'nav', iface: I.ProjectedModeGuiding, instance: MI, field: 'waypoints', flags: 'rs', kind: 'full', pick: DESTINATION },
    { tag: 'pm-lanes', sets: [NAV], group: 'nav', iface: I.ProjectedModeGuiding, instance: MI, field: 'currentLaneGuiding', flags: 'rs', kind: 'full', pick: LANES },
    { tag: 'pm-route-change', sets: [NAV], group: 'nav', iface: I.ProjectedModeGuiding, instance: MI, field: 'activeRouteChange', flags: 'rs', kind: 'full', pick: { change: '' }, log: true },
    { tag: 'pm-road', sets: [NAV], group: 'nav', iface: I.ProjectedModeGuiding, instance: MI, field: 'currentRoad', flags: 'rs', kind: 'full', pick: { elements: 'elements#n', firstLen: 'elements.0.text' } },
    // the cluster's lane and manoeuvre feed, and the old CAN feed (distance and arrival time)
    { tag: 'kombi-lanes', sets: [NAV], group: 'nav', iface: I.LaneGuiding, field: 'laneGuiding', flags: 'rs', kind: 'full' },
    { tag: 'kombi-lanes-ext', sets: [NAV], group: 'nav', iface: I.LaneGuiding, field: 'extendedLaneGuiding', flags: 'rs', kind: 'full' },
    { tag: 'nav-can', sets: [NAV], group: 'nav', iface: I.NavigationCAN, field: 'calculationDataNavigation', flags: 'rs', kind: 'full' },
    // the map's attributes of the road we are on (the horizon's own events; never the country, never a position)
    { tag: 'ccp-limit', sets: [NAV], group: 'nav', iface: I.CCP, field: 'effectiveSpeedLimit', flags: 'b', kind: 'full', log: true },
    { tag: 'ccp-unit', sets: [NAV], group: 'nav', iface: I.CCP, field: 'speedLimitUnit', flags: 'b', kind: 'full' },
    { tag: 'ccp-variable', sets: [NAV], group: 'nav', iface: I.CCP, field: 'variableSpeedLimitSign', flags: 'b', kind: 'full' },
    { tag: 'ccp-road', sets: [NAV], group: 'nav', iface: I.CCP, field: 'roadClass', flags: 'b', kind: 'full', log: true },
    { tag: 'ccp-lanes', sets: [NAV], group: 'nav', iface: I.CCP, field: 'laneNumber', flags: 'b', kind: 'full' },
    { tag: 'ccp-ramp', sets: [NAV], group: 'nav', iface: I.CCP, field: 'rampFlag', flags: 'b', kind: 'full' },
    { tag: 'ccp-roundabout', sets: [NAV], group: 'nav', iface: I.CCP, field: 'roundaboutFlag', flags: 'b', kind: 'full' },
    { tag: 'ccp-urban', sets: [NAV], group: 'nav', iface: I.CCP, field: 'urbanFlag', flags: 'b', kind: 'full' },
    { tag: 'ccp-builtup', sets: [NAV], group: 'nav', iface: I.CCP, field: 'builtupAreaFlag', flags: 'b', kind: 'full' },
    { tag: 'ccp-side', sets: [NAV], group: 'nav', iface: I.CCP, field: 'trafficSide', flags: 'b', kind: 'full' },
];
// beam HS: the camera's 15 light objects, one event each (three of the names start with a capital M in the catalogue: 11, 12, 15):
// every message, an object that repeats itself folded (recSame)
const HB_OBJECT_EVENT = (n) => (n === 11 || n === 12 || n === 15 ? 'M' : 'm') + 'ainBeamAssistantDataObject' + n;
for (let n = 1; n <= 15; n++) TABLE.push({ tag: 'hb-obj' + n, sets: [CAM], group: 'beam', iface: I.RecogLight, field: HB_OBJECT_EVENT(n), flags: 'b', kind: 'full', recSame: 1000 });
TABLE.forEach((f) => { if (!f.sets) f.sets = [RV]; });

const instOf = (f) => f.instance || '1';
const setOf = (id) => SETS.find((s) => s.id === id) || null;
/** The sources of one recording choice. */
const sourcesOf = (id) => TABLE.filter((f) => f.sets.indexOf(id) >= 0);

/** The distinct interfaces with what each declares and the instances it is read on (of one set, or of all). */
function interfaces(setId) {
    const m = {};
    TABLE.filter((f) => !setId || f.sets.indexOf(setId) >= 0).forEach((f) => {
        const e = m[f.iface] = m[f.iface] || { iface: f.iface, instances: [], fields: {}, events: [] };
        if (e.instances.indexOf(instOf(f)) < 0) e.instances.push(instOf(f));
        if (f.flags === 'b') { if (e.events.indexOf(f.field) < 0) e.events.push(f.field); } else e.fields[f.field] = f.flags;
    });
    return Object.keys(m).map((k) => m[k]);
}
/** The "signals" block of app.json that this table needs ("*" where an interface is read on several instances). */
function manifestSignals() {
    const out = {};
    interfaces().forEach((e) => {
        const o = { _instances: e.instances.length > 1 ? '*' : e.instances[0] };
        Object.keys(e.fields).sort().forEach((k) => { o[k] = e.fields[k]; });
        if (e.events.length) o._broadcasts = e.events.slice().sort();
        out[e.iface] = o;
    });
    return out;
}

module.exports = { I, SET, SETS, TABLE, ALL, instOf, setOf, sourcesOf, interfaces, manifestSignals, HB_OBJECT_EVENT };
