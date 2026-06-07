(function () {
  if (typeof io === 'undefined') {
    console.error("Socket.IO library (io) is not loaded. Please make sure the backend server is running.");
    window.streamSocket = null;
    return;
  }

  // Define the target backend URL.
  // 1. If running locally from a file (double-clicking the HTML), point to localhost:3000.
  // 2. If you host the frontend (Vercel) and backend (Render) separately, set your Render URL here (e.g., "https://your-backend.onrender.com").
  // 3. Otherwise, use same-origin (for unified Render/Railway hosting or npm run dev).
  let socketUrl = "";
  if (window.location.protocol === 'file:') {
    socketUrl = "http://localhost:3000";
  } else {
    const DEPLOYED_BACKEND_URL = ""; // <-- Replace with Render backend URL if using Vercel frontend
    socketUrl = DEPLOYED_BACKEND_URL || window.location.origin;
  }

  const socket = io(socketUrl, {
    reconnectionAttempts: 8,
    reconnectionDelay: 800,
    timeout: 10000
  });

  window.streamSocket = socket;
})();
