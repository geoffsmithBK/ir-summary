/**
 * WAV file processing utilities.
 * Decodes RIFF/PCM (16/24/32-bit int, 32-bit float, plain or EXTENSIBLE),
 * downmixing to mono and preserving the true sample rate. Encodes mono
 * 16/24-bit PCM and 32-bit float.
 */

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

function chunkId(view, offset) {
    return String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
    );
}

/** Scan RIFF chunks from `start` for `id`; return {offset, size} or null. */
function findChunk(view, start, id) {
    let offset = start;
    while (offset + 8 <= view.byteLength) {
        const size = view.getUint32(offset + 4, true);
        if (chunkId(view, offset) === id) {
            return { offset, size };
        }
        offset += 8 + size + (size % 2); // chunks are word-aligned
    }
    return null;
}

/**
 * Decode a WAV file buffer into mono Float64 audio data.
 * @param {ArrayBuffer} buffer - WAV file data
 * @returns {Promise<{data: Float64Array, sampleRate: number, channels: number, bitsPerSample: number}>}
 */
export async function decodeWav(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 44 || chunkId(view, 0) !== 'RIFF') {
        throw new Error('Invalid WAV file: not a RIFF file');
    }
    if (chunkId(view, 8) !== 'WAVE') {
        throw new Error('Invalid WAV file: not a WAVE file');
    }

    const fmt = findChunk(view, 12, 'fmt ');
    if (!fmt) {
        throw new Error('Invalid WAV file: no fmt chunk found');
    }
    let format = view.getUint16(fmt.offset + 8, true);
    const channels = view.getUint16(fmt.offset + 10, true);
    const sampleRate = view.getUint32(fmt.offset + 12, true);
    const bitsPerSample = view.getUint16(fmt.offset + 22, true);
    if (format === FORMAT_EXTENSIBLE) {
        // Real format lives in the first two bytes of the sub-format GUID.
        if (fmt.size >= 40) {
            format = view.getUint16(fmt.offset + 8 + 24, true);
        } else {
            throw new Error('Invalid WAV file: truncated extensible fmt chunk');
        }
    }
    if (format !== FORMAT_PCM && format !== FORMAT_FLOAT) {
        throw new Error(`Unsupported WAV format code: ${format} (only PCM and IEEE float)`);
    }
    if (channels < 1) {
        throw new Error('Invalid WAV file: zero channels');
    }

    const dataChunk = findChunk(view, 12, 'data');
    if (!dataChunk) {
        throw new Error('Invalid WAV file: no data chunk found');
    }
    const dataStart = dataChunk.offset + 8;
    // Never trust the declared size past the end of the actual buffer.
    const dataSize = Math.min(dataChunk.size, buffer.byteLength - dataStart);

    const bytesPerSample = bitsPerSample / 8;
    const totalSamples = Math.floor(dataSize / bytesPerSample);
    let audioData;
    if (format === FORMAT_FLOAT) {
        if (bitsPerSample !== 32) {
            throw new Error(`Unsupported float bit depth: ${bitsPerSample}`);
        }
        audioData = new Float64Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
            audioData[i] = view.getFloat32(dataStart + i * 4, true);
        }
    } else if (bitsPerSample === 16) {
        audioData = new Float64Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
            audioData[i] = view.getInt16(dataStart + i * 2, true) / 32768;
        }
    } else if (bitsPerSample === 24) {
        audioData = new Float64Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
            const lo = view.getUint8(dataStart + i * 3);
            const mid = view.getUint8(dataStart + i * 3 + 1);
            const hi = view.getInt8(dataStart + i * 3 + 2); // sign-extends
            audioData[i] = ((hi << 16) | (mid << 8) | lo) / 8388608;
        }
    } else if (bitsPerSample === 32) {
        audioData = new Float64Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
            audioData[i] = view.getInt32(dataStart + i * 4, true) / 2147483648;
        }
    } else {
        throw new Error(`Unsupported bit depth: ${bitsPerSample}`);
    }

    if (channels > 1) {
        const frames = Math.floor(audioData.length / channels);
        const mono = new Float64Array(frames);
        for (let i = 0; i < frames; i++) {
            let sum = 0;
            for (let ch = 0; ch < channels; ch++) {
                sum += audioData[i * channels + ch];
            }
            mono[i] = sum / channels;
        }
        audioData = mono;
    }

    return { data: audioData, sampleRate, channels: 1, bitsPerSample };
}

/**
 * Encode mono audio data to WAV.
 * @param {Float64Array} data - Audio samples in [-1, 1]
 * @param {number} sampleRate
 * @param {number} bitsPerSample - 16/24 (PCM) or 32 (IEEE float)
 * @returns {ArrayBuffer}
 */
export function encodeWav(data, sampleRate, bitsPerSample = 24) {
    if (![16, 24, 32].includes(bitsPerSample)) {
        throw new Error('Unsupported bit depth. Must be 16, 24, or 32.');
    }
    const isFloat = bitsPerSample === 32;
    const bytesPerSample = bitsPerSample / 8;
    const dataSize = data.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    setString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    setString(view, 8, 'WAVE');
    setString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, isFloat ? FORMAT_FLOAT : FORMAT_PCM, true);
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, bitsPerSample, true);
    setString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const base = 44;
    if (bitsPerSample === 16) {
        for (let i = 0; i < data.length; i++) {
            const q = Math.round(data[i] * 32768);
            view.setInt16(base + i * 2, Math.max(-32768, Math.min(32767, q)), true);
        }
    } else if (bitsPerSample === 24) {
        for (let i = 0; i < data.length; i++) {
            const q = Math.max(-8388608, Math.min(8388607, Math.round(data[i] * 8388608)));
            view.setUint8(base + i * 3, q & 0xff);
            view.setUint8(base + i * 3 + 1, (q >> 8) & 0xff);
            view.setUint8(base + i * 3 + 2, (q >> 16) & 0xff);
        }
    } else {
        for (let i = 0; i < data.length; i++) {
            view.setFloat32(base + i * 4, data[i], true);
        }
    }
    return buffer;
}

function setString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}
