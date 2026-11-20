'use strict';
/**
 * fields.js - the signal probe's field table: every field the car session reads, with its set, its item (P1..P17), the
 * instance it is read on, its flags, and how its value becomes a log line. ONE table drives the subscriptions, the log lines,
 * the manifest ("signals" of app.json, checked against it by bench/test-signal-probe.js) and design/car/probe_fields.json.
 *
 * Unified from the five round-3 branches (twin-r3/sm, sp, sn, sv, sb) on top of main's shared/twin_probe.js and renumbered to
 * the car-signals brief's P1..P17 / sets S1..S9 (docs/car/CP-REPORT.md section 3). READ ONLY: flags r (a NON-ZERO getter id) and
 * s (a notifier) - never w; events only in S13..S16; ONE method, a read the owner approved (2026-11-19, car issues CT):
 * GuidanceEventList.queryContent, polled by shared/carplay_turns.js (flags "m"); no KombiIF standardCCMessage / extendedCCMessage /
 * newCCMessage, no A19B, no requestDefaultSymbols, no setter of any kind.
 *
 * An entry:
 *   set, p, tag      the set (S1..S9), the item (P1..P17), the field's tag in the log line ("probe: P3 range-tank #2 ...")
 *   also             [set ids]: the field is also read while one of these sets is on (S10 needs eight fields of S6 / S7)
 *   iface, field     the interface and the field; flags "r" / "s" / "rs" as the catalogue allows (checked by the test), or "b": an EVENT,
 *                    declared under "_broadcasts" (S13..S16: the lead's decision of 2026-11-18, the owner's requests of 2026-11-19), or
 *                    "m": a METHOD polled for its reply (declared under "_methods"; only S16's queryContent, car issues CT: the owner's
 *                    approval of 2026-11-19; shared/carplay_turns.js makes the call, only while the phone guides)
 *   one              [member, kind]: an event with one output, handed over as { member: v } or as v itself
 *   instance         the instance it is read on (default "1"); an interface with several instances is declared "*" in the manifest
 *   gapMs, cap       minimum ms between two lines of this field (the last value wins, "+k folded") and the most lines; per-set defaults below
 *   pollMs           re-read its getter this often (TPMS: BMW's own app only ever reads it)
 *   mark             the line also says how long after the last "Позначка" press the change came (S6)
 *   cols             [[label, path, kind], ...]: kinds n number, e enum name, b bool, x hex, t text LENGTH, k coarse, z known/unknown, p present
 *   sub              { path, label, cols }: after the columns, the array at `path` as "label=N [..] [..]" (the trip computers' bcData[] per reset option)
 *   list / union     { member, cols }: an array of entries (member = the union member holding each) / a single-member union
 *   bits             { path, label }: a raw byte with its previous value and the bits that went up / down
 *   fmt              a named formatter of format.js (enum bool hex temps intersection dart lanes description mediaMenu station metadata
 *                    roles devices calllist cbs activeSource sources tree; S16: views rendered stream turns)
 *   recEntries       r1120 AC: in a recording, a list of this field keeps at most this many entries (the recorder's own cap is 16)
 *   recEntriesBy     beam HS: { set: n }: the same, only while that set is recorded (S18 keeps 4 camera objects where S17 keeps 8)
 *   recSame          beam HS: ms; in a recording, a sample with the same values as the field's last written line, less than this
 *                    after it, is folded (not written, counted: "#s" in the file); one line at least every recSame ms (recorder.js)
 *   recLog           beam HS: the field keeps its log lines while it is recorded (rare changes the log alone should show)
 *   slot             beam HS: the light object's slot (1..15) of a mainBeamAssistantDataObject event (fmt beamObj)
 *
 * r1120 AC: S17 "ACC" is the one recording set for the adaptive-cruise drives: its own field plus, through `also` (applied once at
 * the end of this file from ACC), every field of S14 and the ones of S10 / S11 / S13 / S15 an adaptive cruise needs.
 *
 * beam HS: S18 "HB" is the recording set for the night drives of the Auto Beam round (docs/highbeam/BRIEF-HS-signals.md): its own
 * fields (the camera's light objects and its own high-beam verdict, the lamps, the light switch, the brightness, the wipers) plus,
 * through `also` (applied once at the end of this file from HB), the stalk, the lamps of S14, the speed, yaw and steering, the gear,
 * the indicator, the outside temperature, the dimmer, the limit and the built-up flag, the vehicle ahead and the camera's object
 * lists cut to HB_ENTRIES objects. READ ONLY like every set: never RecogFrontCameraLightDetection.acknowledgeObjectData* (setters
 * without a getter: not declared at all), never a LightswitchOperation method or setter (its three fields are read with "rs").
 */
