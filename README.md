# QQ Bot Cloudflare Workers

基于 Hono 框架的 QQ Bot API 后端服务，部署在 Cloudflare Workers 上。

## 功能特性

- ✅ 完整的 QQ Bot API 封装（文本、图片、文件、语音、视频消息）
- ✅ WebSocket 网关客户端（接收消息事件）
- ✅ Token 自动管理和缓存
- ✅ 支持主动消息和被动回复
- ✅ 完全免费部署（Cloudflare Workers 免费额度）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

创建 `.dev.vars` 文件（本地开发）：

```
QQBOT_APP_ID=your_app_id
QQBOT_CLIENT_SECRET=your_client_secret
```

生产环境在 Cloudflare Dashboard 中配置环境变量。

### 3. 本地开发

```bash
npm run dev
```

### 4. 部署到 Cloudflare Workers

```bash
npm run deploy
```

## API 接口

### 健康检查

```
GET /
```

### 连接状态

```
GET /status
```

### 启动 WebSocket 连接

```
POST /connect
```

### 发送文本消息

```
POST /qq/send/text
Content-Type: application/json

{
  "to": "user_openid_or_group_openid",
  "type": "c2c",  // 或 "group"
  "text": "Hello, World!"
}
```

### 回复消息

```
POST /qq/reply
Content-Type: application/json

{
  "to": "user_openid_or_group_openid",
  "type": "c2c",
  "text": "Reply message",
  "msgId": "message_id_to_reply"
}
```

### 发送图片

```
POST /qq/send/image
Content-Type: application/json

{
  "to": "user_openid_or_group_openid",
  "type": "c2c",
  "imageUrl": "https://example.com/image.jpg"
}
```

支持 URL 或 Base64 格式：`data:image/png;base64,...`

### 发送文件

```
POST /qq/send/file
Content-Type: application/json

{
  "to": "user_openid_or_group_openid",
  "type": "c2c",
  "fileUrl": "https://example.com/file.pdf",
  "fileName": "document.pdf"
}
```

### 发送语音

```
POST /qq/send/voice
Content-Type: application/json

{
  "to": "user_openid_or_group_openid",
  "type": "c2c",
  "voiceBase64": "base64_encoded_audio"
}
```

支持 SILK、MP3、WAV 格式。

### 发送视频

```
POST /qq/send/video
Content-Type: application/json

{
  "to": "user_openid_or_group_openid",
  "type": "c2c",
  "videoUrl": "https://example.com/video.mp4"
}
```

### 发送输入状态

```
POST /qq/typing
Content-Type: application/json

{
  "to": "user_openid"
}
```

## WebSocket 网关

WebSocket 网关用于接收 QQ 消息事件。调用 `POST /connect` 启动连接。

### 支持的事件类型

- `C2C_MESSAGE_CREATE` - 私聊消息
- `GROUP_AT_MESSAGE_CREATE` - 群聊 @ 消息
- `AT_MESSAGE_CREATE` - 频道 @ 消息
- `DIRECT_MESSAGE_CREATE` - 频道私信

### 消息处理

在 `src/index.ts` 的 `/connect` 路由中修改消息处理逻辑：

```typescript
await connectToGateway(appId, clientSecret, (event) => {
  console.log('[Message Event]', event.type, event.data);

  // 处理消息
  if (event.type === 'C2C_MESSAGE_CREATE') {
    const { author, content, id } = event.data;
    // 自动回复逻辑
  }
});
```

## Cloudflare Workers 限制

### 优势
- 完全免费（每日 100,000 次请求）
- 全球边缘网络，低延迟
- 支持 WebSocket 客户端

### 限制
- WebSocket 连接不持久（Worker 实例回收时断开）
- 无状态保存（需使用 KV 存储）
- 可能频繁重连
- 不适合 24/7 稳定在线的生产环境

### 适用场景
- 开发测试环境
- 低频使用的个人 Bot
- 可容忍偶尔断线的场景
- 主要被动响应消息

## 项目结构

```
.
├── src/
│   ├── index.ts          # 主入口文件
│   ├── routes.ts         # QQ Bot 路由
│   ├── gateway.ts        # WebSocket 网关客户端
│   └── lib/
│       ├── api.ts        # QQ Bot API 封装
│       └── utils/        # 工具函数
├── package.json
├── tsconfig.json
├── wrangler.toml         # Cloudflare Workers 配置
└── README.md
```

## 参考资源

- [QQ 开放平台文档](https://bot.q.qq.com/wiki/)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Hono 框架文档](https://hono.dev/)

## 注意事项

1. **主动消息限制**：QQ 平台对主动消息有月度配额
2. **被动回复限制**：同一条消息最多回复 4 次（1 小时内）
3. **Token 有效期**：约 2 小时，自动续期
4. **文件大小限制**：文件类消息上限 20MB
5. **WebSocket 连接**：Worker 实例回收时会断开，需要重连

## License

MIT
