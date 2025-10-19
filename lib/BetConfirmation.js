// BetConfirmation.js
import puppeteer from "puppeteer-core";

export class BetConfirmation {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Trigger the confirmation modal (usually from the bet slip)
  async showConfirmationModal() {
    const { selectors } = this.config;

    try {
      // Click the button to show the confirmation modal
      await this.page.click(selectors.bet_confirmation.confirm_btn);
      await this.page.waitForSelector(selectors.bet_confirmation.modal, { visible: true, timeout: 10000 });
      console.log('Confirmation modal shown');
    } catch (error) {
      console.error('Failed to show confirmation modal:', error.message);
      throw error;
    }
  }

  // Confirm the bet by clicking the confirmation button in the modal
  async confirmBet() {
    const { selectors } = this.config;

    try {
      // Wait for the confirm button to be available in the modal
      await this.page.waitForSelector(selectors.bet_confirmation.confirm_modal_btn, { visible: true, timeout: 5000 });

      // Click the confirm button in the modal
      await this.page.click(selectors.bet_confirmation.confirm_modal_btn);
      
      // Wait for the success message after confirmation
      await this.page.waitForSelector(selectors.bet_confirmation.success_message, { timeout: 5000 });
      console.log('Bet confirmed');
    } catch (error) {
      console.error('Failed to confirm the bet:', error.message);
      throw error;
    }
  }

  // Display error message to the user
  async showError(message) {
    const { selectors } = this.config;

    try {
      // Simulate error display using a modal or alert
      await this.page.evaluate((msg, errorSelector) => {
        const errorElement = document.createElement('div');
        errorElement.classList.add(errorSelector);
        errorElement.textContent = msg;
        document.body.appendChild(errorElement);

        // Optional: Remove the error message after 5 seconds
        setTimeout(() => {
          errorElement.remove();
        }, 5000);
      }, message, selectors.bet_confirmation.error_class);

      console.log(`Error shown: ${message}`);
    } catch (error) {
      console.error('Failed to show error message:', error.message);
      throw error;
    }
  }

  // Display the bet summary after confirmation
  async displayBetSummary() {
    const { selectors } = this.config;

    try {
      // Wait for the bet summary element to appear
      await this.page.waitForSelector(selectors.bet_confirmation.summary_selector, { visible: true, timeout: 5000 });

      const summary = await this.page.evaluate((summarySelector) => {
        const element = document.querySelector(summarySelector);
        return element ? element.innerHTML : 'No summary available';
      }, selectors.bet_confirmation.summary_selector);

      console.log('Bet summary:', summary);
      return summary;
    } catch (error) {
      console.error('Failed to retrieve bet summary:', error.message);
      throw error;
    }
  }
}

