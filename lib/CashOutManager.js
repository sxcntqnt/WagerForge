// CashOutManager.js
import puppeteer from "puppeteer-core";

export class CashOutManager {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Get a list of cancellable bets
  async getCancellableBets() {
    const { base_url, selectors } = this.config;

    try {
      await this.page.goto(`${base_url}/open-bets`, { waitUntil: 'domcontentloaded' });

      // Extract bets that are cancellable from the page
      const bets = await this.page.evaluate((selector) => {
        return Array.from(document.querySelectorAll(selector)).map(el => el.dataset.betId);
      }, selectors.cashout_manager.cancellable_bet_selector);

      console.log(`Found ${bets.length} cancellable bets.`);
      return bets;
    } catch (error) {
      console.error('Failed to get cancellable bets:', error.message);
      throw error;
    }
  }

  // Show the cash-out offer for a specific bet
  async showCashOutOffer(betId) {
    const { selectors } = this.config;

    try {
      // Wait for the cash-out button to be visible before clicking
      const cashoutButtonSelector = `${selectors.cashout_manager.cashout_button}[data-id="${betId}"]`;
      await this.page.waitForSelector(cashoutButtonSelector, { visible: true, timeout: 5000 });

      // Click on the cash-out button for the specified bet
      await this.page.click(cashoutButtonSelector);
      await this.page.waitForSelector(selectors.cashout_manager.cashout_offer_selector, { timeout: 5000 });

      // Retrieve the cash-out offer amount
      const offer = await this.page.evaluate((offerSelector) => {
        const offerElement = document.querySelector(offerSelector);
        return offerElement ? offerElement.textContent.trim() : 'Offer not found';
      }, selectors.cashout_manager.cashout_amount);

      console.log(`Cash-out offer for ${betId}: ${offer}`);
      return offer;
    } catch (error) {
      console.error(`Failed to show cash-out offer for bet ${betId}:`, error.message);
      throw error;
    }
  }

  // Cash out a specific bet
  async cashOut(betId) {
    const { selectors } = this.config;

    try {
      // Ensure the cash-out button is available and click it
      await this.page.waitForSelector(selectors.cashout_manager.confirm_cashout_button, { visible: true, timeout: 5000 });
      await this.page.click(selectors.cashout_manager.confirm_cashout_button);

      console.log(`Cashed out bet ${betId}`);
    } catch (error) {
      console.error(`Failed to cash out bet ${betId}:`, error.message);
      throw error;
    }
  }

  // Edit an open bet (for example, changing the stake)
  async editOpenBet(betId, newStake) {
    const { selectors } = this.config;

    try {
      // Open the edit modal for the bet
      await this.page.waitForSelector(`${selectors.cashout_manager.edit_button}[data-id="${betId}"]`, { visible: true, timeout: 5000 });
      await this.page.click(`${selectors.cashout_manager.edit_button}[data-id="${betId}"]`);

      // Wait for the stake input field and change the stake
      await this.page.waitForSelector(selectors.cashout_manager.edit_stake_input, { visible: true, timeout: 5000 });
      await this.page.type(selectors.cashout_manager.edit_stake_input, newStake.toString(), { delay: 100 });

      // Click save after editing the stake
      await this.page.click(selectors.cashout_manager.save_edit_button);

      console.log(`Edited bet ${betId} stake to ${newStake}`);
    } catch (error) {
      console.error(`Failed to edit open bet ${betId}:`, error.message);
      throw error;
    }
  }
}

