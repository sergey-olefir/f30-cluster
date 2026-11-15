'use strict';
/**
 * avatars.js - the avatar choices Driver Profiles offers, and the one file read it ever does.
 *
 * Three kinds of choice:
 *   a preset   avatarType = DEFAULT, or AVATAR1..AVATAR15 (BMW's own 15 pictures). Only the enum is written; the
 *              stored custom picture, if there is one, is left alone.
 *   bundled    the two pictures that ship with the app, at 128, 256 and 512 px (apps/driver_profiles/avatars/, in
 *              the repository at the owner's own request). The build packs that folder into avatars.pack next to
 *              the code (kit/tools/pack_data.py), so the three sizes can be tried one after another on the car.
 *   a file     the owner's own jpg, from <dataDir>/avatars/ only. On confirm it is Base64-encoded and written to
 *              UserAccount.avatar, then avatarType = INDIVIDUAL. persod's own schema calls the backing value
 *              avatarData, "The individual avatar picture (Base64-encoded jpg)".
 * The last two go down exactly the same write path; only where the bytes come from differs.
 *
 * The rules this file exists to keep:
 *   - **one folder, nothing else.** Names come from readdir() of <dataDir>/avatars/ and are used only by index; no
 *     path is ever built from anything the HMI or a field hands us. A name with a path separator, a dot-file, a
 *     directory and a symlink (lstat, never stat: a link could point anywhere) are all skipped, at listing time and
 *     again right before the read.
 *   - **a size guard before the read.** The size comes from lstat; a file over the limit is refused without being
 *     opened, so a phone photo never reaches memory. The limit is a guess until the car proves what persod takes
 *     (docs/DRIVER-PROFILES-APP.md): the default keeps the Base64 payload at or under 64 KiB.
 *   - **nothing of the picture is logged or shown.** Callers get sizes, an index and a checksum of the encoded
 *     string; the string itself is returned once, to be handed straight to the setter.
 *
 * Pure fs and pure functions: no SOME/IP and no UI, so the bench test can load it as it is. Plain Node 8 (8.16.2).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TYPES = ['DEFAULT', 'AVATAR1', 'AVATAR2', 'AVATAR3', 'AVATAR4', 'AVATAR5', 'AVATAR6', 'AVATAR7', 'AVATAR8',
    'AVATAR9', 'AVATAR10', 'AVATAR11', 'AVATAR12', 'AVATAR13', 'AVATAR14', 'AVATAR15', 'INDIVIDUAL', 'UNSPECIFIED'];
// the catalogue's enumAvatarType (0xFC03 avatarType, get 28, set 29): DEFAULT=0, AVATAR1..15 = 1..15,
// INDIVIDUAL=16, UNSPECIFIED=17
const ENUM_TYPE = { DEFAULT: 0, INDIVIDUAL: 16, UNSPECIFIED: 17 };
for (let i = 1; i <= 15; i++) ENUM_TYPE['AVATAR' + i] = i;

const PRESETS = ['DEFAULT'];                                  // what the Avatar screen offers as presets
for (let i = 1; i <= 15; i++) PRESETS.push('AVATAR' + i);

const DEFAULT_MAX_KB = 48;        // see docs: 48 KB of jpg = 64 KiB of Base64, the payload handed to the setter
const MAX_FILES = 6;              // how many of the owner's files the screen can list (rows in app.json)
const MAX_BUNDLED = 6;            // the six that ship with the app (AV_B0..AV_B5)
const FOLDER = 'avatars';
const NAME_RE = /^[^.\/\\][^\/\\]*\.(jpg|jpeg)$/i;            // one plain file name in that folder, nothing else
const PACK_MAGIC = 'MGUPACK1';
const CODE_DIR = __dirname;       // where the app's own code and avatars.pack sit after the build

/** config.avatarMaxKB -> the limit actually used, in whole KB (1..512; 48 when unset or odd). */
function maxKB(cfg) {
    const n = Number(cfg && cfg.avatarMaxKB);
    if (!isFinite(n) || n < 1) return DEFAULT_MAX_KB;
    return Math.min(512, Math.floor(n));
}
const dirOf = (dataDir) => path.join(dataDir || '.', FOLDER);
/** Bytes -> "12 KB" (and "0 KB" for an empty file: the row then says it is empty anyway). */
function kb(bytes) { return (typeof bytes === 'number' && isFinite(bytes) ? Math.round(bytes / 1024) : 0) + ' KB'; }
/** The decoded size of a Base64 string, without keeping the string: 3 bytes per 4 chars, less the padding. */
function b64Bytes(s) {
    if (typeof s !== 'string' || !s.length) return 0;
    let pad = 0;
    if (s.charAt(s.length - 1) === '=') pad++;
    if (s.charAt(s.length - 2) === '=') pad++;
    return Math.max(0, Math.floor(s.length / 4) * 3 - pad);
}
/** A cheap checksum of a string, so a test (or a read-back) can tell two payloads apart without printing either. */
function sum(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647;
    return h;
}
/** A preset's enum name from a screen row ('AVATAR7'), or null. */
function presetOf(type) { return PRESETS.indexOf(type) >= 0 ? type : null; }
/** An avatarType value (name or number) -> its name; an unknown number stays a number. */
function typeName(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') { const k = TYPES.find((t) => ENUM_TYPE[t] === v); return k || v; }
    return String(v);
}
/** "Avatar 7", "Default", "Custom picture", "Not set". */
function typeLabel(v) {
    const t = typeName(v);
    if (t === null) return 'Not known';
    if (t === 'DEFAULT') return 'Default';
    if (t === 'INDIVIDUAL') return 'Custom picture';
    if (t === 'UNSPECIFIED') return 'Not set';
    if (typeof t === 'string' && /^AVATAR\d+$/.test(t)) return 'Avatar ' + t.slice(6);
    return 'code ' + t;
}
/**
 * The avatar row of the profile screen: the type by name, and for INDIVIDUAL how large the stored picture is.
 * st.avatarBytes is the decoded size the app worked out while reading; the picture itself is never kept.
 */
