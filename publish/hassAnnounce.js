
const MQTTClient = require("../mqtt/mqtt");
const { loadYaml, getCurrencySymbol } = require('../misc/util.js');

const configFile = './config.yaml';
const config = loadYaml(configFile);

const debug = config.DEBUG || false;
const hasProduction = config.hasProduction || false;
const haBaseTopic = config.haBaseTopic || 'elwiz';
const haAnnounceTopic = config.haAnnounceTopic || 'homeassistant';
const priceCurrency = config.priceCurrency || 'EUR';

// Move this to config.yaml?
const announceTopic = `${haAnnounceTopic}/sensor/ElWiz`;
const announceBinaryTopic = `${haAnnounceTopic}/binary_sensor/ElWiz`;
const avtyTopic = `${haBaseTopic}/sensor/status`;
const statTopic = `${haBaseTopic}/sensor`;

const mqttUrl = config.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions;
mqttOpts.will = { topic: avtyTopic, payload: 'offline', retain: true, qos: 0 };

const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'hassAnnounce');

const currency = getCurrencySymbol(priceCurrency);
const symbol = `${currency}/kWh`;

const hassDevice = function (deviceType, name, uniqueId, devClass, staClass, unitOfMeasurement, stateTopic, secondDay = false) {
  const result = {
    name: name,
    object_id: uniqueId,
    uniq_id: uniqueId,
    avty_t: avtyTopic, // availability_topic
    stat_t: `${statTopic}/${stateTopic}`,
    dev: {
      ids: secondDay ? 'elwiz_pulse_enabler_d2' : 'elwiz_pulse_enabler',
      name: secondDay ? 'ElWizD2' : 'ElWiz',
      sw: 'https://github.com/iotux/ElWiz',
      mdl: 'ElWiz',
      mf: 'iotux'
    }
  };
  if (devClass !== '') result.dev_cla = devClass; // device_class
  if (staClass !== '') result.stat_cla = staClass; // state_class
  if (unitOfMeasurement !== '') result.unit_of_meas = unitOfMeasurement;
  if (deviceType === 'binary_sensor') {
    result.pl_on = '1';
    result.pl_off = '0';
  }
  return result;
};

