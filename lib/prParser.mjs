import { Octokit } from 'octokit';
import { logger } from './utils.mjs';

class PRParser {
  constructor() {
    this.octokit = new Octokit({ auth: process.env?.GITHUB_TOKEN });
  }

  async getChangedFiles(owner, repo, pullNumber) {
    try {
      const { data: files } = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber
      });
      
      return files.filter(file => 
        file.filename.endsWith('.md') && 
        (file.status === 'added' || file.status === 'modified')
      );
    } catch (e) {
      logger.error(`Failed to get PR files: ${e.message}`);
      return [];
    }
  }

  async getFileContent(owner, repo, path, ref) {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref
      });
      
      if (data.type === 'file') {
        return Buffer.from(data.content, 'base64').toString();
      }
    } catch (e) {
      logger.warn(`Failed to get file content for ${path}: ${e.message}`);
    }
    return null;
  }

  extractActionReferences(content) {
    const actionRegex = /([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+@[a-fA-F0-9]{40})/g;
    const matches = content.match(actionRegex) || [];
    return [...new Set(matches)];
  }

  async parseFromPR(owner, repo, pullNumber) {
    logger.info(`Parsing PR #${pullNumber} in ${owner}/${repo}`);
    
    const changedFiles = await this.getChangedFiles(owner, repo, pullNumber);
    if (changedFiles.length === 0) {
      logger.info('No markdown files changed in this PR');
      return [];
    }

    const actionReferences = new Set();
    
    for (const file of changedFiles) {
      logger.info(`Processing ${file.filename}`);
      
      const content = await this.getFileContent(owner, repo, file.filename, file.sha);
      if (content) {
        const references = this.extractActionReferences(content);
        references.forEach(ref => actionReferences.add(ref));
      }
    }

    logger.info(`Found ${actionReferences.size} unique action references`);
    return Array.from(actionReferences);
  }

  async parseFromCommit(owner, repo, sha) {
    logger.info(`Parsing commit ${sha} in ${owner}/${repo}`);
    
    try {
      const { data: commit } = await this.octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: sha
      });
      
      const changedFiles = commit.files.filter(file => 
        file.filename.endsWith('.md') && 
        (file.status === 'added' || file.status === 'modified')
      );

      if (changedFiles.length === 0) {
        logger.info('No markdown files changed in this commit');
        return [];
      }

      const actionReferences = new Set();
      
      for (const file of changedFiles) {
        logger.info(`Processing ${file.filename}`);
        
        const content = await this.getFileContent(owner, repo, file.filename, sha);
        if (content) {
          const references = this.extractActionReferences(content);
          references.forEach(ref => actionReferences.add(ref));
        }
      }

      logger.info(`Found ${actionReferences.size} unique action references`);
      return Array.from(actionReferences);
      
    } catch (e) {
      logger.error(`Failed to get commit: ${e.message}`);
      return [];
    }
  }
}

export { PRParser };