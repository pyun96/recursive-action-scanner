import { Octokit } from 'octokit';
import { logger } from './utils.mjs';
import { WorkflowParser } from './workflowParser.mjs';

class PRParser {
  constructor() {
    this.octokit = new Octokit({ auth: process.env?.GITHUB_TOKEN });
    this.workflowParser = new WorkflowParser(process.env?.GITHUB_TOKEN);
  }

  async getChangedFiles(owner, repo, pullNumber) {
    try {
      const { data: files } = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber
      });
      
      return files.filter(file => {
        const isMarkdown = file.filename.endsWith('.md');
        const isWorkflow = file.filename.startsWith('.github/workflows/') && 
                         (file.filename.endsWith('.yml') || file.filename.endsWith('.yaml'));
        
        return (isMarkdown || isWorkflow) && 
               (file.status === 'added' || file.status === 'modified');
      });
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
    // Match actions with commit hashes (40 hex chars) or version tags (v1, v1.2.3, main, etc.)
    const actionRegex = /([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+@(?:[a-fA-F0-9]{40}|[\w.-]+))/g;
    const matches = content.match(actionRegex) || [];
    return [...new Set(matches)];
  }

  extractAddedLines(patch) {
    if (!patch) return [];
    const lines = patch.split('\n');
    return lines
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .map(line => line.substring(1)); // Remove the '+' prefix
  }

  /**
   * Extract actions from workflow file content using YAML parsing
   * @param {string} content - YAML workflow content 
   * @returns {Array} - Array of action references
   */
  extractActionsFromWorkflowContent(content) {
    try {
      return this.workflowParser.extractActionsFromWorkflow(content);
    } catch (error) {
      logger.warn(`Failed to parse workflow content: ${error.message}`);
      return [];
    }
  }

  /**
   * Determine the appropriate extraction method based on file type
   * @param {string} filename - File name
   * @param {string} content - File content
   * @returns {Array} - Array of action references
   */
  extractReferencesForFileType(filename, content) {
    if (filename.endsWith('.md')) {
      // Use markdown pattern matching for .md files
      return this.extractActionReferences(content);
    } else if (filename.startsWith('.github/workflows/') && 
              (filename.endsWith('.yml') || filename.endsWith('.yaml'))) {
      // Use YAML parsing for workflow files
      return this.extractActionsFromWorkflowContent(content);
    }
    return [];
  }

  async parseFromPR(owner, repo, pullNumber) {
    logger.info(`Parsing ONLY NEW actions from PR #${pullNumber} in ${owner}/${repo}`);
    
    const changedFiles = await this.getChangedFiles(owner, repo, pullNumber);
    if (changedFiles.length === 0) {
      logger.info('No markdown or workflow files changed in this PR');
      return [];
    }

    const actionReferences = new Set();
    
    for (const file of changedFiles) {
      const fileType = file.filename.endsWith('.md') ? 'markdown' : 'workflow';
      logger.info(`Processing ${file.filename} (${fileType}) - analyzing only added lines`);
      
      if (file.patch) {
        // Extract only the added lines from the diff
        const addedLines = this.extractAddedLines(file.patch);
        const addedContent = addedLines.join('\n');
        
        if (addedContent.trim()) {
          const references = this.extractReferencesForFileType(file.filename, addedContent);
          if (references.length > 0) {
            logger.info(`Found ${references.length} new actions in ${file.filename}: ${references.join(', ')}`);
            references.forEach(ref => actionReferences.add(ref));
          } else {
            logger.info(`No action references found in newly added lines of ${file.filename}`);
          }
        } else {
          logger.info(`No content added to ${file.filename}`);
        }
      } else {
        logger.warn(`No patch data available for ${file.filename}, falling back to full file scan`);
        // Fallback to scanning entire file if patch is not available
        const content = await this.getFileContent(owner, repo, file.filename, file.sha);
        if (content) {
          const references = this.extractReferencesForFileType(file.filename, content);
          references.forEach(ref => actionReferences.add(ref));
        }
      }
    }

    logger.info(`Found ${actionReferences.size} unique NEW action references`);
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
      
      const changedFiles = commit.files.filter(file => {
        const isMarkdown = file.filename.endsWith('.md');
        const isWorkflow = file.filename.startsWith('.github/workflows/') && 
                         (file.filename.endsWith('.yml') || file.filename.endsWith('.yaml'));
        
        return (isMarkdown || isWorkflow) && 
               (file.status === 'added' || file.status === 'modified');
      });

      if (changedFiles.length === 0) {
        logger.info('No markdown or workflow files changed in this commit');
        return [];
      }

      const actionReferences = new Set();
      
      for (const file of changedFiles) {
        const fileType = file.filename.endsWith('.md') ? 'markdown' : 'workflow';
        logger.info(`Processing ${file.filename} (${fileType})`);
        
        const content = await this.getFileContent(owner, repo, file.filename, sha);
        if (content) {
          const references = this.extractReferencesForFileType(file.filename, content);
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