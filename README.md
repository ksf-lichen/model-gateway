# 康师傅 · 企业模型网关（本地可运行）

基于控制台原型的 **MVP 可调用网关**：签发 API Key 后，可直接调用个人/应用入口；源未配置上游凭证时走 Mock，配置了 OpenAI 兼容 Base URL + API Key 则真实转发。

## 端口

| 服务 | 地址 |
|------|------|
| 控制台 | http://127.0.0.1:8765 |
| 网关 · 生产 | http://127.0.0.1:8787 |
| 网关 · 测试 | http://127.0.0.1:8788 |

Admin API 默认令牌：`local-dev-token`（请求头 `X-Admin-Token`）。可在 `server/.env` 覆盖，参见 `server/.env.example`。

## 一键启动

```powershell
cd D:\Project_folder\模型网关
.\start-gateway.ps1
```

或分别启动：

```powershell
# 控制台
cd D:\Project_folder\模型网关\dist
python -m http.server 8765 --bind 127.0.0.1

# 网关（同进程监听 8787 + 8788）
cd D:\Project_folder\模型网关\server
python app.py
```

依赖：`flask`、`httpx`（可用 `pip install -r server/requirements.txt`）。

## 验收路径

### 1）控制台签发

1. 打开 http://127.0.0.1:8765  
2. 默认已有网关侧服务 `demo-chat`（刷新后会从网关同步）  
3. **签发 API Key** → 开通应用 Key → 复制明文与 curl  

### 2）curl 调用（Mock）

```powershell
# 先签发一把应用 Key（或用 Admin API）
$TOKEN = "local-dev-token"
$created = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/admin/keys `
  -Headers @{ "X-Admin-Token" = $TOKEN; "Content-Type" = "application/json" } `
  -Body '{"keyKind":"app","name":"smoke-app","serviceRefs":["svc-demo-chat"]}'
$KEY = $created.plaintext
$KEY

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/app/v1/chat/completions `
  -Headers @{ Authorization = "Bearer $KEY"; "Content-Type" = "application/json" } `
  -Body '{"model":"demo-chat","messages":[{"role":"user","content":"你好"}]}'
```

返回体中 `gateway.mode` 为 `mock` 即表示 Mock 上游。

### 3）真实上游

在「源模型能力接入」填写真实 **Base URL** 与 **上游 API Key**（例如 DeepSeek `https://api.deepseek.com/v1`），再调用同一把 Key；`gateway.mode` 变为 `upstream`。

个人入口示例：

```http
POST /personal/v1/chat/completions
Host: 127.0.0.1:8787
Authorization: Bearer <个人_API_Key>
X-User-Id: u_demo
Content-Type: application/json

{"model":"demo-chat","messages":[{"role":"user","content":"你好"}]}
```

## 云部署（单端口：控制台 + 网关）

本地双端口（8765 / 8787 / 8788）在云上会合并为平台分配的一个 `PORT`。

### Render（推荐免费试用）

1. 打开：[Deploy to Render](https://render.com/deploy?repo=https://github.com/ksf-lichen/model-gateway)
2. 使用 GitHub 登录并授权本仓库
3. 按 `render.yaml` 创建 Web Service，部署完成后得到公网 URL

手动创建时：
- Build：`pip install -r server/requirements.txt gunicorn`
- Start：`cd server && gunicorn -b 0.0.0.0:$PORT -w 2 --threads 4 cloud_app:app`
- 环境变量：`GATEWAY_ENV=prod`，`ADMIN_TOKEN`（自设）

### Docker

```bash
docker build -t model-gateway .
docker run -p 8787:8787 -e ADMIN_TOKEN=local-dev-token model-gateway
```

## 目录

- `dist/` — 控制台静态页  
- `server/` — 网关 + Admin API（JSON 持久化于 `server/data/store.json`）  
- `server/cloud_app.py` — 云上单端口入口（静态页 + API）  
- `start-gateway.ps1` — 一键启动脚本  
- `Dockerfile` / `render.yaml` / `Procfile` — 云部署配置  

