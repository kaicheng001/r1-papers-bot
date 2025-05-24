const axios = require('axios');
const xml2js = require('xml2js');

class ArxivSearcher {
  constructor() {
    this.baseUrl = 'http://export.arxiv.org/api/query';
    this.parser = new xml2js.Parser({ 
      explicitArray: false, 
      mergeAttrs: true,
      trim: true,
      normalize: true
    });
    
    this.csCategories = [
      'cs.AI', 'cs.CL', 'cs.LG', 'cs.CV', 'cs.RO', 'cs.NE', 
      'cs.IR', 'cs.MM', 'cs.HC', 'cs.CR', 'cs.DC', 'cs.DS',
      'cs.IT', 'cs.MA', 'cs.NI', 'cs.PL', 'cs.SE', 'cs.SY'
    ];
  }

  async searchR1Papers() {
    try {
      console.log('🔍 Starting ArXiv search for R1 papers...');
      
      const today = new Date();
      const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
      
      const searchQueries = this.buildSearchQueries();
      let allPapers = [];
      
      for (let i = 0; i < searchQueries.length; i++) {
        const query = searchQueries[i];
        console.log(`🔎 Executing search query ${i + 1}/${searchQueries.length}`);
        
        try {
          const papers = await this.performSearch(query, threeDaysAgo);
          console.log(`📄 Query ${i + 1} returned ${papers.length} papers`);
          allPapers = allPapers.concat(papers);
          
          if (i < searchQueries.length - 1) {
            await this.sleep(1000);
          }
        } catch (error) {
          console.warn(`⚠️ Query ${i + 1} failed:`, error.message);
          continue;
        }
      }
      
      const uniquePapers = this.removeDuplicates(allPapers);
      uniquePapers.sort((a, b) => new Date(b.published) - new Date(a.published));
      
      const validatedPapers = uniquePapers.filter(paper => {
        const isValid = this.isValidR1Paper(paper);
        if (!isValid) {
          console.log(`❌ Rejected: "${paper.title}"`);
        }
        return isValid;
      });
      
      console.log(`🎯 Final validated papers: ${validatedPapers.length}`);
      return validatedPapers;
      
    } catch (error) {
      console.error('❌ Error searching ArXiv:', error);
      throw new Error(`ArXiv search failed: ${error.message}`);
    }
  }

  buildSearchQueries() {
    const catQuery = this.csCategories.map(cat => `cat:${cat}`).join(' OR ');
    
    return [
      `ti:"R1" AND (${catQuery})`,
      `ti:"r1" AND (${catQuery})`,
      `ti:"R1-" OR ti:"-R1" OR ti:"r1-" OR ti:"-r1" AND (${catQuery})`,
      `all:"R1" AND ti:(model OR method OR network OR approach) AND (${catQuery})`
    ];
  }

  async performSearch(query, startDate) {
    const params = {
      search_query: query,
      start: 0,
      max_results: 100,
      sortBy: 'lastUpdatedDate',
      sortOrder: 'descending'
    };

    try {
      const response = await axios.get(this.baseUrl, { 
        params,
        timeout: 30000,
        headers: {
          'User-Agent': 'R1-Papers-Bot/1.0.0'
        }
      });
      
      const result = await this.parser.parseStringPromise(response.data);
      
      if (!result.feed || !result.feed.entry) {
        return [];
      }
      
      const entries = Array.isArray(result.feed.entry) ? result.feed.entry : [result.feed.entry];
      
      return entries
        .map(entry => this.parseEntry(entry))
        .filter(paper => {
          if (!paper) return false;
          
          const paperDate = new Date(paper.published);
          if (paperDate < startDate) {
            return false;
          }
          
          return true;
        });
        
    } catch (error) {
      throw error;
    }
  }

