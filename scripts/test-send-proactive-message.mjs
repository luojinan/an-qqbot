const defaultBaseUrl = 'http://127.0.0.1:8787';
const defaultTargetOpenid = '3B9BD5DA734EB4CC832850A92CFA415A';

const baseUrl = (process.env.QQBOT_BASE_URL ?? defaultBaseUrl).replace(/\/$/, '');
const targetOpenid = process.env.QQBOT_TEST_USER_OPENID ?? defaultTargetOpenid;
const rawArgs = process.argv.slice(2);
const messageArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const customText = messageArgs.join(' ').trim();
const timestamp = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  hour12: false,
  timeZone: 'Asia/Shanghai',
}).format(new Date());
const text = customText || `主动消息测试：${timestamp}`;

const requestBody = {
  to: targetOpenid,
  type: 'c2c',
  text,
};

console.log('[test-send] baseUrl:', baseUrl);
console.log('[test-send] target:', targetOpenid);
console.log('[test-send] text:', text);

const response = await fetch(`${baseUrl}/qq/send/text`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(requestBody),
});

const responseText = await response.text();
let data;
try {
  data = JSON.parse(responseText);
} catch {
  data = responseText;
}

if (!response.ok) {
  console.error('[test-send] send failed:', response.status, data);
  process.exit(1);
}

console.log('[test-send] send succeeded');
console.log(JSON.stringify(data, null, 2));
