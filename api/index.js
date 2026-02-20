const { app, initDb } = require('../server');

let initialized = false;

module.exports = async (req, res) => {
  if (!initialized) {
    await initDb();
    initialized = true;
  }
  app(req, res);
};