  parseEntry(entry) {
    try {
      const arxivId = entry.id.replace('http://arxiv.org/abs/', '');
      
      let categories = [];
      if (entry.category) {
        categories = Array.isArray(entry.category) 
          ? entry.category.map(cat => cat.term || cat)
          : [entry.category.term || entry.category];
      }
      
      let authors = [];
      if (entry.author) {
        authors = Array.isArray(entry.author)
          ? entry.author.map(author => author.name || author)
          : [entry.author.name || entry.author];
      }
      
      let pdfLink = '';
      let absLink = entry.id;
      
      if (entry.link) {
        const links = Array.isArray(entry.link) ? entry.link : [entry.link];
        const pdfLinkObj = links.find(link => link.type === 'application/pdf');
        if (pdfLinkObj) {
          pdfLink = pdfLinkObj.href;
        }
        
        const absLinkObj = links.find(link => link.type === 'text/html');
        if (absLinkObj) {
          absLink = absLinkObj.href;
        }
      }
      
      const title = entry.title 
        ? entry.title.replace(/\s+/g, ' ').trim()
        : '';
      
      const abstract = entry.summary 
        ? entry.summary.replace(/\s+/g, ' ').trim()
        : '';
      
      if (!title || !arxivId) {
        return null;
      }
      
      return {
        id: arxivId,
        title: title,
        authors: authors,
        abstract: abstract,
        categories: categories,
        published: entry.published,
        updated: entry.updated || entry.published,
        pdfUrl: pdfLink,
        absUrl: absLink
      };
      
    } catch (error) {
      console.warn(`⚠️ Error parsing entry:`, error.message);
      return null;
    }
  }

  isValidR1Paper(paper) {
    const title = paper.title.toLowerCase();
    const abstract = paper.abstract.toLowerCase();
    
    const r1Patterns = [
      /\br1[-_\s]/i,
      /[-_\s]r1\b/i,
      /\br1\b/i,
      /\br1[:]\s/i,
      /["']r1["']/i
    ];
    
    const titleHasR1 = r1Patterns.some(pattern => pattern.test(title));
    
    if (!titleHasR1) {
      const modelPatterns = [
        /model.*r1/i,
        /r1.*model/i,
        /method.*r1/i,
        /r1.*method/i,
        /approach.*r1/i,
        /r1.*approach/i,
        /framework.*r1/i,
        /r1.*framework/i
      ];
      
      const abstractHasR1Model = modelPatterns.some(pattern => pattern.test(abstract));
      if (!abstractHasR1Model) {
        return false;
      }
    }
    
    const hasCSCategory = paper.categories.some(cat => this.csCategories.includes(cat));
    if (!hasCSCategory) {
      return false;
    }
    
    const excludePatterns = [
      /version\s+r1/i,
      /revision\s+r1/i,
      /r1\s+error/i,
      /r1\s+squared/i,
      /round\s+1/i,
      /reviewer\s+1/i,
      /requirement\s+1/i,
      /rule\s+1/i,
      /region\s+1/i,
      /response\s+1/i,
      /\br1\s*=\s*\d/i,
      /coefficient.*r1/i,
      /correlation.*r1/i
    ];
    
    const shouldExclude = excludePatterns.some(pattern => 
      pattern.test(title) || pattern.test(abstract)
    );
    
    if (shouldExclude) {
      return false;
    }
    
    const aiKeywords = [
      'neural', 'model', 'learning', 'network', 'algorithm', 
      'training', 'inference', 'transformer', 'attention',
      'deep', 'machine', 'artificial', 'intelligence',
      'classification', 'regression', 'prediction', 'optimization',
      'embedding', 'representation', 'feature', 'performance'
    ];
    
    const hasAIKeywords = aiKeywords.some(keyword => 
      title.includes(keyword) || abstract.includes(keyword)
    );
    
    if (!hasAIKeywords) {
      return false;
    }
    
    return true;
  }

  removeDuplicates(papers) {
    const seen = new Set();
    const seenTitles = new Set();
    
    return papers.filter(paper => {
      if (seen.has(paper.id)) {
        return false;
      }
      
      const normalizedTitle = paper.title.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (seenTitles.has(normalizedTitle)) {
        return false;
      }
      
      seen.add(paper.id);
      seenTitles.add(normalizedTitle);
      return true;
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { ArxivSearcher };