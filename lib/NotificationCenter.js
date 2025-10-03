// NotificationCenter.js
import puppeteer from "puppeteer-core";

export class NotificationCenter {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async getUnreadNotifications() {
    await this.page.click('.notification-bell');
    await this.page.waitForSelector('.notifications-list');
    
    const notifs = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('.notification.unread')).map(el => ({
        id: el.dataset.notifId,
        message: el.textContent.trim()
      }));
    });
    return notifs;
  }

  async subscribeToEventAlerts(eventId) {
    await this.page.goto(`${this.baseUrl}/events/${eventId}`);
    await this.page.click('.subscribe-alerts-btn');
    console.log(`Subscribed to alerts for ${eventId}`);
  }

  async notifyUser(message, type) {
    // Simulate sending notification (in real, use WebSocket or API)
    await this.page.evaluate((msg, t) => {
      // Mock: add to list
      const notif = document.createElement('div');
      notif.className = `notification ${t}`;
      notif.textContent = msg;
      document.querySelector('.notifications-list').appendChild(notif);
    }, message, type);
    console.log(`Notified user: ${message} (${type})`);
  }

  async markAsRead(notificationId) {
    await this.page.click(`.notification[data-id="${notificationId}"] .mark-read`);
    console.log(`Marked notification ${notificationId} as read`);
  }
}
