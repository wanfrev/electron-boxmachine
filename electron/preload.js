const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onStateUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('state-update', handler);
    return () => ipcRenderer.removeListener('state-update', handler);
  },

  sendCoin: () => ipcRenderer.send('coin-input'),
  sendPunchReady: () => ipcRenderer.send('punch-ready'),
  sendPunch: (score) => ipcRenderer.send('punch-simulated', score),
  getState: () => ipcRenderer.invoke('get-state'),
});
