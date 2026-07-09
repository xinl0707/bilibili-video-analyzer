/**
 * 存储工具模块
 * 管理配置、历史记录、性能数据
 */
const Storage = {
    // 默认配置
    DEFAULTS: {
        apiKey: '',
        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
        asrModel: 'mimo-v2.5-asr',
        chatModel: 'mimo-v2.5-pro',
        asrLanguage: 'zh',
        mp3Bitrate: 96,
        summaryStyle: 'default',
        customSystemPrompt: '你是一个视频内容分析助手。请用结构化的方式总结以下视频内容，包括：\n1. 主题概述\n2. 关键要点（用编号列表）\n3. 重要细节\n4. 总结\n\n请用中文回答，语言简洁明了。',
        autoSummarize: true,
        theme: 'auto'
    },

    // 总结风格预设
    SUMMARY_STYLES: {
        default: '你是一个视频内容分析助手。请用结构化的方式总结以下视频内容，包括：\n1. 主题概述\n2. 关键要点（用编号列表）\n3. 重要细节\n4. 总结\n\n请用中文回答，语言简洁明了。',
        academic: '你是一个学术研究助手。请以学术论文的风格分析以下视频内容，包括：\n1. 研究主题\n2. 核心论点\n3. 论据分析\n4. 方法论\n5. 结论与启示\n\n请用严谨的学术语言回答。',
        casual: '你是一个友好的内容总结助手。请用通俗易懂的口语化方式总结以下视频内容，就像在和朋友聊天一样。重点说说：\n- 这个视频讲了啥\n- 最有意思的部分\n- 你觉得怎么样\n\n轻松一点就好~',
        bullet: '你是一个内容提炼助手。请将以下视频内容提炼为简洁的要点列表：\n- 每个要点用一句话概括\n- 按重要性排序\n- 最多列出10个要点\n- 最后用一句话做总结',
        mindmap: '你是一个思维导图助手。请将以下视频内容整理为树形结构的思维导图格式：\n主题\n├── 分支1\n│   ├── 要点\n│   └── 要点\n├── 分支2\n│   ├── 要点\n│   └── 要点\n└── 总结\n\n请用文本缩进表示层级关系。'
    },

    // 获取配置
    async getConfig() {
        return new Promise((resolve) => {
            chrome.storage.local.get('config', (data) => {
                resolve({ ...this.DEFAULTS, ...(data.config || {}) });
            });
        });
    },

    // 保存配置
    async setConfig(config) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ config }, resolve);
        });
    },

    // 更新单个配置项
    async updateConfig(key, value) {
        const config = await this.getConfig();
        config[key] = value;
        return this.setConfig(config);
    },

    // 获取历史记录
    async getHistory() {
        return new Promise((resolve) => {
            chrome.storage.local.get('history', (data) => {
                resolve(data.history || []);
            });
        });
    },

    // 添加历史记录
    async addHistory(record) {
        const history = await this.getHistory();
        history.unshift({
            ...record,
            id: Date.now().toString(),
            timestamp: Date.now()
        });
        // 最多保留 100 条
        if (history.length > 100) history.length = 100;
        return new Promise((resolve) => {
            chrome.storage.local.set({ history }, resolve);
        });
    },

    // 删除历史记录
    async deleteHistory(id) {
        const history = await this.getHistory();
        const filtered = history.filter(h => h.id !== id);
        return new Promise((resolve) => {
            chrome.storage.local.set({ history: filtered }, resolve);
        });
    },

    // 清空历史
    async clearHistory() {
        return new Promise((resolve) => {
            chrome.storage.local.set({ history: [] }, resolve);
        });
    },

    // 获取 ASR 性能历史
    async getAsrHistory() {
        return new Promise((resolve) => {
            chrome.storage.local.get('asrHistory', (data) => {
                resolve(data.asrHistory || []);
            });
        });
    },

    // 记录 ASR 性能数据
    async addAsrRecord(audioSizeMB, durationSec) {
        const history = await this.getAsrHistory();
        history.push({ audioSizeMB, durationSec, timestamp: Date.now() });
        if (history.length > 20) history.shift();
        return new Promise((resolve) => {
            chrome.storage.local.set({ asrHistory: history }, resolve);
        });
    },

    // 预估 ASR 剩余时间
    async estimateAsrTime(audioSizeMB, processedMB) {
        const history = await this.getAsrHistory();
        if (history.length === 0) return null;
        const avgSpeed = history.reduce((sum, h) => sum + h.audioSizeMB / h.durationSec, 0) / history.length;
        return (audioSizeMB - processedMB) / avgSpeed;
    },

    // 获取当前分析状态
    async getAnalysisState() {
        return new Promise((resolve) => {
            chrome.storage.local.get('analysisState', (data) => {
                resolve(data.analysisState || null);
            });
        });
    },

    // 保存分析状态
    async setAnalysisState(state) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ analysisState: state }, resolve);
        });
    },

    // 清除分析状态
    async clearAnalysisState() {
        return new Promise((resolve) => {
            chrome.storage.local.remove('analysisState', resolve);
        });
    }
};