const I = {
    KombiIF: 'de.bmw.infotainment.KombiIF',
    Vehicle2: 'de.bmw.infotainment.vehicle.Vehicle2',
    KombiInterface_2: 'de.bmw.infotainment.KombiInterface_2',
    CheckControlMaster: 'de.bmw.infotainment.checkcontrol.CheckControlMaster',
    VehicleInformation: 'de.bmw.infrastructure.VehicleInformation',
    MileageSupreme: 'de.bmw.infrastructure.MileageSupreme',
    SecureMileage: 'de.bmw.infrastructure.SecureMileage',
    ResetLogic3: 'de.bmw.infotainment.resetlogic.ResetLogic3',
    ResetLogic: 'de.bmw.infotainment.resetlogic.ResetLogic',
    ResetLogic2: 'de.bmw.infotainment.resetlogic.ResetLogic2',
    BcPersonal: 'de.bmw.infotainment.telematic.journeyhistory.BcPersonal',
    LSCDataSink: 'de.bmw.infotainment.lsc.LSCDataSink',
    EnvironmentalInformation: 'de.bmw.infrastructure.EnvironmentalInformation',
    Vehicle: 'de.bmw.infotainment.vehicle.Vehicle',
    CDS: 'de.bmw.infotainment.vehicle.CDS',
    DoorsWindowsRoofMirrors: 'de.bmw.body.DoorsWindowsRoofMirrors',
    A4A: 'de.bmw.infotainment.vehicle.A4A',
    BasicDataSet: 'de.bmw.infrastructure.analytics.BasicDataSet',
    LevelMonitor: 'com.harman.infotainment.systeminfrastructure.environment.levelmonitor.LevelMonitor',
    HmiMediaState: 'de.bmw.infotainment.hmi.hmimediastate.HmiMediaState',
    MediaSource: 'de.bmw.infotainment.entertainment.mediasource.MediaSource',
    TunerFmAmDab: 'de.bmw.infotainment.tuner.fmamdab.tunerfmamdab.TunerFmAmDab',
    MediaPlayer: 'de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer',
    CommandControl: 'org.genivi.am.commandinterface.CommandControl',
    ConnectivityAggregator: 'de.bmw.infotainment.connectivity.telephony.ConnectivityAggregator',
    CarPlayManager: 'de.bmw.infotainment.a4a.carplay.CarPlayManager',
    VoiceCall: 'de.bmw.infotainment.connectivity.telephony.VoiceCall',
    VoiceCallManager: 'de.bmw.infotainment.connectivity.telephony.VoiceCallManager',
    DevicePresentation: 'de.bmw.infotainment.devicemanager.devicepresentation.DevicePresentation',
    CallList: 'de.bmw.infotainment.connectivity.calllist.CallList',
    Telephone: 'de.bmw.infotainment.Telephone',
    ConnTeleSync: 'de.bmw.infotainment.connectivity.conntelematicssync.ConnTeleSync',
    ACM: 'de.bmw.infotainment.telematic.acm.ACM',
    EsimProxy: 'de.bmw.infotainment.telematic.esimproxy.EsimProxy',
    AudioSystemInformation: 'de.bmw.infotainment.am.AudioSystemInformation',
    WirelessChargingAdapter: 'de.bmw.infotainment.wca.WirelessChargingAdapter',
    ComfortFunction: 'de.bmw.body.ComfortFunction',
    HMIContext: 'de.bmw.infotainment.hmi.hmicontext.HMIContext',
    HMIContext2: 'de.bmw.infotainment.hmi.hmicontext2.HMIContext2',
    SteeringWheelPushButton: 'de.bmw.infotainment.controlelements.SteeringWheelPushButton',
    Light: 'de.bmw.body.Light',
    FrontCCU: 'de.bmw.infotainment.controlelements.FrontCCU',
    Lifecycle: 'de.bmw.infotainment.lifecycle.lifecycle.Lifecycle',
    NavigationStatus: 'de.bmw.infotainment.navigation.navigationstatus.NavigationStatus',
    Guidance: 'de.bmw.infotainment.navigation.guiding.Guidance',
    LaneGuiding: 'de.bmw.infotainment.LaneGuiding',
    AndroidAutoProjectedManager: 'de.bmw.infotainment.sdi.aap.androidautoprojectedmanager.AndroidAutoProjectedManager',
    TrafficSignDisplayControl: 'de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl',
    FASuS: 'de.bmw.infotainment.fasus.FASuS',
    DisplayDataServer: 'de.bmw.infotainment.displaydataserver.DisplayDataServer',
    DisplayDataServer2: 'de.bmw.infotainment.displaydata.DisplayDataServer2',
    MultimodalControlDriverAssistance: 'de.bmw.dass.driverassistanceapplications.MultimodalControlDriverAssistance',
    GapVehicleAhead: 'de.bmw.dass.GapVehicleAhead',
    TPMS: 'de.bmw.infotainment.vehicle.TPMS',
    CDS2: 'de.bmw.infotainment.vehicle.CDS2',
    FES: 'de.bmw.infotainment.drivingexcitement.FES',
    ConsumptionHistory3: 'de.bmw.infotainment.ConsumptionHistory3',
    Positioning: 'de.bmw.infotainment.navigation.positioning.Positioning',
    GPSData: 'de.bmw.infotainment.GPSData',
    Powertrain: 'de.bmw.powertrain.Powertrain',
    Dialog: 'de.bmw.infotainment.speech.dialog.Dialog',
    MDrive: 'de.bmw.infotainment.misc.MDrive',
    TrafficSignRecognition: 'de.bmw.dass.TrafficSignRecognition',
    SignRecognitionFrontCamera: 'de.bmw.environmentalmodel.SignRecognitionFrontCamera',
    SignRecognitionFrontCameraLegacy: 'de.bmw.environmentalmodel.SignRecognitionFrontCameraLegacy',
    CCP: 'de.bmw.infotainment.navigation.externalize.adasng.CCP',
    // S14 / S15 (the owner, 2026-11-19: "every field an adaptive cruise could need, all the metrics")
    KeepDistanceObjects: 'de.bmw.dass.driverassistanceapplications.KeepDistanceObjectsLegacy',
    AssistedDrivingViewInput: 'de.bmw.dass.AssistedDrivingViewFunctionInput',
    StatusDisplayXADAndSpeed: 'de.bmw.dass.driverassistanceapplications.StatusDisplayXADAndSpeed',
    HMIControlAD: 'de.bmw.dass.HMIControlAD',
    StateAutonomousDrivingLegacy: 'de.bmw.dass.StateAutonomousDrivingLegacy',
    DriverAssistanceExtendedMessages: 'de.bmw.dass.driverassistanceapplications.DriverAssistanceExtendedMessages',
    SettingsDriverAssistance: 'de.bmw.dass.settingsdriverassistancefunctions.SettingsDriverAssistanceFunctions',
    StatusDriverAssistanceFunctions: 'de.bmw.dass.StatusDriverAssistanceFunctions',
    SpeedAcceleration: 'de.bmw.chassis.SpeedAcceleration',
    AccelerationProvision: 'de.bmw.chassis.AccelerationLongitudinalLateralProvision',
    YawRateProvision: 'de.bmw.chassis.YawRateProvision',
    SurfaceInformation: 'de.bmw.chassis.SurfaceInformationProvision',
    RollPitchRate: 'de.bmw.chassis.RollPitchRateAccelerationVerticalProvision',
    EgomotionCamera: 'de.bmw.chassis.EgomotionCamera',
    EgoMotionLegacy: 'de.bmw.environmentalmodel.EgoMotionLegacy',
    ObjectsFrontCamera: 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera',
    ObjectsFrontCamera2: 'de.bmw.environmentalmodel.ObjectRecognitionFrontCamera2',
    FusedSensorDetection: 'de.bmw.environmentalmodel.FusedSensorDetectionData',
    DAADataServer: 'de.bmw.environmentalmodel.DAADataServer',
    ObjectListSuAAR: 'de.bmw.dass.pad.communication.ObjectListSuAAR',
    // cruise RC: the pedals, the brake, the wheel speeds, more ego-speed and grade sources for the cruise brief (S14)
    AcceleratorPedal: 'de.bmw.powertrain.AcceleratorPedal',
    VehicleStabilization: 'de.bmw.chassis.VehicleStabilizationManagement',
    VelocityProvision: 'de.bmw.powertrain.vehicledynamics.VelocityAndVehicleConditionProvision',
    XView: 'de.bmw.infotainment.drivingexcitement.XView',
    VehicleModel: 'de.bmw.chassis.VehicleModel',
    // S16 (car issues NV, 2026-11-19: the owner saw the next turns on the cluster in the place of the map while CarPlay guided)
    ProjectedModeGuiding: 'de.bmw.infotainment.navigation.projectedmodeguiding.ProjectedModeGuiding',
    GuidanceEventList: 'de.bmw.infotainment.navigation.guiding.GuidanceEventList',
    GuidanceRenderedContent: 'de.bmw.infotainment.navigation.guiding.GuidanceRenderedContent',
    CarPlayAM: 'de.bmw.infotainment.am.carplay.CarPlay',
    RICServiceGuidance: 'de.bmw.infotainment.remoteinstrumentcluster.RICServiceGuidance',
    DisplaySink: 'de.bmw.infotainment.remoteinstrumentcluster.DisplaySink',
    NavigationCAN: 'de.bmw.infotainment.navigation.NavigationCAN',
    FeedbackLaneGuiding: 'de.bmw.infotainment.FeedbackLaneGuiding',
    // beam HS: S18 "HB" (docs/highbeam/BRIEF-HS-signals.md): the camera's light detection, the ambient brightness, the wipers, the
    // light switch screen's state. Four interfaces new to the manifest (Light is already read by S6 / S14)
    RecogLight: 'de.bmw.sensors.objects.RecogFrontCameraLightDetection',
    Environment: 'de.bmw.body.Environment',
    Wiper: 'de.bmw.body.Wiper',
    LightswitchOperation: 'de.bmw.body.drivinglight.LightswitchOperation',
};
const TABLE = [
    // ---- S1 P1 ----
    { set: 'S1', p: 'P1', tag: 'active-cc', iface: I.KombiIF, field: 'statusActiveCCMessage', flags: 'rs', cols: [['number','numberDisplayControlCheckControlMessage','n'],['control','displayControlCheckControlMessage','n'],['frameNumber','numberFrameDisplayControlCheckControlMessage','n'],['frame','frameDisplayControlCheckControlMessage','n'],['utility','utilityDataDisplayControlCheckControlMessage','x']] },
    { set: 'S1', p: 'P1', tag: 'displayed-cc', iface: I.Vehicle2, field: 'statusDisplayedCCMessage', flags: 'rs', cols: [['number','statusNumberCheckControlMessageDisplay','n']] },
    { set: 'S1', p: 'P1', tag: 'menu-cc', iface: I.KombiIF, field: 'statusMenuCCMessage', flags: 'rs', cols: [['frameNumber','numberFrameCheckControlMessageScroll','n'],['frames','quantityFrameCheckControlMessageScroll','n'],['id1','numberCheckControlMessage1','n'],['id2','numberCheckControlMessage2','n'],['id3','numberCheckControlMessage3','n']] },
    { set: 'S1', p: 'P1', tag: 'ccList', iface: I.KombiInterface_2, field: 'ccList', flags: 'rs', list: {'member':'cCListElement','cols':[['id','cCIdentifer','n'],['colour','cCColor','e'],['symbol','cCListSymbolID','n'],['indent','cCIndentation','e'],['ric','ricResourceID','n'],['name-len','cCShortName','t']]} },
    // ---- S1 P2 ----
    { set: 'S1', p: 'P2', tag: 'ccListRiskClass', iface: I.KombiInterface_2, field: 'ccListRiskClass', flags: 'rs', list: {'member':'cCListRiskClassElement','cols':[['id','cCIdentifer','n'],['colour','cCColor','e'],['risk','cCRiskClass','e'],['symbol','cCListSymbolID','n'],['name-len','cCShortName','t']]} },
    { set: 'S1', p: 'P2', tag: 'basicList', iface: I.CheckControlMaster, field: 'basicList', flags: 'rs', list: {'member':null,'cols':[['id','ccmId','n'],['reason','reason','e'],['state','activeState','e'],['filter','filterInformation','e']]} },
    // ---- S2 P3 ----
    { set: 'S2', p: 'P3', tag: 'range-tank', iface: I.KombiIF, field: 'statusRangeTankStatus', flags: 'rs', cols: [['fuel','fluidLevelFuelTank','n'],['fuelL','fluidLevelFuelTankLeftHand','n'],['fuelR','fluidLevelFuelTankRightHand','n'],['spare','statusFluidLevelFuelTankSpare','e'],['range','range','n'],['mileage','mileageKilometre','n']] },
    { set: 'S2', p: 'P3', tag: 'range-alt', iface: I.VehicleInformation, field: 'Range', flags: 's', cols: [['mileage','mileageKilometre','n']] },
    { set: 'S2', p: 'P3', tag: 'mileage-supreme', iface: I.MileageSupreme, field: 'mileageSupreme', flags: 'rs', cols: [['mileage','mileageSupreme','n'],['qualifier','qualifierMileageSupreme','e']] },
    { set: 'S2', p: 'P3', tag: 'mileage-secure', iface: I.SecureMileage, field: 'mileage', flags: 'rs', cols: [['mileage','currentMileage','n'],['alive','aliveCounter','n'],['manipulation','manipulationState','n']] },
    // ---- S2 P4 ----
    { set: 'S2', p: 'P4', tag: 'bc-average', iface: I.KombiIF, field: 'statusBordcomputerAverage', flags: 'rs', cols: [['speed1','speedAverage1BC1','n'],['cons1','consumptionAverage1BC1','n'],['speed2','speedAverage2BC2','n'],['cons2','consumptionAverage2BC2','n'],['speedUnit','statusUnitOfMeasurementSpeedBC','e'],['consUnit','statusUnitOfMeasurementConsumptionBC','e']] },
    { set: 'S2', p: 'P4', tag: 'bc-travel', iface: I.KombiIF, field: 'statusBordcomputerTravelData', flags: 'rs', cols: [['hours','rideDurationHours','n'],['minutes','rideDurationMinutes','n'],['way','wayPassed','n']] },
    { set: 'S2', p: 'P4', tag: 'bc-start', iface: I.KombiIF, field: 'statusBordcomputerTravelStart', flags: 'rs', cols: [['hour','hourDepartureBC','n'],['minute','minuteDepartureBC','n'],['day','dayDepartureBC','n'],['month','monthDepartureBC','n'],['year','yearDepartureBC','n']] },
    { set: 'S2', p: 'P4', tag: 'bc-status2', iface: I.KombiIF, field: 'statusBordcomputerStatus2', flags: 'rs', cols: [['bc2','statusBC2BN2020','e'],['reset','statusResetBC2BN2020','e'],['limit','statusLimitBN2020','e'],['boundary','boundaryLimitBN2020','n'],['speedUnit','statusUnitOfMeasurementSpeedSpeedometerBN2020','e']] },
    { set: 'S2', p: 'P4', tag: 'bc-all3', iface: I.ResetLogic3, field: 'bcDataAll', flags: 'rs', cols: [['speedUnit', ['bcUnits', 'tachoDigital'], 'e'], ['consNowUnit', ['bcUnits', 'currentConsumptionCombustion'], 'e'], ['consAvgUnit', ['bcUnits', 'averageConsumptionCombustion'], 'e'], ['active', 'activeResetLogic', 'n'], ['available', 'availableResetLogic', 'x']],
      sub: { path: 'bcData3', label: 'trips', cols: [['option', 'resetOption', 'e'], ['tripDay', ['dateTimeTrip', 'day'], 'n'], ['tripH', ['dateTimeTrip', 'hour'], 'n'], ['tripM', ['dateTimeTrip', 'minute'], 'n'], ['tripS', ['dateTimeTrip', 'second'], 'n'], ['speedAvg', 'speedAverage', 'n'], ['consAvgScale', 'consumptionCombustionAverageScale', 'n'], ['consAvgDigit', 'consumptionCombustionAverageDigit', 'n'], ['consNowScale', 'consumptionCombustionCurrentScale', 'n'], ['consNowDigit', 'consumptionCombustionCurrentDigit', 'n'], ['distance', 'counterDistance', 'n'], ['resetY', ['dateTimeReset', 'year'], 'n'], ['resetMo', ['dateTimeReset', 'month'], 'n'], ['resetD', ['dateTimeReset', 'day'], 'n'], ['resetH', ['dateTimeReset', 'hour'], 'n'], ['resetMi', ['dateTimeReset', 'minute'], 'n']] } },
    { set: 'S2', p: 'P4', tag: 'bc-all1', iface: I.ResetLogic, field: 'bcDataAll', flags: 'rs', cols: [['speedUnit', ['bcUnits', 'tachoDigital'], 'e'], ['consUnit', ['bcUnits', 'consumption'], 'e'], ['active', 'activeResetLogic', 'n'], ['available', 'availableResetLogic', 'x']],
      sub: { path: 'bcData', label: 'trips', cols: [['option', 'resetOption', 'e'], ['speedAvg', 'speedAverage', 'n'], ['consAvg', 'consumptionAverage', 'n'], ['consNow', 'currentConsumption', 'n'], ['tripDay', ['dateTimeTrip', 'day'], 'n'], ['tripH', ['dateTimeTrip', 'hour'], 'n'], ['tripM', ['dateTimeTrip', 'minute'], 'n'], ['resetH', ['dateTimeReset', 'hour'], 'n'], ['resetMi', ['dateTimeReset', 'minute'], 'n']] } },
    { set: 'S2', p: 'P4', tag: 'bc-avgcons1', iface: I.ResetLogic, field: 'averageConsumption', flags: 'rs', cols: [['consNowScale','consumptionCombustionCurrentScale','n'],['consNowDigit','consumptionCombustionCurrentDigit','n'],['unit','combustionUnit','e']] },
    { set: 'S2', p: 'P4', tag: 'bc-all2', iface: I.ResetLogic2, field: 'bcDataAll', flags: 'rs', cols: [['speedUnit', ['bcUnits', 'tachoDigital'], 'e'], ['active', 'activeResetLogic', 'n'], ['available', 'availableResetLogic', 'x']],
      sub: { path: 'bcData', label: 'trips', cols: [['option', 'resetOption', 'e'], ['speedAvg', 'speedAverage', 'n'], ['consAvgScale', 'consumptionCombustionAverageScale', 'n'], ['consAvgDigit', 'consumptionCombustionAverageDigit', 'n'], ['tripDay', ['dateTimeTrip', 'day'], 'n'], ['tripH', ['dateTimeTrip', 'hour'], 'n'], ['tripM', ['dateTimeTrip', 'minute'], 'n'], ['resetH', ['dateTimeReset', 'hour'], 'n'], ['resetMi', ['dateTimeReset', 'minute'], 'n']] } },
    { set: 'S2', p: 'P4', tag: 'bc-segment', iface: I.BcPersonal, field: 'driveSegment', flags: 'rs', cols: [['segment','bcBeSegmentId','n'],['trigger','bcBeTriggerReason','e'],['durDrive','bcBeDurationDrive','n'],['durMoving','bcBeDurationMoving','n'],['distance','bcBeTripDistanceKm','n'],['speedDrive','bcBeSpeedAvgDrive','n'],['speedMoving','bcBeSpeedAvgMoving','n'],['fuel','bcBeConsFuelVisible','n']] },
    { set: 'S2', p: 'P4', tag: 'lsc-cluster', iface: I.LSCDataSink, field: 'dataCombinedInstrumentCluster', flags: 's', cols: [['speedAvg','averageSpeed','n'],['consAvg','averageRangeConsumption','n'],['fuel','displayActualValueFuelTankFluidLevel','n']] },
    // ---- S2 P5 ----
    { set: 'S2', p: 'P5', tag: 'units', iface: I.EnvironmentalInformation, field: 'UnitBN2020', flags: 'rs', cols: [['mileage','unitOfMeasurementMileage','e']] },
    { set: 'S2', p: 'P5', tag: 'external-display', iface: I.KombiIF, field: 'statusKombiExternalDisplay', flags: 'rs', cols: [['outside','displayTemperatureExterior','n'],['range','displayRange','n'],['tempUnit','statusUnitOfMeasurementTemperatureInstrumentPack','e']] },
    { set: 'S2', p: 'P5', tag: 'units-ext', iface: I.Vehicle, field: 'statusNewCurrentUnitsStatusExt', flags: 'rs', cols: [['temp','unitOfMeasurementTemperature','e'],['speed','unitOfMeasurementSpeedometerDigital','e'],['cons','unitOfMeasurementConsumption','e'],['fuel','unitOfMeasurementFuel','e'],['pressure','unitOfMeasurementAirPressure','e'],['power','unitOfMeasurementPowerSportMode','e'],['torque','unitOfMeasurementTorqueSportMode','e']] },
    // ---- S2 P6 ----
    { set: 'S2', p: 'P6', tag: 'engine-verdict', iface: I.KombiIF, field: 'dataInstrumentPack', flags: 'rs', cols: [['verdict','engineTemperatureEvaluated','e'],['auxPower','presentAuxiliaryConsumerPower','n']] },
    { set: 'S2', p: 'P6', tag: 'coolant', iface: I.CDS, field: 'statusEngineTemperature', flags: 'rs', gapMs: 5000, cap: 240, fmt: 'temps' },
    // ---- S3 P7 ----
    { set: 'S3', p: 'P7', tag: 'doors', iface: I.DoorsWindowsRoofMirrors, field: 'CentralLockingSystemAndPanelStatus2', flags: 's', cols: [['driver','statusDoorSwitchDRD','e'],['passenger','statusDoorSwitchPSD','e'],['rearDriver','statusDoorSwitchDRDR','e'],['rearPassenger','statusDoorSwitchPSDR','e'],['boot','statusContactBootLid','e'],['bonnet','statusContactBonnet','e'],['boot2','statusContactBootLid2','e'],['softClose','statusContactSoftCloseAutomatic','e'],['locking','statusCentralLockingSystem','n'],['hotel','statusHotelMode','e']] },
    { set: 'S3', p: 'P7', tag: 'lids', iface: I.A4A, field: 'statusA4ALids', flags: 'rs', cols: [['bonnet','statusContactBonnet','e']] },
    { set: 'S3', p: 'P7', tag: 'zv-status', iface: I.Vehicle2, field: 'statusZVStatus', flags: 'rs', cols: [['locking','statusCentralLockingSystem','n'],['bootUnlocked','statusCentralLockingSystemBootlid','e'],['dwa','controlDWAPartial','n']] },
    // ---- S3 P10 ----
    { set: 'S3', p: 'P10', tag: 'voltage-basic', iface: I.BasicDataSet, field: 'basicDataSet', flags: 's', gapMs: 5000, cap: 240, cols: [['voltage','statusVoltageIntelligentBoardnetSensor','n']] },
    { set: 'S3', p: 'P10', tag: 'voltage-hu', iface: I.LevelMonitor, field: 'systemVoltage', flags: 'rs', instance: 'Inst1', gapMs: 5000, cap: 240, cols: [['sim','simuState','b'],['value','value','n']] },
    { set: 'S3', p: 'P10', tag: 'battery-condition', iface: I.CDS, field: 'statusBattery2', flags: 'rs', cols: [['condition','conditionBatteryChargingCondition','n']] },
    // ---- S4 P8 ----
    { set: 'S4', p: 'P8', tag: 'player-metadata', iface: I.HmiMediaState, field: 'playerMetadata', flags: 'rs', instance: 'HMI_CID', cols: [['sink','sink','e'],['uiType','uiType','e'],['menuEntry','menuEntry','n'],['track','trackId','n'],['line1-type','firstLineType','e'],['line1-len','firstLineText','t'],['line2-type','secondLineType','e'],['line2-len','secondLineText','t'],['line3-len','threeRowText','t']] },
    { set: 'S4', p: 'P8', tag: 'active-source', iface: I.MediaSource, field: 'activeSourceId', flags: 'rs', fmt: 'activeSource' },
    { set: 'S4', p: 'P8', tag: 'sources', iface: I.MediaSource, field: 'sources', flags: 'rs', fmt: 'sources' },
    { set: 'S4', p: 'P8', tag: 'track-progress', iface: I.HmiMediaState, field: 'trackProgress', flags: 'rs', instance: 'HMI_CID', gapMs: 10000, cap: 120, cols: [['sink','sink','e'],['menuEntry','menuEntry','n'],['track','trackId','n'],['elapsed','elapsed','n'],['total','total','n'],['hasProgress','hasProgress','b'],['seekable','isSeekable','b']] },
    { set: 'S4', p: 'P8', tag: 'main-menu-metadata', iface: I.HmiMediaState, field: 'mainMenuMetadata', flags: 'rs', instance: 'HMI_CID', cols: [['sink','sink','e'],['menuEntry','menuEntry','n'],['track','trackId','n'],['line1-len','firstLineText','t'],['line2-len','secondLineText','t'],['line3-len','thirdLineText','t']] },
    { set: 'S4', p: 'P8', tag: 'media-menu', iface: I.HmiMediaState, field: 'menu', flags: 'rs', instance: 'HMI_CID', fmt: 'mediaMenu' },
    { set: 'S4', p: 'P8', tag: 'station', iface: I.TunerFmAmDab, field: 'currentStationFmDabAm', flags: 'rs', gapMs: 5000, fmt: 'station' },
    { set: 'S4', p: 'P8', tag: 'cp-player-state', iface: I.MediaPlayer, field: 'playerState', flags: 'rs', instance: 'CarPlayMedia', fmt: 'enum' },
    { set: 'S4', p: 'P8', tag: 'cp-item-time', iface: I.MediaPlayer, field: 'currentItemTime', flags: 'rs', instance: 'CarPlayMedia', gapMs: 10000, cap: 120, cols: [['elapsed','elapsed','n'],['total','total','n']] },
    { set: 'S4', p: 'P8', tag: 'cp-item-position', iface: I.MediaPlayer, field: 'currentItemPosition', flags: 'rs', instance: 'CarPlayMedia', cols: [['position','position','n'],['of','totalNumber','n']] },
    { set: 'S4', p: 'P8', tag: 'cp-item-metadata', iface: I.MediaPlayer, field: 'currentItemMetadata', flags: 'rs', instance: 'CarPlayMedia', fmt: 'metadata' },
    { set: 'S4', p: 'P8', tag: 'cp-device', iface: I.MediaPlayer, field: 'deviceInfo', flags: 'rs', instance: 'CarPlayMedia', cols: [['type','type','e'],['status','status','n'],['device','deviceId','z'],['source','sourceId','n'],['name-len','name','t']] },
    { set: 'S4', p: 'P8', tag: 'main-connections', iface: I.CommandControl, field: 'listOfMainConnections', flags: 'rs', list: {'member':null,'cols':[['id','mainConnectionID','n'],['source','sourceID','n'],['sink','sinkID','n'],['state','connectionState','e']]} },
    // ---- S5 P9 ----
    { set: 'S5', p: 'P9', tag: 'call-state', iface: I.ConnectivityAggregator, field: 'aggregatedCallState', flags: 'rs', fmt: 'enum' },
    { set: 'S5', p: 'P9', tag: 'carplay-call', iface: I.CarPlayManager, field: 'projectedTelephonyActive', flags: 'rs', instance: 'CarPlayManagerInst1', fmt: 'bool' },
    { set: 'S5', p: 'P9', tag: 'phone-call1-state', iface: I.VoiceCall, field: 'state', flags: 'rs', instance: 'Call1', fmt: 'enum' },
    { set: 'S5', p: 'P9', tag: 'phone-call1-duration', iface: I.VoiceCall, field: 'duration', flags: 'rs', instance: 'Call1', cols: [['value',[],'n']] },
    { set: 'S5', p: 'P9', tag: 'phone-call1-contact', iface: I.VoiceCall, field: 'contactID', flags: 'rs', instance: 'Call1', cols: [['contact',[],'z']] },
    { set: 'S5', p: 'P9', tag: 'phone-call1-multiparty', iface: I.VoiceCall, field: 'multiparty', flags: 'rs', instance: 'Call1', fmt: 'bool' },
    { set: 'S5', p: 'P9', tag: 'phone-call1-modem', iface: I.VoiceCall, field: 'modem', flags: 'rs', instance: 'Call1', cols: [['value',[],'n']] },
    { set: 'S5', p: 'P9', tag: 'phone-call1-name', iface: I.VoiceCall, field: 'name', flags: 'rs', instance: 'Call1', cols: [['len',[],'t']] },
    { set: 'S5', p: 'P9', tag: 'phone-call1-number', iface: I.VoiceCall, field: 'number', flags: 'rs', instance: 'Call1', cols: [['len',[],'t']] },
    { set: 'S5', p: 'P9', tag: 'phone-call1-picture', iface: I.VoiceCall, field: 'pictureSource', flags: 'rs', instance: 'Call1', cols: [['url-len','pictureURL','t'],['initials-len','initials','t']] },
    { set: 'S5', p: 'P9', tag: 'phone-mic-muted', iface: I.VoiceCallManager, field: 'micMuted', flags: 'rs', fmt: 'bool' },
    { set: 'S5', p: 'P9', tag: 'phone-hfp-blocked', iface: I.VoiceCallManager, field: 'hfpBlocked', flags: 'rs', fmt: 'bool' },
    { set: 'S5', p: 'P9', tag: 'phone-comm-blocked', iface: I.VoiceCallManager, field: 'communicationBlocked', flags: 'rs', fmt: 'bool' },
    { set: 'S5', p: 'P9', tag: 'phone-devices', iface: I.DevicePresentation, field: 'deviceList', flags: 'rs', fmt: 'devices' },
    { set: 'S5', p: 'P9', tag: 'phone-active-roles', iface: I.DevicePresentation, field: 'activeRoles', flags: 'rs', fmt: 'roles' },
    { set: 'S5', p: 'P9', tag: 'phone-calllist', iface: I.CallList, field: 'callItemList', flags: 'rs', fmt: 'calllist' },
    { set: 'S5', p: 'P9', tag: 'nad-call', iface: I.Telephone, field: 'callState', flags: 'rs', instance: '1', list: {'member':'callStateStructure','cols':[['id','id','n'],['direction','direction','e'],['state','state','e'],['mode','mode','e'],['multiparty','multipartyCall','e']]} },
    { set: 'S5', p: 'P9', tag: 'nad-register', iface: I.Telephone, field: 'registerState', flags: 'rs', instance: '1', union: {'member':'registerStateStructure','cols':[['cs','circuitSwitchedNetworkRegisterState','e'],['ps','packetSwitchedNetworkRegisterState','e']]} },
    { set: 'S5', p: 'P9', tag: 'nad-signal', iface: I.Telephone, field: 'signalQuality', flags: 'rs', instance: '1', union: {'member':'signalQualityStructure','cols':[['rssi','receivedSignalStrength','n'],['ber','bitErrorRate','n'],['code-len','netCode','t'],['name-len','netName','t']]} },
    { set: 'S5', p: 'P9', tag: 'nad-operator', iface: I.Telephone, field: 'currentNetworkOperator', flags: 'rs', instance: '1', union: {'member':'currentNetworkOperatorStructure','cols':[['mode','mode','n'],['tech','accessTechnology','e']]} },
    { set: 'S5', p: 'P9', tag: 'telesync-call', iface: I.ConnTeleSync, field: 'callStatus', flags: 'rs', instance: 'TelematicsCallStatusInst1', fmt: 'enum' },
    { set: 'S5', p: 'P9', tag: 'telesync-gsm', iface: I.ConnTeleSync, field: 'gsmStrength', flags: 'rs', instance: 'TelematicsCallStatusInst1', cols: [['value',[],'n']] },
    { set: 'S5', p: 'P9', tag: 'telesync-register', iface: I.ConnTeleSync, field: 'registerState', flags: 'rs', instance: 'TelematicsCallStatusInst1', fmt: 'enum' },
    { set: 'S5', p: 'P9', tag: 'telesync-lock', iface: I.ConnTeleSync, field: 'lockState', flags: 'rs', instance: 'TelematicsCallStatusInst1', fmt: 'enum' },
    { set: 'S5', p: 'P9', tag: 'acm-phone', iface: I.ACM, field: 'phoneState', flags: 'rs', fmt: 'enum' },
    { set: 'S5', p: 'P9', tag: 'acm-data', iface: I.ACM, field: 'dataConnectionStatus', flags: 'rs', cols: [['device','device','e'],['status','status','e'],['tech','technology','e'],['voiceData','voiceDataParallel','b']] },
    { set: 'S5', p: 'P9', tag: 'esim-status', iface: I.EsimProxy, field: 'status', flags: 'rs', instance: 'EsimProxy_1', fmt: 'enum' },
    { set: 'S5', p: 'P9', tag: 'esim-signal', iface: I.EsimProxy, field: 'signalStrength', flags: 'rs', instance: 'EsimProxy_1', cols: [['value',[],'n']] },
    { set: 'S5', p: 'P9', tag: 'esim-telephony', iface: I.EsimProxy, field: 'telephonyEnabled', flags: 'rs', instance: 'EsimProxy_1', fmt: 'bool' },
    { set: 'S5', p: 'P9', tag: 'audio-tel-mute', iface: I.AudioSystemInformation, field: 'muteTelState', flags: 'rs', cols: [['mute','controlMute','n']] },
    { set: 'S5', p: 'P9', tag: 'wca-front', iface: I.WirelessChargingAdapter, field: 'wcaNfcFrontStatus', flags: 'rs', cols: [['status','wcavStatus','e'],['coil','wcavCoil','e'],['temp','wcavTemperatureDevice','n'],['efficiency','wcavEfficiency','n']] },
    { set: 'S5', p: 'P9', tag: 'wca-body', iface: I.ComfortFunction, field: 'WCAStatus', flags: 'rs', cols: [['status','statusWCA','e'],['temp','responseWCATemperatureDevice','n'],['efficiency','responseWCAEfficiency','n']] },
    { set: 'S5', p: 'P9', tag: 'hmi-app', iface: I.HMIContext, field: 'currentActiveApplication', flags: 'rs', instance: 'HMI_CID', fmt: 'enum' },
    { set: 'S5', p: 'P9', tag: 'nad2-call', iface: I.Telephone, field: 'callState', flags: 'rs', instance: '2', list: {'member':'callStateStructure','cols':[['id','id','n'],['direction','direction','e'],['state','state','e'],['mode','mode','e'],['multiparty','multipartyCall','e']]} },
    { set: 'S5', p: 'P9', tag: 'nad2-register', iface: I.Telephone, field: 'registerState', flags: 'rs', instance: '2', union: {'member':'registerStateStructure','cols':[['cs','circuitSwitchedNetworkRegisterState','e'],['ps','packetSwitchedNetworkRegisterState','e']]} },
    { set: 'S5', p: 'P9', tag: 'nad2-signal', iface: I.Telephone, field: 'signalQuality', flags: 'rs', instance: '2', union: {'member':'signalQualityStructure','cols':[['rssi','receivedSignalStrength','n'],['ber','bitErrorRate','n'],['code-len','netCode','t'],['name-len','netName','t']]} },
    { set: 'S5', p: 'P9', tag: 'nad2-operator', iface: I.Telephone, field: 'currentNetworkOperator', flags: 'rs', instance: '2', union: {'member':'currentNetworkOperatorStructure','cols':[['mode','mode','n'],['tech','accessTechnology','e']]} },
    // ---- S6 P11 ----
    { set: 'S6', p: 'P11', tag: 'ic-widget', iface: I.HMIContext, field: 'currentICWidget', flags: 'rs', instance: 'HMI_CID', fmt: 'hex', mark: true },
    { set: 'S6', p: 'P11', tag: 'ic-context', iface: I.HMIContext, field: 'currentICGraphicalContext', also: ['S10'], flags: 'rs', instance: 'HMI_CID', mark: true, cols: [['focus','focusIndex','n'],['list','listIndex','n'],['visible','visibleContext','x']] },
    { set: 'S6', p: 'P11', tag: 'ic-widget2', iface: I.HMIContext2, field: 'currentICWidget', flags: 'rs', instance: '1', mark: true, cols: [['state','StateID','n'],['applet','AppletID','n']] },
    { set: 'S6', p: 'P11', tag: 'ic-context2', iface: I.HMIContext2, field: 'currentICGraphicalContext', also: ['S10'], flags: 'rs', instance: '1', mark: true, cols: [['state',['VisualContext','StateID'],'n'],['applet',['VisualContext','AppletID'],'n'],['focus',['FocusIndex','FocusIndex'],'n'],['focusApplet',['FocusIndex','AppletID'],'n'],['list','ListIndex','n']] },
    { set: 'S6', p: 'P11', tag: 'kombi-selection', iface: I.KombiIF, field: 'statusKombiSelection', also: ['S10'], flags: 'rs', mark: true, cols: [['packBC','statusActivationInstrumentPackBC','x'],['content','statusActivationInstrumentPackContent','x'],['preselect','statusActivationPreselectInstrumentPack','e']] },
    { set: 'S6', p: 'P11', tag: 'kombi-available', iface: I.KombiIF, field: 'statusKombiSelectionAvailability', also: ['S10'], flags: 'rs', mark: true, cols: [['packBC','baseSetupInstrumentPackBC','x'],['content','baseSetupInstrumentPackContent','x'],['preselect','baseSetupPreselectInstrumentPack','n']] },
    { set: 'S6', p: 'P11', tag: 'kombi-config', iface: I.KombiIF, field: 'statusConfigurationKombi5', also: ['S7', 'S10', 'S16'], flags: 'rs', mark: true, cols: [['content2','statusActivationInstrumentPackContent2','x'],['preselect2','statusActivationPreselectInstrumentPack2','e'],['navDisplay','statusNavigationDisplayType','e'],['dzmOrPower','statusDZMorPowermeterDisplay','e'],['entertainment','statusEntertainmentSTGDisplay','e']] },
    { set: 'S6', p: 'P11', tag: 'display-kombi', iface: I.Vehicle2, field: 'statusDisplayKombi', also: ['S10', 'S16'], flags: 'rs', mark: true, cols: [['view','statusDisplayInstrumentPackM','e']] },
    // ---- S6 P13 ----
    { set: 'S6', p: 'P13', tag: 'sw-special1', iface: I.SteeringWheelPushButton, field: 'statusSpecialFunctionButton', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['press','operationPushButtonSpecialFunction','e']] },
    { set: 'S6', p: 'P13', tag: 'sw-special2', iface: I.SteeringWheelPushButton, field: 'statusSpecialFunctionButton2', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['press','operationPushButtonSpecialFunction2','e']] },
    { set: 'S6', p: 'P13', tag: 'sw-fav', iface: I.SteeringWheelPushButton, field: 'operationSteerWheelFAV', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['press','operationSteerWheelFAV','e']] },
    { set: 'S6', p: 'P13', tag: 'sw-fc', iface: I.SteeringWheelPushButton, field: 'operationSteerWheelFC', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['press','operationSteerWheelFC','e']] },
    { set: 'S6', p: 'P13', tag: 'sw-wheel-steps', iface: I.SteeringWheelPushButton, field: 'statusRotarySteps', flags: 'rs', gapMs: 100, cap: 300, mark: true, cols: [['steps','operationStepsKnurlSteeringWheel','n']] },
    { set: 'S6', p: 'P13', tag: 'sw-wheel-press', iface: I.SteeringWheelPushButton, field: 'statusRotaryPress', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['press','operationPushButtonKnurlSteeringWheel','e']] },
    { set: 'S6', p: 'P13', tag: 'sw-skip', iface: I.SteeringWheelPushButton, field: 'statusSearchSwitch1', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['skip','operationPushButtonAudioAutomaticTuningSteeringWheel','e']] },
    { set: 'S6', p: 'P13', tag: 'sw-volume', iface: I.SteeringWheelPushButton, field: 'statusAudioVolumeButton', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['volume','operationPushButtonAudioAudioVolumeSteeringWheel','e']] },
    { set: 'S6', p: 'P13', tag: 'sw-voice', iface: I.SteeringWheelPushButton, field: 'statusPTTButton1', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['press','operationPushButtonPTTSteeringWheel','e']] },
    { set: 'S6', p: 'P13', tag: 'sw-phone', iface: I.SteeringWheelPushButton, field: 'statusTelephoneButton', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['press','operationPushButtonTelephoneSteeringWheel','e']] },
    { set: 'S6', p: 'P13', tag: 'sw-fc-led', iface: I.SteeringWheelPushButton, field: 'statusSteerWheelFCLED', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['led','statusSteerWheelFCLED','e']] },
    { set: 'S6', p: 'P13', tag: 'stalk', iface: I.Light, field: 'IndicatorSteeringColumn', flags: 's', gapMs: 0, cap: 300, mark: true, bits: {'path':'operationColumnStalks','label':'stalks'} },
    { set: 'S6', p: 'P13', tag: 'stalk-complete', iface: I.Light, field: 'IndicatorSteeringColumnComplete', flags: 's', gapMs: 0, cap: 300, mark: true, bits: {'path':'operationColumnStalks','label':'stalks'}, cols: [['mainBeamAssist','statusPushButtonMainBeamAssistant','e']] },
    { set: 'S6', p: 'P13', tag: 'controller', iface: I.FrontCCU, field: 'statusRotaryEncoderState', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['seq','frontSequenceNumberOperatingElement','n'],['turn','frontRotaryEncoderOperation','n'],['press','frontRotaryEncoderPushButton','e'],['tilt','frontRotaryEncoderDeflection','e']] },
    { set: 'S6', p: 'P13', tag: 'controller-keys', iface: I.FrontCCU, field: 'statusPushButtonsState', flags: 'rs', gapMs: 0, cap: 300, mark: true, cols: [['b1','frontOperationButton1','e'],['b2','frontOperationButton2','e'],['b3','frontOperationButton3','e'],['b4','frontOperationButton4','e'],['b5','frontOperationButton5','e'],['b6','frontOperationButton6','e'],['b7','frontOperationButton7','e'],['b8','frontOperationButton8','e']] },
    { set: 'S6', p: 'P13', tag: 'hmi-shortcut', iface: I.Lifecycle, field: 'entertainmentModeTrigger', flags: 'rs', instance: 'Front', gapMs: 0, cap: 300, fmt: 'enum', mark: true },
    // ---- S7 P12 ----
    { set: 'S7', p: 'P12', tag: 'guiding-state', also: ['S16'], iface: I.NavigationStatus, field: 'guidingState', flags: 'rs', fmt: 'enum' },
    { set: 'S7', p: 'P12', tag: 'next-intersection', also: ['S16'], iface: I.Guidance, field: 'nextIntersection', flags: 'rs', instance: 'Main_Instance', gapMs: 2000, fmt: 'intersection' },
    { set: 'S7', p: 'P12', tag: 'guidance-state', also: ['S16'], iface: I.Guidance, field: 'guidanceState', flags: 'rs', instance: 'Main_Instance', fmt: 'enum' },
    { set: 'S7', p: 'P12', tag: 'dart', also: ['S16'], iface: I.Guidance, field: 'conclusiveDart', flags: 'rs', instance: 'Main_Instance', gapMs: 2000, fmt: 'dart' },
    { set: 'S7', p: 'P12', tag: 'lanes', also: ['S16'], iface: I.Guidance, field: 'currentLaneGuiding', flags: 'rs', instance: 'Main_Instance', gapMs: 2000, fmt: 'lanes' },
    { set: 'S7', p: 'P12', tag: 'next-destination', also: ['S16'], iface: I.Guidance, field: 'nextDestinationInfo', flags: 'rs', instance: 'Main_Instance', gapMs: 2000, cols: [['travel','travelTime','n'],['delay','delayTime','n'],['delayStatus','delayStatus','e'],['dist-len',['formattedDistance','distance'],'t'],['unit',['formattedDistance','unit'],'e'],['raw',['formattedDistance','rawDistance'],'n'],['toFinal','distanceFromCurrentToFinalDestination','n'],['flag','isCheckeredFlag','b'],['stopover','stopOverNumber','n'],['etaInvalid',['estimatedArrivalTime','time','invalid'],'b'],['etaH',['estimatedArrivalTime','time','hour'],'n'],['etaM',['estimatedArrivalTime','time','minute'],'n'],['tzValid',['estimatedArrivalTime','includedTimeOffset','valid'],'b'],['tz',['estimatedArrivalTime','includedTimeOffset','timeZoneOffset'],'n']] },
    { set: 'S7', p: 'P12', tag: 'road', also: ['S16'], iface: I.Guidance, field: 'currentRoad', flags: 'rs', instance: 'Main_Instance', gapMs: 2000, fmt: 'description' },
    { set: 'S7', p: 'P12', tag: 'kombi-lanes', also: ['S16'], iface: I.LaneGuiding, field: 'laneGuiding', flags: 'rs', gapMs: 2000, cols: [['highlighted','currentGuidingHighlightedLanes','x'],['best','currentGuidingBestLanes','x'],['lane','currentLane','n'],['nextHighlighted','nextGuidingHighlightedLanes','x'],['shift','laneShift','n'],['distGuiding','distanceNextGuiding','n'],['distManeuver','distanceNextManeuver','n'],['maneuverShown','statusDisplayGuidingManeuver','e'],['level3Shown','statusDisplayGuidingLevel3','e'],['junctionShown','statusDisplayJunctionView','e'],['status','statusLaneGuiding','e'],['maneuverId','displayedManeuverID','e']] },
    { set: 'S7', p: 'P12', tag: 'kombi-lanes-ext', also: ['S16'], iface: I.LaneGuiding, field: 'extendedLaneGuiding', flags: 'rs', gapMs: 2000, cols: [['distManeuver','extendedDistanceNextManeuver','n']] },
    // ---- S7 P14 ----
    { set: 'S7', p: 'P12', tag: 'on-guidable-road', also: ['S16'], iface: I.Guidance, field: 'isOnGuidableRoad', flags: 'rs', instance: 'Main_Instance', fmt: 'bool' },
    { set: 'S7', p: 'P12', tag: 'guiding-provider', also: ['S16'], iface: I.Guidance, field: 'guidingProvider', flags: 'rs', instance: 'Main_Instance', fmt: 'enum' },
    { set: 'S7', p: 'P12', tag: 'carplay-guidance', also: ['S16'], iface: I.CarPlayManager, field: 'projectedGuidanceActive', flags: 'rs', instance: 'CarPlayManagerInst1', fmt: 'bool' },
    { set: 'S7', p: 'P12', tag: 'aa-guidance', also: ['S16'], iface: I.AndroidAutoProjectedManager, field: 'projectedGuidanceActive', flags: 'rs', instance: 'AndroidAutoProjectedManagerInst1', fmt: 'bool' },
    { set: 'S7', p: 'P14', tag: 'map-without-route', iface: I.Guidance, field: 'visualizationInKombiNonNaviEnabled', also: ['S10', 'S16'], flags: 'rs', instance: 'Main_Instance', fmt: 'bool' },
    { set: 'S7', p: 'P14', tag: 'junction-3d-in-kombi', iface: I.Guidance, field: 'junction3dViewInKombiEnabled', also: ['S10', 'S16'], flags: 'rs', instance: 'Main_Instance', fmt: 'bool' },
    // ---- S8 P15 ----
    { set: 'S8', p: 'P15', tag: 'sign', iface: I.TrafficSignDisplayControl, field: 'displaySpeedLimitAndNoPassingRestriction', flags: 's', cols: [['invalid','invalidFlag','n'],['value','displaySpeedLimit','n'],['unit','displaySpeedLimitUnit','e'],['warn','displaySpeedLimitWarning','e'],['supp','displaySpeedLimitSupplemental','e'],['style','displaySymbolStyle','e'],['np','displayNoPassingRestriction','e'],['npDist','displayRemainingDistanceNoPassingRestriction','n']] },
    { set: 'S8', p: 'P15', tag: 'longitudinal', also: ['S14'], iface: I.TrafficSignDisplayControl, field: 'displayDriverAssistanceLongitudinal', flags: 's', cols: [['invalid','invalidFlag','n'],['func','activeFuncLongitudinal','e'],['xcc',['dispXCC','dispXCCStatus'],'e'],['xccOn',['dispXCC','functionActive'],'b'],['object',['dispXCC','objectDetected'],'b'],['sld',['dispSLD','dispSLDStatus'],'e'],['lim',['dispSLD','dispLIMStatus'],'e'],['setSpeed','valueRequestedSpeed','n'],['setState',['dispRequestedSpeed','dispRequestedSpeedStatus'],'e'],['setUnit',['dispRequestedSpeed','unitOfRequestedSpeedValue'],'b'],['sla','StatusSLA','e'],['hdc','DispHDC','e']] },
    { set: 'S8', p: 'P15', tag: 'foresight', also: ['S14'], iface: I.TrafficSignDisplayControl, field: 'displayForesight', flags: 's', cols: [['invalid','invalidFlag','n'],['speed','dispSpeedForesight','e'],['dist','dispSpeedForesightDistance','n'],['event','dispForesightEvent','e'],['unit','unitSpeedForesight','e']] },
    { set: 'S8', p: 'P15', tag: 'ldm-guidance', also: ['S14'], iface: I.FASuS, field: 'displayDriverAssistenceSystemLongitudinalGuidance', flags: 's', cols: [['xcc','displayXCC','n'],['func','activeFunctionDriverAssistenceSystemLDM','e'],['sld','displaySLD','n'],['isa','statusISA2','e'],['gapMode','displayGapChoiceMode','e'],['gapInfo','displayGapInformation','e'],['gap','displayGapChoice','n'],['reqDisp','displayRequestSpeed','n'],['setSpeed','valueRequestSpeed','n']] },
    { set: 'S8', p: 'P15', tag: 'next-limit', iface: I.FASuS, field: 'statusNextSpeedLimitRecognition', flags: 'rs', cols: [['withdrawal','nextWithdrawalLimitSpeed','e'],['class','nextClassLimitSpeed','e']] },
    { set: 'S8', p: 'P15', tag: 'no-passing', iface: I.FASuS, field: 'statusOvertakeRecognition', flags: 'rs', cols: [['np','recognitionNoPassing','e']] },
    { set: 'S8', p: 'P15', tag: 'hud-data', also: ['S14'], iface: I.DisplayDataServer, field: 'functionalLibraryData', flags: 'rs', cols: [['accSym',['activeCruiseControl','symbolACC'],'e'],['accBars',['activeCruiseControl','accBarsHUD'],'n'],['accColour',['activeCruiseControl','barsColorACC'],'e'],['vsli',['xSpeedLimitAssist','vSLISymbol'],'e'],['vsliSpeed',['xSpeedLimitAssist','vSLISpeedValue'],'n'],['ldm','ldmSym','e'],['ldmColour','ldmSymColor','e'],['limiter','statusLimiter','e'],['cruise','cruiseCtrlSpeedHUD','n'],['hud',['system','statusHUD'],'e']] },
    { set: 'S8', p: 'P15', tag: 'hud-data2', also: ['S14'], iface: I.DisplayDataServer2, field: 'functionalLibraryData', flags: 'rs', cols: [['setSpeed',['ldmSetSpeed','ldmSetSpeedValue'],'n'],['setColour',['ldmSetSpeed','ldmSetSpeedColour'],'e'],['icon','ldmIconId','e'],['iconState','ldmIconState','e'],['bars','ldmAccBars','e'],['sliState',['xSpeedLimitAssist','sliState'],'e'],['sliValue',['xSpeedLimitAssist','sliValue'],'e'],['npi',['npiData','npiState'],'e'],['warnIC',['speedWarning','speedWarningIC'],'e'],['hud',['system','hudStatus'],'e']] },
    { set: 'S8', p: 'P15', tag: 'assist-avail', also: ['S14'], iface: I.MultimodalControlDriverAssistance, field: 'functionAvailabilityDriverAssistance', flags: 'rs', cols: [['acc','proposalAvailabilityACC','e'],['sla','proposalAvailabilitySLA','e'],['sld','proposalAvailabilitySLD','e'],['dcc','proposalAvailabilityDCC','e'],['setSpeed','valueSetSpeed','n'],['setInfo','infoSetSpeed','n'],['proposal','proposalAssistFunction','e']] },
    { set: 'S8', p: 'P15', tag: 'front-vehicle', also: ['S14'], iface: I.GapVehicleAhead, field: 'DataFrontVehicle', flags: 's', gapMs: 1000, cols: [['object','frontVehicleObjectID','n'],['gapX','frontVehicleGapX','n'],['gapY','frontVehicleGapY','n'],['speedX','frontVehicleSpeedX','n'],['speedY','frontVehicleSpeedY','n'],['qualifier','qualifierEventDataFunctionFrontVehicle','e'],['qualifierExt','qualifierExtendedFunctionFrontVehicle','e']] },
    // ---- S9 P16 ----
    { set: 'S9', p: 'P16', tag: 'tyre-pressure', iface: I.TPMS, field: 'statusTyrePressure', flags: 'rs', cap: 60, pollMs: 15000, cols: [['fl','actualValuePressureTyreFLH','n'],['fr','actualValuePressureTyreFRH','n'],['rl','actualValuePressureTyreRLH','n'],['rr','actualValuePressureTyreRRH','n']] },
    { set: 'S9', p: 'P16', tag: 'tyre-temp', iface: I.TPMS, field: 'statusTyreTemperature', flags: 'rs', cap: 60, pollMs: 15000, cols: [['fl','actualValueTemperatureTyreFLH','n'],['fr','actualValueTemperatureTyreFRH','n'],['rl','actualValueTemperatureTyreRLH','n'],['rr','actualValueTemperatureTyreRRH','n']] },
    { set: 'S9', p: 'P16', tag: 'tyre-target', iface: I.TPMS, field: 'statusTargetTyrePressure', flags: 'rs', cap: 60, pollMs: 15000, cols: [['fl','targetPressureTyreFLH','n'],['fr','targetPressureTyreFRH','n'],['rl','targetPressureTyreRLH','n'],['rr','targetPressureTyreRRH','n']] },
    { set: 'S9', p: 'P16', tag: 'tyres-status', iface: I.TPMS, field: 'statusTyresStatus', flags: 'rs', cap: 60, pollMs: 15000, cols: [['alive','aliveStatusTyre','n'],['info','qualifierFunctionTyreInformation','n'],['loss','qualifierTyrePressureLoss','n'],['failure','qualifierTyreFailure','n']] },
    { set: 'S9', p: 'P16', tag: 'oil-level', iface: I.Vehicle2, field: 'statusOilDipstick2', flags: 'rs', cols: [['m1','statusOilLevelMeasurement1','n'],['level','fluidLevelEngineOilRelative','e'],['m2','statusOilLevelMeasurement2','n'],['possible','statusOilLevelMeasurementPossible','e']] },
    { set: 'S9', p: 'P16', tag: 'oil-temp2', iface: I.CDS2, field: 'statusInjectionVolume', flags: 'rs', cols: [['oil','oilTemperature','n'],['injection','injectionVolumeFuelEngine','n']] },
    { set: 'S9', p: 'P16', tag: 'sport-display', iface: I.FES, field: 'statusSwitchDriveDynamicSport2', flags: 'rs', cols: [['boost','displayBoostPressure','n'],['boostMax','displayMaximumValueBoostPressure','n'],['lat','displayLateralAcceleration','n'],['long','displayLongitudinalAcceleration','n'],['degradation','reasonDegradationPowertrain','e']] },
    { set: 'S9', p: 'P16', tag: 'power-torque', iface: I.FES, field: 'statusVehicleDynamicEngine', flags: 'rs', cols: [['power','displaySportEnginePower','n'],['torque','displaySportEngineTorque','n']] },
    { set: 'S9', p: 'P16', tag: 'engine-max', iface: I.FES, field: 'statusVehicleDynamicEngineMaxValue', flags: 'rs', cols: [['power','displayMaximumValuePower','n'],['torque','displayMaximumValueTorque','n']] },
    // ---- S9 P17 ----
    { set: 'S9', p: 'P17', tag: 'cons-now', iface: I.ResetLogic, field: 'currentConsumption', flags: 'rs', gapMs: 5000, cols: [['scale','consumptionCombustionCurrentScale','n'],['digit','consumptionCombustionCurrentDigit','n'],['unit','combustionUnit','e']] },
    { set: 'S9', p: 'P17', tag: 'cons-history', iface: I.ConsumptionHistory3, field: 'consumptionHistoryFull', flags: 'rs', gapMs: 5000, cap: 60, cols: [['reason', 'updateReason', 'n'], ['unit', 'unitConsumptionHistoryConsumption', 'e'], ['max', 'maxConsumptionValueConsumption', 'n'], ['avg', 'consumptionHistoryAverageValue', 'n'], ['historic', 'consumptionHistoryHistoricValue', 'n'], ['distance', 'counterDistance', 'n']],
      sub: { path: 'consumptionHistoryTable', label: 'bars', cols: [['bar', 'barPosition', 'n'], ['of', 'totalBarNumberInSegmet', 'n'], ['value', 'consumptionHistoryValue', 'n'], ['type', 'barType', 'e']] } },
    { set: 'S9', p: 'P17', tag: 'heading', iface: I.Positioning, field: 'currentLocation', flags: 'rs', instance: 'Main_Instance', cols: [['heading','heading','p'],['status','status','e']] },
    { set: 'S9', p: 'P17', tag: 'gps-ext', iface: I.GPSData, field: 'GPSPositionExtendedCAN', flags: 'rs', cols: [['heading','statusHeadingGPSCAN','p'],['height','statusHeightGPSCAN','k'],['quality','statusQualityPositionGPSCAN','n']] },
    { set: 'S9', p: 'P17', tag: 'cbs-list', iface: I.KombiInterface_2, field: 'cbsDataServiceList', flags: 'rs', fmt: 'cbs' },
    // ---- S10 P18: the KOMBI's display state, for the black box (BS: docs/boxes); the eight fields of S6 / S7 it also needs carry also: ['S10'] ----
    { set: 'S10', p: 'P18', tag: 'kombi-basic', iface: I.KombiIF, field: 'basicConfigKombi', flags: 'rs', cols: [['content2', 'baseSetupInstrumentPackContent2', 'x'], ['preselect2', 'baseSetupPreselectInstrumentPack2', 'n'], ['linkHeadUnit', 'displaySetupLinkHeadUnit', 'n'], ['navType', 'baseSetupNavigationDisplayType', 'n'], ['entertainment', 'baseSetupEntertainmentSTGDisplay', 'n'], ['dzmOrPower', 'baseSetupDZMorPowermeterDisplay', 'n']] },
    { set: 'S10', p: 'P18', tag: 'welcome-animation', iface: I.KombiIF, field: 'statusWelcomeAnimation', flags: 'rs', cols: [['staging', 'statusStagingMaster', 'e'], ['trigger', 'triggerStagingHeadUnit', 'e']] },
    { set: 'S10', p: 'P18', tag: 'gearbox-secure', iface: I.Powertrain, field: 'dataDisplayGearboxSecure', flags: 's', cols: [['d1', 'dummy1', 'e'], ['d2', 'dummy2', 'e'], ['d3', 'dummy3', 'e'], ['d4', 'dummy4', 'e'], ['d5', 'dummy5', 'e'], ['d6', 'dummy6', 'e'], ['d7', 'dummy7', 'e'], ['d8', 'dummy8', 'e'], ['intervention', 'statusAvailabilityInterventionPowertrainGearbox', 'e']] },
    { set: 'S10', p: 'P18', tag: 'dialog-state', iface: I.Dialog, field: 'dialogState', flags: 'rs', instance: 'HMISpeechHU', fmt: 'enum' },
    // cruise RC: the gear is also read with S14 (downshifts while the cruise slows the car)
    { set: 'S10', p: 'P18', tag: 'gearbox-status', also: ['S14'], iface: I.VehicleInformation, field: 'statusGearboxDrive', flags: 's', cols: [['stage', 'statusActualStageDrive', 'e'], ['gear', 'statusActualGearDrive', 'e'], ['target', 'statusTargetStageDrive', 'e'], ['qualifier', 'qualifierStatusActualStageDrive', 'n']] },
    { set: 'S10', p: 'P18', tag: 'gearbox-display', iface: I.MDrive, field: 'dataDisplayGearbox', flags: 's', cols: [['program', 'displayProgramGearbox', 'e'], ['logic', 'displayDriveLogicGearbox', 'e']] },
    { set: 'S10', p: 'P18', tag: 'fes-switch', iface: I.FES, field: 'statusFESVehicleDynamicSwitchHMI', flags: 'rs', cols: [['mode', 'actualValueModeDrivingExperience', 'e'], ['mmi', 'requestSwitchDrivingExperienceMMIDisplay', 'e'], ['kombiList', 'requestSwitchDrivingExperienceInstrumentPackDisplay', 'e'], ['startup', 'statusSetupStartUpModusDrivingExperience', 'e'], ['availability', 'displayAvailibilityModeDrivingExperience', 'e'], ['display', 'displayModeDrivingExperience', 'e'], ['display2', 'displayModeDrivingExperience2', 'e']] },
    // ---- S11 P19: f30's unwired signals: indicators, belts, seats, lights, dimmer, the consumption lines, the Eco Pro range and bars ----
    { set: 'S11', p: 'P19', tag: 'indicate', iface: I.CDS2, field: 'statusIndicate', flags: 'rs', cols: [['direction', 'statusIndicateDirection', 'n']] },
    { set: 'S11', p: 'P19', tag: 'belts', iface: I.CDS2, field: 'statusBeltContacts2', flags: 'rs', cols: [['driver', 'statusBeltBuckleSwitchDR', 'e'], ['passenger', 'statusBeltBuckleSwitchPS', 'e'], ['rearLeft', 'statusBeltBuckleSwitchRLH', 'e'], ['rearMiddle', 'statusBeltBuckleSwitchRM', 'e'], ['rearRight', 'statusBeltBuckleSwitchRRH', 'e']] },
    { set: 'S11', p: 'P19', tag: 'seats', iface: I.CDS2, field: 'statusSeatOccupancy', flags: 'rs', cols: [['driver', 'statusSeatOccupyingDR', 'e'], ['passenger', 'statusSeatOccupyingPS', 'e'], ['rearLeft', 'statusSeatOccupyingRLH', 'e'], ['rearRight', 'statusSeatOccupyingRRH', 'e']] },
    { set: 'S11', p: 'P19', tag: 'lights', iface: I.Vehicle2, field: 'statusLightStatus', flags: 'rs', cols: [['mainBeam', 'statusMainBeam_headlightFlasher', 'e'], ['frontFog', 'statusFrontFogLight', 'e'], ['rearFog', 'statusRearFogLight', 'e'], ['position', 'statusPositionLight', 'e'], ['dipped', 'statusDippedBeam', 'e'], ['error', 'statusLightStatusError', 'e']] },
    { set: 'S11', p: 'P19', tag: 'dimmer', iface: I.Vehicle2, field: 'statusDimmer', flags: 'rs', cols: [['illumination', 'controlIlluminationSwitch', 'n']] },
    { set: 'S11', p: 'P19', tag: 'cons-regular', iface: I.KombiIF, field: 'statusConsumptionValueRegularA', flags: 'rs', gapMs: 5000, cols: [['v1', 'consumptionValueRegular1', 'n'], ['v2', 'consumptionValueRegular2', 'n'], ['v3', 'consumptionValueRegular3', 'n'], ['v4', 'consumptionValueRegular4', 'n']] },
    { set: 'S11', p: 'P19', tag: 'cons-eco', iface: I.KombiIF, field: 'statusConsumptionValueECOa', flags: 'rs', gapMs: 5000, cols: [['v1', 'consumptionValueECO1', 'n'], ['v2', 'consumptionValueECO2', 'n'], ['v3', 'consumptionValueECO3', 'n'], ['v4', 'consumptionValueECO4', 'n']] },
    { set: 'S11', p: 'P19', tag: 'eco-range', iface: I.KombiIF, field: 'statusECORange', flags: 'rs', gapMs: 5000, cols: [['range', 'displayRangeECO', 'n']] },
    { set: 'S11', p: 'P19', tag: 'driving-style', iface: I.KombiIF, field: 'statusDrivingStyleDisplay', flags: 'rs', cols: [['c1', 'drivingBehaviourECOCategorie1', 'n'], ['c2', 'drivingBehaviourECOCategorie2', 'n'], ['c3', 'drivingBehaviourECOCategorie3', 'n'], ['c1s', 'drivingBehaviourECOCategorie1Status', 'e'], ['c2s', 'drivingBehaviourECOCategorie2Status', 'e'], ['c3s', 'drivingBehaviourECOCategorie3Status', 'e']] },
    // ---- S13 P22 "Знаки" (the lead, 2026-11-18, for the owner at the car with a 30 on the cluster): where the cluster's limit comes from.
    //      EVENTS (flags 'b' = declared as _broadcasts, allowed for this set only by the lead's decision) and two FASuS fields. A sign's
    //      position or location, and every time stamp, are never read.
    { set: 'S13', p: 'P22', tag: 'tsr', iface: I.TrafficSignRecognition, field: 'TrafficSignRecognition', flags: 'b', cols: [['presentWithdrawalLimitSpeed', 'presentWithdrawalLimitSpeed', 'n'], ['recognitionNoPassing', 'recognitionNoPassing', 'n'], ['nextWithdrawalLimitSpeed', 'nextWithdrawalLimitSpeed', 'n'], ['presentClassLimitSpeed', 'presentClassLimitSpeed', 'n'], ['nextClassLimitSpeed', 'nextClassLimitSpeed', 'n'], ['countryCodingTrafficSign', 'countryCodingTrafficSign', 'n'], ['displayTextMessage', 'displayTextMessage', 'n'], ['unitOfMeasurementSpeedLimit', 'unitOfMeasurementSpeedLimit', 'n'], ['displayTextMessageNpi', 'displayTextMessageNpi', 'n'], ['statusDataMatchingCameraADAS', 'statusDataMatchingCameraADAS', 'n'], ['statusStreetTyp', 'statusStreetTyp', 'n'], ['evaluationStreetTyp', 'evaluationStreetTyp', 'n'], ['displaySupplementalSign', 'displaySupplementalSign', 'n'], ['triggerPresentClassLimitSpeed', 'triggerPresentClassLimitSpeed', 'n'], ['displaySpeedNPIDistance', 'displaySpeedNPIDistance', 'n'], ['controlSLIWarning', 'controlSLIWarning', 'n']] },
    { set: 'S13', p: 'P22', tag: 'cam-signs', iface: I.SignRecognitionFrontCamera, field: 'TrafficSignRecognitionFrontCamera', flags: 'b', cols: [['qualifier', 'eventDataQualifier', 'e'], ['extQualifier', 'extendedQualifier', 'e'], ['version', ['trafficSignRecognition', 'version'], 'n'], ['visibility', ['trafficSignRecognition', 'visibilityCondition'], 'e'], ['numberSigns', ['trafficSignRecognition', 'numberSigns'], 'n'], ['unit', ['trafficSignRecognition', 'speedLimitUnit'], 'e'], ['qualities', 'trafficSignRecognitionQuality', 't']],
      sub: { path: 'trafficSign', label: 'signs', cols: [['value', 'value', 'n'], ['type', 'type', 'e'], ['form', 'trafficSignForm', 'e'], ['supp1', 'firstSupplementalType', 'e'], ['supp2', 'secondSupplementalType', 'e'], ['info', 'additionalInfo', 'e'], ['variable', 'variable', 'b']] } },
    { set: 'S13', p: 'P22', tag: 'cam-legacy', iface: I.SignRecognitionFrontCameraLegacy, field: 'RecognitionTrafficSignCamera', flags: 'b', cols: [['id', 'trafficSignID', 'n'], ['type', 'trafficSignType', 'n'], ['addOn1', 'trafficSignAddOnType1', 'n'], ['addOn2', 'trafficSignAddOnType2', 'n'], ['quality', 'qualityRecognitionTrafficSign', 'n'], ['value', 'trafficSignValue', 'n'], ['unit', 'speedLimitUnitOfMeasurement', 'n'], ['status', 'trafficSignStatus', 'n']] },
    { set: 'S13', p: 'P22', tag: 'cam-legacy2', iface: I.SignRecognitionFrontCameraLegacy, field: 'recognitionTrafficSignCamera2', flags: 'b', cols: [['qualifier', 'eventDataQualifier', 'e'], ['extQualifier', 'extendedQualifier', 'e'], ['version', ['trafficSignRecognition', 'version'], 'n'], ['visibility', ['trafficSignRecognition', 'visibilityCondition'], 'e'], ['numberSigns', ['trafficSignRecognition', 'numberSigns'], 'n'], ['unit', ['trafficSignRecognition', 'speedLimitUnit'], 'e'], ['qualities', 'trafficSignRecognitionQuality', 't']],
      sub: { path: 'trafficSign', label: 'signs', cols: [['value', 'value', 'n'], ['type', 'type', 'e'], ['form', 'trafficSignForm', 'e'], ['supp1', 'firstSupplementalType', 'e'], ['supp2', 'secondSupplementalType', 'e'], ['info', 'additionalInfo', 'e'], ['relevance', 'relevance', 'e'], ['variable', 'variable', 'b']] } },
    { set: 'S13', p: 'P22', tag: 'ccp-limit', iface: I.CCP, field: 'effectiveSpeedLimit', flags: 'b', one: ['speedLimit', 'n'] },
    { set: 'S13', p: 'P22', tag: 'ccp-unit', iface: I.CCP, field: 'speedLimitUnit', flags: 'b', one: ['speedLimitUnit', 'e'] },
    { set: 'S13', p: 'P22', tag: 'ccp-variable', iface: I.CCP, field: 'variableSpeedLimitSign', flags: 'b', one: ['variableSide', 'e'] },
    { set: 'S13', p: 'P22', tag: 'ccp-builtup', iface: I.CCP, field: 'builtupAreaFlag', flags: 'b', one: ['isBuiltupArea', 'b'] },
    { set: 'S13', p: 'P22', tag: 'sli-text', iface: I.FASuS, field: 'statusSLITextMessage', flags: 'rs', cols: [['text', 'displayTextMessage', 'e']] },
    { set: 'S13', p: 'P22', tag: 'sign-config', iface: I.FASuS, field: 'statusRoadSignConfigStatus', flags: 'rs', cols: [['country', 'countryCodingTrafficSign', 'e'], ['unit', 'unitOfMeasurementSpeedLimit', 'e']] },
    // ---- S14 P23 "Круїз і дистанція" (the owner, 2026-11-19: every metric an adaptive cruise could use; the car has no active
    //      cruise but has the front collision warning, so the camera tracks the vehicle ahead). The S8 fields of P15 that belong
    //      here carry also: ['S14']. Events ('b') and whole values ('tree': numbers and enum names only, see format.js fmtTree).
    { set: 'S14', p: 'P23', tag: 'front-vehicle-ext', iface: I.GapVehicleAhead, field: 'DataFrontVehicleExtended', flags: 's', cols: [['object', 'frontVehicleExtendedObjectID', 'n'], ['type', 'frontVehicleExtendedObjectType', 'e'], ['move', 'frontVehicleExtendedStatusMove', 'e'], ['width', 'frontVehicleExtendedWidth', 'n']] },
    { set: 'S14', p: 'P23', tag: 'gap-ahead', iface: I.GapVehicleAhead, field: 'GapVehicleDrivingAhead', flags: 's', cols: [['qualifier', 'qualifierFunctionVehicleDrivingAhead', 'e'], ['measurement', 'statusMeasurementVehicleDrivingAhead', 'e'], ['gap', 'gapVehicleDrivingAhead', 'n'], ['type', 'vehicleTypeVehicleDrivingAhead', 'e'], ['lamps', 'lampStatusVehicleDrivingAhead', 'e']] },
    { set: 'S14', p: 'P23', tag: 'keep-dist-1', iface: I.KeepDistanceObjects, field: 'keepDistanceObjects1', flags: 'b', fmt: 'tree', tree: { strip: ['KeepDistObj', 'KeepDist', 'keepDist'] } },
    { set: 'S14', p: 'P23', tag: 'keep-dist-2', iface: I.KeepDistanceObjects, field: 'keepDistanceObjects2', flags: 'b', fmt: 'tree', tree: { strip: ['KeepDistObj', 'KeepDist', 'keepDist'] } },
    { set: 'S14', p: 'P23', tag: 'keep-dist-params', iface: I.KeepDistanceObjects, field: 'keepDistanceParameters', flags: 'b', fmt: 'tree', tree: { strip: ['KeepDistObj', 'KeepDist', 'keepDist'] } },
    { set: 'S14', p: 'P23', tag: 'view-input', iface: I.AssistedDrivingViewInput, field: 'assistedDrivingViewFunctionInputIbVip', flags: 'b', fmt: 'tree', tree: { strip: ['assistedDrivingView'] } },
    { set: 'S14', p: 'P23', tag: 'display-speed', iface: I.StatusDisplayXADAndSpeed, field: 'statusDisplaySpeed', flags: 's', cols: [['value', 'displayedValueSpeed', 'n'], ['unit', 'unitSpeed', 'e']] },
    { set: 'S14', p: 'P23', tag: 'display-xad', iface: I.StatusDisplayXADAndSpeed, field: 'statusDisplayXAD', flags: 's', fmt: 'tree' },
    { set: 'S14', p: 'P23', tag: 'ad-velocity', iface: I.HMIControlAD, field: 'desiredDisplayedVelocity', flags: 's', cols: [['velocity', 'displayedVelocity', 'n'], ['colour', 'displayedVelocityColor', 'e'], ['icon', 'displayedVelocityIcon', 'e']] },
    { set: 'S14', p: 'P23', tag: 'ad-speed-lock', iface: I.HMIControlAD, field: 'controlSpeedLock', flags: 's', cols: [['unlock', 'unlockRequested', 'b']] },
    { set: 'S14', p: 'P23', tag: 'ad-state', iface: I.HMIControlAD, field: 'stateAD', flags: 's', fmt: 'tree' },
    { set: 'S14', p: 'P23', tag: 'ad-state-legacy', iface: I.StateAutonomousDrivingLegacy, field: 'stateAutonomousDriving', flags: 's', cols: [['state', 'statusAutonomousDriving', 'e'], ['crash', 'brcCtrSafeCrash', 'e']] },
    { set: 'S14', p: 'P23', tag: 'assist-message', iface: I.DriverAssistanceExtendedMessages, field: 'coordinatedExtendedMessageDriverAssistance', flags: 'rs', cols: [['id', 'coordinatedExtendedMessageDriverAssistanceID', 'n'], ['value', 'coordinatedExtendedMessageDriverAssistanceValue', 'n'], ['info', 'coordinatedExtendedMessageDriverAssistanceInformation', 'e']] },
    { set: 'S14', p: 'P23', tag: 'fcw-setting', iface: I.SettingsDriverAssistance, field: 'settingFrontCollisionWarning', flags: 's', cols: [['value', 'value', 'e'], ['availability', 'availability', 'e'], ['deactivated', 'availabilityDeactivated', 'e']] },
    { set: 'S14', p: 'P23', tag: 'fcw-sound', iface: I.SettingsDriverAssistance, field: 'settingFrontCollisionWarningSound', flags: 's', cols: [['value', 'value', 'e'], ['availability', 'availability', 'e']] },
    { set: 'S14', p: 'P23', tag: 'foresight-status', iface: I.StatusDriverAssistanceFunctions, field: 'statusForesight', flags: 's', cols: [['function', 'statusForesightFunction', 'e'], ['sub', 'statusForesightSubfunctions', 'x']] },
    { set: 'S14', p: 'P23', tag: 'warn-brake', iface: I.FASuS, field: 'requestWarnBrakeCoordinatorDisplay', flags: 'rs', fmt: 'tree' },
    { set: 'S14', p: 'P23', tag: 'status-fas', iface: I.FASuS, field: 'statusFAS', flags: 's', fmt: 'tree' },
    { set: 'S14', p: 'P23', tag: 'fas-mode', iface: I.FASuS, field: 'displayDrivingAssistentSystemsMode', flags: 's', fmt: 'tree' },
    { set: 'S14', p: 'P23', tag: 'trajectory', iface: I.FASuS, field: 'statusStateDrivingTrajectory', flags: 'rs', fmt: 'tree' },
    { set: 'S14', p: 'P23', tag: 'foresight2', iface: I.FASuS, field: 'displayForesight2', flags: 'rs', fmt: 'tree' },
    { set: 'S14', p: 'P23', tag: 'speed', iface: I.SpeedAcceleration, field: 'vehicleSpeed', flags: 'rs', gapMs: 500, cols: [['standstill', 'statusSpeedVehicleNearStandstill', 'e'], ['speed', 'speedVehicleCentreOfGravity', 'n'], ['qualifier', 'qualifierSpeedVehicleCentreOfGravity', 'e']] },
    { set: 'S14', p: 'P23', tag: 'direction', iface: I.SpeedAcceleration, field: 'drivingDirection', flags: 'rs', cols: [['confirmed', 'drivingDirectionConfirmed', 'e'], ['unconfirmed', 'drivingDirectionUnconfirmed', 'e']] },
    { set: 'S14', p: 'P23', tag: 'accel-long', iface: I.SpeedAcceleration, field: 'LongitudinalAccelerationCentreOfGravity', flags: 's', gapMs: 500, cols: [['accel', 'longitudinalAccelerationCentreOfGravity', 'n'], ['error', 'longitudinalAccelerationCentreOfGravityErrorAmplitude', 'n'], ['qualifier', 'qualifierLongitudinalAccelerationCentreOfGravity', 'e']] },
    { set: 'S14', p: 'P23', tag: 'accel-lat', iface: I.SpeedAcceleration, field: 'LateralAccelerationCenterOfGravity', flags: 's', gapMs: 500, cols: [['accel', 'lateralAccelerationCentreOfGravity', 'n'], ['error', 'lateralAccelerationCentreOfGravityErrorAmplitude', 'n'], ['qualifier', 'qualifierLateralAccelerationCentreOfGravity', 'e']] },
    { set: 'S14', p: 'P23', tag: 'yaw-speed', iface: I.SpeedAcceleration, field: 'YawSpeedVehicle', flags: 's', gapMs: 500, cols: [['yaw', 'yawVelocityVehicle', 'n'], ['error', 'yawVelocityVehicleErrorAmplitude', 'n'], ['qualifier', 'qualifierYawVelocityVehicle', 'e']] },
    { set: 'S14', p: 'P23', tag: 'dynamics-long', iface: I.SpeedAcceleration, field: 'VehicleDynamicDataLongitudinalAndMassVehicle', flags: 's', gapMs: 500, cols: [['accel', 'longitudinalAccelerationDrivingDirection2', 'n'], ['accelQ', 'qualifierLongitudinalAccelerationDrivingDirection2', 'e'], ['speed', 'vehicleSpeedLongitudinal', 'n'], ['speedQ', 'qualifierVehicleSpeedLongitudinal', 'e'], ['mass', 'emptyMassVehicle', 'n']] },
    { set: 'S14', p: 'P23', tag: 'characteristic-speed', iface: I.SpeedAcceleration, field: 'CharacteristicSpeed', flags: 's', cols: [['speed', 'characteristicSpeed', 'n'], ['error', 'characteristicSpeedErrorAmplitude', 'n'], ['qualifier', 'qualifierCharacteristicSpeed', 'e']] },
    { set: 'S14', p: 'P23', tag: 'accel-long-cog', iface: I.AccelerationProvision, field: 'accelerationLongitudinalCog', flags: 'b', fmt: 'tree', gapMs: 500 },
    { set: 'S14', p: 'P23', tag: 'accel-lat-cog', iface: I.AccelerationProvision, field: 'accelerationLateralCog', flags: 'b', fmt: 'tree', gapMs: 500 },
    { set: 'S14', p: 'P23', tag: 'accel-long-est', iface: I.AccelerationProvision, field: 'vehicleAccelerationLongitudinalEstimated', flags: 'b', fmt: 'tree', gapMs: 500 },
    { set: 'S14', p: 'P23', tag: 'yaw-rate', iface: I.YawRateProvision, field: 'yawRate', flags: 'b', fmt: 'tree', gapMs: 500 },
    { set: 'S14', p: 'P23', tag: 'gradient', iface: I.SurfaceInformation, field: 'longitudinalGradientSurface', flags: 'b', fmt: 'tree' },
    { set: 'S14', p: 'P23', tag: 'pitch-rate', iface: I.RollPitchRate, field: 'pitchRateCog', flags: 'b', fmt: 'tree' },
    { set: 'S14', p: 'P23', tag: 'roll-rate', iface: I.RollPitchRate, field: 'rollRateCog', flags: 'b', fmt: 'tree' },
    { set: 'S14', p: 'P23', tag: 'cds-accel-long', iface: I.CDS2, field: 'statusLongitudinalAccelerationMassCenter', flags: 'rs', gapMs: 500, cols: [['accel', 'longitudinalAccelerationCentreOfGravity', 'n']] },
    { set: 'S14', p: 'P23', tag: 'cds-accel-lat', iface: I.CDS2, field: 'statusLateralAccelerationMassCenter', flags: 'rs', gapMs: 500, cols: [['accel', 'lateralAccelerationCentreOfGravity', 'n']] },
    // cruise RC: (docs/cruise-set-speed-brief.md, Phase 1 "the signal map"): the driver's pedals (to cut the overrides out of the plant
    //      identification), the brake, the four wheel speeds, the infotainment speed the cluster apps already read on the car, two more
    //      ego-speed events and two more grade sources, the engine speed and (also: S14 on S10's line) the gear. Read only: s, rs, b.
    //      The cruise BUTTONS are not in the catalogue: they go from the wheel to the DSC, the head unit only sees the set speed change.
    { set: 'S14', p: 'P23', tag: 'accel-pedal', iface: I.AcceleratorPedal, field: 'AngleAcceleratorPedal', flags: 's', gapMs: 500, cols: [['angle', 'actualValueAngleAcceleratorPedal', 'n'], ['virtual', 'actualValueAngleAcceleratorPedalVirtual', 'n'], ['gradient', 'gradientActualValueAngleAcceleratorPedal', 'n'], ['qualifier', 'qualifierActualValueAngleAcceleratorPedal', 'e'], ['vsAssist', 'dummy2', 'e'], ['eco', 'dummy3', 'e']] },
    { set: 'S14', p: 'P23', tag: 'brake-driver', iface: I.VehicleStabilization, field: 'StabilizationManagement', flags: 's', gapMs: 500, cols: [['braking', 'statusBrakingDriver', 'n'], ['brakingMSA', 'statusBrakingMSA', 'n'], ['fdr', 'qualifierFunctionFDR', 'n'], ['abs', 'qualifierFunctionABS', 'n'], ['asc', 'qualifierFunctionASC', 'n'], ['dscUnit', 'statusUnitRunDSC', 'e']] },
    { set: 'S14', p: 'P23', tag: 'brake-driver-hu', iface: I.A4A, field: 'statusA4AFDRControl', flags: 'rs', gapMs: 500, cols: [['braking', 'statusBrakingDriver', 'n'], ['fdr', 'qualifierFunctionFDR', 'n']] },
    { set: 'S14', p: 'P23', tag: 'brake-switch', iface: I.Powertrain, field: 'InformationVehicleDrive', flags: 's', cols: [['bls', 'dummy2', 'e'], ['clutch', 'dummy3', 'e'], ['msaButton', 'dummy4', 'e']] },
    { set: 'S14', p: 'P23', tag: 'brake-light', iface: I.Light, field: 'LampExterior', flags: 's', cols: [['brakeLight', 'controlFunctionBrakeLight', 'e'], ['brakeForce', 'controlFunctionBrakeForceDisplay', 'e']] },
    { set: 'S14', p: 'P23', tag: 'drive-torque', iface: I.Powertrain, field: 'WheelMomentDrive4', flags: 's', gapMs: 500, cols: [['vsAssist', 'statusInterfaceDriverAssistenceSystemTargetLimit', 'e'], ['direction', 'statusDrivingDirectionDriversChoice', 'e'], ['engaged', 'statusPositiveEngagementPowerTrain', 'e'], ['rearAxleRpm', 'actualValueRPMBackAxleRedundant', 'n'], ['rearAxleQ', 'qualifierActualValueRPMBackAxleRedundant', 'e']] },
    { set: 'S14', p: 'P23', tag: 'wheel-rpm', iface: I.Powertrain, field: 'ActualValueRPMWheel', flags: 's', gapMs: 500, cols: [['fl', 'actualValueRPMWheelFLH', 'n'], ['fr', 'actualValueRPMwheelFRH', 'n'], ['rl', 'actualValueRPMWheelRLH', 'n'], ['rr', 'actualValueRPMWheelRRH', 'n'], ['qFL', 'qualifierActualValueRPMWheelFLH', 'e'], ['qRL', 'qualifierActualValueRPMWheelRLH', 'e'], ['source', 'dummy', 'e']] },
    { set: 'S14', p: 'P23', tag: 'velocity', iface: I.VelocityProvision, field: 'velocityVehicle', flags: 'b', fmt: 'tree', gapMs: 500 },
    { set: 'S14', p: 'P23', tag: 'velocity-long', iface: I.VelocityProvision, field: 'velocityVehicleLongitudinal', flags: 'b', fmt: 'tree', gapMs: 500 },
    { set: 'S14', p: 'P23', tag: 'car-speed2', iface: I.Vehicle2, field: 'statusCarSpeed2', flags: 'rs', gapMs: 500, cols: [['speed', 'speedVehicleCentreOfGravity', 'n']] },
    { set: 'S14', p: 'P23', tag: 'engine-rpm', iface: I.CDS, field: 'statusEngineSpeed2', flags: 'rs', gapMs: 500, cols: [['rpm', 'actualValueRPMEngineCrankshaft', 'n']] },
    { set: 'S14', p: 'P23', tag: 'grade-xview', iface: I.XView, field: 'statusGradientRoadway', flags: 'rs', cols: [['grade', 'actualValueLongitudinalGradientRoadway', 'n'], ['qualifier', 'qualifierActualValueLongitudinalGradientRoadway', 'e']] },
    { set: 'S14', p: 'P23', tag: 'lane-slope', iface: I.VehicleModel, field: 'LaneSlope', flags: 's', cols: [['grade', 'actualValueLongitudinalGradientRoadway', 'n'], ['gradeFast', 'actualValueLongitudinalGradientRoadwayFast', 'n'], ['qualifier', 'qualifierActualValueLongitudinalGradientRoadway', 'e'], ['transverse', 'actualValueTransverseGradientRoadway', 'n'], ['transverseQ', 'qualifierActualValueTransverseGradientRoadway', 'e']] },
    // ---- S15 P24 "Об'єкти камери": the camera's and the fused object lists and the car's own motion as the camera sees it. Heavy
    //      events: a line at most every 2 s per event, 300 lines each. Positions are RELATIVE to the car (metres ahead / aside);
    //      the car's own dead-reckoned position and heading are left out (skip), like every time stamp.
    { set: 'S15', p: 'P24', tag: 'cam-objects', iface: I.ObjectsFrontCamera, field: 'ObjectRecognition', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'cam-position', iface: I.ObjectsFrontCamera, field: 'ObjectPosition', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'cam-movement', iface: I.ObjectsFrontCamera, field: 'ObjectMovement', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'cam-probability', iface: I.ObjectsFrontCamera, field: 'ObjectProbability', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'cam-specific', iface: I.ObjectsFrontCamera, field: 'ObjectSensorSpecificFrontCamera', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'cam2-objects', iface: I.ObjectsFrontCamera2, field: 'ObjectRecognition', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'cam2-position', iface: I.ObjectsFrontCamera2, field: 'ObjectPosition', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'cam2-movement', iface: I.ObjectsFrontCamera2, field: 'ObjectMovement', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'cam2-polar', iface: I.ObjectsFrontCamera2, field: 'ObjectPolarCoordinates', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'cam2-probability', iface: I.ObjectsFrontCamera2, field: 'ObjectProbability', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'cam2-specific', iface: I.ObjectsFrontCamera2, field: 'ObjectSensorSpecificFrontCamera', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'fused-objects', iface: I.FusedSensorDetection, field: 'objects', flags: 'b', fmt: 'tree', tree: { skip: ['std_dev', 'frameId'], entries: 6, max: 9000 } },
    { set: 'S15', p: 'P24', tag: 'merged-objects', iface: I.DAADataServer, field: 'ObjectListMerged', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'object-info1', iface: I.DAADataServer, field: 'ObjectInformation1', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'object-info2', iface: I.DAADataServer, field: 'ObjectInformation2', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'object-lanes', iface: I.DAADataServer, field: 'ObjectAssignment', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'fas-view', iface: I.DAADataServer, field: 'FASView', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'suaar-objects', iface: I.ObjectListSuAAR, field: 'suAARObjectList', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'ego-cam-motion', iface: I.EgomotionCamera, field: 'egomotionCameraCartesian', flags: 'b', fmt: 'tree', tree: { skip: ['posXEgoCam', 'posYEgoCam', 'posZEgoCam'] } },
    { set: 'S15', p: 'P24', tag: 'ego-cam-rotation', iface: I.EgomotionCamera, field: 'egomotionCameraRotation', flags: 'b', fmt: 'tree' },
    { set: 'S15', p: 'P24', tag: 'ego-motion', iface: I.EgoMotionLegacy, field: 'ProperMotionVehicle', flags: 'b', fmt: 'tree', tree: { skip: ['xPositionProperMotionVehicle', 'yPositionProperMotionVehicle', 'yawAngleProperMotionVehicle'] } },
    // ---- S16 P25 "Наступний поворот" (car issues NV, 2026-11-19): the owner saw the next turns on the cluster, in the place of the map,
    //      while CarPlay guided, and BMW's own manoeuvre fields (S7) stayed empty. Every place the catalogue offers for a projected
    //      manoeuvre or for the cluster's guidance box: the projected-mode guiding service CarPlay feeds (its fields and its stream
    //      command), the guidance engine's event lists and rendered contents (the box's scene id and the event it shows), the stream
    //      status, CarPlay's own turn-by-turn mode, the remote-cluster guidance events, the old CAN feed to the cluster. All of S7 and the
    //      cluster's view fields carry also: ['S16']. Road, instruction and view names only as lengths; positions and bearings never.
    { set: 'S16', p: 'P25', tag: 'pm-road', iface: I.ProjectedModeGuiding, field: 'currentRoad', flags: 'rs', instance: 'Main_Instance', fmt: 'description' },
    { set: 'S16', p: 'P25', tag: 'pm-waypoints', iface: I.ProjectedModeGuiding, field: 'waypoints', flags: 'rs', instance: 'Main_Instance', gapMs: 5000, cols: [['travel','travelTime','n'],['delay','delayTime','n'],['delayStatus','delayStatus','e'],['dist-len',['formattedDistance','distance'],'t'],['unit',['formattedDistance','unit'],'e'],['raw',['formattedDistance','rawDistance'],'n'],['toFinal','distanceFromCurrentToFinalDestination','n'],['flag','isCheckeredFlag','b'],['stopover','stopOverNumber','n'],['charging','isChargingStation','b'],['etaInvalid',['estimatedArrivalTime','time','invalid'],'b'],['etaH',['estimatedArrivalTime','time','hour'],'n'],['etaM',['estimatedArrivalTime','time','minute'],'n']] },
    { set: 'S16', p: 'P25', tag: 'pm-lanes', iface: I.ProjectedModeGuiding, field: 'currentLaneGuiding', flags: 'rs', instance: 'Main_Instance', fmt: 'lanes' },
    { set: 'S16', p: 'P25', tag: 'pm-route-change', iface: I.ProjectedModeGuiding, field: 'activeRouteChange', flags: 'rs', instance: 'Main_Instance', fmt: 'enum' },
    { set: 'S16', p: 'P25', tag: 'pm-stream', iface: I.ProjectedModeGuiding, field: 'streamCommandChanged', flags: 'b', instance: 'Main_Instance', gapMs: 250, cap: 100, fmt: 'stream' },
    { set: 'S16', p: 'P25', tag: 'stream-status', iface: I.Guidance, field: 'streamStatusChanged', flags: 'b', instance: 'Main_Instance', gapMs: 250, cap: 100, one: ['streamStatus', 'e'] },
    { set: 'S16', p: 'P25', tag: 'route-changed', iface: I.Guidance, field: 'activeRouteChanged', flags: 'b', instance: 'Main_Instance', gapMs: 250, cap: 100, one: ['routeChangeCause', 'e'] },
    { set: 'S16', p: 'P25', tag: 'current-route', iface: I.Guidance, field: 'currentRoute', flags: 'rs', instance: 'Main_Instance', cols: [['session','sessionID','n'],['handle','routeHandle','n']] },
    { set: 'S16', p: 'P25', tag: 'list-views', iface: I.GuidanceEventList, field: 'registeredViews', flags: 'rs', instance: 'Main_Instance', cols: [['len',[],'t']] },
    { set: 'S16', p: 'P25', tag: 'event-list', iface: I.GuidanceEventList, field: 'viewsChanged', flags: 'b', instance: 'Main_Instance', gapMs: 5000, cap: 300, fmt: 'views' },
    { set: 'S16', p: 'P25', tag: 'rendered-views', iface: I.GuidanceRenderedContent, field: 'registeredViews', flags: 'rs', instance: 'Main_Instance', cols: [['len',[],'t']] },
    { set: 'S16', p: 'P25', tag: 'rendered', iface: I.GuidanceRenderedContent, field: 'viewContentChanged', flags: 'b', instance: 'Main_Instance', gapMs: 2000, fmt: 'rendered' },
    { set: 'S16', p: 'P25', tag: 'cp-metadata', iface: I.CarPlayManager, field: 'projectedGuidanceMetadataAvailable', flags: 'rs', instance: 'CarPlayManagerInst1', fmt: 'bool' },
    { set: 'S16', p: 'P25', tag: 'cp-screen', iface: I.CarPlayManager, field: 'onScreenChange', flags: 'b', instance: 'CarPlayManagerInst1', gapMs: 250, one: ['screenOwner', 'e'] },
    { set: 'S16', p: 'P25', tag: 'cp-modes', iface: I.CarPlayAM, field: 'changeModes', flags: 'b', instance: 'CarPlayAMInst1', gapMs: 500, cap: 200, fmt: 'tree', tree: { skip: ['reasonStr'] } },
    { set: 'S16', p: 'P25', tag: 'aa-metadata', iface: I.AndroidAutoProjectedManager, field: 'projectedGuidanceMetadataAvailable', flags: 'rs', instance: 'AndroidAutoProjectedManagerInst1', fmt: 'bool' },
    { set: 'S16', p: 'P25', tag: 'aa-video', iface: I.AndroidAutoProjectedManager, field: 'isVideoStreaming', flags: 'rs', instance: 'AndroidAutoProjectedManagerInst1', fmt: 'bool' },
    { set: 'S16', p: 'P25', tag: 'aa-features', iface: I.AndroidAutoProjectedManager, field: 'featureConfiguration', flags: 'rs', instance: 'AndroidAutoProjectedManagerInst1', cols: [['metadata','guidingMetadataEnabled','b'],['vehicleStatus','vehicleStatusEnabled','b']] },
    { set: 'S16', p: 'P25', tag: 'ric-guidance', iface: I.RICServiceGuidance, field: 'ric_sendEvent', flags: 'b', gapMs: 500, cap: 200, fmt: 'tree', tree: { enumNames: '^(Event|Model)(_[A-Za-z0-9]+)*$' } },
    { set: 'S16', p: 'P25', tag: 'display-sink', iface: I.DisplaySink, field: 'requestSinkSwitch', flags: 'b', gapMs: 250, cap: 100, fmt: 'tree' },
    { set: 'S16', p: 'P25', tag: 'nav-can', iface: I.NavigationCAN, field: 'calculationDataNavigation', flags: 'rs', gapMs: 10000, cols: [['dist','statusDistanceDestinationNavigation','n'],['unit','statusDistanceDestinationNavigationUnitOfMeasurement','e'],['etaH','statusArrivalTimeHour','n'],['etaM','statusArrivalTimeMinute','n'],['ampm','statusTimeAMPM','e'],['day','statusDayFlag','e']] },
    { set: 'S16', p: 'P25', tag: 'lane-feedback', iface: I.FeedbackLaneGuiding, field: 'correctionDataLaneGuiding', flags: 'b', gapMs: 5000, fmt: 'tree' },
    // car issues CT (the owner, 2026-11-19: queryContent approved, a read): CarPlay's next turns AS DATA, asked every 2 s while the phone
    // guides (Guidance.guidingProvider CAR_PLAY / ANDROID_AUTO, read here through S7's guiding-provider); a line only when the reply changed,
    // with the count of unchanged ones; texts as lengths, no road link, no source id
    { set: 'S16', p: 'P25', tag: 'next-turn', iface: I.GuidanceEventList, field: 'queryContent', flags: 'm', instance: 'Main_Instance', gapMs: 2000, fmt: 'turns' },
    // r1120 AC: ---- S17 P26 "ACC" (the owner, 2026-11-19: every metric an adaptive cruise needs, captured on the next drives). ONE
    //      recording set: S14 whole (with what it shares: S8's assistance fields, S10's gear), the drive mode and the gearbox programme
    //      (S10), the indicator and the lights (S11: a lane change, night), the traffic-sign event (S13: the limit), the camera's own
    //      object lists and the lane assignment (S15, at most ACC_ENTRIES objects each in a recording) - all through `also` (see
    //      ACC below) - and its own field, the driver's steering angle (curves, target loss; XView is already read for the grade).
    { set: 'S17', p: 'P26', tag: 'steering', iface: I.XView, field: 'statusSteeringAngleDriver', flags: 'rs', gapMs: 500, cols: [['angle', 'actualValueSteeringAngleDriver', 'n'], ['qualifier', 'qualifierActualValueSteeringAngleDriver', 'e']] },
    // beam HS: ---- S18 P27 "HB" (the Auto Beam round, 2026-11-20): does this car's camera send its light objects and its own high-beam
    //      verdict (it has no high-beam option), and what did the driver do with the beam. The 15 light objects are added below the
    //      table (hb-obj1..15). Every value raw: the units are unknown, nothing is scaled or named by a unit. Events ('b') and
    //      notifier-only fields ('s'); LowBeam and the light switch screen's three fields have a getter ('rs'). The changes of the lamps
    //      and the switches stay in the log while recording (recLog): the log alone then shows the driver's timeline.
    { set: 'S18', p: 'P27', tag: 'hb-control', iface: I.RecogLight, field: 'controlHighBeamAssistant', flags: 'b', gapMs: 1000, cap: 400,
      cols: [['control', 'controlHighBeam', 'n'], ['reason', 'reasonSwitchOffHighBeam', 'x'], ['vehicles', 'numberVehicles', 'n'], ['signs', 'numberRoadSigns', 'n'], ['pedestrians', 'numberPedestrians', 'n'],
          ['calib', 'statusCameraCalibration', 'n'], ['offH', 'cameraCalibrationOffsetHorizontal', 'n'], ['offV', 'cameraCalibrationOffsetVertical', 'n'], ['q', 'qualifierDataControlHighBeamAssistant', 'n'],
          ['qExt', 'qualifierExtendedControlHighBeamAsstistant', 'n'], ['sync', 'syncSignal', 'n']] },
    { set: 'S18', p: 'P27', tag: 'hb-meid1', iface: I.RecogLight, field: 'mEObjectID1', flags: 'b', gapMs: 2000, cap: 100, recSame: 1000,
      cols: [['id1', 'MEIDObject1', 'n'], ['id2', 'MEIDObject2', 'n'], ['id3', 'MEIDObject3', 'n'], ['id4', 'MEIDObject4', 'n'], ['id5', 'MEIDObject5', 'n'], ['id6', 'MEIDObject6', 'n'], ['id7', 'MEIDObject7', 'n'], ['id8', 'MEIDObject8', 'n']] },
    { set: 'S18', p: 'P27', tag: 'hb-meid2', iface: I.RecogLight, field: 'mEObjectID2', flags: 'b', gapMs: 2000, cap: 100, recSame: 1000,
      cols: [['id9', 'MEIDObject9', 'n'], ['id10', 'MEIDObject10', 'n'], ['id11', 'MEIDObject11', 'n'], ['id12', 'MEIDObject12', 'n'], ['id13', 'MEIDObject13', 'n'], ['id14', 'MEIDObject14', 'n'], ['id15', 'MEIDObject15', 'n']] },
    { set: 'S18', p: 'P27', tag: 'hb-lamps', iface: I.Light, field: 'LampExterior2', flags: 's', gapMs: 0, cap: 400, recLog: true,
      cols: [['mainBeam', 'controlFunctionMainBeam', 'e'], ['dipL', 'controlFunctionDippedBeamLeftHand', 'e'], ['dipR', 'controlFunctionDippedBeamRightHand', 'e'],
          ['distL', 'controlLightDistributionLowBeamLeftHand', 'e'], ['distR', 'controlLightDistributionLowBeamRightHand', 'e'], ['laserL', 'controlFunctionLaserLeftHand', 'e'],
          ['laserR', 'controlFunctionLaserRightHand', 'e'], ['cornerL', 'controlFunctionCorneringLightLeftHand', 'e'], ['cornerR', 'controlFunctionCorneringLightRightHand', 'e'],
          ['frontFog', 'controlFunctionFrontFogLight', 'e'], ['flashMode', 'controlModeFunctionSpecialFlashing', 'e']] },
    { set: 'S18', p: 'P27', tag: 'hb-low-beam', iface: I.Light, field: 'LowBeam', flags: 'rs', gapMs: 2000,
      cols: [['lowBeam', 'statusLowBeam', 'e'], ['sensor', 'statusSensorLowBeam', 'e'], ['ambient', 'ambientBrightnessLowBeam', 'n'], ['reason', 'statusLowBeamReason', 'n'],
          ['value', 'statusValueLowBeam', 'n'], ['mb3', 'stateValueDrivingLightMB3', 'n'], ['mb3State', 'stateMB3', 'e']] },
    { set: 'S18', p: 'P27', tag: 'hb-switch', iface: I.Light, field: 'statusOperationLightExterior', flags: 's', gapMs: 0, recLog: true,
      cols: [['switch', 'statusLampSwitch', 'e'], ['event', 'recognitionEventLampSwitch', 'e']] },
    { set: 'S18', p: 'P27', tag: 'hb-indicators', iface: I.Light, field: 'StatusFunctionsIndicators', flags: 's',
      cols: [['direction', 'controlIndicateDirection', 'e'], ['function', 'activeFunctionIndicateDirection', 'e']] },
    { set: 'S18', p: 'P27', tag: 'hb-indicators2', iface: I.Light, field: 'StatusFunctionsIndicators2', flags: 's',
      cols: [['direction', 'controlIndicateDirection', 'e'], ['function', 'activeFunctionIndicateDirection', 'e'], ['overlay', 'overlayFunctionIndicateDirection', 'e']] },
    { set: 'S18', p: 'P27', tag: 'hb-brightness', iface: I.Environment, field: 'StatusBrightnessEnvironment', flags: 's', gapMs: 2000, cols: [['brightness', 'valueBrightnessEnvironment', 'n']] },
    { set: 'S18', p: 'P27', tag: 'hb-prefield', iface: I.Environment, field: 'statusBrightnessPrefield', flags: 's', gapMs: 2000, cols: [['prefield', 'valueBrightnessPrefield', 'n']] },
    { set: 'S18', p: 'P27', tag: 'hb-wiper', iface: I.Wiper, field: 'wiper', flags: 's', gapMs: 2000, cols: [['blade', 'positionWiperBlade', 'e']] },
    { set: 'S18', p: 'P27', tag: 'hb-rain', iface: I.Wiper, field: 'rainSensorWiperSpeed', flags: 's', gapMs: 2000, cols: [['rain', 'intensityRain', 'n'], ['speed', 'speedWiper', 'n'], ['sensor', 'statusRainSensor', 'n']] },
    { set: 'S18', p: 'P27', tag: 'hb-wiper-stalk', iface: I.Wiper, field: 'wiperSteeringColumn', flags: 's', gapMs: 0, recLog: true, bits: { path: 'operationWiperSwitch', label: 'switch' }, cols: [['pot', 'operationWiperPotentiometer', 'e']] },
    { set: 'S18', p: 'P27', tag: 'hb-lightswitch', iface: I.LightswitchOperation, field: 'mainLightswitchState', flags: 'rs', gapMs: 0, recLog: true, fmt: 'enum' },
    { set: 'S18', p: 'P27', tag: 'hb-fog-front', iface: I.LightswitchOperation, field: 'foglightFront', flags: 'rs', gapMs: 0, recLog: true, fmt: 'bool' },
    { set: 'S18', p: 'P27', tag: 'hb-fog-rear', iface: I.LightswitchOperation, field: 'foglightRear', flags: 'rs', gapMs: 0, recLog: true, fmt: 'bool' },
];
// beam HS: the camera's 15 light objects, one event each (three of the names start with a capital M in the catalogue: 11, 12, 15).
// One compact line per object (fmt beamObj, raw numbers); in a recording an object that repeats itself is folded (recSame).
const HB_OBJECT_EVENT = (n) => (n === 11 || n === 12 || n === 15 ? 'M' : 'm') + 'ainBeamAssistantDataObject' + n;
for (let n = 1; n <= 15; n++) {
    TABLE.push({ set: 'S18', p: 'P27', tag: 'hb-obj' + n, iface: I.RecogLight, field: HB_OBJECT_EVENT(n), flags: 'b', slot: n, fmt: 'beamObj', gapMs: 2000, cap: 100, recSame: 1000 });
}

