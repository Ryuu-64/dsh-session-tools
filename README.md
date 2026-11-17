# dsh-session-tools · DeepSeek Harness 跨会话协作

让 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 里的 AI 新建独立会话、给其他会话派任务，并把结果带回当前对话。

![DSH 对话中的已创建会话卡片和 SQLite 建议，右侧会话面板列出新建的对话](https://raw.githubusercontent.com/Ryuu-64/dsh-session-tools/main/docs/screenshots/session-create-card.png)

*DSH Web `0.2.2-rc.3` 的示例。点击「SQLite 与 PostgreSQL」就能打开新会话，右侧「会话」页签也能找到它。*

## 安装

| 安装来源 | 支持的 DSH | Node.js |
| --- | --- | --- |
| npm `0.8.0` | `0.2.0-rc.2` | `22.19+`（22 系列）或 `24.x` |
| GitHub 当前源码 | `0.2.0-rc.2`、`0.2.2-rc.3` | 使用 `0.2.2-rc.3` 时需要 `24.9.0+`（24 系列） |

先确认 DSH 已能正常对话，且命令行能运行 `pnpm`。把插件装到你启动 DSH 时用的 profile（宿主配置）。下方命令安装 npm `0.8.0` 到 `web`，适用于 DSH `0.2.0-rc.2`。

```sh
dsh plugin --profile web add @ryuu-64/dsh-session-tools@0.8.0
```

装完后重启 DSH。使用 `0.2.2-rc.3`，或需要 profile 通信默认值时，请按[源码安装步骤](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/installation.md#从源码安装)打包并安装当前源码。

## 派出第一个任务

在 DSH 对话里输入：

> 请另开一个叫「SQLite 与 PostgreSQL」的会话，比较两者在本地单人记账应用中的优缺点，然后把建议告诉我。

如果 DSH 弹出确认，批准创建。新会话处理完后，AI 可以把这次任务的结果带回当前对话。想看完整过程，点「已创建会话」卡片里的会话名称。需要补充任务时，可以让 AI 按标题找到这个会话，再告诉它你希望继续做什么。

给新会话派任务时，把背景、文件路径和预期结果一起写进任务。它只收到你交给它的任务文本，当前对话的完整历史不会随之发送。

## 会话通信设置

- **设置当前会话**：顶部「会话通信与相关对话」按钮打开右侧「会话」页签。你可以分别控制接收和发送，也可以用左侧会话的「…」菜单打开「会话通信…」。
- **设置整个 profile 的默认值（当前源码）**：打开左侧「插件」，找到「会话工具」并点组件行的「配置」。两项初始值均开启。保存后，默认值对未单独设置的会话生效，重启后继续使用。

关闭开关会拒绝相应的新投递，已接收的任务继续运行。关闭发送也会阻止创建带首条消息的新会话。插件只在普通会话之间派任务，审批仍由 DSH 决定。等待超时后，可请 AI 继续查同一次任务的结果，避免重复派发。 [通信开关和等待规则](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/tool-reference.md)

## 详细文档与反馈

- [安装、更新和卸载](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/installation.md) · [版本与宿主兼容](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/compatibility.md) · [工具和消息回执](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/tool-reference.md)
- [提交 Issue](https://github.com/Ryuu-64/dsh-session-tools/issues) 时，请附上 DSH、Node.js 和插件版本、安装来源和复现步骤。请移除 API 密钥和私密对话。QQ 交流群 `1129212995`。

[MIT 许可证](https://github.com/Ryuu-64/dsh-session-tools/blob/main/LICENSE)
