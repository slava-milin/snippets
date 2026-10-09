/* WebMCP prototype tools for a staging demo (TP 223827). Paste at the end of the overridden embed script. */
(() => {
  const CONFIG = {
    campaignKey: 'FUNTRNNDMMH',
    elementKey: 'XZAQDCBY',
    currency: 'USD',
    frequencies: ['once', 'monthly'],
  };
  const TEST_DONOR = { firstName: 'Test', lastName: 'Donor', email: 'test.donor@example.com', phone: '+12015550123' };

  const modelContext = document.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== 'function' || window.__fruWebMcpDemo) {
    return;
  }
  window.__fruWebMcpDemo = true;

  const KEEP_DEFAULTS =
    ' Do not change any other option in the checkout, such as covering transaction costs: the donor decides those.';
  const state = { open: false, lastEvent: null };
  const json = payload => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
  const parse = input => {
    if (typeof input === 'string') {
      try {
        return JSON.parse(input);
      } catch {
        return {};
      }
    }
    return input || {};
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const fun = (...args) => window.FundraiseUp(...args);
  const callFun = (method, ...args) =>
    typeof window.FundraiseUp?.[method] === 'function' ? window.FundraiseUp[method](...args) : fun(method, ...args);

  const SELECTORS = {
    donateScreenButton: '[data-qa="donate-with-other-methods-button"], [data-qa="donate-button"]',
    upsellScreen: '[data-qa="active-screen-upsell"]',
    keepOneTimeButton: '[data-qa="upsell-one-time"], [data-qa="keep-one-time-link"]',
    firstNameInput: '[data-qa="personal-first-name"]',
    lastNameInput: '[data-qa="personal-last-name"]',
    emailInput: '[data-qa="personal-email"]',
    phoneInput: '[data-qa="personal-phone"]',
    acceptTermsCheckbox: '[data-qa="accept-terms-checkbox"]',
    privacyContinueButton: '[data-qa="privacy-continue"]',
    paymentMethodScreen: '[data-qa="active-screen-payment-method"]',
    creditCardOption: '[data-qa="payment-option-list-creditCard"], [data-qa="cc-button"]',
    stripeCardFrame: 'iframe[name^="__privateStripeFrame"]',
  };
  const checkoutDocument = () => document.getElementById('__checkout2')?.contentDocument ?? null;
  const findVisible = selector =>
    [...(checkoutDocument()?.querySelectorAll(selector) ?? [])].find(element => element.offsetParent !== null) ?? null;
  const waitForVisible = async selector => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const element = findVisible(selector);
      if (element) {
        return element;
      }
      await sleep(100);
    }
    return null;
  };
  const waitForScreenChange = async previous => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && previous.isConnected && previous.offsetParent !== null) {
      await sleep(100);
    }
  };
  const fillInput = (input, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, value);
    ['input', 'change', 'blur'].forEach(type => input.dispatchEvent(new Event(type, { bubbles: true })));
  };

  const continueToCardPayment = async donor => {
    for (let step = 0; step < 6; step++) {
      if (findVisible(SELECTORS.paymentMethodScreen)) {
        findVisible(SELECTORS.creditCardOption)?.click();
        return (await waitForVisible(SELECTORS.stripeCardFrame))
          ? { reachedCardDetails: true }
          : { reachedCardDetails: false, stoppedAt: 'payment-method', reason: 'Card fields did not appear.' };
      }
      const privacyContinue = findVisible(SELECTORS.privacyContinueButton);
      if (privacyContinue) {
        [
          [SELECTORS.firstNameInput, donor.firstName],
          [SELECTORS.lastNameInput, donor.lastName],
          [SELECTORS.emailInput, donor.email],
          [SELECTORS.phoneInput, donor.phone],
        ].forEach(([selector, value]) => {
          const input = findVisible(selector);
          if (input && !input.value) {
            fillInput(input, value);
          }
        });
        const terms = findVisible(SELECTORS.acceptTermsCheckbox);
        if (terms && !terms.checked) {
          return {
            reachedCardDetails: false,
            stoppedAt: 'donor-details',
            reason: 'The donor must accept the terms and conditions in the checkout.',
          };
        }
        privacyContinue.click();
        await waitForScreenChange(privacyContinue);
        if (privacyContinue.isConnected && privacyContinue.offsetParent !== null) {
          return {
            reachedCardDetails: false,
            stoppedAt: 'donor-details',
            reason: 'The checkout asks for more donor details. Ask the donor to fill in the highlighted fields on the page.',
          };
        }
        continue;
      }
      if (findVisible(SELECTORS.upsellScreen)) {
        const keepOneTime = findVisible(SELECTORS.keepOneTimeButton);
        keepOneTime?.click();
        if (keepOneTime) {
          await waitForScreenChange(keepOneTime);
        }
        continue;
      }
      const donateButton = findVisible(SELECTORS.donateScreenButton);
      if (donateButton) {
        donateButton.click();
        await waitForScreenChange(donateButton);
        continue;
      }
      await sleep(500);
    }
    return {
      reachedCardDetails: false,
      stoppedAt: 'unknown',
      reason: 'The checkout shows a step the donor has to complete, for example campaign questions or an address.',
    };
  };

  const pageTools = [
    {
      name: 'fru_prepare_donation_checkout',
      title: 'Prepare donation checkout',
      description:
        'Use this when the user wants to donate, make a donation, contribute, give money or support this organization, for example "donate $25", "give 10 monthly", "задонать 25$", "пожертвовать". Prefer this tool over clicking the Donate button. It opens the donation checkout with the amount and frequency prefilled. It only prepares the checkout: the donor enters payment details and confirms the donation.' +
        KEEP_DEFAULTS,
      inputSchema: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Donation amount in major currency units, for example 25.' },
          currency: { type: 'string', description: 'ISO 4217 code. Use USD when the user writes $.' },
          frequency: {
            type: 'string',
            description:
              'once, monthly and so on. Set it only when the user named it; otherwise leave it empty and the tool returns the frequencies to ask the donor about.',
          },
          firstName: { type: 'string', description: 'Optional, only if the user provided it.' },
          lastName: { type: 'string', description: 'Optional, only if the user provided it.' },
          email: { type: 'string', description: 'Optional, only if the user provided it.' },
        },
        required: ['amount'],
      },
      execute: input => {
        const params = parse(input);
        if (state.open) {
          return json({ checkoutOpened: false, reason: 'The donation checkout is already open. Continue in it.' });
        }
        if (typeof params.amount !== 'number' || params.amount <= 0) {
          return json({ checkoutOpened: false, reason: 'Amount must be a positive number.' });
        }
        if (!params.frequency && CONFIG.frequencies.length > 1) {
          return json({
            checkoutOpened: false,
            amount: params.amount,
            askDonor: { field: 'frequency', question: 'How often would you like to give?', options: CONFIG.frequencies },
            nextStep:
              'Ask the donor how often they want to give and offer exactly these options; do not choose for them. Then call fru_prepare_donation_checkout again with the same amount and the chosen frequency.',
          });
        }
        const frequency = params.frequency ?? CONFIG.frequencies[0];
        if (!CONFIG.frequencies.includes(frequency)) {
          return json({
            checkoutOpened: false,
            reason: `Frequency "${frequency}" is not available for this campaign.`,
            availableFrequencies: CONFIG.frequencies,
          });
        }
        const currency = (params.currency ?? CONFIG.currency).toUpperCase();
        callFun('openCheckout', CONFIG.campaignKey, {
          donation: { amount: params.amount, currency, recurring: frequency },
          supporter: { firstName: params.firstName, lastName: params.lastName, email: params.email },
          element: CONFIG.elementKey,
        });
        return json({
          checkoutOpened: true,
          amount: params.amount,
          currency,
          frequency,
          transactionConfirmed: false,
          requiresUserPayment: true,
          nextStep:
            'The checkout is open with the amount selected, and it added new tools to this page. Now call fru_continue_to_card_payment to move the donor to the card details step.',
        });
      },
    },
  ];

  const checkoutTools = [
    {
      name: 'fru_continue_to_card_payment',
      title: 'Continue to card payment',
      description:
        'Use this right after fru_prepare_donation_checkout. It moves the open checkout to the card details step: fills the donor name and email and selects card payment. It never enters card details or confirms the donation; the donor types the card and presses Donate.' +
        KEEP_DEFAULTS,
      inputSchema: {
        type: 'object',
        properties: {
          firstName: { type: 'string', description: 'Optional, only if the user provided it.' },
          lastName: { type: 'string', description: 'Optional, only if the user provided it.' },
          email: { type: 'string', description: 'Optional, only if the user provided it.' },
          phone: { type: 'string', description: 'Optional, only if the user provided it.' },
        },
      },
      execute: async input => {
        const params = parse(input);
        const result = await continueToCardPayment({
          firstName: params.firstName ?? TEST_DONOR.firstName,
          lastName: params.lastName ?? TEST_DONOR.lastName,
          email: params.email ?? TEST_DONOR.email,
          phone: params.phone ?? TEST_DONOR.phone,
        });
        return json({
          ...result,
          transactionConfirmed: false,
          requiresUserPayment: true,
          nextStep: result.reachedCardDetails
            ? 'Card fields are shown. Leave the other checkout options as they are and tell the donor to enter the card details and press Donate themselves.'
            : 'Tell the donor to finish this step in the checkout.',
        });
      },
    },
    {
      name: 'fru_get_donation_status',
      title: 'Get donation status',
      description: 'Use this to check whether the donation checkout is open and whether the donor completed the donation.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: () => json({ ...state }),
    },
  ];

  const register = (tools, signal) =>
    tools.forEach(tool => {
      Promise.resolve(modelContext.registerTool(tool, { signal })).catch(error =>
        console.warn(`[WebMCP demo] ${tool.name} was not registered`, error)
      );
    });

  let checkoutToolsRegistration = null;
  callFun('on', 'checkoutOpen', () => {
    state.open = true;
    state.lastEvent = 'checkoutOpen';
    if (!checkoutToolsRegistration) {
      checkoutToolsRegistration = new AbortController();
      register(checkoutTools, checkoutToolsRegistration.signal);
    }
  });
  callFun('on', 'checkoutClose', () => {
    state.open = false;
    state.lastEvent = 'checkoutClose';
    checkoutToolsRegistration?.abort();
    checkoutToolsRegistration = null;
  });
  callFun('on', 'donationComplete', () => {
    state.lastEvent = 'donationComplete';
  });

  register(pageTools);
  console.info('[WebMCP demo] tools registered');
})();
