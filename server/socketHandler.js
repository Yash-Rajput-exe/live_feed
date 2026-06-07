const RoomManager = require('./roomManager');

const roomManager = new RoomManager();

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.emit('server:ready', { socketId: socket.id });

    socket.on('stream:create', (callback) => {
      try {
        const existingStream = roomManager.getStreamByBroadcaster(socket.id);

        if (existingStream) {
          callback?.({
            ok: true,
            code: existingStream.code,
            viewerCount: existingStream.stream.viewers.size
          });
          return;
        }

        const code = roomManager.createStream(socket.id);
        socket.data.role = 'broadcaster';
        socket.data.streamCode = code;
        socket.join(code);

        callback?.({ ok: true, code, viewerCount: 0 });
      } catch (error) {
        callback?.({ ok: false, message: error.message });
      }
    });

    socket.on('stream:join', ({ code }, callback) => {
      const normalizedCode = roomManager.normalizeCode(code);
      const stream = roomManager.joinStream(normalizedCode, socket.id);

      if (!stream) {
        callback?.({ ok: false, message: 'Stream not found. Check the code and try again.' });
        return;
      }

      socket.data.role = 'viewer';
      socket.data.streamCode = normalizedCode;
      socket.join(normalizedCode);

      const viewerCount = stream.viewers.size;
      callback?.({
        ok: true,
        code: normalizedCode,
        broadcasterId: stream.broadcasterId,
        viewerCount
      });

      io.to(stream.broadcasterId).emit('viewer:joined', {
        viewerId: socket.id,
        viewerCount
      });
      io.to(normalizedCode).emit('stream:viewer-count', { viewerCount });
    });

    socket.on('stream:leave', (callback) => {
      leaveViewer(io, socket);
      callback?.({ ok: true });
    });

    socket.on('stream:stop', (callback) => {
      destroyBroadcasterStream(io, socket);
      callback?.({ ok: true });
    });

    socket.on('webrtc:offer', ({ viewerId, offer }) => {
      const code = socket.data.streamCode;
      const stream = roomManager.getStream(code);

      if (!stream || stream.broadcasterId !== socket.id || !stream.viewers.has(viewerId)) {
        socket.emit('stream:error', { message: 'Unable to send offer. Viewer is no longer connected.' });
        return;
      }

      io.to(viewerId).emit('webrtc:offer', {
        broadcasterId: socket.id,
        offer
      });
    });

    socket.on('webrtc:answer', ({ broadcasterId, answer }) => {
      const code = socket.data.streamCode;
      const stream = roomManager.getStream(code);

      if (!stream || stream.broadcasterId !== broadcasterId || !stream.viewers.has(socket.id)) {
        socket.emit('stream:error', { message: 'Unable to send answer. Stream is no longer available.' });
        return;
      }

      io.to(broadcasterId).emit('webrtc:answer', {
        viewerId: socket.id,
        answer
      });
    });

    socket.on('webrtc:ice-candidate', ({ targetId, candidate }) => {
      if (!targetId || !candidate) {
        return;
      }

      io.to(targetId).emit('webrtc:ice-candidate', {
        fromId: socket.id,
        candidate
      });
    });

    socket.on('connection:state', ({ targetId, state }) => {
      if (!targetId || !state) {
        return;
      }

      io.to(targetId).emit('connection:state', {
        fromId: socket.id,
        state
      });
    });

    socket.on('disconnect', () => {
      if (socket.data.role === 'broadcaster') {
        destroyBroadcasterStream(io, socket);
        return;
      }

      if (socket.data.role === 'viewer') {
        leaveViewer(io, socket);
      }
    });
  });
}

function leaveViewer(io, socket) {
  const code = socket.data.streamCode;

  if (!code) {
    return;
  }

  const stream = roomManager.leaveStream(code, socket.id);
  socket.leave(code);
  socket.data.role = null;
  socket.data.streamCode = null;

  if (!stream) {
    return;
  }

  const viewerCount = stream.viewers.size;
  io.to(stream.broadcasterId).emit('viewer:left', {
    viewerId: socket.id,
    viewerCount
  });
  io.to(code).emit('stream:viewer-count', { viewerCount });
}

function destroyBroadcasterStream(io, socket) {
  const ownedStream = roomManager.getStreamByBroadcaster(socket.id);

  if (!ownedStream) {
    return;
  }

  const { code, stream } = ownedStream;
  roomManager.destroyStream(code);

  io.to(code).emit('stream:ended', {
    code,
    message: 'The broadcaster ended the stream.'
  });

  for (const viewerId of stream.viewers) {
    const viewerSocket = io.sockets.sockets.get(viewerId);

    if (viewerSocket) {
      viewerSocket.leave(code);
      viewerSocket.data.role = null;
      viewerSocket.data.streamCode = null;
    }
  }

  socket.leave(code);
  socket.data.role = null;
  socket.data.streamCode = null;
}

module.exports = registerSocketHandlers;
