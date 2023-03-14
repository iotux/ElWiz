const { createClient } = require("redis");

const getProperties = (obj, key) => {
  const props = key.split('.');
  for (let i = 0; i < props.length; ++i) {
    obj = obj && obj[props[i]];
  }
  return obj;
}

const setProperties = (obj, key, val) => {
  const props = key.split('.');
  let i;
  for (i = 0; i < props.length - 1; ++i) {
    obj = obj[props[i]];
  }
  obj[props[i]] = val;
}

module.exports = class ElWizCache {

  /**
   * @typedef {object} SyncOptions
   * @property {boolean} [syncOnWrite=false] Whether the sync on write is enabled
   * @property {number} [syncInterval=86400000] The interval between each sync
   */
  /**
   * @param {string} redisKey The search key.
   * @param {SyncOptions} options
   */
  constructor(redisKey, options){
    (async() => {

      /**
       * The Redis key.
       * @type {string}
       */
      this.redisKey = redisKey;
  
      /**
       * The options for the syncing
       * @type {SyncOptions}
       */
      this.options = options || {};
  
      //if (this.options.syncOnWrite) {
      //  this.options.sync = true;
      //}
  
      if (this.options.syncInterval) {
        setInterval(() => {
          this.sync();
        }, (this.options.syncInterval || 86400000));
      }
  
      /**
       * The data stored in Redis.
       * @type {object}
       */
      this.data = null;
  
      this.client = createClient(6379, 'localhost');
      this.client.on("error", (error) => console.error(`Redis client error : ${error}`));
      this.client.on("connect", () => console.log('Redis connected...'));

      this.client.connect()

      if (await this.client.get(this.redisKey) === null) {
        //await this.client.set(this.redisKey, JSON.stringify(this.data));
        await this.saveRedisData();
      } else {
        await this.fetchRedisData();
      }      
    })();
  } // Constructor

  /**
   * Make a snapshot of the database and save it in the snapshot folder
   * @param {string} path The path where the snapshot will be stored
   */
  sync() {
    this.saveRedisData();
  }

  /**
   * Get data from Redis and store it in the data property.
   */
  async fetchRedisData() {
    const data = JSON.parse(await this.client.get(this.redisKey))
    if (typeof data === "object") {
      this.data = data;
    }
  }

  /**
   * Write data to Redis.
   */
  async saveRedisData() {
    await this.client.set(this.redisKey, JSON.stringify(this.data, null, 2));
  }

  /**
   * Check if key data exists.
   * @param {string} key 
   */
  has(key){
    return Boolean(getProperties(this.data, key));
  }
  
  /**
   * Get data for a key from Redis
   * @param {string} key 
   */
  get(key){
    return getProperties(this.data, key);
  }

  /**
   * Set new data for a key in the Redis object.
   * @param {string} key
   * @param {*} val 
   */
  set(key, val){
    setProperties(this.data, key, val);
    if (this.options.syncOnWrite)
      this.saveRedisData();
  }

  /**
   * Delete data for a key from the Redis object.
   * @param {string} key 
   */
  delete(key){
    delete this.data[key];
    if (this.options.syncOnWrite)
      this.saveRedisData();
  }

  /**
   * Add a number to a key in the database.
   * @param {string} key 
   * @param {number} count 
   */
  add(key, count){
    if(!this.data[key]) this.data[key] = 0;
    this.data[key] += count;
    if (this.options.syncOnWrite)
      this.saveRedisData();
  }

  /**
   * Subtract a number to a key in the database.
   * @param {string} key 
   * @param {number} count 
   */
  subtract(key, count){
    if(!this.data[key]) this.data[key] = 0;
    this.data[key] -= count;
    if (this.options.syncOnWrite)
      this.saveRedisData();
  }

  /**
   * Push an element to a key in the Redis object.
   * @param {string} key 
   * @param {*} element 
   */
  push(key, element){
    if (!this.data[key]) this.data[key] = [];
    this.data[key].push(element);
    if (this.options.syncOnWrite)
      this.saveRedisData();
  }

  /**
   * Clear the Redis object.
   */
  clear(){
    this.data = {};
    if (this.options.syncOnWrite)
      this.saveRedisData();
  }

  /**
   * Get all the data from the Redis object.
   */
  all(){
    return Object.keys(this.data).map((key) => {
      return {
        key,
        data: this.data[key]
      }
    });
  }

  /**
   * Clear the Redis object.
   */
  close(){
    this.saveRedisData();
    this.client.quit();
  }

  JSON(data){
    if (data) {
      try {
        JSON.parse(JSON.stringify(data));
        this.data = data;
        if (this.options.syncOnWrite)
          this.saveRedisData();
        } catch (err) {
        throw new Error('Parameter is not a valid JSON object.');
      }
    }
    return this.data;
  }
};

