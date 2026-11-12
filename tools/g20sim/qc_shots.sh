#!/bin/sh
# Bench screenshots of the G20 simulation in the states of photos 08, 09 and 14 (for tools/g20sim/qc.py), and the
# owner's screenshots of wb_dials over the simulation (docs/g20sim/). Needs the bench running:
#   rm -rf dist bench/.data && node bench/server.js f30_cluster
#   tools/g20sim/qc_shots.sh [qc|owner|all]
cd "$(dirname "$0")/../.." || exit 1
B=http://localhost:8078
OUT=bake/work/g20sim/E
SHOT=tools/g20sim/shot.sh
mkdir -p "$OUT" docs/g20sim
post() { curl -s -X POST "$B/$1" -d "$2"; }
sig() {   # rpm speed oil fuelL range ambient gear
  post signals "{\"mode\":\"manual\",\"values\":{\"rpm\":$1,\"speed\":$2,\"oil\":$3,\"coolant\":90,\"boost\":0,\"gear\":$7,\"gLong\":0,\"gLat\":0,\"fuelL\":$4,\"range\":$5,\"ambient\":$6}}"
  sleep 3
}
Q='only=1&clean=1&backdrop=1&car=0'
WHAT="${1:-all}"
post drive '{"value":4}'; sleep 1

if [ "$WHAT" = qc ] || [ "$WHAT" = all ]; then
  # The stock state: the app's Comfort layout "off" (BMW's own cluster), every QC state of the photos
  post setting '{"key":"inComfort","value":"off"}'; sleep 3
  sig 0 0 110 54 467 3.5 0
  $SHOT $OUT/qc_08.png "$B/?$Q&g20=startup&g20time=16:43"
  sig 700 0 110 54 473 4.0 1
  $SHOT $OUT/qc_09.png "$B/?$Q&day=1&g20=driving&g20lamps=tt.auto_h,tt.parking_brake.hold&g20limit=50&g20gear=D&g20time=16:36&g20street=%D0%9B%D1%83%D0%B3%D0%B0%D0%BD%D1%81%D1%8C%D0%BA%D0%B0%20%D0%B2%D1%83%D0%BB%D0%B8%D1%86%D1%8F"
  # 14: theme connected, our texts masked in the QC (the layout stays off; the state is forced with g20conn=1)
  sig 720 0 30 54 456 4.0 0
  for LOOK in day night; do
    D=0; [ $LOOK = day ] && D=1
    $SHOT $OUT/qc_14_$LOOK.png "$B/?$Q&day=$D&g20conn=1&g20lamps=tt.auto_h,tt.parking_brake.hold,bottom.belt_driver&g20limit=30&g20gear=P&g20time=10:15&g20street=%D0%9F%D0%B0%D1%81%D1%96%D1%87%D0%BD%D0%B0%20%D0%B2%D1%83%D0%BB%D0%B8%D1%86%D1%8F"
  done
fi

if [ "$WHAT" = owner ] || [ "$WHAT" = all ]; then
  # The owner's question: wb_dials over the simulation, with the car view, at rest and at 50 km/h / 2000 rpm
  post setting '{"key":"inComfort","value":"wb_dials"}'; sleep 6
  V='only=1&clean=1&backdrop=1'
  for P in startup driving; do
    G=P; [ $P = driving ] && G=D
    sig 0 0 110 54 467 3.5 0
    [ $P = driving ] && sig 750 0 110 54 467 3.5 1
    $SHOT docs/g20sim/wb_dials_rest_$P.png "$B/?$V&g20=$P&g20gear=$G&g20time=16:43"
    sig 2000 50 100 54 467 3.5 3
    $SHOT docs/g20sim/wb_dials_50kmh_2000rpm_$P.png "$B/?$V&g20=$P&g20gear=$G&g20time=16:43"
  done
  # the same states with the simulation alone (layout off), for the A/B
  post setting '{"key":"inComfort","value":"off"}'; sleep 3
  sig 2000 50 100 54 467 3.5 3
  $SHOT $OUT/stock_50kmh_2000rpm_driving.png "$B/?$V&g20=driving&g20gear=D&g20time=16:43"
  post setting '{"key":"inComfort","value":"wb_dials"}'; sleep 3
fi
