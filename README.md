# 年轮 Nianlun

[![CI](https://github.com/GaoAB1/nianlun/actions/workflows/ci.yml/badge.svg)](https://github.com/GaoAB1/nianlun/actions/workflows/ci.yml)
[![Docker Image](https://img.shields.io/badge/ghcr.io-gaoab1%2Fnianlun-5B9BF3)](https://github.com/GaoAB1/nianlun/pkgs/container/nianlun)

> 一圈一圈，把日子记下来。
> 打卡与记录的个人生活数据库 —— 零依赖 Node + SQLite，Docker 一键部署。

**年轮**参考 [NoteMark](../notemark-analysis/index.html) 的功能与界面语言重写实现：同一个「模板引擎」同时承载打卡与记录，用点阵热力图、圆点日历、环形进度和数据洞察把时间摊开来看。

---

## 功能

| 模块 | 说明 |
| --- | --- |
| 用户管理 | 首次启动**强制**创建管理员；scrypt 加盐哈希 + HttpOnly Cookie 会话；管理员可添加成员、禁用、改角色、重置密码 |
| 记录模板 | 自由组合字段：文字 / 数字 / 选项 / 评分 / 图片；图标、颜色、emoji、分组、周期目标 |
| 打卡与记录 | 一次点击完成打卡；多字段模板弹出表单；支持**补打卡**（任选过去日期） |
| 计时器 | 刻度圆环计时，可选目标时长（5/15/25/45/60 分钟），结束后时长自动写入记录 |
| 时间线 | 按天分组的记录流，支持关键词搜索、标签筛选、日期范围、分页加载 |
| 数据洞察 | 时间分配环形图、记录趋势折线图、年度热力图、标签统计（跨模板聚合） |
| 标签与分组 | 记录打标签、模板进分组，标签可跨模板聚合统计 |
| 深色模式 | 浅色 / 深色 / 跟随系统；每周起始日可设周一或周日 |
| 数据自主 | 全部数据存本地 SQLite；一键导出 JSON 备份，支持合并或覆盖导入 |
| 多端适配 | 移动端底部纯图标导航，桌面端侧边栏，同一套界面 |

每个人的数据完全隔离：成员之间互不可见。

## 界面

截图见 [`docs/screenshots/`](docs/screenshots/)，由真实浏览器端到端测试自动生成。

设计语言沿用 NoteMark 的六个范式：点阵热力图、三指标数据行（次数/天数/连续）、环形进度与圆环计时、圆点日历、顶部胶囊分组标签 + 底部纯图标导航、卡片即入口。主色长春花蓝 `#5B9BF3`，强调色琥珀 `#F5A623`。

## 技术栈

- **后端**：Node.js 内置模块（`http` / `node:sqlite` / `crypto.scrypt`）—— **没有任何 npm 依赖**，不需要 `npm install`
- **前端**：原生 ES Module + CSS 变量，无框架、无构建步骤
- **数据库**：SQLite（WAL 模式，外键约束开启），文件在数据目录内
- **部署**：Docker 多层镜像（`node:24-alpine`，非 root 运行，自带健康检查）

> `node:sqlite` 在 Node 22.5–23.3 需要 `--experimental-sqlite`，23.4+ 已默认可用。
> `bin/nianlun.mjs` 会按当前 Node 版本自动附加参数，两种环境都能直接跑。

## 快速开始（Docker）

### 方式一：直接拉取现成镜像

镜像由 GitHub Actions 在每次推送时自动构建并推送到 GHCR（已通过容器内健康检查）：

```bash
mkdir -p data

docker run -d --name nianlun \
  --restart unless-stopped \
  -p 8080:8080 \
  -e TZ=Asia/Shanghai \
  -v "$(pwd)/data:/data" \
  ghcr.io/gaoab1/nianlun:latest
```

也可以用 `docker compose up -d`（默认走 `build:` 本地构建，把 `image:` 那行的注释切换一下即可改成拉取远端镜像）。

### 方式二：本地构建

```bash
# 1. 准备数据目录（容器内以 uid 1000 运行，需要写权限）
mkdir -p data && chown -R 1000:1000 data   # Windows / 群晖可跳过 chown

# 2. 构建并启动
docker compose up -d --build

# 3. 打开浏览器
#    http://localhost:8080
```

首次打开会强制进入「创建管理员」向导，完成初始化后才能使用任何功能。
端口、站点名、时区都在 `docker-compose.yml` 的 `environment` 里改。

数据持久化在 `./data`（SQLite 库 + 上传的图片）。备份 = 备份这个目录，或者用「设置 → 数据 → 导出」。

### 群晖 / QNAP

把 `docker-compose.yml` 里的卷映射改成绝对路径即可：

```yaml
volumes:
  - /volume1/docker/nianlun/data:/data
```

配了 HTTPS 反向代理（Nginx / Caddy / 群晖反代）后，打开 `COOKIE_SECURE: "1"`，会话 Cookie 将只在加密连接上传输。

## 本地运行（不用 Docker）

```bash
npm start        # 自动处理 node:sqlite 的版本差异
npm run serve    # 直接跑 server.js（Node 23.4+ 或加 --experimental-sqlite）
```

需要 Node.js 22.5.0 或更高版本。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `/data` | SQLite 与上传图片目录 |
| `SITE_NAME` | `年轮` | 站点名称（管理员也可在设置里改） |
| `PUID` / `PGID` | `1000` / `1000` | 容器内运行身份，入口脚本会把数据目录属主自动修正成它 |
| `COOKIE_SECURE` | 未设置 | 设为 `1` 时 Cookie 仅经 HTTPS 传输 |

## 测试

```bash
npm test         # 22 项接口集成测试（初始化 / 鉴权 / 权限 / 模板 / 记录 / 统计 / 导入导出）
npm run test:smoke   # 静态资源与图标 sprite 完整性
npm run test:ui      # 真实浏览器端到端：需要本机装有 Chrome 或 Edge
npm run test:all
```

`test:ui` 会启动服务与 headless Chrome，完整走一遍「初始化向导 → 打卡 → 各页面渲染 → 深色模式 → 桌面布局」，并顺便把截图写入 `docs/screenshots/`。

## 目录结构

```
nianlun/
├── server.js              HTTP 服务与路由表
├── bin/nianlun.mjs        版本感知启动器
├── src/
│   ├── db.js              schema 与查询封装
│   ├── auth.js            scrypt 哈希、会话、权限
│   ├── http.js            Cookie / 请求体 / 静态资源 / 错误
│   ├── dates.js           日键与周期区间计算
│   ├── seed.js            预设模板（降低起步门槛）
│   └── api/
│       ├── auth.js        初始化、登录、用户管理、站点设置
│       ├── data.js        分组 / 模板 / 记录 / 标签 / 上传
│       └── stats.js       概览 / 热力图 / 分布 / 趋势 / 导入导出
├── public/
│   ├── index.html         外壳 + 内联 SVG 图标 sprite
│   ├── css/app.css        设计令牌、主题、组件
│   └── js/                原生 ESM 视图与组件
├── tests/                 集成测试 / 冒烟测试 / 浏览器端到端
├── Dockerfile
└── docker-compose.yml
```

## 安全设计

- 密码使用 `scrypt`（N=16384, r=8, p=1）加盐哈希，比对用 `timingSafeEqual`
- 会话 token 为 32 字节随机数，HttpOnly + SameSite=Lax，30 天过期，每小时清理
- 未初始化前所有业务接口返回 `428 SETUP_REQUIRED`；写操作校验 `Origin` 防跨站
- 登录失败按 IP + 用户名限流（10 分钟 8 次）
- 越权访问按 `user_id` 严格隔离；管理员数量不会被降到最后一个
- 图片上传走 base64 白名单校验 + 前端压缩，路径不可穿越

## 常见问题

**启动时报 `EACCES` / `SQLITE_CANTOPEN`，容器反复重启**
v1.0.1 起已自动处理：入口脚本以 root 启动，把数据目录属主修正为 `PUID:PGID` 后降权运行，宿主机目录被 Docker 以 root 创建也能正常工作，**不需要手动 chown**。
如果升级旧镜像后仍报错，确认拉的是 `ghcr.io/gaoab1/nianlun:latest`（或 ≥1.0.1）；仍不行时看日志末尾，脚本会明确指出是只读挂载还是属主问题。手动兜底：`chown -R 1000:1000 <宿主机数据目录>`。

**忘记管理员密码**
删除 `data/nianlun.db` 会连数据一起丢。更稳妥：用另一个管理员账号在「设置 → 用户与权限」里重置；只有一名管理员时，可以临时把 `data/nianlun.db` 用 SQLite 工具打开，删除 `sessions` 表中该用户的记录后重设 `password_hash`。

**想换端口**
改 `docker-compose.yml` 里 `ports` 的左边那个数字即可。

---

数据在你自己的机器上。这是它最重要的设计。
