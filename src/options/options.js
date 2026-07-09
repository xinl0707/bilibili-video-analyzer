/**
 * 设置页面逻辑
 */
(function () {
    'use strict';

    // 默认配置
    const DEFAULTS = {
        apiKey: '',
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
        asrModel: 'mimo-v2.5-asr',
        chatModel: 'mimo-v2.5-pro',
        asrLanguage: 'zh',
        mp3Bitrate: 96,
        summaryStyle: 'default',
        customSystemPrompt: '',
        autoSummarize: true
    };

    // 总结风格预设
    const PRESETS = {
        default: '你是一个视频内容分析助手。请用结构化的方式总结以下视频内容，包括：\n1. 主题概述\n2. 关键要点（用编号列表）\n3. 重要细节\n4. 总结\n\n请用中文回答，语言简洁明了。',
        academic: '你是一个学术研究助手。请以学术论文的风格分析以下视频内容，包括：\n1. 研究主题\n2. 核心论点\n3. 论据分析\n4. 方法论\n5. 结论与启示\n\n请用严谨的学术语言回答。',
        casual: '你是一个友好的内容总结助手。请用通俗易懂的口语化方式总结以下视频内容，就像在和朋友聊天一样。重点说说：\n- 这个视频讲了啥\n- 最有意思的部分\n- 你觉得怎么样\n\n轻松一点就好~',
        bullet: '你是一个内容提炼助手。请将以下视频内容提炼为简洁的要点列表：\n- 每个要点用一句话概括\n- 按重要性排序\n- 最多列出10个要点\n- 最后用一句话做总结',
        mindmap: '你是一个思维导图助手。请将以下视频内容整理为树形结构的思维导图格式：\n主题\n├── 分支1\n│   ├── 要点\n│   └── 要点\n├── 分支2\n│   ├── 要点\n│   └── 要点\n└── 总结'
    };

    // 加载配置
    function loadConfig() {
        chrome.storage.local.get('config', (data) => {
            const config = { ...DEFAULTS, ...(data.config || {}) };
            document.getElementById('apiKey').value = config.apiKey || '';
            document.getElementById('baseUrl').value = config.baseUrl || DEFAULTS.baseUrl;
            document.getElementById('asrModel').value = config.asrModel || DEFAULTS.asrModel;
            document.getElementById('chatModel').value = config.chatModel || DEFAULTS.chatModel;
            document.getElementById('asrLanguage').value = config.asrLanguage || 'zh';
            document.getElementById('mp3Bitrate').value = config.mp3Bitrate || 96;
            document.getElementById('summaryStyle').value = config.summaryStyle || 'default';
            document.getElementById('customPrompt').value = config.customSystemPrompt || '';
            document.getElementById('autoSummarize').checked = config.autoSummarize !== false;
        });
    }

    // 保存配置
    function saveConfig() {
        const config = {
            apiKey: document.getElementById('apiKey').value.trim(),
            baseUrl: document.getElementById('baseUrl').value.trim() || DEFAULTS.baseUrl,
            asrModel: document.getElementById('asrModel').value.trim() || DEFAULTS.asrModel,
            chatModel: document.getElementById('chatModel').value.trim() || DEFAULTS.chatModel,
            asrLanguage: document.getElementById('asrLanguage').value,
            mp3Bitrate: parseInt(document.getElementById('mp3Bitrate').value),
            summaryStyle: document.getElementById('summaryStyle').value,
            customSystemPrompt: document.getElementById('customPrompt').value.trim(),
            autoSummarize: document.getElementById('autoSummarize').checked
        };

        chrome.storage.local.set({ config }, () => {
            showToast('✅ 设置已保存');
        });
    }

    // 恢复默认
    function resetConfig() {
        if (!confirm('确定要恢复默认设置吗？')) return;
        chrome.storage.local.set({ config: DEFAULTS }, () => {
            loadConfig();
            showToast('已恢复默认设置');
        });
    }

    // 测试连接
    function testConnection() {
        const baseUrl = document.getElementById('baseUrl').value.trim();
        const apiKey = document.getElementById('apiKey').value.trim();
        const chatModel = document.getElementById('chatModel').value.trim();

        if (!apiKey) {
            showToast('❌ 请先填写 API Key');
            return;
        }

        const btn = document.getElementById('btnTest');
        btn.textContent = '测试中...';
        btn.disabled = true;

        fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: chatModel || DEFAULTS.chatModel,
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

    // 提示框
    function showToast(text) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = text;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }

    // 绑定事件
    document.getElementById('btnSave').addEventListener('click', saveConfig);
    document.getElementById('btnReset').addEventListener('click', resetConfig);
    document.getElementById('btnTest').addEventListener('click', testConnection);

    // 总结风格切换
    document.getElementById('summaryStyle').addEventListener('change', (e) => {
        const prompt = document.getElementById('customPrompt');
        if (!prompt.value.trim()) {
            prompt.value = PRESETS[e.target.value] || '';
        }
    });

    // 初始化
    loadConfig();
})();
