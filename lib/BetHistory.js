// BetHistory.js
import puppeteer from "puppeteer-core";

export class BetHistory {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Retrieve past bets from the user's bet history
  async getPastBets() {
    const { selectors } = this.config;

    try {
      // Navigate to the bet history page and wait for the page to load
      await this.page.goto(`${this.config.base_url}/history`);
      await this.page.waitForSelector(selectors.bet_history.bet_row_selector, { visible: true, timeout: 5000 });
      console.log("Successfully loaded bet history page.");

      // Scrape past bets
      const bets = await this.page.evaluate((betRowSelector, eventSelector, stakeSelector, outcomeSelector) => {
        const betRows = Array.from(document.querySelectorAll(betRowSelector));
        if (betRows.length === 0) {
          console.log('No past bets found.');
          return []; // Return empty array if no bets found
        }
        
        return betRows.map(el => ({
          id: el.dataset.betId,
          event: el.querySelector(eventSelector)?.textContent.trim() || 'N/A',
          stake: el.querySelector(stakeSelector)?.textContent.trim() || 'N/A',
          outcome: el.querySelector(outcomeSelector)?.textContent.trim() || 'N/A'
        }));
      }, selectors.bet_history.bet_row_selector, selectors.bet_history.event_selector, selectors.bet_history.stake_selector, selectors.bet_history.outcome_selector);

      console.log(`Retrieved ${bets.length} past bets.`);
      return bets;
    } catch (error) {
      console.error('Failed to retrieve past bets:', error.message);
      throw error;
    }
  }

  // Filter the bet history by result (win/loss/void)
  async filterByResult(outcome) {
    const { selectors } = this.config;

    try {
      // Wait for the result filter dropdown to be available
      await this.page.waitForSelector(selectors.bet_history.result_filter_select, { visible: true, timeout: 5000 });

      // Select the result filter dropdown and apply the selected filter
      await this.page.select(selectors.bet_history.result_filter_select, outcome);
      console.log(`Filtered history by result: ${outcome}`);
    } catch (error) {
      console.error('Failed to filter by result:', error.message);
      throw error;
    }
  }

  // Filter the bet history by market type (e.g., spread, moneyline, totals)
  async filterByMarketType(type) {
    const { selectors } = this.config;

    try {
      // Wait for the market type filter to be available
      await this.page.waitForSelector(selectors.bet_history.market_type_filter_select, { visible: true, timeout: 5000 });

      // Select the market type filter and apply the selected type
      await this.page.select(selectors.bet_history.market_type_filter_select, type);
      console.log(`Filtered history by market: ${type}`);
    } catch (error) {
      console.error('Failed to filter by market type:', error.message);
      throw error;
    }
  }
}

