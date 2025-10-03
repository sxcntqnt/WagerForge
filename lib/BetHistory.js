// BetHistory.js
import puppeteer from "puppeteer-core";

export class BetHistory {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async getPastBets() {
    await this.page.goto(`${this.baseUrl}/history`);
    
    const bets = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('.bet-row')).map(el => ({
        id: el.dataset.betId,
        event: el.querySelector('.event').textContent.trim(),
        stake: el.querySelector('.stake').textContent.trim(),
        outcome: el.querySelector('.outcome').textContent.trim()
      }));
    });
    return bets;
  }

  async filterByResult(outcome) {
    await this.page.select('.history-filter-result select', outcome);
    console.log(`Filtered history by result: ${outcome}`);
  }

  async filterByMarketType(type) {
    await this.page.select('.history-filter-market select', type);
    console.log(`Filtered history by market: ${type}`);
  }
}
