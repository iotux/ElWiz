const yaml = require("yamljs");
const configFile = "./config.yaml";

const db = require('../misc/dbinit.js');
const amsCalc = require('../ams/amscalc.js');
const { event } = require('../misc/misc.js');
const { hex2Dec, hex2Ascii, getAmsTime } = require('../misc/util.js');

// Load broker and topics preferences from config file
const config = yaml.load(configFile);
const amsDebug = config.amsDebug || false;

let len;
let obj = new Object();

const listDecode = async function (msg) {
  let listType = 1;
  let elements = 0;
  let index = msg.indexOf("FF800000") + 8;
  elements = hex2Dec(msg.substring((index + 2), (index + 4)));
  obj = {};
  obj.timestamp = getAmsTime(msg, 38);

  // Process the elements based on their count
  if (elements === 1) {
    listType = 'list1';
    obj.power = hex2Dec(msg.substring(index + 6, index + 14)) / 1000;
  }

  if (elements >= 9) {
    index = index + 6;
    len = hex2Dec(msg.substring(index, index + 2)) * 2;
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
    listType = 'list2';
    index += 0;
    obj.currentL1 = hex2Dec(msg.substring(index + 10, index + 18)) / 1000;
    obj.voltagePhase1 = hex2Dec(msg.substring(index + 20, index + 28)) / 10;
  }

  if (elements === 13 || elements === 18) {
    listType = 'list2';
    index += 0;
    obj.currentL1 = hex2Dec(msg.substring(index + 10, index + 18)) / 1000;
    obj.currentL2 = hex2Dec(msg.substring(index + 20, index + 28)) / 1000;
    obj.currentL3 = hex2Dec(msg.substring(index + 30, index + 38)) / 1000;
    obj.voltagePhase1 = hex2Dec(msg.substring(index + 40, index + 48)) / 10;
    obj.voltagePhase2 = hex2Dec(msg.substring(index + 50, index + 58)) / 10;
    obj.voltagePhase3 = hex2Dec(msg.substring(index + 60, index + 68)) / 10;
    if (obj.voltagePhase2 === 0) {
      obj.voltagePhase2 = (Math.sqrt((obj.voltagePhase1 - obj.voltagePhase3 * 0.5) ** 2 + (obj.voltagePhase3 * 0.866) ** 2)).toFixed(0) * 1;
    }
  }

  if (elements === 14 || elements === 18) {
    listType = 'list3';
    obj.meterDate = getAmsTime(msg, index += 12);
    index += 14;
    obj.lastMeterConsumption = hex2Dec(msg.substring(index + 12, index + 20)) / 1000;
    obj.lastMeterProduction = hex2Dec(msg.substring(index + 22, index + 30)) / 1000;
    obj.lastMeterConsumptionReactive = hex2Dec(msg.substring(index + 32, index + 40)) / 1000;
    obj.lastMeterProductionReactive = hex2Dec(msg.substring(index + 42, index + 50)) / 1000;
  };

  return { "data": obj, "list": listType };
};

/**
 * Handle the list messages, decode them and emit the corresponding event
 * @param {Buffer} buf - Buffer containing the list message
 */
const listHandler = async function (buf) {
  let hex = await buf.toString('hex').toUpperCase();
  let result = await listDecode(hex);
  let listObject = result['data'];
  let list = result['list'];
  if (amsDebug) {
    if (list === 'list1') {
      event.emit('hex1', hex)
    } else if ( list === 'list2') {
      event.emit('hex2', hex)
    } else if ( list === 'list3') {
      event.emit('hex3', hex)
    }
  }
  obj = await amsCalc.calc(list, listObject);
  event.emit(list, obj);
};

event.on('pulse', listHandler);

module.exports = { listHandler };
