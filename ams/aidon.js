const amsCalc = require('../ams/amscalc.js');
const { event } = require('../misc/misc.js');
const { hex2Dec, hex2Ascii, hasData, getAmsTime, getDateTime, replaceChar, loadYaml } = require('../misc/util.js');

// Load broker and topics preferences from config file
const configFile = './config.yaml';
const config = loadYaml(configFile);
const debug = config.amscalc.debug || false;

const lastTick = config.amsLastTick || '59:56';

// Aidon constants
const AIDON_CONSTANTS = {
  METER_VERSION: '020209060101000281FF0A0B',
  METER_ID: '020209060000600100FF0A10',
  METER_MODEL: '020209060000600107FF0A04',
  POWER: '020309060100010700FF06',
  POWER_PRODUCTION: '020309060100020700FF06',
  POWER_REACTIVE: '020309060100030700FF06',
  POWER_PRODUCTION_REACTIVE: '020309060100040700FF06',
  CURRENT_L1: '0203090601001F0700FF10',
  CURRENT_L2: '020309060100330700FF10',
  CURRENT_L3: '020309060100470700FF10',
  VOLTAGE_PHASE_1: '020309060100200700FF12',
  VOLTAGE_PHASE_2: '020309060100340700FF12',
  VOLTAGE_PHASE_3: '020309060100480700FF12',
  METER_DATE: '020209060000010000FF090C',
  LAST_METER_CONSUMPTION: '020309060100010800FF06',
  LAST_METER_PRODUCTION: '020309060100020800FF06',
  LAST_METER_CONSUMPTION_REACTIVE: '020309060100030800FF06',
  LAST_METER_PRODUCTION_REACTIVE: '020309060100040800FF06',
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
  let ts = getDateTime();
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
    if (obj.hourIndex === 0) {
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

  for (const key in AIDON_CONSTANTS) {
    const constant = AIDON_CONSTANTS[key];
    const dataIndex = hasData(msg, constant);
    if (dataIndex > -1) {
      switch (key) {
        case 'METER_VERSION':
          obj.listType = 'list2';
          obj.meterVersion = hex2Ascii(msg.substring(dataIndex, dataIndex + 22));
          break;
        case 'METER_ID':
          obj.meterID = hex2Ascii(msg.substring(dataIndex, dataIndex + 32));
          break;
        case 'METER_MODEL':
          obj.meterModel = hex2Ascii(msg.substring(dataIndex, dataIndex + 8));
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
          obj.currentL1 = hex2DecSign(msg.substring(dataIndex, dataIndex + 4)) / 10;
          break;
        case 'CURRENT_L2':
          obj.currentL2 = hex2DecSign(msg.substring(dataIndex, dataIndex + 4)) / 10;
          break;
        case 'CURRENT_L3':
          obj.currentL3 = hex2DecSign(msg.substring(dataIndex, dataIndex + 4)) / 10;
          break;
        case 'VOLTAGE_PHASE_1':
          obj.voltagePhase1 = hex2Dec(msg.substring(dataIndex, dataIndex + 4)) / 10;
          break;
        case 'VOLTAGE_PHASE_2':
          obj.voltagePhase2 = hex2Dec(msg.substring(dataIndex, dataIndex + 4)) / 10;
          break;
        case 'VOLTAGE_PHASE_3':
          obj.voltagePhase3 = hex2Dec(msg.substring(dataIndex, dataIndex + 4)) / 10;
          break;
        case 'METER_DATE':
          obj.listType = 'list3';
          obj.timestamp = replaceChar(ts, 18, '0'); // Align the timestamp
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

  if (Object.getOwnPropertyNames(obj).length === 0) {
    console.error('Raw data packet exception : ', JSON.stringify(msg));
  }

  return obj;
}

/**
 * Handles the list data by decoding it and emitting an event.
 * @param {Buffer} buf - The list data buffer to be handled.
 */
async function listHandler(buf) {
  const hex = buf.toString('hex').toUpperCase();
  const listObject = await listDecode(hex);
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
