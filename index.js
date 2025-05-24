require('dotenv').config();

// ... 其他代码

const { ArxivSearcher } = require('./lib/arxiv-search');
const { PaperProcessor } = require('./lib/paper-processor');
const { GitHubOperations } = require('./lib/github-operations');

/**
 * R1 Papers Auto Update Bot
 * 基于Probot的GitHub App，用于自动更新ArXiv上的R1相关论文
 */
module.exports = (app) => {
  app.log.info('🤖 R1 Papers Auto Update Bot is running!');

  // 监听repository_dispatch事件（定时触发）
  app.on('repository_dispatch', async (context) => {
    if (context.payload.action === 'daily_update') {
      app.log.info('📅 Received daily_update dispatch event');
      await processDaily(context);
    }
  });

  // 监听issue评论（手动触发）
  app.on('issue_comment.created', async (context) => {
    const comment = context.payload.comment.body.toLowerCase().trim();
    const commenter = context.payload.sender.login;
    const repoOwner = context.payload.repository.owner.login;
    
    // 只允许仓库所有者通过评论触发
    if (comment === '/update-r1-papers' && commenter === repoOwner) {
      app.log.info(`🔧 Manual trigger by ${commenter}`);
      
      // 回复确认消息
      await context.octokit.issues.createComment({
        ...context.repo(),
        issue_number: context.payload.issue.number,
        body: '🤖 R1 Papers update triggered! I\'ll search for new papers and create a PR if any are found.'
      });
      
      await processDaily(context);
    }
  });

  // 监听PR关闭事件（清理工作）
  app.on('pull_request.closed', async (context) => {
    const pr = context.payload.pull_request;
    
    // 如果是我们的自动更新PR且已合并，执行清理
    if (pr.merged && pr.title.includes('[Auto Update] New R1 Papers')) {
      await cleanupAfterMerge(context, pr);
    }
  });

  // 健康检查
  app.on('ping', async (context) => {
    app.log.info('💓 Bot health check - OK');
  });

  /**
   * 主要处理逻辑
   */
  async function processDaily(context) {
    const { owner, repo } = context.repo();
    const startTime = Date.now();
    
    try {
      app.log.info(`🚀 Starting daily R1 papers update for ${owner}/${repo}`);
      
      // 1. 搜索ArXiv中的R1相关论文
      app.log.info('🔍 Searching ArXiv for R1 papers...');
      const searcher = new ArxivSearcher();
      const papers = await searcher.searchR1Papers();
      
      app.log.info(`📊 Found ${papers.length} potential R1 papers from ArXiv`);
      
      if (papers.length === 0) {
        app.log.info('📭 No potential papers found in search');
        await postNoResultsComment(context);
        return;
      }
      
      // 2. 处理和筛选论文
      app.log.info('⚙️ Processing and filtering papers...');
      const processor = new PaperProcessor();
      const validPapers = await processor.processAndFilterPapers(papers, context);
      
      app.log.info(`✅ Filtered to ${validPapers.length} valid new R1 papers`);
      
      if (validPapers.length === 0) {
        app.log.info('📭 No new valid papers found after filtering');
        await postNoNewPapersComment(context);
        return;
      }
      
      // 3. 执行GitHub操作（创建PR）
      app.log.info('📝 Creating GitHub PR with new papers...');
      const githubOps = new GitHubOperations(context, app);
      const pr = await githubOps.createUpdatePR(validPapers);
      
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      
      app.log.info(`🎉 Successfully created PR #${pr.number} with ${validPapers.length} papers in ${duration}s`);
      
      // 发送成功通知
      await postSuccessComment(context, pr, validPapers, duration);
      
    } catch (error) {
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      
      app.log.error(`❌ Error during daily update after ${duration}s:`, error);
      
      // 创建错误报告issue
      await createErrorIssue(context, error, duration);
    }
  }

  /**
   * PR合并后的清理工作
   */
  async function cleanupAfterMerge(context, pr) {
    try {
      app.log.info(`🧹 Cleaning up after PR #${pr.number} merge`);
      
      const branchName = pr.head.ref;
      
      // 删除分支
      await context.octokit.git.deleteRef({
        ...context.repo(),
        ref: `heads/${branchName}`
      });
      
      app.log.info(`✅ Cleaned up branch: ${branchName}`);
      
      // 在PR中添加清理成功的评论
      await context.octokit.issues.createComment({
        ...context.repo(),
        issue_number: pr.number,
        body: '🧹 Branch automatically cleaned up after merge. Thanks for reviewing!'
      });
      
    } catch (error) {
      app.log.warn(`⚠️ Failed to clean up after PR merge:`, error.message);
    }
  }

  /**
   * 发送无搜索结果评论
   */
  async function postNoResultsComment(context) {
    try {
      // 查找最近的open issue，如果没有就创建一个
      const issues = await context.octokit.issues.listForRepo({
        ...context.repo(),
        state: 'open',
        labels: 'bot-status',
        per_page: 1
      });
      
      let issueNumber;
      if (issues.data.length > 0) {
        issueNumber = issues.data[0].number;
      } else {
        const newIssue = await context.octokit.issues.create({
          ...context.repo(),
          title: '🤖 Bot Status Updates',
          body: 'This issue is used for bot status updates.',
          labels: ['bot-status']
        });
        issueNumber = newIssue.data.number;
      }
      
      await context.octokit.issues.createComment({
        ...context.repo(),
        issue_number: issueNumber,
        body: `📭 **Daily Update - ${new Date().toISOString().split('T')[0]}**\n\nNo R1 papers found in ArXiv search today.`
      });
    } catch (error) {
      app.log.warn('Failed to post no results comment:', error);
    }
  }

  /**
   * 发送无新论文评论
   */
  async function postNoNewPapersComment(context) {
    try {
      const issues = await context.octokit.issues.listForRepo({
        ...context.repo(),
        state: 'open',
        labels: 'bot-status',
        per_page: 1
      });
      
      let issueNumber;
      if (issues.data.length > 0) {
        issueNumber = issues.data[0].number;
      } else {
        const newIssue = await context.octokit.issues.create({
          ...context.repo(),
          title: '🤖 Bot Status Updates',
          body: 'This issue is used for bot status updates.',
          labels: ['bot-status']
        });
        issueNumber = newIssue.data.number;
      }
      
      await context.octokit.issues.createComment({
        ...context.repo(),
        issue_number: issueNumber,
        body: `📭 **Daily Update - ${new Date().toISOString().split('T')[0]}**\n\nFound potential papers but all were duplicates or didn't meet filtering criteria.`
      });
    } catch (error) {
      app.log.warn('Failed to post no new papers comment:', error);
    }
  }

  /**
   * 发送成功通知评论
   */
  async function postSuccessComment(context, pr, papers, duration) {
    try {
      await context.octokit.issues.createComment({
        ...context.repo(),
        issue_number: pr.number,
        body: `🎉 **Auto-update completed successfully!**\n\n` +
              `📊 **Summary:**\n` +
              `- Added ${papers.length} new R1 paper(s)\n` +
              `- Processing time: ${duration}s\n` +
              `- Created at: ${new Date().toISOString()}\n\n` +
              `Please review the papers and merge if everything looks good! 🚀`
      });
    } catch (error) {
      app.log.warn('Failed to post success comment:', error);
    }
  }

  /**
   * 创建错误报告issue
   */
  async function createErrorIssue(context, error, duration) {
    try {
      const date = new Date().toISOString().split('T')[0];
      
      await context.octokit.issues.create({
        ...context.repo(),
        title: `🚨 R1 Papers Auto Update Failed - ${date}`,
        body: `## 🚨 Auto Update Failure Report\n\n` +
              `**Date:** ${new Date().toISOString()}\n` +
              `**Duration:** ${duration}s\n` +
              `**Error:** ${error.message}\n\n` +
              `### Stack Trace\n` +
              `\`\`\`\n${error.stack}\`\`\`\n\n` +
              `### Debugging Steps\n` +
              `1. Check the application logs for detailed error information\n` +
              `2. Verify ArXiv API availability\n` +
              `3. Ensure GitHub API permissions are sufficient\n` +
              `4. Check if the repository structure has changed\n\n` +
              `### Manual Trigger\n` +
              `To manually retry the update, comment \`/update-r1-papers\` on any issue.\n\n` +
              `---\n` +
              `🤖 *This issue was automatically created by the R1 Papers Bot*`,
        labels: ['bug', 'auto-update', 'urgent']
      });
    } catch (issueError) {
      app.log.error('Failed to create error issue:', issueError);
    }
  }
};