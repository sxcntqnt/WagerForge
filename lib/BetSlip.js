// BetSlip.js
import puppeteer from "puppeteer-core";

export class BetSlip {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async addSelectionToSlip(selection) {
    // Assuming selection is clicked elsewhere; here confirm addition
    await this.page.waitForSelector('.bet-slip-item', { timeout: 5000 });
    console.log(`Added selection to slip: ${JSON.stringify(selection)}`);
  }

  async removeSelectionFromSlip(selectionId) {
    const selector = `.bet-slip-item[data-id="${selectionId}"] .remove-btn`;
    await this.page.click(selector);
    console.log(`Removed selection ${selectionId} from slip`);
  }

  async setStake(amount) {
    await this.page.type('.stake-input', amount.toString());
    console.log(`Set stake to ${amount}`);
  }

  async calculatePotentialPayout() {
    // Trigger calculation if needed
    await this.page.click('.calculate-btn');
    
    const payout = await this.page.evaluate(() => {
      return parseFloat(document.querySelector('.potential-payout').textContent.replace('$', '')) || 0;
    });
    return payout;
  }

  async clearSlip() {
    await this.page.click('.clear-slip-btn');
    console.log('Cleared bet slip');
  }
}
