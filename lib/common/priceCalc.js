const { formatISO } = require('date-fns');

class PriceCalc {
  /**
   * @param {Object} params
   * @param {MQTTClient} params.mqttClient
   * @param {Object} params.priceService
   * @param {Object} params.config
   * @param {Object} params.logger
   */
  constructor({ mqttClient, priceService, config = {}, logger = console }) {
    if (!mqttClient) {
      throw new Error('[PriceCalc] mqttClient is required.');
    }
    if (!priceService) {
      throw new Error('[PriceCalc] priceService instance is required.');
    }

    this.mqttClient = mqttClient;
    this.priceService = priceService;
    this.config = config;
    this.logger = logger;

    this.priceTopic =
      (config.priceTopic && config.priceTopic.replace(/\/+$/, '')) || 'elwiz/prices';
    this.priceInterval = config.priceInterval || '1h';

    this.dayHoursStart = this._normalizeHour(config.dayHoursStart, 6);
    this.dayHoursEnd = this._normalizeHour(config.dayHoursEnd, 22);

    this.supplierKwhPrice = this._toNumber(config.supplierKwhPrice, 0);
    this.supplierVatPercent = this._toNumber(config.supplierVatPercent, 0);
    this.supplierMonthPrice = this._toNumber(config.supplierMonthPrice, 0);

    this.gridKwhPrice = this._toNumber(config.gridKwhPrice, 0);
    this.gridVatPercent = this._toNumber(config.gridVatPercent, 0);
    this.gridMonthPrice = this._toNumber(config.gridMonthPrice, 0);

    this.energyTax = this._toNumber(config.energyTax, 0);
    this.energyDayPrice = this._toNumber(config.energyDayPrice, 0);
    this.energyNightPrice = this._toNumber(config.energyNightPrice, 0);

    this._computePriceComponents();
    this._subscribe();
  }

  _normalizeHour(value, fallback) {
    if (value === undefined || value === null) {
      return fallback;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length) {
      const parts = value.split(':');
      const parsed = parseInt(parts[0], 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
  }

  _toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  _round4(value) {
    return Number.isFinite(value) ? parseFloat(value.toFixed(4)) : 0;
  }

  _computePriceComponents() {
    const supplierVatFactor = 1 + this.supplierVatPercent / 100;
    const gridVatFactor = 1 + this.gridVatPercent / 100;

    const variableBase = (this.supplierKwhPrice + this.gridKwhPrice + this.energyTax) * supplierVatFactor;
    const dayAddition = this.energyDayPrice * gridVatFactor;
    const nightAddition = this.energyNightPrice * gridVatFactor;

    this.dayFloatingPrice = this._round4(variableBase + dayAddition);
    this.nightFloatingPrice = this._round4(variableBase + nightAddition);

    const gridFixedHourly = (this.gridMonthPrice / 720) * gridVatFactor;
    const supplierFixedHourly = (this.supplierMonthPrice / 720) * supplierVatFactor;
    this.fixedPricePerHour = this._round4(gridFixedHourly + supplierFixedHourly);

    if (this.config.debug) {
      this.logger.info(
        `[PriceCalc] Computed price components. Day floating: ${this.dayFloatingPrice}, Night floating: ${this.nightFloatingPrice}, Fixed/hour: ${this.fixedPricePerHour}`,
      );
    }
  }

  _subscribe() {
    const topic = `${this.priceTopic}/#`;
    this.mqttClient.subscribe(topic, (err) => {
      if (err) {
        this.logger.error(`[PriceCalc] Subscription error for ${topic}: ${err.message}`);
      } else if (this.config.debug) {
        this.logger.info(`[PriceCalc] Subscribed to ${topic}`);
      }
    });

    this.mqttClient.on('message', (msgTopic, message) => {
      if (!msgTopic.startsWith(this.priceTopic)) {
        return;
      }

      if (!message || message.length === 0) {
        if (this.config.debug) {
          this.logger.info(`[PriceCalc] Received empty message on ${msgTopic}, ignoring.`);
        }
        return;
      }

      const parsed = this._parseJsonSafely(message);
      if (parsed.error) {
        this.logger.error(`[PriceCalc] Failed to parse MQTT message on ${msgTopic}: ${parsed.message}`);
        return;
      }

      const enriched = this._enrichPricePayload(parsed.data);
      if (!enriched) {
        if (this.config.debug) {
          this.logger.warn(`[PriceCalc] Enrichment skipped for message on ${msgTopic}.`);
        }
        return;
      }

      this.priceService.ingestPriceData(enriched);
    });
  }

  _parseJsonSafely(message) {
    let messageString;
    try {
      messageString = message.toString();
    } catch (err) {
      return { error: true, message: `Error converting MQTT payload to string: ${err.message}` };
    }

    if (typeof messageString !== 'string' || messageString.trim() === '') {
      return { error: true, message: 'MQTT payload is empty or not a string.' };
    }

    try {
      return { error: false, data: JSON.parse(messageString) };
    } catch (err) {
      return { error: true, message: err.message };
    }
  }

  _enrichPricePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const { priceDate, hourly } = payload;
    if (!priceDate || !Array.isArray(hourly) || hourly.length === 0) {
      return null;
    }

    const enrichedHourly = hourly.map((entry, index) => {
      const hourOfDay = this._deriveHour(entry, index);
      const isDayHour = this._isDayHour(hourOfDay);
      const floatingPrice = isDayHour ? this.dayFloatingPrice : this.nightFloatingPrice;

      const normalizedEntry = { ...entry };
      normalizedEntry.floatingPrice = floatingPrice;
      normalizedEntry.fixedPrice = this.fixedPricePerHour;

      if (!normalizedEntry.startTime && priceDate) {
        normalizedEntry.startTime = this._buildFallbackTime(priceDate, hourOfDay);
      }

      return normalizedEntry;
    });

    return {
      ...payload,
      hourly: enrichedHourly,
    };
  }

  _deriveHour(entry, index) {
    if (entry && entry.startTime) {
      const date = new Date(entry.startTime);
      if (!Number.isNaN(date.getTime())) {
        return date.getHours();
      }
    }

    if (entry && entry.endTime) {
      const date = new Date(entry.endTime);
      if (!Number.isNaN(date.getTime())) {
        return (date.getHours() + 23) % 24;
      }
    }

    if (this.priceInterval === '15m') {
      return Math.floor(index / 4) % 24;
    }

    return index % 24;
  }

  _isDayHour(hour) {
    if (this.dayHoursStart === this.dayHoursEnd) {
      return true;
    }
    if (this.dayHoursStart < this.dayHoursEnd) {
      return hour >= this.dayHoursStart && hour < this.dayHoursEnd;
    }
    return hour >= this.dayHoursStart || hour < this.dayHoursEnd;
  }

  _buildFallbackTime(priceDate, hour) {
    try {
      const iso = `${priceDate}T${hour.toString().padStart(2, '0')}:00:00`;
      return formatISO(new Date(iso), { representation: 'complete' });
    } catch (_) {
      return null;
    }
  }
}

module.exports = PriceCalc;
