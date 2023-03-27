const fs = require("fs");
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

module.exports = class UniCache {

  /**
   * @typedef {object} Options
   * @property {boolean} [syncOnWrite=false] Whether the sync on write is enabled
   * @property {number} [syncInterval=86400 * 1000] The ms interval between each sync
   * @property {string} [path='./data/'] The path of the backups
  */
  /**
   * @param {string} cacheType cacheType can be 'file' or 'redis'
   * @param {string} filePath The path of the json file used for the database.
   * @param {string} redisKey The search key.
   * @param {SyncOptions} options
   */
  
  /**
   * Call examples
   * const cache = new UniCache('myCache', {cacheType: 'redis', syncOnWrite: false})
   * const cache = new UniCache('myCache', {cacheType: 'file', syncOnWrite: false, savePath: './data/'})
   */
  constructor(cacheName, options){

    this.cacheType = options.cacheType;
    this.cacheName = cacheName;
    /**
     * The Redis key.
     * @type {string}
     */
    this.redisKey = undefined;

    /**
     * The options for the syncing
     * @type {SyncOptions}
     */
    this.options = options || {};

      if (this.options.syncInterval) {
      setInterval(() => {
        this.saveCacheData();
      }, (this.options.syncInterval * 1000 || 86400000));
    }

    /**
     * The data stored in Redis.
     * @type {object}
     */
    this.data = {};

    if (this.cacheType === 'redis') {
      this.redisKey = this.cacheName;
      (async() => {
        this.client = createClient(6379, 'localhost');
        this.client.on("error", (error) => console.error(`Redis client error : ${error}`));
        this.client.on("connect", () => console.log('Redis connected...'));
        this.client.on("ready", () => {
          if (this.client.get(this.redisKey) === null) {
            this.client.set(this.redisKey, JSON.stringify({}));
          } else {
            this.fetchCacheData();
          }
        })
        await this.client.connect();
      })();
    } else {
      this.path = options.savePath;
      this.filePath = this.path + this.cacheName + '.json'
  
      if (!fs.existsSync(this.path)) {
        fs.mkdirSync(this.path, { recursive: true });
      }
      if(!fs.existsSync(this.filePath)){
        fs.writeFileSync(this.filePath, "{}", "utf-8");
      } else {
        this.fetchCacheData();
      }
    }
  } // Constructor

  /**
   * Check if data is an empty object
   */
  async isEmpty(){
    if (this.cacheType === 'redis') {
      const data = await JSON.parse(await this.client.get(this.redisKey))
      return ((data === null || Object.keys(data).length === 0) && Object.keys(this.data).length === 0)
    } else {
      const data = await JSON.parse(fs.readFileSync(this.filePath));
      return (Object.keys(data).length === 0  && Object.keys(this.data).length === 0)
    }
  }
  
  /**
   * TODO: Make timed sync work
   *
   */
  async sync() {
    await this.saveCacheData();
  }

  /**
   * Get data from storage and store it in the data property.
   */
  async fetchCacheData() {
    let data;
    if (this.cacheType === 'redis') {
      data = await JSON.parse(await this.client.get(this.redisKey));
    } else {
      data = await JSON.parse(fs.readFileSync(this.filePath));
    }
    if(typeof data === "object") {
      this.data = data;
    }
  }

  /**
   * Write data storage.
   */
  async saveCacheData() {
    console.log('Enter saveCacheData', this.data)
    if (this.cacheType === 'redis') {
      await this.client.set(this.redisKey, JSON.stringify(this.data));
    } else {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    }
  }

  /**
   * Check if key data exists.
   * @param {string} key 
   */
  async has(key){
    return Boolean(await getProperties(this.data, key));
  }
  
  /**
   * Get data for a key from Redis
   * @param {string} key 
   */
  async get(key){
    return await getProperties(this.data, key);
  }

  /**
   * Set new data for a key in the Redis object.
   * @param {string} key
   * @param {*} val 
   */
  async set(key, val){
    setProperties(this.data, key, val);
    if (this.options.syncOnWrite)
      await this.saveCacheData();
  }

  /**
   * Delete data for a key from the Redis object.
   * @param {string} key 
   */
  async delete(key){
    delete this.data[key];
    if (this.options.syncOnWrite)
      await this.saveCacheData();
  }

  /**
   * Add a number to a key in the database.
   * @param {string} key 
   * @param {number} count 
   */
  async add(key, count){
    if(!this.data[key]) this.data[key] = 0;
    this.data[key] += count;
    if (this.options.syncOnWrite)
      await this.saveCacheData();
  }

  /**
   * Subtract a number to a key in the database.
   * @param {string} key 
   * @param {number} count 
   */
  async subtract(key, count){
    if(!this.data[key]) this.data[key] = 0;
    this.data[key] -= count;
    if (this.options.syncOnWrite)
      await this.saveCacheData();
  }

  /**
   * Push an element to a key in the Redis object.
   * @param {string} key 
   * @param {*} element 
   */
  async push(key, element){
    if (!this.data[key]) this.data[key] = [];
    this.data[key].push(element);
    if (this.options.syncOnWrite)
      await this.saveCacheData();
  }

  /**
   * Clear the Redis object.
   */
  async clear(){
    this.data = {};
    if (this.options.syncOnWrite)
      await this.saveCacheData();
  }

  /**
   * Save the Redis object and disconnect.
   */
  async close(){
    await this.saveCacheData();
    await this.client.quit();
  }

  /**
   * Fetch the Redis object.
   */
  async fetch() {
    if (Object.keys(this.data).length === 0)
      await this.fetchCacheData();
    return this.data;
  }

  /**
   * Initialize the Redis object.
   */
  async init(data){
    if (data) {
      try {
        await JSON.parse(JSON.stringify(data));
        this.data = data;
        await this.saveCacheData();
        console.log('Object saved to Redis');
      } catch (err) {
        throw new Error('Parameter is not a valid JSON object.');
      }
    }
    return this.data;
  }

  /**
   * Initialize the Redis object.
   */
  async JSON(data){
    if (data) {
      try {
        await JSON.parse(JSON.stringify(data));
        this.data = data;
        await this.saveCacheData();
        console.log('Object saved to Redis');
      } catch (err) {
        throw new Error('Parameter is not a valid JSON object.');
      }
    } else {
      if (Object.keys(this.data).length === 0) {
        await this.fetchCacheData();
        console.log('Object fetched from Redis');
      }
    }
    return this.data;
  }
};
