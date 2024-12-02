
// const db = require('../misc/dbinit.js');
const amsCalc = require('../ams/amscalc.js');
const { event } = require('../misc/misc.js');
const { hex2Dec, hex2Ascii, getAmsTime, loadYaml } = require('../misc/util.js');

// Load broker and topics preferences from config file
const configFile = './config.yaml';
const config = loadYaml(configFile);

const debug = config.amscalc.debug || false;

const amsLastMessage = config.amsLastMessage || '59:56';

let obj = {};
let isHourStarted = false;
/**
 * Decode the list message and extract relevant information
 * @param {string} msg - Hexadecimal message string to be decoded
 * @returns {Object} - An object containing the decoded list information and the list type
 */
const listDecode = async function (msg) {
  let index = msg.indexOf('FF') + 8;
  const elements = hex2Dec(msg.substring(index + 2, index + 4)); // Correct
  const ts = getAmsTime(msg, 38);
  const hourIndex = parseInt(ts.substring(11, 13));
  const minuteIndex = parseInt(ts.substring(14, 16));
  const timeSubStr = ts.substr(14, 5);

  let obj = {
    listType: 'list1',
    timestamp: ts,
    hourIndex: hourIndex,
    power: null
  };

  if (!isHourStarted && minuteIndex === 0) {
    obj.isHourStart = true;
    isHourStarted = true;
    if (hourIndex === 0) {
      obj.isDayStart = true;
      if (ts.substring(8, 10) === '01')
        obj.isMonthStart = true;
    }
  }

  if (minuteIndex !== 0) {
    isHourStarted = false;
  }

  // Last message before next hour
  if (timeSubStr > amsLastMessage) {
    obj.isHourEnd = true;
    if (hourIndex === 23) {
      obj.isDayEnd = true;
    }
  }

  // Process the elements based on their count
  if (elements === 1) {
    obj.listType = 'list1';
    obj.power = hex2Dec(msg.substring(index + 6, index + 14)) / 1000;
    //console.log('AMS Kaifa: list1', obj)
  }

  if (elements >= 9) {
    index = index + 6;
    let len = hex2Dec(msg.substring(index, index + 2)) * 2;
    obj.meterVersion = hex2Ascii(msg.substring(index + 2, index + 2 + len));
    index += 4 + len;
    len = hex2Dec(msg.substring(index, index + 2)) * 2;
    obj.meterID = hex2Ascii(msg.substring(index + 2, index + 2 + len));
    index += 4 + len;
    len = hex2Dec(msg.substring(index, index + 2)) * 2;
    obj.meterModel = hex2Ascii(msg.substring(index + 2, index + 2 + len));
    index += 4 + len;
    obj.power = hex2Dec(msg.substring(index, index + 8)) / 1000;
    obj.powerProduction = hex2Dec(msg.substring(index + 10, index + 18)) / 1000;
    obj.powerReactive = hex2Dec(msg.substring(index + 20, index + 28)) / 1000;
    obj.powerProductionReactive = hex2Dec(msg.substring(index + 30, index + 38)) / 1000;
  }

  if (elements === 9 || elements === 14) {
    obj.listType = 'list2';
    index += 40;
    obj.currentL1 = hex2Dec(msg.substring(index, index + 8)) / 1000;
    obj.voltagePhase1 = hex2Dec(msg.substring(index + 10, index + 18)) / 10;
    index += 10;
  }

  if (elements === 13 || elements === 18) {
    obj.listType = 'list2';
    index += 40;
    obj.currentL1 = hex2Dec(msg.substring(index, index + 8)) / 1000;
    obj.currentL2 = hex2Dec(msg.substring(index + 10, index + 18)) / 1000;
    obj.currentL3 = hex2Dec(msg.substring(index + 20, index + 28)) / 1000;
    obj.voltagePhase1 = hex2Dec(msg.substring(index + 30, index + 38)) / 10;
    obj.voltagePhase2 = hex2Dec(msg.substring(index + 40, index + 48)) / 10;
    obj.voltagePhase3 = hex2Dec(msg.substring(index + 50, index + 58)) / 10;
    index += 50;

    if (obj.voltagePhase2 === 0) {
      obj.voltagePhase2 = (Math.sqrt((obj.voltagePhase1 - obj.voltagePhase3 * 0.5) ** 2 + (obj.voltagePhase3 * 0.866) ** 2)).toFixed(0) * 1;
    }
  }

  // Datetime format: 2023-01-10T18:00:00
  if (elements === 14 || elements === 18) {
    obj.listType = 'list3';
    index += 12;
    obj.meterDate = getAmsTime(msg, index);
    index += 26;

    obj.lastMeterConsumption = hex2Dec(msg.substring(index, index + 8)) / 1000;
    obj.lastMeterProduction = hex2Dec(msg.substring(index + 10, index + 18)) / 1000;
    obj.lastMeterConsumptionReactive = hex2Dec(msg.substring(index + 20, index + 28)) / 1000;
    obj.lastMeterProductionReactive = hex2Dec(msg.substring(index + 30, index + 38)) / 1000;
    obj.isNewHour = obj.meterDate.substring(14, 19) === '00:10';
    obj.isNewDay = obj.meterDate.substring(11, 19) === '00:00:10';
    obj.isNewMonth = (obj.meterDate.substring(8, 10) === '01' && obj.isNewDay);
  }

  return (obj);
};

/**
 * Handle the list messages, decode them and emit the corresponding event
 * @param {Buffer} buf - Buffer containing the list message
 */
const listHandler = async function (buf) {
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
};

event.on('pulse', listHandler);

module.exports = { listHandler };
