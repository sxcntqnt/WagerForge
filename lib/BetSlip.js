// BetSlip.js
import puppeteer from "puppeteer-core";

export class BetSlip {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Add a selection to the bet slip
  async addSelectionToSlip(selection) {
    const { selectors } = this.config;

    try {
      // Wait for the bet slip item to appear in the page
      await this.page.waitForSelector(selectors.bet_slip.bet_item_selector, { visible: true, timeout: 5000 });
      console.log(`Added selection to slip: ${JSON.stringify(selection)}`);
    } catch (error) {
      console.error('Failed to add selection to slip:', error.message);
      throw error;
    }
  }

  // Remove a selection from the bet slip
  async removeSelectionFromSlip(selectionId) {
    const { selectors } = this.config;

    try {
      // Wait for the remove button to be visible for the specific selection
      const selector = `${selectors.bet_slip.bet_item_selector}[data-id="${selectionId}"] ${selectors.bet_slip.remove_button}`;
      await this.page.waitForSelector(selector, { visible: true, timeout: 5000 });

      // Click the remove button for the specified selection
      await this.page.click(selector);
      console.log(`Removed selection ${selectionId} from slip`);
    } catch (error) {
      console.error('Failed to remove selection from slip:', error.message);
      throw error;
    }
  }

  // Set the stake amount for the bet slip
  async setStake(amount) {
    const { selectors } = this.config;

    try {
      // Wait for the stake input to be available
      await this.page.waitForSelector(selectors.bet_slip.stake_input, { visible: true, timeout: 5000 });

      // Type the amount into the stake input field
      await this.page.type(selectors.bet_slip.stake_input, amount.toString());
      
      // Wait a bit to ensure the value is set
      await this.page.waitForTimeout(500);

      // Verify if the stake was correctly set
      const currentStake = await this.page.$eval(selectors.bet_slip.stake_input, input => input.value);
      if (currentStake === amount.toString()) {
        console.log(`Successfully set stake to $${amount}`);
      } else {
        console.error('Failed to set the correct stake.');
      }
    } catch (error) {
      console.error('Failed to set stake:', error.message);
      throw error;
    }
  }

  // Calculate the potential payout based on the selections
  async calculatePotentialPayout() {
    const { selectors } = this.config;

    try {
      // Wait for the potential payout element to appear
      await this.page.waitForSelector(selectors.bet_slip.potential_payout, { visible: true, timeout: 5000 });

      // Get the potential payout from the page
      const payout = await this.page.evaluate((selector) => {
        const payoutElement = document.querySelector(selector);
        const payoutText = payoutElement ? payoutElement.textContent.replace('$', '').trim() : '0';
        return parseFloat(payoutText) || 0;
      }, selectors.bet_slip.potential_payout);

      console.log(`Potential payout calculated: $${payout}`);
      return payout;
    } catch (error) {
      console.error('Failed to calculate potential payout:', error.message);
      throw error;
    }
  }

  // Clear the bet slip
  async clearSlip() {
    const { selectors } = this.config;

    try {
      // Wait for the clear button to be visible before clicking
      await this.page.waitForSelector(selectors.bet_slip.clear_button, { visible: true, timeout: 5000 });

      // Click the clear bet slip button
      await this.page.click(selectors.bet_slip.clear_button);
      console.log('Cleared bet slip');
    } catch (error) {
      console.error('Failed to clear bet slip:', error.message);
      throw error;
    }
  }
}

