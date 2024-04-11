#!/usr/bin/env node

const { exit } = require('process');
const fs = require('fs');
const express = require('express');
const yaml = require('js-yaml');
const path = require('path');
const app = express();
const mqtt = require('mqtt');
const WebSocket = require('ws');
const configPath = './chart-config.yaml';
const config = loadYaml(configPath);

const serverConfig = config.serverConfig;
const chartConfig = config.chartConfig;

const savePath = serverConfig.savePath;
const saveFile = `${savePath}/chartoffsets.json`;

const serverPort = serverConfig.serverPort;
const wsServerPort = serverConfig.wsServerPort;
const debug = serverConfig.debug;
const priceTopic = serverConfig.priceTopic || 'elwiz/prices';
const chartTopic = serverConfig.chartTopic || 'elwiz/chart';
const hassPublish = serverConfig.hassPublish || true;
const haBaseTopic = serverConfig.elwiz || 'elwiz';
const haSensorTopic = 'elwiz/sensor/';
const haAnnounceTopic = serverConfig.haAnnounceTopic || 'homeassistant';
const announceTopic = haAnnounceTopic + '/sensor/ElWiz/';
const announceBinaryTopic = haAnnounceTopic + '/binary_sensor/ElWiz/';
const fixedOffset = serverConfig.fixedAverageOffset || 0;
const stepFactor = serverConfig.adjustmentStepFactor || 1;
//chartConfig.timezoneOffset = getTimezoneOffset();

//const mqttClient = Mqtt.mqttClient();
const wss = new WebSocket.Server({ port: wsServerPort });

let isVirgin = true;
let hasDayAheadPrices = false;
let timezoneOffset;
let currentDate;
let currentHour;
let currHourStr;
let isOnRightSide;

function loadYaml(configPath) {
  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const data = yaml.load(fileContents);
    return data;
  } catch (error) {
    console.error(`Error reading or parsing the YAML file: ${error}`);
  }
}

