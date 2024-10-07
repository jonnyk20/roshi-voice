const express = require('express');
const {readFileSync} = require('fs');

const app = express();
// Serve the files in /assets at the URI /assets.
app.use('/assets', express.static('assets'));

const APP_VERSION = process.env.VERSION || '0.0.1';
const NODE_VERSION = process.version;


// The HTML content is produced by rendering a handlebars template.
// The template values are stored in global state for reuse.
const data = {
  service: process.env.K_SERVICE || '???',
  revision: process.env.K_REVISION || '???',
};
let template;

app.get('/', async (req, res) => {
  return res.json({
    appVersion: APP_VERSION,
    nodeVersion: NODE_VERSION,
  });
});

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(
    `Hello from Cloud Run! The container started successfully and is listening for HTTP requests on ${PORT}`
  );
});
