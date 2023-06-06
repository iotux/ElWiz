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
  /*
  if (key === undefined || key === '') {
    console.log('UniCache: key has no value');
    return;
  }
  */
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
    this.options = options || {};
    //console.log('UniCache options:', this.options);

    if (this.options.syncInterval) {
      setInterval(() => {
        console.log('UniCache sync interval:', this.options.syncInterval * 1000 || 86400000);
        this.saveCacheData();
      }, (this.options.syncInterval * 1000 || 86400000));
    }

    this.data = {};

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
        //this.client.on('error', (error) => console.error(`Redis client error : ${error}`));
        this.client.on("error", (err) => {
          this.isConnected = false; console.log('Redis error:', err);
        });
        //this.client.on('ready', () => { this.isConnected = true; console.log('Redis connected...') })
        this.client.on('ready', () => {
          //if (this.redisKey !== null) { // && this.redisKey !== undefined) {
          if (this.client.get(this.redisKey) !== null) {
            this.fetchCacheData();
          } else {
            // TODO: Maybe remove {}?
            //this.client.set(this.redisKey, JSON.stringify({}));
          }
          //}
        });
        await this.client.connect();
      })();
    } else {
      this.filePath = this.savePath + '/' + this.cacheName + '.json';
      if (fs.existsSync(this.filePath)) {
        this.fetchCacheData();
      } else {
        if (!fs.existsSync(this.savePath)) {
          fs.mkdirSync(this.savePath, { recursive: true });
        }
        // TODO: Maybe remove {}?
        //fs.writeFileSync(this.filePath, '{}', 'utf-8');
      }
    }
  } // Constructor

  async isSaved() {
    return this.memSaved;
  }
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

  async setKey(newKey) {
    this.redisKey = newKey;
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
    if (Object.keys(this.data).length === 0) {
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
   * Saves cache data to the underlying storage.
   * @returns {Promise<void>} A promise that resolves when the cache data is saved.
   */
  async saveCacheData() {
    if (this.cacheType === 'redis') {
      //await this.ensureRedisConnection();
      await this.client.set(this.redisKey, JSON.stringify(this.data));
      console.log('Unicache: saved to Redis:', this.redisKey);
    } else {
      this.filePath = this.savePath + '/' + this.cacheName + '.json';
      //console.log(this.data);
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
      console.log('Unicache: saved to file:', this.filePath);
    }
  }

  /**
 * Ensures that the Redis client is connected.
 *
 * @param {}
 * @return {}
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
    // this.data[key] = val;
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
   * Clear the Redis object.
   */
  async clear() {
    this.data = {};
    this.memSaved = false;
    if (this.options.syncOnWrite) { await this.saveCacheData(); }
  }

  /**
   * Save the Redis object and disconnect.
   */
  async close() {
    if (this.options.syncOnClose) { await this.saveCacheData(); }
    if (this.cacheType === 'redis') {
      await this.client.quit();
      //await this.client.disconnect();
    }
  }
  async deleteObject(key) {
    console.log('deleteObject', this.savePath + '/' + key + '.json');
    if (await this.existsObject(key)) {
      if (this.cacheType === 'redis') {
        //await this.ensureRedisConnection();
        await this.client.del(key);
        console.log('UniCache: deleted:', key);
      } else {
        fs.unlinkSync(await this.fileName(key));
      }
      this.memSaved = false;
    }
  }

  async createObject(key, obj) {
    this.data = obj;
    if (this.cacheType === 'redis') {
      //await this.ensureRedisConnection();
      await this.client.set(key, JSON.stringify(obj));
    } else {
      //console.log('createObject', await this.fileName(key), obj); 
      const data = JSON.stringify(obj, null, 2);
      fs.writeFileSync(await this.fileName(key), data, 'utf-8');
    }
  }
  async existsObject(key) {
    //console.log('existsObject', await this.fileName(key));
    if (this.cacheType === 'redis') {
      //await this.ensureRedisConnection();
      const keys = await this.client.keys(key);
      return keys.length > 0;
    } else {
      return fs.existsSync(await this.fileName(key));
    }
  }
  async retrieveObject(key) {
    if (this.cacheType === 'redis') {
      //await this.ensureRedisConnection();
      return JSON.parse(await this.client.get(key));
    } else {
      return JSON.parse(fs.readFileSync(await this.fileName(key), 'utf-8'));
    }
  }

  /**
   * Fetch the Redis object.
   */
  async fetch() {
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
 * Initialize the Redis object.
 */
  async init(data) {
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
   * Initialize the Redis object or retrieve from storage.
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

  async dbCount(pattern) {
    if (this.cacheType === 'redis') {
      const keys = await this.client.keys(pattern);
      return keys.length;
    } else {
      const files = fs.readdirSync(this.savePath + '/');
      return files.length;
    }
  }

  async dbKeys(pattern) {
    if (this.cacheType === 'redis') {
      const keys = await this.client.keys(pattern);
      return keys;
    } else {
      let keys = [];
      // unfortunately it's not possible to use
      // filename globbing on a directory search
      const files = fs.readdirSync(this.savePath + '/');
      // returns a list of filenames without the extension
      files.forEach((file) => {
        let key = file.replace('.json', '');
        keys.push(key);
      })
      return keys;
    }
  }
};