const hassAnnounce = async function () {
  await mqttClient.waitForConnect(); // Wait for the MQTT client to connect

  const pubOpts = { qos: 1, retain: true };

  // hassDevice('deviceType', name, uniqueId, devClass, stateClass, uom, stateTopic)
  let announce = hassDevice('sensor', 'Last meter consumption', 'last_meter_consumption', 'energy', 'total_increasing', 'kWh', 'lastMeterConsumption');
  await mqttClient.publish(`${announceTopic}/lastMeterConsumption/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Consumption Current hour', 'consumption_current_hour', 'energy', 'total', 'kWh', 'consumptionCurrentHour');
  await mqttClient.publish(`${announceTopic}/consumptionCurrentHour/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Consumption Today', 'consumption_today', 'energy', 'total', 'kWh', 'consumptionToday');
  await mqttClient.publish(`${announceTopic}/consumptionToday/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  //announce = hassDevice('sensor', 'Consumption last hour', 'consumption_last_hour', 'energy', 'total', 'kWh', 'consumptionLastHour');
  //await mqttClient.publish(`${announceTopic}/consumptionLastHour/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  if (hasProduction) {
    announce = hassDevice('sensor', 'Last meter production', 'last_meter_production', 'energy', 'total_increasing', 'kWh', 'lastMeterProduction');
    await mqttClient.publish(`${announceTopic}/lastMeterProduction/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

    announce = hassDevice('sensor', 'Production Current hour', 'production_current_hour', 'energy', 'total', 'kWh', 'productionCurrentHour');
    await mqttClient.publish(`${announceTopic}/productionCurrentHour/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

    announce = hassDevice('sensor', 'Production today', 'production_today', 'energy', 'total', 'kWh', 'productionToday');
    await mqttClient.publish(`${announceTopic}/productionToday/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

    //announce = hassDevice('sensor', 'Production last hour', 'production_last_hour', 'energy', 'total', 'kWh', 'productionLastHour');
    //await mqttClient.publish(`${announceTopic}/productionLastHour/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
  }

  announce = hassDevice('sensor', 'Top Hours Average', 'top_hours_average', 'energy', 'total', 'kWh', 'topHoursAverage');
  await mqttClient.publish(`${announceTopic}/topHoursAverage/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Current power use', 'power_current_use', 'power', 'measurement', 'kW', 'power');
  await mqttClient.publish(`${announceTopic}/power/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Min power since midnight', 'min_power_since_midnight', 'power', 'measurement', 'kW', 'minPower');
  await mqttClient.publish(`${announceTopic}/minPower/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Max power since midnight', 'max_power_since_midnight', 'power', 'measurement', 'kW', 'maxPower');
  await mqttClient.publish(`${announceTopic}/maxPower/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Average power since midnight', 'average_power_since_midnight', 'power', 'measurement', 'kW', 'averagePower');
  await mqttClient.publish(`${announceTopic}/averagePower/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Voltage phase 1', 'voltage_phase_1', 'voltage', 'measurement', 'V', 'voltagePhase1');
  await mqttClient.publish(`${announceTopic}/voltagePhase1/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Voltage phase 2', 'voltage_phase_2', 'voltage', 'measurement', 'V', 'voltagePhase2');
  await mqttClient.publish(`${announceTopic}/voltagePhase2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Voltage phase 3', 'voltage_phase_3', 'voltage', 'measurement', 'V', 'voltagePhase3');
  await mqttClient.publish(`${announceTopic}/voltagePhase3/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Current L1', 'current_L1', 'current', 'measurement', 'A', 'currentL1');
  await mqttClient.publish(`${announceTopic}/currentL1/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Current L2', 'current_L2', 'current', 'measurement', 'A', 'currentL2');
  await mqttClient.publish(`${announceTopic}/currentL2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Current L3', 'current_L3', 'current', 'measurement', 'A', 'currentL3');
  await mqttClient.publish(`${announceTopic}/currentL3/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  // Price/cost messages
  announce = hassDevice('sensor', 'Cost last hour', 'cost_last_hour', 'monetary', 'total', currency, 'costLastHour');
  await mqttClient.publish(`${announceTopic}/costLastHour/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Accumulated cost', 'accumulated_cost', 'monetary', 'total', currency, 'accumulatedCost');
  await mqttClient.publish(`${announceTopic}/accumulatedCost/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Customer price', 'customer_price', 'monetary', 'total', symbol, 'customerPrice');
  await mqttClient.publish(`${announceTopic}/customerPrice/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Spot price', 'spot_price', 'monetary', 'total', symbol, 'spotPrice');
  await mqttClient.publish(`${announceTopic}/spotPrice/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Min price today', 'min_price', 'monetary', 'total', symbol, 'minPrice');
  await mqttClient.publish(`${announceTopic}/minPrice/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Max price today', 'max_price', 'monetary', 'total', symbol, 'maxPrice');
  await mqttClient.publish(`${announceTopic}/maxPrice/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Average price today', 'avg_price', 'monetary', 'total', symbol, 'avgPrice');
  await mqttClient.publish(`${announceTopic}/avgPrice/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Peak price today', 'peak_price', 'monetary', 'total', symbol, 'peakPrice');
  await mqttClient.publish(`${announceTopic}/peakPrice/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Off-peak price 1 today', 'off_peak_price1', 'monetary', 'total', symbol, 'offPeakPrice1');
  await mqttClient.publish(`${announceTopic}/offPeakPrice1/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Off-peak price 2 today', 'off_peak_price2', 'monetary', 'total', symbol, 'offPeakPrice2');
  await mqttClient.publish(`${announceTopic}/offPeakPrice2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Start time', 'start_time', '', '', '', 'startTime');
  await mqttClient.publish(`${announceTopic}/startTime/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'End time', 'end_time', '', '', '', 'endTime');
  await mqttClient.publish(`${announceTopic}/endTime/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  // Price/cost messages Day2
  announce = hassDevice('sensor', 'Customer price tomorrow', 'customer_price_tomorrow', 'monetary', 'total', symbol, 'customerPriceDay2', true);
  await mqttClient.publish(`${announceTopic}/customerPriceDay2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Spot price tomorrow', 'spot_price_tomorrow', 'monetary', 'total', symbol, 'spotPriceDay2', true);
  await mqttClient.publish(`${announceTopic}/spotPriceDay2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Min price tomorrow', 'min_price_day2', 'monetary', 'total', symbol, 'minPriceDay2', true);
  await mqttClient.publish(`${announceTopic}/minPriceDay2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Max price tomorrow', 'max_price_day2', 'monetary', 'total', symbol, 'maxPriceDay2', true);
  await mqttClient.publish(`${announceTopic}/maxPriceDay2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Average price tomorrow', 'avg_pice_day2', 'monetary', 'total', symbol, 'avgPriceDay2', true);
  await mqttClient.publish(`${announceTopic}/avgPriceDay2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Peak price tomorrow', 'peak_price_day2', 'monetary', 'total', symbol, 'peakPriceDay2', true);
  await mqttClient.publish(`${announceTopic}/peakPriceDay2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Off-peak price 1 tomorrow', 'off_peak_price1_day2', 'monetary', 'total', symbol, 'offPeakPrice1Day2', true);
  await mqttClient.publish(`${announceTopic}/offPeakPrice1Day2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Off-peak price 2 tomorrow', 'off_peak_price2_day2', 'monetary', 'total', symbol, 'offPeakPrice2Day2', true);
  await mqttClient.publish(`${announceTopic}/offPeakPrice2Day2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Start time tomorrow', 'start_time_day2', '', '', '', 'startTimeDay2', true);
  await mqttClient.publish(`${announceTopic}/startTimeDay2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'End time tomorrow', 'end_time_day2', '', '', '', 'endTimeDay2', true);
  await mqttClient.publish(`${announceTopic}/endTimeDay2/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  // binary_sensor
  announce = hassDevice('binary_sensor', 'Spot price below average', 'spot_below_average', '', 'measurement', '', 'spotBelowAverage');
  await mqttClient.publish(`${announceBinaryTopic}/spotBelowAverage/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  // Set retain flag (pubOpts) on status message to let HA find it after a stop/restart
  await mqttClient.publish(avtyTopic, 'online', { retain: true, qos: 0 });
}; // hassAnnounce()

hassAnnounce();

module.exports = { hassAnnounce };