function avatarText(st) {
    if (!st) return 'Not known';
    const t = typeName(st.avatarType);
    if (t === null) return 'Not known' + (st.avatarErr ? ' (' + st.avatarErr + ')' : '');
    const label = typeLabel(t) + ' (' + t + ')';
    if (t !== 'INDIVIDUAL') return label;
    if (typeof st.avatarBytes !== 'number') return label + ', its size is not readable' + (st.avatarErr ? ' (' + st.avatarErr + ')' : '');
    if (!st.avatarBytes) return label + ', but no picture is stored';
    return label + ' is set, ' + kb(st.avatarBytes) + ' of jpg';
}

/**
 * List the candidate files in <dataDir>/avatars/, each with its size, newest-looking order left to readdir (sorted
 * by name so the rows do not jump around between reads). Never throws.
 *
 * -> { dir, exists, error, max, files: [{ index, name, bytes, kb, tooBig, empty, ok }] }
 * The index is the row's handle: a write re-lists and takes the file at that index, so no name travels through the UI.
 */
function list(dataDir, cfg) {
    const dir = dirOf(dataDir);
    const out = { dir, exists: false, error: null, max: maxKB(cfg), files: [] };
    let names;
    try { names = fs.readdirSync(dir); } catch (e) {
        // a missing folder is the normal state before the owner puts a picture there
        if (e && e.code === 'ENOENT') return out;
        out.error = String(e && e.message ? e.message : e).slice(0, 120);
        return out;
    }
    out.exists = true;
    const limit = out.max * 1024;
    names.sort().forEach((name) => {
        if (out.files.length >= MAX_FILES) return;
        if (!NAME_RE.test(name)) return;
        let stat;
        // lstat, not stat: a symlink must not be followed out of the folder
        try { stat = fs.lstatSync(path.join(dir, name)); } catch (e) { return; }
        if (!stat.isFile()) return;
        const f = { index: out.files.length, name, bytes: stat.size, kb: kb(stat.size), tooBig: stat.size > limit, empty: stat.size === 0 };
        f.ok = !f.tooBig && !f.empty;
        out.files.push(f);
    });
    return out;
}

/**
 * Read the file at `index` of a fresh listing and Base64-encode it.
 * -> { ok, index, name, bytes, chars, kb, data, sum } or { ok: false, why }.
 * `data` is the only place the picture exists; the caller hands it to the setter and keeps nothing.
 */
function encode(dataDir, index, cfg) {
    const l = list(dataDir, cfg);
    const f = l.files[index];
    if (!f) return { ok: false, why: l.exists ? 'that file is not in the folder any more' : 'the avatars folder is not there' };
    if (f.empty) return { ok: false, why: 'the file is empty' };
    if (f.tooBig) return { ok: false, why: 'the file is ' + f.kb + ': over the ' + l.max + ' KB limit' };
    const full = path.join(l.dir, f.name);
    let stat, buf;
    // check again right before the read: the same guards, on the file as it is now
    try { stat = fs.lstatSync(full); } catch (e) { return { ok: false, why: 'the file cannot be read any more' }; }
    if (!stat.isFile()) return { ok: false, why: 'not a plain file' };
    if (stat.size > l.max * 1024) return { ok: false, why: 'the file grew past the ' + l.max + ' KB limit' };
    if (!stat.size) return { ok: false, why: 'the file is empty' };
    try { buf = fs.readFileSync(full); } catch (e) { return { ok: false, why: 'the file cannot be read: ' + String(e && e.code || e).slice(0, 40) }; }
    if (buf.length > l.max * 1024) return { ok: false, why: 'the file is over the ' + l.max + ' KB limit' };
    // persod's schema says jpg; a png or a renamed something else would be stored and never drawn
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return { ok: false, why: 'not a jpg (its first bytes are not a JPEG header)' };
    const data = buf.toString('base64');
    return { ok: true, index: f.index, name: f.name, bytes: buf.length, chars: data.length, kb: kb(buf.length), data, sum: sum(data) };
}

/* ---------------- the pictures that ship with the app ---------------- */

