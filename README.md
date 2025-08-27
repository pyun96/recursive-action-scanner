# Recursive Action Scanner

A GitHub Action and CLI tool that recursively scans GitHub Actions and their dependencies. It can analyze Pull Request changes, specific commits, or individual actions to discover and map all recursive dependencies.

## Features

- 🔍 **Multiple scan modes**: PR changes, commits, or specific actions
- 🌲 **Recursive dependency mapping**: Discovers nested action dependencies 
- 📊 **Comprehensive reporting**: Generates detailed dependency trees
- 🚀 **Reusable GitHub Action**: Use in any repository workflow
- 📝 **Multiple output formats**: JSON and text reports
- 💬 **PR comments**: Posts scan results directly to pull requests
- 🎯 **CLI tool**: Standalone command-line interface

## Quick Start

### As a GitHub Action (Recommended)

Add this action to your workflow to automatically scan action dependencies:

```yaml
name: Scan Action Dependencies
on:
  pull_request:
    paths: ['**/*.md']

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pyun96/recursive-action-scanner@main
        with:
          mode: 'pr'
          pr-number: ${{ github.event.pull_request.number }}
          post-comment: true
```

### As a CLI Tool

#### Prerequisites

- Node.js 18+
- GitHub token with appropriate permissions
- npm or yarn

#### Installation

```bash
git clone <repository-url>
cd recursive-action-scanner
npm install
```

#### Configuration

1. Copy the environment file:
```bash
cp .env.example .env
```

2. Add your GitHub token to `.env`:
```
GITHUB_TOKEN=your_github_personal_access_token
```

#### Usage

```bash
# Scan from Pull Request
npm start -- scan-pr --url https://github.com/owner/repo --pr 123

# Scan from Commit
npm start -- scan-commit --url https://github.com/owner/repo --sha abc123

# Scan Specific Action
npm start -- scan-action --action "actions/checkout@v4"

# Alternative: run directly
node index.mjs scan-action --action "actions/checkout@v4"
```

#### Command Options

- `--max-depth <number>`: Maximum recursion depth (default: 5)
- `--format <json|text>`: Output format (default: text)
- `--output <path>`: Save results to file
- `--env <path>`: Custom .env file path

## GitHub Action Inputs & Outputs

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for API access | No | `${{ github.token }}` |
| `mode` | Scanning mode: `pr`, `commit`, or `action` | No | `pr` |
| `pr-number` | Pull request number (for `pr` mode) | No | - |
| `commit-sha` | Commit SHA (for `commit` mode) | No | - |
| `action-reference` | Action reference (for `action` mode) | No | - |
| `max-depth` | Maximum recursion depth | No | `5` |
| `output-format` | Output format: `json` or `text` | No | `json` |
| `post-comment` | Post results as PR comment | No | `true` |
| `comment-title` | Title for the PR comment | No | `🔍 Recursive Action Scanner Results` |

### Outputs

| Output | Description |
|--------|-------------|
| `results_json` | Scan results in JSON format |
| `results_text` | Scan results in text format |
| `total_actions` | Total number of unique actions found |
| `root_actions` | Number of root actions scanned |
| `scan_success` | Whether the scan completed successfully |

## Usage Examples

### 1. Scan PR Changes
```yaml
- uses: pyun96/recursive-action-scanner@main
  with:
    mode: pr
    pr-number: ${{ github.event.pull_request.number }}
    max-depth: 10
```

### 2. Scan Specific Commit
```yaml
- uses: pyun96/recursive-action-scanner@main
  with:
    mode: commit
    commit-sha: ${{ github.sha }}
```

### 3. Scan Individual Action
```yaml
- uses: pyun96/recursive-action-scanner@main
  with:
    mode: action
    action-reference: 'actions/setup-node@v4'
    post-comment: false
```

### 4. Advanced Usage with Custom Token
```yaml
- uses: pyun96/recursive-action-scanner@main
  with:
    mode: pr
    pr-number: ${{ github.event.pull_request.number }}
    github-token: ${{ secrets.CUSTOM_GITHUB_TOKEN }}
    output-format: text
    comment-title: 'Custom Action Dependency Report'
```

## How It Works

### Input Detection
The scanner looks for GitHub Action references in markdown files using this pattern:
```
org/actionname@reference
```

Supported reference types:
- **Version tags**: `actions/checkout@v4`, `actions/setup-node@v3.2.1`
- **Branch names**: `custom-org/my-action@main`, `user/action@develop`  
- **Commit hashes**: `actions/upload-artifact@abc123def456789...` (full 40-char SHA)

### PR Scanning Behavior
When scanning Pull Requests, the scanner analyzes **only the newly added lines** in the PR diff, not the entire file content. This means:

- ✅ **Scans only new actions**: Only action references added in the PR are analyzed
- ✅ **Ignores existing actions**: Previously approved actions in the file are not re-scanned
- ✅ **Efficient processing**: Faster scanning by focusing on changes
- 🔄 **Fallback support**: If diff data is unavailable, falls back to full file scan

### Recursive Scanning
For each detected action:
1. Fetches the `action.yml`/`action.yaml` file
2. Parses all `uses:` statements in steps
3. Recursively scans each dependency
4. Builds a comprehensive dependency tree

### Output Generation
Produces detailed reports including:
- Summary statistics
- Root action information  
- Complete dependency trees
- Unique action inventory
- Success/failure status for each scan

## Example Output

### Text Format
```
# Recursive Action Scanner Report
Generated: 2024-01-01T12:00:00.000Z

## Summary
- Root actions scanned: 2
- Total unique actions found: 8
- Max recursion depth: 5

## Root Actions

### actions/checkout@v4
- Status: ✅ Success
- Dependencies found: 3
- Dependency tree:
  - actions/setup-node@v3 (https://github.com/actions/setup-node/tree/v3)
  - actions/cache@v3 (https://github.com/actions/cache/tree/v3)
```

### JSON Format
```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "summary": {
    "totalRootActions": 1,
    "totalUniqueActions": 4,
    "maxDepthUsed": 5
  },
  "rootActions": [
    {
      "reference": "actions/checkout@v4",
      "success": true,
      "totalDependencies": 3,
      "dependencies": [...]
    }
  ],
  "allUniqueActions": [...]
}
```

## Architecture

### Core Components

- **`PRParser`**: Extracts action references from PR file changes
- **`Action`**: Represents individual GitHub Actions with dependency scanning
- **`RecursiveActionScanner`**: Orchestrates the scanning process
- **`ActionCache`**: Prevents duplicate scans of the same actions

### Key Features

- **Caching**: Avoids re-scanning identical actions
- **Error handling**: Gracefully handles missing or invalid actions
- **Rate limiting**: Respects GitHub API limits
- **Configurable depth**: Prevents infinite recursion

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality  
4. Submit a pull request

## License

MIT License - see LICENSE file for details