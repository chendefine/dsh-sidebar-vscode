# dsh-sidebar-vscode

[English](./README.md) · [npm](https://www.npmjs.com/package/dsh-sidebar-vscode) · [GitHub](https://github.com/chendefine/dsh-sidebar-vscode)

为 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 侧边栏注册一个内嵌 **VS Code 网页版** 的标签页（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) / DSH 插件），并把编辑器选区 / 资源管理器文件变成对话输入框里的**原子引用 chip**——提交时由 host 半展开为紧随引用消息之后的模型上下文。

![npm](https://img.shields.io/npm/v/dsh-sidebar-vscode) ![license](https://img.shields.io/npm/l/dsh-sidebar-vscode) ![node](https://img.shields.io/node/v/dsh-sidebar-vscode) ![CI](https://img.shields.io/github/actions/workflow/status/chendefine/dsh-sidebar-vscode/ci.yml) ![stars](https://img.shields.io/github/stars/chendefine/dsh-sidebar-vscode)

## 界面截图

![产品使用截图](screenshot.png)

```
编辑器选区                          资源管理器
  右键 / Ctrl+Alt+C                  右键文件 / 文件夹
        │                                  │
        └──────────► 原子 chip ◄───────────┘
                  @src/main.ts L10-L12   @src/main.ts   @src
        │                                  │
        ▼ 提交时                           ▼
<text-selection path line …>    <file-selection path/> / <folder-selection path/>
  （携带捕获快照与时效标记）          （仅路径，无内容）
```

- 包名：[dsh-sidebar-vscode（npm）](https://www.npmjs.com/package/dsh-sidebar-vscode)
- 源码：[chendefine/dsh-sidebar-vscode（GitHub）](https://github.com/chendefine/dsh-sidebar-vscode)
- 版本：0.1.1
- 许可证：MIT
- 平台：web（DSH Web GUI）
- 测试：263 例全部通过（13 个规格文件）

## 功能简介

**标签页**

- 在 better-sidebar 侧边栏注册 `VSCode` 标签页（tab id `dsh-sidebar-vscode:vscode`），以同源 iframe 内嵌 `code serve-web` 工作台，并自动定位到**当前会话的工作区**（`<base>/?folder=<映射后路径>`）；标签切换不销毁 iframe，VS Code 会话状态保留；
- 工具栏显示工作区路径，提供「刷新」「在新窗口打开」；外观跟随 DSH 亮 / 暗 / 系统主题；界面文案中英双语。

**引用注入**

- **选中代码引用**：在嵌入的 VS Code 里选中代码，右键「DSH: 发送选中代码到会话」（英文界面：*DSH: Send Selection to Session*）或按 **Ctrl/Cmd+Alt+C**，选区落为对话输入框中一条**不可拆分的原子 chip**（形如 `@src/main.ts L10-L12`，退格一次删整条）；多光标选区按编辑器顺序逐条成 chip。提交时 host 半在 `agent/pre-step` 把它展开为紧跟该消息的独立 context 消息：

  ```xml
  <!-- User-captured VS Code selection (capture-time snapshot); re-read the
       file before editing. -->
  <text-selection path="src/main.ts" line="L10-L12" lang="typescript">
  const a = 1
  const b = 2
  const c = 3
  </text-selection>
  ```

- **资源管理器文件 / 文件夹引用**：资源管理器右键「DSH: 发送文件到会话」「DSH: 发送文件夹到会话」（英文界面：*DSH: Send File/Folder to Session*；支持多选与混选，按右键对象是否为文件夹二选一显示），每个选中项落为一条原子 chip：文件 `@src/main.ts`、文件夹 `@src`。资源引用**不携带任何内容**——提交时展开为只有路径属性、无正文、无提示注释的标记，tag 名本身表达文件 / 文件夹类型，模型需要时自行读取：

  ```xml
  <file-selection path="src/main.ts"/>
  <folder-selection path="src"/>
  ```

- **引用管理**：输入框上方渲染引用 tag 栏——同一引用的多条 chip 归并为一枚 tag（显示截断 / 文件夹徽标与出现次数），点 × 经一次草稿写入移除该引用的全部 chip；chip 的序列化形态是自包含的规范 mention，草稿文本即唯一存储，删光即不再注入，无残留状态；

- **降级与恢复**：直连跨域 `serverUrl` 时同源桥不可用，信封落入真实剪贴板，**粘贴进输入框仍被识别**为 chip；chip 插入被输入机拒绝（提交中等瞬态）时退化为追加纯文本 mention（host 解析路径相同，仅失去 chip 外观）；从对话气泡 / 外部编辑器**复制渲染出的引用再粘回**——即使是 sigil 被空白撑开的散架文本（`@ [ label ]( dsh-vscode: … )`）或丢失闭合括号的截断复制体——经 canonical 校验后在光标处重建为原子 chip，前后散文保持原样（fail-soft，绝不报错）；

- **默认标签**：可选开关让**全新会话**的侧边栏默认打开 VSCode 标签（替换 better-sidebar 硬编码的「文件」种子标签）；已打开过的会话保持各自布局，关闭后只影响之后的新会话。

- **对话文件点击接管**（同一开关控制，方案 II + III）：对话里点击**变更文件标签**（每轮结束的 produced-files chips）、工具行路径链接或正文文件引用时，不再打开 better-sidebar 内置的「文件」标签，而是聚焦本 VSCode 标签（面板自动展开）并在内嵌 VS Code 里直接打开该文件——无 workbench 重载。两条接管缝：**方案 II** —— 以 priority -2 注册 `conversation.chat.turnTail` slot（抢在 better-sidebar 自己的 -1 条目之前），用同源推导逻辑认领 produced-files 行，chips 渲染为视觉孪生但点击改道本标签；**方案 III** —— 包装 `workspaces.openPath`（客户端运行时其余对话侧文件打开的唯一漏斗，ui-conversation 的 apply.ts 是唯一生产调用方）。方案 III 同时修复一个 headless 容器坑：better-sidebar 在其内置「文件」标签被禁用时会放弃自己的接管，让打开落到宿主 OS 打开器上（`spawn xdg-open ENOENT`）；本包装让这些打开无论该设置如何都落到 VSCode 标签。点击后的链路：meta 携带 `openRequest` → 本插件 host 半写 `/tmp/dsh-sidebar-vscode/<slug(workspace)>/cmd.json` → 扩展（≥ 0.1.1）500ms 轮询消费 → `showTextDocument`；`cap.json` 活性标记 + 能力探测失败时降级为 URL `payload` 参数整页重载一次。开关关闭 = 完全不启用（chat 行为零变化）。

- **设置页「打开配置文件」接管**（方案 IV，同一开关）：按钮原本调用 `/api/settings.openDocument`，由宿主把 `$DSH_HOME/settings.yaml` 交给系统原生打开器——headless 容器上直接失败（`xdg-open` 缺失）。开关开启时，本插件改走自有的受信围栏路由（`POST /sidebar-vscode/api/settings.document` → `prepareDocument()`）取到文档绝对路径，再复用与对话点击完全相同的 `openRequest` 通道改道——配置文件在内嵌 VS Code 里打开（绝对路径无需命中 `pathMap` 规则，`mapPathForOpen` 对未匹配路径原样透传）。改道落地后「设置」弹框也会自动关闭：弹框开启状态是组件本地 state（没有服务暴露关闭方法），关闭走弹框自身挂在 document 上的 Escape 监听（生命周期恰好等于弹框开启期）——合成一次 Escape 键事件即可，视野留给工作台。全程 fail-soft：settings 服务缺失、host 半未重载、任何传输错误都回退到原生 `/api` 调用（弹框不关），按钮不会因本插件而坏。

## 安装方法

### 前提

- DSH 宿主（Web GUI）+ 已安装 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) ≥ 0.12（可选 peer：缺席时标签页注册静默跳过，粘贴兜底仍可用；开发基线 0.16）；
- 一个浏览器可达的 `code serve-web` 实例。默认拓扑下它与 dsh-runtime **同容器**，经网关同源子路径 `/vscode` 反代（见[部署拓扑](#部署拓扑默认值的依据)），浏览器登录态自动携带，WebSocket 终端等全功能可用；
- 配套 VS Code 扩展 `dsh.selection-reference` 已装入该 serve-web 实例（提供右键命令与快捷键；**对话文件点击打开通道需 ≥ 0.1.1**，见下）。

### 插件本体

**通道 A —— bundle 通道（标准，干净 profile 推荐）**

包内声明了 `dsh.bundle.patch`（`cordis.patch.yml`：一条 insert 行，挂载 host 半 entry）。从 npm registry 安装（预构建产物，无需构建许可）：

```sh
dsh plugin --profile web add dsh-sidebar-vscode
```

从 GitHub 仓库安装（源码——pnpm 会执行 `prepare` 构建；仓库同时带有已提交的 `lib/` 产物兜底）：

```sh
dsh plugin --profile web add github:chendefine/dsh-sidebar-vscode
```

或经 DSH 插件市场（设置 → DSH插件市场）——给仓库打上 `dsh-plugin` topic 即被自动收录。

bundle 插件加入 profile 层叠后需**重启 `dsh web`** 才加载；卸载用 `dsh plugin --profile web remove dsh-sidebar-vscode`，再重启一次。

**通道 B —— link + 手动挂载行（本部署的热通道，免重启）**

```sh
# 1. 把插件以 link: 依赖装进 web profile
#    （<repo-checkout> 为仓库检出路径，如 /opt/dsh/plugins/dsh-sidebar-vscode；
#     本部署 profile 目录为 /data/dsh-home/profiles/web）
pnpm -C <profile-dir> add link:<repo-checkout>

# 2. 在 profile 自己的 cordis.patch.yml 追加挂载行
#    - insert:
#        - id: dsh-sidebar-vscode
#          name: dsh-sidebar-vscode
```

`watchUserPatches` 热挂载 node 半，client boot graph 实时重算，`/plugins/dsh-sidebar-vscode/client.js` 立即可服务——浏览器**硬刷新**（Cmd/Ctrl+Shift+R）即可看到新标签。

> ⚠️ **两个通道互斥**：包内 bundle 行与 profile 手动行使用同一 entry id `dsh-sidebar-vscode`，同时存在会在启动时报 duplicate entry。切换通道前先删掉另一通道的行（bundle 通道 ↔ 手动行 + link 依赖）。包内 patch 中预留的双挂载守卫（`disabled: !!js …`）默认注释停用。

> 提示：**client 半**改动硬刷新即生效；**host 半**（`src/index.ts` / `src/mention.ts`）改动需 `dsh web` 重启（或经 profile 热通道重挂载该 entry）后才加载新 bundle。

### VS Code 扩展

选中 / 文件发送命令与**对话文件点击的轮询通道**由扩展 `dsh.selection-reference`（源码在 `extension/`）提供，需装入 serve-web 实例。**文件打开通道需要 ≥ 0.1.1**（旧版本只有发送命令；打开点击会降级为 URL payload 重载）：

```sh
scripts/install-extension.sh                  # 打包 VSIX → 装入 serve-web → 注册清单 → 重启 → 健康检查
scripts/install-extension.sh --skip-build     # 复用已构建的 VSIX
scripts/install-extension.sh --vsix <path>    # 使用指定 VSIX
```

本机的 `code` 是 standalone CLI（无桌面安装），`code --install-extension` 不可用，脚本以「vsce 打包 → 落文件 → 注册 `extensions.json` 清单 → 按原参数重启 serve-web」四步完成安装。分步流程与排障见 [`scripts/install-extension.md`](scripts/install-extension.md)。

## 使用方法

### 打开标签页

侧边栏「+」菜单选择 **VSCode**；或开启 `openAsDefault` 设置，让全新会话默认打开它（收起状态保持收起，下次展开即见）。工具栏显示当前工作区路径，「⧉ 在新窗口打开」可弹出独立窗口。

### 发送选区

1. 在嵌入的编辑器里选中代码（多光标 = 多条 chip）；
2. 右键菜单「DSH: 发送选中代码到会话」，或按 **Ctrl/Cmd+Alt+C**；
3. 输入框出现原子 chip `@src/main.ts L10-L12`——注入成功静默无提示，chip 出现即反馈；仅降级 / 失败时工具栏闪琥珀色提示；
4. 照常输入并提交。chip 被改写为可读 `@path L10-L12`，`<text-selection>` context 紧跟该消息注入。

选区引用行为细则：

- **去重**：同一 step 内按 `(路径, 起始行, 结束行)` 去重——重复发送同一选区只注入一条 context；同范围不同内容（文件已改）**保留最新捕获**；
- **时效**：提交时在会话 cwd 约束下重读磁盘行区间比对哈希——不一致标 `stale="true"`；截断快照改为校验保留的首尾两半（截断本身绝不导致 stale）；未保存缓冲区标 `dirty="true"`；快照内容始终注入（不依赖文件系统），tag 首部注释提示模型修改前先重新读取；
- **截断**：超过 `maxLines`（默认 200）/ `maxBytes`（默认 20000，防单行压缩大文件）时保留首尾两半、省略中间，正文内嵌 `... (N lines omitted, L51-L150) ...` 标记，标签带 `truncated="true"`；行号保留真实范围；
- 注入的 context 消息 source 为 `{ kind: 'vscode-mention', form: 'notice', version: 1, path, startLine, endLine, language?, contentHash, bytes, truncated, dirty, stale }`。

### 发送文件 / 文件夹

资源管理器选中文件 / 文件夹（可多选混选），右键「发送文件 / 发送文件夹到会话」（命令位于「复制路径」附近）。每项一条 chip：文件 `@src/main.ts`（文件图标）、文件夹 `@src`（文件夹图标）。类型由扩展侧 `workspace.fs.stat` 判定（symlink 按目标归类）。提交时展开为 `<file-selection path/>` / `<folder-selection path/>`，source 为 `{ kind: 'vscode-resource', form: 'notice', version: 1, path, type }`。资源引用**不做新鲜度检查、不受截断上限约束**；同一 step 内按 `(路径, 类型)` 去重，同一路径的选区引用与资源引用互为独立引用。

### 管理引用

- 输入框上方 tag 栏归并显示全部 VS Code 引用（截断徽标 `…`、文件夹图标、出现次数 ×N）；点 tag 的 **×** 一次移除该引用的全部 chip；
- chip 本身退格一次删整条；草稿里该引用的 mention 全部消失后，提交即不再注入；
- 复制 chip（在对话里渲染后）再粘回输入框，会重建为原子 chip。

### 设置

设置页「侧边卡片 → VSCode → 功能设置」（标签卡片齿轮弹窗），五行均由本插件自有面板渲染，持久化在 better-sidebar `pluginSettings['dsh-sidebar-vscode:vscode']`，**不在 cordis.patch.yml**：

| 键 | 默认 | 说明 |
|---|---|---|
| `openAsDefault` | `false` | 全新会话的侧边栏默认打开 VSCode 标签（替换「文件」种子标签）；已打开过的会话保持各自布局。该开关同时控制对话文件点击接管与设置页「打开配置文件」接管 |
| `serverUrl` | `/vscode` | VS Code 服务器基地址：同源网关子路径，或完整地址（如 `http://127.0.0.1:8000/vscode`，绕过网关本机直连，需保留 `/vscode` 基路径） |
| `pathMap` | `/data/workspace=/data/workspace;/opt=/opt` | DSH 路径前缀 → VSCode 容器路径前缀，`源=目标` 对用 `;` 分隔；最长源前缀优先；某前缀已是映射目标时原样透传。规则只做前缀改写、**不是白名单**：对话里点击文件时，未命中任何规则的绝对路径按原路径直接打开（文件真不存在时由 VS Code 报错兜底）；仅会话 cwd 映射不到时打开默认界面并提示 |
| `maxLines` | `200`（范围 1–2000） | 单次引用注入的代码行数上限，超出保留首尾两半、省略中间并标注省略区间 |
| `maxBytes` | `20000`（范围 1000–200000） | 单次引用注入的 UTF-8 字节上限（防压缩成一行的超大文件） |

（选中代码注入功能常开，无开关。）数值行在输入时即校验范围（越界红框 + 行内提示，确认时吸附到最近边界）；文本行为上下布局（说明在上、输入框独占一行）。

### 排障

| 症状 | 处理 |
|---|---|
| 标签页长时间空白 / 加载提示不消失 | 检查「功能设置」里的 `serverUrl` 是否可达；用「在新窗口打开」直连排查；跨域地址下同源桥不可用属预期（粘贴兜底仍可用） |
| 工具栏提示「当前工作区路径无法映射…」 | 会话 cwd 不在 `pathMap` 圈定范围内（如 `/tmp`）；按需在设置里补映射规则 |
| 右键没有 DSH 命令 / 命令面板搜不到 | 扩展未装或 serve-web 未重启（清单仅启动时扫描），或工作区处于受限模式未信任——见 `scripts/install-extension.md` 常见问题表 |
| 发送后 chip 未出现，剪贴板出现代码片段 | 注入降级为可读回退文本（无可用输入框 / 跨域）；直接粘贴进输入框即可恢复为 chip |
| 提示「已注入为文本引用…」 | 输入框处于提交中等瞬态，chip 化被拒，已退化为纯文本 mention——提交效果相同 |

## 技术架构

### 双端结构

DSH 插件分 host（node）半与 browser 半，本插件各自职责：

```
┌─ host 半 (node) ──────────────────────────────────────────────┐
│ src/index.ts    agent/created → 在每个 agent 作用域挂 pre-step │
│ src/mention.ts  引用边界核心：解析改写 / 去重 / 新鲜度 / 注入    │
└───────────────────────────────────────────────────────────────┘
┌─ browser 半 (web) ────────────────────────────────────────────┐
│ src/client/index.tsx        注册 tab + dock + @ 触发源 + 词典   │
│ src/client/VscodeView.tsx   cwd → 路径映射 → iframe + 桥        │
│ src/client/references.ts    载荷→chip、插入、tag 栏、粘贴恢复    │
│ src/client/composer.tsx     dock 组件：引用 tag 栏 + 粘贴兜底    │
│ …（完整清单见下文目录结构）                                       │
└───────────────────────────────────────────────────────────────┘
```

- **host 半**是模型 facing 边界：对每个存活 agent 在 `agent/pre-step` 监听，解析被认领用户消息中的规范 mention（markdown 与裸 URI，两种 scheme，严格 canonical 校验），改写为可读标签（`freezeMessage` 保留消息 id），按引用身份去重后逐条注入 context（`createUserMessage`，紧跟首次引用它的消息）。文件系统只用于新鲜度标记——快照内容随 mention 携带，注入不依赖磁盘状态；
- **browser 半**负责全部 UI：标签页、chip、tag 栏、设置面板、词典；better-sidebar 缺席时标签注册静默跳过。

### 四级链路

选区与资源引用共用一条链路：

1. **VS Code 扩展**（`extension/`）：选区命令打包 `{ path, relative?, language?, dirty?, spans[] }`；资源命令对每个 URI `workspace.fs.stat` 判型打包 `{ kind: 'resource', resources: [{ path, relative?, type }] }`（无内容），经 `vscode.env.clipboard.writeText` 写入信封 `@@DSH_REF::<base64url(json)>::\n<可读回退文本>`；
2. **剪贴板信号桥**（`src/client/clipboardBridge.ts`）：同源 iframe 特权——父页面在 workbench `window.navigator.clipboard.writeText` 上打补丁，拦截扩展宿主的剪贴板写入链（ext host → MainThreadClipboard → BrowserClipboardService → 晚绑定的 `navigator.clipboard.writeText`）；注入成功时完全不触碰真实剪贴板，仅失败时才把可读回退写入供手动粘贴；跨域 URL 下桥直接 no-op；
3. **composer chip**（`src/client/references.ts` + `composer.tsx`）：载荷经 `pathMap` 反向映射回 DSH 路径（cwd 之下相对化）、截断（首尾两半）、`crypto.subtle` 计算 sha-256 前缀，编成规范 mention，经 `conversation.input` 服务的 `insertReference`（草稿末尾零宽 span CAS）落为原子 occurrence chip；本插件注册名为 `vscode-reference` 的 `@` 触发源（候选恒空，仅为提交序列化路由 codec）；`conversation.input.dock` 组件渲染引用 tag 栏并在 document 捕获相拦截粘贴（信封走注入 lander；mention 复制体经解析后落 chip——`preventDefault` 之外还要 `stopPropagation`，仅 preventDefault 拦不住 composer 的 React onPaste）；
4. **host 边界**（`src/mention.ts`）：严格解析之外再追加一层 fail-soft 恢复扫描兜住散架复制体；闭合标签碰撞用内容哈希盐化防伪造。

### mention 编解码

- 规范形态：`@[<转义标签>](dsh-vscode:<base64url(json)>)`（选区）/ `dsh-vscode-res:`（资源）；载荷自包含（路径 / 行号 / 快照 / 哈希 / 标志），草稿文本即唯一存储；两个 scheme 前缀互斥，互不误配；
- 解码必须重新编码为完全相同的 URI（canonical 纪律，与 `dsh-session:` 引用一致）：显式 markdown mention 遇到畸形 URI 严格报错；裸文本仅在 base64url 形态跟随 scheme 时才算引用，且仍须通过 canonical 校验；
- 恢复层（`scanRecoveredMentions`）识别 sigil 被空白撑开的复制体与丢失闭合括号的截断复制体；投影只从完整通过校验的载荷重建——复制文本里的 label 一律不信任（展示残留），全部由载荷重新推导；
- 共享纯逻辑模块 `src/mentionCodec.ts` 无 Node 内建、无 `@deepseek-ai/*` 值导入，host 与 browser 两个 bundle 原样复用（client 纯度门通过）。

### 截断与新鲜度

- 捕获时（`truncateSnapshot`）：LF 归一化 → 行数上限（保留首尾两半整行）→ 字节上限（首段从尾部缩、尾段从头部缩，多字节安全）；载荷记录 `headLen` / `omitLines` / `omitBytes`，host 渲染内嵌省略标记，标记本身不计入计数；
- 提交时（`freshnessOf`）：在会话 cwd 约束下重读磁盘行区间（路径越界 / 文件超 8 MiB / 读取失败一律 `unknown`），哈希比对得 `fresh` / `stale`；截断快照校验磁盘区间以保留首段开头、以保留尾段结尾且中间至少一字符（被省略中间的改动不可检测，截断本身不致 stale）。

### 默认标签实现

better-sidebar 对新会话的种子标签是硬编码的（上游 `makeDefaultState('editor-home')`——一个无路径的「文件」editor 标签），没有「默认开哪个 tab」的偏好项。本插件按上游服务建议的伴生方式实现（`src/client/defaultTab.ts`，不改上游）：监听 sidebar store，开关开启且当前会话仍是**未被触碰的种子状态**（单 pane、至多一个无路径「文件」标签、无终端计数、无展开目录、无底部标签、无浮窗）时 `openTab({ type })` 落入 VSCode 标签、`closeTab` 移除种子——替换而非叠加；类型型 open 不强制展开面板。每会话只执行一次（`localStorage` 标记——否则用户关掉标签后会被下一次 store 通知重新打开，永远关不掉）；tab 类型被禁用或 open 未真正落地时绝不移除种子。

### 部署拓扑（默认值的依据）

VS Code server（`code serve-web`）**直接跑在 dsh-runtime 容器里**：

```
code serve-web --host 0.0.0.0 --port 8000 --server-base-path /vscode \
  --server-data-dir /data/workspace/.vscode --without-connection-token \
  --default-folder /data/workspace

nginx: location /vscode/ → 127.0.0.1:8000（含 WebSocket upgrade）
      网关只做用户 → 实例透传，/vscode 无特例，增删用户零同步
```

DSH 会话与嵌入 workbench 看到**同一文件系统、同一路径**，因此默认映射是两条恒等规则 `/data/workspace=/data/workspace;/opt=/opt`——纯透传的路标。规则是前缀改写器而非白名单：对话侧**文件打开**未命中规则时按原路径透传（同容器下任何可读文件都能开，存在性由 VS Code 判定）；仅会话 **cwd** 映射不到时提示并打开默认界面（如 `/tmp` 会话——按需补规则）。若把 workbench 挪去别的容器 / 挂载，用 `pathMap` 改成真实的前缀改写即可。

### 目录结构

```
src/index.ts                  # host 半入口：agent/created → pre-step 边界挂载（inject: agents）
src/mention.ts                # host 半核心：解析改写/去重/新鲜度/<text-selection> 等注入（36 测试）
src/mentionCodec.ts           # 共享纯逻辑：两种 scheme 规范 URI 编解码/截断/哈希归一（42 测试）
src/client/index.tsx          # browser 半入口：注册 tab + dock + @ 触发源 + 词典（ctx.effect，HMR 安全）
src/client/VscodeView.tsx     # 标签组件：cwd → 路径映射 → iframe + 工具栏/提示 + 桥装载
src/client/clipboardBridge.ts # 同源 iframe navigator.clipboard.writeText 信号补丁（8 测试）
src/client/composer.tsx       # dock 组件：引用 tag 栏（自注入样式）+ 粘贴兜底
src/client/references.ts      # 载荷→chip（选区/资源）/插入/tag 栏投影/粘贴恢复（39 测试）
src/client/selection.ts       # 剪贴板信封编解码（选区 + 资源两种 payload）（14 测试）
src/client/paths.ts           # pathMap 解析/映射/反向映射、URL 构建（20 测试）
src/client/settings.ts        # pluginSettings 读取 + 截断上限契约（默认/边界/提交助手）（14 测试）
src/client/settingsRows.tsx   # 功能设置面板：开关行 + 文本行（上下布局）+ 数值行（自注入样式）
src/client/settingsTakeover.ts # 设置页「打开配置文件」接管：同一开关下包装 settings.openDocument 并关闭设置弹框（7 测试）
src/client/defaultTab.ts      # 「默认打开 VSCode」：pristine 种子检测 + 换种护栏 + 监听（22 测试）
src/client/i18n.ts            # locale 服务挂接 + t()
src/client/locales.ts         # zh/en 词典
src/client/icons.tsx          # VS Code 标志 + 引用 chip 文件/文件夹/关闭图标（currentColor SVG）
extension/                    # VS Code 扩展 dsh.selection-reference（命令 + 右键 + 快捷键 + nls 双语 + 文件打开轮询通道）
 ├ extension.js / harness.js / package.json / package.nls*.json / .vscodeignore / vsix/*.vsix
scripts/install-extension.sh  # 扩展一键安装（vsce 打包 → 落文件 → 注册清单 → 重启 → 健康检查）
scripts/install-extension.md  # 安装分步文档 + 排障表
README.md / README.zh-CN.md   # 英文文档 / 本文档（中文）
screenshot.png                # 产品使用截图（见上方「界面截图」）
tests/*.spec.ts               # vitest 单测，共 263 例 / 13 文件（如上括注分文件计数）
cordis.patch.yml              # bundle 通道的 host 半 insert 行（挂载声明）
dsh.plugin.json               # 插件清单（元数据）
tsdown.config.ts              # 双 bundle 构建（host ESM + client ModuleLoader 注册格式 + 纯度门）
vitest.config.ts              # 测试期 dsh-llm alias（优先 harness 检出，回退已安装包）
lib/                          # 构建产物（随仓库提交：link: 部署直接服务 lib/client.js）
.github/workflows/ci.yml      # CI：Node 22 与 24 上的 typecheck / test / build / 包内容校验
```

构建产物交付：host 半为普通 ESM bundle（`@deepseek-ai/dsh-llm` 保持外部导入，由 DSH host loader 解析）；browser 半为 `window.__ModuleLoader__.load({ id, factory })` 注册格式（官方外部 client 插件交付格式），React / cordis 走 external，并带**纯度门**——拒绝 Node 内建与 `@deepseek-ai/*` 值导入。

## 开发相关

### 构建与测试

```sh
git clone https://github.com/chendefine/dsh-sidebar-vscode && cd dsh-sidebar-vscode
pnpm build        # tsc 声明 + tsdown 双 bundle → lib/
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run（263 例）
```

重建后硬刷新浏览器即可（link: 依赖 + 内容 rev 查询参数自动破缓存）；host 半改动需重启 `dsh web`。

### 环境要点

- **pnpm ≥ 11**：pnpm 专属设置只从 `pnpm-workspace.yaml` 读取（`.npmrc` 中的同名键会被**静默忽略**）。本仓库在 `pnpm-workspace.yaml` 固定 `autoInstallPeers: false`（`@deepseek-ai/*` 内部包不在公网 registry）与 `verifyDepsBeforeRun: false`（`node_modules` + lockfile 为冻结基线，跳过 run 前预检），以及 `allowBuilds.node-pty: false`（仅类型引用，不运行其原生构建）；
- **类型与运行时映射**：`@deepseek-ai/*` 构建期包（`dsh-llm`、`dsh-agent` 及 `dsh-llm` 的运行时 peer）均为从 npm registry 解析的 devDependencies，普通 clone 与 CI 开箱即用；tsconfig `paths` 与 vitest alias 在存在相邻 harness 检出（`/app/dsh`）时优先使用它（其构建产物比已发布 rc 更新），否则回退到已安装的包；
- **CI**：GitHub Actions（`.github/workflows/ci.yml`）在 Node 22 与 24 上运行 typecheck / test / build / 包内容校验——矩阵对齐 DSH 自身的支持范围（`^22.19.0 || >=24.0.0`，与发布的 `engines` 字段一致）；
- **devDependencies 基线**：`dsh-better-sidebar@^0.16` 与各 `@deepseek-ai/*` devDependencies 仅为类型、测试与开发期对齐——运行时它们都是可选 peer，由 DSH 宿主解析；
- **扩展手工测试**：`node extension/harness.js extension/extension.js`（stub 掉注入的 `vscode` 模块，跑三条命令并打印信封与解码载荷）。

### 发布

npm 包名为 `dsh-sidebar-vscode`（仓库：`chendefine/dsh-sidebar-vscode`）：

```sh
# 1. 提升 package.json 版本（extension/ 有改动时同步提升 extension/package.json）
# 2. 构建 + 测试，然后发布（prepublishOnly 会再跑一次构建）
pnpm test && pnpm publish --access public
# 3. 打 tag 并推送发布
git tag v<version> && git push origin main --tags
```

`extension/`（VS Code 扩展）虽随 npm 包一起分发，但 DSH 本身从不加载它——它经 `scripts/install-extension.sh` 装入 serve-web 实例（见[安装方法](#安装方法)）。改动它之后，提升 `extension/package.json` 的版本并重跑脚本，保持随仓库提交的 VSIX 同步。

### 已知限制

- 跨域 `serverUrl` 下同源剪贴板桥不可用（浏览器同源限制），仅剩粘贴兜底；
- 选中注入常开，无开关；
- host 半代码改动需 `dsh web` 重启后生效；
- 构建时 tsdown 对 `external` / `noExternal` 报弃用警告（构建产物正确，迁移到 `deps.*` 待后续）。

## 许可证

MIT（见 [LICENSE](LICENSE)）。
