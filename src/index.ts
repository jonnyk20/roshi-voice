import express from 'express';

const app = express();
// Serve the files in /assets at the URI /assets.
app.use('/assets', express.static('assets'));

const APP_VERSION = process.env.VERSION || '0.0.01';
const NODE_VERSION = process.version;

// The HTML content is produced by rendering a handlebars template.
// The template values are stored in global state for reuse.
const data = {
  service: process.env.K_SERVICE || '???',
  revision: process.env.K_REVISION || '???',
};
let template;

app.get('/', async (req, res) => {
  res.json({
    appVersion: APP_VERSION,
    nodeVersion: NODE_VERSION,
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(
    `Hello from Cloud Run! The container started successfully and is listening for HTTP requests on ${PORT}`
  );
});
