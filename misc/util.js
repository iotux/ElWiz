
const fs = require('fs');
const yaml = require('js-yaml');

const { subHours, addHours, format, formatISO } = require('date-fns');

const weekDays = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

function addZero(num) {
  return num <= 9 ? '0' + num : '' + num;
}

function getDateTime() {
  const now = new Date();
  const time = new Date(now.getTime());
  return formatISO(time, { representation: 'complete' });
}

function getCurrentDate() {
  // Returns date fit for file name
  const now = new Date();
  const date = new Date(now.getTime());
  return format(date, 'yyyy-MM-dd');
}

function getDate(isoDate) {
  const date = new Date(isoDate);
  return format(date, 'yyyy-MM-dd');
}

function getPreviousDate(isoDate) {
  const date = subHours(new Date(isoDate), 24);
  return format(date, 'yyyy-MM-dd');
}

function getNextDate(isoDate) {
  const date = addHours(new Date(isoDate), 24);
  return format(date, 'yyyy-MM-dd');
}

function skewDays(days) {
  const oneDay = 86400000; // pre-calculate milliseconds in a day (24 * 60 * 60 * 1000)
  const date = new Date(Date.now() + oneDay * days);
  return format(date, 'yyyy-MM-dd');
}

function getHour() {
  const now = new Date();
  const day = new Date(now.getTime());
  return day.getHours();
}

/**
 * Returns the previous hour of an ISO-formatted date string.
 *
 * @param {string} isoDate - The ISO-formatted date string.
 * @return {string} The previous hour in the same format as the input.
 */
function getPreviousHour(isoDate) {
  const date = subHours(new Date(isoDate), 1);
  return formatISO(date, { representation: 'complete' });
}

/**
 * Returns a ISO date string of the next hour from the given ISO date string.
 *
 * @param {string} isoDate - the ISO date string.
 * @return {string} the ISO date string of the next hour.
 */
function getNextHour(isoDate) {
  const date = new Date(isoDate);
  date.setHours(date.getHours() + 1);
  return date.toISOString();
}

/**
 * Replaces a character at the specified index in a string.
 *
 * @param {string} str - The input string.
 * @param {number} index - The index of the character to replace.
 * @param {string} newChar - The new character to replace the existing character with.
 * @return {string} - The updated string with the replaced character.
 */
function replaceChar(str, index, newChar) {
  if (index < 0 || index >= str.length) {
    throw new Error('Index out of range');
  }

  return str.substring(0, index) + newChar + str.substring(index + 1);
}
function weekDay(day) {
  return (weekDays[day - 1]);
}
/*
// Do not remove this
function pulseDate(buf) {
  // Returns date and time
  return buf.readInt16BE(0)
    + "-" + addZero(buf.readUInt8(2))
    + "-" + addZero(buf.readUInt8(3))
    + "T" + addZero(buf.readUInt8(5))
    + ":" + addZero(buf.readUInt8(6))
    + ":" + addZero(buf.readUInt8(7));
}
*/
function getMacAddress(id) {
  return id.substr(10, 2) +
    ':' + id.substr(8, 2) +
    ':' + id.substr(6, 2) +
    ':' + id.substr(4, 2) +
    ':' + id.substr(2, 2) +
    ':' + id.substr(0, 2);
}
function upTime(secsUp) {
  const d = new Date();
  d.setSeconds(secsUp);
  const up = d.toISOString();
  return up.substr(8, 2) - 1 +
    ' day(s) ' + up.substr(11, 8);
}
function hex2Dec(str) {
  return parseInt(str, 16);
}

function hex2Ascii(hex) {
  const str = hex.toString();
  let result = '';
  for (let i = 0; i < str.length; i += 2) {
    result += String.fromCharCode(parseInt(str.substr(i, 2), 16));
  }
  return result;
}
function hasData(data, pattern) {
  return data.includes(pattern) ? data.indexOf(pattern) + pattern.length : -1;
}

function getAmsTime(msg, index) {
  const Y = hex2Dec(msg.substr(index, 4));
  const M = hex2Dec(msg.substr(index += 4, 2)) - 1;
  const D = hex2Dec(msg.substr(index += 2, 2));
  const h = hex2Dec(msg.substr(index += 4, 2));
  const m = hex2Dec(msg.substr(index += 2, 2));
  const s = hex2Dec(msg.substr(index += 2, 2));
  // return formatISO(new Date(Y, M, D, h, m, s), "yyyy-MM-dd'T'HH:mm:ss");
  return formatISO(new Date(Y, M, D, h, m, s), { representation: 'complete' });
}

// Time format: "yyyy-MM-dd'T'HH:mm:ss"
function isNewHour(date) {
  return date.substr(14, 5) === '00:00';
}

function isNewDay(date) {
  return date.substr(11, 8) === '00:00:10';
}
function isNewMonth(date) {
  return date.substr(8, 2) === '01' && date.substr(11, 8) === '00:00:10';
}

function getCurrencySymbol(symbol = 'EUR') {
  let result = Intl.NumberFormat('eur', {
    style: 'currency',
    currency: symbol,
    currencyDisplay: 'narrowSymbol',
    maximumSignificantDigits: 1
  }).format(0);
  return result.replace(/0/, '').trim();
}

function loadYaml(configPath) {
  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const data = yaml.load(fileContents);
    return data;
  } catch (error) {
    console.error(`Error reading or parsing the YAML file: ${error}`);
  }
}

module.exports = {
  isNewHour,
  isNewDay,
  isNewMonth,
  hex2Dec,
  hex2Ascii,
  hasData,
  addZero,
  getAmsTime,
  getDate,
  getCurrentDate,
  getPreviousDate,
  getNextDate,
  getHour,
  getDateTime,
  getPreviousHour,
  getNextHour,
  skewDays,
  replaceChar,
  weekDay,
  upTime,
  getMacAddress,
  getCurrencySymbol,
  loadYaml
};
