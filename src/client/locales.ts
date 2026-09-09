/**
 * Copy dictionaries for the VSCode tab (zh / en). Registered with the DSH
 * locale service under the `vscodeTab` namespace; `t()` picks by active
 * locale with a browser-language fallback.
 *
 * @module dsh-sidebar-vscode/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'vscodeTab'

/** Simplified-Chinese dictionary. */
export const zh = {
  title: 'VSCode',
  guideTitle: 'VSCode 工作台',
  guideDescription: '在右侧边栏内嵌当前会话工作区的 VS Code 网页工作台；选中代码可一键注入对话',
  cardTitle: 'VSCode 侧边栏',
  cardDescription: '官方右侧边栏内嵌 VS Code 网页工作台：选中代码注入对话、文件点击接管与同源反代都在此配置',
  cardExpand: '展开配置',
  cardCollapse: '收起配置',
  cardCustomized: '已自定义',
  cardReset: '恢复默认',
  cardReadOnly: '设置以只读方式同步（远程浏览器进程本地连接）；以下展示当前生效值',
  settingServerUrl: 'VSCode 服务地址',
  settingServerUrlDesc: 'code serve-web 输出的完整地址（可含基路径与 ?tkn= 令牌）；留空 = 默认 http://127.0.0.1:8000。可达时经内置同源代理打开，否则回退直连',
  settingServerUrlPlaceholder: '留空 = http://127.0.0.1:8000；或 http://127.0.0.1:8000/vscode/?tkn=…',
  loading: '正在打开 VSCode …',
  loadHint: '长时间空白？请检查「设置 → 插件 → 插件配置 → VSCode 侧边栏」里的服务地址是否可达，或用「在新窗口打开」排查',
  bootQueue: '正在等待其他窗口的编辑器完成启动（避免同时启动互相卡死），马上就好 …',
  reload: '刷新',
  openNewWindow: '在新窗口打开',
  workspace: '工作区',
  unmapped: '当前工作区路径不是绝对路径，已打开 VS Code 默认界面',
  settingMaxLines: '引用最大行数',
  settingMaxLinesDesc: '单条引用注入的代码行数上限，超出时保留首尾、省略中间；默认 200，范围 1–2000',
  settingMaxBytes: '引用最大字节数',
  settingMaxBytesDesc: '单条引用注入的 UTF-8 字节上限（防超大单行文件），超出时同样保留首尾；默认 20000，范围 1000–200000',
  settingRangeHint: '超出可填范围，确认时将自动改为最近的边界值',
  settingOpenAsDefault: '接管对话与设置页的文件打开',
  settingOpenAsDefaultDesc: '开启后，对话中的文件点击（工具行路径、产出文件、正文引用）与设置页「打开配置文件」都改在 VSCode 标签打开；关闭后恢复官方默认行为（侧边栏自带查看器）',
  settingOpenBlocklist: '不由 VSCode 打开的文件类型',
  settingOpenBlocklistDesc: '命中后缀的文件在对话中点击时不进 VSCode，改由官方侧边栏查看器（文本预览等）打开；未设置时默认 pdf、docx、xlsx、pptx、png、jpeg、jpg；清空列表 = 全部由 VSCode 打开',
  settingOpenBlocklistPlaceholder: '输入后缀名，如 zip，回车添加',
  settingOpenBlocklistInvalid: '无效后缀：仅限字母、数字与 . - ，长度 1–16',
  settingOpenBlocklistRemove: '移除',
  openUnmapped: '文件路径不是容器内绝对路径，未能在 VS Code 中打开（绝对路径不再要求命中映射规则，未匹配时按原路径打开）',
  injectedAsText: '已注入为文本引用（输入框暂不可写入，提交效果相同）',
  injectFailed: '未能注入：当前没有可用的对话输入框',
  proxyFallback: '内置代理暂不可达该地址（或宿主半为旧版本），已回退为直连：同源选区桥不可用，粘贴兜底仍可用',
  railReferences: 'VS Code 代码引用',
  removeReference: '移除引用',
} as const

/** All copy keys (zh is the source of truth). */
export type CopyKey = keyof typeof zh

/** English dictionary. */
export const en: Record<CopyKey, string> = {
  title: 'VSCode',
  guideTitle: 'VSCode workbench',
  guideDescription: 'Embed the session workspace as a VS Code web workbench in the right sidebar; selections inject into the chat',
  cardTitle: 'VSCode Sidebar',
  cardDescription: 'The VS Code web workbench inside the official right sidebar: selection injection, file-open takeovers, and the same-origin proxy are configured here',
  cardExpand: 'Expand settings',
  cardCollapse: 'Collapse settings',
  cardCustomized: 'Customized',
  cardReset: 'Reset to defaults',
  cardReadOnly: 'Settings sync read-only (process-local remote browser connection); effective values shown below',
  settingServerUrl: 'VSCode server URL',
  settingServerUrlDesc: 'The full address `code serve-web` prints (base path and ?tkn= token included); empty = the default http://127.0.0.1:8000. Served through the built-in same-origin proxy when reachable, else a direct connection',
  settingServerUrlPlaceholder: 'empty = http://127.0.0.1:8000; or http://127.0.0.1:8000/vscode/?tkn=…',
  loading: 'Opening VS Code …',
  loadHint: 'Blank for long? Check the server URL under Settings → Plugins → Plugin Config → VSCode Sidebar, or open in a new window to diagnose',
  bootQueue: 'Waiting for the editor in another window to finish booting (simultaneous boots deadlock each other) — one moment …',
  reload: 'Reload',
  openNewWindow: 'Open in new window',
  workspace: 'Workspace',
  unmapped: 'The workspace path is not absolute; the VS Code default view was opened',
  settingMaxLines: 'Reference line cap',
  settingMaxLinesDesc: 'Line cap per injected reference; overflow keeps the head and tail. Default 200, range 1–2000',
  settingMaxBytes: 'Reference byte cap',
  settingMaxBytesDesc: 'UTF-8 byte cap per injected reference (guards huge single-line files); overflow truncates the same way. Default 20000, range 1000–200000',
  settingRangeHint: 'Out of the allowed range; it will snap to the nearest bound when confirmed',
  settingOpenAsDefault: 'Take over chat and settings file opens',
  settingOpenAsDefaultDesc: 'Chat file clicks (tool-row paths, produced files, prose mentions) and the settings "Open configuration file" button open in the VSCode tab; off restores the official default behavior (the sidebar\'s own viewers)',
  settingOpenBlocklist: 'File types never opened in VS Code',
  settingOpenBlocklistDesc: 'Chat clicks on files whose extension matches fall through to the official sidebar viewers (the text preview and friends); unset defaults to pdf, docx, xlsx, pptx, png, jpeg, jpg; an emptied list lets VS Code open everything',
  settingOpenBlocklistPlaceholder: 'Type an extension like zip, press Enter to add',
  settingOpenBlocklistInvalid: 'Invalid extension: letters, digits, . and - only, length 1–16',
  settingOpenBlocklistRemove: 'Remove',
  openUnmapped: 'The file path is not an absolute container path; it was not opened in VS Code (absolute paths no longer need a matching mapping rule — unmatched ones open as-is)',
  injectedAsText: 'Injected as a text reference (composer briefly unwritable; submitting works the same)',
  injectFailed: 'Could not inject: no composer is available',
  proxyFallback: 'The built-in proxy cannot reach that address (or the host half is older); falling back to a direct connection: the same-origin selection bridge is off, the paste fallback still works',
  railReferences: 'VS Code code references',
  removeReference: 'Remove reference',
}
