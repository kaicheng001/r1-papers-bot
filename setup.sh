#!/bin/bash

# 创建项目根目录
echo "🚀 Creating r1-papers-bot project structure..."
# mkdir -p r1-papers-bot
# cd r1-papers-bot

# 创建子目录
echo "📁 Creating directories..."
mkdir -p lib
mkdir -p .github/workflows

# 创建主要文件
echo "📄 Creating main files..."
touch index.js
touch package.json
touch app.yml
touch vercel.json
touch .env.example
touch README.md

# 创建 lib 目录文件
echo "📚 Creating lib files..."
touch lib/arxiv-search.js
touch lib/paper-processor.js
touch lib/github-operations.js

# 创建 workflow 文件
echo "⚙️ Creating workflow files..."
touch .github/workflows/daily-update.yml

# 创建 .gitignore
echo "🔒 Creating .gitignore..."
cat > .gitignore << EOF
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.production

# Build outputs
dist/
build/

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# Dependency directories
jspm_packages/

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Vercel
.vercel

# Local development
.env.development
smee-client.log
EOF

echo "✅ Project structure created successfully!"
echo ""
echo "📂 Project structure:"
echo "r1-papers-bot/"
echo "├── index.js"
echo "├── package.json"
echo "├── app.yml"
echo "├── vercel.json"
echo "├── .env.example"
echo "├── .gitignore"
echo "├── README.md"
echo "├── lib/"
echo "│   ├── arxiv-search.js"
echo "│   ├── paper-processor.js"
echo "│   └── github-operations.js"
echo "└── .github/"
echo "    └── workflows/"
echo "        └── daily-update.yml"
echo ""
echo "🎯 Next steps:"
echo "1. cd r1-papers-bot"
echo "2. Request the file contents one by one"
echo "3. Initialize git: git init"
echo "4. Install dependencies: npm install"