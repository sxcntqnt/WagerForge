// BetConfirmation.js
import puppeteer from "puppeteer-core";

export class BetConfirmation {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async showConfirmationModal() {
    // Trigger modal (assuming from bet slip)
    await this.page.click('.confirm-bet-btn');
    await this.page.waitForSelector('.confirmation-modal');
    console.log('Confirmation modal shown');
  }

  async confirmBet() {
    await this.page.click('.modal .confirm-btn');
    await this.page.waitForSelector('.success-message', { timeout: 5000 });
    console.log('Bet confirmed');
  }

  async showError(message) {
    // Simulate error display
    await this.page.evaluate((msg) => {
      // In real impl, use alert or modal
      alert(msg);
    }, message);
    console.log(`Error shown: ${message}`);
  }

  async displayBetSummary() {
    const summary = await this.page.evaluate(() => {
      return document.querySelector('.bet-summary').innerHTML;
    });
    console.log('Bet summary:', summary);
    return summary;
  }
}