/**
 * Where the bundled pictures are: the build packs apps/driver_profiles/avatars/ into avatars.pack next to the code
 * (kit/tools/pack_data.py: magic, u32 index length, the raw-deflated index, then each file raw-deflated). Without a
 * pack - a preview, or running from the source tree - the plain folder next to the code is read instead.
 * Only the index is kept; the file handle is opened and closed around each read.
 */
let source = null;
function bundleSource() {
    if (source) return source;
    const file = path.join(CODE_DIR, FOLDER + '.pack');
    try {
        const fd = fs.openSync(file, 'r');
        try {
            const head = Buffer.alloc(12);
            fs.readSync(fd, head, 0, 12, 0);
            if (head.toString('latin1', 0, 8) !== PACK_MAGIC) throw new Error('not a data pack');
            const ilen = head.readUInt32LE(8);
            const ibuf = Buffer.alloc(ilen);
            fs.readSync(fd, ibuf, 0, ilen, 12);
            const index = JSON.parse(zlib.inflateRawSync(ibuf).toString('utf8'));
            source = { kind: 'pack', file: file, index: index, base: 12 + ilen, sizes: {} };
        } finally { fs.closeSync(fd); }
        return source;
    } catch (e) { /* no pack next to the code: try the folder */ }
    const dir = path.join(CODE_DIR, FOLDER);
    let names = null;
    try { names = fs.readdirSync(dir); } catch (e) { names = null; }
    source = names ? { kind: 'folder', dir: dir, names: names, sizes: {} } : { kind: 'none', sizes: {} };
    return source;
}
/** The bytes of one bundled picture, by the name the listing gave. null when it is not there. */
function bundleRead(name) {
    const src = bundleSource();
    if (!NAME_RE.test(name)) return null;
    if (src.kind === 'pack') {
        const e = src.index.files[name];
        if (!e) return null;
        const fd = fs.openSync(src.file, 'r');
        try {
            const b = Buffer.alloc(e[1]);
            fs.readSync(fd, b, 0, e[1], src.base + e[0]);
            return zlib.inflateRawSync(b);
        } finally { fs.closeSync(fd); }
    }
    if (src.kind === 'folder') {
        const full = path.join(src.dir, name);
        const stat = fs.lstatSync(full);
        if (!stat.isFile()) return null;
        return fs.readFileSync(full);
    }
    return null;
}
/**
 * The pictures that ship with the app: the same row shape list() gives, plus bundled: true.
 * -> { exists, error, max, files: [{ index, name, bytes, kb, tooBig, empty, ok, bundled }] }
 * A packed file's size is only known once it is inflated, so the first listing inflates each one, keeps its size
 * and drops the bytes.
 */
function bundled(cfg) {
    const out = { exists: false, error: null, max: maxKB(cfg), files: [] };
    let src;
    try { src = bundleSource(); } catch (e) { out.error = String(e && e.message ? e.message : e).slice(0, 120); return out; }
    if (src.kind === 'none') return out;
    out.exists = true;
    const limit = out.max * 1024;
    let names;
    try { names = src.kind === 'pack' ? Object.keys(src.index.files) : src.names.slice(); } catch (e) { names = []; }
    names.filter((n) => NAME_RE.test(n)).sort().forEach((name) => {
        if (out.files.length >= MAX_BUNDLED) return;
        let size = src.sizes[name];
        if (size === undefined) {
            try { const b = bundleRead(name); size = b ? b.length : null; } catch (e) { size = null; }
            src.sizes[name] = size;
        }
        if (size === null || size === undefined) return;
        const f = { index: out.files.length, name: name, bytes: size, kb: kb(size), tooBig: size > limit, empty: size === 0, bundled: true };
        f.ok = !f.tooBig && !f.empty;
        out.files.push(f);
    });
    return out;
}
/** Read the bundled picture at `index` of a fresh listing and Base64-encode it. Same shape as encode(). */
function encodeBundled(index, cfg) {
    const l = bundled(cfg);
    const f = l.files[index];
    if (!f) return { ok: false, why: 'that picture does not ship with this version of the app' };
    if (f.tooBig) return { ok: false, why: 'that picture is ' + f.kb + ': over the ' + l.max + ' KB limit' };
    let buf;
    try { buf = bundleRead(f.name); } catch (e) { buf = null; }
    if (!buf || !buf.length) return { ok: false, why: 'that picture cannot be read out of the app' };
    if (buf.length > l.max * 1024) return { ok: false, why: 'that picture is over the ' + l.max + ' KB limit' };
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return { ok: false, why: 'not a jpg (its first bytes are not a JPEG header)' };
    const data = buf.toString('base64');
    return { ok: true, index: f.index, name: f.name, bytes: buf.length, chars: data.length, kb: kb(buf.length), data: data, sum: sum(data), bundled: true };
}

module.exports = {
    TYPES, ENUM_TYPE, PRESETS, FOLDER, MAX_FILES, MAX_BUNDLED, DEFAULT_MAX_KB,
    maxKB, dirOf, kb, b64Bytes, sum, presetOf, typeName, typeLabel, avatarText, list, encode, bundled, encodeBundled,
};
