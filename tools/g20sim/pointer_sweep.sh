#!/bin/sh
# The owner's question on the real bench: which stock G20 pointer / glow pixels show through wb_dials?
# For each (speed, rpm): wb_dials over the simulation's gauges only (?g20dbg=gauges: pointers, glow, rev band,
# mini needles over black) and wb_dials over black (backdrop off). tools/g20sim/pointer_sweep.py diffs them.
cd "$(dirname "$0")/../.." || exit 1
B=http://localhost:8078; OUT=bake/work/g20sim/E/sweep; SHOT=tools/g20sim/shot.sh
mkdir -p $OUT
curl -s -X POST $B/drive -d '{"value":4}'; curl -s -X POST $B/setting -d '{"key":"inComfort","value":"wb_dials"}'; sleep 6
# pairs speed:rpm; override with SWEEP="0:0 10:750" tools/g20sim/pointer_sweep.sh
for P in ${SWEEP:-0:0 0:750 10:1000 20:1200 50:2000 100:3000 140:4000 200:5500 260:7000}; do
  set -- $(echo $P | tr : " ")
  curl -s -X POST $B/signals -d "{\"mode\":\"manual\",\"values\":{\"rpm\":$2,\"speed\":$1,\"oil\":100,\"coolant\":90,\"boost\":0,\"gear\":3,\"gLong\":0,\"gLat\":0,\"fuelL\":54,\"range\":467,\"ambient\":3.5}}"
  sleep 4
  for T in 1 2 3; do $SHOT $OUT/g_${1}_${2}.png "$B/?only=1&clean=1&car=0&backdrop=1&g20dbg=gauges" >/dev/null && break; done
  for T in 1 2 3; do $SHOT $OUT/n_${1}_${2}.png "$B/?only=1&clean=1&car=0" >/dev/null && break; done
  echo "swept $1 km/h $2 rpm"
done
