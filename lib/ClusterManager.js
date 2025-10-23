// lib/ClusterManager.js
import { Cluster } from 'puppeteer-cluster';
import { SportsbookApp } from './SportsbookApp.js';
import logger from './logger.js';

let clusterInstance = null;

export class ClusterManager {
  static otpStore = new Map();

  static async initCluster(maxConcurrency = 2) { // Add maxConcurrency parameter with default
    if (!clusterInstance) {
      const browserPath = process.env.BROWSER_PATH || '/usr/bin/chromium';
      try {
        clusterInstance = await Cluster.launch({
          concurrency: Cluster.CONCURRENCY_CONTEXT,
          maxConcurrency: Math.max(1, maxConcurrency), // Ensure at least 1
          puppeteerOptions: {
            headless: true,
            executablePath: browserPath,
          },
        });
        logger.info(`✅ Puppeteer cluster launched with maxConcurrency: ${maxConcurrency} using path: ${browserPath}`);
      } catch (error) {
        logger.error(`❌ Failed to launch Puppeteer cluster: ${error.message}`);
        throw error;
      }
    }
    return clusterInstance;
  }

  static storeOtp(bookie, otpData) {
    this.otpStore.set(bookie, {
      ...otpData,
      receivedAt: Date.now(),
    });
    logger.info(`Stored OTP for ${bookie}`);
  }

  static async getOtpForBookie(bookie, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const otpData = this.otpStore.get(bookie);
      if (otpData) {
        this.otpStore.delete(bookie);
        return otpData;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  }

  static async queueBet({ config, betRequest, nc }) {
    if (!clusterInstance) {
      throw new Error('Cluster not initialized');
    }

    const bookie = betRequest.Bookie || (betRequest.bets ? betRequest.bets[0]?.Bookie : config.name);
    if (!bookie) {
      throw new Error('No bookie specified in betRequest');
    }

    if (betRequest.BetType === 'arb' && betRequest.bets) {
      const relevantBets = betRequest.bets.filter(bet => bet.Bookie === config.name);
      if (!relevantBets.length) {
        logger.warn(`No bets for bookie ${config.name} in ArbCycleID ${betRequest.ArbCycleID}`);
        return;
      }
      betRequest.bets = relevantBets;
    } else if (betRequest.Bookie !== config.name) {
      logger.warn(`Bet ${betRequest.BetID} not for bookie ${config.name}; skipping`);
      return;
    }

    await clusterInstance.queue(async ({ page }) => {
      const sportsbookApp = new SportsbookApp({
        page,
        config: { name: bookie, ...config },
        nc,
      });
      try {
        await sportsbookApp.launchApp();
        await sportsbookApp.login();
        const result = await sportsbookApp.placeBet(betRequest);
        logger.info(`Processed bet: ${JSON.stringify(result)}`);
        return result;
      } catch (err) {
        logger.error(`Failed to process bet ${betRequest.BetID} for ${bookie}: ${err.message}`);
        throw err;
      }
    });
  }

  static async closeCluster() {
    if (clusterInstance) {
      await clusterInstance.close().catch(e => logger.warn(`Error closing cluster: ${e.message}`));
      clusterInstance = null;
      logger.info('Puppeteer cluster closed');
    }
  }
}
