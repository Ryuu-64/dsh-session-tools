# dsh-session-tools

DSH 宿主侧插件：给 agent 两个操作**正式对话**的工具——`session_create`（创建用户可见会话，Codex `create_thread` 的等价物）和 `session_send`（向已有正式会话投递消息）。

它补上 DSH 缺的那一环：会话的左侧分组归属只由**宿主进程内的创建路径**决定——`sessionController.create`、fork、webhook 运行时。进程外写盘（例如 `dsh --profile headless`）只能造出「持久化但归到未分组、且要等客户端重新拉取」的会话。本插件把"在宿主进程内创建并 attach"这一条路径变成模型可直接调用的工具。

## 工具契约

`session_create`

| 参数 | 必填 | 含义 |
|---|---|---|
| `prompt` | 是 | 新会话的第一条用户消息。必须自包含：新会话看不到调用方会话的历史。 |
| `workspacePath` | 否 | 已注册工作区的**绝对路径**。给了就 `attachSession` 到该工作区，会话出现在它的分组下；省略则创建为**未分组**。 |
| `title` | 否 | 显式标题；省略则与用户手动新建一样，由首条提示词生成标题。 |
| `wait` | 否 | 默认 `false`（非阻塞，创建完就返回）。一次性宿主里若要让新会话跑完首轮再退出，传 `true`。 |

返回 `{ sessionId, grouped, cwd, workspaceId?, workspacePath? }`。

`session_send`

| 参数 | 必填 | 含义 |
|---|---|---|
| `sessionId` | 是 | 目标正式会话的 id，例如 `session-9311a0fb-65c7-4b04-b142-1444642a627e`。 |
| `message` | 是 | 消息正文。自包含：目标看不到调用方会话，除非用户自己做了跨会话引用。 |

返回 `{ sessionId, cwd }`；投递非阻塞，返回只代表目标已接受该消息。

设计约束：

- **不自动注册工作区**。`workspacePath` 必须是注册表里已有的路径；否则工具报错并列出全部已注册工作区（标题 + 路径），让调用方改用正确路径或改走未分组。
- **只做宿主进程内创建**，不走界面、不走浏览器自动化、不写别的进程的持久域。
- 创建失败会回滚：已 attach 的会 detach，已建的 agent 会 dispose。
- `session_send` 只认**正式对话**（根会话）：拒绝调用方自己的 id（会话不给自己发消息），拒绝 `delegationDepth > 0` 的委派子会话（那类用 `send_message`）。
- `session_send` 不依赖 web 宿主面的 `session-controller`：活动目标走 `ctx.agents.get`，冷目标按持久化 header 恢复（`sessionQuery.listSessions` → `ctx.agents.resume`，并挂回 header 里记录的 preset）。这与宿主 `session-controller.resolveAgent` 同构，但不复用它的 resume 去重与 subagent ownership fence——本插件用 delegationDepth 检查代替后者。
- 消息来源标为 `plugin: tool-session`，不伪装成用户消息；目标会话的标题生成、过滤与展示都不会把它当成真人输入。

## 安装

```powershell
dsh plugin --profile desktop add @ryuu-64/dsh-session-tools@0.4.0
```

源码方式：

```powershell
git clone https://github.com/Ryuu-64/dsh-session-tools.git
dsh plugin --profile desktop add link:C:\path\to\dsh-session-tools
```

装完重启 DSH，两个工具即可用，无需其它配置。`link:` 安装下改动源码需重启应用生效（宿主进程内按 URL 缓存 ESM 模块）。

## 已知边界

- 需要 `ctx.workspaceRegistry`；`headless` profile 默认不挂它（桌面 web profile 挂了），所以在 headless 里用要自己加行。
- 一次性宿主（`dsh --profile headless`）默认会在父会话结束后退出，子会话还在跑首轮时会被一起带走；那种场合传 `wait: true`。`session_send` 同理：投递返回只代表目标接受，目标要跑完还得宿主继续活着。
- 工作区归属是持久账本，创建后无法把会话在分组之间搬移。
