const axios = require('axios');

const checkIfExists = async (path) => {
  try {
    const res = await axios.head(`${process.env.CDN_BASE_URL}/${path}`);
    return res.status === 200;
  } catch {
    return false;
  }
};

const uploadToBunny = async (path, fileBuffer) => {
  const url = `${process.env.BUNNY_STORAGE_REGION_URL}/${path}`;
  await axios.put(url, fileBuffer, {
    headers: {
      AccessKey: process.env.BUNNY_API_KEY,
      'Content-Type': 'application/octet-stream'
    }
  });
};

module.exports = { checkIfExists, uploadToBunny };
