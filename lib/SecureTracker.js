// SecureTracker.js (converted to pure JS with JSDoc types)
import { NATSBase } from './NatsBase.js';
import Noise from "noise-handshake";
import { blake2b } from "@noble/hashes/blake2.js";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import axios from "axios";

/**
 * @typedef {Object} Bookie
 * @property {string} name
 * @property {string} phone
 * @property {number} currentBalance
 * @property {number} availableBalance
 * @property {number} pendingWithdrawals
 * @property {any[]} transactions
 */

/**
 * @typedef {Object} Identity
 * @property {string} privateHex
 * @property {string} myPublicB64
 * @property {string} corePublicB64
 */

const RESUME_FILE = join(process.cwd(), ".securebus-resume");

export async function loadIdentitiesFromVault() {
  const vaultAddr = process.env.VAULT_ADDR?.replace(/\/+$/, "");
  const vaultToken = process.env.VAULT_TOKEN;
  if (!vaultAddr || !vaultToken) {
    console.error("VAULT_ADDR and VAULT_TOKEN are required");
    process.exit(1);
  }
  try {
    const [execResp, coreResp] = await Promise.all([
      axios.get(`${vaultAddr}/v1/secret/data/werikana/execution-engine-identity`, {
        headers: { "X-Vault-Token": vaultToken },
        timeout: 8000,
      }),
      axios.get(`${vaultAddr}/v1/secret/data/werikana/core-master-identity`, {
        headers: { "X-Vault-Token": vaultToken },
        timeout: 8000,
      }),
    ]);
    const execData = execResp.data.data.data;
    const coreData = coreResp.data.data.data;
    const privBytes = Buffer.from(execData.private_key, "base64");
    if (privBytes.length !== 32) throw new Error("Invalid private key");
    return {
      privateHex: privBytes.toString("hex"),
      myPublicB64: execData.public_key,
      corePublicB64: coreData.public_key,
    };
  } catch (err) {
    console.error("Vault error:", err.response?.data || err.message);
    process.exit(1);
  }
}

export class SecureBalanceTracker {
  nc = null;
  sendCS = null;
  recvCS = null;
  sessionTag = null;
  reconnects = 0;
  bookies = {};
  cleanup = null; // To override for keepalive timer

  constructor(url, corePublicB64, myPrivateHex) {
    this.url = url;
    this.corePublicB64 = corePublicB64;
    this.myPrivateHex = myPrivateHex;
    this.cleanup = this._baseCleanup.bind(this); // Initial cleanup
  }

  // ===================================================================
  // PUBLIC API
  // ===================================================================
  addBookie(name, phone, openingBalance = 0) {
    if (this.bookies[phone]) {
      console.log(`Bookie with phone ${phone} already exists.`);
      return;
    }
    const bookie = {
      name,
      phone,
      currentBalance: openingBalance,
      availableBalance: openingBalance,
      pendingWithdrawals: 0,
      transactions: [],
    };
    this.bookies[phone] = bookie;
    this.publishSecure("balance_tracker.bookie.added", {
      event: "bookie_added",
      phone,
      name,
      openingBalance,
      timestamp: Date.now(),
    });
    console.log(`Bookie added: ${name} (${phone}) → $${openingBalance}`);
  }

  getBookie(phone) {
    return this.bookies[phone] || null;
  }

  updateBookieBalance(phone, balanceData) {
    const bookie = this.getBookie(phone);
    if (!bookie) {
      console.log("Bookie not found:", phone);
      return;
    }
    Object.assign(bookie, balanceData);
    this.publishSecure("balance_tracker.bookie.balance_updated", {
      event: "balance_updated",
      phone,
      balance: {
        current: bookie.currentBalance,
        available: bookie.availableBalance,
        pending: bookie.pendingWithdrawals,
      },
      timestamp: Date.now(),
    });
    console.log(`Balance updated: ${bookie.name} → $${bookie.currentBalance.toFixed(2)}`);
  }

  updateBookieTransactions(phone, transactions) {
    const bookie = this.getBookie(phone);
    if (!bookie) {
      console.log("Bookie not found:", phone);
      return;
    }
    bookie.transactions = transactions;
    this.publishSecure("balance_tracker.bookie.transactions_updated", {
      event: "transactions_updated",
      phone,
      transactions,
      count: transactions.length,
      timestamp: Date.now(),
    });
  }

  displayBookie(phone) {
    const b = this.getBookie(phone);
    if (!b) return console.log(`No bookie found with phone ${phone}`);
    console.log(`
Bookie: ${b.name}
Phone: ${b.phone}
Current: $${b.currentBalance.toFixed(2)}
Available: $${b.availableBalance.toFixed(2)}
Pending: $${b.pendingWithdrawals.toFixed(2)}
Transactions: ${b.transactions.length}
    `);
  }

  displayAll() {
    console.log("\n=== All Bookies ===");
    Object.values(this.bookies).forEach(b => {
      console.log(`${b.name} (${b.phone}) → Current: $${b.currentBalance.toFixed(2)}`);
    });
    console.log("Total bookies:", Object.keys(this.bookies).length);
  }

