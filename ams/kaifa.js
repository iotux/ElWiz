const yaml = require("yamljs");
const configFile = "./config.yaml";

const db = require('../misc/dbinit.js')
const amsCalc = require('../ams/amscalc.js')
const { event } = require('../misc/misc.js')
const { hex2Dec, hex2Ascii, getAmsTime } = require('../misc/util.js')

// Load broker and topics preferences from config file
const config = yaml.load(configFile);
const debug = config.DEBUG;

// 1-phase Kaifa meter 
const list11 = "7ea027010201105a87e6e7000f40000000090c07e60a0d040b0d04ff80000002010600000d58e3ce7e"
const list12 = "7ea06501020110f050e6e7000f40000000090c07e60a0c03112d0aff800000020909074b464d5f30303109103639373036333134303331353138373109084d41313035483245060000054306000000000600000000060000014a0600001775060000092e57267e"
const list13 = "7ea087010201109e6de6e7000f40000000090c07e60a0e0515000aff800000020e09074b464d5f30303109103639373036333134303331353138373109084d41313035483245060000070a06000000000600000000060000014d0600001efb0600000924090c07e60a0e0515000aff8000000605c0afa406000000000600037b0d060093cf02e6167e"
// 3-phase Kaifa meter
const list31 = "7ea027010201105a87e6e7000f40000000090c07e60a0d040b0d04ff80000002010600000d58e3ce7e"
const list32 = "7ea079010201108093e6e7000f40000000090c07e60a0d040b0d00ff800000020d09074b464d5f30303109103639373036333134303337353736313509084d413330344833450600000d580600000000060000000006000000390600002ff50600000fcc0600002cd3060000092e0600000000060000091c84a37e"
const list33 = "7ea09b01020110eeaee6e7000f40000000090c07e60a0d040c000aff800000021209074b464d5f30303109103639373036333134303337353736313509084d413330344833450600000aed06000000000600000000060000004a06000028590600000fd1060000245d06000009310600000000060000091f090c07e60a0d040c000aff8000000604ecce7906000000000602228b19060020af9a68877e"

function hasData(data, pattern) {
  return data.includes(pattern) ? data.indexOf(pattern) + pattern.length : -1;
}

let len;
let obj = new Object();
//obj = {
//  list: 1,
//  data: {}
//}

let isVirgin = true;
let minPower = 9999999;
let maxPower = 0;
let averagePower = 0;
let index = 0;
//let elements = 0;
//let list = "";


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
  let list;
  let listType = 1;
  let elements = 0;
  let index = msg.indexOf("FF800000") + 8
  elements = await hex2Dec(msg.substr((index + 2), 2))
  //console.log("Elements", elements)
  //let obj = new Object();
  obj = {};
  obj.timestamp = getAmsTime(msg, 38)

  if (elements === 1) {
    //obj = {};
    // listType = 1;
    listType = 'list1'
    obj.power = await hex2Dec(msg.substr(index + 6, 8)) / 1000;
    //obj.elements = elements
  };

  if (elements >= 9) {
    //obj = {};
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
    //obj.elements = elements
  };

  if (elements === 9 || elements === 14) {
    console.log('Index type 2', index)
    // listType = 2;
    listType = 'list2'
    index += 0;
    obj.currentL1 = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.voltagePhase1 = hex2Dec(msg.substr(index += 10, 8)) / 10;
    //obj.elements = elements
  };
  if (elements === 13 || elements === 18) {
    // listType = 2;
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
    //obj.elements = elements
  };

  if (elements === 14 || elements === 18) {
    console.log('Index type 3', index)
    // listType = 3;
    listType = 'list3'

    obj.meterDate = await getAmsTime(msg, index += 12);
    index += 14;
    obj.lastMeterConsumption = hex2Dec(msg.substr(index += 12, 8)) / 1000;
    obj.lastMeterProduction = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.lastMeterConsumptionReactive = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    obj.lastMeterProductionReactive = hex2Dec(msg.substr(index += 10, 8)) / 1000;
    //obj.elements = elements
  };
  obj.minPower = await getMinPower(obj.power);
  obj.maxPower = await getMaxPower(obj.power);
  // TODO: calculate average
  obj.averagePower = 0;
  let ret = { "data": obj, "list": listType }
  return ret;
};

const listHandler = async function (buf) {
  buf = list33
  let hex = await buf.toString('hex').toUpperCase();
  let result = await listDecode(hex)
  let listObject = result['data'];
  let list = result['list'];
  if (list === 'list3')
    obj = await amsCalc.calc(listObject);
  //await console.log(list, obj);
  await event.emit(list, obj);
};

event.on('pulse', listHandler)

module.exports = {listHandler};
