const fs = require("fs");
const yaml = require("yamljs");
const configFile = "./config.yaml";
//const { event } = require('../misc/misc.js')
const { getHour, skewDays } = require('../misc/util.js');

const config = yaml.load(configFile);
const priceDir = '.' + config.priceDirectory;
//const priceDir = config.priceDirectory;

let isVirgin = true;
let dayPrices = {}
let nextDayPrices = {}

/********************************
// TypeError: fs.exitsSync is not a function
const getPrices = (name) => {
  let ret;
  if (fs.exitsSync(priceDir + "/prices-" + name + ".json"))
    ret = require(priceDir + "/prices-" + name + ".json");
  else 
    ret = require(priceDir + "/prices-" + skewDays(0) + ".json");
  //console.log(ret);
  return ret;
}
*********************************
*/

// The next day prices are not available between
// midnight and some time in the afternoon
// As a set of two days prices is needed, a fallback
// to use same day prices as next day prices
const getPrices = async (date) => {
  let ret;
  try {
    return await require(priceDir + "/prices-" + date + ".json");
  } catch (err) {
    if (err) {
      return await require(priceDir + "/prices-" + skewDays(0) + ".json");
    }
  }
}

async function priceInit() {
  if (isVirgin) {
    isVirgin = false;
    dayPrices = await getPrices(await skewDays(0))
    //console.log(dayPrices);
    nextDayPrices = await getPrices(await skewDays(1));
    //console.log(nextDayPrices)
  }
}

// Format: 2022-10-30T17:31:50
async function mergePrices(list, obj) {
  if (list === 'list3') {
    //const idx = getHour();
    const idx = obj.meterDate.split('T')[1].substr(0, 2) * 1;
    await priceInit().then(() => {
    // Today prices
      //console.log(dayPrices['hourly'][idx])
      obj.startTime = dayPrices['hourly'][idx].startTime;
      obj.endTime = dayPrices['hourly'][idx].endTime;
      obj.spotPrice = dayPrices['hourly'][idx].spotPrice;
      obj.gridPrice = dayPrices['hourly'][idx].gridFixedPrice;
      obj.supplierPrice = dayPrices['hourly'][idx].supplierFixedPrice;
      obj.customerPrice = dayPrices['hourly'][idx].customerPrice;
      obj.minPrice = dayPrices['daily'].minPrice;
      obj.maxPrice = dayPrices['daily'].maxPrice;
      obj.avgPrice = dayPrices['daily'].avgPrice;
      obj.peakPrice = dayPrices['daily'].peakPrice;
      obj.offPeakPrice1 = dayPrices['daily'].offPeakPrice1;
      obj.offPeakPrice2 = dayPrices['daily'].offPeakPrice2;
      // Next day prices
      obj.startTimeDay2 = nextDayPrices['hourly'][idx].startTime;
      obj.endTimeDay2 = nextDayPrices['hourly'][idx].endTime;
      obj.spotPriceDay2 = nextDayPrices['hourly'][idx].spotPrice;
      obj.gridPriceDay2 = nextDayPrices['hourly'][idx].gridFixedPrice;
      obj.supplierPriceDay2 = nextDayPrices['hourly'][idx].supplierFixedPrice;
      obj.customerPriceDay2 = nextDayPrices['hourly'][idx].customerPrice;
      obj.minPriceDay2 = nextDayPrices['daily'].minPrice;
      obj.maxPriceDay2 = nextDayPrices['daily'].maxPrice;
      obj.avgPriceDay2 = nextDayPrices['daily'].avgPrice;
      obj.peakPriceDay2 = nextDayPrices['daily'].peakPrice;
      obj.offPeakPrice1Day2 = nextDayPrices['daily'].offPeakPrice1;
      obj.offPeakPrice2Day2 = nextDayPrices['daily'].offPeakPrice2;
    }).then((err) => {
      if(err !== undefined)
        console.log('Error: mergePrices', e)
      return (err)
    })
  }
  /*
  if (list === 'list1')
    event.emit('plug1', obj)
  if (list === 'list2')
    event.emit('plug2', obj)
  if (list === 'list3')
    event.emit('plug3', obj)
  */
  return obj;
}

//module.exports = { getPrices, mergePrices };
module.exports = { mergePrices };