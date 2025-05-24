class GitHubOperations {
  constructor(context, app) {
    this.context = context;
    this.app = app;
    this.octokit = context.octokit;
    this.owner = context.repo().owner;
    this.repo = context.repo().repo;
  }

  async createUpdatePR(newPapers) {
    try {
      const date = new Date().toISOString().split('T')[0];
      const timestamp = Date.now();
      const branchName = `auto-update/r1-papers-${date}-${timestamp}`;
      
      // 获取主分支
      const mainBranch = await this.getMainBranch();
      const baseSha = mainBranch.commit.sha;
      
      // 创建新分支
      await this.createBranch(branchName, baseSha);
      
      // 为每篇论文创建commit
      let currentSha = baseSha;
      for (let i = 0; i < newPapers.length; i++) {
        const paper = newPapers[i];
        currentSha = await this.createCommitForPaper(paper, branchName, currentSha);
        if (i < newPapers.length - 1) {
          await this.sleep(500);
        }
      }
      
      // 创建PR
      const pr = await this.createPullRequest(branchName, newPapers, date);
      await this.enhancePR(pr, newPapers);
      
      return pr;
      
    } catch (error) {
      this.app.log.error('Error creating update PR:', error);
      throw error;
    }
  }

  async getMainBranch() {
    try {
      return await this.octokit.repos.getBranch({
        owner: this.owner,
        repo: this.repo,
        branch: 'main'
      }).then(res => res.data);
    } catch (error) {
      if (error.status === 404) {
        return await this.octokit.repos.getBranch({
          owner: this.owner,
          repo: this.repo,
          branch: 'master'
        }).then(res => res.data);
      }
      throw error;
    }
  }

  async createBranch(branchName, baseSha) {
    try {
      await this.octokit.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${branchName}`,
        sha: baseSha
      });
    } catch (error) {
      if (error.status !== 422) {
        throw error;
      }
    }
  }

  async createCommitForPaper(paper, branchName, parentSha) {
    try {
      // 获取当前README内容
      const readmeContent = await this.getCurrentReadmeContent(branchName);
      
      // 更新README内容
      const updatedContent = this.insertPaperIntoReadme(readmeContent, paper);
      
      // 创建blob
      const blob = await this.octokit.git.createBlob({
        owner: this.owner,
        repo: this.repo,
        content: Buffer.from(updatedContent, 'utf8').toString('base64'),
        encoding: 'base64'
      });
      
      // 获取parent commit
      const parentCommit = await this.octokit.git.getCommit({
        owner: this.owner,
        repo: this.repo,
        commit_sha: parentSha
      });
      
      // 创建新tree
      const newTree = await this.octokit.git.createTree({
        owner: this.owner,
        repo: this.repo,
        base_tree: parentCommit.data.tree.sha,
        tree: [{
          path: 'README.md',
          mode: '100644',
          type: 'blob',
          sha: blob.data.sha
        }]
      });
      
      // 创建commit
      const commitMessage = this.generateCommitMessage(paper);
      const commit = await this.octokit.git.createCommit({
        owner: this.owner,
        repo: this.repo,
        message: commitMessage,
        tree: newTree.data.sha,
        parents: [parentSha]
      });
      
      // 更新分支引用
      await this.octokit.git.updateRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${branchName}`,
        sha: commit.data.sha
      });
      
      return commit.data.sha;
      
    } catch (error) {
      this.app.log.error(`Error creating commit for paper ${paper.title}:`, error);
      throw error;
    }
  }

  async getCurrentReadmeContent(branchName) {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: 'README.md',
        ref: branchName
      });
      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (error) {
      if (error.status === 404) {
        return this.createInitialReadme();
      }
      throw error;
    }
  }

  insertPaperIntoReadme(readmeContent, paper) {
    // 查找Papers表格
    const papersTableMatch = readmeContent.match(/(## Papers\s*\n[\s\S]*?\| Paper \| Code \| Models \| Dataset \| Project Page \| Date \|\n\|[^\n]+\|\n)([\s\S]*?)(?=\n##|\n$|$)/);
    
    if (!papersTableMatch) {
      const newTableContent = this.createPapersTable([paper]);
      return readmeContent + '\n\n' + newTableContent;
    }
    
    const tableHeader = papersTableMatch[1];
    const existingRows = papersTableMatch[2];
    const afterTable = readmeContent.slice(papersTableMatch.index + papersTableMatch[0].length);
    
    // 生成新论文行
    const newRow = this.generateTableRow(paper);
    
    // 解析现有行并按日期排序
    const existingPaperRows = existingRows.split('\n')
      .filter(line => line.includes('|') && line.trim() !== '')
      .map(line => {
        const date = this.extractDateFromRow(line);
        return { line, date };
      });
    
    // 添加新行
    existingPaperRows.push({ line: newRow, date: paper.date });
    
    // 按日期降序排序
    existingPaperRows.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // 重建内容
    const beforeTable = readmeContent.slice(0, papersTableMatch.index);
    const sortedRows = existingPaperRows.map(row => row.line).join('\n');
    
    return beforeTable + tableHeader + sortedRows + '\n' + afterTable;
  }

  async createPullRequest(branchName, papers, date) {
    const title = `🤖 [Auto Update] New R1 Papers - ${date}`;
    const body = this.generatePRBody(papers);
    
    const result = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: title,
      head: branchName,
      base: 'main',
      body: body,
      draft: false
    });
    
    return result.data;
  }

  async enhancePR(pr, papers) {
    try {
      // 添加标签
      await this.octokit.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: pr.number,
        labels: ['auto-update', 'papers', 'r1']
      });
    } catch (error) {
      this.app.log.warn('Failed to add labels to PR:', error);
    }
  }

  generateCommitMessage(paper) {
    const shortTitle = paper.title.length > 50 
      ? paper.title.substring(0, 47) + '...'
      : paper.title;
    
    return `Add: ${shortTitle}\n\nArXiv ID: ${paper.arxivId}\nDate: ${paper.date}`;
  }

  generatePRBody(papers) {
    const date = new Date().toISOString().split('T')[0];
    
    let body = `## 🤖 Daily R1 Papers Update - ${date}\n\n`;
    body += `This PR automatically adds **${papers.length} new R1-related paper(s)** found on ArXiv.\n\n`;
    
    body += `### 📄 Papers Added:\n\n`;
    
    papers.forEach((paper, index) => {
      body += `${index + 1}. **${paper.title}**\n`;
      body += `   - ArXiv ID: [${paper.arxivId}](${paper.absUrl})\n`;
      body += `   - Categories: ${paper.categories.join(', ')}\n`;
      body += `   - Published: ${paper.date}\n`;
      if (paper.codeUrl) {
        body += `   - Code: ${paper.codeUrl}\n`;
      }
      body += `\n`;
    });
    
    body += `### 🔍 Filtering Criteria:\n`;
    body += `- ✅ Title contains R1-related patterns\n`;
    body += `- ✅ Paper is in CS domain\n`;
    body += `- ✅ Not a duplicate of existing papers\n`;
    body += `- ✅ Published within the last 3 days\n\n`;
    
    body += `### 📋 Review Checklist:\n`;
    body += `- [ ] Verify paper titles are correctly formatted\n`;
    body += `- [ ] Check if code links are accurate\n`;
    body += `- [ ] Confirm papers are genuinely R1-related\n`;
    body += `- [ ] Ensure no duplicates were added\n\n`;
    
    body += `---\n`;
    body += `🔄 *This PR was automatically generated by the R1 Papers Bot*\n`;
    body += `⏰ *Generated at: ${new Date().toISOString()}*`;
    
    return body;
  }

  generateTableRow(paper) {
    const paperLink = `[${paper.title}](${paper.absUrl})`;
    const codeLink = paper.codeUrl ? `[Code](${paper.codeUrl})` : '-';
    const models = paper.models || '-';
    const dataset = paper.dataset || '-';
    const projectLink = paper.projectPage ? `[Project](${paper.projectPage})` : '-';
    const date = paper.date;
    
    return `| ${paperLink} | ${codeLink} | ${models} | ${dataset} | ${projectLink} | ${date} |`;
  }

  createInitialReadme() {
    return `# Awesome R1

A curated list of awesome R1 related papers, code, and resources.

## Papers

| Paper | Code | Models | Dataset | Project Page | Date |
|-------|------|--------|---------|--------------|------|

`;
  }

  createPapersTable(papers) {
    const header = `## Papers

| Paper | Code | Models | Dataset | Project Page | Date |
|-------|------|--------|---------|--------------|------|`;
    
    const rows = papers.map(paper => this.generateTableRow(paper)).join('\n');
    
    return header + '\n' + rows;
  }

  extractDateFromRow(line) {
    const cells = line.split('|').map(cell => cell.trim());
    if (cells.length >= 6) {
      return cells[6] || '1970-01-01';
    }
    return '1970-01-01';
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { GitHubOperations };