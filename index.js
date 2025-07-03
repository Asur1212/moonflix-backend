require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const { fetchTMDBMetadata, fetchTMDBEpisodeMetadata } = require('./services/tmdb');
const { uploadToBunny, checkIfExists } = require('./services/uploader');
const { logUpload } = require('./services/logger');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: 'http://localhost:3001',
  methods: ['GET', 'POST'],
}));

app.get('/api/getMetadata', async (req, res) => {
  const { id, type, season, episode } = req.query;

  if (!id || !['movie', 'tv'].includes(type)) {
    return res.status(400).json({ error: 'Invalid or missing "id" or "type"' });
  }

  try {
    const cdnBase = process.env.CDN_BASE_URL;

    if (type === 'tv' && season && episode) {
      const metaPath = `metadata/episode_${id}_s${season}_e${episode}.json`;
      const imagePath = `images/episode/episode_${id}_s${season}_e${episode}.jpg`;
      const metaUrl = `${cdnBase}/${metaPath}`;
      const imageUrl = `${cdnBase}/${imagePath}`;

      const exists = await checkIfExists(metaPath);
      if (exists) {
        console.log(`[CACHE] Episode S${season}E${episode} from CDN for TV ID: ${id}`);
        return res.json({ from: 'cdn', metaUrl, imageUrl });
      }

      const metadata = await fetchTMDBEpisodeMetadata(id, season, episode);
      await uploadToBunny(metaPath, Buffer.from(JSON.stringify(metadata, null, 2)));

      if (metadata.still_path) {
        const imgBuffer = await fetchImageWithRetry(metadata.still_path);
        await uploadToBunny(imagePath, imgBuffer);
      }

      await logUpload(id, `episode ${season}-${episode}`, 'uploaded');
      console.log(`[UPLOAD] Episode metadata uploaded for TV ID: ${id} S${season}E${episode}`);
      return res.json({ from: 'tmdb', metaUrl, imageUrl, metadata });
    }

    const metaPath = `metadata/${type}_${id}.json`;
    const posterPath = `images/poster/${type}_${id}.jpg`;
    const backdropPath = `images/backdrop/${type}_${id}.jpg`;

    const metaUrl = `${cdnBase}/${metaPath}`;
    const imageUrl = `${cdnBase}/${posterPath}`;
    const backdropUrl = `${cdnBase}/${backdropPath}`;

    const exists = await checkIfExists(metaPath);
    if (exists) {
      console.log(`[CACHE] ${type} metadata from CDN for ID: ${id}`);
      return res.json({ from: 'cdn', metaUrl, imageUrl, backdropUrl });
    }

    const metadata = await fetchTMDBMetadata(id, type);
    await uploadToBunny(metaPath, Buffer.from(JSON.stringify(metadata, null, 2)));

    if (metadata.poster_path) {
      try {
        const posterBuffer = await fetchImageWithRetry(metadata.poster_path);
        await uploadToBunny(posterPath, posterBuffer);
      } catch (err) {
        console.warn(`[WARNING] Poster upload failed: ${err.message}`);
      }
    }

    let uploadedBackdrop = false;
    if (metadata.backdrop_path) {
      try {
        const backdropBuffer = await fetchImageWithRetry(metadata.backdrop_path);
        await uploadToBunny(backdropPath, backdropBuffer);
        uploadedBackdrop = true;
      } catch (err) {
        console.warn(`[WARNING] Backdrop upload failed: ${err.message}`);
      }
    }

    await logUpload(id, type, 'uploaded');
    console.log(`[UPLOAD] ${type.toUpperCase()} metadata uploaded for ID: ${id}`);

    return res.json({
      from: 'tmdb',
      metaUrl,
      imageUrl,
      backdropUrl: uploadedBackdrop ? backdropUrl : null,
      metadata,
    });

  } catch (err) {
    console.error('[ERROR] Failed to fetch/upload:', err);
    res.status(500).json({ error: 'Failed to fetch and upload data.' });
  }
});

// ✅ New: Batch Metadata Fetch Route (no logic changed)
app.get('/api/getBatchMetadata', async (req, res) => {
  const { ids, type } = req.query;

  if (!ids || !['movie', 'tv'].includes(type)) {
    return res.status(400).json({ error: 'Missing or invalid "ids" or "type"' });
  }

  const cdnBase = process.env.CDN_BASE_URL;
  const idList = ids.split(',').map(i => i.trim()).filter(Boolean);

  const results = await Promise.all(idList.map(async (id) => {
    const metaPath = `metadata/${type}_${id}.json`;
    const posterPath = `images/poster/${type}_${id}.jpg`;
    const backdropPath = `images/backdrop/${type}_${id}.jpg`;

    const metaUrl = `${cdnBase}/${metaPath}`;
    const imageUrl = `${cdnBase}/${posterPath}`;
    const backdropUrl = `${cdnBase}/${backdropPath}`;

    try {
      const exists = await checkIfExists(metaPath);
      if (exists) {
        console.log(`[CACHE] ${type} metadata from CDN for ID: ${id}`);
        return {
          id,
          from: 'cdn',
          metaUrl,
          imageUrl,
          backdropUrl,
        };
      }

      const metadata = await fetchTMDBMetadata(id, type);
      await uploadToBunny(metaPath, Buffer.from(JSON.stringify(metadata, null, 2)));

      if (metadata.poster_path) {
        try {
          const posterBuffer = await fetchImageWithRetry(metadata.poster_path);
          await uploadToBunny(posterPath, posterBuffer);
        } catch (err) {
          console.warn(`[WARNING] Poster upload failed for ID ${id}: ${err.message}`);
        }
      }

      let uploadedBackdrop = false;
      if (metadata.backdrop_path) {
        try {
          const backdropBuffer = await fetchImageWithRetry(metadata.backdrop_path);
          await uploadToBunny(backdropPath, backdropBuffer);
          uploadedBackdrop = true;
        } catch (err) {
          console.warn(`[WARNING] Backdrop upload failed for ID ${id}: ${err.message}`);
        }
      }

      await logUpload(id, type, 'uploaded');
      console.log(`[UPLOAD] ${type.toUpperCase()} metadata uploaded for ID: ${id}`);

      return {
        id,
        from: 'tmdb',
        metaUrl,
        imageUrl,
        backdropUrl: uploadedBackdrop ? backdropUrl : null,
        metadata,
      };
    } catch (err) {
      console.error(`[ERROR] Failed to process ID ${id}:`, err.message);
      return {
        id,
        error: true,
        message: err.message,
      };
    }
  }));

  res.json({ results });
});

// ✅ Image downloader with retry (unchanged)
const fetchImageWithRetry = async (path, retries = 3, delay = 1000) => {
  if (!path) throw new Error('Image path is undefined');
  const url = `https://image.tmdb.org/t/p/original${path}`;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
      return Buffer.from(response.data);
    } catch (err) {
      console.warn(`[Retry] Image download failed (attempt ${i + 1}): ${err.code || err.message}`);
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
};

app.listen(PORT, () => {
  console.log(`✅ BunnyCDN Metadata Server running at: http://localhost:${PORT}`);
});
