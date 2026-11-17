# 版本与宿主兼容

[返回 README](../README.md)

## 当前源码

支持 DSH `0.2.0-rc.2` 和 `0.2.2-rc.3` 两个确切的宿主版本。使用 `0.2.2-rc.3` 时，按该宿主的要求使用 Node.js 24.9.0 或更新的 24 系列版本。支持范围由包的 `engines.dsh` 和 DSH SDK peer 依赖声明。已发布的 `0.8.0` 使用下方记录的兼容范围。

### DSH 0.2.2-rc.3 适配

- 消息回执等待异步注册并保存投影句柄。注册被拒绝或句柄暂不可用时，从会话日志计算回执。`0.2.0-rc.2` 在同步注册成功后按键读取。 [Session 投影迁移指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.1-rc.2/session-projection-handles/guide.zh.md)
- `session_create` 通过 `agent.model.current()` 继承调用方下一步选定的 provider、model 和已指定的推理强度，通过 `agentPresets.presetForSession()` 读取已记录的预设。`0.2.0-rc.2` 通过宿主投影读取相应的选择。 [模型选择实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/core/agent/src/model-selection.ts) · [Session 投影迁移指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.1-rc.2/session-projection-handles/guide.zh.md)
- 工具仍通过 `tools.register` 注册。`0.2.2-rc.3` 的真实宿主测试组合由官方 native 工具执行器运行模型发起的调用，并覆盖会话创建、发送、恢复、等待和取消。 [工具注册接口](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/core/tools/README.md) · [官方基础组合](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/bundle/base/cordis.patch.yml)

## 0.8.0

`0.8.0` 的通信开关只支持已核实的 **DSH 0.2.0-rc.2**，需要 storageDomain、typert、connection，以及原生会话菜单、UI primitives 和右侧栏公开接口。不会沿用 0.7.0 的旧宿主 peer 范围。旧版本兼容信息保留在下方。

权限记录由宿主 storageDomain 保存。无记录的会话采用当前 profile 的通信默认值，两项初始值均为开启。记录损坏或读取失败时拒绝新消息。此控制只覆盖本插件的新消息投递；不会阻止同进程高权限代码或宿主其他投递入口。

插件配置页使用 DSH 的 `configForms` 和「插件」管理页，自定义宿主需要为此 profile 提供可编辑的插件配置服务。已有会话通信入口通过同一权威存储继续工作。

`0.7.0` 包含 DSH `0.2.0-rc.2` 适配，以及标题／工作区筛选和分页。旧 npm 包 `0.6.0` 不含这些改动；使用 0.2 宿主时请选择 `0.7.0`。

## 0.7.0 中的 0.2 适配

`0.7.0` 增加 DSH `0.2.0-rc.2` 的兼容，保留原有 peer 范围；不声明支持 `0.2.1-alpha.1`，也不新增返回入口。npm 上已经发布的 `0.6.0` 不含本次适配，升级时请核对实际安装的插件版本。

- 0.2 的创建卡片经公开 `uiWorkspace.openSession` 导航；旧宿主仍使用 `sessions.open`。插件等待真实导航服务注入，宿主负责主视图的持有、切换和释放，不额外开一个读取引用
- 消息使用独立生产者来源 `tool-session`（`form=relay`）。0.2 的 V4 日志拒绝旧的 `kind=plugin` 包装；旧 V3 日志允许并保留这个生产者来源。回执中的会话和消息身份不变
- 开发 SDK、锁文件与真实宿主回归固定为 `0.2.0-rc.2`；新增的 peer 分支只接受这个确切版本，不把未知未来 RC 或 alpha 包含进来

## 0.6.0 升级说明

从 0.5.4 升级时，请检查以下兼容边界：

- Node 支持范围为 `^22.19.0 || ^24.0.0`，宿主回归基线仍是 DSH `0.1.5-rc.2`
- `session_create` / `session_send` 返回消息回执。要继续查询同一次消息，请保存并一起传入 `sessionId` 和 `messageId`；只传会话 id 的 `session_wait` 返回会话概况
- 判断消息结果时同时检查 `waitStatus` 和 `messageStatus`。`turnCompleted` 只表示所属轮次正常结束，业务是否成功仍需阅读结果；超时或调用方取消后不要自动重发
- 未指定的会话标题现在由首条任务生成并固定，不额外调用模型，后续对话不会自动改名

此版本包含审批、消息结果归属、等待取消与资源清理、会话卡片、标题、最近活动排序及文档修正。测试范围和已知限制见[工具参考](tool-reference.md)和[开发文档](development.md)。

## 宿主要求与验收范围

本节以 DSH `0.1.5-rc.2` 为基线。能否加载取决于宿主提供的服务，不能只按“桌面版”或“无界面”判断。

- **加载必需服务**：`tools`、`agents`、`sessionTitle`、`workspaceRegistry`、`agentDefaultModel`，见[插件的注入声明](../lib/index.js)。即使不填 `workspacePath`，也不能省略 `workspaceRegistry`
- **执行时还需要的能力**：新建和发送会话消息需要 `approval`、`sandboxPolicy` 的公开权限接口；缺失时停止。列出会话和查找已关闭的发送目标需要 `sessionQuery`；关闭会话的日志读取使用 `sessionPersistence`，或兼容宿主提供的 `sessionQuery.readSession`
- **官方配置证据**：同版本的 [Web 组合加载 workspace](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/bundle/web-app/cordis.patch.yml#L75-L76)，[Desktop 复用 Web 组合](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/apps/desktop-host/config/desktop.cordis.patch.yml#L1-L6)。workspace 并非桌面版独有。缺少该服务的 headless 配置无法加载本插件；不能据此宣布所有 headless 配置可用
- **已运行的宿主回归**：使用仓库的[临时 Loader 配置](../test/helpers/real-host.mjs)和[可重启 JSONL 配置](../test/helpers/message-receipts-host.mjs)，加载真实 rc.2 宿主组件；最近活动排序测试另加载真实 `sessionQuery`。这些是测试专用配置，模型请求与人工审批答复使用脚本替代，不是完整的官方 Web 或 Desktop profile 验收

服务出现在官方配置中，与本插件已在该完整配置中通过验收，是两件事。本节的旧版宿主回归不覆盖完整 Web 浏览器或 Desktop UI 的端到端使用，也不能单独证明其他宿主配置或 DSH 0.2 可用。0.7.0 的 0.2 适配与现有回归范围见[开发文档](development.md)。

### 更新与结果校验边界

当前源码在最后一个插件实例卸载时等待已开始的通信存储操作完成，然后关闭 storageDomain。加载新实例后，会重新打开原有记录。若旧版已在当前进程中打开存储，升级后须重启一次，以释放旧版持有的存储。

rc.2 的 strict Remote 描述符用于声明接口约定；结果的 `create().parse` 不会被 Gateway 自动调用。服务端从经过校验的存储记录构造返回值，浏览器另行核对权限布尔值、revision 和保存状态，不能将描述符声明单独视作结果严格校验证据。
