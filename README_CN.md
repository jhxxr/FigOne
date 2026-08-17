<div align="center">
  <img src="assets/logo.svg" width="128" height="128" alt="FigOne Logo" />
  <h1>FigOne</h1>
  <p><strong>下一代学术论文插图生成与矢量编辑工作室</strong></p>
  <p><em>基于多模态大模型与 SAM3 视觉分割，将论文方法描述与位图草图一键转化为出版级、模块化、完全可编辑的矢量 SVG 图表。</em></p>

  <p>
    <a href="https://github.com/jhxxr/FigOne/releases"><img src="https://img.shields.io/github/v/release/jhxxr/FigOne?color=D96843&label=Release&style=flat-square" alt="Release"></a>
    <a href="https://github.com/jhxxr/FigOne/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License"></a>
    <a href="#"><img src="https://img.shields.io/badge/Platform-Windows%20x64-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Platform"></a>
    <a href="#"><img src="https://img.shields.io/badge/Tauri-v2-FFC131?style=flat-square&logo=tauri&logoColor=black" alt="Tauri 2"></a>
    <a href="#"><img src="https://img.shields.io/badge/Backend-FastAPI%20%7C%20Python%203.10+-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI"></a>
    <a href="#"><img src="https://img.shields.io/badge/Vision%20AI-SAM3%20%2B%20RMBG%202.0-E25A38?style=flat-square" alt="Vision AI"></a>
    <a href="https://github.com/jhxxr/FigOne/stargazers"><img src="https://img.shields.io/github/stars/jhxxr/FigOne?style=flat-square&color=gold" alt="Stars"></a>
  </p>

  <p>
    <a href="README.md">English</a> | <strong>中文说明</strong>
  </p>

  <p>
    <a href="#-项目简介">项目简介</a> •
    <a href="#-核心特性">核心特性</a> •
    <a href="#-工作流管线与架构">工作流架构</a> •
    <a href="#-快速上手">快速上手</a> •
    <a href="#-工作流模式指南">工作流指南</a> •
    <a href="#-渠道与模型配置">模型渠道</a> •
    <a href="#-本地开发指南">本地开发</a> •
    <a href="#-参与贡献">参与贡献</a>
  </p>
</div>

---

## 🌟 项目简介

在撰写学术论文（如 IEEE/ACM Transactions、CVPR、NeurIPS、ICLR、Nature 等）时，绘制排版严谨、美观且符合出版标准的结构示意图（Figure）往往需要耗费大量时间：

- **传统扩散/图像生成模型**（DALL-E 3、Midjourney、Stable Diffusion）生成的位图不仅文字扭曲模糊、逻辑幻觉频出，而且无法对局部图层或文字进行任何二次编辑。
- **传统矢量绘图软件**（Adobe Illustrator、Inkscape、Draw.io）需要从零手工搭建图形、连线和排版，耗时耗力。

**FigOne** 创造性地提出了**“分阶段解耦生成与矢量重构管线”**，完美解决了这一痛点：
1. **语义构思**：直接解析论文方法文本，快速生成全局视觉草图（亦可直接导入你已有的手绘/位图草图）。
2. **神经视觉解构**：通过 **SAM3** (*Segment Anything Model 3*) 与 **RMBG 2.0**，精准识别各个图表组件实体，完成透明背景抠图与空间坐标锚定。
3. **多模态矢量重构**：调用顶尖多模态大模型（GPT-4.1 / GPT-5.5 / Gemini 3.1 Pro / Claude 3.7），理解草图拓扑并生成语义清晰、分层严谨的 SVG 矢量代码。
4. **内置交互式画布**：在桌面端内置矢量编辑器中，随时对文字标签、箭头路径、颜色主题、模块布局进行微调并无损导出。

```text
[ 方法文本输入 ] ──> [ 1. 结构草图生成 ] ──> [ 2. SAM3 智能分割 ] ──> [ 3. RMBG 精细抠图 ]
                                                                                   │
[ 出版级矢量 SVG ] <── [ 内置矢量交互画布 ] <── [ 5. 组装替换 ] <── [ 4. 多模态 SVG 重构 ]
```

