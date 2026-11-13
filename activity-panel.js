// Demo panel that shows every WebMCP tool call the AI agent makes on this page.
// Load it before the Fundraise Up embed script: it wraps document.modelContext.registerTool,
// so tools registered later (by embed and by the checkout) report their calls here.
// It also shows Fundraise Up tracking events: it sets the fundraiseup_debug cookie, so embed logs every
// event to window.FUN_DEBUG_LOGS, and renders them next to the tool calls. Click an item to see its data.
// ?panel=off hides the panel; ?tracking=off skips tracking events; window.__fruActivity keeps the raw log.
(() => {
  const modelContext = document.modelContext;
  const params = new URLSearchParams(location.search);
  const isHidden = params.get('panel') === 'off';
  const showTracking = params.get('tracking') !== 'off';
  window.__fruActivity = [];

  const panel = document.createElement('aside');
  panel.id = 'fru-agent-activity';
  panel.innerHTML = `
    <header>
      <span class="dot"></span>
      <strong>AI agent activity</strong>
      <span class="sub">WebMCP tools on this page</span>
      <button type="button" class="collapse" aria-label="Collapse">–</button>
    </header>
    <nav class="filters">
      <button type="button" data-filter="all" class="active">All</button>
      <button type="button" data-filter="key">Key events</button>
      <button type="button" data-filter="agent">Agent</button>
      <button type="button" data-filter="tracking">Tracking</button>
    </nav>
    <ol></ol>
    <footer></footer>`;

  const style = document.createElement('style');
  style.textContent = `
    #fru-agent-activity { position: fixed; top: 16px; left: 16px; bottom: 16px; width: 340px; z-index: 2147483647;
      display: flex; flex-direction: column; background: #fff; color: #111827; border-radius: 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,.28); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow: hidden; }
    #fru-agent-activity.collapsed { bottom: auto; }
    #fru-agent-activity.collapsed ol, #fru-agent-activity.collapsed footer, #fru-agent-activity.collapsed .filters { display: none; }
    #fru-agent-activity .filters { display: flex; gap: 6px; padding: 8px 12px 0; }
    #fru-agent-activity .filters button { font: 12px/1 inherit; padding: 5px 10px; border-radius: 999px; border: 1px solid #e5e7eb;
      background: #fff; color: #374151; cursor: pointer; }
    #fru-agent-activity .filters button.active { background: #111827; border-color: #111827; color: #f9fafb; }
    #fru-agent-activity ol.only-key li.track:not(.key), #fru-agent-activity ol.only-agent li.track, #fru-agent-activity ol.only-tracking li:not(.track) { display: none; }
    #fru-agent-activity li.track { background: #f5f3ff; font: 12px/1.4 ui-monospace, Menlo, monospace; }
    #fru-agent-activity li.track .badge { display: inline-block; margin-left: 4px; padding: 1px 6px; border-radius: 999px;
      background: #7c3aed; color: #fff; font-size: 11px; }
    #fru-agent-activity li.track .tag { display: inline-block; margin-left: 4px; padding: 1px 6px; border-radius: 999px;
      background: #e5e7eb; color: #374151; font-size: 11px; }
    #fru-agent-activity li.track.key { box-shadow: inset 3px 0 0 #7c3aed; }
    #fru-agent-activity details summary { cursor: pointer; list-style: none; }
    #fru-agent-activity details summary::-webkit-details-marker { display: none; }
    #fru-agent-activity details summary::before { content: '▸ '; opacity: .5; }
    #fru-agent-activity details[open] summary::before { content: '▾ '; }
    #fru-agent-activity details pre { margin: 6px 0 0; padding: 8px; max-height: 320px; overflow: auto; background: rgba(255,255,255,.7);
      border-radius: 6px; font: 11px/1.4 ui-monospace, Menlo, monospace; white-space: pre; }
    #fru-agent-activity header { display: grid; grid-template-columns: 12px 1fr auto; column-gap: 8px; align-items: center;
      padding: 12px 14px; background: #111827; color: #f9fafb; }
    #fru-agent-activity header .sub { grid-column: 2; font-size: 11px; opacity: .7; }
    #fru-agent-activity header button.collapse { grid-row: 1 / span 2; grid-column: 3; background: none; border: 0; color: inherit;
      font-size: 18px; cursor: pointer; }
    #fru-agent-activity .dot { grid-row: 1 / span 2; width: 10px; height: 10px; border-radius: 50%; background: #9ca3af; }
    #fru-agent-activity.live .dot { background: #22c55e; }
    #fru-agent-activity ol { flex: 1; margin: 0; padding: 12px; list-style: none; overflow-y: auto; display: flex;
      flex-direction: column; gap: 8px; }
    #fru-agent-activity li { padding: 8px 10px; border-radius: 10px; background: #f3f4f6; white-space: pre-wrap; word-break: break-word; }
    #fru-agent-activity li.call { background: #eef2ff; font: 12px/1.4 ui-monospace, Menlo, monospace; }
    #fru-agent-activity li.result { background: #ecfdf5; font: 12px/1.4 ui-monospace, Menlo, monospace; }
    #fru-agent-activity li.result.warn { background: #fffbeb; }
    #fru-agent-activity li.result.fail { background: #fef2f2; }
    #fru-agent-activity li.message::before { content: 'Text for the donor'; display: block; font-size: 10px; opacity: .6; margin-bottom: 2px; }
    #fru-agent-activity footer { padding: 8px 14px; font-size: 11px; color: #6b7280; border-top: 1px solid #e5e7eb; }`;

  const list = panel.querySelector('ol');
  const footer = panel.querySelector('footer');

  const toJson = value => {
    const seen = new WeakSet();
    try {
      return JSON.stringify(
        value,
        (_, item) => {
          if (item && typeof item === 'object') {
            if (seen.has(item)) {
              return '[circular]';
            }
            seen.add(item);
          }
          return item;
        },
        2
      );
    } catch (error) {
      return String(error);
    }
  };

  const KEY_EVENTS = ['pageView', 'elementOpenCheckout', 'checkoutView', 'donationComplete'];

  const add = (kind, text, data, badge, tags = []) => {
    const isPinnedToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const item = document.createElement('li');
    item.className = kind;
    if (data === undefined) {
      item.textContent = text;
    } else {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = text;
      if (badge) {
        const label = document.createElement('span');
        label.className = 'badge';
        label.textContent = badge;
        summary.append(label);
      }
      tags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = `#${tag}`;
        summary.append(chip);
      });
      const body = document.createElement('pre');
      details.addEventListener('toggle', () => {
        if (details.open && !body.textContent) {
          body.textContent = toJson(data);
        }
      });
      details.append(summary, body);
      item.append(details);
    }
    list.append(item);
    if (isPinnedToBottom) {
      list.scrollTop = list.scrollHeight;
    }
    bringToFront();
  };

  const addTrackingEvent = ({ name, content }) => {
    if (!/(^|:)Tracking:/.test(name)) {
      return;
    }
    const payload = Array.isArray(content) ? content[0] : content;
    const eventName = name.replace(/^.*Tracking:/, '');
    window.__fruActivity.push({ tracking: eventName, payload });
    const isKey = KEY_EVENTS.includes(eventName) || payload?.customEventType === 'webmcpToolCall';
    const tags = Array.isArray(payload?.eventTags) ? payload.eventTags : [];
    const { eventType, customEventType, customEventData, elementType, elementKey, widgetKey } = payload ?? {};
    const shown = { eventType, eventTags: tags, customEventType, customEventData, elementType, elementKey, widgetKey, ...payload };
    add(isKey ? 'track key' : 'track', `📊 ${eventName}`, shown, customEventType, tags);
  };

  if (showTracking) {
    if (!/(^|; )fundraiseup_debug=/.test(document.cookie)) {
      document.cookie = 'fundraiseup_debug=1; path=/; max-age=86400; SameSite=Lax';
    }
    const debugLogs = [];
    debugLogs.push = (...items) => {
      items.forEach(item => {
        try {
          addTrackingEvent(item);
        } catch (error) {
          console.warn(error);
        }
      });
      return Array.prototype.push.apply(debugLogs, items);
    };
    window.FUN_DEBUG_LOGS = debugLogs;
  }

  const bringToFront = () => {
    if (!isHidden && document.body && document.body.lastElementChild !== panel) {
      document.body.append(panel);
    }
  };

  const formatInput = input => {
    const entries = Object.entries(input || {});
    return entries.length ? JSON.stringify(Object.fromEntries(entries)) : '{}';
  };

  const parseResult = result => {
    const text = typeof result === 'string' ? result : result?.content?.[0]?.text;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  };

  const describeResult = response => {
    const parts = [response.status];
    if (response.step) {
      parts.push(`step ${response.step}`);
    }
    if (response.campaign) {
      parts.push(`campaign "${response.campaign.title}"`);
    }
    if (response.donation?.amount != null) {
      const { amount, currency, frequency, feeCovered, total } = response.donation;
      parts.push(`${amount} ${currency} ${frequency}${feeCovered ? `, fee covered, total ${total}` : ''}`);
    }
    if (response.campaigns?.length) {
      parts.push(`choose: ${response.campaigns.map(campaign => campaign.title).join(' / ')}`);
    }
    if (response.alternatives?.length) {
      parts.push(`also on page: ${response.alternatives.map(campaign => campaign.title).join(' / ')}`);
    }
    if (response.questions?.length) {
      parts.push(`asks: ${response.questions.map(question => question.field).join(', ')}`);
    }
    if (response.rejected?.length) {
      parts.push(`rejected: ${response.rejected.map(item => item.field).join(', ')}`);
    }
    if (response.donorAction) {
      parts.push(`donor action: ${response.donorAction}`);
    }
    return parts.join(' · ');
  };

  const resultKind = status => {
    if (['ok', 'navigating'].includes(status)) {
      return 'result';
    }
    if (['error', 'timeout', 'blocked'].includes(status)) {
      return 'result fail';
    }
    return 'result warn';
  };

  const wrapTool = tool => ({
    ...tool,
    execute: async (input, client) => {
      const startedAt = performance.now();
      add('call', `→ ${tool.name} ${formatInput(input)}`, input);
      const result = await tool.execute(input, client);
      const response = parseResult(result);
      const durationMs = Math.round(performance.now() - startedAt);
      window.__fruActivity.push({ tool: tool.name, input, response, durationMs });
      if (response) {
        add(resultKind(response.status), `← ${describeResult(response)} · ${durationMs} ms`, response);
        if (response.donorMessage) {
          add('message', response.donorMessage);
        }
      }
      return result;
    },
  });

  if (!modelContext || typeof modelContext.registerTool !== 'function') {
    footer.textContent = 'This browser has no WebMCP (document.modelContext).';
  } else {
    const registerTool = modelContext.registerTool.bind(modelContext);
    modelContext.registerTool = (tool, options) => registerTool(wrapTool(tool), options);
    footer.textContent = 'Waiting for the agent to call a tool…';
    const refreshTools = async () => {
      const tools = (await modelContext.getTools?.()) || [];
      panel.classList.toggle('live', tools.length > 0);
      footer.textContent = tools.length
        ? `Tools available: ${tools.map(item => item.name).join(', ')}`
        : 'No tools registered on this page.';
    };
    setInterval(refreshTools, 1000);
  }

  panel.querySelector('button.collapse').addEventListener('click', () => panel.classList.toggle('collapsed'));
  panel.querySelectorAll('.filters button').forEach(button =>
    button.addEventListener('click', () => {
      panel.querySelectorAll('.filters button').forEach(other => other.classList.toggle('active', other === button));
      list.classList.toggle('only-key', button.dataset.filter === 'key');
      list.classList.toggle('only-agent', button.dataset.filter === 'agent');
      list.classList.toggle('only-tracking', button.dataset.filter === 'tracking');
    })
  );

  const mount = () => {
    if (isHidden) {
      return;
    }
    document.head.append(style);
    document.body.append(panel);
    new MutationObserver(bringToFront).observe(document.body, { childList: true });
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
})();
