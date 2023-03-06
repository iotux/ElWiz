
const { createClient } = require('redis');
const client = createClient();
client.on('error', err) {
  console.log('Redis Client Error', err);
}

const cache = {
  isVirgin: true,
  client: client,

  init: async function () {
    if (this.isVirgin) {
      await this.client.connect();
      this.isVirgin = false;
    }
  },

  set: async function (key, obj) {
    client.set(key, JSON.stringify(obj));
  },

  get: async function (key) {
    return await JSON.parse(client.get(key));
  }

}

cache.init();

exports = { cache }
