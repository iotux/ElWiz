
const yaml = require("yamljs");
const Mqtt = require('../mqtt/mqtt.js');

const configFile = "./config.yaml";
const config = yaml.load(configFile);

const haBaseTopic = config.haBaseTopic + '/';
const hasProduction = config.hasProduction;

let client;

const hassDevice = function (name, uniqueId, devClass, staClass, unitOfMeasurement, stateTopic) {
  let result = {
    name: name,
    unique_id: uniqueId,
    dev_cla: devClass, // device_class
    stat_cla: staClass, // state_class
    unit_of_meas: unitOfMeasurement,
    avty_t: haBaseTopic + "status",    // availability_topic
    stat_t: haBaseTopic + stateTopic + "/state",
    //stat_t: haBaseTopic + "state",
    //val_tpl: "{{ value_json." + uniqueId + " }}",
    dev: {
      ids: "elwiz_pulse_enabler",
      name: "ElWiz Pulse Enabler",
      sw: "https://github.com/iotux/ElWiz",
      mdl: "ElWiz",
      mf: "iotux"
    }
  }
  return result;
};

  const hassDeviceDay2 = function (name, uniqueId, devClass, staClass, unitOfMeasurement, stateTopic) {
    let result = {
      name: name,
      unique_id: uniqueId,
      dev_cla: devClass, // device_class
      stat_cla: staClass, // state_class
      unit_of_meas: unitOfMeasurement,
      avty_t: haBaseTopic + "status",    // availability_topic
      stat_t: haBaseTopic + stateTopic + "/state",
      //stat_t: haBaseTopic + "state",
      //val_tpl: "{{ value_json." + uniqueId + " }}",
      dev: {
        ids: "elwiz_pulse_enabler_d2",
        name: "ElWiz Pulse Day 2 Enabler",
        sw: "https://github.com/iotux/ElWiz",
        mdl: "ElWiz",
        mf: "iotux"
      }
    }
    return result;
  };

