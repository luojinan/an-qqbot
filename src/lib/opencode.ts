/**
 * OpenCode LLM 客户端模块
 * 通过 opencode-proxy 与 LLM 交互，支持按用户隔离会话
 */

// 会话缓存：userId → sessionId
const sessionMap = new Map<string, string>();

// 运行时配置（直接写死默认值，避免模块热重载后丢失）
let proxyUrl = 'http://localhost:8080';
let modelProviderID = 'opencode';
let modelID = 'minimax-m2.5-free';

interface OpenCodeConfig {
  proxyUrl: string;
  modelProviderID?: string;
  modelID?: string;
}

export function initOpenCodeConfig(config: OpenCodeConfig): void {
  proxyUrl = config.proxyUrl.replace(/\/+$/, '');
  if (config.modelProviderID) modelProviderID = config.modelProviderID;
  if (config.modelID) modelID = config.modelID;
  console.log(`[opencode] Initialized: proxy=${proxyUrl}, model=${modelProviderID}/${modelID}`);
}

interface SessionResponse {
  id: string;
}

interface MessagePart {
  type: string;
  text?: string;
}

interface MessageResponse {
  parts?: MessagePart[];
}

async function createSession(): Promise<string> {
  if (!proxyUrl) {
    throw new Error('OpenCode proxy URL not configured. Call initOpenCodeConfig() first.');
  }
  const res = await fetch(`${proxyUrl}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create session: ${res.status} ${body}`);
  }

  const data = (await res.json()) as SessionResponse;
  return data.id;
}

async function getOrCreateSession(userId: string): Promise<string> {
  const existing = sessionMap.get(userId);
  if (existing) return existing;

  const sessionId = await createSession();
  sessionMap.set(userId, sessionId);
  console.log(`[opencode] Created session ${sessionId} for user ${userId}`);
  return sessionId;
}

function invalidateSession(userId: string): void {
  const sessionId = sessionMap.get(userId);
  if (sessionId) {
    sessionMap.delete(userId);
    console.log(`[opencode] Invalidated session ${sessionId} for user ${userId}`);
  }
}

async function postMessage(sessionId: string, text: string): Promise<string> {
  const res = await fetch(`${proxyUrl}/api/session/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: { providerID: modelProviderID, modelID: modelID },
      parts: [{ type: 'text', text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Message API error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as MessageResponse;
  const reply = (data.parts ?? [])
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text!)
    .join('\n');

  return reply || '[LLM 返回了空回复]';
}

/**
 * 发送消息到 LLM 并获取回复
 * 会话失效（404/400）时自动重建并重试一次
 */
export async function sendMessageToLLM(userId: string, text: string): Promise<string> {
  const sessionId = await getOrCreateSession(userId);

  try {
    return await postMessage(sessionId, text);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // 会话失效，重建后重试一次
    if (errMsg.includes('404') || errMsg.includes('400')) {
      console.warn(`[opencode] Session ${sessionId} invalid, rebuilding for user ${userId}`);
      invalidateSession(userId);
      const newSessionId = await getOrCreateSession(userId);
      return await postMessage(newSessionId, text);
    }

    throw err;
  }
}
