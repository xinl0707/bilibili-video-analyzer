/**
 * Content Script - 注入 B 站页面
 * 职责：
 * 1. 拦截 playurl API 响应，提取音频 URL
 * 2. 提供视频信息（bvid, cid, 标题等）给 service worker
 */
(function () {
    'use strict';

    // ========== 1. Hook fetch 和 XMLHttpRequest ==========

    // 拦截到的音频信息
    let interceptedAudio = null;
    // 拦截到的视频信息
    let interceptedVideoInfo = null;

    /**
     * 处理 playurl API 响应
     */
    function handlePlayurlResponse(json) {
        try {
            if (!json?.data?.dash?.audio?.length) return;

            const audioList = json.data.dash.audio;
            // 取 bandwidth 最大的音频
            const bestAudio = audioList.sort((a, b) => b.bandwidth - a.bandwidth)[0];

            interceptedAudio = {
                url: bestAudio.baseUrl,
                backupUrl: bestAudio.backupUrl?.[0],
                bandwidth: bestAudio.bandwidth,
                codecs: bestAudio.codecs,
                mimeType: bestAudio.mimeType
            };

            // 通知 service worker
            chrome.runtime.sendMessage({
                type: 'AUDIO_FOUND',
                audio: interceptedAudio
            }).catch(() => {});
        } catch (e) {
            console.error('[B站分析] 处理playurl响应失败:', e);
        }
    }

    // Hook fetch
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            if (url.includes('/x/player/playurl') || url.includes('/x/player/wbi/playurl')) {
                const cloned = response.clone();
                cloned.json().then(handlePlayurlResponse).catch(() => {});
            }
        } catch (e) {}
        return response;
    };

    // Hook XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._biliAnalyzerUrl = url;
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', function () {
            try {
                const url = this._biliAnalyzerUrl || '';
                if (url.includes('/x/player/playurl') || url.includes('/x/player/wbi/playurl')) {
                    const json = JSON.parse(this.responseText);
                    handlePlayurlResponse(json);
                }
            } catch (e) {}
        });
        return originalXHRSend.apply(this, args);
    };

    // ========== 2. 提取页面视频信息 ==========

    /**
     * 从页面提取 bvid
     */
    function getBvid() {
        // 方法1: 从 URL 提取
        const urlMatch = location.pathname.match(/\/video\/(BV[\w]+)/);
        if (urlMatch) return urlMatch[1];

        // 方法2: 从 __INITIAL_STATE__ 提取
        try {
            if (window.__INITIAL_STATE__?.bvid) return window.__INITIAL_STATE__.bvid;
            if (window.__INITIAL_STATE__?.videoData?.bvid) return window.__INITIAL_STATE__.videoData.bvid;
        } catch (e) {}

        // 方法3: 从 meta 标签
        const meta = document.querySelector('meta[itemprop="url"]');
        if (meta) {
            const m = meta.content.match(/(BV[\w]+)/);
            if (m) return m[1];
        }

        return null;
    }

    /**
     * 从页面提取 cid
     */
    function getCid() {
        // 方法1: __INITIAL_STATE__
        try {
            if (window.__INITIAL_STATE__) {
                const state = window.__INITIAL_STATE__;
                if (state.cid) return state.cid;
                if (state.videoData?.cid) return state.videoData.cid;
                if (state.epInfo?.cid) return state.epInfo.cid;
                // 番剧
                if (state.epList?.length) return state.epList[0].cid;
            }
        } catch (e) {}

        // 方法2: 从播放器获取
        try {
            const player = document.querySelector('.bpx-player-container');
            if (player?.__playinfo__) return player.__playinfo__.cid;
        } catch (e) {}

        // 方法3: 从 window 对象
        try {
            if (window.player?.cid) return window.player.cid;
        } catch (e) {}

        return null;
    }

    /**
     * 获取完整视频信息
     */
    function getVideoInfo() {
        let info = {
            bvid: getBvid(),
            cid: getCid(),
            title: '',
            uploader: '',
            duration: '',
            aid: ''
        };

        // 从 __INITIAL_STATE__ 补充信息
        try {
            const state = window.__INITIAL_STATE__;
            if (state) {
                const vd = state.videoData || {};
                info.bvid = info.bvid || vd.bvid;
                info.cid = info.cid || vd.cid;
                info.title = vd.title || document.title.replace(/_哔哩哔哩.*$/, '').trim();
                info.uploader = vd.owner?.name || vd.up_info?.uname || '';
                info.aid = vd.aid || '';
                if (vd.duration) {
                    const min = Math.floor(vd.duration / 60);
                    const sec = vd.duration % 60;
                    info.duration = `${min}:${sec.toString().padStart(2, '0')}`;
                }
            }
        } catch (e) {}

        // 如果还没有标题，从 DOM 获取
        if (!info.title) {
            const titleEl = document.querySelector('.video-title, h1, .bpx-player-video-title');
            info.title = titleEl?.textContent?.trim() || document.title.replace(/_哔哩哔哩.*$/, '').trim();
        }

        // 从 DOM 获取 UP 主
        if (!info.uploader) {
            const upEl = document.querySelector('.up-name, .username');
            info.uploader = upEl?.textContent?.trim() || '';
        }

        return info;
    }

    // ========== 3. 监听来自 service worker 的消息 ==========

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'GET_VIDEO_INFO') {
            const info = getVideoInfo();
            sendResponse(info);
            return true;
        }

        if (message.type === 'GET_INTERCEPTED_AUDIO') {
            sendResponse({ audio: interceptedAudio });
            return true;
        }

        if (message.type === 'TRIGGER_PLAYURL') {
            // 触发播放器请求 playurl（通过刷新播放器）
            interceptedAudio = null;
            sendResponse({ ok: true });
            return true;
        }
    });

    // 通知 service worker content script 已加载
    chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' }).catch(() => {});
})();
