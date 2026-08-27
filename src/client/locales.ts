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
  settingServerUrl: 'VSCode 服务地址',
  settingServerUrlDesc: 'VS Code 服务器基地址：同域网关子路径（默认 /vscode）或完整地址（如 http://127.0.0.1:8000/vscode，绕过网关本机直连，需保留 /vscode 基路径）',
  settingServerUrlPlaceholder: '/vscode',
  settingPathMap: '工作区路径映射',
  settingPathMapDesc: 'DSH 路径前缀 → VSCode 容器路径前缀，格式 源=目标，多条用 ; 分隔；留空用默认 /data/workspace=/data/workspace;/opt=/opt',
  settingPathMapPlaceholder: '/data/workspace=/data/workspace;/opt=/opt',
  loading: '正在打开 VSCode …',
  loadHint: '长时间空白？请检查「功能设置」里的服务地址是否可达，或用「在新窗口打开」排查',
  reload: '刷新',
  openNewWindow: '在新窗口打开',
  workspace: '工作区',
  unmapped: '当前工作区路径无法映射到 VSCode 容器，已打开默认界面；可在「功能设置」里配置路径映射',
  cwdFailed: '无法获取会话工作目录，已打开 VSCode 默认界面',
  settingMaxLines: '引用最大行数',
  settingMaxLinesDesc: '单次引用注入的代码行数上限，超出时保留首尾两半、省略中间并标注省略区间；未设置时默认 200，可填范围 1–2000',
  settingMaxBytes: '引用最大字节数',
  settingMaxBytesDesc: '单次引用注入的 UTF-8 字节上限（防止压缩成一行的超大文件），超出时同样保留首尾、省略中间；未设置时默认 20000，可填范围 1000–200000',
  settingRangeHint: '超出可填范围，确认时将自动改为最近的边界值',
  settingOpenAsDefault: '侧边栏默认打开 VSCode',
  settingOpenAsDefaultDesc: '新会话的侧边栏默认打开本 VSCode 标签（替换默认的「文件」标签）；同时接管对话里的文件点击（变更文件标签、工具行路径、正文文件引用）——点击后在本标签的 VS Code 中打开而不是内置文件标签；关闭后两者都恢复默认行为，且已打开过的会话保持各自布局',
  openUnmapped: '文件路径无法映射到 VSCode 容器，未能在 VS Code 中打开',
  injectedAsText: '已注入为文本引用（输入框暂不可写入，提交效果相同）',
  injectFailed: '未能注入：当前没有可用的对话输入框',
  produced: '本次产出',
  producedOpen: '在 VS Code 中打开',
  railReferences: 'VS Code 代码引用',
  removeReference: '移除引用',
} as const

/** All copy keys (zh is the source of truth). */
export type CopyKey = keyof typeof zh

/** English dictionary. */
export const en: Record<CopyKey, string> = {
  title: 'VSCode',
  settingServerUrl: 'VSCode server URL',
  settingServerUrlDesc: 'VS Code server base URL: same-origin gateway subpath (/vscode by default) or a full address (e.g. http://127.0.0.1:8000/vscode to bypass the gateway locally; keep the /vscode base path)',
  settingServerUrlPlaceholder: '/vscode',
  settingPathMap: 'Workspace path mapping',
  settingPathMapDesc: 'DSH path prefix → VSCode container prefix, as src=dst pairs joined by ";" ; empty uses the default /data/workspace=/data/workspace;/opt=/opt',
  settingPathMapPlaceholder: '/data/workspace=/data/workspace;/opt=/opt',
  loading: 'Opening VS Code …',
  loadHint: 'Blank for long? Check the server URL in the gear settings, or open in a new window to diagnose',
  reload: 'Reload',
  openNewWindow: 'Open in new window',
  workspace: 'Workspace',
  unmapped: 'The current workspace path cannot be mapped into the VS Code container; the default view was opened. Configure the path mapping in the gear settings.',
  cwdFailed: 'Could not resolve the session working directory; the VS Code default view was opened',
  settingMaxLines: 'Reference line cap',
  settingMaxLinesDesc: 'Maximum code lines kept per reference; beyond it the head and tail halves are kept, the middle is omitted and marked inline. Defaults to 200 when unset; allowed range 1–2000',
  settingMaxBytes: 'Reference byte cap',
  settingMaxBytesDesc: 'UTF-8 byte cap per reference (guards single-line minified files); overflow omits the middle the same way. Defaults to 20000 when unset; allowed range 1000–200000',
  settingRangeHint: 'Out of the allowed range; it will snap to the nearest bound when confirmed',
  settingOpenAsDefault: 'Open VSCode as the sidebar default tab',
  settingOpenAsDefaultDesc: 'Brand-new sessions open this VSCode tab instead of the seeded Files tab; the switch also takes over chat-side file clicks (produced-file chips, tool-row paths, prose mentions) so they open in this tab\'s VS Code instead of the built-in Files tab; turning it off restores both defaults, and existing conversations keep their own layouts',
  openUnmapped: 'The file path cannot be mapped into the VS Code container; it was not opened in VS Code',
  injectedAsText: 'Injected as a text reference (composer briefly unwritable; submitting works the same)',
  injectFailed: 'Could not inject: no composer is available',
  produced: 'Produced',
  producedOpen: 'Open in VS Code',
  railReferences: 'VS Code code references',
  removeReference: 'Remove reference',
}
