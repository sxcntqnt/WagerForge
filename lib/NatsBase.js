// lib/NatsBase.js
import { connect, StringCodec } from 'nats';
import { decode, encode, Packr } from 'msgpackr';
import logger from './logger.js';
import crypto from 'crypto';

export class NATSBase {
  constructor(config, validConfigs) {
    this.sc = StringCodec();
    this.arbCycleStore = new Map();
    this.arbCycleTimeouts = new Map(); // optional: per-cycle timeout
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

  // Connect to NATS server
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

  // Periodic cleanup of old arbCycleStore entries and receivedBetIDs
  periodicCleanup() {
    setInterval(() => {
      const now = Date.now();
      const timeoutMs = 30_000;

      // Clean up arbCycleStore
      for (const [id, entry] of this.arbCycleStore.entries()) {
        if (now - entry.receivedAt > timeoutMs) {
          logger.warn(`Timeout for ArbCycleID ${id}. Bets received: ${entry.bets.length}`);
          this.arbCycleStore.delete(id);
        }
      }

      // Clear receivedBetIDs if too large
      if (this.receivedBetIDs.size > 10_000) {
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

  // Encode message data using msgpack
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

  // Decode message data using msgpack (with fallback to Packr)
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
        logger.error(`Failed to unpack msgpack data: ${unpackErr.message}. Raw: len=${data.length}, hex=${data.toString('hex')}`);
        throw unpackErr;
      }
    }
  }

  // Helper: Parse match_time string as UTC and format exactly like Python
  parseMatchTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 'unknown';
    const trimmed = timeStr.trim();
    if (!trimmed) return 'unknown';

    // Parse as UTC: "2025-10-25 15:00:00" → interpret as UTC
    const dt = new Date(`${trimmed} UTC`);
    if (isNaN(dt.getTime())) return 'unknown';

    // Format: YYYY-MM-DD HH:MM:SS (19 chars, no milliseconds)
    return dt.toISOString().slice(0, 19).replace('T', ' ');
  }

  // Normalize row for consistency
  _normalizeRow(row) {
    return {
      arbcycle_id: row.arbcycle_id ?? row.ArbCycleID ?? 'unknown',
      match_id: row.match_id ?? row.MatchID ?? 'unknown',
      home_team: row.home_team ?? row.HomeTeam ?? 'unknown',
      away_team: row.away_team ?? row.AwayTeam ?? 'unknown',
      match_time: this.parseMatchTime(row.match_time ?? row.MatchTime),
      bookie: row.bookie ?? row.Bookie ?? 'unknown',
      side: row.side ?? row.Side ?? 'unknown',
      strategy: row.strategy ?? row.Strategy ?? 'unknown',
    };
  }

  // Generate ArbBetID using sha256
  generateArbBetID(row) {
    const r = this._normalizeRow(row);

    const betData = [
      r.arbcycle_id,      // must be present for arb
      r.match_id,
      r.home_team,
      r.away_team,
      r.match_time,
      r.bookie,
      r.side,
      r.strategy,
    ].join('_');

    return crypto.createHash('sha256').update(betData).digest('hex');
  }

  // Generate ValueBetID using sha256
  generateValueBetID(row) {
    const r = this._normalizeRow(row);

    const betData = [
      r.match_id,
      r.home_team,
      r.away_team,
      r.match_time,
      r.bookie,
      r.side,
      r.strategy,
    ].join('_');

    return crypto.createHash('sha256').update(betData).digest('hex');
  }

  // Validate ArbBetID
  validateArbBetID(row, BetID) {
    return this.generateArbBetID(row) === BetID;
  }

  // Validate ValueBetID
  validateValueBetID(row, BetID) {
    return this.generateValueBetID(row) === BetID;
  }

  // Filter data by bookie from validConfigs
  filterByBookie(data, validConfigs = this.validConfigs) {
    const bookie = data.bookie || data.Bookie;
    if (!bookie) {
      logger.warn('No bookie specified in message data');
      return false;
    }
    const matches = validConfigs.some((cfg) => cfg.config.name === bookie);
    if (!matches) {
      const expected = validConfigs.map((c) => c.config.name).join(', ');
      logger.info(`Skipping message for bookie ${bookie}; expected: ${expected}`);
    }
    return matches;
  }

}

