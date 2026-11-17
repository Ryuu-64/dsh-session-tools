# 安装、更新与卸载

[返回 README](../README.md)

以下命令使用 `web` profile（宿主配置）。安装和启动 DSH 须使用同一个 profile。先确认 `dsh` 和 `pnpm` 都能运行。 [版本与宿主兼容](compatibility.md)

## 从 npm 安装

npm 已发布的 `0.8.0` 支持 DSH `0.2.0-rc.2`。使用 Node.js `22.19+`（22 系列）或 `24.x`。

```sh
dsh plugin --profile web add @ryuu-64/dsh-session-tools@0.8.0
```

安装后重启 DSH。在对话中派出一个新任务，批准创建后应看到「已创建会话」卡片。桌面端请通过你所用 DSH 版本提供的插件入口安装。

## 从源码安装

当前源码支持 DSH `0.2.0-rc.2` 和 `0.2.2-rc.3`，并包含 profile 通信默认值。使用 `0.2.2-rc.3` 时，先准备 Node.js `24.9.0` 或更新的 24 系列版本。你还需要 Git、npm 和 pnpm。仓库已包含可打包的插件文件。

在 Windows PowerShell 中运行：

```powershell
git clone https://github.com/Ryuu-64/dsh-session-tools.git
Set-Location dsh-session-tools
npm pack --ignore-scripts --pack-destination $env:TEMP
dsh plugin --profile web add "$env:TEMP/ryuu-64-dsh-session-tools-0.8.0.tgz" --ignore-scripts
```

若 `npm pack` 输出了不同文件名，按实际文件名安装。在 macOS 或 Linux 上，使用 `cd` 进入仓库，并将上面两个命令里的临时目录写作 `"${TMPDIR:-/tmp}"`。

安装后重启 DSH。打开左侧「插件」→「会话工具」→ 组件行的「配置」，确认能看到两个通信默认开关。

## 更新

通过 npm 包名安装的兼容发行版，可以在支持原生更新的 DSH（如 `0.2.2-rc.3`）中打开「插件」→「会话工具」→「版本」。DSH 会列出当前宿主可安装的版本。插件列表的「刷新」会检查当前 profile 下的注册表插件。 [DSH 插件管理器文档](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/client/ui-plugin-manager/README.zh.md)

从源码打包安装时，请重新从源码打包并安装新文件。旧版插件若已打开会话通信存储，升级后重启一次即可释放它持有的存储。

## 卸载

在安装时使用的 profile 中移除插件，然后重启 DSH。

```sh
dsh plugin --profile web remove @ryuu-64/dsh-session-tools
```

已有会话仍由 DSH 管理。卸载会移除插件的五个工具、通信设置入口和创建卡片的自定义按钮。

## 常见问题

- **找不到 `dsh` 或 `pnpm`**：先完成 [DeepSeek Harness 安装](https://github.com/deepseek-ai/deepseek-harness)。
- **装好后找不到工具**：确认安装与启动使用同一个 profile，并重启 DSH。自定义 profile 请核对[宿主服务要求](compatibility.md)。
- **版本或依赖冲突**：确认 DSH 版本和插件的实际来源。使用本页中对应的安装方式。
- **工作区路径报错**：先在 DSH 创建工作区，再传入完整路径。
- **等不到结果**：用原 `sessionId` 和 `messageId` 继续查询同一次任务。 [等待规则](tool-reference.md#等待结果与取消)
