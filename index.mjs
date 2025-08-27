import dotenv from 'dotenv';
import { program, InvalidArgumentError } from 'commander';
import { resolve } from 'node:path';
import { writeFileSync } from 'fs';

import { logger, GITHUB_URL_RE } from './lib/utils.mjs';
import { RecursiveActionScanner } from './lib/scanner.mjs';
import { WorkflowParser } from './lib/workflowParser.mjs';

function validateUrl(url) {
  // Allow both full URLs and owner/repo format
  const ownerRepoPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
  if (!url.match(GITHUB_URL_RE) && !url.match(ownerRepoPattern)) {
    throw new InvalidArgumentError("Invalid Github URL or owner/repo format");
  }
  return url;
}

function parseGitHubUrl(url) {
  const match = url.match(GITHUB_URL_RE);
  if (!match) {
    throw new Error("Invalid GitHub URL");
  }
  return match.groups;
}

function outputResults(results, outputPath, format) {
  let output;
  
  if (format === 'json') {
    output = JSON.stringify(results, null, 2);
  } else {
    output = generateTextReport(results);
  }
  
  if (outputPath) {
    writeFileSync(outputPath, output);
    logger.info(`Results written to ${outputPath}`);
  } else {
    console.log(output);
  }
}

function generateTextReport(results) {
  const { summary, rootActions, allUniqueActions } = results;
  
  let report = `
# Recursive Action Scanner Report
Generated: ${results.timestamp}

## Summary
- Root actions scanned: ${summary.totalRootActions}
- Total unique actions found: ${summary.totalUniqueActions}
- Max recursion depth: ${summary.maxDepthUsed}

## Root Actions\n`;

  for (const rootAction of rootActions) {
    report += `\n### ${rootAction.reference}\n`;
    if (rootAction.success) {
      report += `- Status: ✅ Success\n`;
      report += `- Dependencies found: ${rootAction.totalDependencies}\n`;
      if (rootAction.dependencies.length > 0) {
        report += `- Dependency tree:\n`;
        for (const dep of rootAction.dependencies) {
          report += `  - ${dep.fullName} (${dep.url})\n`;
        }
      }
    } else {
      report += `- Status: ❌ Failed\n`;
      report += `- Error: ${rootAction.error}\n`;
    }
  }

  report += `\n## All Unique Actions (${allUniqueActions.length})\n`;
  for (const action of allUniqueActions) {
    const type = action.isRootAction ? '(ROOT)' : '';
    report += `- ${action.fullName} ${type}\n  ${action.url}\n`;
  }

  return report;
}

async function main() {
  dotenv.config();
  
  logger.info("Recursive Action Scanner v1.0.0");
  
  program
    .description('Recursively scan GitHub Actions from PR changes')
    .option('-e, --env <path>', '.env file path.', '.env')
    .option('-m, --max-depth <depth>', 'Max recursion depth', parseInt, 5)
    .option('--output <path>', 'Output file path.')
    .option('-f, --format <format>', 'Output format (json|text)', 'text');

  program.command("scan-pr")
    .description("Scan actions from a Pull Request")
    .requiredOption('-u, --url <string>', 'GitHub repository URL', validateUrl)
    .requiredOption('-p, --pr <number>', 'Pull Request number', parseInt)
    .action(async ({ url, pr }, _options) => {
      const options = { ..._options.opts(), ..._options.parent.opts() };
      const { owner, repo } = parseGitHubUrl(url);
      const scanner = new RecursiveActionScanner({ maxDepth: options.maxDepth });
      
      try {
        const results = await scanner.scanFromPR(owner, repo, pr);
        outputResults(results, options.output, options.format);
      } catch (e) {
        logger.error(`Scan failed: ${e.message}`);
        process.exit(1);
      }
    });

  program.command("scan-commit")
    .description("Scan actions from a specific commit")
    .requiredOption('-u, --url <string>', 'GitHub repository URL', validateUrl)
    .requiredOption('-s, --sha <string>', 'Commit SHA')
    .action(async ({ url, sha }, _options) => {
      const options = { ..._options.opts(), ..._options.parent.opts() };
      const { owner, repo } = parseGitHubUrl(url);
      const scanner = new RecursiveActionScanner({ maxDepth: options.maxDepth });
      
      try {
        const results = await scanner.scanFromCommit(owner, repo, sha);
        outputResults(results, options.output, options.format);
      } catch (e) {
        logger.error(`Scan failed: ${e.message}`);
        process.exit(1);
      }
    });

  program.command("scan-action")
    .description("Scan a specific action directly")
    .requiredOption('-a, --action <string>', 'Action reference (org/action@ref)')
    .action(async ({ action }, _options) => {
      const options = { ..._options.opts(), ..._options.parent.opts() };
      const scanner = new RecursiveActionScanner({ maxDepth: options.maxDepth });
      
      try {
        const results = await scanner.scanActionList([action]);
        outputResults(results, options.output, options.format);
      } catch (e) {
        logger.error(`Scan failed: ${e.message}`);
        process.exit(1);
      }
    });

  program.command("scan-repo")
    .description("Scan all GitHub Actions used in a repository's workflows")
    .requiredOption('-u, --url <string>', 'GitHub repository URL or owner/repo format', validateUrl)
    .action(async ({ url }, _options) => {
      const options = { ..._options.opts(), ..._options.parent.opts() };
      const githubToken = process.env.GITHUB_TOKEN;
      
      if (!githubToken) {
        logger.error('GITHUB_TOKEN environment variable is required for repository scanning');
        process.exit(1);
      }
      
      const workflowParser = new WorkflowParser(githubToken);
      const scanner = new RecursiveActionScanner({ maxDepth: options.maxDepth });
      
      try {
        logger.info(`Starting repository workflow scan for ${url}`);
        const actionReferences = await workflowParser.scanRepositoryWorkflows(url);
        
        if (actionReferences.length === 0) {
          logger.info('No GitHub Actions found in repository workflows');
          const emptyResults = {
            timestamp: new Date().toISOString(),
            summary: {
              totalRootActions: 0,
              totalUniqueActions: 0,
              maxDepthUsed: options.maxDepth
            },
            rootActions: [],
            allUniqueActions: []
          };
          outputResults(emptyResults, options.output, options.format);
          return;
        }
        
        logger.info(`Found ${actionReferences.length} unique actions, starting recursive scan`);
        const results = await scanner.scanActionList(actionReferences);
        outputResults(results, options.output, options.format);
      } catch (e) {
        logger.error(`Repository scan failed: ${e.message}`);
        process.exit(1);
      }
    });

  program.parse();
}

await main();