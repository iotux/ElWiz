class HassIntegrationChart {
  constructor(mqttClient, config, logger = console) {
    this.mqttClient = mqttClient;
    this.config = config; // Expects serverConfig properties
    this.logger = logger;

    this.hassPublish = this.config.hassPublish || true;
    this.haBaseTopic = this.config.haBaseTopic || "elwiz";
    this.haAnnounceTopic = this.config.haAnnounceTopic || "homeassistant";
    this.avtyTopic = `${this.haBaseTopic}/chart/status`;
    this.statTopic = `${this.haBaseTopic}/chart`;
    this.announceTopic = `${this.haAnnounceTopic}/sensor/ElWizChart`;
    this.announceBinaryTopic = `${this.haAnnounceTopic}/binary_sensor/ElWizChart`;
    this.currencyCode = this.config.currencyCode || "EUR";
    this.pubOpts = { retain: true, qos: 0 };
    this.debug = this.config.debug || false;
  }

  _getCurrencySymbol(symbol = "EUR") {
    let result = Intl.NumberFormat(symbol, {
      style: "currency",
      currency: symbol,
      currencyDisplay: "narrowSymbol",
      maximumSignificantDigits: 1,
    }).format(0);
    return result.replace(/0/, "").trim();
  }

  _hassDevice(
    deviceType,
    name,
    uniqueId,
    devClass,
    staClass,
    unitOfMeasurement,
    stateTopicSuffix,
  ) {
    const result = {
      name: name,
      object_id: uniqueId,
      uniq_id: uniqueId,
      avty_t: this.avtyTopic, // availability_topic
      stat_t: `${this.statTopic}/${stateTopicSuffix}`,
      dev: {
        ids: "elwiz_chart",
        name: "ElWizChart",
        sw: "https://github.com/iotux/ElWiz",
        mdl: "Chart",
        mf: "iotux",
      },
    };
    if (devClass !== "") result.dev_cla = devClass; // device_class
    if (staClass !== "") result.stat_cla = staClass; // state_class
    if (unitOfMeasurement !== "") result.unit_of_meas = unitOfMeasurement;
    if (deviceType === "binary_sensor") {
      result.pl_on = "1";
      result.pl_off = "0";
    }
    return result;
  }

  publishDiscoveryMessages() {
    if (!this.hassPublish) {
      this.logger.info(
        "[HassIntegrationChart] Home Assistant publishing is disabled.",
      );
      return;
    }
    if (!this.mqttClient || !this.mqttClient.connected) {
      this.logger.warn(
        "[HassIntegrationChart] MQTT client not connected, cannot publish HASS discovery messages.",
      );
      return;
    }

    try {
      let announce;

      announce = this._hassDevice(
        "sensor",
        "Spot price",
        "spotPrice",
        "monetary",
        "total",
        `${this._getCurrencySymbol(this.currencyCode)}/kWh`,
        "spotPrice",
      );
      this.mqttClient.publish(
        `${this.announceTopic}/spotPrice/config`,
        JSON.stringify(announce, this.debug ? null : undefined, 2),
        this.pubOpts,
      );

      announce = this._hassDevice(
        "sensor",
        "Average price",
        "avgPrice",
        "monetary",
        "total",
        `${this._getCurrencySymbol(this.currencyCode)}/kWh`,
        "avgPrice",
      );
      this.mqttClient.publish(
        `${this.announceTopic}/avgPrice/config`,
        JSON.stringify(announce, this.debug ? null : undefined, 2),
        this.pubOpts,
      );

      announce = this._hassDevice(
        "sensor",
        "Backoff threshold level",
        "thresholdLevel",
        "monetary",
        "total",
        `${this._getCurrencySymbol(this.currencyCode)}/kWh`,
        "thresholdLevel",
      );
      this.mqttClient.publish(
        `${this.announceTopic}/thresholdLevel/config`,
        JSON.stringify(announce, this.debug ? null : undefined, 2),
        this.pubOpts,
      );
      if (this.debug) {
        this.logger.info(
          `[HassIntegrationChart] HA announce thresholdLevel: ${JSON.stringify(announce)}`,
        );
      }

      announce = this._hassDevice(
        "binary_sensor",
        "Spot price below threshold",
        "spotBelowThreshold",
        "",
        "measurement",
        "",
        "spotBelowThreshold",
      );
      this.mqttClient.publish(
        `${this.announceBinaryTopic}/spotBelowThreshold/config`,
        JSON.stringify(announce, this.debug ? null : undefined, 2),
        this.pubOpts,
      );
      if (this.debug) {
        this.logger.info(
          `[HassIntegrationChart] HA announce spotBelowThreshold: ${JSON.stringify(announce)}`,
        );
      }
      this.logger.info(
        "[HassIntegrationChart] HASS discovery messages published.",
      );
    } catch (error) {
      this.logger.error(
        `[HassIntegrationChart] Error publishing HASS discovery messages: ${error.message}`,
      );
    }
  }

  publishAvailability(online = true) {
    if (!this.hassPublish) return;
    if (!this.mqttClient || !this.mqttClient.connected) {
      this.logger.warn(
        "[HassIntegrationChart] MQTT client not connected, cannot publish availability.",
      );
      return;
    }
    try {
      this.mqttClient.publish(
        this.avtyTopic,
        online ? "online" : "offline",
        this.pubOpts,
      );
      this.logger.info(
        `[HassIntegrationChart] Availability published: ${online ? "online" : "offline"}`,
      );
    } catch (error) {
      this.logger.error(
        `[HassIntegrationChart] Error publishing availability: ${error.message}`,
      );
    }
  }
}

module.exports = HassIntegrationChart;
