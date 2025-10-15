// main.js
import dotenv from 'dotenv';
import { GitHubRepoMonitor } from './GitHubRepoMonitor.js';
import { NATSListener } from './NATSListener.js';
import { ClusterManager } from './ClusterManager.js';
import logger from './logger.js';

dotenv.config();

let currentConfig = null;
let natsListener = null;

async function main() {
  try {
    // Initialize GitHubRepoMonitor to fetch the latest configuration
    const repoMonitor = new GitHubRepoMonitor('sxcntqnt', 'L3-M', 'EMC', './EMC');
    const latestConfig = await repoMonitor.getLatestConfigDetails();

    // Find the first valid config from the array
    const validConfig = latestConfig.find(configItem => configItem.config && configItem.config.name);
    if (!validConfig) {
      throw new Error('No valid config found');
    }

    currentConfig = validConfig.config;
    logger.info(`Loaded configuration for bookie: ${currentConfig.name}`);

    // Initialize the Puppeteer cluster via ClusterManager
    // This cluster will instantiate SportsbookApp for each bet placement task
    await ClusterManager.initCluster();
    logger.info('Puppeteer cluster initialized, ready to process bets with SportsbookApp');

    // Initialize and start the NATS listener with the current configuration
    // NATSListener will queue bets to ClusterManager, which uses SportsbookApp
    natsListener = new NATSListener(currentConfig);
    await natsListener.connect();
    logger.info('NATS listener started, listening for bet requests');

    logger.info('Application started successfully');
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    await cleanup();
  }
}

async function cleanup() {
  logger.info('Shutting down...');
  // Close the Puppeteer cluster (terminates any active SportsbookApp instances)
  await ClusterManager.closeCluster();
  // Close the NATS connection
  if (natsListener) {
    await natsListener.close();
  }
  logger.info('Shutdown complete');
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  main();
}
