import { Hono } from 'hono';
import {
  getAccessToken,
  sendProactiveC2CMessage,
  sendProactiveGroupMessage,
  sendC2CMessage,
  sendGroupMessage,
  sendC2CImageMessage,
  sendGroupImageMessage,
  sendC2CFileMessage,
  sendGroupFileMessage,
  sendC2CVoiceMessage,
  sendGroupVoiceMessage,
  sendC2CVideoMessage,
  sendGroupVideoMessage,
  sendC2CInputNotify,
} from './lib/api';

type Bindings = {
  QQBOT_APP_ID: string;
  QQBOT_CLIENT_SECRET: string;
};

const qqRoutes = new Hono<{ Bindings: Bindings }>();

// 发送文本消息（主动消息）
qqRoutes.post('/send/text', async (c) => {
  const { to, type, text } = await c.req.json();

  if (!to || !type || !text) {
    return c.json({ error: 'Missing required fields: to, type, text' }, 400);
  }

  const appId = c.env.QQBOT_APP_ID;
  const clientSecret = c.env.QQBOT_CLIENT_SECRET;
  const token = await getAccessToken(appId, clientSecret);

  let result;
  if (type === 'c2c') {
    result = await sendProactiveC2CMessage(token, to, text);
  } else if (type === 'group') {
    result = await sendProactiveGroupMessage(token, to, text);
  } else {
    return c.json({ error: 'Invalid type, must be "c2c" or "group"' }, 400);
  }

  return c.json(result);
});

// 回复消息（被动回复）
qqRoutes.post('/reply', async (c) => {
  const { to, type, text, msgId } = await c.req.json();

  if (!to || !type || !text || !msgId) {
    return c.json({ error: 'Missing required fields: to, type, text, msgId' }, 400);
  }

  const appId = c.env.QQBOT_APP_ID;
  const clientSecret = c.env.QQBOT_CLIENT_SECRET;
  const token = await getAccessToken(appId, clientSecret);

  let result;
  if (type === 'c2c') {
    result = await sendC2CMessage(token, to, text, msgId);
  } else if (type === 'group') {
    result = await sendGroupMessage(token, to, text, msgId);
  } else {
    return c.json({ error: 'Invalid type, must be "c2c" or "group"' }, 400);
  }

  return c.json(result);
});

// 发送图片消息
qqRoutes.post('/send/image', async (c) => {
  const { to, type, imageUrl } = await c.req.json();

  if (!to || !type || !imageUrl) {
    return c.json({ error: 'Missing required fields: to, type, imageUrl' }, 400);
  }

  const appId = c.env.QQBOT_APP_ID;
  const clientSecret = c.env.QQBOT_CLIENT_SECRET;
  const token = await getAccessToken(appId, clientSecret);

  let result;
  if (type === 'c2c') {
    result = await sendC2CImageMessage(token, to, imageUrl);
  } else if (type === 'group') {
    result = await sendGroupImageMessage(token, to, imageUrl);
  } else {
    return c.json({ error: 'Invalid type, must be "c2c" or "group"' }, 400);
  }

  return c.json(result);
});

// 发送文件消息
qqRoutes.post('/send/file', async (c) => {
  const { to, type, fileUrl, fileBase64, fileName } = await c.req.json();

  if (!to || !type || (!fileUrl && !fileBase64) || !fileName) {
    return c.json({ error: 'Missing required fields: to, type, (fileUrl or fileBase64), fileName' }, 400);
  }

  const appId = c.env.QQBOT_APP_ID;
  const clientSecret = c.env.QQBOT_CLIENT_SECRET;
  const token = await getAccessToken(appId, clientSecret);

  const fileData = fileUrl || fileBase64;
  let result;
  if (type === 'c2c') {
    result = await sendC2CFileMessage(token, to, fileData, fileName);
  } else if (type === 'group') {
    result = await sendGroupFileMessage(token, to, fileData, fileName);
  } else {
    return c.json({ error: 'Invalid type, must be "c2c" or "group"' }, 400);
  }

  return c.json(result);
});

// 发送语音消息
qqRoutes.post('/send/voice', async (c) => {
  const { to, type, voiceBase64 } = await c.req.json();

  if (!to || !type || !voiceBase64) {
    return c.json({ error: 'Missing required fields: to, type, voiceBase64' }, 400);
  }

  const appId = c.env.QQBOT_APP_ID;
  const clientSecret = c.env.QQBOT_CLIENT_SECRET;
  const token = await getAccessToken(appId, clientSecret);

  let result;
  if (type === 'c2c') {
    result = await sendC2CVoiceMessage(token, to, voiceBase64);
  } else if (type === 'group') {
    result = await sendGroupVoiceMessage(token, to, voiceBase64);
  } else {
    return c.json({ error: 'Invalid type, must be "c2c" or "group"' }, 400);
  }

  return c.json(result);
});

// 发送视频消息
qqRoutes.post('/send/video', async (c) => {
  const { to, type, videoUrl, videoBase64 } = await c.req.json();

  if (!to || !type || (!videoUrl && !videoBase64)) {
    return c.json({ error: 'Missing required fields: to, type, (videoUrl or videoBase64)' }, 400);
  }

  const appId = c.env.QQBOT_APP_ID;
  const clientSecret = c.env.QQBOT_CLIENT_SECRET;
  const token = await getAccessToken(appId, clientSecret);

  const videoData = videoUrl || videoBase64;
  let result;
  if (type === 'c2c') {
    result = await sendC2CVideoMessage(token, to, videoData);
  } else if (type === 'group') {
    result = await sendGroupVideoMessage(token, to, videoData);
  } else {
    return c.json({ error: 'Invalid type, must be "c2c" or "group"' }, 400);
  }

  return c.json(result);
});

// 发送输入状态
qqRoutes.post('/typing', async (c) => {
  const { to } = await c.req.json();

  if (!to) {
    return c.json({ error: 'Missing required field: to' }, 400);
  }

  const appId = c.env.QQBOT_APP_ID;
  const clientSecret = c.env.QQBOT_CLIENT_SECRET;
  const token = await getAccessToken(appId, clientSecret);

  const result = await sendC2CInputNotify(token, to);
  return c.json(result);
});

export default qqRoutes;
