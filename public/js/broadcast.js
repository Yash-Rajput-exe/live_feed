(function () {
  const socket = window.streamSocket;
  const utils = window.StreamUtils;
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

  const localVideo = document.querySelector('#localVideo');
  const startButton = document.querySelector('#startStream');
  const stopButton = document.querySelector('#stopStream');
  const copyButton = document.querySelector('#copyCode');
  const streamCodeElement = document.querySelector('#streamCode');
  const statusBadge = document.querySelector('#statusBadge');
  const viewerCountElement = document.querySelector('#viewerCount');
  const viewerStateElement = document.querySelector('#viewerState');
  const networkBadge = document.querySelector('#networkBadge');
  const cameraSelect = document.querySelector('#cameraSelect');
  const microphoneSelect = document.querySelector('#microphoneSelect');
  const messageBox = document.querySelector('#messageBox');

  let localStream = null;
  let streamCode = null;
  const peerConnections = new Map();

  async function init() {
    if (!socket) {
      utils.setStatus(statusBadge, 'Offline', 'danger');
      utils.showMessage(messageBox, 'Cannot connect to server. Please run the server ("npm run dev" or "npm start") and access this page via localhost.', 'danger');
      startButton.disabled = true;
      return;
    }
    bindEvents();
    utils.updateNetworkBadge(networkBadge);
    await refreshDevices();
  }

  function bindEvents() {
    startButton.addEventListener('click', startStream);
    stopButton.addEventListener('click', stopStream);
    copyButton.addEventListener('click', copyCode);
    cameraSelect.addEventListener('change', switchDevices);
    microphoneSelect.addEventListener('change', switchDevices);

    window.addEventListener('online', () => utils.updateNetworkBadge(networkBadge));
    window.addEventListener('offline', () => utils.updateNetworkBadge(networkBadge));
    window.addEventListener('beforeunload', () => {
      if (streamCode) {
        socket.emit('stream:stop');
      }
    });

    socket.on('connect', () => {
      utils.showMessage(messageBox, '', 'neutral');
    });

    socket.on('disconnect', () => {
      utils.setStatus(statusBadge, 'Signaling disconnected', 'danger');
    });

    socket.on('viewer:joined', async ({ viewerId, viewerCount }) => {
      updateViewerCount(viewerCount);
      await createOfferForViewer(viewerId);
    });

    socket.on('viewer:left', ({ viewerId, viewerCount }) => {
      closePeerConnection(viewerId);
      updateViewerCount(viewerCount);
    });

    socket.on('stream:viewer-count', ({ viewerCount }) => {
      updateViewerCount(viewerCount);
    });

    socket.on('webrtc:answer', async ({ viewerId, answer }) => {
      const peerConnection = peerConnections.get(viewerId);

      if (!peerConnection) {
        return;
      }

      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        utils.showMessage(messageBox, `Could not complete viewer connection: ${error.message}`, 'danger');
      }
    });

    socket.on('webrtc:ice-candidate', async ({ fromId, candidate }) => {
      const peerConnection = peerConnections.get(fromId);

      if (!peerConnection || !candidate) {
        return;
      }

      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.warn('Failed to add viewer ICE candidate', error);
      }
    });

    socket.on('connection:state', ({ state }) => {
      if (state === 'failed' || state === 'disconnected') {
        utils.showMessage(messageBox, 'A viewer connection became unstable. Waiting for reconnection.', 'warning');
      }
    });

    socket.on('stream:error', ({ message }) => {
      utils.showMessage(messageBox, message, 'danger');
    });
  }

  async function startStream() {
    try {
      startButton.disabled = true;
      utils.showMessage(messageBox, 'Opening camera...', 'neutral');
      await ensureLocalStream();

      socket.emit('stream:create', ({ ok, code, message, viewerCount }) => {
        if (!ok) {
          startButton.disabled = false;
          utils.showMessage(messageBox, message || 'Could not create stream.', 'danger');
          return;
        }

        streamCode = code;
        document.body.classList.add('is-streaming');
        utils.setText(streamCodeElement, code);
        utils.setStatus(statusBadge, 'LIVE', 'good');
        utils.showMessage(messageBox, 'Stream is live. Share the code with viewers.', 'good');
        updateViewerCount(viewerCount || 0);
        startButton.hidden = true;
        stopButton.hidden = false;
        copyButton.disabled = false;
      });
    } catch (error) {
      startButton.disabled = false;
      utils.setStatus(statusBadge, 'Camera blocked', 'danger');
      utils.showMessage(messageBox, utils.formatPermissionError(error), 'danger');
    }
  }

  async function stopStream() {
    socket.emit('stream:stop');
    cleanup();
    utils.showMessage(messageBox, 'Stream stopped. The code is now invalid.', 'neutral');
  }

  async function ensureLocalStream() {
    if (localStream) {
      return localStream;
    }

    const videoDeviceId = cameraSelect.value;
    const audioDeviceId = microphoneSelect.value;
    const constraints = {
      video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
      audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
    await refreshDevices();
    return localStream;
  }

  async function refreshDevices() {
    try {
      const { cameras, microphones } = await utils.listMediaDevices();
      utils.populateDeviceSelect(cameraSelect, cameras, 'Camera');
      utils.populateDeviceSelect(microphoneSelect, microphones, 'Microphone');
    } catch (error) {
      console.warn('Could not list devices', error);
    }
  }

  async function switchDevices() {
    if (!localStream) {
      return;
    }

    try {
      const oldStream = localStream;
      localStream = null;
      const newStream = await ensureLocalStream();

      oldStream.getTracks().forEach((track) => track.stop());

      for (const peerConnection of peerConnections.values()) {
        for (const track of newStream.getTracks()) {
          const sender = peerConnection.getSenders().find((item) => item.track?.kind === track.kind);

          if (sender) {
            await sender.replaceTrack(track);
          }
        }
      }

      utils.showMessage(messageBox, 'Camera or microphone updated.', 'good');
    } catch (error) {
      utils.showMessage(messageBox, utils.formatPermissionError(error), 'danger');
    }
  }

  async function createOfferForViewer(viewerId) {
    if (!localStream) {
      return;
    }

    closePeerConnection(viewerId);

    const peerConnection = new RTCPeerConnection({ iceServers });
    peerConnections.set(viewerId, peerConnection);

    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socket.emit('webrtc:ice-candidate', {
          targetId: viewerId,
          candidate
        });
      }
    };

    peerConnection.onconnectionstatechange = async () => {
      const state = peerConnection.connectionState;
      socket.emit('connection:state', { targetId: viewerId, state });

      if (state === 'failed') {
        try {
          peerConnection.restartIce();
          const offer = await peerConnection.createOffer({ iceRestart: true });
          await peerConnection.setLocalDescription(offer);
          socket.emit('webrtc:offer', { viewerId, offer });
        } catch (error) {
          utils.showMessage(messageBox, `Reconnection failed for a viewer: ${error.message}`, 'danger');
        }
      }
    };

    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('webrtc:offer', { viewerId, offer });
    } catch (error) {
      closePeerConnection(viewerId);
      utils.showMessage(messageBox, `Could not create viewer connection: ${error.message}`, 'danger');
    }
  }

  function closePeerConnection(viewerId) {
    const peerConnection = peerConnections.get(viewerId);

    if (peerConnection) {
      peerConnection.close();
      peerConnections.delete(viewerId);
    }
  }

  function updateViewerCount(count) {
    const safeCount = Number(count || 0);
    utils.setText(viewerCountElement, String(safeCount));
    utils.setText(viewerStateElement, safeCount > 0 ? 'Viewers connected' : 'Waiting For Viewers');
  }

  async function copyCode() {
    try {
      await utils.copyText(streamCode);
      utils.showMessage(messageBox, 'Stream code copied.', 'good');
    } catch (error) {
      utils.showMessage(messageBox, 'Could not copy the stream code.', 'danger');
    }
  }

  function cleanup() {
    for (const viewerId of peerConnections.keys()) {
      closePeerConnection(viewerId);
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
      localVideo.srcObject = null;
    }

    streamCode = null;
    document.body.classList.remove('is-streaming');
    utils.setText(streamCodeElement, '------');
    utils.setStatus(statusBadge, 'Offline', 'neutral');
    updateViewerCount(0);
    startButton.hidden = false;
    startButton.disabled = false;
    stopButton.hidden = true;
    copyButton.disabled = true;
  }

  init();
})();
