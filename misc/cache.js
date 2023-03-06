
const { createClient } = require('redis');
const client = createClient(6379, 'localhost');

client.on("error", (error) => console.error(`Redis error : ${error}`));
client.on("connect", () => console.log('Redis connected...'));

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
    await client.set(key, JSON.stringify(obj));
  },

  get: async function (key) {
    return await JSON.parse(client.get(key));
  }

}

cache.init();

exports = { cache }
