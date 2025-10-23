// lib/NATSBase.js

import { connect, StringCodec } from 'nats';
import { decode, encode, Packr } from 'msgpackr';
import logger from './logger.js';
import crypto from 'crypto';

export class NATSBase {
  constructor(config) {
    this.sc = StringCodec();
    this.arbCycleStore = new Map();
    this.receivedBetIDs = new Set();
    this.nc = null;
    this.currentConfig = config;
    this.packr = new Packr({
      useBigIntForLongNumbers: false,
      encodeStringsAsBinary: false,
      useFloat32: false,
      useRecords: false,
      structuredClone: false,
    });
  }

  async connect() {
    try {
      const natsServer = process.env.NATS_SERVER || 'nats://localhost:4222';
      this.nc = await connect({ servers: natsServer });
      logger.info(`Connected to NATS server at ${natsServer}`);
    } catch (err) {
      logger.error('Failed to connect to NATS: ' + err.message);
      throw err;
    }
  }

  periodicCleanup() {
    setInterval(() => {
      const now = Date.now();
      const timeoutMs = 30_000;

      for (const [id, entry] of this.arbCycleStore.entries()) {
        if (now - entry.receivedAt > timeoutMs) {
          logger.warn(`Timeout for ArbCycleID ${id} in arbCycleStore. Bets received: ${entry.bets.length}`);
          this.arbCycleStore.delete(id);
        }
      }

      if (this.receivedBetIDs.size > 10000) {
        logger.info('Clearing receivedBetIDs to manage memory');
        this.receivedBetIDs.clear();
      }
    }, 10_000);
  }

  async close() {
    if (this.nc) {
      await this.nc.close().catch((e) => logger.warn(`Error closing NATS: ${e.message}`));
      logger.info('NATS connection closed');
    }
  }

  encodeMessage(data) {
    try {
      const encoded = encode(data);
      logger.info('Successfully encoded msgpack data');
      return encoded;
    } catch (err) {
      logger.error(`Failed to encode msgpack data: ${err.message}`);
      throw err;
    }
  }

  decodeMessage(data) {
    try {
      const decoded = decode(data);
      logger.info('Successfully decoded msgpack data');
      return decoded;
    } catch (decodeErr) {
      logger.error(`Failed to decode msgpack data: ${decodeErr.message}. Trying unpack method...`);
      try {
        const unpacked = this.packr.unpack(data);
        logger.info('Unpack method succeeded');
        return unpacked;
      } catch (unpackErr) {
        logger.error(`Failed to unpack msgpack data: ${unpackErr.message}. Raw data: length=${data.length}, hex=${data.toString('hex')}, base64=${data.toString('base64')}`);
        throw unpackErr;
      }
    }
  }

  validateBetID(betRequest) {
    const { bet_id: BetID, bookie_channel: Bookie, data: { match_id, team } = {} } = betRequest;
    if (!Bookie || !match_id || !team) return false;
    const expectedBetID = crypto
      .createHash('sha256')
      .update(`${Bookie}-${team}-${match_id}`)
      .digest('hex');
    return expectedBetID === BetID;
  }

  filterByBookie(data) {
    const bookie = data.bookie_channel || data.Bookie;
    if (!bookie) {
      logger.warn('No bookie specified in message data');
      return false;
    }
    const matches = bookie === this.currentConfig.name;
    if (!matches) {
      logger.info(`Skipping message for bookie ${bookie}; expected ${this.currentConfig.name}`);
    }
    return matches;
  }
}
