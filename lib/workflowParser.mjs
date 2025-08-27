import { Octokit } from 'octokit';
import yaml from 'js-yaml';

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
      const workflow = yaml.load(yamlContent);
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
            // Extract action reference (ignore local actions starting with ./)
            if (!value.startsWith('./') && !value.startsWith('../')) {
              actions.add(value.trim());
            }
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
   * Scan a repository for all GitHub Actions used in workflows, including local composite actions
   * @param {string} repoUrl - Repository URL
   * @returns {Promise<Array>} - Array of unique action references (external actions only for root scanning)
   */
  async scanRepositoryWorkflows(repoUrl) {
    const workflows = await this.fetchWorkflowFiles(repoUrl);
    const allActions = new Set();
    const localActionPaths = new Set();

    console.log(`info: Parsing ${workflows.length} workflow files for action references`);

    for (const workflow of workflows) {
      console.log(`info: Processing ${workflow.name}`);
      const actions = this.extractActionsFromWorkflow(workflow.content);
      
      // Separate external actions from local actions
      const externalActions = [];
      const localActions = [];
      
      actions.forEach(action => {
        if (action.startsWith('./') || action.startsWith('../')) {
          localActions.push(action);
          localActionPaths.add(action);
        } else {
          externalActions.push(action);
          allActions.add(action);
        }
      });
      
      console.log(`info: Found ${externalActions.length} external actions in ${workflow.name}: ${externalActions.join(', ')}`);
      if (localActions.length > 0) {
        console.log(`info: Found ${localActions.length} local actions in ${workflow.name}: ${localActions.join(', ')}`);
      }
    }

    // Now scan local composite actions for their dependencies
    if (localActionPaths.size > 0) {
      console.log(`info: Scanning ${localActionPaths.size} local composite actions for dependencies`);
      const localActionFiles = await this.fetchLocalActions(repoUrl, Array.from(localActionPaths));
      
      for (const localAction of localActionFiles) {
        console.log(`info: Processing local action ${localAction.name}`);
        const actions = this.extractActionsFromWorkflow(localAction.content);
        
        // Only add external actions from local actions to the final set
        const externalActionsInLocal = actions.filter(action => 
          !action.startsWith('./') && !action.startsWith('../')
        );
        
        if (externalActionsInLocal.length > 0) {
          console.log(`info: Found ${externalActionsInLocal.length} external actions in local action ${localAction.name}: ${externalActionsInLocal.join(', ')}`);
          externalActionsInLocal.forEach(action => allActions.add(action));
        }
      }
    }

    const uniqueActions = Array.from(allActions);
    console.log(`info: Found ${uniqueActions.length} unique external action references across all workflows and local actions`);
    
    return uniqueActions;
  }
}