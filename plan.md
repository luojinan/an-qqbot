# QQ Bot API 后端对接指南 (Hono)

从本项目提取 `api.ts` 及其依赖，在 Hono 后端服务中独立使用 QQ 通信能力。

## 需要复制的文件

| 文件                         | 作用                          | 必须           |
| ---------------------------- | ----------------------------- | -------------- |
| `src/api.ts`                 | Token 管理 + 全部消息发送接口 | 是             |
| `src/utils/upload-cache.ts`  | 媒体上传去重缓存              | 是             |
| `src/utils/platform.ts`      | 文件名处理等工具函数          | 是             |
| `src/utils/audio-convert.ts` | 音频转 SILK 编码              | 仅发语音时需要 |

复制后删除所有 `openclaw/plugin-sdk` 相关 import，这些文件本身不依赖该框架。

## 环境变量

| 变量                  | 说明                     |
| --------------------- | ------------------------ |
| `QQBOT_APP_ID`        | QQ 开放平台 appId        |
| `QQBOT_CLIENT_SECRET` | QQ 开放平台 clientSecret |

## 接收消息（被动回复）

### WebSocket 网关接入

QQ Bot API 使用 **WebSocket 长连接**接收消息事件，而非 HTTP Webhook。需要在 Hono 服务启动时，额外启动一个 WebSocket 客户端连接 QQ 网关。

**接入流程：**

1. **获取网关地址**：调用 `getGatewayUrl(token)` 获取 WebSocket URL（`api.ts:296-299`）
2. **建立连接**：使用 WebSocket 客户端连接网关地址
3. **鉴权握手**：
   - 收到 `op:10` (Hello) 后，发送 `op:2` (Identify) 进行鉴权
   - 鉴权成功后收到 `t:READY` 事件，获得 `session_id`
4. **心跳维持**：按网关返回的 `heartbeat_interval` 定期发送 `op:1` (Heartbeat)
5. **接收事件**：监听 `op:0` (Dispatch) 类型的消息，根据 `t` 字段判断事件类型

**主要事件类型：**

| 事件类型                  | 说明        | 数据结构                                                   |
| ------------------------- | ----------- | ---------------------------------------------------------- |
| `C2C_MESSAGE_CREATE`      | 私聊消息    | `{ author: { user_openid }, content, id, timestamp }`      |
| `GROUP_AT_MESSAGE_CREATE` | 群聊 @ 消息 | `{ author: { member_openid }, group_openid, content, id }` |
| `AT_MESSAGE_CREATE`       | 频道 @ 消息 | `{ author: { id }, channel_id, content, id }`              |
| `DIRECT_MESSAGE_CREATE`   | 频道私信    | `{ author: { id }, guild_id, content, id }`                |

**被动回复关键字段：**

- `id`：消息 ID，用于被动回复时传入 `msgId` 参数
- `user_openid` / `member_openid`：用户标识，用于调用发送接口
- `content`：消息文本内容
- `attachments`：附件（图片、语音等）

**实现要点：**

- WebSocket 连接需持久化 `session_id` 和 `seq`（序列号），断线重连时可快速恢复会话
- 心跳超时或网络异常时需自动重连，建议使用指数退避策略
- 消息处理应异步化，避免阻塞心跳发送
- 同一用户的消息建议串行处理，不同用户可并行处理

**参考实现：**

本项目的完整 WebSocket 网关实现位于 `src/gateway.ts`，包含连接管理、心跳维持、会话恢复、消息队列等完整逻辑，可作为参考。

## Hono 路由设计参考

### 初始化

服务启动时调用 `initApiConfig` 配置 markdown 支持，调用 `startBackgroundTokenRefresh` 开启后台 Token 自动续期。

### 路由规划

| 方法 | 路径             | 用途         | 对应 api.ts 函数                                        |
| ---- | ---------------- | ------------ | ------------------------------------------------------- |
| POST | `/qq/send/text`  | 发送文本消息 | `sendProactiveC2CMessage` / `sendProactiveGroupMessage` |
| POST | `/qq/send/image` | 发送图片消息 | `sendC2CImageMessage` / `sendGroupImageMessage`         |
| POST | `/qq/send/file`  | 发送文件     | `sendC2CFileMessage` / `sendGroupFileMessage`           |
| POST | `/qq/send/voice` | 发送语音     | `sendC2CVoiceMessage` / `sendGroupVoiceMessage`         |
| POST | `/qq/send/video` | 发送视频     | `sendC2CVideoMessage` / `sendGroupVideoMessage`         |
| POST | `/qq/reply`      | 回复指定消息 | `sendC2CMessage` / `sendGroupMessage`（传入 msgId）     |
| POST | `/qq/typing`     | 发送输入状态 | `sendC2CInputNotify`                                    |

### 请求体约定

所有路由统一接收 JSON，包含以下公共字段：

- `to` — 目标 openid（用户或群）
- `type` — `"c2c"` 或 `"group"`

