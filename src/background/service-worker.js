/**
 * Service Worker - 后台主控
 * 调度整个分析流程：字幕/音频获取 → 转码 → ASR → 总结
 */
importScripts('../utils/storage.js', '../utils/subtitle-fetcher.js', '../utils/api-client.js');

// 导入 mux.js 和 lamejs（在 service worker 中用 importScripts）
importScripts('../lib/mux.min.js', '../lib/lame.min.js');

// ========== 全局状态 ==========
let currentTabId = null;
let isAnalyzing = false;

// ========== 扩展图标点击 → 打开侧边栏 + 启动分析 ==========
chrome.action.onClicked.addListener(async (tab) => {
    // 只在 B 站页面工作
    if (!tab.url || !tab.url.includes('bilibili.com')) {
        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_ERROR', error: '请在B站视频页面使用此扩展' }).catch(() => {});
        return;
    }

    currentTabId = tab.id;

    // 打开侧边栏
    await chrome.sidePanel.open({ tabId: tab.id });

    // 等侧边栏准备好后再启动分析
    setTimeout(() => {
        startAnalysis(tab.id);
    }, 500);
});

// ========== 监听侧边栏消息 ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'SIDEBAR_READY':
            // 侧边栏已准备好
            if (currentTabId && !isAnalyzing) {
                sendResponse({ hasState: false });
            } else {
                // 返回当前状态
                Storage.getAnalysisState().then(state => {
                    sendResponse({ hasState: !!state, state });
                });
            }
            return true;

        case 'START_ANALYSIS':
            // 手动触发分析
            startAnalysis(message.tabId || currentTabId);
            sendResponse({ ok: true });
            return true;

        case 'RETRY':
            // 重试
            retryAnalysis(message.fromStep);
            sendResponse({ ok: true });
            return true;

        case 'SEND_MESSAGE':
            // 对话消息
            handleChatMessage(message.content, message.history);
            sendResponse({ ok: true });
            return true;

        case 'STOP_ANALYSIS':
            isAnalyzing = false;
            Storage.clearAnalysisState();
            sendResponse({ ok: true });
            return true;

        case 'GET_CONFIG':
            Storage.getConfig().then(config => sendResponse(config));
            return true;

        case 'SAVE_CONFIG':
            Storage.setConfig(message.config).then(() => sendResponse({ ok: true }));
            return true;

        case 'GET_HISTORY':
            Storage.getHistory().then(history => sendResponse(history));
            return true;

        case 'DELETE_HISTORY':
            Storage.deleteHistory(message.id).then(() => sendResponse({ ok: true }));
            return true;

        case 'CLEAR_HISTORY':
            Storage.clearHistory().then(() => sendResponse({ ok: true }));
            return true;
    });
});

// ========== 核心分析流程 ==========

async function startAnalysis(tabId) {
    if (isAnalyzing) {
        sendToSidebar({ type: 'ERROR', error: '分析正在进行中...' });
        return;
    }

    isAnalyzing = true;
    currentTabId = tabId;

    try {
        // 确保 content script 已注入
        await ensureContentScript(tabId);

        // Step 1: 获取视频信息
        sendToSidebar({ type: 'PROGRESS', step: 'info', progress: 0, message: '正在获取视频信息...' });
        const videoInfo = await SubtitleFetcher.getVideoInfo(tabId);
        sendToSidebar({ type: 'VIDEO_INFO', info: videoInfo });
        await Storage.setAnalysisState({ step: 'info', videoInfo, progress: 0.1 });

        // Step 2: 尝试获取字幕
        sendToSidebar({ type: 'PROGRESS', step: 'subtitle', progress: 0.1, message: '正在获取字幕...' });
        let transcript = null;

        try {
            const subtitle = await SubtitleFetcher.getSubtitle(videoInfo.bvid, videoInfo.cid);
            if (subtitle && subtitle.text.length > 10) {
                transcript = subtitle.text;
                sendToSidebar({
                    type: 'SUBTITLE_FOUND',
                    text: transcript,
                    language: subtitle.languageDoc
                });
                await Storage.setAnalysisState({
                    step: 'subtitle_done',
                    videoInfo,
                    transcript,
                    source: 'subtitle',
                    progress: 0.7
                });
            }
        } catch (e) {
            console.warn('[B站分析] 字幕获取失败，将使用ASR:', e.message);
        }

        // Step 3: 如果没有字幕，走音频 ASR 流程
        if (!transcript) {
            transcript = await doAudioAsr(tabId, videoInfo);
        }

        if (!transcript || transcript.length < 5) {
            throw new Error('未能获取有效的文字内容');
        }

        // Step 4: AI 总结
        const config = await Storage.getConfig();
        if (config.autoSummarize) {
            await doSummary(transcript, videoInfo, config);
        } else {
            sendToSidebar({ type: 'READY_FOR_SUMMARY', transcript });
        }

        // 保存历史
        await Storage.addHistory({
            title: videoInfo.title,
            uploader: videoInfo.uploader,
            bvid: videoInfo.bvid,
            transcript: transcript.substring(0, 500),
            source: transcript ? 'subtitle' : 'asr'
        });

    } catch (e) {
        console.error('[B站分析] 分析失败:', e);
        sendToSidebar({ type: 'ERROR', error: e.message });
        await Storage.setAnalysisState({ step: 'error', error: e.message });
    } finally {
        isAnalyzing = false;
    }
}

