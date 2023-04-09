
const yaml = require("yamljs");
const Mqtt = require('../mqtt/mqtt.js');

const configFile = "./config.yaml";
const config = yaml.load(configFile);

const haBaseTopic = config.haBaseTopic + '/';
const hasProduction = config.hasProduction;

const hassDevice = function (name, uniqueId, devClass, staClass, unitOfMeasurement, stateTopic, secondDay = false) {
  let isTimestamp = (devClass === '')
  let result = {
    name: name,
    unique_id: uniqueId,
    avty_t: haBaseTopic + "status",    // availability_topic
    stat_t: haBaseTopic + stateTopic + "/state",
    dev: {
      ids: secondDay ? "elwiz_pulse_enabler_d2" : "elwiz_pulse_enabler",
      name: secondDay ? "ElWiz Pulse Day 2 Enabler" : "ElWiz Pulse Enabler",
      sw: "https://github.com/iotux/ElWiz",
      mdl: "ElWiz",
      mf: "iotux"
    }
  }
  if (!isTimestamp) {
    result.dev_cla = devClass; // device_class
    result.stat_cla = staClass; // state_class
    result.unit_of_meas = unitOfMeasurement;
  }
  return result;
};

const hassAnnounce = async function () {
  const haTopic = config.haAnnounceTopic + '/';
  const pubOpts = { qos: 1, retain: true }
  const debug = config.DEBUG;
  const client = Mqtt.mqttClient();
 
  //  hassDevice(name, uniqueId, devClass, stateClass, uom, stateTopic)
  let announce = hassDevice('Last meter consumption', 'last_meter_consumption', 'energy', 'total_increasing', 'kWh', 'lastMeterConsumption');
  client.publish(haTopic + "lastMeterConsumption/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Accumulated consumption today', 'accumulated_consumption', 'energy', 'total_increasing', 'kWh', 'accumulatedConsumption');
  client.publish(haTopic + "accumulatedConsumption/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Accumulated consumption last hour', 'accumulated_consumption_last_hour', 'energy', 'total', 'kWh', 'accumulatedConsumptionLastHour');
  client.publish(haTopic + "accumulatedConsumptionLastHour/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  if (hasProduction) {
    announce = hassDevice('Last meter production', 'last_meter_production', 'energy', 'total_increasing', 'kWh', 'lastMeterProduction');
    client.publish(haTopic + "lastMeterProduction/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

    announce = hassDevice('Accumulated production today', 'accumulated_production', 'energy', 'total_increasing', 'kWh', 'accumulatedProduction');
    client.publish(haTopic + "accumulatedProduction/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

    announce = hassDevice('Accumulated production last hour', 'accumulated_production_last_hour', 'energy', 'total', 'kWh', 'accumulatedProductionLastHour');
    client.publish(haTopic + "accumulatedProductionLastHour/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
  }
  announce = hassDevice('Current power use', 'power_current_use', 'power', 'measurement', 'kW', 'power');
  client.publish(haTopic + "power/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Min power since midnight', 'min_power_since_midnight', 'power', 'measurement', 'kW', 'minPower');
  client.publish(haTopic + "minPower/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Max power since midnight', 'max_power_since_midnight', 'power', 'measurement', 'kW', 'maxPower');
  client.publish(haTopic + "maxPower/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Voltage phase 1', 'voltage_phase_1', 'voltage', 'measurement', 'V', 'voltagePhase1');
  client.publish(haTopic + "voltagePhase1/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Voltage phase 2', 'voltage_phase_2', 'voltage', 'measurement', 'V', 'voltagePhase2');
  client.publish(haTopic + "voltagePhase2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Voltage phase 3', 'voltage_phase_3', 'voltage', 'measurement', 'V', 'voltagePhase3');
  client.publish(haTopic + "voltagePhase3/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
  //  hassDevice(name, uniqueId, devClass, stateClass, uom, stateTopic)
  announce = hassDevice('Current L1', 'current_L1', 'current', 'measurement', 'A', 'currentL1');
  client.publish(haTopic + "currentL1/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Current L2', 'current_L2', 'current', 'measurement', 'A', 'currentL2');
  client.publish(haTopic + "currentL2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Current L3', 'current_L3', 'current', 'measurement', 'A', 'currentL3');
  client.publish(haTopic + "currentL3/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  // Price/cost messages
  announce = hassDevice('Cost last hour', 'costLastHour', 'monetary', 'total', 'kr', 'costLastHour');
  client.publish(haTopic + "costLastHour/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Accumulated cost', 'accumulatedCost', 'monetary', 'total_increasing', 'kr', 'accumulatedCost');
  client.publish(haTopic + "accumulatedCost/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Customer price', 'customerPrice', 'monetary', 'total', 'kr/kWh', 'customerPrice');
  client.publish(haTopic + "customerPrice/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Spot price', 'spotPrice', 'monetary', 'total', 'kr/kWh', 'spotPrice');
  client.publish(haTopic + "spotPrice/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Min price today', 'minPrice', 'monetary', 'total', 'kr/kWh', 'minPrice');
  client.publish(haTopic + "minPrice/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Max price today', 'maxPrice', 'monetary', 'total', 'kr/kWh', 'maxPrice');
  client.publish(haTopic + "maxPrice/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Average price today', 'avgPrice', 'monetary', 'total', 'kr/kWh', 'avgPrice');
  client.publish(haTopic + "avgPrice/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Peak price today', 'peakPrice', 'monetary', 'total', 'kr/kWh', 'peakPrice');
  client.publish(haTopic + "peakPrice/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Off-peak price 1 today', 'offPeakPrice1', 'monetary', 'total', 'kr/kWh', 'offPeakPrice1');
  client.publish(haTopic + "offPeakPrice1/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Off-peak price 2 today', 'offPeakPrice2', 'monetary', 'total', 'kr/kWh', 'offPeakPrice2');
  client.publish(haTopic + "offPeakPrice2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
  //
  //         hassDevice(name, uniqueId, devClass, stateClass, uom, stateTopic)
  announce = hassDevice('Start time', 'startTime', '', '', '', 'startTime');
  client.publish(haTopic + "startTime/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
  announce = hassDevice('End time', 'endTime', '', '', '', 'endTime');
  client.publish(haTopic + "endTime/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  // Price/cost messages Day2
  announce = hassDevice('Customer price tomorrow', 'customerPriceDay2', 'monetary', 'total', 'kr/kWh', 'customerPriceDay2', true);
  client.publish(haTopic + "customerPriceDay2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Spot price tomorrow', 'spotPriceDay2', 'monetary', 'total', 'kr/kWh', 'spotPriceDay2', true);
  client.publish(haTopic + "spotPriceDay2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Min price tomorrow', 'minPriceDay2', 'monetary', 'total', 'kr/kWh', 'minPriceDay2', true);
  client.publish(haTopic + "minPriceDay2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Max price tomorrow', 'maxPriceDay2', 'monetary', 'total', 'kr/kWh', 'maxPriceDay2', true);
  client.publish(haTopic + "maxPriceDay2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Average price tomorrow', 'avgPriceDay2', 'monetary', 'total', 'kr/kWh', 'avgPriceDay2', true);
  client.publish(haTopic + "avgPriceDay2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Peak price tomorrow', 'peakPriceDay2', 'monetary', 'total', 'kr/kWh', 'peakPriceDay2', true);
  client.publish(haTopic + "peakPriceDay2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Off-peak price 1 tomorrow', 'offPeakPrice1Day2', 'monetary', 'total', 'kr/kWh', 'offPeakPrice1Day2', true);
  client.publish(haTopic + "offPeakPrice1Day2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Off-peak price 2 tomorrow', 'offPeakPrice2Day2', 'monetary', 'total', 'kr/kWh', 'offPeakPrice2Day2', true);
  client.publish(haTopic + "offPeakPrice2Day2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('Start time tomorrow', 'startTimeDay2', '', '', '', 'startTimeDay2', true);
  client.publish(haTopic + "startTimeDay2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
  announce = hassDevice('End time tomorrow', 'endTimeDay2', '', '', '', 'endTimeDay2', true);
  client.publish(haTopic + "endTimeDay2/config", JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  // Set retain flag (pubOpts) on status message to let HA find it after a stop/restart
  client.publish(haBaseTopic + "status", "online", pubOpts);
 
}; // hassAnnounce()

module.exports = { hassAnnounce };
