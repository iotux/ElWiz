const fs = require("fs");
const { createClient } = require("redis");

/**
 * Get properties from an object using a key string with dot notation.
 * @param {object} obj - The object containing the properties.
 * @param {string} key - The key string in dot notation.
 * @returns {*} The value at the specified key or undefined.
 */
const getProperties = (obj, key) => {
  const props = key.split('.');
  for (let i = 0; i < props.length; ++i) {
    obj = obj && obj[props[i]];
  }
  return obj;
}

/**
 * Set properties on an object using a key string with dot notation.
 * @param {object} obj - The object to set the properties on.
 * @param {string} key - The key string in dot notation.
 * @param {*} val - The value to set at the specified key.
 */
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
   * Creates a new UniCache instance.
   * @param {string} cacheName - The cache name.
   * @param {object} options - The options object.
   * @param {string} options.cacheType - The cache type, either 'file' or 'redis'.
   * @param {string} [options.savePath] - The path for file-based cache storage.
   * @param {number} [options.syncInterval] - The sync interval in seconds.
   * @param {boolean} [options.syncOnWrite] - Whether to sync on write.
   */
  constructor(cacheName, options) {
    this.cacheType = options.cacheType;
    this.cacheName = cacheName;
    this.redisKey = undefined;
    this.options = options || {};

    if (this.options.syncInterval) {
      setInterval(() => {
        this.saveCacheData();
      }, (this.options.syncInterval * 1000 || 86400000));
    }

    this.data = {};

    if (this.cacheType === 'redis') {
      this.redisKey = this.cacheName;
      (async () => {
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
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, "{}", "utf-8");
      } else {
        this.fetchCacheData();
      }
    }
  } // Constructor

  /**
   * Checks if the cache is empty.
   * @returns {Promise<boolean>} A promise that resolves to true if the cache is empty, otherwise false.
   */
  async isEmpty() {
    if (this.cacheType === 'redis') {
       const data = await JSON.parse(await this.client.get(this.redisKey))
       return ((data === null || Object.keys(data).length === 0) && Object.keys(this.data).length === 0)
     } else {
       const data = await JSON.parse(fs.readFileSync(this.filePath));
       return (Object.keys(data).length === 0 && Object.keys(this.data).length === 0)
     }
   }
 
   /**
    * Synchronizes the cache data with the underlying storage.
    * @returns {Promise<void>} A promise that resolves when the synchronization is complete.
    */
   async sync() {
     await this.saveCacheData();
   }
 
   /**
    * Fetches cache data from the underlying storage.
    * @returns {Promise<void>} A promise that resolves when the cache data is fetched.
    */
   async fetchCacheData() {
     let data;
     if (this.cacheType === 'redis') {
       data = await JSON.parse(await this.client.get(this.redisKey));
     } else {
       data = await JSON.parse(fs.readFileSync(this.filePath));
     }
     if (typeof data === "object") {
       this.data = data;
     }
   }
 
   /**
    * Saves cache data to the underlying storage.
    * @returns {Promise<void>} A promise that resolves when the cache data is saved.
    */
   async saveCacheData() {
     if (this.cacheType === 'redis') {
       await this.client.set(this.redisKey, JSON.stringify(this.data));
     } else {
       fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
     }
   }
 
   /**
    * Checks if a key exists in the cache.
    * @param {string} key - The key to check for.
    * @returns {Promise<boolean>} A promise that resolves to true if the key exists, otherwise false.
    */
   async has(key) {
     return Boolean(await getProperties(this.data, key));
   }
 
   /**
    * Retrieves the value of a key from the cache.
    * @param {string} key - The key to retrieve.
    * @returns {Promise<*>} A promise that resolves to the value of the key or undefined if the key does not exist.
    */
   async get(key) {
     return await getProperties(this.data, key);r
   }
 
   /**
    * Sets the value of a key in the cache.
    * @param {string} key - The key to set.
    * @param {*} val - The value to set for the key.
    * @returns {Promise<void>} A promise that resolves when the value is set and saved (if syncOnWrite is true).
    */
   async set(key, val) {
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
    * Initialize the Redis object or retrieve from storage.
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