各路由额外字段：

- 文本：`text`
- 图片：`imageUrl`（URL 或 `data:image/...;base64,...`）
- 文件：`fileUrl` 或 `fileBase64` + `fileName`
- 语音：`voiceBase64`（SILK/MP3/WAV 的 Base64）
- 视频：`videoUrl` 或 `videoBase64`
- 回复：`text` + `msgId`

### 调用流程

1. 从环境变量读取 appId / clientSecret
2. 调用 `getAccessToken` 获取 token（内部自动缓存，无需手动管理过期）
3. 根据 `type` 字段选择 C2C 或 Group 对应的发送函数
4. 将 api.ts 返回的 `{ id, timestamp }` 作为响应返回

### 注意事项

- **主动消息限制**：QQ 平台对主动消息有月度配额，非回复场景注意控量
- **被动回复限制**：同一条消息最多回复 4 次（1 小时内），超限后需走主动消息通道
- **Token 有效期**：约 2 小时，`getAccessToken` 内部自动续期，也可用 `startBackgroundTokenRefresh` 提前刷新
- **富媒体上传**：图片/文件/视频/语音需先上传到 QQ 服务器获取 `file_info`，再发送；`sendC2CImageMessage` 等高级函数已封装此流程
- **文件大小**：文件类消息上限 20MB

## Cloudflare Workers 免费部署方案

### 平台特性

Cloudflare Workers 是无服务器边缘计算平台，**完全免费**即可部署 QQ Bot：

**优势：**

- ✅ **完整 WebSocket 支持**：支持作为 WebSocket 客户端连接 QQ 网关
- ✅ **全球边缘网络**：200+ 数据中心，低延迟响应
- ✅ **原生 Hono 支持**：Hono 框架对 Workers 有完整适配
- ✅ **免费额度充足**：每日 100,000 次请求
- ✅ **零成本部署**：无需信用卡，完全免费

**限制：**

- ⚠️ **连接不持久**：Worker 实例被回收时，WebSocket 连接会断开
- ⚠️ **无状态保存**：`session_id` 和 `seq` 无法持久化，断线后需完整重新鉴权
- ⚠️ **频繁重连**：可能因实例回收导致频繁断线重连
- ⚠️ **可能丢消息**：重连期间的消息可能丢失
- ⚠️ **多实例隔离**：不同地区的请求会创建独立实例，可能导致多个 WebSocket 连接同时存在
- ⚠️ **无法保证单例**：即使同一地区，也不保证请求路由到同一实例
- ⚠️ CPU 执行时间限制：10ms（不含 I/O 等待）
- ⚠️ 内存限制：128MB

**适用场景：**

- ✅ 开发测试环境
- ✅ 低频使用的个人 Bot（每天几十到几百条消息）
- ✅ 可以容忍偶尔断线的场景（几分钟到几小时重连一次）
- ✅ 主要被动响应消息，不需要主动推送
- ✅ 预算有限的小型项目
- ✅ **单地区用户访问**（避免多实例问题）

**不适用场景：**

- ❌ 需要 24/7 稳定在线
- ❌ 全球多地区用户同时访问
- ❌ 需要保证消息不重复处理
- ❌ 生产环境或商业用途

### 架构设计

**架构组成：**

1. **Worker 入口**：处理 HTTP 请求和 WebSocket 客户端连接
2. **KV 存储**：缓存 Token（可选，也可用内存缓存）

**工作流程：**

1. Worker 收到 HTTP 请求时，检查是否已有活跃的 WebSocket 连接
2. 如无连接，使用 `fetch()` 连接 QQ 网关，建立 WebSocket 客户端
3. 在 Worker 执行期间维护连接，处理心跳和消息
4. 使用 `ctx.waitUntil()` 延长执行时间，尽可能保持连接
5. 连接断开后，下次请求时自动重连

**关键技术点：**

- 使用全局变量缓存 WebSocket 连接实例（同一 Worker 实例内复用）
- 通过定时器维护心跳（在 Worker 执行期间）
- 连接断开时记录日志，下次请求时重建
- Token 可缓存在内存或 KV 中

**限制说明：**

- Worker 实例空闲一段时间后会被回收，连接随之断开
- 无法保证 24/7 在线，适合被动响应场景
- 重连时需要完整鉴权流程（无法恢复 session）
- **多实例问题**：不同地区或不同时间的请求可能路由到不同的 Worker 实例，导致：
  - 多个 WebSocket 连接同时连接到 QQ 网关
  - 每个实例独立鉴权，可能触发 QQ 平台的频率限制
  - 同一条消息可能被多个实例重复处理
  - 全局变量不在实例间共享，无法协调状态

**缓解多实例问题的方法：**

1. **使用 KV 存储协调**：
   - 在 KV 中记录当前活跃的连接信息（实例 ID + 时间戳）
   - 新实例启动前检查 KV，如果已有活跃连接则不创建新连接
   - 定期更新心跳时间戳，过期则认为实例已失效

