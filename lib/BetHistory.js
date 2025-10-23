// BetHistory.js

import puppeteer from 'puppeteer-core';
import { NATSPublisher } from './NatsPublisher.js';
import logger from './logger.js';

export class BetHistory {
  constructor(page, config, nc) {
    this.page = page;
    this.config = config;
    this.nc = nc;
    this.selectors = config.selectors.bet_history;
    this.pollingInterval = config.polling?.interval || 300_000; // 5 minutes default
    this.settledBetsStore = new Set(); // Track published BetIDs
  }

  // Retrieve past bets from the user's bet history
  async getPastBets() {
    try {
      // Navigate to the bet history page and wait for the page to load
      await this.page.goto(`${this.config.base_url}/history`, {
        timeout: this.config.timeout?.page_load || 5000,
      });
      await this.page.waitForSelector(this.selectors.bet_row_selector, {
        visible: true,
        timeout: this.config.timeout?.selector_wait || 5000,
      });
      logger.info('Successfully loaded bet history page.');

      // Scrape past bets
      const bets = await this.page.evaluate((selectors) => {
        const betRows = Array.from(document.querySelectorAll(selectors.bet_row_selector));
        if (betRows.length === 0) {
          console.log('No past bets found.');
          return []; // Return empty array if no bets found
        }

        return betRows.map((el) => ({
          betId: el.dataset.betId || '',
          event: el.querySelector(selectors.event_selector)?.textContent.trim() || 'N/A',
          stake: parseFloat(el.querySelector(selectors.stake_selector)?.textContent.replace('$', '').trim()) || 0,
          outcome: el.querySelector(selectors.outcome_selector)?.textContent.trim() || 'N/A',
          payout: parseFloat(el.querySelector(selectors.payout_selector || '.payout')?.textContent.replace('$', '').trim()) || 0,
        })).filter((bet) => bet.betId && bet.outcome !== 'N/A');
      }, this.selectors);

      logger.info(`Retrieved ${bets.length} past bets from ${this.config.name}`);
      return bets;
    } catch (error) {
      logger.error(`Failed to retrieve past bets for ${this.config.name}: ${error.message}`);
      throw error;
    }
  }

  // Filter the bet history by result (win/loss/void)
  async filterByResult(outcome) {
    try {
      // Wait for the result filter dropdown to be available
      await this.page.waitForSelector(this.selectors.result_filter_select, {
        visible: true,
        timeout: this.config.timeout?.selector_wait || 5000,
      });

      // Select the result filter dropdown and apply the selected filter
      await this.page.select(this.selectors.result_filter_select, outcome);
      logger.info(`Filtered history by result: ${outcome}`);
    } catch (error) {
      logger.error(`Failed to filter by result for ${this.config.name}: ${error.message}`);
      throw error;
    }
  }

  // Filter the bet history by market type (e.g., spread, moneyline, totals)
  async filterByMarketType(type) {
    try {
      // Wait for the market type filter to be available
      await this.page.waitForSelector(this.selectors.market_type_filter_select, {
        visible: true,
        timeout: this.config.timeout?.selector_wait || 5000,
      });

      // Select the market type filter and apply the selected type
      await this.page.select(this.selectors.market_type_filter_select, type);
      logger.info(`Filtered history by market: ${type}`);
    } catch (error) {
      logger.error(`Failed to filter by market type for ${this.config.name}: ${error.message}`);
      throw error;
    }
  }

  // Monitor settled bets and publish to bets.settled
  async monitorSettledBets() {
    try {
      // Navigate to bet history page
      await this.page.goto(`${this.config.base_url}/history`, {
        timeout: this.config.timeout?.page_load || 5000,
      });
      await this.page.waitForSelector(this.selectors.history_page_link, {
        timeout: this.config.timeout?.selector_wait || 5000,
      });
      await this.page.click(this.selectors.history_page_link);

      const settledBets = await this.getPastBets();

      for (const bet of settledBets) {
        const { betId, event, stake, outcome, payout } = bet;
        if (this.settledBetsStore.has(betId)) {
          logger.info(`Skipping already published settled bet ${betId}`);
          continue;
        }

        // TODO: Retrieve missing fields from database or stored bet data
        const settledData = {
          BetID: betId,
          Bookie: this.config.name,
          match_id: event.split(' vs ')[0]?.replace(/[^0-9]/g, '') || '',
          team: event.split(' vs ')[0]?.split(' - ')[1] || '',
          side: '', // Retrieve from database
          odds: 0, // Retrieve from database
          win_rate: 0, // Retrieve
          ev: 0, // Retrieve
          strategy: '', // Retrieve
          search_query: '', // Retrieve
          home_team: event.split(' vs ')[0]?.split(' - ')[1] || '',
          away_team: event.split(' vs ')[1] || '',
          risk: 0, // Retrieve
          timestamp: new Date().toISOString(),
          eventId: event.split(' vs ')[0]?.replace(/[^0-9]/g, '') || '',
          stake,
          placed: true,
          hit: outcome.toLowerCase() === 'win',
          payout,
          profit: payout - stake,
          outcome,
        };

        NATSPublisher.publishSettled(settledData, this.nc, this);
        this.settledBetsStore.add(betId);
        logger.info(`Published settled bet ${betId} to bets.settled: outcome=${outcome}, payout=${payout}, profit=${settledData.profit}`);
      }
    } catch (error) {
      logger.error(`Failed to monitor settled bets for ${this.config.name}: ${error.message}`);
    }
  }

  // Start periodic settled bet monitoring
  startSettledBetMonitoring() {
    setInterval(() => {
      this.monitorSettledBets().catch((err) => logger.error(`Error in periodic settled bet monitoring for ${this.config.name}: ${err.message}`));
    }, this.pollingInterval);
    logger.info(`Started settled bet monitoring for ${this.config.name} with interval ${this.pollingInterval}ms`);
  }
}