(async () => {

  class Clients {
    constructor() {
      this.clientList = {};
      this.saveClient = this.saveClient.bind(this);
      this.getClient = this.getClient.bind(this);
      this.getClientList = this.getClientList.bind(this);
      this.deleteClient = this.deleteClient.bind(this);
    }
    saveClient(clientId, client) {
      this.clientList[clientId] = client;
    }
    getClient(clientId) {
      return this.clientList[clientId];
    }
    getClientList() {
      return this.clientList;
    }
    deleteClient(clientId) {
      delete this.clientList[clientId];
    }
    getClientIds() {
      return Object.keys(this.clientList);
    }
  }

  const clients = new Clients();
  // ============ Websockets handling ============
  // Message structure
  /*
  data = {
    clientId: clientId,
    channel: channel,
    topic: topic,
    payload: payload
  }
  */
  wss.on('connection', function (client) {
    client.on('message', function (message) {
      const data = JSON.parse(message);
      const channel = data['channel'];
      const topic = data['topic'];
      const msg = data['payload'];
      const clientId = data.clientId;
      clients.saveClient(clientId, client);
      ws = clients.getClient(clientId);
      if (msg === 'init') {
        console.log('Request from client', data);
        wsSend(clientId, clientId, 'full', chartData);
      }
      console.log('Active clients', clients.getClientIds())
    });

    client.on('close', function (connection) {
      console.log('Connection closed', connection)
      delete clients[client];
    });
  });

  const wsSendAll = function (channel, topic, message) {
    wss.clients.forEach(function each(client) {
      client.send(
        JSON.stringify({
          channel: channel,
          topic: topic,
          payload: message,
        })
      );
    });
  };

  const wsSend = function (clientId, channel, topic, message) {
    let ws = clients.getClient(clientId);
    while (ws === undefined) return; //sleep(1000);
    ws.send(
      JSON.stringify({
        channel: channel,
        topic: topic,
        payload: message,
      })
    );
  };

  const sendMessage = async (clientId, channel, severity, message) => {
    let msg = {
      time: Date.now(),
      severity: severity,
      message: message,
    };
    await wsSend(clientId, channel, 'push/' + clientId + '/msg', msg);
  };

  // ============ MQTT initalization ============

  if (config.mqttBroker === null) {
    console.log('\nBroker IP address or hostname missing');
    console.log('Edit your "config.yaml" file\n');
    process.exit(0);
  }

  const timestamp = new Date().getTime() * 1 + '';
  const clientId = Math.floor((Math.random() * 900) + 100) + timestamp.substr(10);

  const mqttUrl = serverConfig.mqttUrl;
  const mqttOptions = {
    username: serverConfig.userName,
    password: serverConfig.password,
    clientId: clientId,
  }
  const pubOpts = { qos: 1, retain: true };

  mqttClient = mqtt.connect(mqttUrl, mqttOptions);

  mqttClient.on('connect', (err) => {
    console.log(`Server is connected to ${mqttUrl}`);
    try {
      mqttClient.subscribe(`${priceTopic}/#`)
    } catch (err) {
      console.log('Subscription error', err);
    }
    try {
      mqttClient.subscribe(`${chartTopic}/#`)
    } catch (err) {
      console.log('Subscription error', err);
    }
  });

  mqttClient.on('error', function (err) {
    if (err.errno === 'ENOTFOUND') {
      console.log('\nNot connectd to broker');
      console.log('Check your "config.yaml" file\n');
      exit(0);
    } else { console.log('Client error: ', err); }
  });

  mqttClient.on('close', () => {
    console.log('Disconnected from the MQTT broker. Attempting to reconnect...');
    mqttClient.reconnect();
  });

  // ============ MQTT message handling ============
  let dataAvailable = false;
  let chartData = [];
  let belowThreshold = [];

  // Stored as [leftAvgOffsetFactor, rightAvgOffsetFactor]
  let leftAvgOffsetFactor = 0;
  let rightAvgOffsetFactor = 0;
  let twoDaysData = [];
  let timerInit = true;

  mqttClient.on('message', async (topic, message) => {
    const [topic1, topic2, topic3] = topic.split('/');
    // Receive hourly
    if (`${topic1}/${topic2}` === priceTopic) {
      const result = parseJsonSafely(message);
      if (debug && result.error) {
        console.log(result.message);
      } else {
        // Fetch 2 days of price data
        if (twoDaysData.length < 2) {
          twoDaysData.push(result.data);
        } else if (result.data.priceDate > twoDaysData[1].priceDate) {
          twoDaysData.push(result.data);
        } else {
          if (debug)
            console.log('Pricedata skipped ',result.data.priceDate);
        }

        // MQTT price data handling
        // Give time for receiving 2 - 3 MQTT messages
        // before activating "handleMessages()"
        // Then reset "timerInit" after a delay
        if (timerInit) {
          timerInit = false;
          setTimeout(() => {
            handleMessages();
            timerInit = true;
          },200);
        }
      }
    } else if (`${topic1}/${topic2}` === chartTopic) {
      // MQTT message possibly coming from HA
      if (topic3 === 'adjustLeftAvgOffset') {
        const parsed = parseFloat(message.toString());
        leftAvgOffsetFactor = parsed === 0 ? 0 : leftAvgOffsetFactor += parsed * stepFactor;
        saveOffsets(leftAvgOffsetFactor, rightAvgOffsetFactor, 'Line 242');
        updateAvgData(0, leftAvgOffsetFactor, 'From topic3 adjustLeftDisp');
        wsSendAll('chart', 'update', chartData);
      } else if (topic3 === 'adjustRightAvgOffset') {
        const parsed = parseFloat(message.toString());
        rightAvgOffsetFactor = parsed === 0 ? 0 : rightAvgOffsetFactor += parsed * stepFactor;
        saveOffsets(leftAvgOffsetFactor, rightAvgOffsetFactor, 'Line 248');
        updateAvgData(24, rightAvgOffsetFactor, 'From topic3 adjustRightDisp');
        wsSendAll('chart', 'update', chartData);
      }
    }
  }); // mqttClient.on('message')

  let hasData = false;

  function handleMessages() {
    chartData = [];
    if (debug)
      console.log('twoDaysData length', twoDaysData.length);
    if (twoDaysData.length > 2) {
      twoDaysData = twoDaysData.slice(-2);
    }

    isOnRightSide = twoDaysData[0].priceDate === skewDays(-1);
    hasDayAheadPrices = twoDaysData[1].priceDate === skewDays(1);

    if (hasDayAheadPrices && !isOnRightSide && !hasData) {
      if (debug)
        console.log('Switching offsetFactors')
      // Tomorrow on right side
      leftAvgOffsetFactor = rightAvgOffsetFactor;
      rightAvgOffsetFactor = 0;
      saveOffsets(leftAvgOffsetFactor,rightAvgOffsetFactor, 'handleMessages' )
      hasData = true;
    }

    updateChartData(twoDaysData[0], leftAvgOffsetFactor);
    updateChartData(twoDaysData[1], rightAvgOffsetFactor);
    checkAndSendChartData(chartData);
    if (debug) {
      console.log('AvgOffsetFactors', [leftAvgOffsetFactor, rightAvgOffsetFactor]);
      twoDaysData.forEach((m, idx) => {
        console.log('priceDate', idx, m.priceDate);
      });
    }

    const start = isOnRightSide ? 24 : 0;
    publishData(start, 'handleMessages');
  }

  // This function prepares and updates the chart data structure
  function updateChartData(prices, adjustment) {
    let hourlyData;

    try {
      hourlyData = prices.hourly;
    } catch(err) {
      console.log('No data to update.');
      return;
    }

    //hourlyData = prices.hourly;
    const avgPrice = prices.daily.avgPrice;
    const fixed = avgPrice * fixedOffset / 100;
    const adjust = avgPrice * adjustment / 100;

    const thresholdLevel = adjustment === 0 ? parseFloat((avgPrice + fixed).toFixed(3)) : parseFloat((avgPrice + fixed + adjust).toFixed(3));
    // This check ensures that the function proceeds only if there's meaningful data to process.
    if (hourlyData.length === 0) {
      if (debug)
        console.log("No data to update.");
      return;
    }

    // Map the prices to the desired format.
    const newData = hourlyData.map(h => ({
      startTime: h.startTime,
      spotPrice: h.spotPrice,
      avgPrice: avgPrice,
      thresholdLevel: thresholdLevel,
      isBelowThreshold: h.spotPrice < thresholdLevel ? 1 : 0,
    }));

    // If starting without data, ensure chartData is initialized correctly.
    if (!dataAvailable) {
      // Assuming dataAvailable should be true now as we're processing new data.
      dataAvailable = true;
      chartData = [...newData];
    } else {
      chartData = [...chartData, ...newData];
    }

    // Ensure chartData does not exceed the 48-hour window.
    if (chartData.length > 48) {
      chartData = chartData.slice(-48); // This keeps the latest 48 entries.
    }
    if (debug)
      console.log('updateChartData processed', chartData.length, 'entries.');
  } // updateChartData()

  function updateAvgData(start, adjustment, log) {
    // Ensure start is either 0 or 24
    start = start === 24 ? 24 : 0;

    chartData.forEach((h, idx) => {
      // Modify only 24 elements starting from the start index
      if (idx >= start && idx < start + 24) {
        h.thresholdLevel = parseFloat((h.avgPrice + h.avgPrice * fixedOffset / 100 + h.avgPrice * adjustment / 100).toFixed(3));
        h.isBelowThreshold = h.spotPrice < h.thresholdLevel ? 1 : 0;
      }
    })
    publishData(start, 'updateAvgData');
  }

  function publishData(start, log) {
    // Ensure start is either 0 or 24
    start = start === 24 ? 24 : 0;
    let publish;
    try {
      // Publish only the current date side of the chart
      publish = (getDateString(chartData[start].startTime) === currentDate);
      if (debug)
        console.log('publishData called from', log, '\nStart:', start, 'Publish:', publish, chartData[currentHour + start])
      if (publish){
        const threshold = String(chartData[currentHour + start].thresholdLevel); //.toFixed(3);
        mqttClient.publish(`${haBaseTopic}/sensor/spotBelowThreshold`, String(chartData[currentHour + start].isBelowThreshold), pubOpts);
        mqttClient.publish(`${haBaseTopic}/sensor/thresholdLevel`, threshold, pubOpts);
      }
    } catch(err) {
      console.log('Daily prices are not available...');
    }
  }

  const checkAndSendChartData = (function() {
    let recentUpdates = new Set();
    let lastUpdateSize = 0;

    return function(chartData) {
      const currentStartTimes = chartData.map(data => data.startTime.slice(0, 10));
      const uniqueStartTimes = new Set(currentStartTimes);
      const isNewData = [...uniqueStartTimes].some(date => !recentUpdates.has(date));

      if (isNewData || chartData.length !== lastUpdateSize) {
        wsSendAll('chart', 'init', chartData);
        uniqueStartTimes.forEach(date => recentUpdates.add(date));
        lastUpdateSize = chartData.length;

        // Keep only the most recent dates
        while (recentUpdates.size > 2) {
          const oldestDate = [...recentUpdates].sort()[0];
          recentUpdates.delete(oldestDate);
        }
        if (debug)
          console.log('Data updated and sent');
      } else {
        console.log('No new data to send');
      }
    };
  })();

  // ============ Scheduling ============
  async function hourlyTasks(){
    if (debug)
      console.log('Hourly tasks invoked...')
    timezoneOffset = await getTimezoneOffset();
    const date = new Date(Date.now());
    currentHour = date.getHours();
    currentDate = getDateString(date);
    currHourStr = String(currentHour).padStart(2,'0');
    if (currentHour === 0) {
      // Midnight handling
      hasDayAheadPrices = false;
      console.log('Entered new day:', currentDate)
    }

    try {   // getDateString() returns "yyyy-MM-ss", chartData[0] is left chart side
      const start = getDateString(chartData[0].startTime) === currentDate ? 0 : 24
      isOnRightSide = start === 24;
      factor = isOnRightSide ? rightAvgOffsetFactor : leftAvgOffsetFactor;
      updateAvgData(start, factor, 'From hourlyTasks'); // Publish === true
      if (debug) {
        console.log('Hourly task', 'start', start, factor, chartData[currentHour + offset]);
        console.log('AvgOffsetFactors', [leftAvgOffsetFactor, rightAvgOffsetFactor]);
        console.log('currentAvgFactor', factor)
        console.log('isOnRightSide', isOnRightSide);
      }
    } catch (err) {
      console.log('chartData not ready...')
    }
  }

  function scheduleHourlyTasks() {
    const now = new Date();
    const minutesToNextHour = 60 - now.getMinutes();
    const secondsToNextHour = (minutesToNextHour * 60) - now.getSeconds();
    const msToNextHour = secondsToNextHour * 1000; // Convert to milliseconds

    //setTimeout(() => {
    //  console.log('Anyone in need for a delayed start?');
    //}, 1000 * 2) // Seconds

    // First update: Delay until the start of the next hour
    setTimeout(() => {
      hourlyTasks(); // Update immediately at the next hour
      // Then update every hour after that
      setInterval(hourlyTasks, 3600000); // 3600000ms = 1 hour
    }, msToNextHour);
  }

  // ============ Web server initialization ============
  // Middleware to parse JSON and URL-encoded bodies
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // Serve static files (for Chart.js and CSS)
  app.use(express.static('public'));

  // Route for the graph page
  app.get('/chart', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chart.html'));
  });

  app.get('/icon-day', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'icon-day.png'));
  });
  app.get('/icon-night', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'icon-night.png'));
  });

  // Send content of the YAML config file
  app.get('/config', (req, res) => {
    // Read config file on browser load/reload to catch changes
    const config = loadYaml(configPath);
    config.chartConfig.timezoneOffset = timezoneOffset;
    res.json(config.chartConfig);
  });

  app.listen(serverPort, () => {
    console.log(`Server is running on http://localhost:${serverPort}`);
  });

  // ============ Helper functions ============

  function getOffsets() {
    if (!fs.existsSync(savePath)) {
      fs.mkdirSync(savePath, {recursive: true});
      fs.writeFileSync(saveFile, JSON.stringify([0, 0]));
      return [0, 0];
    } else {
      if (!fs.existsSync(saveFile)) {
        fs.writeFileSync(saveFile, JSON.stringify([0, 0]));
        return [0, 0];
      }
      return JSON.parse(fs.readFileSync(saveFile));
    }
  }

  function saveOffsets(left, right, where) {
    if (debug)
      console.log(`saveOffsets ${where}: saved`, [left, right]);
    fs.writeFileSync(saveFile, JSON.stringify([left, right]));
  }

  function getDateString(serverTime) {
    const now = new Date(serverTime);
    const pad = (num) => num < 10 ? '0' + num : num.toString();
    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1); // Months are 0-based
    const day = pad(now.getDate());
    return `${year}-${month}-${day}`;
  }

  function skewDays(days) {
    const oneDay = 86400000; // pre-calculate milliseconds in a day (24 * 60 * 60 * 1000)
    const date = new Date(Date.now() + oneDay * days);
    // Pad the month and day with a leading zero if they are less than 10
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function calcAverage(obj, element) {
    // Calculate the average sum of the specified element from "obj" object array
    let sum = 0;
    for (let i = 0; i <= obj.length -1; i++) {
        sum += obj[i][element];
    }
    return sum / i;
  }

  async function getTimezoneOffset() {
      // getTimezoneOffset() returns the difference in minutes, so convert it to hours
      // and invert the sign to align with conventional time zone representations.
      const offset = -new Date().getTimezoneOffset() / 60;
      return offset;
  }

  // Helper function to check if a string is a valid JSON
  function isJsonString(str) {
    try {
      JSON.parse(str);
    } catch (e) {
      return false;
    }
    return true;
  }

  function parseJsonSafely(message) {
    let buffer;
    try {
      buffer = message.toString();
    } catch (err) {
      console.log('Error converting buffer to string:', err);
      return { error: true, message: 'Message cannot be parsed as atring', data: null };
    }
    // Trim the input to remove leading/trailing whitespace
    const trimmedString = buffer.trim();

    // Check if the input is empty
    if (trimmedString === '') {
      return { error: true, message: 'Empty string cannot be parsed as JSON.', data: null };
    }

    // Attempt to parse the JSON string
    try {
      const data = JSON.parse(trimmedString);
      return { error: false, message: 'Successfully parsed JSON.', data: data };
    } catch (error) {
      return { error: true, message: `Error parsing JSON: ${error.message}`, data: null };
    }
  }

  // Home Assistant auto discovery according to config
  if (hassPublish) {
    const hassDevice = function (deviceType, name, uniqueId, devClass, staClass, unitOfMeasurement, stateTopic) {
      const result = {
        name: name,
        object_id: uniqueId,
        uniq_id: uniqueId,
        avty_t: haBaseTopic + '/sensor/status', // availability_topic
        stat_t: haBaseTopic + '/sensor/' + stateTopic,
        dev: {
          ids: 'elwiz_pulse_enabler',
          name: 'ElWiz',
          sw: 'https://github.com/iotux/ElWiz',
          mdl: 'ElWiz',
          mf: 'iotux'
        }
      };
      if (devClass !== '') result.dev_cla = devClass; // device_class
      if (staClass !== '') result.stat_cla = staClass; // state_class
      if (unitOfMeasurement !== '') result.unit_of_meas = unitOfMeasurement;
      if (deviceType === 'binary_sensor'){
        result.pl_on = '1';
        result.pl_off = '0';
      }
      return result;
    };

    // Set retain flag (pubOpts) on status message to let HA find it after a stop/restart
    let announce = hassDevice('sensor', 'Backoff threshold level', 'thresholdLevel', 'monetary', 'total', 'kr', 'thresholdLevel');
    mqttClient.publish(announceTopic + 'thresholdLevel/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
    if (debug)
      console.log('HA announce thresholdLevel',announce);

    announce = hassDevice('binary_sensor', 'Spot price below threshold', 'spotBelowThreshold', '', 'measurement', '', 'spotBelowThreshold');
    mqttClient.publish(announceBinaryTopic + 'spotBelowThreshold/config', JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
    if (debug)
      console.log('HA announce spotBelowThreshold',announce);

    mqttClient.publish(haBaseTopic + 'status', 'online', pubOpts);
  }

  if (debug) console.log(config);
  [leftAvgOffsetFactor, rightAvgOffsetFactor] = await getOffsets();

  hourlyTasks();
  scheduleHourlyTasks();
})();
