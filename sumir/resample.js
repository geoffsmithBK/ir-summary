/**
 * Sample-rate conversion of the final IR via OfflineAudioContext.
 * Used only when the requested output rate differs from the source rate.
 */

/**
 * @param {Float64Array} data - mono audio at `fromRate`
 * @param {number} fromRate
 * @param {number} toRate
 * @returns {Promise<Float64Array>} resampled audio at `toRate`
 */
export async function resample(data, fromRate, toRate) {
    if (fromRate === toRate) return data;
    const outLength = Math.max(1, Math.round((data.length * toRate) / fromRate));
    const ctx = new OfflineAudioContext(1, outLength, toRate);
    const buffer = ctx.createBuffer(1, data.length, fromRate);
    buffer.getChannelData(0).set(Float32Array.from(data));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    const rendered = await ctx.startRendering();
    return Float64Array.from(rendered.getChannelData(0));
}
