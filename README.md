# 🎨 提示词生成器

AI 提示词管理与生图一体化工具，支持随机组合、AI 润色、ComfyUI 生图。
<img width="1712" height="1232" alt="image" src="https://github.com/user-attachments/assets/f5eeb501-35c1-4438-a02c-35943418747c" />

## ✨ 核心亮点

- **提示词管理**：类别管理、批量添加/删除、搜索过滤
- **中英文同步**：自动生成中英文对照，一键复制
- **模板优化**：一键添加光线/皮肤/画质描述词
- **AI 润色**：接入 DeepSeek/Kimi/OpenAI/Ollama/LM Studio，智能优化提示词
- **ComfyUI 生图**：读取工作流 → 替换提示词 → 设置尺寸 → 随机种子 → 批次生图
- **数据持久化**：所有数据自动保存到 JSON 文件，刷新不丢失
- **一键备份**：提示词、AI 设置、ComfyUI 设置可独立导出/导入

## 🚀 快速开始

### 环境要求
- Python 3.8+
- 现代浏览器（Chrome / Edge / Firefox）

### 启动

```bash
# 下载或克隆项目
cd prompt-generator

# 启动服务（默认端口 8080）
python start_server.py

# 浏览器打开
# http://localhost:8080
```

Windows 用户也可直接双击 `start_server.bat`。

### 配置 ComfyUI（可选）

1. 启动 ComfyUI（默认 `http://127.0.0.1:8188`）
2. 页面中点击 **ComfyUI** → ⚙️ **设置** → 填写 ComfyUI 地址
3. **上传工作流**（从 ComfyUI 导出 JSON）
4. 点击 🚀 **开始生图**

## 🖼️ ComfyUI 生图说明
**工作流必须使用 API 格式导出：**

正确操作：
1. 在 ComfyUI 搭建好工作流
2. 点击 ComfyUI 界面右上角 **Save (API Format)** 按钮导出 JSON
3. 在本页面上传该 JSON 文件
❌ 不要使用普通的 Save / Export（那种格式包含界面布局信息，无法解析）
系统会自动检测 CLIPTextEncode 节点（替换提示词）、EmptyLatentImage 节点（读取尺寸）、KSampler 节点（随机种子）。

## 🎯 功能介绍

### 提示词生成
| 操作 | 说明 |
|------|------|
| 🎲 **随机** | 从已开启的类别中随机组合提示词 |
| ✨ **优化** | 自动添加光线/皮肤/画质描述增强 |
| 🤖 **AI 润色** | 调用 AI 模型智能优化提示词（需配置 API） |
| 📋 **复制** | 一键复制中文或英文提示词 |

### 类别管理
- 添加 / 批量添加类别
- 删除类别
- 提示词管理：添加、批量添加、删除
- 搜索过滤提示词

### 身份管理
| 项目 | 说明 |
|------|------|
| 年龄 | 可设置范围（默认 18-49），支持随机/锁定 |
| 地区 | 可自定义（默认 中国/韩国/日本/欧美），支持随机/锁定 |
| 性别 | 可自定义（默认 女/男），支持随机/锁定 |

### 润色模板管理
- 6 组模板：中文润色、英文润色、皮肤描述、画质描述
- 可添加/删除自定义模板
<img width="1578" height="1232" alt="image" src="https://github.com/user-attachments/assets/bafce7c5-ea19-46dd-8342-5d4aa5b20695" />

### AI 润色设置
| 厂商 | 类型 | 说明 |
|------|------|------|
| DeepSeek | 在线 | 需 API Key |
| Kimi (月之暗面) | 在线 | 需 API Key |
| OpenAI | 在线 | 需 API Key |
| Ollama | 本地 | 无需 Key |
| LM Studio | 本地 | 无需 Key |

支持设置 API 地址、Key、模型名称、系统预设。

### ComfyUI 生图
- 连接状态自动检测
- 工作流管理：上传、选择、删除
- 自动识别 CLIPTextEncode 节点
- 设置图片尺寸
- 随机种子（每批次不同）
- 提示词数量 × 批次数量
- 实时进度显示（步骤/时间）
- 生图画廊：查看、下载、删除
- 查看每张图片的提示词和种子
<img width="1983" height="1117" alt="image" src="https://github.com/user-attachments/assets/8a1c1ca7-6ffe-4afb-ad56-271cfa0d9568" />

### 数据管理
- 自动保存到 JSON 文件（无需数据库）
- 数据导出：提示词 / AI 设置 / ComfyUI 设置 / 服务配置
- 数据导入：文件名自动识别类别，可选择导入项
- 服务端自动备份

## 📂 文件说明

| 文件 | 说明 |
|------|------|
| `prompt-generator.html` | 主页面 |
| `start_server.py` | HTTP 服务（含 ComfyUI 代理） |
| `start_server.bat` | Windows 快捷启动 |
| `data/prompts.json` | 提示词数据 + 翻译映射 |
| `data/enrich_data.json` | 润色模板 |
| `data/server_config.json` | 服务配置（首次运行自动生成） |
| `data/ai_settings.json` | AI 设置（首次保存自动生成） |
| `data/comfy_settings.json` | ComfyUI 设置（首次保存自动生成） |

## 🔒 数据安全

所有数据存储在本地 `data/` 目录的 JSON 文件中。除你主动配置的 AI API 和 ComfyUI 地址外，不会向任何外部服务器发送数据。

## 📝 开源协议

MIT
