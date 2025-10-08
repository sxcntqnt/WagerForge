import { readFileSync } from 'fs';
import yaml from "js-yaml";
import logger from './logger.js';
import { GitHubRepoMonitor } from './GitHubRepoMonitor.js';

let executor = null;
let currentConfigHash = null;
let repoMonitor = null;

/**
 * Sets the current executor instance
 */
export function setExecutor(newExecutor) {
  executor = newExecutor;
}

/**
 * Returns the current executor instance
 */
export function getExecutor() {
  return executor;
}

/**
 * Initializes the GitHubRepoMonitor and starts polling for config changes.
 */
export async function initConfigWatcher({
  repoOwner,
  repoName,
  folderPath,
  localFolderPath = './EMC',
  intervalMs = 5 * 60 * 1000, // default 5 minutes
}) {
  repoMonitor = new GitHubRepoMonitor(repoOwner, repoName, folderPath, localFolderPath);

  const latestConfig = await repoMonitor.getLatestConfigDetails();
  currentConfigHash = latestConfig.hash;

  setExecutor(new Executor(latestConfig.config));
  await executor.initialize();
  logger.info(`Executor initialized with config from EMC/${latestConfig.folder}`);

  // Watch for config changes
  setInterval(async () => {
    try {
      const newConfig = await repoMonitor.getLatestConfigDetails();
      if (newConfig.hash !== currentConfigHash) {
        logger.info(`Detected config change. Reloading executor from EMC/${newConfig.folder}`);
        currentConfigHash = newConfig.hash;

        const newExecutor = new Executor(newConfig.config);
        await newExecutor.initialize();
        setExecutor(newExecutor);
      } else {
        logger.info(`No config changes. Current source: EMC/${newConfig.folder}`);
      }
    } catch (error) {
      logger.error(`Error during config watcher update: ${error.message}`);
    }
  }, intervalMs);
}

