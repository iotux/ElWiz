const fs = require("fs");

const getProperties = (object, key) => {
    const props = key.split('.');
    let i = 0;
    for (; i < props.length; ++i) {
        object = object && object[props[i]];
    }
    return object;
}

const setProperties = (object, key, value) => {
    const props = key.split('.');
    let i = 0;
    for (; i < props.length - 1; ++i) {
        object = object[props[i]];
    }
    object[props[i]] = value;
}
module.exports = class FileCache {

  /**
   * @typedef {object} SyncOptions
   * @property {boolean} [syncOnWrite=false] Whether the snapshots are enabled
   * @property {number} [syncInterval=86400000] The interval between each snapshot
   * @property {string} [path='./data/'] The path of the backups
   */
  /**
   * @param {string} filePath The path of the json file used for the database.
   * @param {SyncOptions} options
   */
  constructor(fileName, options){
    /**
     * The path of the json file used as database.
     * @type {string}
     */
    this.path = options.savePath;
    this.filePath = this.path + fileName + '.json'

    if (!fs.existsSync(this.path)) {
      fs.mkdirSync(this.path, { recursive: true });
    }

    /**
     * The options for the database
     * @type {SyncOptions}
     */
    this.options = options || {};

    if (this.options.syncInterval) {
      setInterval(() => {
        this.saveFileData();
      }, (this.options.syncInterval * 1000 || 86400000));
    }

    /**
     * The data stored in the database.
     * @type {object}
     */
    this.data = {};

    if(!fs.existsSync(this.filePath)){
      fs.writeFileSync(this.filePath, "{}", "utf-8");
    } else {
      this.fetchFileData();
    }
  } // Constructor 

  /**
   * Check if data is an empty object
   */
  // TODO: check for non-existant (deleted) file
  async isEmpty(){
    const data = await JSON.parse(fs.readFileSync(this.filePath));
    return (Object.keys(data).length === 0  && Object.keys(this.data).length === 0)
  }

  /**
   * Sync data to file
   */
  async sync () {
    await this.saveFileData();
  }
  /**
   * Get data from the json file and store it in the data property.
   */
  async fetchFileData(){
    const data = await JSON.parse(fs.readFileSync(this.filePath));
    if(typeof data === "object") {
      this.data = data;
    }
  }

  /**
   * Write data to the json file.
   */
  async saveFileData(){
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    console.log('saveFileData', this.data)
  }

  /**
   * Check if a key data exists.
   * @param {string} key 
   */
  async has(key){
    return Boolean(await getProperties(this.data, key));
  }
  
  /**
   * Get data for a key in the database
   * @param {string} key 
   */
  async get(key){
    return await getProperties(this.data, key);
  }
  
  /**
   * Set new data for a key in the database.
   * @param {string} key
   * @param {*} value 
   */
  async set(key, val){
    setProperties(this.data, key, val);
    if (this.options.syncOnWrite)
      await this.saveFileData();
  }

  /**
   * Delete data for a key from the database.
   * @param {string} key 
   */
  async delete(key){
    delete this.data[key];
    if (this.options.syncOnWrite)
    await this.saveFileData();
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
    await this.saveFileData();
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
    await this.saveFileData();
  }

  /**
   * Push an element to a key in the database.
   * @param {string} key 
   * @param {*} element 
   */
  async push(key, element){
    if (!this.data[key]) this.data[key] = [];
    this.data[key].push(element);
    if (this.options.syncOnWrite)
    await this.saveFileData();
  }

  /**
   * Clear the database.
   */
  async clear(){
    this.data = {};
    if (this.options.syncOnWrite)
    await this.saveFileData();
  }
  /**
   * Save the object.
   */
  async close(){
    await this.saveFileData();
  }
  
  async JSON(data){
    if (data) {
      try {
        await JSON.parse(JSON.stringify(data));
        this.data = data;
        await this.saveFileData();
        console.log('Object saved to file', this.data);
      } catch (err) {
        throw new Error('Parameter is not a valid JSON object.');
      }
    } else {
      if (Object.keys(this.data).length === 0) {
        await this.fetchFileData();
        console.log('Object fetched from file');
      }
    }
    return this.data;
  }
};
