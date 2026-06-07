(function () {
  const socket = io({
    reconnectionAttempts: 8,
    reconnectionDelay: 800,
    timeout: 10000
  });

  window.streamSocket = socket;
})();
