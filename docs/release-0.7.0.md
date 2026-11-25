# 0.7.0 发布说明

`0.7.0` 将 DSH `0.2.0-rc.2` 适配带入 npm 包，并增加已有会话的标题筛选、工作区筛选和分页。旧版 `0.6.0` 不含这些改动。

## 安装与升级

在实际使用的 profile 安装：

```sh
dsh plugin --profile web add @ryuu-64/dsh-session-tools@0.7.0
```

重启对应宿主。不需要从 Git 克隆或运行源码安装。Node 仍需 `^22.19.0 || ^24.0.0`；CLI 插件管理需要 pnpm。Desktop 请使用所装 DSH 提供的插件入口，不把 `web` 命令直接改成 `desktop`。

## 本次改动

- 新增 `list_sessions.titleQuery`、`workspaceId`／`workspacePath` 和 `cursor`，可以缩小范围并继续下一页。标题为字面匹配，工作区依据真实成员关系。
- 每页最多 100 条，返回 `matchedTotal`；仅在存在下一页时返回 `nextCursor`。游标限同一调用会话、固定 5 分钟有效；过期或范围改变需重新查询。
- DSH 0.2 创建卡片使用公开 `uiWorkspace.openSession`；消息来源使用 `tool-session`／`relay`，适应 V4 日志。旧宿主保留原导航分支。
- 审批与只读边界不变；标题读取失败不返回伪精确的匹配总数。资源限制与取消行为见[工具参考](tool-reference.md)。

## 兼容与覆盖

新增支持只到精确的 `0.2.0-rc.2`，不含 `0.2.1-alpha.1` 或未知未来版本；保留原有 0.1 peer 范围。固定自动化基线为 `0.1.5-rc.2`、`0.1.5-rc.3`、`0.1.6-alpha.1`、`0.1.6-alpha.2` 与 `0.2.0-rc.2`，Node 22.19.0 和 24。

宿主必须提供工具、Agent、标题、工作区、默认模型及操作所需服务。真实组件集成、干净 npm tarball 安装和合成数据回归不等于完整官方 Web／Desktop profile 的端到端验收；模型请求与人工审批答复仍使用脚本边界。详见[开发文档](development.md)。
