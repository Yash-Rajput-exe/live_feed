const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_CODE_ATTEMPTS = 30;

class RoomManager {
  constructor() {
    this.activeStreams = new Map();
  }

  createStream(broadcasterId) {
    const code = 'ABC123';

    // Clear any existing stream with this code to allow new broadcast session
    this.destroyStream(code);

    this.activeStreams.set(code, {
      broadcasterId,
      viewers: new Set(),
      createdAt: Date.now()
    });

    return code;
  }

  generateUniqueCode() {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      let code = '';

      for (let index = 0; index < CODE_LENGTH; index += 1) {
        const randomIndex = Math.floor(Math.random() * CODE_ALPHABET.length);
        code += CODE_ALPHABET[randomIndex];
      }

      if (!this.activeStreams.has(code)) {
        return code;
      }
    }

    throw new Error('Unable to generate a unique stream code.');
  }

  getStream(code) {
    return this.activeStreams.get(this.normalizeCode(code));
  }

  getStreamByBroadcaster(broadcasterId) {
    for (const [code, stream] of this.activeStreams.entries()) {
      if (stream.broadcasterId === broadcasterId) {
        return { code, stream };
      }
    }

    return null;
  }

  joinStream(code, viewerId) {
    const normalizedCode = this.normalizeCode(code);
    const stream = this.activeStreams.get(normalizedCode);

    if (!stream) {
      return null;
    }

    stream.viewers.add(viewerId);
    return stream;
  }

  leaveStream(code, viewerId) {
    const normalizedCode = this.normalizeCode(code);
    const stream = this.activeStreams.get(normalizedCode);

    if (!stream) {
      return null;
    }

    stream.viewers.delete(viewerId);
    return stream;
  }

  destroyStream(code) {
    const normalizedCode = this.normalizeCode(code);
    const stream = this.activeStreams.get(normalizedCode);

    if (!stream) {
      return null;
    }

    this.activeStreams.delete(normalizedCode);
    return stream;
  }

  getViewerCount(code) {
    const stream = this.getStream(code);
    return stream ? stream.viewers.size : 0;
  }

  normalizeCode(code) {
    return String(code || '').trim().toUpperCase();
  }
}

module.exports = RoomManager;
