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
  settingServerUrlDesc: 'code serve-web 输出的完整地址（可含基路径与 ?tkn= 令牌）；留空 = 默认 http://127.0.0.1:8000（本机裸启动）。只要内置代理在服务，一律挂载为同源 /sidebar/vscode/ 打开，功能完整；宿主暂不可达时回退直连并自动等待代理就绪后切回（同源桥降级期间粘贴兜底仍可用）。网关子路径（如 /vscode）仍可显式填写：代理未就绪时按网关语义使用',
  settingServerUrlPlaceholder: '留空 = http://127.0.0.1:8000；或 http://127.0.0.1:8000/vscode/?tkn=…',
  loading: '正在打开 VSCode …',
  loadHint: '长时间空白？请检查「功能设置」里的服务地址是否可达，或用「在新窗口打开」排查',
  reload: '刷新',
  openNewWindow: '在新窗口打开',
  workspace: '工作区',
  unmapped: '当前工作区路径未命中任何映射规则，已按原路径打开；若工作台看不到该目录，可在设置文档里配置 pathMap 路径映射',
  cwdFailed: '无法获取会话工作目录，已打开 VSCode 默认界面',
  settingMaxLines: '引用最大行数',
  settingMaxLinesDesc: '单次引用注入的代码行数上限，超出时保留首尾两半、省略中间并标注省略区间；未设置时默认 200，可填范围 1–2000',
  settingMaxBytes: '引用最大字节数',
  settingMaxBytesDesc: '单次引用注入的 UTF-8 字节上限（防止压缩成一行的超大文件），超出时同样保留首尾、省略中间；未设置时默认 20000，可填范围 1000–200000',
  settingRangeHint: '超出可填范围，确认时将自动改为最近的边界值',
  settingOpenAsDefault: '侧边栏默认打开 VSCode',
  settingOpenAsDefaultDesc: '新会话的侧边栏默认打开本 VSCode 标签（替换默认的「文件」标签）；同时接管对话里的文件点击（变更文件标签、工具行路径、正文文件引用）和设置页的「打开配置文件」按钮——点击后在本标签的 VS Code 中打开，而不是内置文件标签或系统打开器；关闭后全部恢复默认行为，且已打开过的会话保持各自布局',
  openUnmapped: '文件路径不是容器内绝对路径，未能在 VS Code 中打开（绝对路径不再要求命中映射规则，未匹配时按原路径打开）',
  injectedAsText: '已注入为文本引用（输入框暂不可写入，提交效果相同）',
  injectFailed: '未能注入：当前没有可用的对话输入框',
  proxyFallback: '内置代理暂不可达该地址（或宿主半为旧版本），已回退为直连：同源选区桥不可用，粘贴兜底仍可用',
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
  settingServerUrlDesc: 'The full address `code serve-web` prints (base path and ?tkn= token included); empty = the default http://127.0.0.1:8000 (a bare local server). Whenever the built-in proxy is reachable the workbench opens at the same-origin /sidebar/vscode/ with every feature intact; if the DSH host cannot reach the address (e.g. serve-web still warming up), the tab falls back to a direct connection and switches to the mount automatically once the proxy starts serving (same-origin bridge degrades meanwhile). A gateway subpath (e.g. /vscode) can still be typed explicitly: used with gateway semantics when the proxy is off',
  settingServerUrlPlaceholder: 'empty = http://127.0.0.1:8000; or http://127.0.0.1:8000/vscode/?tkn=…',
  loading: 'Opening VS Code …',
  loadHint: 'Blank for long? Check the server URL in the gear settings, or open in a new window to diagnose',
  reload: 'Reload',
  openNewWindow: 'Open in new window',
  workspace: 'Workspace',
  unmapped: 'The current workspace path matched no mapping rule and was opened at its raw path; if the workbench cannot see that directory, configure path mapping (pathMap) in the settings document.',
  cwdFailed: 'Could not resolve the session working directory; the VS Code default view was opened',
  settingMaxLines: 'Reference line cap',
  settingMaxLinesDesc: 'Maximum code lines kept per reference; beyond it the head and tail halves are kept, the middle is omitted and marked inline. Defaults to 200 when unset; allowed range 1–2000',
  settingMaxBytes: 'Reference byte cap',
  settingMaxBytesDesc: 'UTF-8 byte cap per reference (guards single-line minified files); overflow omits the middle the same way. Defaults to 20000 when unset; allowed range 1000–200000',
  settingRangeHint: 'Out of the allowed range; it will snap to the nearest bound when confirmed',
  settingOpenAsDefault: 'Open VSCode as the sidebar default tab',
  settingOpenAsDefaultDesc: 'Brand-new sessions open this VSCode tab instead of the seeded Files tab; the switch also takes over chat-side file clicks (produced-file chips, tool-row paths, prose mentions) and the settings page\'s "Open configuration file" button, so they open in this tab\'s VS Code instead of the built-in Files tab or the Host OS opener; turning it off restores all defaults, and existing conversations keep their own layouts',
  openUnmapped: 'The file path is not an absolute container path; it was not opened in VS Code (absolute paths no longer need a matching mapping rule — unmatched ones open as-is)',
  injectedAsText: 'Injected as a text reference (composer briefly unwritable; submitting works the same)',
  injectFailed: 'Could not inject: no composer is available',
  proxyFallback: 'The built-in proxy cannot reach that address (or the host half is older); falling back to a direct connection: the same-origin selection bridge is off, the paste fallback still works',
  produced: 'Produced',
  producedOpen: 'Open in VS Code',
  railReferences: 'VS Code code references',
  removeReference: 'Remove reference',
}
