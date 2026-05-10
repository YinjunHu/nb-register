# NB-Register Dashboard 外部 API 文档

> Dashboard 地址示例: `http://192.168.3.26:8080`

---

## 1. 获取邮箱列表

获取系统中已注册的邮箱列表，可按状态过滤。

```
GET /api/mailboxes?status=AVAILABLE&limit=200
```

### 参数（Query String）

| 参数     | 类型   | 必填 | 说明                                          |
| -------- | ------ | ---- | --------------------------------------------- |
| `status` | string | 否   | 过滤邮箱状态，如 `AVAILABLE`、`OAUTH_DONE` 等 |
| `limit`  | int    | 否   | 返回数量上限，默认 100                        |

### 响应

```json
[
  {
    "email_address": "alice@outlook.com",
    "password": "...",
    "refresh_token": "...",
    "access_token": "...",
    "status": "AVAILABLE",
    "last_error": "",
    "is_primary": true,
    "primary_email": "alice@outlook.com",
    "created_at": 1715000000,
    "updated_at": 1715000000
  }
]
```

### 调用示例

```bash
curl http://192.168.3.26:8080/api/mailboxes?status=AVAILABLE&limit=50
```

```javascript
// Node.js (axios)
const resp = await axios.get('http://192.168.3.26:8080/api/mailboxes', {
  params: { status: 'AVAILABLE', limit: 50 }
});
const mailboxes = resp.data; // Array
```

---

## 2. 等待验证码（长轮询）

向指定邮箱等待验证码邮件到达，服务端会持续轮询直到收到匹配邮件或超时。

```
POST /api/mailboxes/wait-otp
Content-Type: application/json
```

### 请求体

```json
{
  "email_address": "alice@outlook.com",
  "subject_keyword": "验证码",
  "timeout_seconds": 120
}
```

| 字段              | 类型   | 必填 | 说明                                     |
| ----------------- | ------ | ---- | ---------------------------------------- |
| `email_address`   | string | 是   | 目标邮箱地址                             |
| `subject_keyword` | string | 否   | 邮件主题关键词过滤，如 `OTP`、`验证码`   |
| `timeout_seconds` | int    | 否   | 超时秒数，默认 120，最大 600             |

### 响应

```json
{
  "found": true,
  "content_extracted": "123456"
}
```

| 字段                | 类型   | 说明                           |
| ------------------- | ------ | ------------------------------ |
| `found`             | bool   | 是否在超时前收到匹配邮件       |
| `content_extracted` | string | 提取到的验证码（未找到时为空） |

### 调用示例

```bash
curl -X POST http://192.168.3.26:8080/api/mailboxes/wait-otp \
  -H "Content-Type: application/json" \
  -d '{"email_address":"alice@outlook.com","subject_keyword":"验证码","timeout_seconds":120}'
```

```javascript
// Node.js (axios)
const resp = await axios.post('http://192.168.3.26:8080/api/mailboxes/wait-otp', {
  email_address: 'alice@outlook.com',
  subject_keyword: '验证码',
  timeout_seconds: 120
}, { timeout: 130000 }); // HTTP 超时要比 timeout_seconds 大
console.log(resp.data); // { found: true, content_extracted: '123456' }
```

> **注意**: 此接口为长轮询，HTTP 客户端的超时时间应设置为 `timeout_seconds + 10` 秒以上。

---

## 3. 批量注册控制

控制 Outlook 邮箱的批量注册流程。

### 3.1 查询注册进度

```
GET /api/mailboxes/register
```

**响应:**

```json
{
  "running": true,
  "total": 10,
  "done": 3,
  "remaining": 7,
  "continuous": false
}
```

| 字段         | 类型 | 说明                            |
| ------------ | ---- | ------------------------------- |
| `running`    | bool | 是否正在注册                    |
| `total`      | int  | 总数（持续模式为 -1）           |
| `done`       | int  | 已完成数                        |
| `remaining`  | int  | 剩余数（持续模式为 -1）         |
| `continuous` | bool | 是否为持续注册模式              |

### 3.2 启动批量注册

```
POST /api/mailboxes/register
Content-Type: application/json
```

**指定数量注册:**
```json
{"count": 10}
```

**持续注册（无限模式）:**
```json
{"continuous": true}
```

### 3.3 取消注册

```
POST /api/mailboxes/register
Content-Type: application/json

{"cancel": true}
```

---

## 4. 新增/更新邮箱

手动向系统添加或更新一个邮箱记录。

```
POST /api/mailboxes
Content-Type: application/json
```

### 请求体

```json
{
  "email": "alice@outlook.com",
  "password": "xxx",
  "refresh_token": "...",
  "access_token": "...",
  "status": "AVAILABLE",
  "last_error": ""
}
```

### 响应

返回更新后的邮箱对象。

---

## 5. 触发 OAuth 认证

为指定邮箱启动 OAuth 认证流程（获取 refresh_token / access_token）。

```
POST /api/mailboxes/oauth
Content-Type: application/json

{"email_address": "alice@outlook.com"}
```

### 响应

```json
{
  "started": true,
  "job_id": "job_xxx"
}
```

---

## 在 gpt-token-extractor 中使用

`gpt-token-extractor` 项目已内置 `NbRegisterClient`，通过设置环境变量即可调用上述 API：

```env
NB_REGISTER_URL=http://192.168.3.26:8080
```

### 内部 API 端点（gpt-token-extractor 代理）

| 端点                              | 方法 | 说明           |
| --------------------------------- | ---- | -------------- |
| `/api/nb-register/mailboxes`      | GET  | 获取邮箱列表   |
| `/api/nb-register/trigger-otp`    | POST | 预热邮箱       |
| `/api/nb-register/wait-otp`       | POST | 等待验证码     |

### 代码中直接调用

```javascript
const { NbRegisterClient } = require('./lib/nbRegisterClient');
const client = new NbRegisterClient({ nbRegisterUrl: 'http://192.168.3.26:8080' });

// 获取可用邮箱
const mailboxes = await client.listMailboxes({ status: 'AVAILABLE' });

// 等待验证码
const result = await client.waitForOTP('alice@outlook.com', {
  keyword: '验证码',
  timeout: 120
});
if (result.found) {
  console.log('验证码:', result.code);
}
```

---

## 错误处理

所有接口在出错时返回 HTTP 4xx/5xx，响应体：

```json
{
  "error": "错误描述"
}
```

常见状态码：
- **400** — 参数错误（缺少必填字段等）
- **405** — 方法不允许
- **502** — 后端服务（outlook-imap-service）不可达
