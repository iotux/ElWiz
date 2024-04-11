
const yaml = require('yamljs');
const Mqtt = require('../mqtt/mqtt.js');

const configFile = './config.yaml';
const config = yaml.load(configFile);

const debug = config.DEBUG || false;
const hasProduction = config.hasProduction || false;
const haBaseTopic = config.haBaseTopic || 'elwiz';
const haAnnounceTopic = config.haAnnounceTopic || 'homeassistant';

// Move this to config.yaml?
const announceTopic = haAnnounceTopic + '/sensor/ElWiz/';
const announceBinaryTopic = haAnnounceTopic + '/binary_sensor/ElWiz/';

const client = Mqtt.mqttClient();

const hassDevice = function (deviceType, name, uniqueId, devClass, staClass, unitOfMeasurement, stateTopic, secondDay = false) {
  const result = {
    name: name,
    object_id: uniqueId,
    uniq_id: uniqueId,
    avty_t: haBaseTopic + '/sensor/status', // availability_topic
    //stat_t: haBaseTopic + '/' + deviceType + '/' + stateTopic,
    stat_t: haBaseTopic + '/sensor/' + stateTopic,
    dev: {
      ids: secondDay ? 'elwiz_pulse_enabler_d2' : 'elwiz_pulse_enabler',
      //name: secondDay ? 'ElWiz Pulse Day 2 Enabler' : 'ElWiz Pulse Enabler',
      name: secondDay ? 'ElWizD2' : 'ElWiz',
      sw: 'https://github.com/iotux/ElWiz',
      mdl: 'ElWiz',
      mf: 'iotux'
    }
  };
  if (devClass !== '') result.dev_cla = devClass; // device_class
  if (staClass !== '') result.stat_cla = staClass; // state_class
  if (unitOfMeasurement !== '') result.unit_of_meas = unitOfMeasurement;
  if (deviceType === 'binary_sensor'){
    result.pl_on = '1';
    result.pl_off = '0';
  }
  return result;
};

