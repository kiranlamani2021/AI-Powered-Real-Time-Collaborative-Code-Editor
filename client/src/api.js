// Single source of truth for the backend URL.
// Production: set VITE_API_URL (e.g. https://my-backend.onrender.com).
// Local development: falls back to the local backend.
const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

export default API_URL;
