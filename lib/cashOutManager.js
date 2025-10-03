// CashOutManager.js
import puppeteer from "puppeteer-core";

export class CashOutManager {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async getCancellableBets() {
    await this.page.goto(`${this.baseUrl}/open-bets`);
    
    const bets = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('.open-bet[data-cancellable="true"]')).map(el => el.dataset.betId);
    });
    return bets;
  }

  async showCashOutOffer(betId) {
    await this.page.click(`.open-bet[data-id="${betId}"] .cashout-btn`);
    await this.page.waitForSelector('.cashout-offer');
    
    const offer = await this.page.evaluate(() => {
      return document.querySelector('.cashout-amount').textContent.trim();
    });
    console.log(`Cash out offer for ${betId}: ${offer}`);
    return offer;
  }

  async cashOut(betId) {
    await this.page.click(`.cashout-modal .confirm-cashout`);
    console.log(`Cashed out bet ${betId}`);
  }

  async editOpenBet(betId, newStake) {
    await this.page.click(`.open-bet[data-id="${betId}"] .edit-btn`);
    await this.page.type('.edit-stake-input', newStake.toString());
    await this.page.click('.save-edit-btn');
    console.log(`Edited bet ${betId} stake to ${newStake}`);
  }
}
