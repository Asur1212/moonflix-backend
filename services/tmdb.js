const axios = require('axios');

const fetchWithRetry = async (url, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, { timeout: 8000 });
    } catch (err) {
      console.warn(`[Retry] TMDb request failed (attempt ${i + 1}): ${err.code || err.message}`);
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
};

const fetchTMDBMetadata = async (id, type) => {
  const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${process.env.TMDB_API_KEY}&language=en-US`;
  const res = await fetchWithRetry(url);
  const data = res.data;

  return {
    title: data.title || data.name,
    description: data.overview,
    genres: data.genres?.map(g => g.name),
    release_date: data.release_date || data.first_air_date,
    average_vote: data.vote_average,
    original_language: data.original_language,
    age_rating: 'Not rated',
    poster_path: data.poster_path,
    backdrop_path: data.backdrop_path
  };
};

const fetchTMDBEpisodeMetadata = async (tvId, season, episode) => {
  const url = `https://api.themoviedb.org/3/tv/${tvId}/season/${season}/episode/${episode}?api_key=${process.env.TMDB_API_KEY}&language=en-US`;
  const res = await fetchWithRetry(url);
  const ep = res.data;

  return {
    title: ep.name,
    description: ep.overview,
    air_date: ep.air_date,
    average_vote: ep.vote_average,
    season_number: ep.season_number,
    episode_number: ep.episode_number,
    still_path: ep.still_path
  };
};

module.exports = { fetchTMDBMetadata, fetchTMDBEpisodeMetadata };
