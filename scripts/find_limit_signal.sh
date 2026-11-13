#!/usr/bin/env bash
# Kept for docs/POLISH-E-REPORT.md: the speed-limit search is now one topic of scripts/car_signals.sh, which fetches the
# catalogue once and ranks every field the app still needs (read only: cat and grep over SSH). Same arguments.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/car_signals.sh" "$@"