// ========== 音频 ASR 流程 ==========

async function doAudioAsr(tabId, videoInfo) {
    const config = await Storage.getConfig();

    // 获取音频 URL（从拦截的数据或触发新请求）
    sendToSidebar({ type: 'PROGRESS', step: 'audio', progress: 0.15, message: '正在获取音频...' });

    let audioInfo = null;

    // 先检查是否已有拦截的数据
    try {
        const response = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, { type: 'GET_INTERCEPTED_AUDIO' }, resolve);
        });
        if (response?.audio) {
            audioInfo = response.audio;
        }
    } catch (e) {}

    // 如果没有拦截到，等待一段时间（播放器可能还在加载）
    if (!audioInfo) {
        sendToSidebar({ type: 'PROGRESS', step: 'audio', progress: 0.15, message: '等待播放器加载音频...' });
        for (let i = 0; i < 10; i++) {
            await sleep(1000);
            try {
                const response = await new Promise((resolve) => {
                    chrome.tabs.sendMessage(tabId, { type: 'GET_INTERCEPTED_AUDIO' }, resolve);
                });
                if (response?.audio) {
                    audioInfo = response.audio;
                    break;
                }
            } catch (e) {}
        }
    }

    if (!audioInfo) {
        throw new Error('未能获取音频信息，请确保视频正在播放');
    }

    // 下载 .m4s 音频
    sendToSidebar({ type: 'PROGRESS', step: 'download', progress: 0.2, message: '正在下载音频...' });
    const m4sBuffer = await downloadAudio(audioInfo.url, tabId);

    // 转码为 MP3
    sendToSidebar({ type: 'PROGRESS', step: 'convert', progress: 0.3, message: '正在转码为MP3...' });
    const mp3Buffer = await AudioConverter.convert(m4sBuffer, config.mp3Bitrate, (p) => {
        sendToSidebar({
            type: 'PROGRESS',
            step: 'convert',
            progress: 0.3 + p * 0.2,
            message: `正在转码...${Math.round(p * 100)}%`
        });
    });

    // 智能分片
    const chunks = AudioConverter.splitAudio(mp3Buffer);
    const totalChunks = chunks.length;

    // 逐片 ASR
    sendToSidebar({ type: 'PROGRESS', step: 'asr', progress: 0.5, message: `正在识别（共${totalChunks}段）...` });

    let fullTranscript = '';
    const startTime = Date.now();
    const audioSizeMB = mp3Buffer.byteLength / (1024 * 1024);

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkBase64 = AudioConverter.arrayBufferToBase64(chunk);
        const chunkProgress = 0.5 + (i / totalChunks) * 0.3;

        sendToSidebar({
            type: 'PROGRESS',
            step: 'asr',
            progress: chunkProgress,
            message: `正在识别第${i + 1}/${totalChunks}段...`
        });

        const chunkText = await ApiClient.asr(chunkBase64, config, (token) => {
            sendToSidebar({
                type: 'ASR_TOKEN',
                token: token,
                fullText: fullTranscript + token,
                chunkIndex: i,
                totalChunks: totalChunks
            });
        });

        fullTranscript += chunkText;

        // 更新预估时间
        if (i < chunks.length - 1) {
            const elapsed = (Date.now() - startTime) / 1000;
            const processedMB = ((i + 1) / totalChunks) * audioSizeMB;
            const estimated = await Storage.estimateAsrTime(audioSizeMB, processedMB);
            if (estimated) {
                sendToSidebar({
                    type: 'TIME_ESTIMATE',
                    elapsed: Math.round(elapsed),
                    remaining: Math.round(estimated)
                });
            }
        }
    }

    // 记录性能数据
    const totalElapsed = (Date.now() - startTime) / 1000;
    await Storage.addAsrRecord(audioSizeMB, totalElapsed);

    sendToSidebar({
        type: 'TRANSCRIPT_DONE',
        text: fullTranscript,
        source: 'asr',
        elapsed: Math.round(totalElapsed)
    });

    await Storage.setAnalysisState({
        step: 'asr_done',
        videoInfo,
        transcript: fullTranscript,
        source: 'asr',
        progress: 0.8
    });

    return fullTranscript;
}

