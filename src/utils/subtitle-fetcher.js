/**
 * B站字幕获取模块
 */
const SubtitleFetcher = {
    /**
     * 获取视频信息（bvid, cid, 标题等）
     * @param {number} tabId
     * @returns {Promise<Object>}
     */
    async getVideoInfo(tabId) {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { type: 'GET_VIDEO_INFO' }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error('无法获取视频信息: ' + chrome.runtime.lastError.message));
                    return;
                }
                if (!response || !response.bvid) {
                    reject(new Error('未找到视频信息，请确保在B站视频页面'));
                    return;
                }
                resolve(response);
            });
        });
    },

    /**
     * 获取字幕列表
     * @param {string} bvid
     * @param {number} cid
     * @returns {Promise<Array>}
     */
    async fetchSubtitleList(bvid, cid) {
        const url = `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`;
        const response = await fetch(url, {
            credentials: 'include',
            headers: { 'Referer': 'https://www.bilibili.com/' }
        });
        const json = await response.json();
        if (json.code !== 0) {
            throw new Error('获取字幕列表失败: ' + json.message);
        }
        return json.data?.subtitle?.subtitles || [];
    },

    /**
     * 下载字幕内容
     * @param {string} subtitleUrl 字幕URL（可能以//开头）
     * @returns {Promise<Array>} 字幕段落数组 [{from, to, content}, ...]
     */
    async fetchSubtitleContent(subtitleUrl) {
        if (subtitleUrl.startsWith('//')) {
            subtitleUrl = 'https:' + subtitleUrl;
        }
        const response = await fetch(subtitleUrl);
        const json = await response.json();
        return json.body || [];
    },

    /**
     * 将字幕段落拼接为完整文字
     * @param {Array} segments 字幕段落
     * @returns {string}
     */
    segmentsToText(segments) {
        return segments.map(s => s.content).join('');
    },

    /**
     * 获取字幕（完整流程）
     * 优先中文 → 英文 → 其他
     * @param {string} bvid
     * @param {number} cid
     * @returns {Promise<{text: string, language: string, segments: Array} | null>}
     */
    async getSubtitle(bvid, cid) {
        const subtitles = await this.fetchSubtitleList(bvid, cid);
        if (subtitles.length === 0) return null;

        // 优先级：zh-CN > zh > en > 其他
        const priority = ['zh-CN', 'zh-Hans', 'zh', 'en-US', 'en'];
        let selected = null;
        for (const lang of priority) {
            selected = subtitles.find(s => s.lan === lang);
            if (selected) break;
        }
        if (!selected) selected = subtitles[0];

        const segments = await this.fetchSubtitleContent(selected.subtitle_url);
        if (segments.length === 0) return null;

        return {
            text: this.segmentsToText(segments),
            language: selected.lan,
            languageDoc: selected.lan_doc,
            segments: segments
        };
    }
};