const hassAnnounce = async function () {
  const pubOpts = { qos: 1, retain: true };

  //  hassDevice('deviceType', name, uniqueId, devClass, stateClass, uom, stateTopic)
  let announce = hassDevice('sensor', 'Last meter consumption', 'last_meter_consumption', 'energy', 'total_increasing', 'kWh', 'lastMeterConsumption');
  client.publish(announceTopic + 'lastMeterConsumption/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Accumulated consumption today', 'accumulated_consumption_today', 'energy', 'total', 'kWh', 'accumulatedConsumption');
  client.publish(announceTopic + 'accumulatedConsumption/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Accumulated consumption last hour', 'accumulated_consumption_last_hour', 'energy', 'total', 'kWh', 'accumulatedConsumptionLastHour');
  client.publish(announceTopic + 'accumulatedConsumptionLastHour/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Consumption Current hour', 'consumption_current_hour', 'energy', 'total', 'kWh', 'consumptionCurrentHour');
  client.publish(announceTopic + 'consumptionCurrentHour/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Consumption Today', 'consumption_today', 'energy', 'total', 'kWh', 'consumptionToday');
  client.publish(announceTopic + 'consumptionToday/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Top Hours Average', 'top_hours_average', 'energy', 'total', 'kWh', 'topHoursAverage');
  client.publish(announceTopic + 'topHoursAverage/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  if (hasProduction) {
    announce = hassDevice('sensor', 'Last meter production', 'last_meter_production', 'energy', 'total_increasing', 'kWh', 'lastMeterProduction');
    client.publish(announceTopic + 'lastMeterProduction/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

    announce = hassDevice('sensor', 'Accumulated production today', 'accumulated_production', 'energy', 'total', 'kWh', 'accumulatedProduction');
    client.publish(announceTopic + 'accumulatedProduction/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

    announce = hassDevice('sensor', 'Accumulated production last hour', 'accumulated_production_last_hour', 'energy', 'total', 'kWh', 'accumulatedProductionLastHour');
    client.publish(announceTopic + 'accumulatedProductionLastHour/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
  }
  announce = hassDevice('sensor', 'Current power use', 'power_current_use', 'power', 'measurement', 'kW', 'power');
  client.publish(announceTopic + 'power/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Min power since midnight', 'min_power_since_midnight', 'power', 'measurement', 'kW', 'minPower');
  client.publish(announceTopic + 'minPower/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Max power since midnight', 'max_power_since_midnight', 'power', 'measurement', 'kW', 'maxPower');
  client.publish(announceTopic + 'maxPower/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Average power since midnight', 'average_power_since_midnight', 'power', 'measurement', 'kW', 'averagePower');
  client.publish(announceTopic + 'averagePower/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Voltage phase 1', 'voltage_phase_1', 'voltage', 'measurement', 'V', 'voltagePhase1');
  client.publish(announceTopic + 'voltagePhase1/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Voltage phase 2', 'voltage_phase_2', 'voltage', 'measurement', 'V', 'voltagePhase2');
  client.publish(announceTopic + 'voltagePhase2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Voltage phase 3', 'voltage_phase_3', 'voltage', 'measurement', 'V', 'voltagePhase3');
  client.publish(announceTopic + 'voltagePhase3/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
  //  hassDevice('deviceType', name, uniqueId, devClass, stateClass, uom, stateTopic)
  announce = hassDevice('sensor', 'Current L1', 'current_L1', 'current', 'measurement', 'A', 'currentL1');
  client.publish(announceTopic + 'currentL1/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Current L2', 'current_L2', 'current', 'measurement', 'A', 'currentL2');
  client.publish(announceTopic + 'currentL2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Current L3', 'current_L3', 'current', 'measurement', 'A', 'currentL3');
  client.publish(announceTopic + 'currentL3/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  // Price/cost messages
  announce = hassDevice('sensor', 'Cost last hour', 'cost_last_hour', 'monetary', 'total', 'kr', 'costLastHour');
  client.publish(announceTopic + 'costLastHour/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Accumulated cost', 'accumulated_cost', 'monetary', 'total', 'kr', 'accumulatedCost');
  client.publish(announceTopic + 'accumulatedCost/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Customer price', 'customer_price', 'monetary', 'total', 'kr/kWh', 'customerPrice');
  client.publish(announceTopic + 'customerPrice/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Spot price', 'spot_price', 'monetary', 'total', 'kr/kWh', 'spotPrice');
  client.publish(announceTopic + 'spotPrice/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Min price today', 'minPrice', 'monetary', 'total', 'kr/kWh', 'minPrice');
  client.publish(announceTopic + 'minPrice/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Max price today', 'maxPrice', 'monetary', 'total', 'kr/kWh', 'maxPrice');
  client.publish(announceTopic + 'maxPrice/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Average price today', 'avgPrice', 'monetary', 'total', 'kr/kWh', 'avgPrice');
  client.publish(announceTopic + 'avgPrice/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Peak price today', 'peakPrice', 'monetary', 'total', 'kr/kWh', 'peakPrice');
  client.publish(announceTopic + 'peakPrice/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Off-peak price 1 today', 'offPeakPrice1', 'monetary', 'total', 'kr/kWh', 'offPeakPrice1');
  client.publish(announceTopic + 'offPeakPrice1/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Off-peak price 2 today', 'offPeakPrice2', 'monetary', 'total', 'kr/kWh', 'offPeakPrice2');
  client.publish(announceTopic + 'offPeakPrice2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  //         hassDevice('deviceType', name, uniqueId, devClass, stateClass, uom, stateTopic)
  announce = hassDevice('sensor', 'Start time', 'start_time', '', '', '', 'startTime');
  client.publish(announceTopic + 'startTime/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
  announce = hassDevice('sensor', 'End time', 'end_time', '', '', '', 'endTime');
  client.publish(announceTopic + 'endTime/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  // Price/cost messages Day2
  announce = hassDevice('sensor', 'Customer price tomorrow', 'customer_price_tomorrow', 'monetary', 'total', 'kr/kWh', 'customerPriceDay2', true);
  client.publish(announceTopic + 'customerPriceDay2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Spot price tomorrow', 'spot_price_tomorrow', 'monetary', 'total', 'kr/kWh', 'spotPriceDay2', true);
  client.publish(announceTopic + 'spotPriceDay2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Min price tomorrow', 'minPriceDay2', 'monetary', 'total', 'kr/kWh', 'minPriceDay2', true);
  client.publish(announceTopic + 'minPriceDay2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Max price tomorrow', 'maxPriceDay2', 'monetary', 'total', 'kr/kWh', 'maxPriceDay2', true);
  client.publish(announceTopic + 'maxPriceDay2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Average price tomorrow', 'avgPriceDay2', 'monetary', 'total', 'kr/kWh', 'avgPriceDay2', true);
  client.publish(announceTopic + 'avgPriceDay2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Peak price tomorrow', 'peakPriceDay2', 'monetary', 'total', 'kr/kWh', 'peakPriceDay2', true);
  client.publish(announceTopic + 'peakPriceDay2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Off-peak price 1 tomorrow', 'offPeakPrice1Day2', 'monetary', 'total', 'kr/kWh', 'offPeakPrice1Day2', true);
  client.publish(announceTopic + 'offPeakPrice1Day2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Off-peak price 2 tomorrow', 'offPeakPrice2Day2', 'monetary', 'total', 'kr/kWh', 'offPeakPrice2Day2', true);
  client.publish(announceTopic + 'offPeakPrice2Day2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  announce = hassDevice('sensor', 'Start time tomorrow', 'start_time_day2', '', '', '', 'startTimeDay2', true);
  client.publish(announceTopic + 'startTimeDay2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
  announce = hassDevice('sensor', 'End time tomorrow', 'end_time_day2', '', '', '', 'endTimeDay2', true);
  client.publish(announceTopic + 'endTimeDay2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  // Set retain flag (pubOpts) on status message to let HA find it after a stop/restart
  client.publish(haBaseTopic + 'status', 'online', pubOpts);
  // binary_sensor
  announce = hassDevice('binary_sensor', 'Spot price below avarage', 'spotBelowAverage', '', 'measurement', '', 'spotBelowAverage');
  client.publish(announceBinaryTopic + 'spotBelowAverage/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
  // binary_sensor
  announce = hassDevice('binary_sensor', 'Spot price below avarage tomorrow', 'spotBelowAverageDay2', '', 'measurement', '', 'spotBelowAverageDay2');
  client.publish(announceBinaryTopic + 'spotBelowAverageDay2/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

  //announce = hassDevice('binary_sensor', 'Spot price below threshold', 'spotBelowThreshold', '', 'measurement', '', 'spotBelowThreshold');
  //client.publish(announceBinaryTopic + 'spotBelowThreshold/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

}; // hassAnnounce()

module.exports = { hassAnnounce };
