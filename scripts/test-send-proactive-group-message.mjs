const defaultBaseUrl = 'http://127.0.0.1:8787';

const baseUrl = (process.env.QQBOT_BASE_URL ?? defaultBaseUrl).replace(/\/$/, '');
const rawArgs = process.argv.slice(2);
const normalizedArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

let groupOpenid = process.env.QQBOT_TEST_GROUP_OPENID ?? '';
const messageParts = [];

for (const arg of normalizedArgs) {
  if (arg.startsWith('--to=')) {
    groupOpenid = arg.slice('--to='.length).trim();
    continue;
  }
  messageParts.push(arg);
}

if (!groupOpenid) {
  console.error('[test-send-group] missing group openid');
  console.error('Usage: QQBOT_TEST_GROUP_OPENID=<group_openid> pnpm run test:send:group');
  console.error('   or: pnpm run test:send:group -- --to=<group_openid> 你好，群测试');
  process.exit(1);
}

const timestamp = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  hour12: false,
  timeZone: 'Asia/Shanghai',
}).format(new Date());
const text = messageParts.join(' ').trim() || `群主动消息测试：${timestamp}`;

const requestBody = {
  to: groupOpenid,
  type: 'group',
  text,
};

console.log('[test-send-group] baseUrl:', baseUrl);
console.log('[test-send-group] target:', groupOpenid);
console.log('[test-send-group] text:', text);

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
  console.error('[test-send-group] send failed:', response.status, data);
  process.exit(1);
}

console.log('[test-send-group] send succeeded');
console.log(JSON.stringify(data, null, 2));