  // ===================================================================
  // CORE LOGIC
  // ===================================================================
  async start() {
    console.log("SecureBalanceTracker starting...");
    const myPubKeyB64 = await this.deriveMyPubKeyB64();
    console.log("My identity pubkey :", myPubKeyB64);
    while (true) {
      try {
        await this.connectAndHandshake();
        console.log("SecureBus connected — ready");
        this.reconnects = 0;
        await this.listenForever();
      } catch (err) {
        this.cleanup();
        const delay = Math.min(1000 * 2 ** this.reconnects, 30000);
        console.error(`Connection error: ${err.message || err}`);
        console.log(`Reconnecting in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        this.reconnects++;
      }
    }
  }

  async deriveMyPubKeyB64() {
    const priv = hexToBytes(this.myPrivateHex);
    const { convertSecretKey } = await import("ed2curve");
    const xPriv = convertSecretKey(priv);
    if (!xPriv) {
      throw new Error("Invalid Ed25519 private key for conversion");
    }
    const { x25519 } = await import("@noble/curves/x25519");
    const pub = x25519(xPriv);
    return Buffer.from(pub).toString("base64");
  }

  async connectAndHandshake() {
    this.nc = await connect({
      servers: this.url.replace(/^ws(s)?:\/\//, ""),
      reconnect: false,
    });
    const resumeToken = this.loadResumeToken();
    const myPrivateBytes = hexToBytes(this.myPrivateHex);
    const { convertSecretKey } = await import("ed2curve");
    const xPriv = convertSecretKey(myPrivateBytes);
    if (!xPriv) throw new Error("Invalid private key conversion");
    const { x25519 } = await import("@noble/curves/x25519");
    const myPublicBytes = x25519(xPriv);
    const staticKeypair = {
      publicKey: myPublicBytes,
      secretKey: xPriv,
    };
    const hs = new Noise('XX', true, staticKeypair); // FIXED: 'XX' as string, no /patterns import
    const prologue = new TextEncoder().encode("securebus2025");
    const remoteStatic = Buffer.from(this.corePublicB64, "base64");
    hs.initialise(prologue, remoteStatic, resumeToken || undefined);
    let msg = hs.send();
    while (msg && msg.length > 0) {
      const reply = await this.nc.request("securebus.handshake", msg, { timeout: 15000 });
      hs.recv(reply.data);
      msg = hs.send();
    }
    const [sendCS, recvCS] = hs.split();
    this.sendCS = sendCS;
    this.recvCS = recvCS;
    this.sessionTag = blake2b(hs.getHandshakeHash(), { dkLen: 16 });
    const newPsk = blake2b(hs.getHandshakeHash(), { dkLen: 32 });
    this.saveResumeToken(newPsk);
    this.startKeepAlive();
  }

  startKeepAlive() {
    const timer = setInterval(() => {
      this.publishSecure("_keepalive", null);
    }, 30000);
    const oldCleanup = this.cleanup;
    this.cleanup = () => {
      clearInterval(timer);
      oldCleanup.call(this);
    };
  }

  async listenForever() {
    for await (const msg of this.nc.subscribe("balance_tracker.#")) {
      if (!this.recvCS || !this.sessionTag) continue;
      try {
        const plain = this.recvCS.decrypt(msg.data);
        const env = JSON.parse(new TextDecoder().decode(plain));
        if (env.s !== bytesToHex(this.sessionTag)) continue;
        this.handleSecureMessage(env.t, env.p);
      } catch {
        // ignore invalid messages
      }
    }
  }

  handleSecureMessage(topic, payload) {
    switch (topic) {
      case "balance_tracker.bookie.added":
        this.addBookie(payload.name, payload.phone, payload.openingBalance);
        break;
      case "balance_tracker.bookie.balance_updated":
        this.updateBookieBalance(payload.phone, payload.balance);
        break;
      case "balance_tracker.bookie.transactions_updated":
        this.updateBookieTransactions(payload.phone, payload.transactions);
        break;
    }
  }

  publishSecure(topic, payload) {
    if (!this.sendCS || !this.sessionTag) return;
    const envelope = {
      ts: Date.now(),
      t: topic,
      p: payload,
      s: bytesToHex(this.sessionTag),
    };
    const encrypted = this.sendCS.encrypt(
      new TextEncoder().encode(JSON.stringify(envelope))
    );
    this.nc.publish(topic, encrypted);
  }

  loadResumeToken() {
    if (!existsSync(RESUME_FILE)) return null;
    try {
      return hexToBytes(readFileSync(RESUME_FILE, "utf8").trim());
    } catch {
      return null;
    }
  }

  saveResumeToken(token) {
    try {
      writeFileSync(RESUME_FILE, bytesToHex(token));
    } catch {}
  }

  _baseCleanup() {
    try { this.nc?.close(); } catch {}
    this.sendCS = this.recvCS = this.sessionTag = null;
  }

  cleanup() {
    this.cleanup(); // Calls the overridden version
  }

  shutdown() {
    console.log("\nShutting down...");
    this.cleanup();
    process.exit(0);
  }
}
