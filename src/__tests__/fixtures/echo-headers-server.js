// Stands in for Next's standalone `server.js` in `proxy-entry.test.ts`: a
// `node:http` server created and started the way Next's `start-server.js`
// does, answering with the request headers its listener was given.
const http = require("node:http");

const server = http.createServer((req, res) => {
  res.end(JSON.stringify(req.headers));
});
server.listen(0, "127.0.0.1", () => {
  console.log(`listening on ${server.address().port}`);
});