// ---- the sets: each one switchable on its own in the app's centre-screen menu (settings key set1..set9), default all off ----
const SETS = [
    { id: 'S1', key: 'set1', name: 'messages', uk: 'Повідомлення', items: ['P1', 'P2'] },
    { id: 'S2', key: 'set2', name: 'computer', uk: 'Комп’ютер, пробіг, одиниці', items: ['P3', 'P4', 'P5', 'P6'] },
    { id: 'S3', key: 'set3', name: 'body', uk: 'Кузов і напруга', items: ['P7', 'P10'] },
    { id: 'S4', key: 'set4', name: 'media', uk: 'Медіа і радіо', items: ['P8'] },
    { id: 'S5', key: 'set5', name: 'phone', uk: 'Телефон', items: ['P9'] },
    { id: 'S6', key: 'set6', name: 'view and key', uk: 'Вид і кнопки', items: ['P11', 'P13'] },
    { id: 'S7', key: 'set7', name: 'navigation', uk: 'Навігація', items: ['P12', 'P14'] },
    { id: 'S8', key: 'set8', name: 'assistance', uk: 'Допоміжні системи', items: ['P15'] },
    { id: 'S9', key: 'set9', name: 'technical', uk: 'Технічне', items: ['P16', 'P17'] },
    { id: 'S10', key: 'set10', name: 'black box', uk: 'Чорна коробка', items: ['P18'] },
    { id: 'S11', key: 'set11', name: 'unwired', uk: 'Непідключені сигнали f30', items: ['P19'] },
    { id: 'S13', key: 'set13', name: 'signs', uk: 'Знаки', items: ['P22'] },
    { id: 'S14', key: 'set14', name: 'distance and cruise', uk: 'Круїз і дистанція', items: ['P23'] },
    { id: 'S15', key: 'set15', name: 'camera objects', uk: 'Об’єкти камери', items: ['P24'] },
    { id: 'S16', key: 'set16', name: 'next turn', uk: 'Наступний поворот', items: ['P25'] },
    { id: 'S17', key: 'set17', name: 'ACC', uk: 'ACC: усе для адаптивного круїзу', items: ['P26'], label: 'ACC' },      // r1120 AC
    { id: 'S18', key: 'set18', name: 'HB', uk: 'HB: фари і дальнє світло', items: ['P27'], label: 'HB' },              // beam HS
];

