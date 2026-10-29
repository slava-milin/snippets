(() => {
  const render = () => {
    const hasApi = Boolean(document.modelContext && typeof document.modelContext.registerTool === 'function');
    const hasTools = window.__fruWebMcpDemo === true;
    const status = document.createElement('p');
    status.id = 'webmcp-status';
    status.style.fontSize = '12px';
    status.textContent = `WebMCP API: ${hasApi ? 'available' : 'unavailable'} · site tools: ${hasTools ? 'registered' : 'none'}`;
    document.querySelector('main').append(status);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
