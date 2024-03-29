const yaml = require('yamljs');
const configFile = './config.yaml';

// const db = require('../misc/dbinit.js');
const amsCalc = require('../ams/amscalc.js');
const { event } = require('../misc/misc.js');
const { hex2Dec, hex2Ascii, getAmsTime } = require('../misc/util.js');

// Load broker and topics preferences from config file
const config = yaml.load(configFile);
// const debug = config.DEBUG || false;
const amsDebug = config.amsDebug || false;

let len;
let obj = {};
let elements;
let listType;
/**
 * Decode the list message and extract relevant information
 * @param {string} msg - Hexadecimal message string to be decoded
 * @returns {Object} - An object containing the decoded list information and the list type
 */
const listDecode = async function (msg) {
  //let listType = 1;
  //let elements = 0;
  let index = msg.indexOf('FF800000') + 8;
  elements = hex2Dec(msg.substr((index + 2), 2));
  obj = {
    timestamp: getAmsTime(msg, 38),
    isNewHour: false,
    isNewDay: false,
    isNewMonth: false,
    isLastList2: false
  };

  // Process the elements based on their count
  if (elements === 1) {
    listType = 'list1';
    obj.power = hex2Dec(msg.substr(index + 6, 8)) / 1000;
  }

  if (elements >= 9) {
    index = index + 6;
    len = hex2Dec(msg.substr(index, 2)) * 2;
    obj.meterVersion = hex2Ascii(msg.substr(index + 2, len));
    index += 4 + len;
    len = hex2Dec(msg.substr(index, 2)) * 2;
    obj.meterID = hex2Ascii(msg.substr(index + 2, len));
    index += 4 + len;
    len = hex2Dec(msg.substr(index, 2)) * 2;
    obj.meterModel = hex2Ascii(msg.substr(index + 2, len));
    index += 4 + len;
    obj.power = hex2Dec(msg.substr(index, 8)) / 1000;
    obj.powerProduction = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.powerReactive = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.powerProductionReactive = hex2Dec(msg.substr(index += 10, 8)) / 1000;
  }

  if (elements === 9 || elements === 14) {
    listType = 'list2';
    index += 0;
    obj.isLastList2 = obj.timestamp.substr(14, 5) === '00:00';
    obj.currentL1 = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.voltagePhase1 = hex2Dec(msg.substr(index += 10, 8)) / 10;
  }

  if (elements === 13 || elements === 18) {
    listType = 'list2';
    index += 0;
    obj.isLastList2 = obj.timestamp.substr(14, 5) === '00:00';
    obj.currentL1 = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.currentL2 = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.currentL3 = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.voltagePhase1 = hex2Dec(msg.substr(index += 10, 8)) / 10;
    obj.voltagePhase2 = hex2Dec(msg.substr(index += 10, 8)) / 10;
    obj.voltagePhase3 = hex2Dec(msg.substr(index += 10, 8)) / 10;

    if (obj.voltagePhase2 === 0) {
      obj.voltagePhase2 = (Math.sqrt((obj.voltagePhase1 - obj.voltagePhase3 * 0.5) ** 2 + (obj.voltagePhase3 * 0.866) ** 2)).toFixed(0) * 1;
    }
  }

  // Datetime format: 2023-01-10T18:00:00
  if (elements === 14 || elements === 18) {
    listType = 'list3';
    obj.meterDate = getAmsTime(msg, index += 12);
    index += 14;
    obj.lastMeterConsumption = hex2Dec(msg.substr(index += 12, 8)) / 1000;
    obj.lastMeterProduction = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.lastMeterConsumptionReactive = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.lastMeterProductionReactive = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.hourIndex = parseInt(obj.meterDate.substr(11, 2));
    obj.isNewHour = obj.meterDate.substr(14, 5) === '00:10';
    obj.isNewDay = obj.meterDate.substr(11, 8) === '00:00:10';
    obj.isNewMonth = (obj.meterDate.substr(8, 2) === '01' && obj.isNewDay);
  }

  return (obj);
};

/**
 * Handle the list messages, decode them and emit the corresponding event
 * @param {Buffer} buf - Buffer containing the list message
 */
const listHandler = async function (buf) {
  const hex = await buf.toString('hex').toUpperCase();
  const listObject = await listDecode(hex);
  const list = listType;  //result.list;
  if (amsDebug) {
    if (list === 'list1') {
      event.emit('hex1', hex);
    } else if (list === 'list2') {
      event.emit('hex2', hex);
    } else if (list === 'list3') {
      event.emit('hex3', hex);
    }
  }

  obj = await amsCalc(list, listObject);
  if (amsDebug) {
    //obj.listElements = elements;
    //console.log(list, 'Kaifa AMS:', obj);
  }
  event.emit(list, obj);
};

event.on('pulse', listHandler);

module.exports = { listHandler };
