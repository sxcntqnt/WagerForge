export class BookieAccount {
  constructor(name, phone, openingBalance = 0) {
    this.name = name;
    this.phone = phone;
    this.balance = openingBalance;

    this.currentBalance = 0;
    this.availableBalance = 0;
    this.pendingWithdrawals = 0;

    this.transactions = [];

    console.log(`Added bookie: ${name} (${phone}) with opening $${openingBalance}`);
  }

  updateBalance({ current, available, pending }) {
    this.currentBalance = current;
    this.availableBalance = available;
    this.pendingWithdrawals = pending;
  }

  setTransactions(txList) {
    this.transactions = txList;
  }
