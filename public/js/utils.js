(function () {
  const CODE_PATTERN = /^[A-Z0-9]{6}$/;

  function setText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function setStatus(element, value, tone) {
    if (!element) {
      return;
    }

    element.textContent = value;
    element.dataset.tone = tone || 'neutral';
  }

  function showMessage(element, value, tone) {
    if (!element) {
      return;
    }

    element.textContent = value || '';
    element.dataset.tone = tone || 'neutral';
    element.hidden = !value;
  }

  function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
  }

  function isValidCode(value) {
    return CODE_PATTERN.test(normalizeCode(value));
  }

  async function copyText(value) {
    if (!value) {
      return false;
    }

    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(input);
    return copied;
  }

  async function listMediaDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return { cameras: [], microphones: [] };
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      cameras: devices.filter((device) => device.kind === 'videoinput'),
      microphones: devices.filter((device) => device.kind === 'audioinput')
    };
  }

  function populateDeviceSelect(select, devices, fallbackLabel) {
    if (!select) {
      return;
    }

    const previousValue = select.value;
    select.innerHTML = '';

    if (!devices.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = fallbackLabel;
      select.appendChild(option);
      return;
    }

    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
      select.appendChild(option);
    });

    if (previousValue && devices.some((device) => device.deviceId === previousValue)) {
      select.value = previousValue;
    }
  }

  function formatPermissionError(error) {
    if (!error) {
      return 'Unable to open camera or microphone.';
    }

    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return 'Camera or microphone permission was denied. Allow access and try again.';
    }

    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'No camera or microphone was found on this device.';
    }

    if (error.name === 'NotReadableError') {
      return 'Your camera or microphone is already in use by another app.';
    }

    return error.message || 'Unable to open camera or microphone.';
  }

  function updateNetworkBadge(element) {
    if (!element) {
      return;
    }

    setStatus(element, navigator.onLine ? 'Online' : 'Offline', navigator.onLine ? 'good' : 'danger');
  }

  window.StreamUtils = {
    setText,
    setStatus,
    showMessage,
    normalizeCode,
    isValidCode,
    copyText,
    listMediaDevices,
    populateDeviceSelect,
    formatPermissionError,
    updateNetworkBadge
  };
})();
