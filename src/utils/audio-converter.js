/**
 * 音频转换模块
 * .m4s → mux.js 提取 → AudioContext 解码 → lamejs 编码 MP3
 */
const AudioConverter = {
    /**
     * 将 .m4s 音频转换为 MP3
     * @param {ArrayBuffer} m4sBuffer .m4s 文件的 ArrayBuffer
     * @param {number} bitrate MP3 码率 (64/96/128)
     * @param {Function} onProgress 进度回调 (0-1)
     * @returns {Promise<ArrayBuffer>} MP3 的 ArrayBuffer
     */
    async convert(m4sBuffer, bitrate = 96, onProgress) {
        // Step 1: mux.js 将 .m4s 重封装为完整 mp4
        if (onProgress) onProgress(0.1);
        const mp4Buffer = await this._remuxToMp4(m4sBuffer);

        // Step 2: AudioContext 解码为 PCM
        if (onProgress) onProgress(0.3);
        const audioBuffer = await this._decodeAudio(mp4Buffer);

        // Step 3: lamejs 编码为 MP3
        if (onProgress) onProgress(0.5);
        const mp3Buffer = this._encodeToMp3(audioBuffer, bitrate, (p) => {
            if (onProgress) onProgress(0.5 + p * 0.5);
        });

        return mp3Buffer;
    },

    /**
     * mux.js 将 .m4s 重封装为完整 MP4
     */
    _remuxToMp4(m4sBuffer) {
        return new Promise((resolve, reject) => {
            try {
                const segments = [];
                const transmuxer = new mux.mp4.Transmuxer();

                transmuxer.on('data', (segment) => {
                    // segment.data 是 Uint8Array，包含 mp4 容器数据
                    if (segment.data) {
                        segments.push(new Uint8Array(segment.data));
                    }
                    if (segment.initSegment) {
                        segments.unshift(new Uint8Array(segment.initSegment));
                    }
                });

                transmuxer.on('error', reject);

                transmuxer.push(new Uint8Array(m4sBuffer));
                transmuxer.flush();

                if (segments.length === 0) {
                    reject(new Error('mux.js 未能提取音频数据'));
                    return;
                }

                // 合并所有片段
                const totalLength = segments.reduce((sum, s) => sum + s.length, 0);
                const result = new Uint8Array(totalLength);
                let offset = 0;
                for (const seg of segments) {
                    result.set(seg, offset);
                    offset += seg.length;
                }

                resolve(result.buffer);
            } catch (e) {
                reject(new Error('音频重封装失败: ' + e.message));
            }
        });
    },

    /**
     * AudioContext 解码音频为 PCM
     */
    async _decodeAudio(mp4Buffer) {
        // 使用 OfflineAudioContext 解码
        const audioContext = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
        try {
            return await audioContext.decodeAudioData(mp4Buffer);
        } catch (e) {
            throw new Error('音频解码失败: ' + e.message);
        }
    },

    /**
     * lamejs 编码 PCM 为 MP3
     */
    _encodeToMp3(audioBuffer, bitrate, onProgress) {
        const sampleRate = audioBuffer.sampleRate;
        const channels = audioBuffer.numberOfChannels;
        const samples = audioBuffer.getChannelData(0); // 取单声道

        // 如果是立体声，混合为单声道
        let monoSamples;
        if (channels >= 2) {
            const left = audioBuffer.getChannelData(0);
            const right = audioBuffer.getChannelData(1);
            monoSamples = new Float32Array(left.length);
            for (let i = 0; i < left.length; i++) {
                monoSamples[i] = (left[i] + right[i]) / 2;
            }
        } else {
            monoSamples = samples;
        }

        // 转换为 16-bit PCM
        const pcm = new Int16Array(monoSamples.length);
        for (let i = 0; i < monoSamples.length; i++) {
            const s = Math.max(-1, Math.min(1, monoSamples[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // lamejs 编码
        const mp3Encoder = new lamejs.Mp3Encoder(1, sampleRate, bitrate);
        const blockSize = 1152;
        const mp3Chunks = [];
        const totalBlocks = Math.ceil(pcm.length / blockSize);

        for (let i = 0; i < pcm.length; i += blockSize) {
            const chunk = pcm.subarray(i, Math.min(i + blockSize, pcm.length));
            const mp3buf = mp3Encoder.encodeBuffer(chunk);
            if (mp3buf.length > 0) {
                mp3Chunks.push(mp3buf);
            }
            if (onProgress) {
                onProgress(i / pcm.length);
            }
        }

        // 刷新编码器
        const end = mp3Encoder.flush();
        if (end.length > 0) {
            mp3Chunks.push(end);
        }

        // 合并 MP3 数据
        const totalLength = mp3Chunks.reduce((sum, c) => sum + c.length, 0);
        const mp3Data = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of mp3Chunks) {
            mp3Data.set(chunk, offset);
            offset += chunk.length;
        }

        return mp3Data.buffer;
    },

    /**
     * 将 ArrayBuffer 转为 Base64
     * @param {ArrayBuffer} buffer
     * @returns {string}
     */
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    },

    /**
     * 智能分片
     * @param {ArrayBuffer} mp3Buffer
     * @returns {Array<ArrayBuffer>} 分片数组
     */
    splitAudio(mp3Buffer) {
        const MAX_SIZE = 10 * 1024 * 1024; // 10MB
        const bytes = new Uint8Array(mp3Buffer);

        if (bytes.length <= MAX_SIZE) {
            return [mp3Buffer];
        }

        const chunkCount = Math.ceil(bytes.length / MAX_SIZE) + 1;
        const chunkSize = Math.ceil(bytes.length / chunkCount);
        const chunks = [];

        for (let i = 0; i < bytes.length; i += chunkSize) {
            const end = Math.min(i + chunkSize, bytes.length);
            chunks.push(bytes.slice(i, end).buffer);
        }

        return chunks;
    }
};
