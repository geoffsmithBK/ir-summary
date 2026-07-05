import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeWav, encodeWav } from '../wav.js';

// Build a ramp that exercises negative/positive range without clipping.
function ramp(n) {
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = -0.9 + (1.8 * i) / (n - 1);
    return x;
}

test('16-bit round-trip preserves samples within quantization error', async () => {
    const x = ramp(480);
    const buf = encodeWav(x, 48000, 16);
    const { data, sampleRate, bitsPerSample } = await decodeWav(buf);
    assert.equal(sampleRate, 48000);
    assert.equal(bitsPerSample, 16);
    assert.equal(data.length, x.length);
    for (let i = 0; i < x.length; i++) {
        assert.ok(Math.abs(data[i] - x[i]) < 1 / 32768, `sample ${i}`);
    }
});

test('24-bit round-trip preserves samples within quantization error', async () => {
    const x = ramp(480);
    const buf = encodeWav(x, 44100, 24);
    const { data, sampleRate, bitsPerSample } = await decodeWav(buf);
    assert.equal(sampleRate, 44100);
    assert.equal(bitsPerSample, 24);
    assert.equal(data.length, x.length);
    for (let i = 0; i < x.length; i++) {
        assert.ok(Math.abs(data[i] - x[i]) < 1 / 8388608, `sample ${i}`);
    }
});

test('32-bit float round-trip is exact', async () => {
    const x = ramp(480);
    const buf = encodeWav(x, 96000, 32);
    const { data, sampleRate } = await decodeWav(buf);
    assert.equal(sampleRate, 96000);
    for (let i = 0; i < x.length; i++) {
        assert.ok(Math.abs(data[i] - x[i]) < 1e-7, `sample ${i}`);
    }
});

test('32-bit float encode declares IEEE float format (code 3)', () => {
    const buf = encodeWav(ramp(16), 48000, 32);
    const view = new DataView(buf);
    assert.equal(view.getUint16(20, true), 3, 'format tag must be 3 (IEEE float)');
});

test('decode rejects non-RIFF data', async () => {
    const junk = new Uint8Array(64).fill(7).buffer;
    await assert.rejects(() => decodeWav(junk), /RIFF/i);
});

test('decode rejects RIFF that is not WAVE', async () => {
    const buf = encodeWav(ramp(16), 48000, 16);
    new DataView(buf).setUint32(8, 0x41564920, false); // "AVI "
    await assert.rejects(() => decodeWav(buf));
});

test('decode survives extra chunks before fmt/data', async () => {
    // Splice a "JUNK" chunk between WAVE id and fmt.
    const clean = encodeWav(ramp(32), 48000, 16);
    const junkPayload = 10;
    const out = new Uint8Array(clean.byteLength + 8 + junkPayload);
    const src = new Uint8Array(clean);
    out.set(src.subarray(0, 12), 0);                        // RIFF..WAVE
    out.set([0x4a, 0x55, 0x4e, 0x4b], 12);                  // "JUNK"
    new DataView(out.buffer).setUint32(16, junkPayload, true);
    out.set(src.subarray(12), 20 + junkPayload);            // rest of file
    new DataView(out.buffer).setUint32(4, out.byteLength - 8, true);
    const { data } = await decodeWav(out.buffer);
    assert.equal(data.length, 32);
});

test('stereo input is downmixed to mono', async () => {
    // Hand-build a 16-bit stereo file: L = 0.5, R = -0.5 -> mono 0.
    const frames = 100;
    const buf = new ArrayBuffer(44 + frames * 4);
    const v = new DataView(buf);
    const s = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + frames * 4, true); s(8, 'WAVE');
    s(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, 48000, true); v.setUint32(28, 48000 * 4, true);
    v.setUint16(32, 4, true); v.setUint16(34, 16, true);
    s(36, 'data'); v.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames; i++) {
        v.setInt16(44 + i * 4, 16384, true);
        v.setInt16(44 + i * 4 + 2, -16384, true);
    }
    const { data } = await decodeWav(buf);
    assert.equal(data.length, frames);
    for (let i = 0; i < frames; i++) assert.ok(Math.abs(data[i]) < 1e-4);
});

