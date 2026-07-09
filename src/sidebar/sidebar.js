/**
 * 侧边栏主逻辑
 */
(function () {
    'use strict';

    // ========== DOM 元素 ==========
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // 视图
    const welcomeView = $('#welcomeView');
    const analysisView = $('#analysisView');
    const historyView = $('#historyView');
    const settingsView = $('#settingsView');

    // 视频信息
    const videoInfoCard = $('#videoInfoCard');
    const videoTitle = $('#videoTitle');
    const videoUploader = $('#videoUploader');
    const videoDuration = $('#videoDuration');
    const videoBvid = $('#videoBvid');

    // 进度
    const progressSection = $('#progressSection');
    const progressBar = $('#progressBar');
    const progressText = $('#progressText');
    const progressMessage = $('#progressMessage');
    const transcriptArea = $('#transcriptArea');
    const transcriptText = $('#transcriptText');
    const timeEstimate = $('#timeEstimate');
    const elapsedTime = $('#elapsedTime');
    const remainingTime = $('#remainingTime');

    // 摘要
    const summaryCard = $('#summaryCard');
    const summaryContent = $('#summaryContent');

    // 对话
    const chatSection = $('#chatSection');
    const chatMessages = $('#chatMessages');
    const chatInput = $('#chatInput');
    const btnSend = $('#btnSend');
    const presetQuestions = $('#presetQuestions');

    // 底部
    const footer = $('#footer');
    const btnRetry = $('#btnRetry');

    // ========== 状态 ==========
    let currentView = 'welcome';
    let chatHistory = [];
    let isStreaming = false;
    let summaryText = '';
    let transcriptFull = '';
    let videoInfo = null;

    // ========== 初始化 ==========
    async function init() {
        // 加载主题
        const savedTheme = localStorage.getItem('theme') || 'auto';
        applyTheme(savedTheme);

        // 绑定事件
        bindEvents();

        // 通知 service worker 侧边栏已准备好
        chrome.runtime.sendMessage({ type: 'SIDEBAR_READY' }, (response) => {
            if (response?.hasState && response.state) {
                restoreState(response.state);
            }
        });

        // 监听来自 service worker 的消息
        chrome.runtime.onMessage.addListener(handleMessage);
    }

    // ========== 事件绑定 ==========
    function bindEvents() {
        // 标题栏按钮
        $('#btnTheme').addEventListener('click', toggleTheme);
        $('#btnSettings').addEventListener('click', () => switchView('settings'));
        $('#btnHistory').addEventListener('click', () => {
            switchView('history');
            loadHistory();
        });

        // 返回按钮
        $('#btnBackFromHistory').addEventListener('click', () => switchView(currentView === 'history' ? 'welcome' : 'analysis'));
        $('#btnBackFromSettings').addEventListener('click', () => switchView(currentView === 'settings' ? 'welcome' : 'analysis'));

        // 发送消息
        btnSend.addEventListener('click', sendMessage);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // 自动调整输入框高度
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        });

        // 预设问题
        presetQuestions.addEventListener('click', (e) => {
            if (e.target.classList.contains('preset-btn')) {
                chatInput.value = e.target.dataset.question;
                sendMessage();
            }
        });

        // 复制摘要
        $('#btnCopySummary').addEventListener('click', () => {
            if (summaryText) {
                navigator.clipboard.writeText(summaryText).then(() => showToast('已复制到剪贴板'));
            }
        });

        // 导出按钮
        $('#btnExportMd').addEventListener('click', () => exportAs('md'));
        $('#btnExportTxt').addEventListener('click', () => exportAs('txt'));
        $('#btnExportHtml').addEventListener('click', () => exportAs('html'));

        // 重试按钮
        btnRetry.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'RETRY', fromStep: 'summary' });
        });

        // 历史操作
        $('#btnClearHistory').addEventListener('click', async () => {
            if (confirm('确定要清空所有历史记录吗？')) {
                chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' }, () => loadHistory());
            }
        });

        // 设置
        $('#btnSaveSettings').addEventListener('click', saveSettings);
        $('#btnTestApi').addEventListener('click', testApiConnection);

        // 设置页 - 总结风格联动
        $('#cfgSummaryStyle').addEventListener('change', (e) => {
            const prompt = $('#cfgCustomPrompt');
            if (!prompt.value.trim()) {
                // 如果自定义提示词为空，显示当前风格的预设
                loadSummaryStylePreset(e.target.value);
            }
        });
    }

    // ========== 消息处理 ==========
    function handleMessage(message, sender, sendResponse) {
        switch (message.type) {
            case 'VIDEO_INFO':
                handleVideoInfo(message.info);
                break;
            case 'PROGRESS':
                handleProgress(message);
                break;
            case 'SUBTITLE_FOUND':
                handleSubtitleFound(message);
                break;
            case 'AUDIO_FOUND':
                // 音频已找到
                break;
            case 'ASR_TOKEN':
                handleAsrToken(message);
                break;
            case 'TIME_ESTIMATE':
                handleTimeEstimate(message);
                break;
            case 'TRANSCRIPT_DONE':
                handleTranscriptDone(message);
                break;
            case 'SUMMARY_TOKEN':
                handleSummaryToken(message);
                break;
            case 'SUMMARY_DONE':
                handleSummaryDone(message);
                break;
            case 'READY_FOR_SUMMARY':
                transcriptFull = message.transcript;
                switchView('analysis');
                summaryCard.classList.add('hidden');
                chatSection.classList.add('hidden');
                footer.classList.remove('hidden');
                break;
            case 'CHAT_TOKEN':
                handleChatToken(message);
                break;
            case 'CHAT_DONE':
                handleChatDone(message);
                break;
            case 'CHAT_ERROR':
                handleChatError(message);
                break;
            case 'ERROR':
                handleError(message.error);
                break;
        }
    }

    // ========== 视图切换 ==========
    function switchView(viewName) {
        $$('.view').forEach(v => v.classList.remove('active'));
        switch (viewName) {
            case 'welcome': welcomeView.classList.add('active'); break;
            case 'analysis': analysisView.classList.add('active'); break;
            case 'history': historyView.classList.add('active'); break;
            case 'settings': settingsView.classList.add('active'); loadSettings(); break;
        }
        currentView = viewName;
    }

    // ========== 视频信息 ==========
    function handleVideoInfo(info) {
        videoInfo = info;
        videoTitle.textContent = info.title || '未知标题';
        videoUploader.textContent = info.uploader || '未知UP主';
        videoDuration.textContent = info.duration || '-';
        videoBvid.textContent = info.bvid || '-';
        videoInfoCard.classList.remove('hidden');
        switchView('analysis');
    }

    // ========== 进度 ==========
    function handleProgress(msg) {
        progressSection.classList.remove('hidden');
        const percent = Math.round(msg.progress * 100);
        progressBar.style.setProperty('--progress', percent + '%');
        progressBar.querySelector(':scope') || (progressBar.innerHTML = '');
        // 用 CSS 变量控制进度
        progressBar.style.cssText = `--w: ${percent}%`;
        progressText.textContent = percent + '%';
        progressMessage.textContent = msg.message || '';

        // 显示进度条内部填充
        updateProgressBar(percent);
    }

    function updateProgressBar(percent) {
        // 直接用伪元素方式不可靠，改用内部 div
        let fill = progressBar.querySelector('.progress-fill');
        if (!fill) {
            fill = document.createElement('div');
            fill.className = 'progress-fill';
            fill.style.cssText = 'height:100%;background:var(--accent);border-radius:3px;transition:width 0.3s ease;';
            progressBar.innerHTML = '';
            progressBar.appendChild(fill);
        }
        fill.style.width = percent + '%';
    }

    // ========== 字幕 ==========
    function handleSubtitleFound(msg) {
        transcriptArea.classList.remove('hidden');
        transcriptText.textContent = msg.text;
        transcriptFull = msg.text;
        progressMessage.textContent = `已获取字幕（${msg.language}）`;
    }

    // ========== ASR 识别 ==========
    function handleAsrToken(msg) {
        transcriptArea.classList.remove('hidden');
        transcriptFull = msg.fullText;
        transcriptText.innerHTML = '';
        transcriptText.textContent = msg.fullText;
        // 添加光标
        const cursor = document.createElement('span');
        cursor.className = 'cursor';
        transcriptText.appendChild(cursor);
        // 自动滚动到底部
        transcriptArea.scrollTop = transcriptArea.scrollHeight;
    }

    function handleTimeEstimate(msg) {
        timeEstimate.classList.remove('hidden');
        elapsedTime.textContent = formatTime(msg.elapsed);
        remainingTime.textContent = msg.remaining > 0 ? formatTime(msg.remaining) : '计算中...';
    }

    function handleTranscriptDone(msg) {
        transcriptFull = msg.text;
        // 移除光标
        const cursor = transcriptText.querySelector('.cursor');
        if (cursor) cursor.remove();
        transcriptText.textContent = msg.text;
        progressMessage.textContent = `识别完成（${msg.source === 'subtitle' ? '字幕' : 'ASR'}）`;
        timeEstimate.classList.add('hidden');
    }

    // ========== 摘要 ==========
    function handleSummaryToken(msg) {
        summaryCard.classList.remove('hidden');
        summaryText += msg.token;
        renderMarkdown(summaryContent, summaryText);
        // 自动滚动
        summaryContent.scrollTop = summaryContent.scrollHeight;
    }

    function handleSummaryDone(msg) {
        summaryText = msg.summary;
        renderMarkdown(summaryContent, summaryText);
        // 显示对话区和底部栏
        chatSection.classList.remove('hidden');
        footer.classList.remove('hidden');
        // 更新进度
        updateProgressBar(100);
        progressText.textContent = '100%';
        progressMessage.textContent = '分析完成';
        setTimeout(() => progressSection.classList.add('hidden'), 2000);
    }

    // ========== 对话 ==========
    function sendMessage() {
        const content = chatInput.value.trim();
        if (!content || isStreaming) return;

        // 添加用户消息
        addChatBubble('user', content);
        chatHistory.push({ role: 'user', content });
        chatInput.value = '';
        chatInput.style.height = 'auto';

        // 准备接收 AI 回复
        isStreaming = true;
        btnSend.disabled = true;
        const aiBubble = addChatBubble('assistant', '', true);

        // 发送到 service worker
        chrome.runtime.sendMessage({
            type: 'SEND_MESSAGE',
            content: content,
            history: chatHistory.slice(0, -1) // 不包含当前消息（已在 service worker 中添加）
        });
    }

    function handleChatToken(msg) {
        const lastBubble = chatMessages.querySelector('.chat-bubble.assistant:last-child .bubble-content');
        if (lastBubble) {
            lastBubble.textContent += msg.token;
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    function handleChatDone(msg) {
        isStreaming = false;
        btnSend.disabled = false;
        chatHistory.push({ role: 'assistant', content: msg.reply });
        // 移除加载指示器
        const lastBubble = chatMessages.querySelector('.chat-bubble.assistant:last-child');
        if (lastBubble) lastBubble.classList.remove('loading');
    }

    function handleChatError(msg) {
        isStreaming = false;
        btnSend.disabled = false;
        const lastBubble = chatMessages.querySelector('.chat-bubble.assistant:last-child .bubble-content');
        if (lastBubble) {
            lastBubble.textContent = '❌ ' + msg.error;
            lastBubble.style.color = 'var(--error)';
        }
    }

    function addChatBubble(role, content, isLoading = false) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${role}`;
        if (isLoading) bubble.classList.add('loading');

        const label = document.createElement('div');
        label.className = 'role-label';
        label.textContent = role === 'user' ? '👤 你' : '🤖 AI';

        const body = document.createElement('div');
        body.className = 'bubble-content';
        body.textContent = content;

        bubble.appendChild(label);
        bubble.appendChild(body);
        chatMessages.appendChild(bubble);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        return bubble;
    }

    // ========== 错误 ==========
    function handleError(error) {
        progressSection.classList.remove('hidden');
        progressMessage.innerHTML = `
            <div class="error-card">
                <div class="error-icon">❌</div>
                <div class="error-message">${error}</div>
                <button class="retry-btn" onclick="chrome.runtime.sendMessage({type:'RETRY'})">🔄 重试</button>
            </div>
        `;
        footer.classList.remove('hidden');
    }

    // ========== 恢复状态 ==========
    function restoreState(state) {
        if (state.videoInfo) {
            handleVideoInfo(state.videoInfo);
        }
        if (state.transcript) {
            transcriptFull = state.transcript;
            transcriptArea.classList.remove('hidden');
            transcriptText.textContent = state.transcript;
        }
        if (state.summary) {
            summaryText = state.summary;
            summaryCard.classList.remove('hidden');
            renderMarkdown(summaryContent, state.summary);
            chatSection.classList.remove('hidden');
        }
        if (state.progress < 1) {
            progressSection.classList.remove('hidden');
            updateProgressBar(Math.round(state.progress * 100));
        }
        footer.classList.remove('hidden');
        switchView('analysis');
    }

    // ========== 历史记录 ==========
    async function loadHistory() {
        chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, (history) => {
            const list = $('#historyList');
            if (!history || history.length === 0) {
                list.innerHTML = '<div class="history-empty">暂无分析历史</div>';
                return;
            }
            list.innerHTML = history.map(h => `
                <div class="history-item" data-id="${h.id}">
                    <div class="history-title">📺 ${escapeHtml(h.title || '未知标题')}</div>
                    <div class="history-meta">${escapeHtml(h.uploader || '')} · ${new Date(h.timestamp).toLocaleString('zh-CN')}</div>
                    <div class="history-preview">${escapeHtml(h.transcript || '')}</div>
                </div>
            `).join('');
        });
    }

    // ========== 设置 ==========
    async function loadSettings() {
        chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (config) => {
            $('#cfgApiKey').value = config.apiKey || '';
            $('#cfgBaseUrl').value = config.baseUrl || '';
            $('#cfgAsrModel').value = config.asrModel || '';
            $('#cfgChatModel').value = config.chatModel || '';
            $('#cfgAsrLanguage').value = config.asrLanguage || 'zh';
            $('#cfgMp3Bitrate').value = config.mp3Bitrate || 96;
            $('#cfgSummaryStyle').value = config.summaryStyle || 'default';
            $('#cfgCustomPrompt').value = config.customSystemPrompt || '';
            $('#cfgAutoSummarize').checked = config.autoSummarize !== false;
        });
    }

    function saveSettings() {
        const config = {
            apiKey: $('#cfgApiKey').value.trim(),
            baseUrl: $('#cfgBaseUrl').value.trim(),
            asrModel: $('#cfgAsrModel').value.trim(),
            chatModel: $('#cfgChatModel').value.trim(),
            asrLanguage: $('#cfgAsrLanguage').value,
            mp3Bitrate: parseInt($('#cfgMp3Bitrate').value),
            summaryStyle: $('#cfgSummaryStyle').value,
            customSystemPrompt: $('#cfgCustomPrompt').value.trim(),
            autoSummarize: $('#cfgAutoSummarize').checked
        };

        chrome.runtime.sendMessage({ type: 'SAVE_CONFIG', config }, () => {
            showToast('设置已保存');
            setTimeout(() => switchView('welcome'), 1000);
        });
    }

    function testApiConnection() {
        const config = {
            apiKey: $('#cfgApiKey').value.trim(),
            baseUrl: $('#cfgBaseUrl').value.trim(),
            chatModel: $('#cfgChatModel').value.trim()
        };

        if (!config.apiKey || !config.baseUrl) {
            showToast('请先填写 API Key 和 Base URL');
            return;
        }

        const btn = $('#btnTestApi');
        btn.textContent = '测试中...';
        btn.disabled = true;

        // 简单测试：发送一个请求看是否能连通
        fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.chatModel,
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 5
            })
        }).then(r => {
            showToast(r.ok ? '✅ 连接成功' : `❌ 连接失败 (${r.status})`);
        }).catch(e => {
            showToast('❌ 连接失败: ' + e.message);
        }).finally(() => {
            btn.textContent = '测试连接';
            btn.disabled = false;
        });
    }

    function loadSummaryStylePreset(style) {
        const presets = {
            default: '你是一个视频内容分析助手。请用结构化的方式总结以下视频内容，包括：\n1. 主题概述\n2. 关键要点（用编号列表）\n3. 重要细节\n4. 总结\n\n请用中文回答，语言简洁明了。',
            academic: '你是一个学术研究助手。请以学术论文的风格分析以下视频内容，包括：\n1. 研究主题\n2. 核心论点\n3. 论据分析\n4. 方法论\n5. 结论与启示\n\n请用严谨的学术语言回答。',
            casual: '你是一个友好的内容总结助手。请用通俗易懂的口语化方式总结以下视频内容，就像在和朋友聊天一样。重点说说：\n- 这个视频讲了啥\n- 最有意思的部分\n- 你觉得怎么样\n\n轻松一点就好~',
            bullet: '你是一个内容提炼助手。请将以下视频内容提炼为简洁的要点列表：\n- 每个要点用一句话概括\n- 按重要性排序\n- 最多列出10个要点\n- 最后用一句话做总结',
            mindmap: '你是一个思维导图助手。请将以下视频内容整理为树形结构的思维导图格式：\n主题\n├── 分支1\n│   ├── 要点\n│   └── 要点\n├── 分支2\n│   ├── 要点\n│   └── 要点\n└── 总结'
        };
        $('#cfgCustomPrompt').value = presets[style] || '';
    }

    // ========== 导出 ==========
    function exportAs(format) {
        const title = videoInfo?.title || '视频分析';
        const date = new Date().toLocaleString('zh-CN');
        let content, filename, mimeType;

        const header = `# ${title}\n\nUP主：${videoInfo?.uploader || '-'}\n时长：${videoInfo?.duration || '-'}\nBV号：${videoInfo?.bvid || '-'}\n分析时间：${date}\n\n`;

        const transcriptSection = `## 视频文字\n\n${transcriptFull || '无'}\n\n`;
        const summarySection = `## 视频摘要\n\n${summaryText || '无'}\n\n`;
        const chatSectionText = chatHistory.length > 0
            ? `## 对话记录\n\n${chatHistory.map(m => `**${m.role === 'user' ? '你' : 'AI'}**：${m.content}`).join('\n\n')}\n`
            : '';

        switch (format) {
            case 'md':
                content = header + transcriptSection + summarySection + chatSectionText;
                filename = `${sanitizeFilename(title)}.md`;
                mimeType = 'text/markdown';
                break;
            case 'txt':
                content = `${title}\n${'='.repeat(title.length)}\n\nUP主：${videoInfo?.uploader || '-'}\n时长：${videoInfo?.duration || '-'}\nBV号：${videoInfo?.bvid || '-'}\n分析时间：${date}\n\n--- 视频文字 ---\n${transcriptFull || '无'}\n\n--- 视频摘要 ---\n${summaryText || '无'}\n\n${chatHistory.length > 0 ? '--- 对话记录 ---\n' + chatHistory.map(m => `${m.role === 'user' ? '你' : 'AI'}：${m.content}`).join('\n\n') : ''}`;
                filename = `${sanitizeFilename(title)}.txt`;
                mimeType = 'text/plain';
                break;
            case 'html':
                content = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.7; color: #333; }
h1 { border-bottom: 2px solid #00a1d6; padding-bottom: 10px; }
h2 { color: #00a1d6; margin-top: 30px; }
.meta { color: #666; font-size: 14px; }
.transcript, .summary { background: #f9f9f9; padding: 16px; border-radius: 8px; white-space: pre-wrap; }
.chat-bubble { margin: 10px 0; padding: 10px 14px; border-radius: 8px; }
.user { background: #e3f2fd; text-align: right; }
.assistant { background: #f5f5f5; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">UP主：${escapeHtml(videoInfo?.uploader || '-')} · 时长：${escapeHtml(videoInfo?.duration || '-')} · BV号：${escapeHtml(videoInfo?.bvid || '-')} · 分析时间：${date}</div>
<h2>📋 视频摘要</h2>
<div class="summary">${escapeHtml(summaryText || '无')}</div>
<h2>📝 视频文字</h2>
<div class="transcript">${escapeHtml(transcriptFull || '无')}</div>
${chatHistory.length > 0 ? `<h2>💬 对话记录</h2>${chatHistory.map(m => `<div class="chat-bubble ${m.role}"><strong>${m.role === 'user' ? '你' : 'AI'}：</strong>${escapeHtml(m.content)}</div>`).join('')}` : ''}
</body></html>`;
                filename = `${sanitizeFilename(title)}.html`;
                mimeType = 'text/html';
                break;
        }

        // 下载文件
        const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        showToast(`已导出 ${format.toUpperCase()} 文件`);
    }

    // ========== 主题 ==========
    function applyTheme(theme) {
        if (theme === 'auto') {
            theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', theme);
        $('#btnTheme').textContent = theme === 'dark' ? '☀️' : '🌙';
        localStorage.setItem('theme', theme === 'dark' ? 'dark' : 'light');
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        applyTheme(current === 'dark' ? 'light' : 'dark');
    }

    // ========== 工具函数 ==========
    function renderMarkdown(element, text) {
        // 简单的 Markdown 渲染
        let html = escapeHtml(text);
        // 标题
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        // 粗体
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // 列表
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
        // 代码
        html = html.replace(/`(.+?)`/g, '<code>$1</code>');
        // 换行
        html = html.replace(/\n/g, '<br>');

        element.innerHTML = html;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatTime(seconds) {
        if (!seconds || seconds < 0) return '00:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function sanitizeFilename(name) {
        return (name || '导出').replace(/[<>:"|?*\\/]/g, '_').substring(0, 100);
    }

    function showToast(text) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = text;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    // ========== 启动 ==========
    init();
})();
