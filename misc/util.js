const { format, formatISO } = require('date-fns');

const weekDays = [undefined, 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

function addZero (num) {
  if (num <= 9) {
    return '0' + num;
  }
  return num;
}

function getHour () {
  const now = new Date();
  const day = new Date(now.getTime());
  return day.getHours();
}
function skewDays (days) {
  const oneDay = 24 * 60 * 60 * 1000;
  const now = new Date();
  const day = new Date(now.getTime() + oneDay * days);
  return day.getFullYear() +
    '-' + addZero(day.getMonth() + 1) +
    '-' + addZero(day.getDate());
}

function weekDay (day) {
  return (weekDays[day]);
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
function getMacAddress (id) {
  return id.substr(10, 2) +
    ':' + id.substr(8, 2) +
    ':' + id.substr(6, 2) +
    ':' + id.substr(4, 2) +
    ':' + id.substr(2, 2) +
    ':' + id.substr(0, 2);
}
function upTime (secsUp) {
  const d = new Date();
  d.setSeconds(secsUp);
  const up = d.toISOString();
  return up.substr(8, 2) - 1 +
    ' day(s) ' + up.substr(11, 8);
}
function hex2Dec (str) {
  return parseInt(str, 16);
}

function hex2Ascii (hex) {
  const str = hex.toString();
  let result = '';
  for (let i = 0; i < str.length; i += 2) {
    result += String.fromCharCode(parseInt(str.substr(i, 2), 16));
  }
  return result;
}
function hasData (data, pattern) {
  return data.includes(pattern) ? data.indexOf(pattern) + pattern.length : -1;
}

function getAmsTime (msg, index) {
  const Y = hex2Dec(msg.substr(index, 4));
  const M = hex2Dec(msg.substr(index += 4, 2)) - 1;
  const D = hex2Dec(msg.substr(index += 2, 2));
  const h = hex2Dec(msg.substr(index += 4, 2));
  const m = hex2Dec(msg.substr(index += 2, 2));
  const s = hex2Dec(msg.substr(index += 2, 2));
  // return formatISO(new Date(Y, M, D, h, m, s), "yyyy-MM-dd'T'HH:mm:ss");
  return formatISO(new Date(Y, M, D, h, m, s), { representtation: 'complete' });
}

function getDate () {
  // Returns date fit for file name
  const now = new Date();
  const date = new Date(now.getTime());
  return format(date, 'yyyy-MM-dd');
}

// Time format: "yyyy-MM-dd'T'HH:mm:ss"
function isNewHour (date) {
  return date.substr(14, 5) === '00:10';
}

function isNewDate (date) {
  return date.substr(11, 8) === '00:00:10';
}
function isNewMonth (date) {
  return date.substr(8, 2) === '01' && date.substr(11, 8) === '00:00:10';
}

module.exports = {
  isNewHour,
  isNewDate,
  isNewMonth,
  hex2Dec,
  hex2Ascii,
  hasData,
  addZero,
  getAmsTime,
  getDate,
  getHour,
  skewDays,
  weekDay,
  upTime,
  getMacAddress
};
