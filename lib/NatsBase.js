// lib/NATSBase.js

import { connect, StringCodec } from 'nats';
import { decode, encode, Packr } from 'msgpackr';
import logger from './logger.js';
import crypto from 'crypto';

export class NATSBase {
  constructor(config, validConfigs) {
    this.sc = StringCodec();
    this.arbCycleStore = new Map();
    this.receivedBetIDs = new Set();
    this.nc = null;
    this.currentConfig = config;
    this.validConfigs = validConfigs;
    this.packr = new Packr({
      useBigIntForLongNumbers: false,
      encodeStringsAsBinary: false,
      useFloat32: false,
      useRecords: false,
      structuredClone: false,
    });
  }

  // Connect to the NATS server
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

  // Periodically clean up stale data and manage memory usage
  periodicCleanup() {
    setInterval(() => {
      const now = Date.now();
      const timeoutMs = 30_000;

      // Clean up arbCycleStore
      for (const [id, entry] of this.arbCycleStore.entries()) {
        if (now - entry.receivedAt > timeoutMs) {
          logger.warn(`Timeout for ArbCycleID ${id} in arbCycleStore. Bets received: ${entry.bets.length}`);
          this.arbCycleStore.delete(id);
        }
      }

      // Clear receivedBetIDs if it exceeds threshold
      if (this.receivedBetIDs.size > 10000) {
        logger.info('Clearing receivedBetIDs to manage memory');
        this.receivedBetIDs.clear();
      }
    }, 10_000);
  }

  // Close the NATS connection
  async close() {
    if (this.nc) {
      await this.nc.close().catch((e) => logger.warn(`Error closing NATS: ${e.message}`));
      logger.info('NATS connection closed');
    }
  }

  // Encode message using msgpack
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

  // Decode message using msgpack
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

  // Validate bet ID using a hashed combination of Bookie, team, and match_id
  validateBetID(betRequest) {
    const { bet_id: BetID, bookie: Bookie, data: { match_id, team } = {} } = betRequest;

    if (!Bookie || !match_id || !team) return false;

    const expectedBetID = crypto
      .createHash('sha256')
      .update(`${Bookie}-${team}-${match_id}`)
      .digest('hex');

    return expectedBetID === BetID;
  }

   // Filter messages based on the bookie
  filterByBookie(data) {
    const bookie = data.bookie || data.Bookie;

    if (!bookie) {
      logger.warn('No bookie specified in message data');
      return false;
    }

    // Check if the incoming bookie matches any of the valid bookies in validConfigs
    const matches = this.validConfigs.some(config => config.config.name === bookie);

    if (!matches) {
      // Log all expected bookies for better clarity
      const expectedBookies = this.validConfigs.map(config => config.config.name).join(', ');
      logger.info(`Skipping message for bookie ${bookie}; expected one of ${expectedBookies}`);
    }

    return matches;
  }
}

