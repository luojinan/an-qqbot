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
  isConnecting: boolean;
  lastHeartbeatAck: number;
}

// 重连常量
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 60000;
const HEARTBEAT_TIMEOUT_MS = 15000;

// 不可恢复的关闭码，收到这些码不重连
const NON_RECOVERABLE_CLOSE_CODES = new Set([
  4004, // 认证失败
  4010, // Shard 无效
  4011, // Sharding required
  4012, // Invalid API version
  4013, // Invalid intents
  4014, // Disallowed intents
]);

// 全局连接状态（同一 Worker 实例内复用）
let globalConnection: ConnectionState = {
  ws: null,
  sessionId: null,
  seq: null,
  heartbeatInterval: null,
  heartbeatTimer: null,
  isConnected: false,
  isConnecting: false,
  lastHeartbeatAck: Date.now(),
};

let connectPromise: Promise<ConnectionState> | null = null;

// 保存凭据和回调，用于自动重连
let savedCredentials: { appId: string; clientSecret: string } | null = null;
let savedOnMessage: ((event: any) => void) | null = null;
let reconnectAttempt = 0;
let reconnectTimer: any = null;

function resetConnectionState(preserveSession = false) {
  if (globalConnection.heartbeatTimer) {
    clearInterval(globalConnection.heartbeatTimer);
  }

  const sessionId = preserveSession ? globalConnection.sessionId : null;
  const seq = preserveSession ? globalConnection.seq : null;

  globalConnection = {
    ws: null,
    sessionId,
    seq,
    heartbeatInterval: null,
    heartbeatTimer: null,
    isConnected: false,
    isConnecting: false,
    lastHeartbeatAck: Date.now(),
  };
}

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

async function waitForGatewaySocketOpen(ws: WebSocket): Promise<void> {
  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('error', handleError);
      ws.removeEventListener('close', handleClose);
    };

    const handleOpen = () => {
      cleanup();
      resolve();
    };

    const handleError = (event: Event) => {
      cleanup();
      reject(new Error(`[QQ Gateway] WebSocket open failed: ${event.type}`));
    };

    const handleClose = (event: CloseEvent) => {
      cleanup();
      reject(
        new Error(
          `[QQ Gateway] WebSocket closed before ready: ${event.code} ${event.reason}`,
        ),
      );
    };

    ws.addEventListener('open', handleOpen);
    ws.addEventListener('error', handleError);
    ws.addEventListener('close', handleClose);
  });
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
 * 发送 Resume 恢复会话
 */
function sendResume(ws: WebSocket, token: string, sessionId: string, seq: number) {
  const payload: GatewayPayload = {
    op: 6,
    d: {
      token: `QQBot ${token}`,
      session_id: sessionId,
      seq,
    },
  };

  console.log('[QQ Gateway] Sending resume, session:', sessionId, 'seq:', seq);
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

      // 根据是否有 session 信息决定 Resume 还是 Identify
      if (state.sessionId && state.seq !== null) {
        sendResume(state.ws!, token, state.sessionId, state.seq);
      } else {
        sendIdentify(state.ws!, token);
      }

      // 启动心跳
      state.heartbeatInterval = hello.heartbeat_interval;
      if (state.heartbeatTimer) {
        clearInterval(state.heartbeatTimer);
      }
      state.lastHeartbeatAck = Date.now();

      state.heartbeatTimer = setInterval(() => {
        if (state.ws && state.ws.readyState === 1) {
          // 心跳超时检测：距上次 ACK 超过 heartbeatInterval + HEARTBEAT_TIMEOUT_MS
          const timeSinceAck = Date.now() - state.lastHeartbeatAck;
          if (timeSinceAck > hello.heartbeat_interval + HEARTBEAT_TIMEOUT_MS) {
            console.warn('[QQ Gateway] Heartbeat ACK timeout, closing connection to trigger reconnect');
            state.ws.close(4000, 'Heartbeat timeout');
            return;
          }
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
        state.isConnecting = false;
        reconnectAttempt = 0;
        console.log('[QQ Gateway] Connected! Session ID:', ready.session_id);
      }

      if (payload.t === 'RESUMED') {
        state.isConnected = true;
        state.isConnecting = false;
        reconnectAttempt = 0;
        console.log('[QQ Gateway] Session resumed successfully');
      }

      // 调用消息处理回调
      if (onMessage && payload.d) {
        Promise.resolve(
          onMessage({
            type: payload.t,
            data: payload.d,
          }),
        ).catch((error) => {
          console.error('[QQ Gateway] Error in onMessage callback:', error);
        });
      }
      break;

    case 9: // Invalid Session
      console.error('[QQ Gateway] Invalid session, will do fresh identify on reconnect');
      state.sessionId = null;
      state.seq = null;
      // 关闭当前连接，触发 close → 重连（此次会走 Identify）
      if (state.ws) {
        state.ws.close(4009, 'Invalid session');
      }
      break;

    default:
      console.log('[QQ Gateway] Unknown opcode:', payload.op);
  }
}

/**
 * 计算重连延迟（指数退避）
 */
function getReconnectDelay(): number {
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempt),
    RECONNECT_MAX_DELAY_MS,
  );
  return delay;
}

