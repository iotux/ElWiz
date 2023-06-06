const yaml = require('yamljs');
const configFile = './config.yaml';
const amsCalc = require('../ams/amscalc.js');
const { event } = require('../misc/misc.js');
const {
  hex2Dec,
  hex2Ascii,
  hasData,
  getAmsTime
} = require('../misc/util.js');

// Load broker and topics preferences from config file
const config = yaml.load(configFile);
// const debug = config.DEBUG || false;
const amsDebug = config.amsDebug || false;

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
  DATE: '020209060000010000FF090C',
  LAST_METER_CONSOMPTION: '020309060100010800FF06',
  LAST_METER_PRODUCTION: '020309060100020800FF06',
  LAST_METER_CONSOMPTION_REACTIVE: '020309060100030800FF06',
  LAST_METER_PRODUCTION_REACTIVE: '020309060100040800FF06'
};

let obj = {};

/**
 * Converts a hexadecimal value to a decimal value with a sign.
 * @param {string} hex - The hexadecimal value to be converted.
 * @returns {number} - The converted decimal value with a sign.
 */
function hex2DecSign (hex) {
  let dec = parseInt(hex, 16);
  if ((dec & 0x8000) > 0) {
    dec = dec - 0x10000;
  }
  return dec;
}

async function listDecode (buf) {
  const msg = {};
  msg.data = buf;

  obj = { listType: 'list1', data: {} };

  for (const key in AIDON_CONSTANTS) {
    const constant = AIDON_CONSTANTS[key];
    const dataIndex = hasData(msg.data, constant);
    if (dataIndex > -1) {
      switch (key) {
        case 'METER_VERSION':
          obj.data.meterVersion = hex2Ascii(msg.data.substr(dataIndex, 22));
          obj.listType = 'list2';
          break;
        case 'METER_ID':
          obj.data.meterID = hex2Ascii(msg.data.substr(dataIndex, 32));
          break;
        case 'METER_MODEL':
          obj.data.meterModel = hex2Ascii(msg.data.substr(dataIndex, 8));
          break;
        case 'POWER':
          obj.data.power = hex2Dec(msg.data.substr(dataIndex, 8)) / 1000;
          break;
        case 'POWER_PRODUCTION':
          obj.data.powerProduction = hex2Dec(msg.data.substr(dataIndex, 8)) / 1000;
          break;
        case 'POWER_REACTIVE':
          obj.data.powerReactive = hex2Dec(msg.data.substr(dataIndex, 8)) / 1000;
          break;
        case 'POWER_PRODUCTION_REACTIVE':
          obj.data.powerProductionReactive = hex2Dec(msg.data.substr(dataIndex, 8)) / 1000;
          break;
        case 'CURRENT_L1':
          obj.data.currentL1 = hex2DecSign(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case 'CURRENT_L2':
          obj.data.currentL2 = hex2DecSign(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case 'CURRENT_L3':
          obj.data.currentL3 = hex2DecSign(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case 'VOLTAGE_PHASE_1':
          obj.data.voltagePhase1 = hex2Dec(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case 'VOLTAGE_PHASE_2':
          obj.data.voltagePhase2 = hex2Dec(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case 'VOLTAGE_PHASE_3':
          obj.data.voltagePhase3 = hex2Dec(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case 'DATE':
          obj.data.meterDate = getAmsTime(msg.data, dataIndex);
          obj.listType = 'list3';
          break;
        case 'LAST_METER_CONSOMPTION':
          obj.data.lastMeterConsumption = hex2Dec(msg.data.substr(dataIndex, 8)) / 100;
          break;
        case 'LAST_METER_PRODUCTION':
          obj.data.lastMeterProduction = hex2Dec(msg.data.substr(dataIndex, 8)) / 100;
          break;
        case 'LAST_METER_CONSOMPTION_REACTIVE':
          obj.data.lastMeterConsumptionReactive = hex2Dec(msg.data.substr(dataIndex, 8)) / 100;
          break;
        case 'LAST_METER_PRODUCTION_REACTIVE':
          obj.data.lastMeterProductionReactive = hex2Dec(msg.data.substr(dataIndex, 8)) / 100;
          break;
      }
    }
  }

  if (Object.getOwnPropertyNames(obj.data).length === 0) {
    console.error('Raw data packet exception : ', JSON.stringify(msg));
  }

  return obj;
}

/**
 * Handles the list data by decoding it and emitting an event.
 * @param {Buffer} buf - The list data buffer to be handled.
 */
async function listHandler (buf) {
  const hex = await buf.toString('hex').toUpperCase();
  const result = await listDecode(hex);
  const listObject = result.data;
  const list = result.listType;
  if (amsDebug) {
    if (list === 'list1') {
      event.emit('hex1', hex);
    } else if (list === 'list2') {
      event.emit('hex2', hex);
    } else if (list === 'list3') {
      event.emit('hex3', hex);
    }
  }
  obj = await amsCalc.calc(listObject);
  event.emit(list, obj);
}

event.on('pulse', listHandler);

module.exports = { listHandler };
