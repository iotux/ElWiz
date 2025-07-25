const amsCalc = require('../ams/amscalc.js');
const { event } = require('../misc/misc.js');
const { hex2Dec, hex2Ascii, hasData, getAmsTime, loadYaml } = require('../misc/util.js');

// Load broker and topics preferences from config file
const configFile = './config.yaml';
const config = loadYaml(configFile);
const debug = config.amscalc.debug || false;

// As Kamstrup doesn't provide List1 packets, the following values may need adjustment
const firstTick = config.amsFirstTick || '00:04';
const lastTick = config.amsLastTick || '59:56';

// Kamstrup constants
const KAMSTRUP_CONSTANTS = {
  LIST_2: '02190A0E',
  LIST_3: '02230A0E',
  METER_TIMESTAMP: 'E7000F000000000C',
  METER_VERSION: '4B616D73747275705F',
  METER_ID: '09060101000005FF0A10',
  METER_MODEL: '09060101600101FF0A12',
  POWER: '09060101010700FF06',
  POWER_PRODUCTION: '09060101020700FF06',
  POWER_REACTIVE: '09060101030700FF06',
  POWER_PRODUCTION_REACTIVE: '09060101040700FF06',
  CURRENT_L1: '090601011F0700FF06',
  CURRENT_L2: '09060101330700FF06',
  CURRENT_L3: '09060101470700FF06',
  VOLTAGE_PHASE_1: '09060101200700FF12',
  VOLTAGE_PHASE_2: '09060101340700FF12',
  VOLTAGE_PHASE_3: '09060101480700FF12',
  METER_DATE: '09060001010000FF090C',
  LAST_METER_CONSUMPTION: '09060101010800FF06',
  LAST_METER_PRODUCTION: '09060101020800FF06',
  LAST_METER_CONSUMPTION_REACTIVE: '09060101030800FF06',
  LAST_METER_PRODUCTION_REACTIVE: '09060101040800FF06',
};

let obj = {};

let isHourStarted = false;

/**
 * Converts a hexadecimal value to a decimal value with a sign.
 * @param {string} hex - The hexadecimal value to be converted.
 * @returns {number} - The converted decimal value with a sign.
 */
function hex2DecSign(hex) {
  let dec = parseInt(hex, 16);
  if ((dec & 0x8000) > 0) {
    dec = dec - 0x10000;
  }
  return dec;
}