const hassAnnounce = async function () {
  const haTopic = config.haAnnounceTopic + '/';
  const pubOpts = { qos: 1, retain: true }
  const debug = config.DEBUG;
  client = Mqtt.mqttClient();
 
  //  hassDevice(name, uniqueId, devClass, stateClass, uom, stateTopic)
  let announce = hassDevice('Last meter consumption', 'last_meter_consumption', 'energy', 'total_increasing', 'kWh', 'lastMeterConsumption');
  client.publish(haTopic + "lastMeterConsumption/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Accumulated consumption today', 'accumulated_consumption', 'energy', 'total', 'kWh', 'accumulatedConsumption');
  client.publish(haTopic + "accumulatedConsumption/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Accumulated consumption last hour', 'accumulated_consumption_last_hour', 'energy', 'total_increasing', 'kWh', 'accumulatedConsumptionLastHour');
  client.publish(haTopic + "accumulatedConsumptionLastHour/config", JSON.stringify(announce, !debug, 2), pubOpts);

  if (hasProduction) {
    announce = hassDevice('Last meter production', 'last_meter_production', 'energy', 'total_increasing', 'kWh', 'lastMeterProduction');
    client.publish(haTopic + "lastMeterProduction/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = hassDevice('Accumulated production today', 'accumulated_production', 'energy', 'total', 'kWh', 'accumulatedProduction');
    client.publish(haTopic + "accumulatedProduction/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = hassDevice('Accumulated production last hour', 'accumulated_production_last_hour', 'energy', 'total_increasing', 'kWh', 'accumulatedProductionLastHour');
    client.publish(haTopic + "accumulatedProductionLastHour/config", JSON.stringify(announce, !debug, 2), pubOpts);
  }
  announce = hassDevice('Current power use', 'power_current_use', 'power', 'measurement', 'kW', 'power');
  client.publish(haTopic + "power/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Min power since midnight', 'min_power_since_midnight', 'power', 'measurement', 'kW', 'minPower');
  client.publish(haTopic + "minPower/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Max power since midnight', 'max_power_since_midnight', 'power', 'measurement', 'kW', 'maxPower');
  client.publish(haTopic + "maxPower/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Voltage phase 1', 'voltage_phase_1', 'voltage', 'measurement', 'V', 'voltagePhase1');
  client.publish(haTopic + "voltagePhase1/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Voltage phase 2', 'voltage_phase_2', 'voltage', 'measurement', 'V', 'voltagePhase2');
  client.publish(haTopic + "voltagePhase2/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Voltage phase 3', 'voltage_phase_3', 'voltage', 'measurement', 'V', 'voltagePhase3');
  client.publish(haTopic + "voltagePhase3/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Current L1', 'current_L1', 'current', 'measurement', 'A', 'currentL1');
  client.publish(haTopic + "currentL1/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Current L2', 'current_L2', 'current', 'measurement', 'A', 'currentL2');
  client.publish(haTopic + "currentL2/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Current L3', 'current_L3', 'current', 'measurement', 'A', 'currentL3');
  client.publish(haTopic + "currentL3/config", JSON.stringify(announce, !debug, 2), pubOpts);

  // Price/cost messages
  announce = hassDevice('Cost last hour', 'costLastHour', 'monetary', 'measurement', 'kr', 'costLastHour');
  client.publish(haTopic + "costLastHour/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Accumulated cost', 'accumulatedCost', 'monetary', 'measurement', 'kr', 'accumulatedCost');
  client.publish(haTopic + "accumulatedCost/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Customer price', 'customerPrice', 'monetary', 'measurement', 'kr/kWh', 'customerPrice');
  client.publish(haTopic + "customerPrice/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Spot price', 'spotPrice', 'monetary', 'measurement', 'kr/kWh', 'spotPrice');
  client.publish(haTopic + "spotPrice/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Min price today', 'minPrice', 'monetary', 'measurement', 'kr/kWh', 'minPrice');
  client.publish(haTopic + "minPrice/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Max price today', 'maxPrice', 'monetary', 'measurement', 'kr/kWh', 'maxPrice');
  client.publish(haTopic + "maxPrice/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Average price today', 'avgPrice', 'monetary', 'measurement', 'kr/kWh', 'avgPrice');
  client.publish(haTopic + "avgPrice/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Peak price today', 'peakPrice', 'monetary', 'measurement', 'kr/kWh', 'peakPrice');
  client.publish(haTopic + "peakPrice/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Off-peak price 1 today', 'offPeakPrice1', 'monetary', 'measurement', 'kr/kWh', 'offPeakPrice1');
  client.publish(haTopic + "offPeakPrice1/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDevice('Off-peak price 2 today', 'offPeakPrice2', 'monetary', 'measurement', 'kr/kWh', 'offPeakPrice2');
  client.publish(haTopic + "offPeakPrice2/config", JSON.stringify(announce, !debug, 2), pubOpts);
  //
  announce = hassDevice('Start time', 'startTime', 'timestamp', 'measurement', 'ts', 'startTime');
  client.publish(haTopic + "startTime/config", JSON.stringify(announce, !debug, 2), pubOpts);
  announce = hassDevice('End time', 'endTime', 'timestamp', 'measurement', 'ts', 'endTime');
  client.publish(haTopic + "endTime/config", JSON.stringify(announce, !debug, 2), pubOpts);

  // Price/cost messages Day2
  announce = hassDeviceDay2('Customer price tomorrow', 'customerPriceDay2', 'monetary', 'measurement', 'kr/kWh', 'customerPriceDay2');
  client.publish(haTopic + "customerPriceDay2/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDeviceDay2('Spot price tomorrow', 'spotPriceDay2', 'monetary', 'measurement', 'kr/kWh', 'spotPriceDay2');
  client.publish(haTopic + "spotPriceDay2/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDeviceDay2('Min price tomorrow', 'minPriceDay2', 'monetary', 'measurement', 'kr/kWh', 'minPriceDay2');
  client.publish(haTopic + "minPriceDay2/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDeviceDay2('Max price tomorrow', 'maxPriceDay2', 'monetary', 'measurement', 'kr/kWh', 'maxPriceDay2');
  client.publish(haTopic + "maxPriceDay2/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDeviceDay2('Average price tomorrow', 'avgPriceDay2', 'monetary', 'measurement', 'kr/kWh', 'avgPriceDay2');
  client.publish(haTopic + "avgPriceDay2/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDeviceDay2('Peak price tomorrow', 'peakPriceDay2', 'monetary', 'measurement', 'kr/kWh', 'peakPriceDay2');
  client.publish(haTopic + "peakPriceDay2/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDeviceDay2('Off-peak price 1 tomorrow', 'offPeakPrice1Day2', 'monetary', 'measurement', 'kr/kWh', 'offPeakPrice1Day2');
  client.publish(haTopic + "offPeakPrice1Day2/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDeviceDay2('Off-peak price 2 tomorrow', 'offPeakPrice2Day2', 'monetary', 'measurement', 'kr/kWh', 'offPeakPrice2Day2');
  client.publish(haTopic + "offPeakPrice2Day2/config", JSON.stringify(announce, !debug, 2), pubOpts);

  announce = hassDeviceDay2('Start time tomorrow', 'startTimeDay2', 'timestamp', 'measurement', 'ts', 'startTimeDay2');
  client.publish(haTopic + "startTimeDay2/config", JSON.stringify(announce, !debug, 2), pubOpts);
  announce = hassDeviceDay2('End time tomorrow', 'endTimeDay2', 'timestamp', 'measurement', 'ts', 'endTimeDay2');
  client.publish(haTopic + "endTimeDay2/config", JSON.stringify(announce, !debug, 2), pubOpts);

  // Set retain flag (pubOpts) on status message to let HA find it after a stop/restart
  client.publish(haBaseTopic + "status", "online", pubOpts);
 
}; // hassAnnounce()

module.exports = { hassAnnounce };
