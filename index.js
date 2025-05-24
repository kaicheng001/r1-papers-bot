const { Probot } = require('probot');
const { ArxivSearcher } = require('./lib/arxiv-search');
const { PaperProcessor } = require('./lib/paper-processor');
const { GitHubOperations } = require('./lib/github-operations');

const appFn = (app) => {
  app.log.info('🤖 R1 Papers Auto Update Bot is running!');

  app.on('repository_dispatch', async (context) => {
    if (context.payload.action === 'daily_update') {
      await processDaily(context, app);
    }
  });

  app.on('issue_comment.created', async (context) => {
    const comment = context.payload.comment.body.toLowerCase().trim();
    const commenter = context.payload.sender.login;
    const repoOwner = context.payload.repository.owner.login;
    
    if (comment === '/update-r1-papers' && commenter === repoOwner) {
      app.log.info(`🔧 Manual trigger by ${commenter}`);
      
      await context.octokit.issues.createComment({
        ...context.repo(),
        issue_number: context.payload.issue.number,
        body: '🤖 R1 Papers update triggered! I\'ll search for new papers and create a PR if any are found.'
      });
      
      await processDaily(context, app);
    }
  });

  app.on('ping', async (context) => {
    app.log.info('💓 Bot health check - OK');
  });

  async function processDaily(context, app) {
    try {
      app.log.info('🚀 Starting daily R1 papers update...');
      
      const searcher = new ArxivSearcher();
      const papers = await searcher.searchR1Papers();
      
      if (papers.length === 0) {
        app.log.info('📭 No potential papers found');
        return;
      }
      
      const processor = new PaperProcessor();
      const validPapers = await processor.processAndFilterPapers(papers, context);
      
      if (validPapers.length === 0) {
        app.log.info('📭 No new valid papers found');
        return;
      }
      
      const githubOps = new GitHubOperations(context, app);
      await githubOps.createUpdatePR(validPapers);
      
      app.log.info(`🎉 Successfully created PR with ${validPapers.length} papers`);
      
    } catch (error) {
      app.log.error('❌ Error during daily update:', error);
      throw error;
    }
  }
};

module.exports = (req, res) => {
  const probot = new Probot({
    appId: process.env.APP_ID,
    privateKey: process.env.PRIVATE_KEY,
    secret: process.env.WEBHOOK_SECRET,
  });
  
  probot.load(appFn);
  
  return probot.webhooks.verifyAndReceive({
    id: req.headers['x-github-delivery'],
    name: req.headers['x-github-event'],
    signature: req.headers['x-hub-signature-256'],
    payload: req.body
  }).then(() => {
    res.status(200).send('OK');
  }).catch((error) => {
    console.error('Webhook processing failed:', error);
    res.status(500).send('Internal Server Error');
  });
};