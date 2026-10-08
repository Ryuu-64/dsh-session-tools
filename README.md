# dsh-session-tools

让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中的 AI 新建会话、给其他会话派任务，并把结果带回来。

适合把独立的调查或整理工作交给另一个会话，省去手动新建、复制背景、来回转述。新会话会出现在侧边栏，你可以随时打开，直接继续对话。

## 安装

需要已能正常使用的 DSH 和模型配置，以及 **Node.js 22.19+（22 系列）或 24.x**。`dsh plugin` 使用 pnpm 管理插件；请确保它在命令行中可用。

**先确认版本：** npm 发布版 `0.6.0` 的宿主回归基线是 DSH `0.1.5-rc.2`，不含 `0.2.0-rc.2` 适配。该适配已合入仓库 `main`，尚未发布到 npm；使用 DSH 0.2 时，请先看[源码安装与兼容说明](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/installation.md)。不声明支持 `0.2.1-alpha.1` 或未知后续版本。

在终端中安装到你使用的宿主配置（profile），下面以 `web` 为例：

```sh
dsh plugin --profile web add @ryuu-64/dsh-session-tools@0.6.0
```

安装后重启对应的 DSH 宿主。插件没有额外配置项；自定义宿主配置还需满足[服务要求](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/compatibility.md)。

## 开始使用

在 DSH 对话中直接说你想做什么，无需自己填写工具参数。例如：

> 帮我新建一个叫「方案比较」的会话，比较 SQLite 和 PostgreSQL 在本地单人记账应用中的优缺点，给出推荐和理由。等它回答后，把结果告诉我。

1. AI 准备好任务，并请求新建会话的确认。
2. 允许后，新会话开始处理任务。点「已创建会话」卡片上的按钮，就能打开它。
3. AI 可以等待这次消息的结果，再回到当前对话中继续回答。一次等待默认 60 秒、最多 5 分钟；超时后可以接着查，不必重新派任务。

也可以对已有会话说：

> 先列出最近的会话，找到「方案比较」，让它再补充数据导出的注意事项。

**把任务背景写完整。** 插件不会自动把当前对话复制给目标会话；对方需要的背景、文件路径和预期结果都应写进任务。

## 能做什么

| 你想做的事 | AI 使用的工具 |
| --- | --- |
| 新建一个可独立继续对话的会话，可放入已有工作区 | `session_create` |
| 给另一个普通会话发送新消息 | `session_send` |
| 按最近对话活动列出会话，查看标题和状态 | `list_sessions` |
| 查询某次消息的结果，或查看会话概况 | `session_wait` |

创建时可指定标题；不指定时，从首条任务生成固定标题，不额外调用模型。之后你仍可手动改名。

## 权限与限制

- **新建和发送通常需要确认。** 只有宿主明确同时启用完全访问权限与免审批时才跳过确认；宿主的拒绝规则仍然生效。列出和等待是只读操作。
- **等待超时不等于失败。** 取消等待也不会取消目标任务。继续查询同一次消息要同时使用回执里的 `sessionId` 和 `messageId`，不要自动重发。轮次正常结束也不保证任务本身做成功。
- **只操作普通会话。** 不能向当前会话自己发消息，也不能向子代理发消息。列表包含已归档的普通会话，并标明归档状态。
- **工作区必须已存在。** 插件不会创建工作区，也不提供会话创建后跨工作区搬移的功能。
- **目标仍依赖 DSH 运行。** 发送消息可重新打开已关闭的会话，但它必须保存过工作目录；只读等待不会唤醒目标。插件不提供宿主关闭后的后台执行服务。

更多参数、状态和出错处理见[工具参考](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/tool-reference.md)。

## 文档与反馈

- [安装、源码使用与卸载](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/installation.md)
- [版本、升级注意事项与宿主要求](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/compatibility.md)
- [工具参数与消息回执](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/tool-reference.md)
- [开发与回归检查](https://github.com/Ryuu-64/dsh-session-tools/blob/main/docs/development.md)

遇到问题或有建议，请[提交 Issue](https://github.com/Ryuu-64/dsh-session-tools/issues)。请附上 DSH、Node.js 和插件版本、安装方式，以及可复现的步骤；不要贴 API 密钥或私密对话。

QQ 交流群：`1129212995`。群聊用于使用交流和社区互助；需要持续跟踪的问题请先提交 Issue，再把 Issue 链接发到群里。群聊不替代 Issue 中可检索的正式记录。

由 [Ryuu-64](https://github.com/Ryuu-64) 维护，采用 [MIT 许可证](LICENSE)。
