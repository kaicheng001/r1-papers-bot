const axios = require('axios');

class PaperProcessor {
  constructor() {
    this.existingPapers = new Set();
    this.existingTitles = new Set();
    this.readmeContent = '';
    this.readmeSha = '';
  }

  async processAndFilterPapers(papers, context) {
    try {
      console.log(`⚙️ Processing ${papers.length} papers...`);
      
      await this.loadExistingPapers(context);
      console.log(`📖 Loaded ${this.existingPapers.size} existing papers from README`);
      
      const newPapers = papers.filter(paper => !this.isDuplicate(paper));
      console.log(`🆕 Found ${newPapers.length} new papers after deduplication`);
      
      if (newPapers.length === 0) {
        return [];
      }
      
      const processedPapers = [];
      
      for (let i = 0; i < newPapers.length; i++) {
        const paper = newPapers[i];
        console.log(`🔄 Processing paper ${i + 1}/${newPapers.length}: ${paper.title}`);
        
        try {
          const processedPaper = await this.processSinglePaper(paper, context);
          if (processedPaper) {
            processedPapers.push(processedPaper);
            console.log(`✅ Successfully processed: ${processedPaper.title}`);
          }
        } catch (error) {
          console.warn(`⚠️ Error processing paper ${paper.id}:`, error.message);
        }
      }
      
      console.log(`🎯 Final processed papers: ${processedPapers.length}`);
      return processedPapers;
      
    } catch (error) {
      console.error('❌ Error processing papers:', error);
      throw error;
    }
  }

  async loadExistingPapers(context) {
    try {
      const { data } = await context.octokit.repos.getContent({
        ...context.repo(),
        path: 'README.md'
      });
      
      this.readmeContent = Buffer.from(data.content, 'base64').toString('utf8');
      this.readmeSha = data.sha;
      
      this.parseExistingPapers();
      
    } catch (error) {
      if (error.status === 404) {
        console.warn('📄 README.md not found, will create new one');
        this.readmeContent = this.createInitialReadme();
        this.readmeSha = '';
      } else {
        throw error;
      }
    }
  }

  parseExistingPapers() {
    const papersTableMatch = this.readmeContent.match(/## Papers\s*\n([\s\S]*?)(?=\n##|\n$|$)/);
    
    if (!papersTableMatch) {
      return;
    }
    
    const tableContent = papersTableMatch[1];
    const lines = tableContent.split('\n');
    let paperCount = 0;
    
    for (const line of lines) {
      if (line.includes('|') && !line.includes('Paper') && !line.includes('---')) {
        try {
          const cells = line.split('|').map(cell => cell.trim());
          
          if (cells.length >= 6) {
            const paperCell = cells[1];
            
            const arxivUrl = this.extractArxivUrl(paperCell);
            if (arxivUrl) {
              const arxivId = this.extractArxivId(arxivUrl);
              if (arxivId) {
                this.existingPapers.add(arxivId);
                paperCount++;
              }
            }
            
            const titleText = this.extractTitleText(paperCell);
            if (titleText) {
              const normalizedTitle = this.normalizeTitle(titleText);
              this.existingTitles.add(normalizedTitle);
            }
          }
        } catch (error) {
          console.warn(`⚠️ Error parsing line: ${line}`, error.message);
        }
      }
    }
    
    console.log(`📊 Parsed ${paperCount} existing papers`);
  }

  async processSinglePaper(paper, context) {
    try {
      const processedPaper = {
        title: paper.title,
        arxivId: paper.id,
        authors: paper.authors,
        abstract: paper.abstract,
        categories: paper.categories,
        published: paper.published,
        updated: paper.updated,
        pdfUrl: paper.pdfUrl,
        absUrl: paper.absUrl,
        
        codeUrl: '',
        models: '',
        dataset: '',
        projectPage: '',
        date: this.formatDate(paper.published)
      };
      
      await this.enrichPaperInfo(processedPaper);
      
      if (!this.validateProcessedPaper(processedPaper)) {
        return null;
      }
      
      return processedPaper;
      
    } catch (error) {
      console.error(`❌ Error processing paper ${paper.id}:`, error);
      return null;
    }
  }

  async enrichPaperInfo(paper) {
    console.log(`🔍 Enriching info for: ${paper.title}`);
    
    // GitHub链接
    const githubMatch = paper.abstract.match(/https?:\/\/github\.com\/[^\s\)\],]+/gi);
    if (githubMatch && githubMatch.length > 0) {
      paper.codeUrl = githubMatch[0].replace(/[.,;:]$/, '');
      console.log(`🔗 Found GitHub link: ${paper.codeUrl}`);
    }
    
