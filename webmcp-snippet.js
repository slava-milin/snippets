/* WebMCP prototype tools for a staging demo (TP 223827). Paste at the end of the overridden embed script.
 *
 * One-shot flow (WebMCP concept): the donor says "Donate $25 once", the agent calls fru_start_donation,
 * the checkout is opened, routine steps are handled, and the agent reports what is still needed.
 * Only two things cannot be done by the page: typing the card (Stripe iframes) and the donor's final go-ahead.
 */
(() => {
  const CONFIG = {
    campaignKey: 'FUNTRNNDMMH',
    elementKey: 'XZAQDCBY',
    currency: 'USD',
    frequencies: ['once', 'monthly'],
    suggestedAmounts: [1000, 500, 300, 120, 55, 25],
    paymentMethods: ['card', 'googlePay'],
  };

  const modelContext = document.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== 'function' || window.__fruWebMcpDemo) {
    return;
  }
  window.__fruWebMcpDemo = true;

  const KEEP_DEFAULTS =
    ' Never change checkout options the donor did not ask for (currency, frequency, covering transaction costs).';
  const CARD_NOTE =
    'Card number, expiration and CVC live in Stripe iframes and can only be typed by the donor in the checkout on this page.';

  const state = { open: false, lastEvent: null, donation: null, submitting: false, lastError: null, session: null };
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
  const clean = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

  const SELECTORS = {
    activeScreen: '[data-qa^="active-screen-"]',
    donateScreenButton: '[data-qa="donate-with-other-methods-button"], [data-qa="donate-button"]',
    upsellScreen: '[data-qa="active-screen-upsell"]',
    keepOneTimeButton: '[data-qa="upsell-one-time"], [data-qa="keep-one-time-link"]',
    privacyScreen: '[data-qa="active-screen-privacy"]',
    privacyContinueButton: '[data-qa="privacy-continue"]',
    acceptTermsCheckbox: '[data-qa="accept-terms-checkbox"]',
    paymentMethodScreen: '[data-qa="active-screen-payment-method"]',
    creditCardOption: '[data-qa="payment-option-list-creditCard"], [data-qa="cc-button"]',
    cardBlock: '[data-qa="payment-information-block"]',
    cardHosts: '[data-qa="payment-information-block"] .StripeElement',
    stripeCardFrame: 'iframe[name^="__privateStripeFrame"]',
    coverFeeCheckbox: '[data-qa="cover-fee-checkbox"]',
    totalLabel: '[data-qa="donation-amount-label"]',
    donateButton: '[data-qa="cc-button"]',
    donateButtonError: '[data-qa="cc-button-error-icon"]',
    closeButton: '[data-qa="global-close"]',
    invalidField: '[aria-invalid="true"]',
    errorTooltipTrigger: '[data-qa$="tooltip-error-trigger"]',
    tooltipContent: '.ui-tooltip-content, [role="tooltip"]',
    alert: '[role="alert"]',
  };
  const DONOR_FIELDS = [
    ['firstName', '[data-qa="personal-first-name"]', 'First name'],
    ['lastName', '[data-qa="personal-last-name"]', 'Last name'],
    ['email', '[data-qa="personal-email"]', 'Email address'],
    ['phone', '[data-qa="personal-phone"]', 'Phone number'],
  ];

  const checkoutDocument = () => document.getElementById('__checkout2')?.contentDocument ?? null;
  const isCheckoutVisible = () => {
    const frame = document.getElementById('__checkout2');
    return Boolean(frame && frame.getBoundingClientRect().width > 0 && getComputedStyle(frame).visibility !== 'hidden');
  };
  const isVisible = element => Boolean(element && element.offsetParent !== null);
  const findVisible = selector => [...(checkoutDocument()?.querySelectorAll(selector) ?? [])].find(isVisible) ?? null;
  const findAllVisible = selector => [...(checkoutDocument()?.querySelectorAll(selector) ?? [])].filter(isVisible);
  const waitFor = async (predicate, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) {
        return value;
      }
      await sleep(100);
    }
    return null;
  };
  const waitForScreenChange = previous => waitFor(() => !previous.isConnected || !isVisible(previous), 8000);
  const fillInput = (input, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, value);
    ['input', 'change', 'blur'].forEach(type => input.dispatchEvent(new Event(type, { bubbles: true })));
  };
  const text = element => element?.textContent?.replace(/\s+/g, ' ').trim() || '';

  const fieldError = input => {
    const doc = checkoutDocument();
    const described = input.getAttribute('aria-describedby');
    const message = described && text(doc?.getElementById(described));
    if (message) {
      return message;
    }
    const trigger = input.parentElement?.querySelector(SELECTORS.errorTooltipTrigger);
    if (trigger) {
      trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      const tooltip = findVisible(SELECTORS.tooltipContent);
      const tip = text(tooltip);
      trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      if (tip) {
        return tip;
      }
    }
    return 'This value was not accepted by the checkout.';
  };

  const collectDonorInput = () => {
    const needs = [];
    for (const [field, selector, label] of DONOR_FIELDS) {
      const input = findVisible(selector);
      if (!input) {
        continue;
      }
      if (!input.value) {
        needs.push({ field, label, message: `${label} is required.` });
      } else if (input.getAttribute('aria-invalid') === 'true' || input.classList.contains('has-error')) {
        needs.push({ field, label, message: fieldError(input), rejectedValue: input.value });
      }
    }
    const terms = findVisible(SELECTORS.acceptTermsCheckbox);
    if (terms && !terms.checked) {
      needs.push({ field: 'terms', label: 'Terms and conditions', message: 'The donor must accept the terms in the checkout.' });
    }
    return needs;
  };

  const cardStatus = () => {
    const hosts = findAllVisible(SELECTORS.cardHosts);
    if (!hosts.length) {
      return { shown: false, complete: false };
    }
    const complete = hosts.every(
      host => host.classList.contains('StripeElement--complete') && !host.classList.contains('empty') && !host.classList.contains('invalid')
    );
    const invalid = hosts.some(host => host.classList.contains('invalid'));
    return { shown: true, complete, invalid };
  };

  const readCheckout = () => {
    const screens = [...(checkoutDocument()?.querySelectorAll(SELECTORS.activeScreen) ?? [])]
      .filter(isVisible)
      .map(element => element.getAttribute('data-qa').replace('active-screen-', ''));
    const fee = findVisible(SELECTORS.coverFeeCheckbox);
    const card = cardStatus();
    return {
      screens,
      coverFee: fee ? fee.checked : undefined,
      total: text(findVisible(SELECTORS.totalLabel)) || undefined,
      cardDetailsShown: card.shown,
      cardDetailsComplete: card.complete,
      cardDetailsInvalid: card.invalid || undefined,
    };
  };

  const snapshot = extra => {
    const open = state.open || isCheckoutVisible();
    const live = open ? readCheckout() : {};
    const needsDonorInput = open ? collectDonorInput() : [];
    let stage = 'closed';
    if (state.donation) {
      stage = 'completed';
    } else if (state.submitting) {
      stage = 'processing';
    } else if (open) {
      stage = live.cardDetailsShown
        ? 'card_details'
        : live.screens.includes('privacy')
          ? 'donor_details'
          : live.screens.includes('payment-method')
            ? 'payment_method'
            : live.screens[0] || 'unknown';
    }
    const result = {
      stage,
      checkoutOpen: open,
      ...live,
      needsDonorInput,
      donation: state.donation,
      lastError: state.lastError,
      transactionConfirmed: Boolean(state.donation),
      ...extra,
    };
    if (!result.nextStep) {
      result.nextStep = nextStepFor(result);
    }
    return result;
  };

  const nextStepFor = result => {
    switch (result.stage) {
      case 'completed':
        return 'The donation is complete. Tell the donor the result from the donation field.';
      case 'processing':
        return 'The payment is being processed or needs bank authentication in the checkout. Call fru_get_donation_status again in a few seconds.';
      case 'card_details':
        if (result.needsDonorInput.length) {
          return 'Ask the donor for the items in needsDonorInput, then call fru_set_donor_details.';
        }
        return result.cardDetailsComplete
          ? 'Card details are entered. Tell the donor the total and ask for their go-ahead, then call fru_submit_donation.' + KEEP_DEFAULTS
          : CARD_NOTE + ' Ask the donor to type them, then ask for their go-ahead and call fru_submit_donation.' + KEEP_DEFAULTS;
      case 'donor_details':
        return result.needsDonorInput.length
          ? 'Ask the donor for all items in needsDonorInput in one message, then call fru_set_donor_details with the answers.'
          : 'Call fru_set_donor_details to continue to card payment.';
      case 'closed':
        return 'The checkout is not open. Call fru_start_donation.';
      default:
        return 'The checkout shows a step this page cannot handle (for example campaign questions or an address). Ask the donor to finish it on the page, then call fru_get_donation_status.';
    }
  };

  const closeCheckout = async () => {
    checkoutDocument()?.querySelector(SELECTORS.closeButton)?.click();
    await waitFor(() => !isCheckoutVisible(), 5000);
    state.open = false;
    state.session = null;
    state.submitting = false;
  };
  const sameSession = (a, b) => Boolean(a && b && a.amount === b.amount && a.currency === b.currency && a.frequency === b.frequency);

  const advance = async donor => {
    for (let step = 0; step < 8; step++) {
      if (findVisible(SELECTORS.cardBlock) && findVisible(SELECTORS.stripeCardFrame)) {
        if (typeof donor.coverFee === 'boolean') {
          const fee = findVisible(SELECTORS.coverFeeCheckbox);
          if (fee && fee.checked !== donor.coverFee) {
            fee.click();
            await sleep(400);
          }
        }
        return;
      }
      if (findVisible(SELECTORS.paymentMethodScreen) && !findVisible(SELECTORS.privacyScreen)) {
        findVisible(SELECTORS.creditCardOption)?.click();
        if (await waitFor(() => findVisible(SELECTORS.stripeCardFrame))) {
          continue;
        }
        return;
      }
      const privacyContinue = findVisible(SELECTORS.privacyContinueButton);
      if (privacyContinue) {
        for (const [field, selector] of DONOR_FIELDS) {
          const input = findVisible(selector);
          const value = clean(donor[field]);
          if (input && value && input.value !== value) {
            fillInput(input, value);
          }
        }
        await sleep(300);
        if (collectDonorInput().length) {
          return;
        }
        privacyContinue.click();
        await waitFor(() => !isVisible(privacyContinue) || collectDonorInput().length, 8000);
        if (isVisible(privacyContinue)) {
          await sleep(500);
          if (isVisible(privacyContinue)) {
            return;
          }
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
  };

  const donorSchema = {
    firstName: { type: 'string', description: 'Donor first name, if known from the conversation or the user profile.' },
    lastName: { type: 'string', description: 'Donor last name, if known.' },
    email: { type: 'string', description: 'Donor email for the receipt, if known. The checkout verifies that the address can receive mail.' },
    phone: { type: 'string', description: 'Donor phone, only if the user provided it.' },
    coverFee: {
      type: 'boolean',
      description: 'Only if the donor explicitly said whether to cover transaction costs. Omit to keep the checkout default.',
    },
  };

  const tools = [
    {
      name: 'fru_get_donation_options',
      title: 'Get donation options',
      description:
        'Read what this donation page accepts: currency, suggested amounts, frequencies, payment methods, and the current checkout state. Use it to answer questions or when the donor asks what is possible. To donate, call fru_start_donation directly.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: () =>
        json({
          currency: CONFIG.currency,
          suggestedAmounts: CONFIG.suggestedAmounts,
          frequencies: CONFIG.frequencies,
          paymentMethods: CONFIG.paymentMethods,
          oneShot:
            'One donor request is enough: call fru_start_donation with the amount and whatever donor details are known. Ask only for what the result reports as missing.',
          ...snapshot(),
        }),
    },
    {
      name: 'fru_start_donation',
      title: 'Start donation',
      description:
        'Use this as soon as the user wants to donate, make a donation, contribute, give money or support this organization, for example "donate $25", "give 10 monthly", "задонать 25$", "пожертвовать". Do not click the page. It opens the donation checkout with the amount and frequency, fills the donor details you pass, walks through the routine steps and stops at the card details. The result says exactly what is still missing. It never enters card details and never confirms the donation.' +
        KEEP_DEFAULTS,
      inputSchema: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Donation amount in major currency units, for example 25.' },
          currency: { type: 'string', description: 'ISO 4217 code. Use USD when the user writes $.' },
          frequency: {
            type: 'string',
            description:
              'once or monthly. Use monthly when the user asks for a subscription or a recurring donation, for example "every month", "оформи подписку". Otherwise omit it and a one-time donation is used.',
          },
          ...donorSchema,
        },
        required: ['amount'],
      },
      execute: async input => {
        const params = parse(input);
        if (typeof params.amount !== 'number' || params.amount <= 0) {
          return json({ started: false, reason: 'Amount must be a positive number.' });
        }
        const frequency = params.frequency ?? CONFIG.frequencies[0];
        if (!CONFIG.frequencies.includes(frequency)) {
          return json({
            started: false,
            reason: `Frequency "${frequency}" is not available for this campaign.`,
            availableFrequencies: CONFIG.frequencies,
          });
        }
        const currency = (params.currency ?? CONFIG.currency).toUpperCase();
        const requested = { amount: params.amount, currency, frequency };
        if (state.open || isCheckoutVisible()) {
          if (sameSession(state.session, requested) && !state.donation) {
            await advance(params);
            return json(snapshot({ started: false, reason: 'The donation checkout was already open with these settings, so it was continued instead of reopened.' }));
          }
          await closeCheckout();
        }
        state.donation = null;
        state.lastError = null;
        state.session = requested;
        callFun('openCheckout', CONFIG.campaignKey, {
          donation: { amount: params.amount, currency, recurring: frequency },
          supporter: { firstName: clean(params.firstName), lastName: clean(params.lastName), email: clean(params.email) },
          element: CONFIG.elementKey,
        });
        if (!(await waitFor(() => isCheckoutVisible() && findVisible(SELECTORS.activeScreen), 10000))) {
          return json({ started: false, reason: 'The checkout did not open. Ask the donor to reload the page and try again.' });
        }
        await advance(params);
        return json(snapshot({ started: true, amount: params.amount, currency, frequency }));
      },
    },
    {
      name: 'fru_set_donor_details',
      title: 'Set donor details',
      description:
        'Use this after fru_start_donation reported missing or rejected donor details, or to continue an open checkout to card payment. Fills the donor fields you pass and moves on to the card details step.' +
        KEEP_DEFAULTS,
      inputSchema: { type: 'object', properties: donorSchema },
      execute: async input => {
        if (!(state.open || isCheckoutVisible())) {
          return json(snapshot({ reason: 'The checkout is not open.' }));
        }
        await advance(parse(input));
        return json(snapshot());
      },
    },
    {
      name: 'fru_submit_donation',
      title: 'Submit donation',
      description:
        'Charges the card and completes the donation. Call it only after the donor typed the card details in the checkout and gave their go-ahead for the total shown. It refuses when the card details are incomplete. Returns the completed donation or the error shown by the checkout.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { consequentialHint: true },
      execute: async () => {
        if (!(state.open || isCheckoutVisible())) {
          return json(snapshot({ submitted: false, reason: 'The checkout is not open.' }));
        }
        if (state.donation) {
          return json(snapshot({ submitted: false, reason: 'This donation is already complete.' }));
        }
        const card = cardStatus();
        if (!card.shown) {
          return json(snapshot({ submitted: false, reason: 'The checkout is not at the card details step yet.' }));
        }
        if (!card.complete) {
          return json(snapshot({ submitted: false, reason: 'Card details are incomplete. ' + CARD_NOTE }));
        }
        const button = findVisible(SELECTORS.donateButton);
        if (!button) {
          return json(snapshot({ submitted: false, reason: 'The Donate button is not visible.' }));
        }
        state.submitting = true;
        state.lastError = null;
        button.click();
        const outcome = await waitFor(() => {
          if (state.donation) {
            return 'completed';
          }
          const alert = findVisible(SELECTORS.alert);
          if (alert && text(alert)) {
            state.lastError = text(alert);
            return 'failed';
          }
          if (findVisible(SELECTORS.donateButtonError) || cardStatus().invalid) {
            state.lastError = 'The checkout rejected the card details.';
            return 'failed';
          }
          return null;
        }, 45000);
        state.submitting = outcome === null;
        return json(
          snapshot({
            submitted: outcome === 'completed',
            reason:
              outcome === 'failed'
                ? state.lastError
                : outcome === null
                  ? 'No result within 45 seconds. The payment may need bank authentication in the checkout; call fru_get_donation_status.'
                  : undefined,
          })
        );
      },
    },
    {
      name: 'fru_get_donation_status',
      title: 'Get donation status',
      description:
        'Read the current checkout state: which step is shown, what the donor still has to provide, whether the card details are entered, the total, and the completed donation if any.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: () => json(snapshot({ lastEvent: state.lastEvent })),
    },
  ];

  callFun('on', 'checkoutOpen', () => {
    state.open = true;
    state.lastEvent = 'checkoutOpen';
  });
  callFun('on', 'checkoutClose', () => {
    state.open = false;
    state.session = null;
    state.submitting = false;
    state.lastEvent = 'checkoutClose';
  });
  callFun('on', 'donationComplete', details => {
    state.lastEvent = 'donationComplete';
    state.submitting = false;
    state.donation = {
      id: details?.donation?.id ?? null,
      amount: details?.donation?.amount ?? null,
      currency: details?.donation?.currency ?? null,
      frequency: details?.donation?.frequency ?? null,
      recurring: details?.donation?.recurring ?? null,
      feesCovered: details?.donation?.feesCovered ?? null,
      paymentMethod: details?.donation?.paymentMethod ?? null,
      livemode: details?.livemode ?? null,
      supporterEmail: details?.supporter?.email ?? null,
    };
  });

  tools.forEach(tool => {
    Promise.resolve(modelContext.registerTool(tool)).catch(error =>
      console.warn(`[WebMCP demo] ${tool.name} was not registered`, error)
    );
  });
  console.info('[WebMCP demo] tools registered');
})();
