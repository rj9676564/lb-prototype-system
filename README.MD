# 原型管理系统

这是一个前后端分离开发、单容器部署的原型管理系统，提供项目管理、版本预览、下载，以及按目录扫描导入原型项目的能力。

## 项目结构

```text
.
├── frontend/             # React + Vite 前端
├── backend/              # Go + PocketBase 后端
│   ├── main.go
│   ├── migrations/
│   └── Dockerfile        # 单容器镜像，构建前端并打包后端
├── docker-compose.yml    # 单容器部署示例
└── .github/workflows/
    └── backend.yml       # 镜像发布流程
```

## 核心说明

- 开发模式下，前后端仍然分开运行。
- 部署模式下，只需要一个容器、一个端口。
- 容器内同时提供：
  - PocketBase API
  - 前端静态页面
  - 原型预览静态资源
- 原型扫描目录支持通过环境变量配置。
- 项目和版本支持从目录自动扫描导入；当前策略是每个项目自动关联一个固定版本。

## 缓存与更新机制

为了在**极致的加载速度**与**内容实时更新**之间取得平衡，系统在 `v1.0.15` 版本中引入了**智能协商缓存**与**动态版本号击穿**机制：

1. **后端协商缓存 (HTTP 304)**：
   - 系统对原型静态资源（包括 `/linked-projects/...` 和 `/projects/...` 目录下的所有文件）统一注入了 `Cache-Control: no-cache, must-revalidate` 响应头。
   - 浏览器被允许在本地存放原型缓存以实现“秒开”，但每次加载前必须向后端发送轻量验证请求。对于未修改的资源（如 Axure 原型中 99% 的未改动 JS/CSS/图片），后端直接返回 `304 Not Modified` 瞬间载入，极大节省了服务器带宽并提升了速度。

2. **前端动态版本号击穿 (Version Cache Buster)**：
   - 预览原型时，前端会自动将原型记录在数据库中的最后更新时间（`updated` 时间戳）作为查询参数附加在预览 URL 后（形如 `?v=updatedTime`）。
   - **按需更新**：当您点击**“手动扫描”**或重新上传 ZIP 包更新版本时，数据库中该原型的 `updated` 字段自动更新，预览 URL 发生改变，从而自动击穿浏览器的强缓存，拉取全新内容，免去了用户手动清理缓存或强制刷新的麻烦。

3. **解包物理清理 (Stale File Cleanup)**：
   - 当重新上传 ZIP 原型包覆盖现有版本时，后端在解包前会自动物理清空该版本的解压文件夹，彻底清除旧版本遗留的历史脏文件，保证物理目录与最新的原型包完全一致。

## 本地开发

### 前端

```bash
cd frontend
pnpm install
pnpm dev
```

- 默认开发地址通常是 `http://localhost:5173`
- 开发模式下前端默认请求同主机的 `9000` 端口
- 如需手动指定后端地址：

```bash
cd frontend
VITE_BACKEND_BASE_URL=http://127.0.0.1:9000 pnpm dev
```

### 后端

```bash
cd backend
go build -o my-pb .
```

直接运行示例：

```bash
cd backend
DEFAULT_ADMIN_EMAIL=admin@example.com \
DEFAULT_ADMIN_PASSWORD=12345678 \
PROTOTYPE_SOURCE_DIR=/Users/laibin/Documents/shopkeeper \
./my-pb serve --http=127.0.0.1:9000 --dir=./pb_data
```

说明：

- `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` 用于初始化默认管理员和默认业务用户
- `PROTOTYPE_SOURCE_DIR` 是后端实际扫描的目录
- 表结构会通过 PocketBase migrations 自动初始化

## 单容器部署

部署时推荐直接使用已发布镜像，不需要再单独部署前端容器。

### 推荐方式：直接拉取镜像

```yaml
version: '3.8'

services:
  app:
    image: ghcr.io/rj9676564/lb-prototype-system-backend:1.0.8
    container_name: prototype-app
    restart: unless-stopped
    ports:
      - "23200:9000"
    environment:
      DEFAULT_ADMIN_EMAIL: admin@example.com
      DEFAULT_ADMIN_PASSWORD: 12345678
      PROTOTYPE_SOURCE_DIR: /app/source-prototypes
    volumes:
      - ./pb_data:/app/pb_data
      - /tmp/zfsv3/nvme11/18126010730/data/company/demand:/app/source-prototypes:ro
```

启动：

```bash
docker compose up -d
```

访问地址：

```text
http://<宿主机IP>:23200
```

说明：

- 外部只需要暴露一个端口
- 容器内部服务端口固定是 `9000`
- 宿主机原型目录挂载到容器内 `/app/source-prototypes`
- 容器内真正生效的 `PROTOTYPE_SOURCE_DIR` 应写成 `/app/source-prototypes`

### 可选方式：本机构建

如果你不是拉镜像，而是在目标机器本地构建，那么必须把完整仓库放到机器上，并从仓库根目录构建。

原因：

- 单容器 Dockerfile 会同时 `COPY frontend/` 和 `COPY backend/`
- 所以 `build.context` 必须是仓库根目录 `.`
- 不能再使用旧的 `context: ./backend` 写法

示例：

```yaml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: backend/Dockerfile
    container_name: prototype-app
    restart: unless-stopped
    ports:
      - "23200:9000"
    environment:
      DEFAULT_ADMIN_EMAIL: admin@example.com
      DEFAULT_ADMIN_PASSWORD: 12345678
      PROTOTYPE_SOURCE_DIR: /app/source-prototypes
    volumes:
      - ./pb_data:/app/pb_data
      - /tmp/zfsv3/nvme11/18126010730/data/company/demand:/app/source-prototypes:ro
```

## 环境变量

直接运行二进制时：

- `DEFAULT_ADMIN_EMAIL`
- `DEFAULT_ADMIN_PASSWORD`
- `PROTOTYPE_SOURCE_DIR`

使用 Docker Compose 时：

- `DEFAULT_ADMIN_EMAIL`
- `DEFAULT_ADMIN_PASSWORD`
- 容器内 `PROTOTYPE_SOURCE_DIR` 固定建议写 `/app/source-prototypes`
- 宿主机真实目录通过 volume 挂载到 `/app/source-prototypes`

## ARM / NAS 说明

- 当前单容器镜像已按 `linux/amd64` 和 `linux/arm64` 发布
- ARM 设备建议优先使用官方 GHCR 镜像
- 如果镜像代理站拉不到 tag 或 manifest，不代表官方 GHCR 没有该镜像
- 遇到代理同步问题时，优先测试：

```bash
docker pull ghcr.io/rj9676564/lb-prototype-system-backend:1.0.8
```

## CI/CD

镜像由 `.github/workflows/backend.yml` 统一构建并发布。

发布逻辑：

- 构建前端静态资源
- 构建后端二进制
- 打包为单个运行镜像
- 发布 `amd64` 和 `arm64` 多架构镜像

触发发布：

```bash
git tag b1.0.8
git push origin b1.0.8
```

说明：

- Git tag 以 `b` 开头
- 例如仓库 tag 是 `b1.0.8`
- 最终镜像 tag 会发布为 `1.0.8`

## 技术栈

- 前端：React、Refine、Ant Design、Vite
- 后端：Go、PocketBase
- 部署：单容器镜像，由 PocketBase 提供 API 和静态资源