---

## 🚀 核心特性

- 📝 **端到端：方法文本一键生图**  
  只需粘贴论文中的 Method / Overview 章节，FigOne 会自动解析流水线逻辑、模块关系与数据流向，生成符合顶会审美的学术示意图。

- 🖼️ **导入已有草图直接矢量化**  
  已有用 PPT、Midjourney、草稿本画好的初步草图？直接拖入导入模式，自动跳过阶段一生图，直接进行 SAM 分割与多模态 SVG 重构。

- 🧠 **前沿神经视觉底座（SAM3 + RMBG 2.0）**  
  支持本地或云端运行 SAM3 分割模型，精准定位图表中的图标、图例、框体与子组件，自动抠出透明无白边图层。

- 📐 **语义级多模态 SVG 矢量重构**  
  通过多模态大模型理解图面布局，生成语义化 SVG 代码，保证几何对齐规整、文字排版清晰、分层结构清晰。

- 🎨 **内置原生矢量编辑器（SVG-Edit）**  
  无需额外打开 Illustrator，在桌面端即可直接点选图层、拖拽调整尺寸、修改文本标签、替换图标并一键导出矢量 SVG 或超高清 PNG。

- ⚡ **本地算力加速与云端灵活混合**  
  支持通过 PyTorch CUDA / CPU 本地加载 SAM3 模型权重；若本地无 GPU，也可一键切换至 fal.ai、Roboflow 等云端分割接口。

- 🌐 **全方位多模型渠道集成**  
  内置支持便携AI（聚合网关）、OpenAI Responses & Images、Google Gemini、OpenRouter、自定义 OpenAI 兼容中转等多种渠道。

- 📦 **免配环境的轻量 Windows 桌面端**  
  基于 **Tauri 2** (Rust) 打造，安装包内置精简版 Python 独立运行环境，双击即用，无需用户手动折腾复杂的 Python 或 Node 依赖。

---

## 🔄 工作流管线与架构

FigOne 采用 5 步协同智能流水线：

```mermaid
flowchart LR
    A["步骤 1: 草图生成<br/>方法文本 -> 位图草图"] --> B["步骤 2: 区域检测<br/>SAM3 语义分割"]
    B --> C["步骤 3: 图标抠图<br/>RMBG 背景剔除"]
    C --> D["步骤 4: 矢量重构<br/>多模态 LLM 生成 SVG"]
    D --> E["步骤 5: 组装与微调<br/>交互式矢量画布"]
    
    style A fill:#D96843,stroke:#A83E20,stroke-width:2px,color:#fff
    style B fill:#F5A623,stroke:#D48806,stroke-width:2px,color:#fff
    style C fill:#E25A38,stroke:#C85834,stroke-width:2px,color:#fff
    style D fill:#4A90E2,stroke:#185ABD,stroke-width:2px,color:#fff
    style E fill:#43A047,stroke:#2E7D32,stroke-width:2px,color:#fff
```

| 步骤 | 阶段 | 核心任务与说明 |
| :--- | :--- | :--- |
| **01** | **生成 / 导入** | 依据方法文本调用图像模型（如 `gpt-image-2`）生成首阶段位图 `figure.png`，或直接使用用户上传的草图。 |
| **02** | **SAM3 分割** | 检测图表中的独立图标、实体框与文本块，输出各组件的精确像素边界框（Bounding Boxes）。 |
| **03** | **图标抠图** | 对所有检测出的独立图标进行裁剪，并通过 RMBG 2.0 去除背景噪点，输出透明 PNG 图标。 |
| **04** | **SVG 矢量重构** | 多模态大模型（Gemini / GPT / Claude）综合原图与占位符元数据，重新编写几何结构严谨的 SVG 模板代码。 |
| **05** | **组装与画布编辑** | 将裁剪好的高清透明图标回填到 SVG 对应锚点坐标中，加载至内置画布供用户自由微调与导出。 |

