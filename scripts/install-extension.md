# 本地 VS Code 扩展安装指南（dsh.selection-reference）

把 `extension/` 里的 VS Code 扩展装进**本机的 VS Code 实例** —— 即运行时容器入口
（`docker-entrypoint.sh`）后台拉起的 `code serve-web` 服务器（`:8000`，base path
`/vscode`，server data dir `/data/workspace/.vscode`）。本机没有桌面版 VS Code，
`code` 只是 serve-web 发行版的 standalone CLI。

## 一键脚本

```sh
scripts/install-extension.sh                # 打包 VSIX → 安装 → 注册清单 → 重启 serve-web → 健康检查
scripts/install-extension.sh --skip-build   # 复用已构建的 VSIX（extension/vsix/dsh-selection-reference-<版本>.vsix）
scripts/install-extension.sh --vsix 路径.vsix  # 从该 VSIX 文件安装（隐含 --skip-build，绝不重新打包覆盖它）
```

环境变量可覆盖默认值：`SERVER_DATA_DIR`、`CODE_BIN`、`HOST` / `PORT` /
`BASE_PATH` / `CLI_DATA_DIR` / `DEFAULT_FOLDER`（serve-web 未在运行时的兜底启动
参数）、`NPM_CACHE`。详见脚本头部注释。

## 为什么不能直接 `code --install-extension`

本机的 `code` 是 **standalone CLI**（serve-web 发行版，`/usr/local/bin/code` →
`/usr/local/share/vscode/code-cli/code`），它没有对应的桌面编辑器安装，
`code ext install`（以及不带 `ext` 的 `--install-extension`）会直接报错：

```
No installation of Visual Studio Code stable was found.
```

给 `--extensions-dir /data/workspace/.vscode/extensions` 也没用 —— 该子命令只认
桌面安装。serve-web 的扩展目录没有 CLI 安装路径，只能手工落文件 + 注册清单 +
重启（下述四步），这也是一键脚本做的事。

## 手动分步流程

以下 4 步 + 验证，与脚本一一对应。命令按本机默认路径写出。

### 第 1 步：打包 VSIX

```sh
cd extension
mkdir -p vsix
npm_config_cache=/tmp/dsh-vsce-npm-cache npx --yes @vscode/vsce package \
  --allow-missing-repository --out vsix/dsh-selection-reference-0.1.1.vsix
```

要点：

- **`npm_config_cache` 覆盖**：`~/.npm` 里可能有 root 属主的缓存文件导致
  `EACCES`，指到 /tmp 可避开；
- **`.vscodeignore`**（已随仓库提交）把 `harness.js`（扩展的手工测试工具）
  与 `vsix/`（已打包的 VSIX 存放目录）排除在包外，VSIX 只含
  `extension.js` + `package.json` + 两个 `package.nls*.json`；
- **`--allow-missing-repository`**：`extension/package.json` 已声明
  `repository`（指向 `chendefine/dsh-sidebar-vscode` 的 `extension/` 子目录），
  vsce 会把它写进 VSIX 元数据；该旗标保留为兜底——`extension/` 本身不是 git
  仓库根，若日后删去 repository 字段仍可打包；

### 第 2 步：落文件到扩展目录

serve-web 的扩展根目录 = `--server-data-dir` 下的 `extensions/`：

```sh
EXTROOT=/data/workspace/.vscode/extensions
DEST=$EXTROOT/dsh.selection-reference-0.1.1        # 命名规则: <publisher.name>-<版本>
unzip -q -o vsix/dsh-selection-reference-0.1.1.vsix 'extension/*' -d /tmp/vsixx
rm -rf "$DEST" && mkdir -p "$DEST" && cp -a /tmp/vsixx/extension/. "$DEST/"
# 清掉同扩展的旧版本目录，避免 manifest 与目录不一致
find "$EXTROOT" -maxdepth 1 -type d -name 'dsh.selection-reference-*' \
  ! -name 'dsh.selection-reference-0.1.1' -exec rm -rf {} +
```

universal 扩展的目录名**不带**平台后缀（对比平台相关的
`ms-python.python-2026.4.0-linux-x64`）。

### 第 3 步：注册 extensions.json

`$EXTROOT/extensions.json` 是 serve-web 的已装扩展清单（纯 JSON 数组，一行）。
手工安装不会被自动扫描，必须自己登记条目。先备份，再登记：

