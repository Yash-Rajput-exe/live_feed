(function () {
  const socket = window.streamSocket;
  const utils = window.StreamUtils;
  const iceServers = [
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: '06913018a8acf7332fa6ca7d',
      credential: 'Y9GmhjwVvmdM6yy3'
    },
    {
      urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username: '06913018a8acf7332fa6ca7d',
      credential: 'Y9GmhjwVvmdM6yy3'
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username: '06913018a8acf7332fa6ca7d',
      credential: 'Y9GmhjwVvmdM6yy3'
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: '06913018a8acf7332fa6ca7d',
      credential: 'Y9GmhjwVvmdM6yy3'
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
    utils.setStatus(statusBadge, 'Connecting...', 'warning');
    utils.showMessage(messageBox, 'Connecting to the broadcaster...', 'neutral');
    showLoading(true);

    socket.emit('stream:join', { code }, ({ ok, message, broadcasterId: id }) => {
      connectButton.disabled = false;

      if (!ok) {
        currentCode = null;
        codeInput.disabled = false;
        utils.setStatus(statusBadge, 'Disconnected', 'danger');
        utils.showMessage(messageBox, message || 'Stream not found.', 'danger');
        showLoading(false);
        return;
      }

      broadcasterId = id;
      connectButton.hidden = true;
      disconnectButton.hidden = false;
      utils.showMessage(messageBox, 'Waiting for live video...', 'neutral');
    });
  }

  async function answerOffer(offer) {
    cleanupPeerConnection();

    peerConnection = new RTCPeerConnection({ iceServers });

    peerConnection.ontrack = ({ streams }) => {
      const [stream] = streams;

      if (stream) {
        remoteVideo.srcObject = stream;
        utils.setStatus(statusBadge, 'Connected', 'good');
        utils.showMessage(messageBox, 'Live feed connected.', 'good');
        showLoading(false);

        // Explicitly play the video and handle autoplay prevention
        remoteVideo.play().catch((error) => {
          console.warn("Autoplay prevented:", error);
          utils.showMessage(messageBox, 'Click the play button on the video player to start streaming.', 'warning');
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

      // 'disconnected' is a transient state that often self-heals with TURN relay.
      // Only show a soft warning - do NOT cover the playing video or trigger reconnect.
      if (state === 'disconnected') {
        utils.setStatus(statusBadge, 'Unstable', 'warning');
        utils.showMessage(messageBox, 'Connection momentarily unstable...', 'warning');
      }

      // Only fully reconnect on a hard 'failed' state
      if (state === 'failed') {
        utils.setStatus(statusBadge, 'Reconnecting...', 'warning');
        utils.showMessage(messageBox, 'Connection lost. Trying to reconnect...', 'warning');
        // Only show loading overlay if video is not already playing
        if (!remoteVideo.srcObject) {
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
    // Only show loading overlay if video is not already streaming
    if (!remoteVideo.srcObject) {
      showLoading(true);
    }

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;

      if (!currentCode) {
        return;
      }

      cleanupPeerConnection();
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
          showLoading(false);
          return;
        }

        broadcasterId = id;
        showLoading(true);
      });
    }, 1200);
  }

  function disconnectFromStream() {
    socket.emit('stream:leave');
    cleanupPeerConnection();
    currentCode = null;
    broadcasterId = null;
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
    loadingOverlay.hidden = !isVisible;
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
