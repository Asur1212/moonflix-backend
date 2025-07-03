const fs = require('fs-extra');
const path = require('path');
const logPath = path.join(__dirname, '../logs/uploads.log');

const logUpload = async (id, type, status) => {
  const entry = `${new Date().toISOString()} | ${type} | ID: ${id} | ${status}\n`;
  await fs.appendFile(logPath, entry);
};

module.exports = { logUpload };
