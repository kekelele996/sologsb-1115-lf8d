# 昆虫标本采集记录台（gbinsectlog）

面向野外昆虫调查队与标本馆技术员，把「标本采集 → 采集地与生境 → 鉴定状态 → 保藏位置」串成一条可追溯的编目链路，解决采集标签手写易错、鉴定进度无人跟踪、标本入柜后找不到位置的问题。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21815>

常用命令：

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地，不受影响）
```

端口与项目名可在 `.env` 中调整：

```
COMPOSE_PROJECT_NAME=gbinsectlog
FRONTEND_PORT=21815
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 |
| 语言 | TypeScript（`tsc --noEmit` 类型检查零错误） |
| 样式 | Tailwind CSS 3 |
| 状态管理 | Zustand |
| 路由 | React Router 6（nginx `try_files` 回落，支持直接刷新子路由） |
| 构建 | Vite 5 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21815
npm run build      # 类型检查 + 生产构建
```

> 本地开发无需任何后端服务或环境变量。

## 四、目录结构

```
sologsb-1115/
├── docker-compose.yml          # 顶层 name: gbinsectlog，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── tailwind.config.js / postcss.config.js
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # specimen.ts / site.ts / storage.ts / determination.ts / range.ts / index.ts
│       ├── stores/             # specimenStore / siteStore / storageStore / determinationStore / numberRangeStore（Zustand）
│       ├── components/common/  # SpecimenCard / StatusTag / CabinetGrid / SitePicker
│       ├── hooks/              # usePersistentStore / useSpecimenFilter
│       ├── pages/              # SpecimensPage / SitesPage / CollectPage / RangesPage / DeterminationPage / StoragePage
│       ├── router/index.tsx
│       └── utils/              # codec.ts / range.ts / export.ts / id.ts
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Specimen 标本 | 编号、目/科/属/种、暂定名、采集日期与人、性别虫态、体长、采集方式、数量、鉴定状态 | `specimens` |
| CollectSite 采集地 | 代码、名称、行政区、经纬度海拔、生境类型、小生境、微气候、采集日期区间 | `sites` |
| Storage 保藏位置 | 保藏方式、柜/抽屉/盒/插位序号、入柜日期、经手人 | `storages` |
| Determination 鉴定记录 | 鉴定人、日期、结论（学名）、依据文献、置信度、是否需复核 | `determinations` |
| NumberRange 号段 | 采集地代码 + 年份、流水号区间（起/止）、领用队、状态（在用/已报回/历史段）、发段与报回日期、本趟用掉的流水号 | `numberRanges` |

- 数据库名 `gbinsectlog`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史标本补齐默认采集方式（扫网）；
- `version(3)` 升级新增「号段台账」表，并按存量标本编号把用过的号补成历史段（同采集地 + 年份归为一段，区间取现成编号的最小 ~ 最大流水号）；
- 标本编号规则：`采集地代码-年份-流水号`（如 `QLB-2026-0007`）。编号不再按库里最大号接着编，而是标本馆按「采集地 + 年份」发段，野外队在段内往下取号，回馆后按用掉的编号报回对账；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/specimens` | 标本清单：按目/科、鉴定状态、采集地、采集日期区间与关键字组合筛选，多选批量推进鉴定状态，导出命中清单 |
| `/collect` | 采集登记：选择采集地后自动带出生境/小生境/微气候，一次提交多条同批次标本；编号从本队在用号段内自动分配，段满或无段时阻止提交 |
| `/ranges` | 号段台账：标本馆按采集地 + 年份发段（新段接在同地同年最大号之后，重叠拒绝）；野外队回馆报回用量，超本段上限或与别的队手里的段搭上则整趟退回、号段不动 |
| `/sites` | 采集地管理：经纬度格式校验、各地采集次数统计、50 米内邻近采集地提示与一键合并 |
| `/determination` | 鉴定工作流：待鉴定队列逐条处理，落鉴定记录并自动推进标本状态（已鉴定 / 待复核） |
| `/storage` | 保藏柜位图：柜-抽屉-盒-位三级展开，空位/占用一目了然，拖拽入柜，重复占用给出占用提示 |

## 七、业务约定

- 采集地代码是标本编号前缀，代码重复会被拒绝；
- 编号走号段台账：标本馆按「采集地 + 年份」发段，野外队在段内往下取号；同地同年的新段接在已有号段最大号之后，区间重叠发不出段；
- 报回对账时，用量超出本段上限（或低于段起始号）、或编号落在别的队手里的段内，整趟报回退回，馆里号段状态与用量不跟着动；对账通过后号段置为「已报回」并登记实际用掉的流水号；
- 升级到 v3 时按存量标本编号补建历史段（状态「历史段」，领用队「历史数据」）；
- 坐标 50 米内视为同一采集地，页面上给出合并提示，合并会把原采集地标本自动改挂；
- 鉴定记录提交后自动把标本状态推进为「已鉴定」，勾选「需复核」则置为「待复核」；
- 同一柜位（柜-屉-盒-位）只允许一份标本，冲突时列出已有标本编号。
