import winston from 'winston';

const GITHUB_URL_RE = /^https:\/\/github\.com\/(?<owner>[^\/]+)\/(?<repo>[^\/]+)(?:\/(?:tree|commit)\/(?<ref>[^\/]+))?/;
const ACTION_NAME_REGEX = /^(?<org>[^\/]+)\/(?<action>[^\/]+)(?:\/(?<subPath>[^@]+))?@(?<ref>.+)$/;

const logger = winston.createLogger({
  level: process.env?.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
  ),
  transports: [
    new winston.transports.Console()
  ],
});

function* actionSteps(yamlContent) {
  if (yamlContent.jobs) {
    for (const [jobKey, job] of Object.entries(yamlContent.jobs)) {
      if (job.steps) {
        for (const [stepidx, step] of job.steps.entries()) {
          yield [jobKey, job, step, stepidx];
        }
      }
    }
  }
  
  if (yamlContent.runs?.steps) {
    for (const [stepidx, step] of yamlContent.runs.steps.entries()) {
      yield ['composite', yamlContent.runs, step, stepidx];
    }
  }
}

export {
  logger,
  GITHUB_URL_RE,
  ACTION_NAME_REGEX,
  actionSteps
};