# B 站视频快速分析

一键获取 B 站视频字幕/音频，AI 语音识别 + 大模型总结，侧边栏对话交互。

## 功能特性

- 🎯 **智能获取**：优先使用 B 站 CC 字幕，无字幕时自动降级为音频 ASR 识别
- 🤖 **AI 总结**：大模型自动生成视频摘要
- 💬 **对话交互**：与 AI 对话深入分析视频内容
- 📤 **多格式导出**：支持 Markdown / 纯文本 / HTML 导出
- 🎨 **亮暗主题**：跟随浏览器主题，支持手动切换
- ⌨️ **快捷键**：Alt+B 一键触发

## 技术栈

- Manifest V3 (Edge Extension)
- Service Worker + Side Panel
- mux.js + lamejs (音频转码)
- MiMo ASR + MiMo Pro (AI 能力)

## 项目结构

```
bilibili-video-analyzer/
├── docs/          # 设计规范与开发计划
├── src/           # 源码
├── releases/      # 各版本 release
└── README.md
```

## 开发计划

详见 [docs/开发计划.md](docs/开发计划.md)

## UI 设计

详见 [docs/UI设计规范.md](docs/UI设计规范.md)
