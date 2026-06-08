(function () {
  const socket = window.streamSocket;
  const utils = window.StreamUtils;
  const iceServers = [
    // Xirsys STUN
    { urls: 'stun:bn-turn2.xirsys.com' },
    // Xirsys TURN
    {
      urls: [
        'turn:bn-turn2.xirsys.com:80?transport=udp',
        'turn:bn-turn2.xirsys.com:3478?transport=udp',
        'turn:bn-turn2.xirsys.com:80?transport=tcp',
        'turn:bn-turn2.xirsys.com:3478?transport=tcp',
        'turns:bn-turn2.xirsys.com:443?transport=tcp',
        'turns:bn-turn2.xirsys.com:5349?transport=tcp'
      ],
      username: 'RqZHk8jrk2GZsPQ57jSD0ySZ3IucDnBZkfvMPu2eyr2hA2Ytg12VlLlBdPOpW0UmAAAAAGol0wF1a3lyag==',
      credential: '992a2b08-62ae-11f1-a2b8-0242ac140004'
    }
  ];

  const remoteVideo = document.querySelector('#remoteVideo');
  const codeInput = document.querySelector('#streamCodeInput');
  const connectButton = document.querySelector('#connectStream');
  const disconnectButton = document.querySelector('#disconnectStream');
  const fullscreenButton = document.querySelector('#fullscreenVideo');
  const statusBadge = document.querySelector('#statusBadge');
  const networkBadge = document.querySelector('#networkBadge');
  const messageBox = document.querySelector('#messageBox');
  const loadingOverlay = document.querySelector('#loadingOverlay');

  let peerConnection = null;
  let currentCode = null;
  let broadcasterId = null;
  let reconnectTimer = null;
  let hasVideoStream = false; // track if video ever successfully played

  function init() {
    if (!socket) {
      utils.setStatus(statusBadge, 'Disconnected', 'danger');
      utils.showMessage(messageBox, 'Cannot connect to server. Please run the server ("npm run dev" or "npm start") and access this page via localhost.', 'danger');
      connectButton.disabled = true;
      codeInput.disabled = true;
      return;
    }
    bindEvents();
    utils.updateNetworkBadge(networkBadge);
  }

  function bindEvents() {
    connectButton.addEventListener('click', connectToStream);
    disconnectButton.addEventListener('click', disconnectFromStream);
    fullscreenButton.addEventListener('click', openFullscreen);
    codeInput.addEventListener('input', () => {
      codeInput.value = utils.normalizeCode(codeInput.value).slice(0, 6);
    });
    codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        connectToStream();
      }
    });

    window.addEventListener('online', () => utils.updateNetworkBadge(networkBadge));
    window.addEventListener('offline', () => utils.updateNetworkBadge(networkBadge));
    window.addEventListener('beforeunload', () => {
      if (currentCode) {
        socket.emit('stream:leave');
      }
    });

    socket.on('connect', () => {
      if (currentCode && !peerConnection) {
        scheduleReconnect();
      }
    });

    socket.on('disconnect', () => {
      utils.setStatus(statusBadge, 'Disconnected', 'danger');
      showLoading(false);
    });

    socket.on('webrtc:offer', async ({ broadcasterId: incomingBroadcasterId, offer }) => {
      broadcasterId = incomingBroadcasterId;
      await answerOffer(offer);
    });

    socket.on('webrtc:ice-candidate', async ({ candidate }) => {
      if (!peerConnection || !candidate) {
        return;
      }

      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.warn('Failed to add broadcaster ICE candidate', error);
      }
    });

    socket.on('stream:ended', ({ message }) => {
      cleanupPeerConnection();
      currentCode = null;
      broadcasterId = null;
      codeInput.disabled = false;
      connectButton.hidden = false;
      disconnectButton.hidden = true;
      utils.setStatus(statusBadge, 'Stream Ended', 'warning');
      utils.showMessage(messageBox, message || 'The stream has ended.', 'warning');
      showLoading(false);
    });

    socket.on('stream:error', ({ message }) => {
      utils.showMessage(messageBox, message, 'danger');
    });
  }

  function connectToStream() {
    const code = utils.normalizeCode(codeInput.value);

    if (!utils.isValidCode(code)) {
      utils.showMessage(messageBox, 'Enter a valid 6 character stream code.', 'danger');
      return;
    }

    currentCode = code;
    connectButton.disabled = true;
    codeInput.disabled = true;

    // Step 1: Show verifying animation
    utils.setStatus(statusBadge, 'Verifying…', 'warning');
    utils.showMessage(messageBox, '🔍 Verifying stream code…', 'warning');
    showLoading(true);

    // Step 2: After short delay, actually join
    setTimeout(() => {
      socket.emit('stream:join', { code }, ({ ok, message, broadcasterId: id }) => {
        connectButton.disabled = false;

        if (!ok) {
          currentCode = null;
          codeInput.disabled = false;
          utils.setStatus(statusBadge, 'Invalid Code', 'danger');
          utils.showMessage(messageBox, '❌ ' + (message || 'Stream not found. Check the code and try again.'), 'danger');
          showLoading(false);
          // Shake the input
          codeInput.style.animation = 'none';
          codeInput.offsetHeight; // reflow
          codeInput.style.animation = 'shake 0.4s ease';
          return;
        }

        broadcasterId = id;
        connectButton.hidden = true;
        disconnectButton.hidden = false;
        utils.setStatus(statusBadge, 'Connecting…', 'warning');
        utils.showMessage(messageBox, '✓ Code verified! Connecting to live feed…', 'good');
      });
    }, 800);
  }

  async function answerOffer(offer) {
    cleanupPeerConnection();

    peerConnection = new RTCPeerConnection({ iceServers });

    peerConnection.ontrack = ({ streams }) => {
      const [stream] = streams;

      if (stream) {
        remoteVideo.srcObject = stream;
        hasVideoStream = true;
        utils.setStatus(statusBadge, 'Connected', 'good');
        utils.showMessage(messageBox, 'Live feed connected.', 'good');
        showLoading(false);

        // Explicitly play and handle autoplay prevention
        remoteVideo.play().catch((error) => {
          console.warn('Autoplay prevented:', error);
          utils.showMessage(messageBox, 'Tap the play button on the video to start.', 'warning');
        });
      }
    };

    peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate && broadcasterId) {
        socket.emit('webrtc:ice-candidate', {
          targetId: broadcasterId,
          candidate
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;

      if (broadcasterId) {
        socket.emit('connection:state', { targetId: broadcasterId, state });
      }

      if (state === 'connected') {
        utils.setStatus(statusBadge, 'Connected', 'good');
        utils.showMessage(messageBox, 'Live feed connected.', 'good');
        showLoading(false);
      }

      // 'disconnected' is transient with TURN - self-heals. Never cover the video.
      if (state === 'disconnected') {
        utils.setStatus(statusBadge, 'Unstable', 'warning');
        // Only show message if video not playing - don't interrupt a working stream
        if (!hasVideoStream) {
          utils.showMessage(messageBox, 'Connection momentarily unstable...', 'warning');
        }
      }

      // Hard failure - try to reconnect but preserve playing video
      if (state === 'failed') {
        utils.setStatus(statusBadge, 'Reconnecting...', 'warning');
        utils.showMessage(messageBox, 'Connection lost. Reconnecting...', 'warning');
        // NEVER show black overlay if video was ever playing
        if (!hasVideoStream) {
          showLoading(true);
        }
        scheduleReconnect();
      }
    };

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit('webrtc:answer', {
        broadcasterId,
        answer
      });
    } catch (error) {
      utils.setStatus(statusBadge, 'WebRTC Failure', 'danger');
      utils.showMessage(messageBox, `Could not connect video: ${error.message}`, 'danger');
      showLoading(false);
    }
  }

  function scheduleReconnect() {
    if (!currentCode || reconnectTimer) {
      return;
    }
    // Never show black overlay if video was successfully playing
    if (!hasVideoStream) {
      showLoading(true);
    }

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;

      if (!currentCode) {
        return;
      }

      // Close old peer connection but KEEP srcObject (video keeps playing)
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }

      socket.emit('stream:leave');
      socket.emit('stream:join', { code: currentCode }, ({ ok, message, broadcasterId: id }) => {
        if (!ok) {
          currentCode = null;
          broadcasterId = null;
          codeInput.disabled = false;
          connectButton.hidden = false;
          disconnectButton.hidden = true;
          utils.setStatus(statusBadge, 'Disconnected', 'danger');
          utils.showMessage(messageBox, message || 'Stream is no longer available.', 'danger');
          remoteVideo.srcObject = null;
          hasVideoStream = false;
          showLoading(false);
          return;
        }

        broadcasterId = id;
        // Do NOT call showLoading(true) here if video was playing
      });
    }, 1200);
  }

  function disconnectFromStream() {
    socket.emit('stream:leave');
    cleanupPeerConnection();
    currentCode = null;
    broadcasterId = null;
    hasVideoStream = false;
    codeInput.disabled = false;
    connectButton.hidden = false;
    disconnectButton.hidden = true;
    utils.setStatus(statusBadge, 'Disconnected', 'neutral');
    utils.showMessage(messageBox, 'Disconnected from stream.', 'neutral');
    showLoading(false);
  }

  function cleanupPeerConnection() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    remoteVideo.srcObject = null;
  }

  function showLoading(isVisible) {
    loadingOverlay.classList.toggle('visible', isVisible);
  }

  async function openFullscreen() {
    if (!remoteVideo.srcObject) {
      utils.showMessage(messageBox, 'Connect to a stream before opening fullscreen.', 'warning');
      return;
    }

    if (remoteVideo.requestFullscreen) {
      await remoteVideo.requestFullscreen();
    }
  }

  init();
})();
