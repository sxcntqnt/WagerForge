// SportsbookApp.js
import { UserSession } from './UserSession.js';
import { EventSearch } from './EventSearch.js';
import { OddsSelector } from './OddsSelector.js';
import { BetSlip } from './BetSlip.js';
import { LiveBetting } from './LiveBetting.js';
import { LineMovementTracker } from './LineMovementTracker.js';
import { FilterOptions } from './FilterOptions.js';
import { BetConfirmation } from './BetConfirmation.js';
import { BetHistory } from './BetHistory.js';
import { PromotionsManager } from './PromotionsManager.js';
import { CashOutManager } from './CashOutManager.js';
import { NotificationCenter } from './NotificationCenter.js';

export class SportsbookApp {
  constructor({ page, baseUrl }) {
    this.page = page;
    this.baseUrl = baseUrl;
    this.userSession = new UserSession(page, baseUrl);
    this.eventSearch = new EventSearch(page, baseUrl);
    this.oddsSelector = new OddsSelector(page, baseUrl);
    this.betSlip = new BetSlip(page, baseUrl);
    this.liveBetting = new LiveBetting(page, baseUrl);
    this.lineTracker = new LineMovementTracker(page, baseUrl);
    this.filterOptions = new FilterOptions(page, baseUrl);
    this.betConfirmation = new BetConfirmation(page, baseUrl);
    this.betHistory = new BetHistory(page, baseUrl);
    this.promotions = new PromotionsManager(page, baseUrl);
    this.cashOut = new CashOutManager(page, baseUrl);
    this.notifications = new NotificationCenter(page, baseUrl);
  }

  async launchApp() {
    // Initialize browser navigation to home
    await this.page.goto(this.baseUrl);
    await this.page.waitForSelector('.main-content');
    console.log('Sportsbook App launched');
  }

  async login(username, password) {
    await this.userSession.login(username, password);
  }

  async placeBet(params) {
    await this.userSession.login(process.env.USERNAME, process.env.PASSWORD); // Assuming env vars
    const events = await this.eventSearch.searchEvents(params.query);
    const eventId = events[0]?.id; // Assume first event
    if (!eventId) throw new Error('Event not found');
    
    await this.oddsSelector.selectMoneylineOdds(eventId, params.team);
    const selection = { eventId, team: params.team }; // Mock selection object
    await this.betSlip.addSelectionToSlip(selection);
    await this.betSlip.setStake(params.stake);
    await this.betConfirmation.displayBetSummary();
    await this.betConfirmation.confirmBet();
    const payout = await this.betSlip.calculatePotentialPayout();
    await this.notifications.notifyUser("Bet placed successfully", "success");
    return { payout };
  }

  async viewLiveBets() {
    const games = await this.liveBetting.getLiveGames();
    console.log('Live games:', games);
  }

  async manageAccount() {
    const balance = await this.userSession.getUserBalance();
    console.log('Current balance:', balance);
    // Additional account management...
  }
}
