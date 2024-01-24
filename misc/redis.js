const redis = require("redis");

async function checkRedisHealth(host = 'localhost', port = 6379, timeout = 5000) {
  return new Promise((resolve) => {
    const client = redis.createClient({ host, port });
    const timer = setTimeout(() => {
      console.log("Redis health check timed out.");
      client.quit();
      resolve(false);
    }, timeout);

    client.on('error', (err) => {
      console.log('Redis error', err);
      clearTimeout(timer);
      client.quit();
      resolve(false);
    });

    client.on('ready', () => {
      console.log('Redis is ready');
      clearTimeout(timer);
      client.quit();
      resolve(true);
    });
  });
}

module.exports = checkRedisHealth;