---

## ⚡ 快速上手

### 方式一：下载 Windows 安装包（推荐普通用户）

1. 前往 GitHub [**Releases 发布页**](https://github.com/jhxxr/FigOne/releases)。
2. 下载最新的 `FigOne_x.x.x_x64-setup.exe` 安装包。
3. 双击安装运行 FigOne。
4. 打开顶部 **模型渠道与推理配置 (Models & Providers)**，添加你的 API 密钥即可开始使用。

> **关于本地 SAM3 权重的说明**：  
> 为保证安装包轻量便携，未直接内置体积较大的 `sam3.pt` 权重文件。你可以在设置中导入本地 `sam3.pt` 开启显卡加速，或选择云端 SAM 渠道（fal.ai / Roboflow）。

---

## 📖 工作流模式指南

### 1. 方法文本工作流 (`/index.html`)
- **适用场景**：从论文的方法（Methodology）文本从零构思并生成完整图表。
- **操作步骤**：
  1. 粘贴你的方法描述（建议提炼清晰的阶段、输入输出与核心组件）。
  2. 选择已配置好的模型渠道（如 便携AI、OpenAI 或 Gemini）。
  3. 点击 **确认并前往画布**，系统将全自动运行 5 阶段生成。

### 2. 导入已有图片工作流 (`/import.html`)
- **适用场景**：你已有第一阶段的学术示意图位图，仅需借助 SAM3 和多模态大模型将其矢量化为 SVG。
- **操作步骤**：
  1. 上传你的位图文件（`.png`、`.jpg`、`.webp`）。
  2. 选择 SVG 重构模型渠道与 SAM 后端。
  3. 点击 **开始矢量化**，直接进入分割与重构流程。

### 3. 原生矢量交互画布 (`/canvas.html`)
- 实时观察流水线各步骤的执行状态与详细日志。
- 支持直接选择、移动、旋转、缩放矢量图元，修改文字内容与色系。
- 若对重构效果不满意，可直接在顶部更换多模态模型或调节画质参数一键 **Regenerate SVG**。
- 支持无损导出 `.svg` 矢量文件或高分辨率 `.png`。

---

## ⚙️ 渠道与模型配置

FigOne 提供统一的 **模型渠道中心**，支持高度自由的混合调度：

| 渠道类型 | 支持能力 | 推荐使用场景 |
| :--- | :--- | :--- |
| **便携AI (Bianxie AI)** | 一站式聚合网关 | 国内开发者与科研人员首选，支持支付宝直连与极速中转 |
| **OpenAI Responses** | 推理与视觉模型 (`gpt-4.1`, `gpt-5.5`) | 高精度 SVG 代码生成、复杂拓扑结构排版 |
| **OpenAI Images** | 图像生成模型 (`gpt-image-2`, `dall-e-3`) | 第一阶段高质量学术概念草图生成 |
| **Google Gemini** | 多模态模型 (`gemini-3.1-pro-preview`) | 大上下文视觉理解、超快速矢量重构 |
| **OpenRouter** | 多模型聚合路由 (Claude 3.7 Sonnet, DeepSeek) | 灵活尝试不同大模型的生成效果 |
| **自定义中转 (Custom)** | OpenAI 兼容接口代理 | 自建 API 网关、高校/企业内部私有化代理 |

---

## 🛠️ 本地开发指南

如需参与 FigOne 的二次开发或从源码构建，请参考以下指引：

### 环境要求
- **Node.js** >= 18
- **Rust** 与 **Cargo**（最新稳定版）
- **Python** >= 3.10
- **Windows 10/11 x64**

### 1. 克隆代码仓库
```bash
git clone https://github.com/jhxxr/FigOne.git
cd FigOne
```

### 2. 配置 Python 后端环境
```bash
cd engine
python -m venv runtime
# Windows PowerShell 下激活虚拟环境
.\runtime\Scripts\Activate.ps1

# 安装后端依赖
pip install -r requirements-runtime.txt
pip install -e ./sam3-src
cd ..
```

### 3. 启动 Tauri 桌面端开发模式
```bash
npx @tauri-apps/cli dev --config src-tauri/tauri.conf.json
```

### 4. 独立启动 FastAPI 后端（网页端调试）
```bash
cd engine
python server.py
# 浏览器访问 http://127.0.0.1:8765
```

### 5. Windows CPU 安装包

正式安装包由 [`.github/workflows/build-tauri.yml`](.github/workflows/build-tauri.yml) 在 `windows-latest` 上构建。工作流会现场安装 Python 3.12、CPU 版 Torch/TorchVision 和 SAM3，执行 CPU 原生算子与资源检查，然后生成 `python-runtime-cpu.zip` 供 Tauri 打包。`engine/python`、runtime ZIP 和 manifest 都是 CI 产物，不应提交到仓库。

安装包只携带一个 CPU runtime 压缩资源；首次启动会打开进度窗口，校验并解压到用户数据目录，后续启动按指纹复用。SAM3 与 RMBG 权重仍由用户导入，不包含在安装包中。

---

## 📂 目录结构

```text
FigOne/
├── .github/
│   └── workflows/
│       └── build-tauri.yml       # GitHub Actions 自动化打包发布工作流
├── assets/                       # 项目图标与 README 资源文件
├── engine/                       # Python FastAPI 后端与 AI 生成引擎
│   ├── autofigure2.py            # 五阶段学术图表处理管线核心逻辑
│   ├── bootstrap_sam3.py         # SAM3 运行环境引导脚本
│   ├── server.py                 # FastAPI 接口、任务队列与路由分发
│   ├── requirements-runtime.txt  # Python 依赖清单
│   ├── rmbg2-src/                # RMBG 背景抠图模块
│   ├── sam3-src/                 # Segment Anything 3 源码集成
│   └── web/                      # 前端交互界面 (HTML5, Vanilla CSS & JS)
│       ├── canvas.html           # 矢量画布与二次编辑界面
│       ├── index.html            # 方法文本工作流主界面
│       ├── import.html           # 图片导入工作流界面
│       └── models.html           # 模型渠道与硬件配置中心
└── src-tauri/                    # Tauri 2 Windows 桌面外壳 (Rust)
    ├── src/main.rs               # 桌面应用生命周期与窗口管理
    ├── tauri.conf.json           # Tauri 打包与资源配置
    └── Cargo.toml                # Rust 依赖声明
```

---

## 🗺️ 开发路线图 (Roadmap)

- [x] **v0.1.x**: 端到端“方法文本至 SVG”完整流水线与 Tauri 2 Windows 客户端。
- [x] **v0.1.x**: 支持导入已有位图草图直接矢量化。
- [x] **v0.1.x**: 内置交互式 SVG-Edit 矢量画布与中断恢复机制。
- [ ] **v0.2.0**: 原生支持 LaTeX 数学公式在 SVG 中的排版与渲染。
- [ ] **v0.2.5**: 跨平台适配（macOS Apple Silicon 及 Linux）。
- [ ] **v0.3.0**: 针对学术图表排版的微调视觉模型与风格预设集。
- [ ] **v0.4.0**: 批量图表生成与多图项目协同管理。

---

## 🤝 参与贡献

非常欢迎提交 Issue、提出功能改进建议或提交 Pull Request！

1. **Fork** 本仓库
2. 创建特性分支 (`git checkout -b feature/your-feature`)
3. 提交代码变更 (`git commit -m "feat: add awesome feature"`)
4. 推送到你的分支 (`git push origin feature/your-feature`)
5. 发起 **Pull Request**

---

## 📄 开源许可证

本项目采用 **MIT License** 开源许可证 - 详情参见 [LICENSE](LICENSE) 文件。

---

<div align="center">
  <sub>为全球科研工作者与创作者精心打造 · Made with ❤️</sub>
</div>
