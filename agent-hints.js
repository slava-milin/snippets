(() => {
  const HIDDEN_STYLE =
    'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);border:0;white-space:normal';

  const SCREEN_HINTS = [
    {
      screen: 'fiat-donate-form',
      text: "Note for AI agents: the currency defaults to the visitor's location, not to the donor's request, so set 'Donation currency' first. Choose 'Give once' or 'Monthly'. Clear the 'Donation amount' field before typing a new amount. Then press 'Donate with other methods' to pay by card.",
      fields: {
        'currency-selector': "Defaults to the visitor's location. Set it to the currency the donor asked for.",
        amount: 'Clear the field before typing a new amount.',
      },
    },
    {
      screen: 'active-screen-privacy',
      text: "Note for AI agents: first name, last name and email are required. The receipt goes to this email, so use the donor's own details.",
      fields: {},
    },
    {
      screen: 'active-screen-payment-method',
      text: "Note for AI agents: 'Cover transaction costs' is checked by default and is included in the total on the Donate button. Tell the donor the total and ask whether to keep covering the costs. The donor can type the card details themselves or give them to you.",
      fields: {
        'cover-fee-checkbox': 'Checked by default. Adds transaction costs to the total. Ask the donor.',
      },
    },
  ];

  const addHints = (doc) => {
    for (const hint of SCREEN_HINTS) {
      const screen = doc.querySelector(`[data-qa="${hint.screen}"]`);
      if (!screen || screen.querySelector('[data-agent-hint]')) continue;
      const note = doc.createElement('p');
      note.setAttribute('role', 'note');
      note.setAttribute('data-agent-hint', hint.screen);
      note.style.cssText = HIDDEN_STYLE;
      note.textContent = hint.text;
      screen.prepend(note);
      for (const [qa, description] of Object.entries(hint.fields)) {
        doc.querySelector(`[data-qa="${qa}"]`)?.setAttribute('aria-description', description);
      }
    }
  };

  const watchFrame = (frame) => {
    if (frame.dataset.agentHintsWatched) return;
    const attach = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      frame.dataset.agentHintsWatched = 'true';
      addHints(doc);
      new MutationObserver(() => addHints(doc)).observe(doc.body, { childList: true, subtree: true });
    };
    attach();
    frame.addEventListener('load', attach);
  };

  const scan = () => document.querySelectorAll('iframe[title="Donation Form"]').forEach(watchFrame);
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