// r1120 AC: what the ACC set (S17) reads besides its own field: every field of these sets (and what they share through `also`), and
// these fields of other sets. A camera object list is cut to ACC_ENTRIES objects in a recording (recEntries; the recorder's own cap
// is 16): the budget of docs/r1120/AC-REPORT.md. Applied once, here: the probe, the recorder and the tests only see `also`.
const ACC = {
    sets: ['S14'],
    tags: ['fes-switch', 'gearbox-display', 'indicate', 'lights', 'tsr',
        'cam-objects', 'cam-position', 'cam-movement', 'cam2-objects', 'cam2-position', 'cam2-movement', 'cam2-polar', 'object-lanes', 'fas-view', 'ego-motion'],
};
const ACC_ENTRIES = 8;
TABLE.forEach((f) => {
    const sets = [f.set].concat(f.also || []);
    if (f.set === 'S17' || !(ACC.tags.indexOf(f.tag) >= 0 || ACC.sets.some((id) => sets.indexOf(id) >= 0))) return;
    f.also = (f.also || []).concat(['S17']);
    if (f.set === 'S15') f.recEntries = ACC_ENTRIES;
});
// beam HS: what the HB set (S18) reads besides its own fields, by tag: the stalk (both fields: the bits and the button's line), the
// lamps' commands of S14 (LampExterior), the head unit's own high-beam lamp (S11 lights) and the dimmer, the indicator, the speed
// (Vehicle2, km/h x 1/64), the yaw rate, the steering angle, the gear, the outside temperature (S2), the limit and the nav's built-up
// flag (S13: the town question), the vehicle ahead (S8), and the camera's object lists with the class and the direction of movement
// (S15: the fallback if the light objects stay silent) cut to HB_ENTRIES objects. recLog: these keep their log lines while recorded.
const HB = {
    tags: ['stalk', 'stalk-complete', 'brake-light', 'lights', 'dimmer', 'indicate', 'car-speed2', 'yaw-rate', 'steering', 'gearbox-status',
        'external-display', 'tsr', 'ccp-builtup', 'front-vehicle', 'cam-objects', 'cam-position', 'cam2-objects', 'cam2-position'],
    recLog: ['stalk', 'stalk-complete', 'lights'],
};
const HB_ENTRIES = 4;
TABLE.forEach((f) => {
    if (f.set === 'S18' || HB.tags.indexOf(f.tag) < 0) return;
    f.also = (f.also || []).concat(['S18']);
    if (f.set === 'S15') f.recEntriesBy = { S18: HB_ENTRIES };
    if (HB.recLog.indexOf(f.tag) >= 0) f.recLog = true;
});
// per-set defaults (a field's own gapMs / cap win): messages and doors are events, the drive sets are long
const SET_DEFAULTS = {
    S1: { gapMs: 500, cap: 100 }, S2: { gapMs: 1000, cap: 60 }, S3: { gapMs: 250, cap: 100 }, S4: { gapMs: 1000, cap: 100 },
    S5: { gapMs: 500, cap: 100 }, S6: { gapMs: 500, cap: 150 }, S7: { gapMs: 1000, cap: 200 }, S8: { gapMs: 1000, cap: 200 }, S9: { gapMs: 1000, cap: 200 }, S10: { gapMs: 500, cap: 100 }, S11: { gapMs: 500, cap: 100 }, S13: { gapMs: 250, cap: 300 }, S14: { gapMs: 1000, cap: 1200 }, S15: { gapMs: 2000, cap: 300 },
    S16: { gapMs: 2000, cap: 400 },
    S17: { gapMs: 1000, cap: 1200 },     // r1120 AC: as S14
    S18: { gapMs: 1000, cap: 300 },      // beam HS: the objects and the slow values carry their own gap
};

