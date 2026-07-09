/**
 * MiMo API 客户端
 * 支持 ASR 语音识别和对话/总结
 */
const ApiClient = {
    /**
     * 发送 ASR 语音识别请求（流式）
     * @param {string} audioBase64 Base64 编码的 MP3 音频
     * @param {Object} config 配置
     * @param {Function} onToken 每收到一个 token 的回调
     * @returns {Promise<string>} 完整识别文字
     */
    async asr(audioBase64, config, onToken) {
        const { baseUrl, apiKey, asrModel, asrLanguage } = config;
        const url = `${baseUrl}/chat/completions`;

        const body = {
            model: asrModel,
            messages: [{
                role: 'user',
                content: [{
                    type: 'input_audio',
                    input_audio: {
                        data: `data:audio/mpeg;base64,${audioBase64}`
                    }
                }]
            }],
            asr_options: { language: asrLanguage },
            stream: true
        };

        return this._streamRequest(url, apiKey, body, onToken);
    },

    /**
     * 发送对话/总结请求（流式）
     * @param {Array} messages 消息数组
     * @param {Object} config 配置
     * @param {Function} onToken 每收到一个 token 的回调
     * @returns {Promise<string>} 完整回复
     */
    async chat(messages, config, onToken) {
        const { baseUrl, apiKey, chatModel } = config;
        const url = `${baseUrl}/chat/completions`;

        const body = {
            model: chatModel,
            messages: messages,
            stream: true
        };

        return this._streamRequest(url, apiKey, body, onToken);
    },

    /**
     * 流式请求底层实现
     * @param {string} url 请求地址
     * @param {string} apiKey API Key
     * @param {Object} body 请求体
     * @param {Function} onToken token 回调
     * @returns {Promise<string>}
     */
    async _streamRequest(url, apiKey, body, onToken) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMsg;
            try {
                const errorJson = JSON.parse(errorText);
                errorMsg = errorJson.error?.message || errorJson.message || errorText;
            } catch {
                errorMsg = errorText;
            }
            throw new Error(`API 请求失败 (${response.status}): ${errorMsg}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                const data = trimmed.slice(6);
                if (data === '[DONE]') continue;

                try {
                    const json = JSON.parse(data);
                    const content = json.choices?.[0]?.delta?.content;
                    if (content) {
                        fullText += content;
                        if (onToken) onToken(content, fullText);
                    }
                } catch (e) {
                    // 解析失败，跳过
                }
            }
        }

        return fullText;
    },

    /**
     * 测试 API 连接
     * @param {Object} config { baseUrl, apiKey, chatModel }
     * @returns {Promise<boolean>}
     */
    async testConnection(config) {
        try {
            const { baseUrl, apiKey, chatModel } = config;
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: chatModel,
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 5
                })
            });
            return response.ok;
        } catch {
            return false;
        }
    }
};
