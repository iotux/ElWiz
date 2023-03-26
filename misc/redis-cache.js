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

module.exports = class RedisCache {

  /**
   * @typedef {object} SyncOptions
   * @property {boolean} [syncOnWrite=false] Whether the sync on write is enabled
   * @property {number} [syncInterval=86400000] The ms interval between each sync
   */
  /**
   * @param {string} redisKey The search key.
   * @param {SyncOptions} options
   */
  constructor(redisKey, options){

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

      if (this.options.syncInterval) {
      setInterval(() => {
        this.saveRedisData();
      }, (this.options.syncInterval * 1000|| 86400000));
    }

    /**
     * The data stored in Redis.
     * @type {object}
     */
    this.data = {};

    (async() => {
      this.client = createClient(6379, 'localhost');
      this.client.on("error", (error) => console.error(`Redis client error : ${error}`));
      this.client.on("connect", () => console.log('Redis connected...'));
      this.client.on("ready", () => {
        if (this.client.get(this.redisKey) === null) {
          this.client.set(this.redisKey, JSON.stringify({}));
        } else {
          this.fetchRedisData();
        }
      })
      await this.client.connect();
    })();
  
  } // Constructor

    /**
   * Check if data is an empty object
   */
    async isEmpty(){
      const data = await JSON.parse(await this.client.get(this.redisKey))
      return ((data === null || Object.keys(data).length === 0) && Object.keys(this.data).length === 0)
    }
  
  /**
   * TODO: Make timed sync work
   *
   */
  async sync() {
    await this.saveRedisData();
  }

  /**
   * Get data from Redis and store it in the data property.
   */
  async fetchRedisData() {
    const data = await JSON.parse(await this.client.get(this.redisKey));
    if(typeof data === "object") {
      this.data = data;
    }
  }

  /**
   * Write data to Redis.
   */
  async saveRedisData() {
    await this.client.set(this.redisKey, JSON.stringify(this.data));
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
      await this.saveRedisData();
  }

  /**
   * Delete data for a key from the Redis object.
   * @param {string} key 
   */
  async delete(key){
    delete this.data[key];
    if (this.options.syncOnWrite)
      await this.saveRedisData();
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
      await this.saveRedisData();
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
      await this.saveRedisData();
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
      await this.saveRedisData();
  }

  /**
   * Clear the Redis object.
   */
  async clear(){
    this.data = {};
    if (this.options.syncOnWrite)
      await this.saveRedisData();
  }

  /**
   * Save the Redis object and disconnect.
   */
  async close(){
    await this.saveRedisData();
    await this.client.quit();
  }

  async JSON(data){
    if (data) {
      try {
        await JSON.parse(JSON.stringify(data));
        this.data = data;
        await this.saveRedisData();
        console.log('Object saved to Redis');
      } catch (err) {
        throw new Error('Parameter is not a valid JSON object.');
      }
    } else {
      if (Object.keys(this.data).length === 0) {
        await this.fetchRedisData();
        console.log('Object fetched from Redis');
      }
    }
    return this.data;
  }
};