async function listDecode(msg) {
  const ts = getDateTime();
  const hourIndex = parseInt(ts.substring(11, 13));
  const minuteIndex = parseInt(ts.substring(14, 16));
  const timeSubStr = ts.substring(14, 19);

  obj = {
    listType: 'list1',
    timestamp: ts,
    hourIndex: hourIndex,
    power: null,
  };

  // Check if the current time is at the start of the hour
  if (!isHourStarted && minuteIndex === 0) {
    obj.isNewHour = true;
    isHourStarted = true; // Mark that the start of the hour has been handled
    if (hourIndex === 0) {
      obj.isNewDay = true;
      if (ts.substring(8, 10) === '01') obj.isNewMonth = true;
    }
  }

  // Reset the isHourStarted flag when it's no longer the start of the hour
  if (minuteIndex !== 0) {
    isHourStarted = false;
  }

  if (timeSubStr > lastTick) {
    obj.isHourEnd = true;
    if (hourIndex === 23) {
      obj.isDayEnd = true;
    }
  }

  for (const key in KAMSTRUP_CONSTANTS) {
    const constant = KAMSTRUP_CONSTANTS[key];
    const dataIndex = hasData(msg, constant);
    if (dataIndex > -1) {
      switch (key) {
        case 'LIST_2':
          obj.listType = 'list2';
          break;
        case 'LIST_3':
          obj.listType = 'list3';
          break;

        case 'METER_TIMESTAMP':
          obj.timestamp = getAmsTime(msg, dataIndex);
          break;
        case 'METER_VERSION':
          obj.meterVersion = 'Kamstrup_' + hex2Ascii(msg.substring(dataIndex, dataIndex + 10));
          break;
        case 'METER_ID':
          obj.meterID = hex2Ascii(msg.substring(dataIndex, dataIndex + 32));
          break;
        case 'METER_MODEL':
          obj.meterModel = hex2Ascii(msg.substring(dataIndex, dataIndex + 36));
          break;
        case 'POWER':
          obj.power = hex2Dec(msg.substring(dataIndex, dataIndex + 8)) / 1000;
          break;
        case 'POWER_PRODUCTION':
          obj.powerProduction = hex2Dec(msg.substring(dataIndex, dataIndex + 8)) / 1000;
          break;
        case 'POWER_REACTIVE':
          obj.powerReactive = hex2Dec(msg.substring(dataIndex, dataIndex + 8)) / 1000;
          break;
        case 'POWER_PRODUCTION_REACTIVE':
          obj.powerProductionReactive = hex2Dec(msg.substring(dataIndex, dataIndex + 8)) / 1000;
          break;
        case 'CURRENT_L1':
          obj.currentL1 = hex2DecSign(msg.substring(dataIndex, dataIndex + 8)) / 100;
          break;
        case 'CURRENT_L2':
          obj.currentL2 = hex2DecSign(msg.substring(dataIndex, dataIndex + 8)) / 100;
          break;
        case 'CURRENT_L3':
          obj.currentL3 = hex2DecSign(msg.substring(dataIndex, dataIndex + 8)) / 100;
          break;
        case 'VOLTAGE_PHASE_1':
          obj.voltagePhase1 = hex2Dec(msg.substring(dataIndex, dataIndex + 4)); // / 10;
          break;
        case 'VOLTAGE_PHASE_2':
          obj.voltagePhase2 = hex2Dec(msg.substring(dataIndex, dataIndex + 4)); // / 10;
          break;
        case 'VOLTAGE_PHASE_3':
          obj.voltagePhase3 = hex2Dec(msg.substring(dataIndex, dataIndex + 4)); // / 10;
          break;
        case 'METER_DATE':
          obj.meterDate = getAmsTime(msg, dataIndex);
          break;
        case 'LAST_METER_CONSUMPTION':
          obj.lastMeterConsumption = hex2Dec(msg.substring(dataIndex, dataIndex + 8)) / 100;
          break;
        case 'LAST_METER_PRODUCTION':
          obj.lastMeterProduction = hex2Dec(msg.substring(dataIndex, dataIndex + 8)) / 100;
          break;
        case 'LAST_METER_CONSUMPTION_REACTIVE':
          obj.lastMeterConsumptionReactive = hex2Dec(msg.substring(dataIndex, dataIndex + 8)) / 100;
          break;
        case 'LAST_METER_PRODUCTION_REACTIVE':
          obj.lastMeterProductionReactive = hex2Dec(msg.substring(dataIndex, dataIndex + 8)) / 100;
          break;
      }
    }
  }

  if (Object.keys(obj).length === 0) {
    console.error('Raw data packet exception : ', JSON.stringify(msg));
  }
  if (obj.listType === 'list1') {
    obj.isLastList1 = obj.timestamp.substring(14, 19) > '59:57';
  }
  if (obj.listType === 'list2') {
    obj.isLastList2 = obj.timestamp.substring(14, 19) > '59:45';
  }

  return obj;
}

/**
 * Handles the list data by decoding it and emitting an event.
 * @param {Buffer} buf - The list data buffer to be handled.
 */
async function listHandler(buf) {
  const hex = buf.toString('hex').toUpperCase();
  const result = await listDecode(hex);
  const listObject = result;
  const list = listObject.listType;
  if (debug) {
    if (list === 'list1') {
      event.emit('hex1', hex);
    } else if (list === 'list2') {
      event.emit('hex2', hex);
    } else if (list === 'list3') {
      event.emit('hex3', hex);
    }
  }
  obj = await amsCalc(list, listObject);
  event.emit(list, obj);
}

event.on('pulse', listHandler);

module.exports = { listHandler };