/**
 * 调度自动重连
 */
function scheduleReconnect() {
  if (!savedCredentials) {
    console.error('[QQ Gateway] No saved credentials, cannot reconnect');
    return;
  }

  const delay = getReconnectDelay();
  console.log(`[QQ Gateway] Scheduling reconnect in ${delay}ms (attempt ${reconnectAttempt + 1})`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await doConnect();
    } catch (error) {
      console.error('[QQ Gateway] Reconnect failed:', error);
      reconnectAttempt++;
      scheduleReconnect();
    }
  }, delay);
}

/**
 * 实际建立 WebSocket 连接的内部函数
 */
async function doConnect(): Promise<ConnectionState> {
  if (!savedCredentials) {
    throw new Error('No saved credentials');
  }

  const { appId, clientSecret } = savedCredentials;
  const onMessage = savedOnMessage ?? undefined;

  globalConnection.isConnecting = true;

  const token = await getAccessToken(appId, clientSecret);
  const gatewayUrl = await getGatewayUrl(token);
  console.log('[QQ Gateway] Connecting to:', gatewayUrl);

  const ws = new WebSocket(gatewayUrl);

  globalConnection.ws = ws;
  globalConnection.isConnected = false;
  globalConnection.isConnecting = true;

  ws.addEventListener('message', (event) => {
    try {
      handleGatewayMessage(event.data as string, globalConnection, token, onMessage);
    } catch (error) {
      console.error('[QQ Gateway] Error handling message:', error);
    }
  });

  ws.addEventListener('close', (event) => {
    console.log('[QQ Gateway] Connection closed:', event.code, event.reason);
    connectPromise = null;

    // 不可恢复的关闭码 — 不重连
    if (NON_RECOVERABLE_CLOSE_CODES.has(event.code)) {
      console.error(`[QQ Gateway] Non-recoverable close code ${event.code}, will not reconnect`);
      resetConnectionState();
      return;
    }

    // 保留 sessionId + seq 用于 Resume，清理其余状态
    resetConnectionState(true);

    // 触发自动重连
    scheduleReconnect();
  });

  ws.addEventListener('error', (event) => {
    console.error('[QQ Gateway] WebSocket error:', event);
  });

  await waitForGatewaySocketOpen(ws);
  console.log('[QQ Gateway] WebSocket connection established');
  return globalConnection;
}

/**
 * 连接到 QQ 网关
 */
export async function connectToGateway(
  appId: string,
  clientSecret: string,
  onMessage?: (event: any) => void
): Promise<ConnectionState> {
  // 保存凭据和回调，用于自动重连
  savedCredentials = { appId, clientSecret };
  if (onMessage) {
    savedOnMessage = onMessage;
  }

  // 如果已有活跃连接，直接返回
  if (globalConnection.ws && globalConnection.isConnected) {
    console.log('[QQ Gateway] Reusing existing connection');
    return globalConnection;
  }

  if (connectPromise) {
    console.log('[QQ Gateway] Connection already in progress');
    return await connectPromise;
  }

  reconnectAttempt = 0;

  connectPromise = doConnect().catch((error) => {
    connectPromise = null;
    resetConnectionState();
    console.error('[QQ Gateway] Failed to connect:', error);
    throw error;
  });

  return await connectPromise;
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
  // 取消待执行的重连
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (globalConnection.ws) {
    globalConnection.ws.close();
  }

  connectPromise = null;
  savedCredentials = null;
  savedOnMessage = null;
  reconnectAttempt = 0;
  resetConnectionState();
}
