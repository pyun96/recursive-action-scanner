import { Octokit } from 'octokit';
import { logger, GITHUB_URL_RE, ACTION_NAME_REGEX, actionSteps } from './utils.mjs';
import YAML from 'yaml';

class ActionCache {
  static actions = []
  static register(action) {
    ActionCache.actions.push(action)
  }
  static find(owner, repo, ref, subPath = '') {
    for (const _action of ActionCache.actions) {
      if (
        _action.owner === owner &&
        _action.repo === repo &&
        _action.ref === ref &&
        _action.subPath === subPath
      ) {
        logger.debug(`ActionCache HIT ${owner}/${repo}@${ref}/${subPath}`)
        return _action
      }
    }
  }
  static findOrCreate(owner, repo, ref, subPath = '') {
    const found = ActionCache.find(owner, repo, ref, subPath)
    if (found !== undefined) return found;
    return new Action(owner, repo, ref, subPath);
  }
}

class Action {
  constructor(owner, repo, ref, subPath = '') {
    this.owner = owner;
    this.repo = repo;
    this.ref = ref;
    this.subPath = subPath;
    this.dependencies = new Set();
    this.scanned = false;
    
    ActionCache.register(this);
  }

  get fullName() {
    return `${this.owner}/${this.repo}@${this.ref}${this.subPath ? '/' + this.subPath : ''}`;
  }

  get url() {
    return `https://github.com/${this.owner}/${this.repo}/tree/${this.ref}${this.subPath ? '/' + this.subPath : ''}`;
  }

  static fromUsesString(usesString) {
    const match = usesString.match(ACTION_NAME_REGEX);
    if (!match) {
      throw new Error(`Invalid action reference: ${usesString}`);
    }
    
    const { org, action, subPath, ref } = match.groups;
    return ActionCache.findOrCreate(org, action, ref, subPath || '');
  }

  async getActionYaml() {
    if (this._actionYaml !== undefined) return this._actionYaml;
    
    const octokit = new Octokit({ auth: process.env?.GITHUB_TOKEN });
    
    const possiblePaths = [
      this.subPath ? `${this.subPath}/action.yml` : 'action.yml',
      this.subPath ? `${this.subPath}/action.yaml` : 'action.yaml'
    ];
    
    for (const path of possiblePaths) {
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path: path,
          ref: this.ref
        });
        
        if (data.type === 'file') {
          const content = Buffer.from(data.content, 'base64').toString();
          this._actionYaml = YAML.parse(content);
          return this._actionYaml;
        }
      } catch (e) {
        logger.debug(`Failed to get ${path}: ${e.message}`);
      }
    }
    
    logger.warn(`No action.yml or action.yaml found for ${this.fullName}`);
    this._actionYaml = null;
    return this._actionYaml;
  }

  async scanDependencies(maxDepth = 5, currentDepth = 0) {
    if (this.scanned || currentDepth >= maxDepth) {
      return Array.from(this.dependencies);
    }
    
    logger.info(`Scanning ${this.fullName} (depth: ${currentDepth})`);
    this.scanned = true;
    
    const actionYaml = await this.getActionYaml();
    if (!actionYaml) return Array.from(this.dependencies);
    
    for (const [jobKey, job, step, stepIdx] of actionSteps(actionYaml)) {
      if (step?.uses) {
        try {
          const dependencyAction = Action.fromUsesString(step.uses);
          this.dependencies.add(dependencyAction);
          
          const nestedDeps = await dependencyAction.scanDependencies(maxDepth, currentDepth + 1);
          nestedDeps.forEach(dep => this.dependencies.add(dep));
        } catch (e) {
          logger.warn(`Failed to parse uses: ${step.uses} - ${e.message}`);
        }
      }
    }
    
    return Array.from(this.dependencies);
  }

  toJSON() {
    return {
      fullName: this.fullName,
      owner: this.owner,
      repo: this.repo,
      ref: this.ref,
      subPath: this.subPath,
      url: this.url,
      dependencies: Array.from(this.dependencies).map(dep => dep.toJSON())
    };
  }
}

export { Action, ActionCache };