test('decode rejects unsupported bit depth', async () => {
    const buf = encodeWav(ramp(16), 48000, 16);
    new DataView(buf).setUint16(34, 8, true); // claim 8-bit
    await assert.rejects(() => decodeWav(buf), /bit depth/i);
});

test('encode rejects unsupported bit depth', () => {
    assert.throws(() => encodeWav(ramp(16), 48000, 12), /bit depth/i);
});

test('24-bit encode of exactly +1.0 does not wrap to negative', async () => {
    const x = new Float64Array([1.0, -1.0, 0.999999]);
    const buf = encodeWav(x, 48000, 24);
    const { data } = await decodeWav(buf);
    assert.ok(data[0] > 0.99, `+1.0 must stay positive, got ${data[0]}`);
    assert.ok(data[1] <= -0.99 && data[1] >= -1.0, `-1.0 must stay ~-1, got ${data[1]}`);
});

test('32-bit samples in a format-1 file decode as int32 PCM, not float', async () => {
    // Hand-build: format tag 1 (PCM), 32-bit ints.
    const n = 4;
    const buf = new ArrayBuffer(44 + n * 4);
    const v = new DataView(buf);
    const s = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); s(8, 'WAVE');
    s(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 48000, true); v.setUint32(28, 48000 * 4, true);
    v.setUint16(32, 4, true); v.setUint16(34, 32, true);
    s(36, 'data'); v.setUint32(40, n * 4, true);
    const ints = [0, 1073741824, -1073741824, 2147483647]; // 0, 0.5, -0.5, ~1
    ints.forEach((val, i) => v.setInt32(44 + i * 4, val, true));
    const { data } = await decodeWav(buf);
    assert.ok(Math.abs(data[0] - 0) < 1e-6);
    assert.ok(Math.abs(data[1] - 0.5) < 1e-6);
    assert.ok(Math.abs(data[2] + 0.5) < 1e-6);
    assert.ok(Math.abs(data[3] - 1) < 1e-6);
});

test('WAVE_FORMAT_EXTENSIBLE (0xFFFE) 24-bit files decode via sub-format', async () => {
    // Take a clean 24-bit file and rewrite its fmt chunk as extensible.
    const clean = encodeWav(ramp(32), 48000, 24);
    const src = new Uint8Array(clean);
    const out = new ArrayBuffer(clean.byteLength + 24); // fmt grows 16 -> 40
    const o = new Uint8Array(out);
    const v = new DataView(out);
    o.set(src.subarray(0, 20), 0);           // through 'fmt ' + size field
    v.setUint32(16, 40, true);               // fmt chunk size 40
    v.setUint16(20, 0xfffe, true);           // WAVE_FORMAT_EXTENSIBLE
    o.set(src.subarray(22, 36), 22);         // channels..bitsPerSample
    v.setUint16(36, 22, true);               // cbSize
    v.setUint16(38, 24, true);               // valid bits
    v.setUint32(40, 0x4, true);              // channel mask
    v.setUint16(44, 1, true);                // sub-format: PCM
    // remaining GUID bytes stay zero-ish; decoder should only need first 2
    o.set(src.subarray(36), 60);             // 'data' chunk onward
    v.setUint32(4, out.byteLength - 8, true);
    const { data } = await decodeWav(out);
    assert.equal(data.length, 32);
});

test('data chunk size larger than the file is clamped, not crashed', async () => {
    const buf = encodeWav(ramp(32), 48000, 16);
    new DataView(buf).setUint32(40, 999999, true); // lie about data size
    const { data } = await decodeWav(buf);
    assert.equal(data.length, 32);
});

test('16-bit encode of exactly +1.0 does not overflow', async () => {
    const x = new Float64Array([1.0]);
    const buf = encodeWav(x, 48000, 16);
    const { data } = await decodeWav(buf);
    assert.ok(data[0] > 0.99, `+1.0 must stay positive, got ${data[0]}`);
});
