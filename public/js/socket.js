(function () {
  if (typeof io === 'undefined') {
    console.error("Socket.IO library (io) is not loaded. Please make sure the backend server is running.");
    window.streamSocket = null;
    return;
  }

  const socket = io({
    reconnectionAttempts: 8,
    reconnectionDelay: 800,
    timeout: 10000
  });

  window.streamSocket = socket;
})();
