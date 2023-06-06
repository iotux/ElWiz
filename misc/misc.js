// const JSONdb = require('simple-json-db');
const EventEmitter = require('events');
// const weekDays = [undefined, 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

const event = new EventEmitter();
// const db = new JSONdb(energyFile, {energySavings}, { jsonSpaces: 2, syncOnWrite: true });

module.exports = { event };
