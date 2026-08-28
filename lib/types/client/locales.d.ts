/**
 * Copy dictionaries for the VSCode tab (zh / en). Registered with the DSH
 * locale service under the `vscodeTab` namespace; `t()` picks by active
 * locale with a browser-language fallback.
 *
 * @module dsh-sidebar-vscode/client/locales
 */
/** Dictionary namespace owned by this plugin. */
export declare const NS = "vscodeTab";
/** Simplified-Chinese dictionary. */
export declare const zh: {
    readonly title: "VSCode";
    readonly settingServerUrl: "VSCode 服务地址";
    readonly settingServerUrlDesc: "VS Code 服务器基地址：同域网关子路径（默认 /vscode）或完整地址（如 http://127.0.0.1:8000/vscode，绕过网关本机直连，需保留 /vscode 基路径）";
    readonly settingServerUrlPlaceholder: "/vscode";
    readonly settingPathMap: "工作区路径映射";
    readonly settingPathMapDesc: "DSH 路径前缀 → VSCode 容器路径前缀，格式 源=目标，多条用 ; 分隔；留空 = 不映射，直接使用原始目录（仅 workbench 与 DSH 不同容器/挂载时才需要配置）";
    readonly settingPathMapPlaceholder: "留空 = 直接使用原始目录；示例：/data/workspace=/mnt/vscode";
    readonly loading: "正在打开 VSCode …";
    readonly loadHint: "长时间空白？请检查「功能设置」里的服务地址是否可达，或用「在新窗口打开」排查";
    readonly reload: "刷新";
    readonly openNewWindow: "在新窗口打开";
    readonly workspace: "工作区";
    readonly unmapped: "当前工作区路径未命中任何映射规则，已按原路径打开；若工作台看不到该目录，可在「功能设置」里配置路径映射";
    readonly cwdFailed: "无法获取会话工作目录，已打开 VSCode 默认界面";
    readonly settingMaxLines: "引用最大行数";
    readonly settingMaxLinesDesc: "单次引用注入的代码行数上限，超出时保留首尾两半、省略中间并标注省略区间；未设置时默认 200，可填范围 1–2000";
    readonly settingMaxBytes: "引用最大字节数";
    readonly settingMaxBytesDesc: "单次引用注入的 UTF-8 字节上限（防止压缩成一行的超大文件），超出时同样保留首尾、省略中间；未设置时默认 20000，可填范围 1000–200000";
    readonly settingRangeHint: "超出可填范围，确认时将自动改为最近的边界值";
    readonly settingOpenAsDefault: "侧边栏默认打开 VSCode";
    readonly settingOpenAsDefaultDesc: "新会话的侧边栏默认打开本 VSCode 标签（替换默认的「文件」标签）；同时接管对话里的文件点击（变更文件标签、工具行路径、正文文件引用）和设置页的「打开配置文件」按钮——点击后在本标签的 VS Code 中打开，而不是内置文件标签或系统打开器；关闭后全部恢复默认行为，且已打开过的会话保持各自布局";
    readonly openUnmapped: "文件路径不是容器内绝对路径，未能在 VS Code 中打开（绝对路径不再要求命中映射规则，未匹配时按原路径打开）";
    readonly injectedAsText: "已注入为文本引用（输入框暂不可写入，提交效果相同）";
    readonly injectFailed: "未能注入：当前没有可用的对话输入框";
    readonly produced: "本次产出";
    readonly producedOpen: "在 VS Code 中打开";
    readonly railReferences: "VS Code 代码引用";
    readonly removeReference: "移除引用";
};
/** All copy keys (zh is the source of truth). */
export type CopyKey = keyof typeof zh;
/** English dictionary. */
export declare const en: Record<CopyKey, string>;
