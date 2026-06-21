const amsCalc = require('../ams/amscalc.js');
const { event } = require('../misc/misc.js');
const { hex2Dec, hex2Ascii, getAmsTime, loadYaml, crc16 } = require('../misc/util.js');

// Load broker and topics preferences from config file
const configFile = './config.yaml';
let config;
try {
  config = loadYaml(configFile);
} catch (error) {
  console.error(`[Kaifa] Error loading config file ${configFile}: ${error.message}`);
  throw error; // Re-throw the error to be handled by the caller
}

const debug = config.amsMeter.debug || false;
const debugHex = config.amsMeter.debugHex || false;

const amsLastMessage = config.amsLastMessage || '59:56';

let obj = {};
let isHourStarted = false;
/**
 * Decode the list message and extract relevant information
 * @param {string} msg - Hexadecimal message string to be decoded
 * @returns {Object} - An object containing the decoded list information and the list type
 */
const listDecode = async function (msg) {
  // HDLC Frame Validation
  if (!msg.startsWith('7E') || !msg.endsWith('7E')) return null;

  const frameHex = msg.substring(2, msg.length - 2);
  const frameBytes = Buffer.from(frameHex, 'hex');

  // Length check (bits 0-10 of the first 2 bytes)
  const lengthField = (frameBytes[0] << 8) | frameBytes[1];
  const frameLength = lengthField & 0x07ff;
  if (frameBytes.length !== frameLength) return null;

  // CRC check (last 2 bytes of the frame are the FCS)
  const dataForCrc = frameBytes.slice(0, frameLength - 2);
  const receivedFcs = (frameBytes[frameLength - 1] << 8) | frameBytes[frameLength - 2];
  const calculatedCrc = crc16(dataForCrc);

  if (calculatedCrc !== receivedFcs) {
    if (debug) console.error('[Kaifa] CRC Check failed');
    return null;
  }

  let index = msg.indexOf('FF') + 8;
  const elements = hex2Dec(msg.substring(index + 2, index + 4)); // Correct
  const ts = getAmsTime(msg, 38);
  const hourIndex = parseInt(ts.substring(11, 13));
  const minuteIndex = parseInt(ts.substring(14, 16));
  const timeSubStr = ts.substring(14, 19);

  let obj = {
    listType: 'list1',
    timestamp: ts,
    hourIndex: hourIndex,
    power: null,
  };

  if (!isHourStarted && minuteIndex === 0) {
    obj.isNewHour = true;
    isHourStarted = true;
    if (hourIndex === 0) {
      obj.isNewDay = true;
      if (ts.substring(8, 10) === '01') obj.isNewMonth = true;
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
    const p_hex = msg.substring(index + 6, index + 14);
    obj.power = hex2Dec(p_hex) / 1000;
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

    const p_hex = msg.substring(index, index + 8);
    obj.power = hex2Dec(p_hex) / 1000;

    const pp_hex = msg.substring(index + 10, index + 18);
    obj.powerProduction = hex2Dec(pp_hex) / 1000;

    const pr_hex = msg.substring(index + 20, index + 28);
    obj.powerReactive = hex2Dec(pr_hex) / 1000;

    const ppr_hex = msg.substring(index + 30, index + 38);
    obj.powerProductionReactive = hex2Dec(ppr_hex) / 1000;
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
      obj.voltagePhase2 = Math.sqrt((obj.voltagePhase1 - obj.voltagePhase3 * 0.5) ** 2 + (obj.voltagePhase3 * 0.866) ** 2).toFixed(0) * 1;
    }
  }

  // Datetime format: 2023-01-10T18:00:00
  if (elements === 14 || elements === 18) {
    obj.listType = 'list3';
    index += 12;
    obj.meterDate = getAmsTime(msg, index);
    index += 26;

    const lmc = hex2Dec(msg.substring(index, index + 8));
    obj.lastMeterConsumption = lmc / 1000;

    const lmp = hex2Dec(msg.substring(index + 10, index + 18));
    obj.lastMeterProduction = lmp / 1000;

    const lmcr = hex2Dec(msg.substring(index + 20, index + 28));
    obj.lastMeterConsumptionReactive = lmcr / 1000;

    const lmpr = hex2Dec(msg.substring(index + 30, index + 38));
    obj.lastMeterProductionReactive = lmpr / 1000;
  }

  return obj;
};

/**
 * Handle the list messages, decode them and emit the corresponding event
 * @param {Buffer} buf - Buffer containing the list message
 */
const listHandler = async function (buf) {
  const hex = buf.toString('hex').toUpperCase();
  const listObject = await listDecode(hex);
  if (listObject === null) return;
  const listType = listObject.listType;

  if (debug) {
    console.log(`amsMeter, ${listType}: ${JSON.stringify(listObject, null, 2)}`);
  }
  if (debugHex) {
    console.log(`${listType}: ${hex}`);
    event.emit(`hex${listType}`, hex);
  }

  const processedData = await amsCalc(listType, listObject);
  event.emit(listType, processedData);
};

event.on('pulse', listHandler);

module.exports = { listHandler };
