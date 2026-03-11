import { Hono } from 'hono';
import qqRoutes from './routes';
import { initApiConfig } from './lib/api';
import { connectToGateway, getConnectionState } from './gateway';

// 定义环境变量类型
type Bindings = {
  QQBOT_APP_ID: string;
  QQBOT_CLIENT_SECRET: string;
  QQ_BOT_KV?: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// 初始化 API 配置
initApiConfig({ markdownSupport: false });

// 健康检查
app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'QQ Bot API is running',
    timestamp: new Date().toISOString()
  });
});

// 连接状态查询
app.get('/status', (c) => {
  const state = getConnectionState();
  return c.json({
    websocket: state.isConnected ? 'connected' : 'disconnected',
    sessionId: state.sessionId,
    lastHeartbeat: state.lastHeartbeatAck,
    uptime: Date.now()
  });
});

// 启动 WebSocket 连接
app.post('/connect', async (c) => {
  const appId = c.env.QQBOT_APP_ID;
  const clientSecret = c.env.QQBOT_CLIENT_SECRET;

  if (!appId || !clientSecret) {
    return c.json({ error: 'Missing QQBOT_APP_ID or QQBOT_CLIENT_SECRET' }, 400);
  }

  try {
    // 连接到网关，并处理接收到的消息
    await connectToGateway(appId, clientSecret, (event) => {
      console.log('[Message Event]', event.type, event.data);

      // TODO: 在这里处理接收到的消息
      // 例如：自动回复、调用业务逻辑等
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
