const yaml = require("yamljs");
const configFile = "./config.yaml";

const db = require('../misc/dbinit.js')
const amsCalc = require('../ams/amscalc.js')
const { event } = require('../misc/misc.js')
const { hex2Dec, hex2Ascii, getAmsTime } = require('../misc/util.js')

// Load broker and topics preferences from config file
const config = yaml.load(configFile);
const debug = config.DEBUG;

let len;
let obj = new Object();

function getMinPower(pow) {
  if (db.get('minPower') === undefined || db.get('minPower') > pow){
    db.set('minPower', pow);
  }
  return db.get('minPower');
};

function getMaxPower(pow) {
  if (db.get('maxPower') === undefined || db.get('maxPower') < pow) {
    db.set('maxPower', pow);
  }
  return db.get('maxPower');
};

const listDecode = async function (msg) {
  let listType = 1;
  let elements = 0;
  let index = msg.indexOf("FF800000") + 8
  elements = await hex2Dec(msg.substr((index + 2), 2))
  obj = {};
  obj.timestamp = getAmsTime(msg, 38)

  if (elements === 1) {
    listType = 'list1'
    obj.power = await hex2Dec(msg.substr(index + 6, 8)) / 1000;
  };

  if (elements >= 9) {
    index = index + 6
    len = hex2Dec(msg.substr(index, 2)) * 2
    obj.meterVersion = hex2Ascii(msg.substr(index + 2, len))
    index += 4 + len;
    len = hex2Dec(msg.substr(index, 2)) * 2
    obj.meterID = hex2Ascii(msg.substr(index + 2, len))
    index += 4 + len;
    len = hex2Dec(msg.substr(index, 2)) * 2
    obj.meterModel = hex2Ascii(msg.substr(index + 2, len))
    index += 4 + len;
    obj.power = hex2Dec(msg.substr(index, 8)) / 1000;
    obj.powerProduction = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.powerReactive = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.powerProductionReactive = hex2Dec(msg.substr(index += 10, 8)) / 1000;
  };

  if (elements === 9 || elements === 14) {
    console.log('Index type 2', index)
    listType = 'list2'
    index += 0;
    obj.currentL1 = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.voltagePhase1 = hex2Dec(msg.substr(index += 10, 8)) / 10;
  };

  if (elements === 13 || elements === 18) {
    listType = 'list2'
    index += 0;
    obj.currentL1 = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.currentL2 = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.currentL3 = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.voltagePhase1 = hex2Dec(msg.substr(index += 10, 8)) / 10;
    obj.voltagePhase2 = hex2Dec(msg.substr(index += 10, 8)) / 10;
    obj.voltagePhase3 = hex2Dec(msg.substr(index += 10, 8)) / 10;

    if (obj.voltagePhase2 === 0) // This meter doesn't measure L1L3
      obj.voltagePhase2 = (Math.sqrt((obj.voltagePhase1 - obj.voltagePhase3 * 0.5) ** 2 + (obj.voltagePhase3 * 0.866) ** 2)).toFixed(0) * 1;
  };

  if (elements === 14 || elements === 18) {
    console.log('Index type 3', index)
    listType = 'list3'

    obj.meterDate = await getAmsTime(msg, index += 12);
    index += 14;
    obj.lastMeterConsumption = hex2Dec(msg.substr(index += 12, 8)) / 1000;
    obj.lastMeterProduction = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.lastMeterConsumptionReactive = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.lastMeterProductionReactive = hex2Dec(msg.substr(index += 10, 8)) / 1000;
  };

  obj.minPower = await getMinPower(obj.power);
  obj.maxPower = await getMaxPower(obj.power);
  // TODO: calculate average
  obj.averagePower = 0;
  let ret = { "data": obj, "list": listType }
  return ret;
};

const listHandler = async function (buf) {
  let hex = await buf.toString('hex').toUpperCase();
  let result = await listDecode(hex)
  let listObject = result['data'];
  let list = result['list'];
  if (list === 'list3')
    obj = await amsCalc.calc(listObject);
  await event.emit(list, obj);
};

event.on('pulse', listHandler)

module.exports = {listHandler};
