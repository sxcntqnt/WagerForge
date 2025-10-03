// LiveBetting.js
import puppeteer from "puppeteer-core";

export class LiveBetting {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async getLiveGames() {
    // Navigate to live section
    await this.page.goto(`${this.baseUrl}/live`);
    
    const games = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('.live-game')).map(el => ({
        id: el.dataset.gameId,
        teams: el.querySelector('.teams').textContent.trim(),
        score: el.querySelector('.score').textContent.trim()
      }));
    });
    return games;
  }

  async selectLiveEvent(eventId) {
    await this.page.click(`.live-game[data-id="${eventId}"]`);
    console.log(`Selected live event ${eventId}`);
  }

  async placeInPlayBet(selection) {
    // Similar to regular bet, but in live context
    await this.page.click(`.live-odds [data-selection="${selection}"]`);
    await this.page.click('.place-live-bet-btn');
    console.log(`Placed in-play bet: ${selection}`);
  }

  async updateLiveOdds(eventId) {
    await this.page.goto(`${this.baseUrl}/live/${eventId}`);
    
    // Wait for odds update (poll or wait)
    await this.page.waitForTimeout(2000);
    
    const odds = await this.page.evaluate(() => {
      return document.querySelector('.live-odds').textContent.trim();
    });
    console.log(`Updated live odds for ${eventId}: ${odds}`);
    return odds;
  }
}