```sh
cp -a "$EXTROOT/extensions.json" "$EXTROOT/extensions.json.bak-dsh"
node - <<'NODE'
const fs = require('fs')
const root = '/data/workspace/.vscode/extensions', folder = 'dsh.selection-reference-0.1.1'
const pkg = JSON.parse(fs.readFileSync(`${root}/${folder}/package.json`, 'utf8'))
const id = `${pkg.publisher}.${pkg.name}`                    // dsh.selection-reference
const listPath = `${root}/extensions.json`
const entry = {
  identifier: { id },
  version: pkg.version,
  location: { $mid: 1, path: `${root}/${folder}`, scheme: 'file' },
  relativeLocation: folder,
  metadata: {
    installedTimestamp: Date.now(), pinned: false, source: 'gallery',
    publisherDisplayName: pkg.publisher,
    targetPlatform: 'undefined',        // 字符串 "undefined" = universal，本实例的既定格式
    updated: false, private: true, isPreReleaseVersion: false,
    hasPreReleaseVersion: false, preRelease: false,
  },
}
const next = JSON.parse(fs.readFileSync(listPath, 'utf8')).filter(c => c.identifier?.id !== id)
next.push(entry)
fs.writeFileSync(listPath, JSON.stringify(next) + '\n')
NODE
```

**格式注意**：条目照抄本实例 gallery 安装的既定写法 —— 目录名不带平台后缀、
`location` 只有 `path` + `scheme`、`targetPlatform` 是字符串 `"undefined"`
（universal 扩展如此，非平台的 `linux-x64`）。字段写错会出现清单与目录对不上的
条目，扩展不被加载。

### 第 4 步：重启 serve-web

扩展清单只在启动时扫描。serve-web 是入口脚本的后台子进程，**崩溃/被杀都不会被
自动拉起**（只有容器重启才会），所以要按原参数重启它：

```sh
# 1) 找到 router 进程（code serve-web CLI 本体），保存完整 argv
pid=$(pgrep -f 'code serve-web' | head -1)
tr '\0' '\n' < /proc/$pid/cmdline          # 第 1 行是二进制，其余是参数

# 2) TERM router。注意：内部 server（node server-main.js）可能不随 router 退出
kill -TERM $pid
#    孤儿清理：凡 cmdline 里还带着本 --server-data-dir 的 server-main.js 进程，
#    逐个 TERM（会连带其 exthost 树；sh 包装进程随子进程退出）

# 3) 用完全相同的 argv 原地重启（setsid 脱离当前 shell，nohup 防 HUP）
setsid nohup env HOME=/data/workspace /usr/local/bin/code serve-web \
  --host 0.0.0.0 --port 8000 --accept-server-license-terms \
  --without-connection-token --server-base-path /vscode \
  --cli-data-dir /usr/local/share/vscode \
  --server-data-dir /data/workspace/.vscode --default-folder /data/workspace \
  >/tmp/serve-web-restart.log 2>&1 </dev/null &

# 4) 健康检查
curl -sf http://127.0.0.1:8000/vscode/ >/dev/null && echo OK
```

### 第 5 步：验证

浏览器打开 `http://<host>:8000/vscode`（或 DSH 侧边栏的 VSCode 标签页刷新）：

1. **扩展视图**（Ctrl+Shift+X）搜 `@installed dsh` → 应出现
   *DSH Selection Reference 0.1.1，发布者 dsh，源 VSIX*；
2. 扩展详情页「功能」标签 → 三条命令
   （`dsh.selectionReference.send` / `.sendFile` / `.sendFolder`）、快捷键
   Ctrl+Alt+C、`editor/context` + `explorer/context` 菜单均已注册；
3. 命令面板（F1）输入 `DSH` → 三条 *DSH: Send … to Session* 命令可见可执行。

## 常见问题

| 症状 | 原因 / 处理 |
|---|---|
| `No installation of Visual Studio Code stable was found` | standalone CLI 没有桌面安装，`code ext install` 不可用 —— 走本流程 |
| `npm error code EACCES ... ~/.npm` | root 属主缓存，`npm_config_cache=/tmp/...` 覆盖 |
| 扩展视图里有、但详情页写「当前工作区不受信任，因此已禁用此扩展」 | workbench 处于**受限模式**。标题栏横幅「管理」→ 信任 `/data/workspace` 文件夹；信任状态持久，只需一次 |
| 装完命令面板里没有 DSH 命令 | 多半是没重启 serve-web（清单只在启动扫描）或受限模式未信任；其次检查 extensions.json 条目的 `location.path` 与目录名一致 |
| 重启后 `:8000` 拒绝连接 | router 起了但内部 server 没跟上：看 `/tmp/serve-web-restart*.log`；确认旧进程（含 `server-main.js` 孤儿）已清干净再重启 |
| 想换版本 | 改 `extension/package.json` 的 `version` 后重跑脚本；旧版本目录与清单条目会被自动清掉 |
