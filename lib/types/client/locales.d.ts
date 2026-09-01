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
    readonly settingServerUrlDesc: "code serve-web 输出的完整地址（可含基路径与 ?tkn= 令牌）；留空 = 默认 http://127.0.0.1:8000。可达时经内置同源代理打开，否则回退直连";
    readonly settingServerUrlPlaceholder: "留空 = http://127.0.0.1:8000；或 http://127.0.0.1:8000/vscode/?tkn=…";
    readonly loading: "正在打开 VSCode …";
    readonly loadHint: "长时间空白？请检查「功能设置」里的服务地址是否可达，或用「在新窗口打开」排查";
    readonly reload: "刷新";
    readonly openNewWindow: "在新窗口打开";
    readonly workspace: "工作区";
    readonly unmapped: "当前工作区路径不是绝对路径，已打开 VS Code 默认界面";
    readonly cwdFailed: "无法获取会话工作目录，已打开 VSCode 默认界面";
    readonly settingMaxLines: "引用最大行数";
    readonly settingMaxLinesDesc: "单条引用注入的代码行数上限，超出时保留首尾、省略中间；默认 200，范围 1–2000";
    readonly settingMaxBytes: "引用最大字节数";
    readonly settingMaxBytesDesc: "单条引用注入的 UTF-8 字节上限（防超大单行文件），超出时同样保留首尾；默认 20000，范围 1000–200000";
    readonly settingRangeHint: "超出可填范围，确认时将自动改为最近的边界值";
    readonly settingOpenAsDefault: "侧边栏默认打开 VSCode";
    readonly settingOpenAsDefaultDesc: "新会话默认打开本 VSCode 标签（替换「文件」标签），对话中的文件点击与设置页「打开配置文件」也改在此打开；关闭后恢复默认，已有会话布局不变";
    readonly settingOpenBlocklist: "不由 VSCode 打开的文件类型";
    readonly settingOpenBlocklistDesc: "命中后缀的文件在对话中点击时改由系统默认方式打开（不再接管进 VSCode 标签）；未设置时默认 pdf、docx、xlsx、pptx、png、jpeg、jpg；清空列表 = 全部由 VSCode 打开";
    readonly settingOpenBlocklistPlaceholder: "输入后缀名，如 zip，回车添加";
    readonly settingOpenBlocklistInvalid: "无效后缀：仅限字母、数字与 . - ，长度 1–16";
    readonly settingOpenBlocklistRemove: "移除";
    readonly openUnmapped: "文件路径不是容器内绝对路径，未能在 VS Code 中打开（绝对路径不再要求命中映射规则，未匹配时按原路径打开）";
    readonly injectedAsText: "已注入为文本引用（输入框暂不可写入，提交效果相同）";
    readonly injectFailed: "未能注入：当前没有可用的对话输入框";
    readonly proxyFallback: "内置代理暂不可达该地址（或宿主半为旧版本），已回退为直连：同源选区桥不可用，粘贴兜底仍可用";
    readonly produced: "本次产出";
    readonly producedOpen: "在 VS Code 中打开";
    readonly producedOpenSystem: "使用系统默认方式打开";
    readonly railReferences: "VS Code 代码引用";
    readonly removeReference: "移除引用";
};
/** All copy keys (zh is the source of truth). */
export type CopyKey = keyof typeof zh;
/** English dictionary. */
export declare const en: Record<CopyKey, string>;
