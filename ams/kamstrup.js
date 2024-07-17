const amsCalc = require('../ams/amscalc.js');
const { event } = require('../misc/misc.js');
const {
  hex2Dec,
  hex2Ascii,
  hasData,
  getAmsTime,
  loadYaml
} = require('../misc/util.js');

// Load broker and topics preferences from config file
const configFile = './config.yaml';
const config = loadYaml(configFile);
const debug = config.amscalc.debug || false;

// Aidon constants
const KAMSTRUP_CONSTANTS = {
  // It may be possible to remove '09060' from those starting with that pattern
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
  LAST_METER_PRODUCTION_REACTIVE: '09060101040800FF06'
};

let obj = {};

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

async function listDecode(buf) {
  const ts = getDateTime();
  const msg = {};
  msg.data = buf;

  obj = {
    listType: 'list1',
    data: {
      // 2022-07-01T00:00:00
      timestamp: ts,
      hourIndex: parseInt(ts.substring(11, 13)),
    }
  };

  for (const key in KAMSTRUP_CONSTANTS) {
    const constant = KAMSTRUP_CONSTANTS[key];
    const dataIndex = hasData(msg.data, constant);
    if (dataIndex > -1) {
      switch (key) {
        case 'LIST_2': obj.listType = 'list2'; break;
        case 'LIST_3': obj.listType = 'list3'; break;

        case 'METER_TIMESTAMP':
          obj.data.timestamp = getAmsTime(msg.data, dataIndex);
          break;
        case 'METER_VERSION':
          obj.data.meterVersion = 'Kamstrup_' + hex2Ascii(msg.data.substr(dataIndex, 10));
          //obj.listType = 'list2';
          break;
        case 'METER_ID':
          obj.data.meterID = hex2Ascii(msg.data.substr(dataIndex, 32));
          break;
        case 'METER_MODEL':
          obj.data.meterModel = hex2Ascii(msg.data.substr(dataIndex, 36));
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
          obj.data.currentL1 = hex2DecSign(msg.data.substr(dataIndex, 8)) / 100;
          break;
        case 'CURRENT_L2':
          obj.data.currentL2 = hex2DecSign(msg.data.substr(dataIndex, 8)) / 100;
          break;
        case 'CURRENT_L3':
          obj.data.currentL3 = hex2DecSign(msg.data.substr(dataIndex, 8)) / 100;
          break;
        case 'VOLTAGE_PHASE_1':
          obj.data.voltagePhase1 = hex2Dec(msg.data.substr(dataIndex, 4)); // / 10;
          break;
        case 'VOLTAGE_PHASE_2':
          obj.data.voltagePhase2 = hex2Dec(msg.data.substr(dataIndex, 4)); // / 10;
          break;
        case 'VOLTAGE_PHASE_3':
          obj.data.voltagePhase3 = hex2Dec(msg.data.substr(dataIndex, 4)); // / 10;
          break;
        case 'METER_DATE':
          obj.data.meterDate = getAmsTime(msg.data, dataIndex);
          obj.data.isNewHour = obj.data.meterDate.substr(14, 2) === '00';
          obj.data.isNewDay = obj.data.meterDate.substr(11, 5) === '00:00';
          obj.data.isNewMonth = (obj.data.meterDate.substr(8, 2) === '01' && obj.data.isNewDay);
          //obj.listType = 'list3';
          break;
        case 'LAST_METER_CONSUMPTION':
          obj.data.lastMeterConsumption = hex2Dec(msg.data.substr(dataIndex, 8)) / 100;
          break;
        case 'LAST_METER_PRODUCTION':
          obj.data.lastMeterProduction = hex2Dec(msg.data.substr(dataIndex, 8)) / 100;
          break;
        case 'LAST_METER_CONSUMPTION_REACTIVE':
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
  if (obj.listType === 'list1') {
    obj.data.isLastList1 = obj.data.timestamp.substr(14, 5) > '59:57';
  }
  if (obj.listType === 'list2') {
    obj.data.isLastList2 = obj.data.timestamp.substr(14, 5) > '59:45';
  }

  return obj;
}

/**
 * Handles the list data by decoding it and emitting an event.
 * @param {Buffer} buf - The list data buffer to be handled.
 */
async function listHandler(buf) {
  const hex = await buf.toString('hex').toUpperCase();
  const result = await listDecode(hex);
  const listObject = result.data;
  const list = result.listType;
  if (debug) {
    if (list === 'list1') {
      event.emit('hex1', hex);
    } else if (list === 'list2') {
      event.emit('hex2', hex);
    } else if (list === 'list3') {
      event.emit('hex3', hex);
    }
  }
  obj = await amsCalc.calc(list, listObject);
  event.emit(list, obj);
}

event.on('pulse', listHandler);

module.exports = { listHandler };
