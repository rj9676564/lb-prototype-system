# 原型管理系统 (Prototype System)

这是一个前后端分离开发、单容器部署的全栈项目，提供项目原型的版本管理、预览和下载等功能。

## 项目结构

```text
.
├── frontend/             # 前端代码目录
│   ├── src/              # React 组件和页面代码
│   ├── package.json      # 前端依赖配置
│   ├── vite.config.ts    # Vite 构建配置
│   └── ...
├── backend/              # 后端代码目录
│   ├── main.go           # Go 主程序入口
│   ├── Dockerfile        # 单容器部署镜像（包含前端构建产物）
│   ├── pb_data/          # 数据库文件目录（如存在）
│   └── ...
└── .github/workflows/    # CI/CD 自动化构建配置
    └── backend.yml       # 后端 GitHub Actions
```

## 本地开发指南

### 前端开发

进入前端目录并启动开发服务器：

```bash
cd frontend
pnpm install
pnpm run dev
```

前端服务默认在本地端口（通常是 `http://localhost:5173`）启动。
开发模式下前端默认请求同主机的 `9000` 端口后端。
如需指定后端地址，可在启动前设置 `VITE_BACKEND_BASE_URL`，例如：

```bash
cd frontend
VITE_BACKEND_BASE_URL=http://127.0.0.1:9000 pnpm run dev
```

### 后端开发

进入后端目录并运行或构建 Go 项目：

```bash
cd backend
go run main.go
# 或
go build -o app
```

正式运行时支持以下环境变量：

```bash
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD=12345678
PROTOTYPE_SOURCE_DIR=/Users/laibin/Documents/shopkeeper
```

上面这组变量适用于直接运行二进制。

示例：

```bash
cd backend
DEFAULT_ADMIN_EMAIL=admin@example.com \
DEFAULT_ADMIN_PASSWORD=12345678 \
PROTOTYPE_SOURCE_DIR=/Users/laibin/Documents/shopkeeper \
./my-pb serve --http=127.0.0.1:9000 --dir=./pb_data
```

## 正式打包与部署

- 单容器运行时读取：
  - `DEFAULT_ADMIN_EMAIL`
  - `DEFAULT_ADMIN_PASSWORD`
  - `PROTOTYPE_SOURCE_DIR`

如果使用 Docker Compose，可以直接使用当前 shell 环境变量执行：

```bash
DEFAULT_ADMIN_EMAIL=admin@example.com \
DEFAULT_ADMIN_PASSWORD=12345678 \
HOST_PROTOTYPE_SOURCE_DIR=/Users/laibin/Documents/shopkeeper \
PB_DATA_DIR=./pb_data \
APP_PORT=9000 \
docker compose up --build -d
```

说明：

- `app` 是唯一需要部署的容器
- 容器内同时承载：
  - PocketBase API
  - 前端静态资源
  - 原型预览静态资源
- 生产环境前端默认走同源访问，即浏览器直接请求当前站点的 `/api/...`
- `docker-compose.yml` 中不会直接使用宿主机目录作为 `PROTOTYPE_SOURCE_DIR`
- 正确做法是把宿主机原型目录通过 `HOST_PROTOTYPE_SOURCE_DIR` 挂载到容器内 `/app/source-prototypes`
- 容器内实际生效的扫描目录固定为 `/app/source-prototypes`

环境变量示例：

```bash
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD=12345678
HOST_PROTOTYPE_SOURCE_DIR=/Users/laibin/Documents/shopkeeper
PB_DATA_DIR=./pb_data
APP_PORT=9000
```

其中：

- 直接运行后端二进制时，使用 `PROTOTYPE_SOURCE_DIR`
- 使用 `docker compose` 时，配置的是宿主机目录 `HOST_PROTOTYPE_SOURCE_DIR`
- Compose 会把它挂载到容器内固定路径 `/app/source-prototypes`，再由后端通过 `PROTOTYPE_SOURCE_DIR=/app/source-prototypes` 读取
- 生产部署时外部只需要关心一个访问入口，例如 `http://your-host:9000`

## CI/CD 自动化部署

本项目使用 GitHub Actions 进行自动化构建。
部署镜像统一由 `backend.yml` 构建，它会同时：

- 构建前端静态资源
- 构建后端二进制
- 打包成单个运行镜像

### 触发部署镜像构建

执行以下命令并推送到远程仓库，将自动启动 `backend.yml` 中定义的镜像构建任务：

```bash
# 构建对应的 tag 需要以 'b' 开头，如 b1.0.0
git tag b1.0.0
git push origin b1.0.0
```

## 技术栈引用

- **前端**: React, [@refinedev/core](https://refine.dev/), [@refinedev/antd](https://refine.dev/docs/ui-frameworks/antd/tutorial/), Ant Design, Vite
- **后端**: Go, [PocketBase](https://pocketbase.io/)
- **部署**: 单容器镜像，运行时由 PocketBase 提供 API 与静态页面
