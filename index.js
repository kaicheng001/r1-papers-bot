const { createProbot } = require('probot');
const { ArxivSearcher } = require('./lib/arxiv-search');
const { PaperProcessor } = require('./lib/paper-processor');
const { GitHubOperations } = require('./lib/github-operations');

// Probot app function
const app = (app) => {
  console.log('🤖 R1 Papers Auto Update Bot is running!');

  app.on('repository_dispatch', async (context) => {
    if (context.payload.action === 'daily_update') {
      console.log('📅 Received daily_update dispatch event');
      await processDaily(context);
    }
  });

  app.on('issue_comment.created', async (context) => {
    const comment = context.payload.comment.body.toLowerCase().trim();
    const commenter = context.payload.sender.login;
    const repoOwner = context.payload.repository.owner.login;
    
    if (comment === '/update-r1-papers' && commenter === repoOwner) {
      console.log(`🔧 Manual trigger by ${commenter}`);
      
      await context.octokit.issues.createComment({
        ...context.repo(),
        issue_number: context.payload.issue.number,
        body: '🤖 R1 Papers update triggered! I\'ll search for new papers and create a PR if any are found.'
      });
      
      await processDaily(context);
    }
  });

  app.on('ping', async (context) => {
    console.log('💓 Bot health check - OK');
  });

  async function processDaily(context) {
    const startTime = Date.now();
    
    try {
      console.log('🚀 Starting daily R1 papers update...');
      
      // 1. 搜索论文
      const searcher = new ArxivSearcher();
      const papers = await searcher.searchR1Papers();
      
      console.log(`📊 Found ${papers.length} potential R1 papers`);
      
      if (papers.length === 0) {
        console.log('📭 No potential papers found');
        await postNoResultsComment(context);
        return;
      }
      
      // 2. 处理论文
      const processor = new PaperProcessor();
      const validPapers = await processor.processAndFilterPapers(papers, context);
      
      console.log(`✅ Filtered to ${validPapers.length} valid new papers`);
      
      if (validPapers.length === 0) {
        console.log('📭 No new valid papers found');
        await postNoNewPapersComment(context);
        return;
      }
      
      // 3. 创建PR
      const githubOps = new GitHubOperations(context, { log: console });
      const pr = await githubOps.createUpdatePR(validPapers);
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`🎉 Successfully created PR #${pr.number} with ${validPapers.length} papers in ${duration}s`);
      
      await postSuccessComment(context, pr, validPapers, duration);
      
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`❌ Error during daily update after ${duration}s:`, error);
      
      await createErrorIssue(context, error, duration);
    }
  }

  async function postNoResultsComment(context) {
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
        body: `📭 **Daily Update - ${new Date().toISOString().split('T')[0]}**\n\nNo R1 papers found in ArXiv search today.`
      });
    } catch (error) {
      console.warn('Failed to post no results comment:', error);
    }
  }

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
      console.warn('Failed to post no new papers comment:', error);
    }
  }

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
      console.warn('Failed to post success comment:', error);
    }
  }

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
              `### Manual Trigger\n` +
              `To manually retry the update, comment \`/update-r1-papers\` on any issue.\n\n` +
              `---\n` +
              `🤖 *This issue was automatically created by the R1 Papers Bot*`,
        labels: ['bug', 'auto-update', 'urgent']
      });
    } catch (issueError) {
      console.error('Failed to create error issue:', issueError);
    }
  }
};

// Serverless handler for Vercel
module.exports = async (req, res) => {
  try {
    // 检查必要的环境变量
    if (!process.env.APP_ID || !process.env.PRIVATE_KEY || !process.env.WEBHOOK_SECRET) {
      console.error('Missing required environment variables');
      return res.status(500).json({ error: 'Missing configuration' });
    }

    // 健康检查
    if (req.method === 'GET') {
      return res.status(200).json({ 
        status: 'ok', 
        bot: 'R1 Papers Auto Update Bot',
        timestamp: new Date().toISOString()
      });
    }

    // 处理 webhook
    if (req.method === 'POST') {
      const probot = createProbot({
        overrides: {
          appId: process.env.APP_ID,
          privateKey: process.env.PRIVATE_KEY,
          secret: process.env.WEBHOOK_SECRET,
        },
      });

      // 加载 app
      await probot.load(app);

      // 处理 webhook
      await probot.webhooks.verifyAndReceive({
        id: req.headers['x-github-delivery'],
        name: req.headers['x-github-event'],
        signature: req.headers['x-hub-signature-256'],
        payload: JSON.stringify(req.body),
      });

      return res.status(200).json({ status: 'processed' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};