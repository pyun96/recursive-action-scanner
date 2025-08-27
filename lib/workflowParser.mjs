import { Octokit } from 'octokit';
import YAML from 'yaml';

export class WorkflowParser {
  constructor(githubToken) {
    this.octokit = new Octokit({
      auth: githubToken,
    });
  }

  /**
   * Parse a repository URL and extract owner/repo
   * @param {string} repoUrl - GitHub repository URL
   * @returns {Object} - {owner, repo}
   */
  parseRepoUrl(repoUrl) {
    // Handle both https://github.com/owner/repo and owner/repo formats
    const match = repoUrl.match(/(?:https?:\/\/github\.com\/)?([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/)?$/);
    if (!match) {
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    }
    return {
      owner: match[1],
      repo: match[2]
    };
  }

  /**
   * Fetch all workflow files from a repository
   * @param {string} repoUrl - Repository URL or owner/repo format
   * @returns {Promise<Array>} - Array of workflow file contents
   */
  async fetchWorkflowFiles(repoUrl) {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    
    console.log(`info: Fetching workflow files from ${owner}/${repo}`);
    
    try {
      // Get contents of .github/workflows directory
      const { data: contents } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: '.github/workflows'
      });

      if (!Array.isArray(contents)) {
        console.log('warn: .github/workflows is not a directory or is empty');
        return [];
      }

      // Filter for YAML files
      const workflowFiles = contents.filter(file => 
        file.type === 'file' && 
        (file.name.endsWith('.yml') || file.name.endsWith('.yaml'))
      );

      console.log(`info: Found ${workflowFiles.length} workflow files`);

      // Fetch content of each workflow file
      const workflows = [];
      for (const file of workflowFiles) {
        try {
          const { data: fileContent } = await this.octokit.rest.repos.getContent({
            owner,
            repo,
            path: file.path
          });

          const content = Buffer.from(fileContent.content, 'base64').toString('utf8');
          workflows.push({
            name: file.name,
            path: file.path,
            content
          });
        } catch (error) {
          console.log(`warn: Could not fetch ${file.path}: ${error.message}`);
        }
      }

      return workflows;
    } catch (error) {
      if (error.status === 404) {
        console.log('warn: Repository not found or .github/workflows directory does not exist');
        return [];
      }
      throw error;
    }
  }

  /**
   * Extract GitHub Actions from workflow YAML content
   * @param {string} yamlContent - YAML content of workflow file
   * @returns {Array} - Array of action references
   */
  extractActionsFromWorkflow(yamlContent) {
    try {
      const workflow = YAML.parse(yamlContent);
      const actions = new Set();

      // Recursively search for 'uses' statements
      const findUses = (obj) => {
        if (typeof obj !== 'object' || obj === null) {
          return;
        }

        if (Array.isArray(obj)) {
          obj.forEach(findUses);
          return;
        }

        for (const [key, value] of Object.entries(obj)) {
          if (key === 'uses' && typeof value === 'string') {
            // Extract action reference (now including local actions)
            actions.add(value.trim());
          } else {
            findUses(value);
          }
        }
      };

      findUses(workflow);
      return Array.from(actions);
    } catch (error) {
      console.log(`warn: Failed to parse workflow YAML: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch local composite action files from a repository
   * @param {string} repoUrl - Repository URL or owner/repo format
   * @param {Array} localActionPaths - Array of local action paths (e.g., ["./.github/actions/yarn-install"])
   * @returns {Promise<Array>} - Array of local action file contents
   */
  async fetchLocalActions(repoUrl, localActionPaths) {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const localActions = [];

    for (const actionPath of localActionPaths) {
      // Convert ./.github/actions/action-name to .github/actions/action-name/action.yml
      const cleanPath = actionPath.replace(/^\.\//, '');
      const possiblePaths = [
        `${cleanPath}/action.yml`,
        `${cleanPath}/action.yaml`
      ];

      for (const path of possiblePaths) {
        try {
          console.log(`info: Fetching local action: ${path}`);
          const { data: fileContent } = await this.octokit.rest.repos.getContent({
            owner,
            repo,
            path
          });

          const content = Buffer.from(fileContent.content, 'base64').toString('utf8');
          localActions.push({
            name: actionPath,
            path: path,
            content
          });
          break; // Found the action file, no need to check .yaml variant
        } catch (error) {
          if (error.status === 404) {
            continue; // Try next possible path
          }
          console.log(`warn: Could not fetch ${path}: ${error.message}`);
        }
      }
    }

    return localActions;
  }

  /**
   * Recursively scan local composite actions for their dependencies
   * @param {string} repoUrl - Repository URL or owner/repo format
   * @param {Set} localActionPaths - Set of local action paths to scan
   * @param {Set} scannedLocalActions - Set of already scanned local actions (prevents infinite recursion)
   * @param {Set} allExternalActions - Set to accumulate all external actions found
   * @param {number} depth - Current recursion depth for logging
   */
  async scanLocalActionsRecursively(repoUrl, localActionPaths, scannedLocalActions = new Set(), allExternalActions = new Set(), depth = 1) {
    if (localActionPaths.size === 0) {
      return;
    }

    const newLocalActions = new Set();
    const pathsToScan = Array.from(localActionPaths).filter(path => !scannedLocalActions.has(path));
    
    if (pathsToScan.length === 0) {
      console.log(`info: No new local actions to scan at depth ${depth}`);
      return;
    }

    console.log(`info: Recursively scanning ${pathsToScan.length} local composite actions at depth ${depth}`);
    const localActionFiles = await this.fetchLocalActions(repoUrl, pathsToScan);
    
    for (const localAction of localActionFiles) {
      console.log(`info: Processing local action ${localAction.name} (depth ${depth})`);
      
      // Mark this local action as scanned to prevent infinite recursion
      scannedLocalActions.add(localAction.name);
      
      const actions = this.extractActionsFromWorkflow(localAction.content);
      
      // Separate external and local actions
      const externalActions = [];
      const nestedLocalActions = [];
      
      actions.forEach(action => {
        if (action.startsWith('./') || action.startsWith('../')) {
          nestedLocalActions.push(action);
          newLocalActions.add(action);
        } else {
          externalActions.push(action);
          allExternalActions.add(action);
        }
      });
      
      if (externalActions.length > 0) {
        console.log(`info: Found ${externalActions.length} external actions in local action ${localAction.name}: ${externalActions.join(', ')}`);
      }
      
      if (nestedLocalActions.length > 0) {
        console.log(`info: Found ${nestedLocalActions.length} nested local actions in ${localAction.name}: ${nestedLocalActions.join(', ')}`);
      }
    }

    // Recursively scan any newly discovered local actions
    if (newLocalActions.size > 0) {
      await this.scanLocalActionsRecursively(repoUrl, newLocalActions, scannedLocalActions, allExternalActions, depth + 1);
    }
  }

  /**
   * Scan a repository for all GitHub Actions used in workflows, including recursive local composite actions
   * @param {string} repoUrl - Repository URL
   * @returns {Promise<Array>} - Array of unique action references (external actions only for root scanning)
   */
  async scanRepositoryWorkflows(repoUrl) {
    const workflows = await this.fetchWorkflowFiles(repoUrl);
    const allExternalActions = new Set();
    const rootLevelLocalActions = new Set();

    console.log(`info: Parsing ${workflows.length} workflow files for action references`);

    // First pass: scan all workflow files
    for (const workflow of workflows) {
      console.log(`info: Processing ${workflow.name}`);
      const actions = this.extractActionsFromWorkflow(workflow.content);
      
      // Separate external actions from local actions
      const externalActions = [];
      const localActions = [];
      
      actions.forEach(action => {
        if (action.startsWith('./') || action.startsWith('../')) {
          localActions.push(action);
          rootLevelLocalActions.add(action);
        } else {
          externalActions.push(action);
          allExternalActions.add(action);
        }
      });
      
      console.log(`info: Found ${externalActions.length} external actions in ${workflow.name}: ${externalActions.join(', ')}`);
      if (localActions.length > 0) {
        console.log(`info: Found ${localActions.length} local actions in ${workflow.name}: ${localActions.join(', ')}`);
      }
    }

    // Second pass: recursively scan all local composite actions
    if (rootLevelLocalActions.size > 0) {
      console.log(`info: Starting recursive scan of ${rootLevelLocalActions.size} root-level local composite actions`);
      await this.scanLocalActionsRecursively(repoUrl, rootLevelLocalActions, new Set(), allExternalActions);
    }

    const uniqueActions = Array.from(allExternalActions);
    console.log(`info: Found ${uniqueActions.length} unique external action references across all workflows and local actions (all depths)`);
    
    return uniqueActions;
  }
}