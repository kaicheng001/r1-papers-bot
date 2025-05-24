# r1-papers-bot

基于 Probot 的 GitHub App，自动更新 ArXiv 上的 R1 相关论文到 [Awesome-R1](https://github.com/kaicheng001/Awesome-R1) 仓库。

## 功能

- 每天自动搜索 ArXiv 上的 R1 相关论文
- 智能筛选 CS 领域论文
- 自动去重，避免重复添加
- 为每篇论文创建单独 commit
- 自动创建 PR 供审核

## 快速部署

### 1. 创建 GitHub App

访问 https://github.com/settings/apps/new，配置：

**基本信息：**
- App name: `R1 Papers Auto Update Bot`
- Homepage URL: `https://github.com/kaicheng001/r1-papers-bot`
- Webhook URL: `https://smee.io/new` (临时)

**权限：**
- Contents: Read & write
- Pull requests: Read & write
- Issues: Read & write
- Metadata: Read

**事件：**
- repository_dispatch
- issue_comment
- pull_request
- ping

### 2. 本地开发

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入 GitHub App 信息

# 启动开发服务器
npm run dev
```

### 3. 部署到 Vercel

```bash
# 部署
npx vercel

# 在 Vercel 面板设置环境变量：
# APP_ID, PRIVATE_KEY, WEBHOOK_SECRET
```

### 4. 安装到目标仓库

1. 在 [Awesome-R1](https://github.com/kaicheng001/Awesome-R1) 仓库安装此 GitHub App
2. 添加 `.github/workflows/daily-update.yml` 到目标仓库
3. 设置 `BOT_TOKEN` secret

## 使用方法

### 自动触发
每天北京时间 10:00 自动执行

### 手动触发
在任意 issue 评论：`/update-r1-papers`

## 项目结构

```
├── index.js                 # 主应用
├── lib/
│   ├── arxiv-search.js      # ArXiv 搜索
│   ├── paper-processor.js   # 论文处理
│   └── github-operations.js # GitHub 操作
└── .github/workflows/
    └── daily-update.yml     # 定时触发
```

## 环境变量

- `APP_ID`: GitHub App ID
- `PRIVATE_KEY`: GitHub App 私钥
- `WEBHOOK_SECRET`: Webhook 密钥
- `PORT`: 端口号 (默认 3000)

## License

MIT