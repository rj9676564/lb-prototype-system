# 原型管理系统 (Prototype System)

这是一个分为前端（React + Refine + Ant Design）和后端（基于 PocketBase 等构建的 Go 服务）的全栈项目，提供项目原型的版本管理、预览和下载等功能。

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
│   ├── Dockerfile        # 容器化部署配置
│   ├── pb_data/          # 数据库文件目录（如存在）
│   └── ...
└── .github/workflows/    # CI/CD 自动化构建配置
    ├── frontend.yml      # 前端 GitHub Actions
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

- 后端运行时读取：
  - `DEFAULT_ADMIN_EMAIL`
  - `DEFAULT_ADMIN_PASSWORD`
  - `PROTOTYPE_SOURCE_DIR`
- 前端构建时读取：
  - `VITE_BACKEND_BASE_URL`

如果使用 Docker Compose，可以直接使用当前 shell 环境变量执行：

```bash
DEFAULT_ADMIN_EMAIL=admin@example.com \
DEFAULT_ADMIN_PASSWORD=12345678 \
HOST_PROTOTYPE_SOURCE_DIR=/Users/laibin/Documents/shopkeeper \
PB_DATA_DIR=./pb_data \
BACKEND_PORT=9000 \
FRONTEND_PORT=3000 \
VITE_BACKEND_BASE_URL=http://127.0.0.1:9000 \
docker compose up --build -d
```

说明：

- `backend` 会在容器运行时读取 `DEFAULT_ADMIN_EMAIL`、`DEFAULT_ADMIN_PASSWORD`、`PROTOTYPE_SOURCE_DIR`
- `frontend` 会在镜像构建时读取 `VITE_BACKEND_BASE_URL`
- 如果修改了 `VITE_BACKEND_BASE_URL`，需要重新构建前端镜像，即再次执行 `docker compose up --build -d`
- `docker-compose.yml` 中不会直接使用宿主机目录作为 `PROTOTYPE_SOURCE_DIR`
- 正确做法是把宿主机原型目录通过 `HOST_PROTOTYPE_SOURCE_DIR` 挂载到容器内 `/app/source-prototypes`
- 容器内实际生效的扫描目录固定为 `/app/source-prototypes`

环境变量示例：

```bash
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD=12345678
HOST_PROTOTYPE_SOURCE_DIR=/Users/laibin/Documents/shopkeeper
PB_DATA_DIR=./pb_data
BACKEND_PORT=9000
FRONTEND_PORT=3000
VITE_BACKEND_BASE_URL=http://127.0.0.1:9000
```

其中：

- 直接运行后端二进制时，使用 `PROTOTYPE_SOURCE_DIR`
- 使用 `docker compose` 时，配置的是宿主机目录 `HOST_PROTOTYPE_SOURCE_DIR`
- Compose 会把它挂载到容器内固定路径 `/app/source-prototypes`，再由后端通过 `PROTOTYPE_SOURCE_DIR=/app/source-prototypes` 读取

## CI/CD 自动化部署

本项目使用 GitHub Actions 进行自动化构建。构建任务被分离为前端和后端两部分，通过在推送时打上特定的 Tag 触发对应的工作流。

### 触发前端构建

执行以下命令并推送到远程仓库，将自动启动 `frontend.yml` 中定义的依赖缓存和构建任务：

```bash
# 构建对应的 tag 需要以 'f' 开头，如 f1.0.0
git tag f1.0.0
git push origin f1.0.0
```

### 触发后端构建

执行以下命令并推送到远程仓库，将自动启动 `backend.yml` 中定义的 Go 编译和打包任务：

```bash
# 构建对应的 tag 需要以 'b' 开头，如 b1.0.0
git tag b1.0.0
git push origin b1.0.0
```

## 技术栈引用

- **前端**: React, [@refinedev/core](https://refine.dev/), [@refinedev/antd](https://refine.dev/docs/ui-frameworks/antd/tutorial/), Ant Design, Vite
- **后端**: Go, [PocketBase](https://pocketbase.io/)
