// NotificationCenter.js
import puppeteer from "puppeteer-core";

export class NotificationCenter {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Fetch unread notifications based on the config selectors
  async getUnreadNotifications() {
    const { selectors } = this.config;

    try {
      // Click the notification bell to open the notifications list
      await this.page.click(selectors.notification_bell);

      // Wait for the notifications list to be available before scraping
      await this.page.waitForSelector(selectors.notifications_list, { timeout: 5000 });

      // Scrape unread notifications using the configured selector
      const notifs = await this.page.evaluate((sel) => {
        return Array.from(document.querySelectorAll(sel)).map(el => ({
          id: el.dataset.notifId,
          message: el.textContent.trim()
        }));
      }, selectors.unread_notification);

      console.log(`Found ${notifs.length} unread notifications`);
      return notifs;

    } catch (error) {
      console.error('Failed to get unread notifications:', error.message);
      throw error;
    }
  }

  // Subscribe to event alerts based on the config selector
  async subscribeToEventAlerts(eventId) {
    const { base_url, selectors } = this.config;

    try {
      // Navigate to event page
      await this.page.goto(`${base_url}/events/${eventId}`);

      // Wait for the subscribe alerts button to be available before clicking
      await this.page.waitForSelector(selectors.subscribe_alerts_btn, { timeout: 5000 });
      await this.page.click(selectors.subscribe_alerts_btn);

      console.log(`Subscribed to alerts for event: ${eventId}`);
    } catch (error) {
      console.error(`Failed to subscribe to alerts for event ${eventId}:`, error.message);
      throw error;
    }
  }

  // Simulate sending a notification to the user
  async notifyUser(message, type) {
    const { selectors } = this.config;

    try {
      // Mock adding a notification to the list
      await this.page.evaluate((msg, t, sel) => {
        const notif = document.createElement('div');
        notif.className = `notification ${t}`;
        notif.textContent = msg;
        document.querySelector(sel).appendChild(notif);
      }, message, type, selectors.notifications_list);

      console.log(`Notified user: ${message} (${type})`);

    } catch (error) {
      console.error('Failed to notify user:', error.message);
      throw error;
    }
  }

  // Mark a notification as read based on the notification ID
  async markAsRead(notificationId) {
    const { selectors } = this.config;

    try {
      // Wait for the mark-read button to be available before clicking
      const notificationSelector = `${selectors.notification_item}[data-id="${notificationId}"] ${selectors.mark_read_btn}`;
      await this.page.waitForSelector(notificationSelector, { timeout: 5000 });

      // Click the mark-read button for the specific notification
      await this.page.click(notificationSelector);
      console.log(`Marked notification ${notificationId} as read`);

    } catch (error) {
      console.error(`Failed to mark notification ${notificationId} as read:`, error.message);
      throw error;
    }
  }
}

