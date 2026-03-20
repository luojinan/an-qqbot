import { Hono } from 'hono';
import qqRoutes from './routes';
import {
  getAccessToken,
  initApiConfig,
  sendC2CMessage,
  sendGroupMessage,
} from './lib/api';
import { connectToGateway, getConnectionState } from './gateway';
import { initOpenCodeConfig, sendMessageToLLM } from './lib/opencode';

// 定义环境变量类型
type Bindings = {
  QQBOT_APP_ID: string;
  QQBOT_CLIENT_SECRET: string;
  OPENCODE_PROXY_URL: string;
  OPENCODE_MODEL_ID?: string;
  QQ_BOT_KV?: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// 初始化 API 配置
initApiConfig({ markdownSupport: true });

// 健康检查
app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'QQ Bot API is running',
    timestamp: new Date().toISOString()
  });
})

// 连接状态查询
app.get('/status', (c) => {
  const state = getConnectionState();
  return c.json({
    websocket: state.isConnected
      ? 'connected'
      : state.isConnecting
        ? 'connecting'
        : 'disconnected',
    sessionId: state.sessionId,
    lastHeartbeat: state.lastHeartbeatAck,
    uptime: Date.now()
  });
})

// 启动 WebSocket 连接
app.post('/connect', async (c) => {
  const appId = c.env.QQBOT_APP_ID;
  const clientSecret = c.env.QQBOT_CLIENT_SECRET;

  if (!appId || !clientSecret) {
    return c.json({ error: 'Missing QQBOT_APP_ID or QQBOT_CLIENT_SECRET' }, 400);
  }

  // 初始化 OpenCode LLM 配置
  // 捕获到局部变量，在回调闭包中使用（WebSocket 回调不经过 HTTP 中间件）
  const openCodeProxyUrl = c.env.OPENCODE_PROXY_URL;
  const openCodeModelId = c.env.OPENCODE_MODEL_ID;
  if (openCodeProxyUrl) {
    initOpenCodeConfig({
      proxyUrl: openCodeProxyUrl,
      modelID: openCodeModelId,
    });
  }

  try {
    // 连接到网关，并处理接收到的消息
    await connectToGateway(appId, clientSecret, async (event) => {
      console.log('[Message Event]', event.type, event.data);

      try {
        const token = await getAccessToken(appId, clientSecret);

        if (event.type === 'C2C_MESSAGE_CREATE') {
          const openid = event.data?.author?.user_openid;
          const msgId = event.data?.id;
          const content = String(event.data?.content ?? '').trim();

          if (!openid || !msgId) {
            console.warn('[Auto Reply] Missing c2c openid or msgId');
            return;
          }

          if (!content) {
            await sendC2CMessage(token, openid, '请发送文字消息', msgId);
            return;
          }

          try {
            const llmReply = await sendMessageToLLM(openid, content);
            await sendC2CMessage(token, openid, llmReply, msgId);
            console.log('[Auto Reply] LLM reply sent to:', openid);
          } catch (llmErr) {
            console.error('[Auto Reply] LLM call failed:', llmErr);
            await sendC2CMessage(token, openid, 'LLM 服务暂时不可用，请稍后再试。', msgId);
          }
          return;
        }

        if (event.type === 'GROUP_AT_MESSAGE_CREATE') {
          const groupOpenid = event.data?.group_openid;
          const msgId = event.data?.id;
          const content = String(event.data?.content ?? '').trim() || '空消息';

          if (!groupOpenid || !msgId) {
            console.warn('[Auto Reply] Missing groupOpenid or msgId');
            return;
          }

          await sendGroupMessage(token, groupOpenid, `收到群消息：${content}`, msgId);
          console.log('[Auto Reply] Group reply sent to:', groupOpenid);
        }
      } catch (error) {
        console.error('[Auto Reply] Failed to handle event:', error);
      }
    });

    return c.json({ status: 'connecting', message: 'WebSocket connection initiated' });
  } catch (error) {
    console.error('[Connect Error]', error);
    return c.json({ error: 'Failed to connect to gateway' }, 500);
  }
});

// 挂载 QQ Bot 路由
app.route('/qq', qqRoutes);

export default app;
