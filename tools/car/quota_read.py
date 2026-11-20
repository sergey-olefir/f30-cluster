#!/usr/bin/env python3
"""r1120 AC: the disk limits the head unit applies to each app, read from a copy of its quota file (local, read only).

    python3 -I tools/car/quota_read.py <collected folder> [--out <file>]       (default <folder>/system/quota.json)
    python3 -I tools/car/quota_read.py --file <aquota.user> [--uids 12211,12220]

/var/opt (the apps' data) is ext4 mounted with journaled user and group quotas (usrjquota=aquota.user, grpjquota=aquota.group,
reference/car/2026-11-15/system/mounts.txt) and every OAP app runs as its own uid (oap_<uid>). Our hypothesis: MainApp turns an
app's package.json `maxDiskUsage` into that uid's hard block limit. collect.sh copies the quota files with a plain `cat`; this reads
them (the vfsv1 format of the kernel's quota tree: a 4-level radix tree of 1 KiB blocks, 72-byte entries) and writes, per uid,
the hard and soft limits in bytes, the bytes and files in use, and for the uids of the collected apps their names and whether the
hard limit equals their package's maxDiskUsage. Numbers only. The usage of a journaled quota can lag the disk by the kernel's
sync interval; the limits are what was set.

Plain Python 3, no third-party package. Mac only, never shipped.
"""
import argparse
import json
import os
import struct
import sys

MAGIC = {0xD9C01F11: 'user', 0xD9C01927: 'group'}
BLK = 1024
DEPTH = 4
ENTRY = 72                     # struct v2r1_disk_dqblk
HDR = 16                       # struct qt_disk_dqdbheader
REF_LIMIT = 1 << 20            # a block number beyond any sane quota file: the file is not what we think


class QuotaError(Exception):
    pass


def parse(data):
    """The entries of a vfsv1 quota file: (kind, {id: {hard, soft, used, inodes, ihard, isoft}}), limits in bytes."""
    if len(data) < 2 * BLK:
        raise QuotaError('too short for a quota file (%d bytes)' % len(data))
    magic, version = struct.unpack_from('<II', data, 0)
    if magic not in MAGIC:
        raise QuotaError('not a quota file (magic %#x)' % magic)
    if version != 1:
        raise QuotaError('quota format version %d (only vfsv1 is read)' % version)
    nblocks = len(data) // BLK
    out = {}
    seen = set()

    def block(n):
        if n <= 0 or n >= nblocks or n > REF_LIMIT:
            raise QuotaError('a reference to block %d outside the file (%d blocks)' % (n, nblocks))
        return data[n * BLK:(n + 1) * BLK]

    def walk(n, depth):
        if (n, depth) in seen:
            return
        seen.add((n, depth))
        b = block(n)
        if depth == DEPTH:
            count = struct.unpack_from('<H', b, 8)[0]
            for k in range((BLK - HDR) // ENTRY):
                raw = b[HDR + k * ENTRY:HDR + (k + 1) * ENTRY]
                if raw == b'\0' * ENTRY:
                    continue
                (qid, _pad, ihard, isoft, inodes, bhard, bsoft, space, _bt, _it) = struct.unpack('<IIQQQQQQQQ', raw)
                out[qid] = {'hard_bytes': bhard * 1024, 'soft_bytes': bsoft * 1024, 'used_bytes': space, 'files': inodes,
                            'files_hard': ihard, 'files_soft': isoft}
            if count > (BLK - HDR) // ENTRY:
                raise QuotaError('a data block says it holds %d entries' % count)
            return
        refs = struct.unpack_from('<256I', b, 0)
        for r in refs:
            if r:
                walk(r, depth + 1)

    walk(1, 0)
    return MAGIC[magic], out


def apps_of(folder):
    """{uid: {name, maxDiskUsage}} from the packages collect.sh copied (by-uid/<uid>/package.json)."""
    res = {}
    d = os.path.join(folder, 'by-uid')
    if not os.path.isdir(d):
        return res
    for u in sorted(os.listdir(d)):
        if not u.isdigit():
            continue
        try:
            pj = json.load(open(os.path.join(d, u, 'package.json'), encoding='utf-8'))
        except (OSError, ValueError):
            continue
        name = pj.get('name')
        if isinstance(name, str) and name.replace('_', '').replace('-', '').isalnum():
            mdu = (pj.get('oapAppSettings') or {}).get('maxDiskUsage', pj.get('maxDiskUsage'))      # the kit writes it under oapAppSettings
            res[int(u)] = {'name': name, 'maxDiskUsage': mdu if isinstance(mdu, int) else None}
    return res


def report(files, apps, only=None):
    out = {'schema': 1, 'files': {}, 'apps': {}, 'note': 'limits in bytes (the file keeps 1 KiB blocks); used_bytes may lag the disk (a journaled quota)'}
    tables = {}
    for path in files:
        if not os.path.isfile(path):
            continue
        try:
            kind, entries = parse(open(path, 'rb').read())
        except QuotaError as e:
            out['files'][os.path.basename(path)] = {'error': str(e)}
            continue
        tables[kind] = entries
        out['files'][os.path.basename(path)] = {'kind': kind, 'entries': len(entries)}
    uids = sorted(set(apps) | set(only or []))
    for uid in uids:
        a = apps.get(uid, {})
        row = {'uid': uid}
        if a:
            row['maxDiskUsage'] = a.get('maxDiskUsage')
        for kind, entries in sorted(tables.items()):
            e = entries.get(uid)
            row[kind] = e
            if e and kind == 'user' and a.get('maxDiskUsage') is not None:
                row['hard_limit_is_maxDiskUsage'] = e['hard_bytes'] == a['maxDiskUsage'] or abs(e['hard_bytes'] - a['maxDiskUsage']) < 1024
        out['apps'][a.get('name') or str(uid)] = row
    return out


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('folder', nargs='?')
    ap.add_argument('--file', action='append', default=[])
    ap.add_argument('--uids', default='')
    ap.add_argument('--out')
    a = ap.parse_args(argv)
    only = [int(x) for x in a.uids.split(',') if x.strip().isdigit()]
    if a.folder:
        files = [os.path.join(a.folder, 'system', n) for n in ('aquota.user', 'aquota.group')] + a.file
        apps = apps_of(a.folder)
        out_path = a.out or os.path.join(a.folder, 'system', 'quota.json')
    elif a.file:
        files, apps, out_path = a.file, {}, a.out
    else:
        ap.print_usage()
        return 2
    rep = report(files, apps, only)
    if out_path:
        with open(out_path, 'w', encoding='utf-8') as fh:
            json.dump(rep, fh, indent=1)
    for name, row in sorted(rep['apps'].items()):
        u = row.get('user')
        if u:
            print('%s (uid %d): limit %.1f MiB, used %.1f MiB, %d files%s' % (name, row['uid'], u['hard_bytes'] / 1048576.0, u['used_bytes'] / 1048576.0, u['files'],
                  '' if row.get('maxDiskUsage') is None else ', maxDiskUsage %.1f MiB%s' % (row['maxDiskUsage'] / 1048576.0, '' if row.get('hard_limit_is_maxDiskUsage') else ' (DIFFERS)')))
        elif tables_found(rep):
            print('%s (uid %d): no user quota entry' % (name, row['uid']))
    if not tables_found(rep):
        print('quota: no readable quota file' + (': ' + json.dumps(rep['files']) if rep['files'] else ''))
        return 1
    return 0


def tables_found(rep):
    return any('kind' in v for v in rep['files'].values())


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