// ========== 下载音频 ==========

async function downloadAudio(url, tabId) {
    // 获取 cookie 和 referer
    const cookies = await new Promise((resolve) => {
        chrome.cookies.getAll({ url: 'https://www.bilibili.com' }, (cks) => {
            resolve(cks.map(c => `${c.name}=${c.value}`).join('; '));
        });
    });

    const response = await fetch(url, {
        headers: {
            'Referer': 'https://www.bilibili.com/',
            'Cookie': cookies,
            'User-Agent': navigator.userAgent
        }
    });

    if (!response.ok) {
        throw new Error(`音频下载失败: ${response.status}`);
    }

    return response.arrayBuffer();
}

// ========== AI 总结 ==========

async function doSummary(transcript, videoInfo, config) {
    sendToSidebar({ type: 'PROGRESS', step: 'summary', progress: 0.8, message: '正在生成摘要...' });

    const systemPrompt = config.customSystemPrompt || Storage.SUMMARY_STYLES[config.summaryStyle] || Storage.SUMMARY_STYLES.default;

    const messages = [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: `视频标题：${videoInfo.title}\nUP主：${videoInfo.uploader}\n\n以下是视频的文字内容：\n\n${transcript}`
        }
    ];

    const summary = await ApiClient.chat(messages, config, (token) => {
        sendToSidebar({
            type: 'SUMMARY_TOKEN',
            token: token
        });
    });

    sendToSidebar({ type: 'SUMMARY_DONE', summary });
    await Storage.setAnalysisState({
        step: 'done',
        videoInfo,
        transcript,
        summary,
        progress: 1
    });
}

// ========== 对话处理 ==========

async function handleChatMessage(userMessage, history) {
    const config = await Storage.getConfig();
    const state = await Storage.getAnalysisState();

    const systemPrompt = config.customSystemPrompt || Storage.SUMMARY_STYLES[config.summaryStyle] || Storage.SUMMARY_STYLES.default;

    const messages = [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: `视频标题：${state?.videoInfo?.title || '未知'}\n\n视频文字内容：\n${state?.transcript || '无'}`
        }
    ];

    // 添加历史对话
    if (history && history.length > 0) {
        for (const h of history) {
            messages.push({ role: h.role, content: h.content });
        }
    }

    // 添加当前消息
    messages.push({ role: 'user', content: userMessage });

    try {
        const reply = await ApiClient.chat(messages, config, (token) => {
            sendToSidebar({ type: 'CHAT_TOKEN', token: token });
        });
        sendToSidebar({ type: 'CHAT_DONE', reply });
    } catch (e) {
        sendToSidebar({ type: 'CHAT_ERROR', error: e.message });
    }
}

// ========== 重试 ==========

async function retryAnalysis(fromStep) {
    const state = await Storage.getAnalysisState();
    if (!state || !state.videoInfo) {
        // 没有状态，重新开始
        startAnalysis(currentTabId);
        return;
    }

    const config = await Storage.getConfig();

    try {
        if (fromStep === 'summary') {
            await doSummary(state.transcript, state.videoInfo, config);
        } else if (fromStep === 'asr') {
            await doAudioAsr(currentTabId, state.videoInfo);
        } else {
            startAnalysis(currentTabId);
        }
    } catch (e) {
        sendToSidebar({ type: 'ERROR', error: e.message });
    }
}

// ========== 工具函数 ==========

function sendToSidebar(message) {
    chrome.runtime.sendMessage(message).catch(() => {});
}

async function ensureContentScript(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    } catch {
        // content script 未注入，注入它
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content/interceptor.js']
        });
        await sleep(500);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== 侧边栏配置 ==========
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
