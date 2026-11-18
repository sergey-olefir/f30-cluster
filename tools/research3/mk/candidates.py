#!/usr/bin/env python3
"""Research round 3, package MK: the catalogue candidates for every trip-computer value and the odometer, with ids,
flags, member types and the scaling hypotheses, as one JSON (design/research3/mk/candidates.json).

    python3 -I tools/research3/mk/candidates.py <someip-interfaces.json> [--out design/research3/mk/candidates.json]

Read only, standard library. Ids, flags and types come from the car's catalogue (git-ignored, reference/car/...); the
scaling column is OURS (the catalogue states no unit for any of these members) and is labelled hypothesis, with the one
reading on the car's own trip page that settles it. Only names and numbers are written, no catalogue text.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

KI = 'de.bmw.infotainment.KombiIF'
RL = 'de.bmw.infotainment.resetlogic.'
# value -> [(interface, field, member path, scaling hypothesis, invalid marker(s), how one reading tells, in the MK build)]
VALUES = {
    'average consumption': [
        (KI, 'statusBordcomputerAverage', 'consumptionAverage1BC1 / consumptionAverage2BC2', '0.1 l/100 km per bit (alt. 0.01, 1)', '4095, 65535',
         'raw / shown: 68 for 6.8 -> 0.1; 680 -> 0.01; 7 -> 1. A unit enum statusUnitOfMeasurementConsumptionBC must read 1 (l/100 km)', 'kombi, default 0.1'),
        (RL + 'ResetLogic3', 'bcDataAll', 'bcData3.consumptionCombustionAverageDigit (+ ...Scale)', 'Digit = the shown number in 0.1 l/100 km; Scale = the bar position against maxValues (hypothesis)', '65535',
         'Digit / shown = 10 -> 0.1; Scale moves with the bar, not the number', 'rl3 fallback, default 0.1'),
        (RL + 'ResetLogic2', 'bcDataAll', 'bcData.consumptionCombustionAverageDigit (+ ...Scale)', 'as ResetLogic3', '65535', 'as ResetLogic3', 'probe only (bc-all2)'),
        (RL + 'ResetLogic', 'bcDataAll', 'bcData.consumptionAverage', '0.1 l/100 km per bit (hypothesis)', '65535', 'raw / shown', 'probe only (bc-all1)'),
        ('de.bmw.infotainment.lsc.LSCDataSink', 'dataCombinedInstrumentCluster', 'averageRangeConsumption', 'unknown: the range computer\'s own average, not the trip\'s', '-', 'compare; likely differs from the trip page', 'probe only (lsc-cluster)'),
        ('de.bmw.infotainment.telematic.journeyhistory.BcPersonal', 'driveSegment', 'bcBeConsFuelVisible', 'unknown (per drive segment)', '-', 'compare after one segment', 'probe only (bc-segment)'),
    ],
    'average speed': [
        (KI, 'statusBordcomputerAverage', 'speedAverage1BC1 / speedAverage2BC2', '0.1 km/h per bit (alt. 1)', '4095, 65535',
         'raw / shown: 410 for 41 -> 0.1; 41 -> 1. Cross-check in the log: distance / time vs this (ratio 1..3 fits, near 10 or 0.1 a factor is off)', 'kombi, default 0.1'),
        (RL + 'ResetLogic3', 'bcDataAll', 'bcData3.speedAverage', '0.1 km/h per bit (alt. 1)', '65535', 'as above', 'rl3 fallback, default 0.1'),
        (RL + 'ResetLogic2', 'bcDataAll', 'bcData.speedAverage', 'as ResetLogic3', '65535', 'as above', 'probe only'),
        (RL + 'ResetLogic', 'bcDataAll', 'bcData.speedAverage', 'as ResetLogic3', '65535', 'as above', 'probe only'),
        ('de.bmw.infotainment.lsc.LSCDataSink', 'dataCombinedInstrumentCluster', 'averageSpeed', 'unknown (the range prediction\'s speed)', '-', 'compare', 'probe only'),
        ('de.bmw.infotainment.telematic.journeyhistory.BcPersonal', 'driveSegment', 'bcBeSpeedAvgDrive / bcBeSpeedAvgMoving', '1 km/h (hypothesis)', '-', 'compare', 'probe only'),
    ],
    'distance': [
        (KI, 'statusBordcomputerTravelData', 'wayPassed', '0.1 km per bit (alt. 1 km); UInt16 caps 0.1 km at 6553.5 km', '65535',
         'raw / shown after >= 1 km: 124 for 12.4 -> 0.1; 12 -> 1', 'kombi, default 0.1'),
        (RL + 'ResetLogic3', 'bcDataAll', 'bcData3.counterDistance (UInt32)', '0.1 km (alt. 1 m, 1 km): the widest type of the three, so metres are possible', '0xFFFFFFFF',
         'raw / shown: 124 -> 0.1; 12400 -> 0.001 (metres); the log cross-check catches metres read as 0.1 km (ratio ~0.01)', 'rl3 fallback, default 0.1'),
        ('de.bmw.infotainment.telematic.journeyhistory.BcPersonal', 'driveSegment', 'bcBeTripDistanceKm', '1 km (its name)', '-', 'compare', 'probe only'),
        ('de.bmw.infotainment.navigation.guiding.Guidance', 'travelledDistance', 'rawDistance (Double) + unit enum', 'only while a route is guided', '-', 'not a trip computer', 'not used'),
    ],
    'driving time': [
        (KI, 'statusBordcomputerTravelData', 'rideDurationHours (UInt16) + rideDurationMinutes (UInt8)', 'plain h and min', 'hours 4095 / 65535, minutes 255',
         'shown h:mm equals; minutes above 59 would mean total minutes (the MK build carries them)', 'kombi'),
        (RL + 'ResetLogic3', 'bcDataAll', 'bcData3.dateTimeTrip {day, hour, minute, second}', 'plain d h m s', 'hour / minute 255',
         'shown h:mm equals day * 24 + hour : minute', 'rl3 fallback'),
        ('de.bmw.infotainment.telematic.journeyhistory.BcPersonal', 'driveSegment', 'bcBeDurationDrive / bcBeDurationMoving', 'minutes (hypothesis)', '-', 'compare', 'probe only'),
    ],
    'departure time': [
        (KI, 'statusBordcomputerTravelStart', 'hourDepartureBC / minuteDepartureBC (+ day, month, year)', 'plain; local or UTC unknown', '255',
         'shown "since" time equals -> local; off by the zone offset -> UTC (config.trip.departureUtc ["kombi"])', 'kombi'),
        (RL + 'ResetLogic3', 'bcDataAll', 'bcData3.dateTimeReset {hour, minute} while resetOption = STARTOFDRIVING (4)', 'plain; local or UTC unknown', '255',
         'as above (config.trip.departureUtc ["rl3"]); any other reset option is not the trip\'s start', 'rl3 fallback'),
    ],
    'which counter': [
        (KI, 'statusBordcomputerAverage', 'suffix 1 / 2 (BC1, BC2)', 'which one is "since start"', '-',
         'the iDrive trip page shows two counters; the one whose average matches speed1/cons1 or speed2/cons2 -> config.trip.factors.bc', 'default bc 1'),
        (KI, 'statusBordcomputerStatus2', 'statusBC2BN2020 (BC2 running / stopped)', 'enum', 'SIGNAL_UNGUELTIG 3', 'probe only', 'probe only'),
    ],
    'odometer': [
        (KI, 'statusRangeTankStatus', 'mileageKilometre (UInt32)', '1 km per bit', '0, >= 16777215', 'raw equals the cluster\'s odometer', 'first carrier, factor 1'),
        ('de.bmw.infrastructure.MileageSupreme', 'mileageSupreme', 'mileageSupreme (UInt32) + qualifierMileageSupreme', '1 km (hypothesis)', 'qualifier not AVAILABLE / REDUCED', 'as above', 'second carrier'),
        ('de.bmw.infrastructure.VehicleInformation', 'Range', 'mileageKilometre (UInt32)', '1 km', '0, >= 16777215', 'as above', 'third carrier (notifier only)'),
        ('de.bmw.infrastructure.SecureMileage', 'mileage', 'currentMileage (UInt32)', '1 km (hypothesis)', '0, >= 16777215', 'as above', 'fourth carrier'),
        ('de.bmw.chassis.VehicleModel', 'MileageVehicle', 'mileageVehicle (UInt16, CRC / alive framed)', 'a raw chassis frame; UInt16 cannot hold a real odometer at 1 km', '-', '-', 'not used'),
    ],
    'R1 (trip distance, else range)': [
        (KI, 'statusRangeTankStatus', 'range (UInt16)', 'km (verified on this car: f30_cluster draws it)', '4095', '-', 'R1 while no distance source delivers'),
        (KI, 'statusKombiExternalDisplay', 'displayRange (UInt16)', 'unknown', '-', 'probe P5', 'not used'),
    ],
}


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cat = json.load(open(argv[0]))
    I = cat['interfaces']
    out_path = argv[argv.index('--out') + 1] if '--out' in argv else os.path.join(ROOT, 'design', 'research3', 'mk', 'candidates.json')
    out = {'_about': 'research3/MK: every candidate field for the trip page and the odometer. ids / flags / types from the car catalogue '
                     '(2026-11-15 snapshot); scaling = hypothesis (the catalogue states none); "tell" = the one reading on the car that settles it.',
           'values': {}}
    for value, rows in VALUES.items():
        lst = []
        for iface, field, members, scaling, invalid, tell, mk in rows:
            f = (I.get(iface) or {}).get('fields', {}).get(field)
            if f is None:
                ids = {'missing': True}
            else:
                g = (f.get('getter') or {}).get('id')
                n = (f.get('notifier') or {}).get('id')
                ids = {'service': I[iface].get('serviceId'), 'getter': g, 'notifier': n, 'flags': ('r' if g else '') + ('s' if n else '')}
            lst.append(dict(ids, interface=iface, field=field, members=members, scaling=scaling, invalid=invalid, tell=tell, mk=mk))
        out['values'][value] = lst
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    for value, lst in out['values'].items():
        print('== ' + value)
        for r in lst:
            print('  %-4s g%-4s n%-6s %s.%s  %s  [%s]' % (r.get('flags', '?'), r.get('getter'), r.get('notifier'), r['interface'].split('.')[-1], r['field'], r['members'], r['mk']))
    print('written ' + os.path.relpath(out_path, ROOT))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
