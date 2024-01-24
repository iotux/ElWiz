const fs = require('fs');

/**
 * Get properties from an object using a key string with dot notation.
 * @param {object} obj - The object containing the properties.
 * @param {string} key - The key string in dot notation.
 * @returns {*} The value at the specified key or undefined.
 */
const getProperties = (obj, key) => {
  const props = typeof key === 'string' ? key.split('.') : [key];
  for (let i = 0; i < props.length; ++i) {
    obj = obj && obj[props[i]];
  }
  return obj;
};

/**
 * Set properties on an object using a key string with dot notation.
 * @param {object} obj - The object to set the properties on.
 * @param {string} key - The key string in dot notation.
 * @param {*} val - The value to set at the specified key.
 */
const setProperties = (obj, key, val) => {
  const props = typeof key === 'string' ? key.split('.') : [key];
  let i;
  for (i = 0; i < props.length - 1; ++i) {
    obj = obj[props[i]];
  }
  obj[props[i]] = val;
};

module.exports = class UniCache {
  /**
   * Creates a new UniCache instance.
   * @param {string} cacheName - The cache name.
   * @param {object} options - The options object.
   * @param {string} options.cacheType - The cache type, either 'file' or 'redis'.
   * @param {string} [options.savePath] - The path for file-based cache storage.
   * @param {number} [options.syncInterval] - The sync interval in seconds.
   * @param {boolean} [options.syncOnWrite] - Whether to sync on write.
   * @param {boolean} [options.syncOnClose] - Whether to sync on .
   */
  constructor(cacheName, options) {
    this.isConnected = false;
    this.memSaved = false;
    this.cacheType = options.cacheType;
    this.savePath = options.savePath;
    this.cacheName = cacheName;
    this.redisKey = undefined;
    this.dbPrefix = undefined;
    this.options = options || {};
    //console.log('UniCache options:', this.options);

    if (this.options.syncInterval) {
      setInterval(() => {
        if (false) {
          console.log('UniCache sync interval:', this.options.syncInterval * 1000 || 86400000);
        }
        this.saveCacheData();
      }, (this.options.syncInterval * 1000 || 86400000));
    }

    this.data = {};
    if (cacheName === '')
      this.cacheName = false;

    if (this.cacheType === 'redis') {
      const { createClient } = require('redis');
      this.redisKey = this.cacheName;
      (async () => {
        this.client = createClient(6379, "localhost", {
          retry_strategy: function (options) {
            if (options.error && options.error.code === "ECONNREFUSED") {
              return new Error("The server refused the connection");
            }
            if (options.total_retry_time > 1000 * 60 * 60) {
              return new Error("Retry time exhausted");
            }
            if (options.attempt > 10) {
              return undefined;
            }
            return Math.min(options.attempt * 100, 3000);
          },
        });
        this.client.on("error", (err) => {
          this.isConnected = false; console.log('Redis error:', err);
        });
        this.client.on('connect', () => {
          if (this.client.get(this.redisKey) !== null) {
            this.fetchCacheData();
          }
        });
        await this.client.connect();
      })();
    } else {
      if (!fs.existsSync(this.savePath)) {
        fs.mkdirSync(this.savePath, { recursive: true });
      }
      if (this.cacheName !== null)
        this.filePath = this.savePath + '/' + this.cacheName + '.json';
      if (fs.existsSync(this.filePath)) {
        this.fetchCacheData();
      }
    }
  } // Constructor

  /**
   * Returns a Promise that resolves with a boolean indicating whether the
   * state of this object is saved in memory.
   *
   * @return {Promise<boolean>} A Promise that resolves with a boolean indicating
   * whether the state of this object is saved in memory.
   */
  async isSaved() {
    return this.memSaved;
  }

  /**
   * Returns a boolean indicating whether the data has been saved or not.
   *
   * @return {boolean} The negation of the boolean value of memSaved instance variable.
   */
  async notSaved() {
    return !this.memSaved;
  }

  /**
   * Checks if the cache is empty.
   * @returns {Promise<boolean>} A promise that resolves to true if the cache is empty, otherwise false.
   */
  async isEmpty() {
    if (this.cacheType === 'redis') {
      //if (Object.keys(this.data).length === 0 && this.client.get(this.redisKey) === null) {
      if (this.notSaved() && this.client.get(this.redisKey) === null) {
        return true;
      }
      const keys = await this.client.keys(this.redisKey);
      //return Object.keys(this.data).length === 0 && Object.keys(keys).length === 0;
      return this.notSaved() && Object.keys(keys).length === 0;
    } else {
      if (!fs.existsSync(this.filePath)) {
        return true;
      }
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return (Object.keys(this.data).length === 0 && Object.keys(data).length === 0);
    }
  }

  /**
   * Sets a new Redis key.
   *
   * @param {any} newKey - The new Redis key.
   * @return {Promise<void>} A Promise that resolves when the new key is set.
   */
  async setKey(key) {
    this.redisKey = key;
  }

  /**
   * Synchronizes the cache data with the underlying storage.
   * @returns {Promise<void>} A promise that resolves when the synchronization is complete.
   */
  async sync(key) {
    if (key) this.redisKey = key;
    await this.saveCacheData();
  }

  /**
   * Fetches data from storage.
   *
   * @return {Promise<void>} - Promise that resolves when the data is fetched.
   */
  async fetchCacheData() {
    let data;
    if (this.cacheName && Object.keys(this.data).length === 0) {
      if (this.cacheType === 'redis') {
        //await this.ensureRedisConnection();
        data = await JSON.parse(await this.client.get(this.redisKey));
        console.log('UniCache: Fetched data from Redis:', this.redisKey);
      } else {
        data = await JSON.parse(fs.readFileSync(this.filePath));
        console.log('UniCache: fetched data from file:', this.filePath);
      }
      if (typeof data === 'object') {
        this.data = data;
        this.memSaved = true;
      }
    }
  }

  /**
   * Saves cache data to either Redis or a local file.
   *
   * @return {Promise<void>} A Promise that resolves when the cache data has been saved.
   */
  async saveCacheData() {
    if (this.cacheType === 'redis') {
      //await this.ensureRedisConnection();
      await this.client.set(this.redisKey, JSON.stringify(this.data));
      console.log('Unicache: saved to Redis:', this.redisKey);
    } else {
      this.filePath = this.savePath + '/' + this.cacheName + '.json';
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
      console.log('Unicache: saved to file:', this.filePath);
    }
  }

  /**
   * Asynchronously ensures the Redis connection is established by pinging 
   * the Redis client. If the connection is not established, it connects to 
   * Redis and sets the connection status flag to true.
   *
   * @return {Promise<boolean>} A Promise that resolves to a boolean indicating 
   * if the Redis connection is established.
   */
  async ensureRedisConnection() {
    this.isConnected = await this.client.ping();
    if (!this.isConnected) {
      await this.client.connect();
      this.isConnected = true;
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
    return await getProperties(this.data, key);
  }

  /**
   * Sets the value of a key in the cache.
   * @param {string} key - The key to set.
   * @param {*} val - The value to set for the key.
   * @returns {Promise<void>} A promise that resolves when the value is set and saved (if syncOnWrite is true).
   */
  async set(key, val) {
    this.data[key] = val;
    await setProperties(this.data, key, val);
    if (this.options.syncOnWrite) { await this.saveCacheData(); }
  }

  /**
 * Delete data for a key from the Redis object.
 * @param {string} key
 */
  async delete(key) {
    delete this.data[key];
    if (this.options.syncOnWrite) { await this.saveCacheData(); }
  }

  /**
 * Async function that returns the file name with the provided key.
 *
 * @param {string} key - The key used to construct the file name.
 * @return {string} The file name with the provided key.
 */
  async fileName(key) {
    return this.savePath + '/' + key + '.json';
  }

  /**
   * Add a number to a key in the database.
   * @param {string} key
   * @param {number} count
   */
  async add(key, count) {
    if (!this.data[key]) this.data[key] = 0;
    this.data[key] += count;
    if (this.options.syncOnWrite) { await this.saveCacheData(); }
  }

  /**
   * Subtract a number from a key in the database.
   * @param {string} key
   * @param {number} count
   */
  async subtract(key, count) {
    if (!this.data[key]) this.data[key] = 0;
    this.data[key] -= count;
    if (this.options.syncOnWrite) { await this.saveCacheData(); }
  }

  /**
 * Push an element to a key in the Redis object.
 * @param {string} key
 * @param {*} element
 */
  async push(key, element) {
    if (!this.data[key]) this.data[key] = [];
    this.data[key].push(element);
    if (this.options.syncOnWrite) { await this.saveCacheData(); }
  }

  /**
   * Clears the data object and sets memSaved to false. 
   * If syncOnWrite is true, saves the cache data to disk asynchronously.
   *
   * @return {Promise<void>} A Promise that resolves when the cache data is successfully saved to disk.
   */
  async clear(key) {
    if (key)
      this.redisKey = key;
    this.data = {};
    this.memSaved = false;
    // TODO: Probably remove this and delete the cache data.
    if (this.options.syncOnWrite) { await this.saveCacheData(); }
  }

  /**
   * Closes the cache connection and syncs cached data if specified.
   *
   * @return {Promise<void>} Promise that resolves when the cache connection is closed.
   */
  async close() {
    if (this.options.syncOnClose) { await this.saveCacheData(); }
    if (this.cacheType === 'redis') {
      await this.client.quit();
    }
  }

  /**
   * Asynchronously fetches the data.
   *
   * @return {object} The data retrieved from memory or cache.
   */
  async fetch(key) {
    if (key)
      this.redisKey = key;
    if (Object.keys(this.data).length === 0) {
      await this.fetchCacheData();
    } else {
      console.log('UniCache: retrieved from memory');
      return this.data;
    }
    console.log('UniCache: retrieved from cache');
    return this.data;
  }

  /**
   * Asynchronously initializes the object with provided data, saves it to 
   * memory, and returns the data. If data is not provided, the function 
   * returns the existing data. If syncOnWrite flag is set, saves the data to 
   * cache before returning it.
   *
   * @param {object} data - The data to initialize the object with.
   * @return {object} The initialized data or existing data, depending on 
   * whether data is provided.
   */
  async init(data, key) {
    if (key)
      this.redisKey = key;
    if (data) {
      try {
        this.data = data;
        this.memSaved = true;
        if (this.options.syncOnWrite) { await this.saveCacheData(); }
      } catch (err) {
        console.error('Parameter is not a valid JSON object', err);
      }
    }
    return this.data;
  }

  /**
   * Asynchronously sets the data of a JSON object. If data is not provided, it 
   * fetches data from cache and returns it. If data is provided, it sets the 
   * data and syncs it with the cache if syncOnWrite is set to true. Throws 
   * an error if the parameter is not a valid JSON object.
   *
   * @param {Object} data - the JSON object to be set.
   * @return {Object} the JSON object set or fetched from cache.
   */
  async JSON(data) {
    if (data) {
      try {
        this.data = data;
        this.memSaved = true;
        if (this.options.syncOnWrite) { await this.saveCacheData(); }
      } catch (err) {
        throw new Error('Parameter is not a valid JSON object', err);
      }
    } else {
      if (Object.keys(this.data).length === 0) {
        await this.fetchCacheData();
        console.log('Object fetched from cache');
      }
    }
    return this.data;
  }

  /**
   * Counts the number of keys or files based on the cache type.
   *
   * @param {string} pattern - The pattern to match for keys or files.
   * @return {number} The number of keys or files that match the pattern.
   */
  async dbCount(pattern) {
    if (this.cacheType === 'redis') {
      const keys = await this.client.keys(pattern);
      return keys.length;
    } else {
      const files = fs.readdirSync(this.savePath + '/');
      return files.length;
    }
  }

  /**
   * Asynchronously retrieves keys from either Redis cache or a directory on disk.
   *
   * @param {string} pattern - The pattern to search for keys. If using Redis, this should be a valid 
   * glob pattern.
   * @return {Array} - An array of keys. If using Redis, these are the keys matching the pattern. 
   * Otherwise, these are the filenames in the directory without the `.json` extension.
   */
  async dbKeys(pattern) {
    if (this.cacheType === 'redis') {
      const keys = await this.client.keys(pattern);
      return keys;
    } else {
      let keys = [];
      // unfortunately it's not possible to use
      // filename globbing on a directory search
      console.log('dbKeys', this.savePath)
      const files = fs.readdirSync(this.savePath + '/');
      // returns a list of filenames without the extension
      files.forEach((file) => {
        let key = file.replace('.json', '');
        keys.push(key);
      })
      return keys;
    }
  }

  /**
   * Checks if an object exists given a key.
   *
   * @async
   * @param {string} key - the key to check for object existence
   * @return {Promise<boolean>} a promise that resolves to a boolean indicating if the object exists
   */
  async existsObject(key) {
    //if (key === this.redisKey)
    //  return this.data;
    if (this.cacheType === 'redis') {
      //await this.ensureRedisConnection();
      const keys = await this.client.keys(key);
      return keys.length > 0;
    } else {
      return fs.existsSync(this.fileName(key));
    }
  }

  /**
   * Asynchronously creates an object with the given key and object.
   *
   * @param {string} key - The key to associate with the object.
   * @param {Object} obj - The object to store.
   * @return {Promise<void>} A promise that resolves once the object has been created.
   */
  async createObject(key, obj) {
    this.redisKey = key;
    this.data = obj;
    //if (this.data[key]) this.data[key] = null;
    if (this.cacheType === 'redis') {
      //await this.ensureRedisConnection();
      await this.client.set(key, JSON.stringify(obj));
    } else {
      //console.log('createObject', await this.fileName(key), obj); 
      const data = JSON.stringify(obj, null, 2);
      const fileName = await this.fileName(key);
      fs.writeFileSync(fileName, data, 'utf-8');
    }
  }

  async pushObject(key, element) {
    this.redisKey = key;
    if (!Array.isArray(this.data)) this.data = [];
    //if (!this.data[key]) this.data[key] = [];
    this.data.push(element);
    if (this.options.syncOnWrite) { await this.saveCacheData(); }
  }

  /**
  * Asynchronously retrieves an object from either Redis cache or file system.
  *
  * @param {string} key - The key of the object to retrieve.
  * @return {Promise<object>} A Promise that resolves to the retrieved object.
  */
  async retrieveObject(key) {
    // TODO: implement storage/cache sync
    if (key === this.redisKey) {
      return this.data;
    }
    this.redisKey = key;
    try {
      if (this.cacheType === 'redis') {
        //await this.ensureRedisConnection();
        return JSON.parse(await this.client.get(key));
      } else {
        return JSON.parse(fs.readFileSync(this.fileName(key), 'utf-8'));
      }
    } catch (err) {
      this.redisKey = false;
      console.error('Error retrieving object from cache:', err);
      return null;
    }
  }

  /**
   * Deletes an object from the cache if it exists.
   *
   * @param {string} key - The key of the object to be deleted.
   * @return {Promise<void>} A Promise that resolves after the object is deleted.
   */
  async deleteObject(key) {
    this.redisKey = key;
    if (await this.existsObject(key)) {
      if (this.cacheType === 'redis') {
        await this.client.del(key);
        console.log('UniCache: deleted:', key);
      } else {
        fs.unlinkSync(await this.fileName(key));
        console.log('UniCache: deleted:', this.fileName(key));
      }
      this.memSaved = false;
    }
  }
};
