# 向官方右侧 Sidebar 添加自定义功能

## 一、扩展模型：一切皆“tab 类型”

官方侧栏只暴露一个核心扩展点——**tab 类型注册表** `ctx.sidebarRightTabs`。你要写的任何功能（查看器、工具页、仪表盘……）都是一个 tab 类型，分两阶段注册（都在插件的 `ctx.effect` 里，插件卸载时自动注销）：

1. **类型声明**（无运行时钩子的静态定义）：`ctx.sidebarRightTabs.register({ id, kind, patterns?, priority?, canOpen?, title, guide? })`
2. **正文组件**：`ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: <你的id> }, Body))`

按内容来源分两种写法：

| | 资源查看器类型 | 页面类型 |
|---|---|---|
| 打开方式 | 按地址认领：点文件链接/文件树行时由注册表路由 | 按 kind 打开：引导页入口框 / tab 条"+"控件 |
| `patterns` | 必填（glob） | 省略 |
| 例子 | 官方 `text`（文本预览）、你可以写图片/PDF 查看器 | 官方 `files`（文件树）、你可以写终端/笔记/监控页 |

**路由规则**：地址先按 `priority` 档排序——`extension`（第三方，默认，最高）> `builtin`（官方内置）> `fallback`（兜底查看器）——再按命中模式长度、注册顺序。所以你写 `*.png` 的图片查看器会自然压过官方 `text` 这个 fallback。**第三方插件还可以接管 builtin kind**：同一 `kind` 注册 `extension` 档即可生效（如整体替换官方文件树），注销后 builtin 恢复。

## 二、最小可用示例（页面类型 + 引导页入口）

以“资源管理器之外的任意页面”为例（对照官方样板 `packages/client/ui-sidebar-files`）：

```ts
// src/client/index.ts —— 浏览器半
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'  // 只做类型声明合并，运行时零依赖
import { MyBody } from './MyBody.tsx'
import { en, zh } from './locales.ts'

export const inject = ['slots', 'locale', 'sidebarRightTabs']

const MY_ID = 'com.acme.dsh-sidebar-mytool'

export function apply(ctx: Context): void {
  const t = ctx.locale.bind('mySidebarTool')
  // 阶段一：类型声明（页面类型无 patterns）
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: MY_ID,
    kind: 'mytool',                     // openTab('mytool') 点名的对象
    priority: 'extension',
    title: () => t('type.label'),       // tab chip 文字，打开时捕获
    guide: [{                           // 引导页（"开始"页）上的入口框
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }), 'my type')

  ctx.effect(() => ctx.locale.register('mySidebarTool', { zh, en }), 'my dictionaries')

  // 阶段二：正文组件，key 必须等于类型 id
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: MY_ID, locale: 'mySidebarTool' },
    MyBody,
  )), 'my body')
}
```

```tsx
// src/client/MyBody.tsx —— 正文组件（纯 props，见不到 ctx）
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export type MyBodyProps = PropsRuntime<'sidebar.right.pane.tab'>

export function MyBody(props: MyBodyProps): ReactNode {
  // useTabInfo 由框架绑定后作为 prop 注入（官方 GuideBody 同款写法）
  const info = props.useTabInfo()
  // info.sidebar: { expanded, fullscreen }
  // info.panel.id: 所在格
  // info.tab: 记录字段 + visible + navigation{params,revision} + signal + actions
  return <div>{info.tab.title}</div>
}
```

资源查看器类型只需在定义里加 `patterns: ['*.png', '*.jpg']`、`canOpen: address => …`、`title: address => 文件名`，正文里用 `props.useResource(address)` 读活数据（见下）。

## 三、包骨架与构建纪律

参照 `packages/client/ui-sidebar-textpreview/package.json`：

```jsonc
{
  "name": "com.acme.dsh-sidebar-mytool",
  "type": "module",
  "exports": {
    ".":       { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-sidebar-right"] } },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.2" },
  "devDependencies": { /* 官方包全部放 dev（见下） */ },
  "files": ["lib/index.js", "lib/client.js", "lib/types/**/*.d.ts"]
}
```

- `src/index.ts` 是空的 Node 半（`export function apply() {}`）；所有 UI 在 `src/client/`，经 tsdown 的 client 打包配置产出单文件 `lib/client.js`。
- **跨包导入只能是 `import type`**：`ctx.sidebarRightTabs`、`ctx.slots` 是运行时服务（由 web-app bundle 提供，fiber 注入等待），官方包的类型声明走 `import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'`——编译期擦除，因此官方包放 `devDependencies` 就够，不产生运行时依赖。这条纪律有门禁强制（`verify-client-packages`）。
- 文案必须走 locale 字典（`verify-client-ui-i18n` 拒绝硬编码字符串），zh/en 两份。