const instOf = (f) => f.instance || '1';
/** The distinct interfaces with every instance they are read on (the manifest declares one "_instances" per interface). */
function interfaces() {
    const m = {};
    TABLE.forEach((f) => {
        const e = m[f.iface] = m[f.iface] || { iface: f.iface, instances: [], fields: {}, events: [], methods: [] };
        if (e.instances.indexOf(instOf(f)) < 0) e.instances.push(instOf(f));
        if (f.flags === 'b') { if (e.events.indexOf(f.field) < 0) e.events.push(f.field); } else if (f.flags === 'm') { if (e.methods.indexOf(f.field) < 0) e.methods.push(f.field); } else e.fields[f.field] = f.flags;
    });
    return Object.keys(m).map((k) => m[k]);
}
/** The "signals" block of app.json that this table needs (flags merged per field; "*" where several instances are read). */
function manifestSignals() {
    const out = {};
    interfaces().forEach((e) => {
        const o = {};
        o._instances = e.instances.length > 1 ? '*' : e.instances[0];
        Object.keys(e.fields).sort().forEach((k) => { o[k] = e.fields[k]; });
        if (e.events.length) o._broadcasts = e.events.slice().sort();
        if (e.methods.length) o._methods = e.methods.slice().sort();
        out[e.iface] = o;
    });
    return out;
}

module.exports = { I, TABLE, SETS, SET_DEFAULTS, instOf, interfaces, manifestSignals, ACC, ACC_ENTRIES, HB, HB_ENTRIES };
