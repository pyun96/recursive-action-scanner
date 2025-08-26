import { logger } from './utils.mjs';
import { Action } from './actions.mjs';
import { PRParser } from './prParser.mjs';

class RecursiveActionScanner {
  constructor(options = {}) {
    this.maxDepth = options.maxDepth || 5;
    this.prParser = new PRParser();
    this.scannedActions = new Map();
    this.dependencyTree = new Map();
  }

  async scanFromPR(owner, repo, pullNumber) {
    logger.info(`Starting PR scan for ${owner}/${repo}#${pullNumber}`);
    
    const actionReferences = await this.prParser.parseFromPR(owner, repo, pullNumber);
    return await this.scanActionList(actionReferences);
  }

  async scanFromCommit(owner, repo, sha) {
    logger.info(`Starting commit scan for ${owner}/${repo}@${sha}`);
    
    const actionReferences = await this.prParser.parseFromCommit(owner, repo, sha);
    return await this.scanActionList(actionReferences);
  }

  async scanActionList(actionReferences) {
    if (actionReferences.length === 0) {
      return this.generateReport();
    }

    logger.info(`Scanning ${actionReferences.length} action references recursively`);
    
    const results = new Map();
    
    for (const actionRef of actionReferences) {
      try {
        logger.info(`Processing root action: ${actionRef}`);
        const action = Action.fromUsesString(actionRef);
        
        const dependencies = await action.scanDependencies(this.maxDepth);
        results.set(actionRef, {
          action,
          dependencies,
          totalDependencies: dependencies.length
        });
        
        logger.info(`Found ${dependencies.length} total dependencies for ${actionRef}`);
        
      } catch (e) {
        logger.error(`Failed to scan ${actionRef}: ${e.message}`);
        results.set(actionRef, {
          action: null,
          dependencies: [],
          error: e.message,
          totalDependencies: 0
        });
      }
    }
    
    return this.generateReport(results);
  }

  generateReport(results = new Map()) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalRootActions: results.size,
        totalUniqueActions: this.countUniqueActions(results),
        maxDepthUsed: this.maxDepth
      },
      rootActions: [],
      allUniqueActions: this.getAllUniqueActions(results)
    };

    for (const [actionRef, result] of results) {
      report.rootActions.push({
        reference: actionRef,
        success: !result.error,
        error: result.error,
        totalDependencies: result.totalDependencies,
        dependencies: result.dependencies.map(dep => ({
          fullName: dep.fullName,
          url: dep.url,
          owner: dep.owner,
          repo: dep.repo,
          ref: dep.ref,
          subPath: dep.subPath
        }))
      });
    }

    return report;
  }

  countUniqueActions(results) {
    const uniqueActions = new Set();
    
    for (const [actionRef, result] of results) {
      if (result.action) {
        uniqueActions.add(result.action.fullName);
        result.dependencies.forEach(dep => uniqueActions.add(dep.fullName));
      }
    }
    
    return uniqueActions.size;
  }

  getAllUniqueActions(results) {
    const uniqueActions = new Map();
    
    for (const [actionRef, result] of results) {
      if (result.action) {
        uniqueActions.set(result.action.fullName, {
          fullName: result.action.fullName,
          url: result.action.url,
          owner: result.action.owner,
          repo: result.action.repo,
          ref: result.action.ref,
          subPath: result.action.subPath,
          isRootAction: true
        });
        
        result.dependencies.forEach(dep => {
          if (!uniqueActions.has(dep.fullName)) {
            uniqueActions.set(dep.fullName, {
              fullName: dep.fullName,
              url: dep.url,
              owner: dep.owner,
              repo: dep.repo,
              ref: dep.ref,
              subPath: dep.subPath,
              isRootAction: false
            });
          }
        });
      }
    }
    
    return Array.from(uniqueActions.values());
  }
}

export { RecursiveActionScanner };