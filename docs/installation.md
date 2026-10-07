# 安装、源码使用与卸载

[返回 README](../README.md)

先查看[版本与宿主兼容](compatibility.md)。以下命令中的 `web` 是宿主配置名；应与你实际启动 DSH 使用的配置一致。

## 安装

下面以 `web` profile（宿主配置）为例，将插件安装到该配置中：

```sh
dsh plugin --profile web add @ryuu-64/dsh-session-tools@0.6.0
```

DSH `0.1.5-rc.2` 的 CLI 不接受 `desktop` profile：该配置由 Electron 应用管理。本页只演示 CLI 支持的 `web` 安装，不把同一命令替换为 `desktop` 使用；桌面端请按所装 DSH 版本提供的插件入口操作。

## 从源码安装

需要 Git，以及符合版本要求的 Node.js。`main` 含尚未发布的改动；例如 DSH `0.2.0-rc.2` 适配。以下 Windows 示例中的路径必须替换成实际克隆目录的绝对路径；macOS / Linux 可使用 `"link:/absolute/path/to/dsh-session-tools"`。

```sh
git clone https://github.com/Ryuu-64/dsh-session-tools.git
cd dsh-session-tools
npm ci --ignore-scripts --no-audit --no-fund
dsh plugin --profile web add "link:C:\path\to\dsh-session-tools"
```

装完后重启对应的 DSH 宿主。插件本身没有额外配置项，但宿主仍须满足[兼容文档中的服务条件](compatibility.md)。用 `link:` 方式装的，改完源码要重启应用才生效。

## 卸载

在安装时使用的同一个 profile 中移除插件，然后重启对应宿主：

```sh
dsh plugin --profile web remove @ryuu-64/dsh-session-tools
```

这是移除插件，不是删除会话的命令。已有会话由 DSH 管理；插件移除后不再提供这四个工具及创建卡片的自定义按钮。

## 常见问题

- **找不到 `dsh` 或 `pnpm`**：先完成 [DeepSeek Harness 安装](https://github.com/deepseek-ai/deepseek-harness)。`dsh plugin` 使用 pnpm 管理 profile 中的包。
- **安装了却没有工具**：确认安装与启动使用同一个 profile，并重启宿主；随后检查[必需服务](compatibility.md)。插件本身没有额外配置项。
- **版本或 peer 依赖冲突**：先核对宿主版本与安装来源，不要靠 `--force` 或 `--legacy-peer-deps` 跳过检查。
- **工作区路径报错**：先在 DSH 中创建工作区，再传入它的完整路径；插件不会创建工作区。
- **等不到结果**：等待超时不会终止任务，也不会自动重发。保留 `sessionId` 和 `messageId`，再查询同一回执，详见[等待规则](tool-reference.md)。
