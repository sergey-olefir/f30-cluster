'use strict';
/**
 * fields.js - the signal probe's field table: every field the car session reads, with its set, its item (P1..P17), the
 * instance it is read on, its flags, and how its value becomes a log line. ONE table drives the subscriptions, the log lines,
 * the manifest ("signals" of app.json, checked against it by bench/test-signal-probe.js) and design/car/probe_fields.json.
 *
 * Unified from the five round-3 branches (twin-r3/sm, sp, sn, sv, sb) on top of main's shared/twin_probe.js and renumbered to
 * the car-signals brief's P1..P17 / sets S1..S9 (docs/car/CP-REPORT.md section 3). READ ONLY: flags r (a NON-ZERO getter id) and
 * s (a notifier) - never w, never a method, never a broadcast; no KombiIF standardCCMessage / extendedCCMessage / newCCMessage,
 * no A19B, no requestDefaultSymbols, no setter of any kind.
 *
 * An entry:
 *   set, p, tag      the set (S1..S9), the item (P1..P17), the field's tag in the log line ("probe: P3 range-tank #2 ...")
 *   also             [set ids]: the field is also read while one of these sets is on (S10 needs eight fields of S6 / S7)
 *   iface, field     the interface and the field; flags "r" / "s" / "rs" as the catalogue allows (checked by the test)
 *   instance         the instance it is read on (default "1"); an interface with several instances is declared "*" in the manifest
 *   gapMs, cap       minimum ms between two lines of this field (the last value wins, "+k folded") and the most lines; per-set defaults below
 *   pollMs           re-read its getter this often (TPMS: BMW's own app only ever reads it)
 *   mark             the line also says how long after the last "Позначка" press the change came (S6)
 *   cols             [[label, path, kind], ...]: kinds n number, e enum name, b bool, x hex, t text LENGTH, k coarse, z known/unknown, p present
 *   sub              { path, label, cols }: after the columns, the array at `path` as "label=N [..] [..]" (the trip computers' bcData[] per reset option)
 *   list / union     { member, cols }: an array of entries (member = the union member holding each) / a single-member union
 *   bits             { path, label }: a raw byte with its previous value and the bits that went up / down
 *   fmt              a named formatter of format.js (enum bool hex temps intersection dart lanes description mediaMenu station metadata
 *                    roles devices calllist cbs activeSource sources)
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
    { set: 'S6', p: 'P11', tag: 'kombi-config', iface: I.KombiIF, field: 'statusConfigurationKombi5', also: ['S7', 'S10'], flags: 'rs', mark: true, cols: [['content2','statusActivationInstrumentPackContent2','x'],['preselect2','statusActivationPreselectInstrumentPack2','e'],['navDisplay','statusNavigationDisplayType','e'],['dzmOrPower','statusDZMorPowermeterDisplay','e'],['entertainment','statusEntertainmentSTGDisplay','e']] },
    { set: 'S6', p: 'P11', tag: 'display-kombi', iface: I.Vehicle2, field: 'statusDisplayKombi', also: ['S10'], flags: 'rs', mark: true, cols: [['view','statusDisplayInstrumentPackM','e']] },
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
    { set: 'S7', p: 'P12', tag: 'guiding-state', iface: I.NavigationStatus, field: 'guidingState', flags: 'rs', fmt: 'enum' },
    { set: 'S7', p: 'P12', tag: 'next-intersection', iface: I.Guidance, field: 'nextIntersection', flags: 'rs', instance: 'Main_Instance', gapMs: 2000, fmt: 'intersection' },
    { set: 'S7', p: 'P12', tag: 'guidance-state', iface: I.Guidance, field: 'guidanceState', flags: 'rs', instance: 'Main_Instance', fmt: 'enum' },
    { set: 'S7', p: 'P12', tag: 'dart', iface: I.Guidance, field: 'conclusiveDart', flags: 'rs', instance: 'Main_Instance', gapMs: 2000, fmt: 'dart' },
    { set: 'S7', p: 'P12', tag: 'lanes', iface: I.Guidance, field: 'currentLaneGuiding', flags: 'rs', instance: 'Main_Instance', gapMs: 2000, fmt: 'lanes' },
    { set: 'S7', p: 'P12', tag: 'next-destination', iface: I.Guidance, field: 'nextDestinationInfo', flags: 'rs', instance: 'Main_Instance', gapMs: 2000, cols: [['travel','travelTime','n'],['delay','delayTime','n'],['delayStatus','delayStatus','e'],['dist-len',['formattedDistance','distance'],'t'],['unit',['formattedDistance','unit'],'e'],['raw',['formattedDistance','rawDistance'],'n'],['toFinal','distanceFromCurrentToFinalDestination','n'],['flag','isCheckeredFlag','b'],['stopover','stopOverNumber','n'],['etaInvalid',['estimatedArrivalTime','time','invalid'],'b'],['etaH',['estimatedArrivalTime','time','hour'],'n'],['etaM',['estimatedArrivalTime','time','minute'],'n'],['tzValid',['estimatedArrivalTime','includedTimeOffset','valid'],'b'],['tz',['estimatedArrivalTime','includedTimeOffset','timeZoneOffset'],'n']] },
    { set: 'S7', p: 'P12', tag: 'road', iface: I.Guidance, field: 'currentRoad', flags: 'rs', instance: 'Main_Instance', gapMs: 2000, fmt: 'description' },
    { set: 'S7', p: 'P12', tag: 'kombi-lanes', iface: I.LaneGuiding, field: 'laneGuiding', flags: 'rs', gapMs: 2000, cols: [['highlighted','currentGuidingHighlightedLanes','x'],['best','currentGuidingBestLanes','x'],['lane','currentLane','n'],['nextHighlighted','nextGuidingHighlightedLanes','x'],['shift','laneShift','n'],['distGuiding','distanceNextGuiding','n'],['distManeuver','distanceNextManeuver','n'],['maneuverShown','statusDisplayGuidingManeuver','e'],['level3Shown','statusDisplayGuidingLevel3','e'],['junctionShown','statusDisplayJunctionView','e'],['status','statusLaneGuiding','e'],['maneuverId','displayedManeuverID','e']] },
    { set: 'S7', p: 'P12', tag: 'kombi-lanes-ext', iface: I.LaneGuiding, field: 'extendedLaneGuiding', flags: 'rs', gapMs: 2000, cols: [['distManeuver','extendedDistanceNextManeuver','n']] },
    // ---- S7 P14 ----
    { set: 'S7', p: 'P12', tag: 'on-guidable-road', iface: I.Guidance, field: 'isOnGuidableRoad', flags: 'rs', instance: 'Main_Instance', fmt: 'bool' },
    { set: 'S7', p: 'P12', tag: 'guiding-provider', iface: I.Guidance, field: 'guidingProvider', flags: 'rs', instance: 'Main_Instance', fmt: 'enum' },
    { set: 'S7', p: 'P12', tag: 'carplay-guidance', iface: I.CarPlayManager, field: 'projectedGuidanceActive', flags: 'rs', instance: 'CarPlayManagerInst1', fmt: 'bool' },
    { set: 'S7', p: 'P12', tag: 'aa-guidance', iface: I.AndroidAutoProjectedManager, field: 'projectedGuidanceActive', flags: 'rs', instance: 'AndroidAutoProjectedManagerInst1', fmt: 'bool' },
    { set: 'S7', p: 'P14', tag: 'map-without-route', iface: I.Guidance, field: 'visualizationInKombiNonNaviEnabled', also: ['S10'], flags: 'rs', instance: 'Main_Instance', fmt: 'bool' },
    { set: 'S7', p: 'P14', tag: 'junction-3d-in-kombi', iface: I.Guidance, field: 'junction3dViewInKombiEnabled', also: ['S10'], flags: 'rs', instance: 'Main_Instance', fmt: 'bool' },
    // ---- S8 P15 ----
    { set: 'S8', p: 'P15', tag: 'sign', iface: I.TrafficSignDisplayControl, field: 'displaySpeedLimitAndNoPassingRestriction', flags: 's', cols: [['invalid','invalidFlag','n'],['value','displaySpeedLimit','n'],['unit','displaySpeedLimitUnit','e'],['warn','displaySpeedLimitWarning','e'],['supp','displaySpeedLimitSupplemental','e'],['style','displaySymbolStyle','e'],['np','displayNoPassingRestriction','e'],['npDist','displayRemainingDistanceNoPassingRestriction','n']] },
    { set: 'S8', p: 'P15', tag: 'longitudinal', iface: I.TrafficSignDisplayControl, field: 'displayDriverAssistanceLongitudinal', flags: 's', cols: [['invalid','invalidFlag','n'],['func','activeFuncLongitudinal','e'],['xcc',['dispXCC','dispXCCStatus'],'e'],['xccOn',['dispXCC','functionActive'],'b'],['object',['dispXCC','objectDetected'],'b'],['sld',['dispSLD','dispSLDStatus'],'e'],['lim',['dispSLD','dispLIMStatus'],'e'],['setSpeed','valueRequestedSpeed','n'],['setState',['dispRequestedSpeed','dispRequestedSpeedStatus'],'e'],['setUnit',['dispRequestedSpeed','unitOfRequestedSpeedValue'],'b'],['sla','StatusSLA','e'],['hdc','DispHDC','e']] },
    { set: 'S8', p: 'P15', tag: 'foresight', iface: I.TrafficSignDisplayControl, field: 'displayForesight', flags: 's', cols: [['invalid','invalidFlag','n'],['speed','dispSpeedForesight','e'],['dist','dispSpeedForesightDistance','n'],['event','dispForesightEvent','e'],['unit','unitSpeedForesight','e']] },
    { set: 'S8', p: 'P15', tag: 'ldm-guidance', iface: I.FASuS, field: 'displayDriverAssistenceSystemLongitudinalGuidance', flags: 's', cols: [['xcc','displayXCC','n'],['func','activeFunctionDriverAssistenceSystemLDM','e'],['sld','displaySLD','n'],['isa','statusISA2','e'],['gapMode','displayGapChoiceMode','e'],['gapInfo','displayGapInformation','e'],['gap','displayGapChoice','n'],['reqDisp','displayRequestSpeed','n'],['setSpeed','valueRequestSpeed','n']] },
    { set: 'S8', p: 'P15', tag: 'next-limit', iface: I.FASuS, field: 'statusNextSpeedLimitRecognition', flags: 'rs', cols: [['withdrawal','nextWithdrawalLimitSpeed','e'],['class','nextClassLimitSpeed','e']] },
    { set: 'S8', p: 'P15', tag: 'no-passing', iface: I.FASuS, field: 'statusOvertakeRecognition', flags: 'rs', cols: [['np','recognitionNoPassing','e']] },
    { set: 'S8', p: 'P15', tag: 'hud-data', iface: I.DisplayDataServer, field: 'functionalLibraryData', flags: 'rs', cols: [['accSym',['activeCruiseControl','symbolACC'],'e'],['accBars',['activeCruiseControl','accBarsHUD'],'n'],['accColour',['activeCruiseControl','barsColorACC'],'e'],['vsli',['xSpeedLimitAssist','vSLISymbol'],'e'],['vsliSpeed',['xSpeedLimitAssist','vSLISpeedValue'],'n'],['ldm','ldmSym','e'],['ldmColour','ldmSymColor','e'],['limiter','statusLimiter','e'],['cruise','cruiseCtrlSpeedHUD','n'],['hud',['system','statusHUD'],'e']] },
    { set: 'S8', p: 'P15', tag: 'hud-data2', iface: I.DisplayDataServer2, field: 'functionalLibraryData', flags: 'rs', cols: [['setSpeed',['ldmSetSpeed','ldmSetSpeedValue'],'n'],['setColour',['ldmSetSpeed','ldmSetSpeedColour'],'e'],['icon','ldmIconId','e'],['iconState','ldmIconState','e'],['bars','ldmAccBars','e'],['sliState',['xSpeedLimitAssist','sliState'],'e'],['sliValue',['xSpeedLimitAssist','sliValue'],'e'],['npi',['npiData','npiState'],'e'],['warnIC',['speedWarning','speedWarningIC'],'e'],['hud',['system','hudStatus'],'e']] },
    { set: 'S8', p: 'P15', tag: 'assist-avail', iface: I.MultimodalControlDriverAssistance, field: 'functionAvailabilityDriverAssistance', flags: 'rs', cols: [['acc','proposalAvailabilityACC','e'],['sla','proposalAvailabilitySLA','e'],['sld','proposalAvailabilitySLD','e'],['dcc','proposalAvailabilityDCC','e'],['setSpeed','valueSetSpeed','n'],['setInfo','infoSetSpeed','n'],['proposal','proposalAssistFunction','e']] },
    { set: 'S8', p: 'P15', tag: 'front-vehicle', iface: I.GapVehicleAhead, field: 'DataFrontVehicle', flags: 's', gapMs: 1000, cols: [['gapX','frontVehicleGapX','n'],['speedX','frontVehicleSpeedX','n'],['qualifier','qualifierEventDataFunctionFrontVehicle','e']] },
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
    { set: 'S10', p: 'P18', tag: 'gearbox-status', iface: I.VehicleInformation, field: 'statusGearboxDrive', flags: 's', cols: [['stage', 'statusActualStageDrive', 'e'], ['gear', 'statusActualGearDrive', 'e'], ['target', 'statusTargetStageDrive', 'e'], ['qualifier', 'qualifierStatusActualStageDrive', 'n']] },
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
];

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
];
// per-set defaults (a field's own gapMs / cap win): messages and doors are events, the drive sets are long
const SET_DEFAULTS = {
    S1: { gapMs: 500, cap: 100 }, S2: { gapMs: 1000, cap: 60 }, S3: { gapMs: 250, cap: 100 }, S4: { gapMs: 1000, cap: 100 },
    S5: { gapMs: 500, cap: 100 }, S6: { gapMs: 500, cap: 150 }, S7: { gapMs: 1000, cap: 200 }, S8: { gapMs: 1000, cap: 200 }, S9: { gapMs: 1000, cap: 200 }, S10: { gapMs: 500, cap: 100 }, S11: { gapMs: 500, cap: 100 },
};

const instOf = (f) => f.instance || '1';
/** The distinct interfaces with every instance they are read on (the manifest declares one "_instances" per interface). */
function interfaces() {
    const m = {};
    TABLE.forEach((f) => {
        const e = m[f.iface] = m[f.iface] || { iface: f.iface, instances: [], fields: {} };
        if (e.instances.indexOf(instOf(f)) < 0) e.instances.push(instOf(f));
        e.fields[f.field] = f.flags;
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
        out[e.iface] = o;
    });
    return out;
}

module.exports = { I, TABLE, SETS, SET_DEFAULTS, instOf, interfaces, manifestSignals };