2. **限制触发来源**：
   - 尽量让所有请求来自同一地区（如固定 CDN 节点）
   - 避免全球多地区同时访问

3. **接受重复处理**：
   - 在业务逻辑层做消息去重（基于消息 ID）
   - 使用 KV 记录已处理的消息 ID，避免重复响应

### 部署配置

**所需资源：**

| 资源类型     | 用途                        | 是否必需 | 费用         |
| ------------ | --------------------------- | -------- | ------------ |
| Workers      | HTTP API + WebSocket 客户端 | 是       | 免费         |
| KV Namespace | Token 缓存（可选）          | 推荐     | 免费额度充足 |

**环境变量配置：**

除了基础的 `QQBOT_APP_ID` 和 `QQBOT_CLIENT_SECRET`，还可配置：

| 变量             | 说明                     | 示例           |
| ---------------- | ------------------------ | -------------- |
| `KV_NAMESPACE`   | KV 存储绑定名称（可选）  | `QQ_BOT_CACHE` |
| `WEBHOOK_SECRET` | 消息回调验证密钥（可选） | 随机字符串     |

**wrangler.toml 配置要点：**

- 绑定 KV Namespace 用于缓存（可选）
- 配置兼容日期（`compatibility_date`）
- 设置 Node.js 兼容模式（如需使用 Node API）

### WebSocket 客户端实现要点

**连接管理：**

- 使用全局变量缓存 WebSocket 连接实例
- 每次 HTTP 请求时检查连接状态，断开则重连
- 使用 `fetch()` + `Upgrade: websocket` 头建立连接
- 调用 `ws.accept()` 接管连接

**心跳维持：**

- 使用 `setTimeout` 实现定时心跳（在 Worker 执行期间有效）
- 心跳间隔根据 QQ 网关返回的 `heartbeat_interval` 设置
- Worker 被回收后心跳停止，连接断开

**重连策略：**

- 检测到连接断开时，清除全局缓存
- 下次 HTTP 请求时自动触发重连
- 使用指数退避策略避免频繁重连
- 每次重连都需要完整鉴权流程（发送 `op:2` Identify）

**消息处理：**

- 使用 `ctx.waitUntil()` 延长 Worker 执行时间
- 异步处理消息，避免阻塞响应
- 消息处理失败时记录日志

**局限性：**

- 无法保证 24/7 在线
- 适合被动响应模式（收到消息后处理）
- 不适合需要主动推送的场景

### 与传统部署的差异

| 特性           | 传统服务器           | Cloudflare Workers 免费方案  |
| -------------- | -------------------- | ---------------------------- |
| WebSocket 连接 | 直接在进程内维护     | 全局变量缓存，实例回收时断开 |
| 状态持久化     | 内存/数据库          | 仅内存缓存（可选 KV）        |
| 心跳实现       | `setInterval`        | `setTimeout`（执行期间有效） |
| 连接稳定性     | 24/7 稳定            | 间歇性断线重连               |
| 并发处理       | 多线程/进程          | 自动扩展的隔离实例           |
| 部署复杂度     | 需配置服务器/容器    | 一键部署到边缘网络           |
| 成本           | VPS 费用（$3-10/月） | 完全免费                     |

### 成本估算

**免费额度：**

- Workers 请求：100,000 次/天
- KV 读取：100,000 次/天
- KV 写入：1,000 次/天
- **总成本：$0/月**

**典型使用场景：**

- 小型 Bot（<100 消息/天）：完全够用
- 中型 Bot（100-500 消息/天）：完全够用
- 大型 Bot（>500 消息/天）：可能需要考虑其他方案

**适用判断：**

- ✅ 个人使用、测试开发
- ✅ 可以容忍偶尔断线（几分钟到几小时重连一次）
- ✅ 主要是被动响应消息，不需要主动推送
- ✅ 消息量不大（每天几十到几百条）

### 开发调试

**本地开发：**

- 使用 `wrangler dev` 启动本地开发服务器
- WebSocket 连接可正常建立和测试
- 本地环境模拟 Worker 运行时

**日志查看：**

- 使用 `wrangler tail` 实时查看生产环境日志
- 通过 Cloudflare Dashboard 查看历史日志和错误追踪
- 使用 `console.log` 输出调试信息

**调试技巧：**

- 添加连接状态查询接口，暴露当前连接状态
- 使用 KV 记录关键事件时间戳，排查心跳/重连问题
- 通过 Workers Analytics 监控请求量和错误率
- 记录每次重连的时间和原因，优化重连策略

### 参考资源

- Cloudflare Workers 文档：https://developers.cloudflare.com/workers/
- Hono on Cloudflare Workers：https://hono.dev/getting-started/cloudflare-workers
- WebSocket 客户端示例：https://developers.cloudflare.com/workers/examples/websockets/
- 本项目 WebSocket 网关实现：`src/gateway.ts`
