// PromotionsManager.js
import puppeteer from "puppeteer-core";

export class PromotionsManager {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async getActivePromotions() {
    await this.page.goto(`${this.baseUrl}/promotions`);
    
    const promos = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('.promo-card')).map(el => ({
        code: el.dataset.promoCode,
        description: el.querySelector('.desc').textContent.trim()
      }));
    });
    return promos;
  }

  async applyPromoToBet(promoCode) {
    await this.page.type('.promo-input', promoCode);
    await this.page.click('.apply-promo-btn');
    console.log(`Applied promo: ${promoCode}`);
  }

  async highlightBoostedOdds() {
    // Click to show boosted odds
    await this.page.click('.boosted-odds-toggle');
    console.log('Highlighted boosted odds');
  }
}