    // 项目页面链接
    const projectMatches = paper.abstract.match(/https?:\/\/[^\s\)\],]+\.(io|com|org|net)\/[^\s\)\],]*/gi);
    if (projectMatches) {
      for (const match of projectMatches) {
        const cleanUrl = match.replace(/[.,;:]$/, '');
        if (!cleanUrl.includes('github.com') && 
            !cleanUrl.includes('arxiv.org') && 
            !cleanUrl.includes('doi.org')) {
          paper.projectPage = cleanUrl;
          console.log(`🌐 Found project page: ${paper.projectPage}`);
          break;
        }
      }
    }
    
    // 模型名称
    const titleLower = paper.title.toLowerCase();
    const abstractLower = paper.abstract.toLowerCase();
    
    const modelPatterns = [
      /\b[\w\-]*r1[\w\-]*\b/gi,
      /\br1[_\-]?\w+/gi,
      /\w+[_\-]?r1\b/gi
    ];
    
    const foundModels = new Set();
    
    for (const pattern of modelPatterns) {
      const titleMatches = titleLower.match(pattern);
      const abstractMatches = abstractLower.match(pattern);
      
      if (titleMatches) {
        titleMatches.forEach(match => foundModels.add(match.toUpperCase()));
      }
      
      if (abstractMatches) {
        abstractMatches.slice(0, 2).forEach(match => foundModels.add(match.toUpperCase()));
      }
    }
    
    if (foundModels.size > 0) {
      paper.models = Array.from(foundModels).slice(0, 3).join(', ');
      console.log(`🤖 Found models: ${paper.models}`);
    }
    
    // 数据集信息
    const datasetPatterns = [
      /\b(imagenet|coco|cifar|mnist|glue|squad|wmt|conll|openwebtext|pile|commoncrawl)\b/gi,
      /\b\w+\s*dataset\b/gi,
      /\bevaluated?\s+on\s+([A-Z][A-Za-z0-9\-]+)/gi
    ];
    
    const foundDatasets = new Set();
    
    for (const pattern of datasetPatterns) {
      const matches = paper.abstract.match(pattern);
      if (matches) {
        matches.slice(0, 2).forEach(match => {
          const clean = match.replace(/\s+/g, ' ').trim();
          if (clean.length > 2 && clean.length < 30) {
            foundDatasets.add(clean);
          }
        });
      }
    }
    
    if (foundDatasets.size > 0) {
      paper.dataset = Array.from(foundDatasets).slice(0, 2).join(', ');
      console.log(`📊 Found datasets: ${paper.dataset}`);
    }
    
    // GitHub验证
    if (paper.codeUrl) {
      try {
        await this.enrichFromGitHub(paper);
      } catch (error) {
        console.warn(`⚠️ Failed to enrich from GitHub: ${error.message}`);
      }
    }
  }

  async enrichFromGitHub(paper) {
    try {
      const match = paper.codeUrl.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
      if (!match) return;
      
      const response = await axios.head(paper.codeUrl, {
        timeout: 5000,
        validateStatus: function (status) {
          return status < 500;
        }
      });
      
      if (response.status === 404) {
        console.log(`⚠️ GitHub repo not found: ${paper.codeUrl}`);
        paper.codeUrl = '';
      } else {
        console.log(`✅ GitHub repo verified: ${paper.codeUrl}`);
      }
      
    } catch (error) {
      console.warn(`⚠️ Cannot verify GitHub repo: ${error.message}`);
    }
  }

  validateProcessedPaper(paper) {
    if (!paper.title || !paper.arxivId || !paper.date) {
      return false;
    }
    
    if (paper.title.length > 200) {
      return false;
    }
    
    if (paper.codeUrl && !this.isValidUrl(paper.codeUrl)) {
      paper.codeUrl = '';
    }
    
    if (paper.projectPage && !this.isValidUrl(paper.projectPage)) {
      paper.projectPage = '';
    }
    
    return true;
  }

  isDuplicate(paper) {
    if (this.existingPapers.has(paper.id)) {
      console.log(`🔄 Duplicate ArXiv ID: ${paper.id}`);
      return true;
    }
    
    const normalizedTitle = this.normalizeTitle(paper.title);
    if (this.existingTitles.has(normalizedTitle)) {
      console.log(`🔄 Duplicate title: ${paper.title}`);
      return true;
    }
    
    for (const existingTitle of this.existingTitles) {
      if (this.calculateSimilarity(normalizedTitle, existingTitle) > 0.9) {
        console.log(`🔄 Similar title found: ${paper.title}`);
        return true;
      }
    }
    
    return false;
  }

  formatDate(dateString) {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return new Date().toISOString().split('T')[0];
      }
      return date.toISOString().split('T')[0];
    } catch (error) {
      return new Date().toISOString().split('T')[0];
    }
  }

  createInitialReadme() {
    return `# Awesome R1

A curated list of awesome R1 related papers, code, and resources.

## Papers

| Paper | Code | Models | Dataset | Project Page | Date |
|-------|------|--------|---------|--------------|------|

## Contributing

Contributions are welcome! Please read the [contributing guidelines](CONTRIBUTING.md) first.

## License

MIT License
`;
  }

  extractArxivUrl(text) {
    const match = text.match(/https?:\/\/arxiv\.org\/[^\)\]]+/);
    return match ? match[0] : null;
  }

  extractArxivId(url) {
    const match = url.match(/arxiv\.org\/abs\/(.+?)(?:\.pdf)?$/);
    return match ? match[1] : null;
  }

  extractTitleText(paperCell) {
    const match = paperCell.match(/\[([^\]]+)\]/);
    return match ? match[1] : null;
  }

  normalizeTitle(title) {
    return title.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  isValidUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  }
}

module.exports = { PaperProcessor };