/**
 * QQ Bot WebSocket 网关客户端
 * 用于 Cloudflare Workers 环境
 */

import { getAccessToken } from './lib/api';

// QQ 网关相关类型定义
interface GatewayPayload {
  op: number;
  d?: any;
  s?: number;
  t?: string;
}

interface GatewayHello {
  heartbeat_interval: number;
}

interface GatewayReady {
  session_id: string;
  user: {
    id: string;
    username: string;
    bot: boolean;
  };
}

// WebSocket 连接状态
interface ConnectionState {
  ws: WebSocket | null;
  sessionId: string | null;
  seq: number | null;
  heartbeatInterval: number | null;
  heartbeatTimer: any;
  isConnected: boolean;
  lastHeartbeatAck: number;
}

// 全局连接状态（同一 Worker 实例内复用）
let globalConnection: ConnectionState = {
  ws: null,
  sessionId: null,
  seq: null,
  heartbeatInterval: null,
  heartbeatTimer: null,
  isConnected: false,
  lastHeartbeatAck: Date.now(),
};

/**
 * 获取网关地址
 */
async function getGatewayUrl(token: string): Promise<string> {
  const response = await fetch('https://api.sgroup.qq.com/gateway', {
    headers: {
      Authorization: `QQBot ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get gateway URL: ${response.status}`);
  }

  const data = await response.json() as { url: string };
  return data.url;
}

/**
 * 发送心跳
 */
function sendHeartbeat(ws: WebSocket, seq: number | null) {
  const payload: GatewayPayload = {
    op: 1,
    d: seq,
  };

  console.log('[QQ Gateway] Sending heartbeat, seq:', seq);
  ws.send(JSON.stringify(payload));
}

/**
 * 发送鉴权消息
 */
function sendIdentify(ws: WebSocket, token: string) {
  const payload: GatewayPayload = {
    op: 2,
    d: {
      token: `QQBot ${token}`,
      intents: 0 | (1 << 25) | (1 << 30), // C2C_MESSAGE_CREATE + GROUP_AT_MESSAGE_CREATE
      shard: [0, 1],
    },
  };

  console.log('[QQ Gateway] Sending identify');
  ws.send(JSON.stringify(payload));
}

/**
 * 处理网关消息
 */
function handleGatewayMessage(
  message: string,
  state: ConnectionState,
  token: string,
  onMessage?: (event: any) => void
) {
  const payload: GatewayPayload = JSON.parse(message);

  // 更新序列号
  if (payload.s !== undefined) {
    state.seq = payload.s;
  }

  switch (payload.op) {
    case 10: // Hello
      const hello = payload.d as GatewayHello;
      console.log('[QQ Gateway] Received Hello, heartbeat_interval:', hello.heartbeat_interval);

      // 发送鉴权
      sendIdentify(state.ws!, token);

      // 启动心跳
      state.heartbeatInterval = hello.heartbeat_interval;
      if (state.heartbeatTimer) {
        clearInterval(state.heartbeatTimer);
      }

      state.heartbeatTimer = setInterval(() => {
        if (state.ws && state.isConnected) {
          sendHeartbeat(state.ws, state.seq);
        }
      }, hello.heartbeat_interval);
      break;

    case 11: // Heartbeat ACK
      console.log('[QQ Gateway] Received heartbeat ACK');
      state.lastHeartbeatAck = Date.now();
      break;

    case 0: // Dispatch
      console.log('[QQ Gateway] Received event:', payload.t);

      if (payload.t === 'READY') {
        const ready = payload.d as GatewayReady;
        state.sessionId = ready.session_id;
        state.isConnected = true;
        console.log('[QQ Gateway] Connected! Session ID:', ready.session_id);
      }

      // 调用消息处理回调
      if (onMessage && payload.d) {
        onMessage({
          type: payload.t,
          data: payload.d,
        });
      }
      break;

    case 9: // Invalid Session
      console.error('[QQ Gateway] Invalid session, reconnecting...');
      state.sessionId = null;
      state.seq = null;
      break;

    default:
      console.log('[QQ Gateway] Unknown opcode:', payload.op);
  }
}

/**
 * 连接到 QQ 网关
 */
export async function connectToGateway(
  appId: string,
  clientSecret: string,
  onMessage?: (event: any) => void
): Promise<ConnectionState> {
  // 如果已有活跃连接，直接返回
  if (globalConnection.ws && globalConnection.isConnected) {
    console.log('[QQ Gateway] Reusing existing connection');
    return globalConnection;
  }

  try {
    // 获取 Token
    const token = await getAccessToken(appId, clientSecret);

    // 获取网关地址
    const gatewayUrl = await getGatewayUrl(token);
    console.log('[QQ Gateway] Connecting to:', gatewayUrl);

    // 使用 fetch + Upgrade 建立 WebSocket 连接
    const response = await fetch(gatewayUrl, {
      headers: {
        Upgrade: 'websocket',
      },
    });

    const ws = response.webSocket;
    if (!ws) {
      throw new Error('Failed to establish WebSocket connection');
    }

    // 接受连接
    ws.accept();

    // 更新全局状态
    globalConnection.ws = ws;
    globalConnection.isConnected = false; // 等待 READY 事件

    // 监听消息
    ws.addEventListener('message', (event) => {
      try {
        handleGatewayMessage(event.data as string, globalConnection, token, onMessage);
      } catch (error) {
        console.error('[QQ Gateway] Error handling message:', error);
      }
    });

    // 监听关闭
    ws.addEventListener('close', (event) => {
      console.log('[QQ Gateway] Connection closed:', event.code, event.reason);

      // 清理状态
      if (globalConnection.heartbeatTimer) {
        clearInterval(globalConnection.heartbeatTimer);
      }

      globalConnection.ws = null;
      globalConnection.isConnected = false;
    });

    // 监听错误
    ws.addEventListener('error', (event) => {
      console.error('[QQ Gateway] WebSocket error:', event);
    });

    console.log('[QQ Gateway] WebSocket connection established');
    return globalConnection;

  } catch (error) {
    console.error('[QQ Gateway] Failed to connect:', error);
    throw error;
  }
}

/**
 * 获取当前连接状态
 */
export function getConnectionState(): ConnectionState {
  return globalConnection;
}

/**
 * 断开连接
 */
export function disconnect() {
  if (globalConnection.heartbeatTimer) {
    clearInterval(globalConnection.heartbeatTimer);
  }

  if (globalConnection.ws) {
    globalConnection.ws.close();
  }

  globalConnection = {
    ws: null,
    sessionId: null,
    seq: null,
    heartbeatInterval: null,
    heartbeatTimer: null,
    isConnected: false,
    lastHeartbeatAck: Date.now(),
  };
}
