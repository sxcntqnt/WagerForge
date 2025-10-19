// PromotionsManager.js
import puppeteer from "puppeteer-core";

export class PromotionsManager {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Get Active Promotions using selectors from config
  async getActivePromotions() {
    const { base_url, selectors } = this.config;

    try {
      await this.page.goto(`${base_url}/promotions`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for the promotions to load on the page
      await this.page.waitForSelector(selectors.promotions.promo_card, { timeout: 5000 });

      const promos = await this.page.evaluate((promoSelector) => {
        return Array.from(document.querySelectorAll(promoSelector)).map(el => ({
          code: el.dataset.promoCode,
          description: el.querySelector('.desc')?.textContent.trim() || 'No description available'
        }));
      }, selectors.promotions.promo_card);

      console.log(`Found ${promos.length} active promotions`);
      return promos;
    } catch (error) {
      console.error('Failed to fetch active promotions:', error.message);
      throw error;
    }
  }

  // Apply a promo code to a bet using dynamic selectors from the config
  async applyPromoToBet(promoCode) {
    const { selectors } = this.config;

    try {
      // Wait for the promo input field to appear before typing the promo code
      await this.page.waitForSelector(selectors.promotions.promo_input, { timeout: 5000 });
      await this.page.type(selectors.promotions.promo_input, promoCode);

      // Wait for the apply promo button to appear before clicking
      await this.page.waitForSelector(selectors.promotions.apply_promo_btn, { timeout: 5000 });
      await this.page.click(selectors.promotions.apply_promo_btn);

      console.log(`Applied promo: ${promoCode}`);
    } catch (error) {
      console.error(`Failed to apply promo code "${promoCode}":`, error.message);
      throw error;
    }
  }

  // Highlight boosted odds using dynamic selector from the config
  async highlightBoostedOdds() {
    const { selectors } = this.config;

    try {
      // Wait for the boosted odds toggle to be available
      await this.page.waitForSelector(selectors.promotions.boosted_odds_toggle, { timeout: 5000 });
      await this.page.click(selectors.promotions.boosted_odds_toggle);

      console.log('Highlighted boosted odds');
    } catch (error) {
      console.error('Failed to highlight boosted odds:', error.message);
      throw error;
    }
  }
}