## 四、挂载进 profile（两种方式，你环境里都有先例）

**方式 A——本地 link（你 `/opt/dsh/plugins` 下插件的现有做法）**：
1. 在 profile 的 `package.json`（如 `dsh-home/<user>/profiles/web/package.json`）加 `"com.acme.dsh-sidebar-mytool": "link:/opt/dsh/plugins/mytool"`，并把包名加进 `dsh.profile.bundles` 数组；
2. 插件包里放一份 `cordis.patch.yml`（`dsh.bundle.patch` 声明），内容就是一条 `- insert: - id / name` 挂载行——照抄 better-sidebar 的 `cordis.patch.yml` 第 46–49 行结构即可；
3. `pnpm install` 后**硬刷新浏览器**（Cmd/Ctrl+Shift+R），client 改动热加载，无需重启。

**方式 B——npm 发布 + 官方 CLI**：`dsh plugin --profile web add com.acme.dsh-sidebar-mytool`，bundle channel 自动对账挂载。

## 五、全部可用扩展点速查

| 席位 / 机制 | 用途 |
|---|---|
| `sidebar.right.pane.tab`（keyed） | tab 正文（必注册） |
| `sidebar.right.pane.tab.title`（keyed） | 活的 chip 标题（可选；默认用打开时捕获的 `title(address)`） |
| `sidebar.right.tab.guide`（chain） | 替换引导页内容而不替换 tab |
| `sidebar.right.tab.menu.item`（list） | 给 tab 菜单追加上下文菜单项 |
| `ctx.sidebarRight` | 导航：`openResource(addr, opts)` / `openTab(kind, opts)` / `close` / `focus` / `split` / `float` / `dock`——你的按钮、命令面板都可以调它往侧栏里开东西 |
| `ctx.resources.register({ protocol, open, reload? })` + `declare module … ResourceProtocolMap` | 注册自定义资源协议，得到 `dsh-resource://<你的协议>/…` 地址 + 共享的 `useResource` 活数据流 |
| `remote.workspaceFiles`（已内置） | 有界读文件：`stat / read（按页）/ readBytes / list / changes`——做查看器直接用，不要自己开 HTTP |
| `SidebarRightResourceParamsMap` / `SidebarRightTabParamsMap` 声明合并 | 给你的类型声明导航参数（如 `{ line?: number }`），经 `navigation.params` 到达正文 |

## 六、必须知道的约束

- **版本前提**：这套 API 在当前 0.1.5-alpha.1 构建里才有（你现在用的 GUI 已具备）。若目标部署的宿主还是 0.1.2-rc.1 线，`inject` 里的 `sidebarRightTabs` 服务不存在，插件 fiber 会永远 PENDING——先确认宿主构建里有右侧 Sidebar（看会话 header 有没有“展开侧栏”按钮）。
- **无持久化**：官方侧栏布局只在内存，刷新回折叠态；你的 tab 状态若要存活，自己经插件 store/后端存。
- **tab 图标、pane 级动作、撤销栈**目前明确“不做”，别指望。
- **模型侧入口**：`ctx.sidebarRight` 是浏览器端服务；想让 *模型* 主动开 tab，需要自己在 Node 半加工具/Remote 命名空间，再由 client 半调用（better-sidebar 的 `sidebar_open` 就是这么做的）。
- 组件永远只见 props（四份 share + 注入 hook），不见 ctx——别在 `.tsx` 里 reach 服务。

## 七、照抄样板与权威文档

- **页面类型样板**：`deepseek-harness/packages/client/ui-sidebar-files/src/client/{index.ts, definition.ts}`（本答案示例的出处）
- **查看器类型样板**：`deepseek-harness/packages/client/ui-sidebar-textpreview/src/client/`（含 useResource 读元数据 + 分页读正文 + params 行导航的完整写法）
- **契约参考**：`deepseek-harness/docs/subsystems/sidebar-right.zh.md`（含一段官方给的第三方图片查看器示例代码）、`deepseek-harness/packages/client/ui-sidebar-right/README.zh.md`（席位与 Tab 域细节）
- **新包 checklist**：`deepseek-harness/packages/client/AGENTS.md` 的 "New plugin package checklist"

建议起步路线：先 fork `ui-sidebar-files` 的结构做一个最简单的页面类型跑通挂载，再按需要换成资源查看器 + `useResource`。如果你想要，我可以直接在 `/opt/dsh/plugins` 下帮你生成一个可运行的初始插件骨架。