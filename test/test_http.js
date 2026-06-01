const http = require('http');

const options = {
  hostname: '192.168.0.109',
  port: 8000,
  path: '/',
  method: 'GET',
  timeout: 5000
};

console.log("[TEST] Sending HTTP GET to http://192.168.0.109:8000/ ...");

const req = http.request(options, res => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
  res.setEncoding('utf8');
  res.on('data', chunk => {
    console.log(`BODY: ${chunk.substring(0, 500)}`); // Print first 500 chars
  });
});

req.on('timeout', () => {
  console.log('Request timed out.');
  req.destroy();
});

req.on('error', e => {
  console.error(`problem with request: ${e.message}`);
});

req.end();
