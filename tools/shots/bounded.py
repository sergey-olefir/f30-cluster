"""Run one command so that it always ends by itself (docs/AGENT-BRIEF-strip.md section 3 "Bounded processes").

    python3 tools/shots/bounded.py <seconds> <stop file> <log file> -- <command ...>

The command runs with this process's environment. It is ended (SIGTERM, then SIGKILL 5 s later) when the first of
these happens: <seconds> have passed, <stop file> exists, or this wrapper gets SIGTERM / SIGINT. Its stdout and
stderr go to <log file>. Standard library only.
"""
import os
import signal
import subprocess
import sys
import time


def main():
    secs, stop, logf = float(sys.argv[1]), sys.argv[2], sys.argv[3]
    cmd = sys.argv[sys.argv.index('--') + 1:]
    out = open(logf, 'ab')
    p = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
    done = {'why': None}

    def on_sig(n, f):
        done['why'] = 'signal %d' % n
    signal.signal(signal.SIGTERM, on_sig)
    signal.signal(signal.SIGINT, on_sig)
    end = time.time() + secs
    while p.poll() is None and not done['why']:
        if time.time() > end:
            done['why'] = 'time limit %ds' % secs
        elif os.path.exists(stop):
            done['why'] = 'stop file'
        else:
            time.sleep(0.5)
    if p.poll() is None:
        p.terminate()
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
    out.write(('\n[bounded] ended: %s, exit %s\n' % (done['why'] or 'exited', p.returncode)).encode())
    out.close()


if __name__ == '__main__':
    main()
