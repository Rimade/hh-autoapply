const { sleep } = require('./utils');

async function isVisible(locator, timeout = 1500) {
  return locator.isVisible({ timeout }).catch(() => false);
}

async function readFieldText(field) {
  const tag = await field.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  if (tag === 'textarea' || tag === 'input') {
    return (await field.inputValue().catch(() => '')).trim();
  }
  return (await field.innerText().catch(() => '')).trim();
}

async function blurLetterField(field) {
  await field.evaluate((el) => {
    el.blur();
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  });
}

async function setCoverLetterValue(field, text) {
  await field.scrollIntoViewIfNeeded().catch(() => {});
  await field.click({ force: true });
  await sleep(200);

  await field.fill(text).catch(() => {});
  await sleep(300);

  let current = await readFieldText(field);
  if (current.length >= Math.min(20, text.length * 0.4)) {
    await blurLetterField(field);
    await sleep(500);
    return true;
  }

  const filled = await field
    .evaluate((el, value) => {
      const fire = () => {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      if (el.isContentEditable) {
        el.focus();
        el.textContent = value;
        fire();
        return (el.textContent || '').trim().length >= 10;
      }

      const proto =
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, value);
      } else {
        el.value = value;
      }
      fire();
      return (el.value || '').trim().length >= 10;
    }, text)
    .catch(() => false);

  await blurLetterField(field);
  await sleep(600);
  current = await readFieldText(field);

  return filled || current.length >= Math.min(20, text.length * 0.4);
}

async function findLetterField(page, context = 'any') {
  const modalField = page.locator('[data-qa="vacancy-response-popup-form-letter-input"]').first();
  const inlineField = page
    .locator('form[id^="cover-letter-"] textarea[name="text"], form[action*="vacancy_response/edit_ajax"] textarea[name="text"]')
    .first();
  const genericField = page
    .getByPlaceholder(/сопроводительн/i)
    .or(page.locator('[data-qa="textarea-native-wrapper"] textarea'))
    .first();

  if (context === 'modal') {
    return (await isVisible(modalField, 2000)) ? modalField : null;
  }
  if (context === 'inline') {
    return (await isVisible(inlineField, 2000)) ? inlineField : null;
  }

  if (await isVisible(modalField, 1500)) return modalField;
  if (await isVisible(inlineField, 1500)) return inlineField;
  if (await isVisible(genericField, 1500)) return genericField;
  return null;
}

async function fillLetterIfEmpty(page, coverLetter, context = 'any') {
  if (!coverLetter) {
    return { filled: false, hadContent: false };
  }

  const field = await findLetterField(page, context);
  if (!field) {
    return { filled: false, hadContent: false, noField: true };
  }

  const current = await readFieldText(field);
  if (current.length >= 15) {
    await blurLetterField(field);
    return { filled: true, hadContent: true };
  }

  const filled = await setCoverLetterValue(field, coverLetter);
  return { filled, hadContent: false };
}

async function detectResponseFlow(page) {
  if (await isVisible(page.getByText(/резюме доставлено/i).first(), 2000)) {
    return 'post_delivered';
  }

  if (await isVisible(page.getByRole('heading', { name: /отклик на вакансию/i }), 2000)) {
    return 'modal';
  }

  if (await isVisible(page.locator('[data-qa="vacancy-response-popup-form-letter-input"]').first(), 1500)) {
    return 'modal';
  }

  if (
    (await isVisible(page.locator('[data-qa="vacancy-response-popup"]').first(), 1500)) ||
    (await isVisible(page.locator('#RESPONSE_MODAL_FORM_ID').first(), 1500)) ||
    (await isVisible(page.locator('form[name="vacancy_response"]').first(), 1500))
  ) {
    return 'modal';
  }

  if (
    (await isVisible(page.locator('[data-qa="vacancy-response-letter-submit"]').first(), 1500)) ||
    (await isVisible(page.locator('form[id^="cover-letter-"]').first(), 1500))
  ) {
    return 'inline';
  }

  const respondedBtn = page.locator(
    '[data-qa="vacancy-response-link-top"]:has-text("Вы откликнулись"), [data-qa="vacancy-response-link-top"]:has-text("отклик отправлен")'
  );
  if (await isVisible(respondedBtn.first(), 1000)) {
    return 'instant';
  }

  return 'unknown';
}

async function waitForResponseFlow(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const flow = await detectResponseFlow(page);
    if (flow !== 'unknown') {
      return flow;
    }
    await sleep(350);
  }

  return 'unknown';
}

async function isModalLetterMandatory(page) {
  return isVisible(page.locator('text=/сопроводительн.*обязател/i').first(), 2000);
}

async function clickLocator(btn) {
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(300);

  try {
    await btn.click({ timeout: 5000 });
    return true;
  } catch {
    // continue
  }

  try {
    await btn.click({ force: true, timeout: 5000 });
    return true;
  } catch {
    // continue
  }

  try {
    await btn.evaluate((el) => el.click());
    return true;
  } catch {
    return false;
  }
}

async function findModalSubmitButton(page) {
  const pools = [
    page.locator('[data-qa="vacancy-response-popup-submit-button"]'),
    page.locator('button[data-qa="vacancy-response-popup-submit-button"]'),
    page.getByRole('dialog').last().getByRole('button', { name: /^откликнуться$/i }),
    page.locator('[data-qa="vacancy-response-popup"] button:has-text("Откликнуться")'),
    page.locator('button:has-text("Откликнуться")'),
    page.locator('[role="button"]:has-text("Откликнуться")'),
  ];

  for (const pool of pools) {
    const count = await pool.count().catch(() => 0);
    for (let i = count - 1; i >= 0; i--) {
      const btn = pool.nth(i);
      if (!(await isVisible(btn, 600))) continue;

      const text = (await btn.innerText().catch(() => '')).toLowerCase();
      if (text.includes('сгенерир')) continue;
      if (text.includes('откликнуться')) return btn;
    }
  }

  return null;
}

async function findInlineSubmitButton(page) {
  const btn = page.locator('[data-qa="vacancy-response-letter-submit"]').first();
  if (await isVisible(btn, 3000)) return btn;

  const alt = page.getByRole('button', { name: /^отправить$/i }).first();
  if (await isVisible(alt, 2000)) return alt;

  return null;
}

async function isApplySuccess(page) {
  if (await isVisible(page.getByText(/резюме доставлено/i).first(), 800)) {
    return true;
  }

  if (
    await isVisible(
      page.locator(
        '[data-qa="vacancy-response-link-top"]:has-text("Вы откликнулись"), [data-qa="vacancy-response-link-top"]:has-text("отклик отправлен")'
      ),
      800
    )
  ) {
    return true;
  }

  return isVisible(page.getByText(/отклик отправлен|вы откликнулись/i).first(), 800);
}

async function waitApplyResult(page) {
  await sleep(1200);

  for (let i = 0; i < 16; i++) {
    if (await isApplySuccess(page)) {
      return true;
    }

    const modalOpen = await isVisible(page.locator('[data-qa="vacancy-response-popup"]').first(), 400);
    const modalHeading = await isVisible(
      page.getByRole('heading', { name: /отклик на вакансию/i }),
      400
    );

    if (!modalOpen && !modalHeading && i > 3) {
      return true;
    }

    await sleep(500);
  }

  return false;
}

async function handleModalResponse(page, coverLetter) {
  await sleep(800);

  const mandatory = await isModalLetterMandatory(page);
  const letter = await fillLetterIfEmpty(page, coverLetter, 'modal');

  if (mandatory && !coverLetter) {
    return { ok: false, reason: 'cover_letter_required' };
  }
  if (mandatory && letter.noField) {
    return { ok: false, reason: 'letter_field_not_found' };
  }
  if (mandatory && coverLetter && !letter.filled && !letter.hadContent) {
    return { ok: false, reason: 'cover_letter_fill_failed' };
  }
  if (coverLetter && !letter.noField && !letter.filled && !letter.hadContent) {
    return { ok: false, reason: 'cover_letter_fill_failed' };
  }

  await sleep(500);

  const submit = await findModalSubmitButton(page);
  if (!submit) {
    return { ok: false, reason: 'modal_submit_not_found' };
  }

  const clicked = await clickLocator(submit);
  if (!clicked) {
    return { ok: false, reason: 'submit_click_failed' };
  }

  if (await waitApplyResult(page)) {
    return { ok: true, flow: 'modal' };
  }

  return { ok: false, reason: 'modal_not_submitted' };
}

async function handleInlineResponse(page, coverLetter) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1200);

  const submitBtn = await findInlineSubmitButton(page);
  if (!submitBtn) {
    return { ok: false, reason: 'inline_submit_not_found' };
  }

  await submitBtn.scrollIntoViewIfNeeded().catch(() => {});

  if (coverLetter) {
    const letter = await fillLetterIfEmpty(page, coverLetter, 'inline');
    if (!letter.filled && !letter.hadContent && !letter.noField) {
      return { ok: false, reason: 'cover_letter_fill_failed' };
    }
  }

  const clicked = await clickLocator(submitBtn);
  if (!clicked) {
    return { ok: false, reason: 'submit_click_failed' };
  }

  if (await waitApplyResult(page)) {
    return { ok: true, flow: 'inline' };
  }

  return { ok: false, reason: 'inline_not_submitted' };
}

async function handlePostDelivered(page, coverLetter) {
  if (coverLetter) {
    await fillLetterIfEmpty(page, coverLetter, 'any');
    const submit = await findInlineSubmitButton(page);
    if (submit) {
      await clickLocator(submit);
      await sleep(1000);
    }
  }

  return { ok: true, flow: 'post_delivered' };
}

async function closeApplyModal(page) {
  const closeBtn = page
    .locator('[data-qa="vacancy-response-popup-close"], button[aria-label="Закрыть"]')
    .first();

  if (await isVisible(closeBtn, 1000)) {
    await closeBtn.click().catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await sleep(400);
}

async function handleResponseAfterClick(page, coverLetter) {
  await sleep(2000);

  let flow = await waitForResponseFlow(page, 15000);

  if (flow === 'unknown') {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1500);
    flow = await detectResponseFlow(page);
  }

  const handlers = {
    post_delivered: () => handlePostDelivered(page, coverLetter),
    modal: () => handleModalResponse(page, coverLetter),
    inline: () => handleInlineResponse(page, coverLetter),
    instant: async () => ({ ok: true, flow: 'instant' }),
  };

  if (handlers[flow]) {
    const result = await handlers[flow]();
    if (result.ok) return result;

    if (flow === 'modal') {
      await closeApplyModal(page);
      if (result.reason === 'modal_submit_not_found' || result.reason === 'modal_not_submitted') {
        const inlineRetry = await handleInlineResponse(page, coverLetter);
        if (inlineRetry.ok) return inlineRetry;
        const postRetry = await handlePostDelivered(page, coverLetter);
        if (postRetry.ok) return postRetry;
      }
    }

    return result;
  }

  const fallbackOrder = [
    () => handleModalResponse(page, coverLetter),
    () => handleInlineResponse(page, coverLetter),
    () => handlePostDelivered(page, coverLetter),
  ];

  for (const run of fallbackOrder) {
    const result = await run();
    if (result.ok) return result;
  }

  if (await isApplySuccess(page)) {
    return { ok: true, flow: 'instant' };
  }

  return { ok: false, reason: 'unknown_flow' };
}

module.exports = {
  handleResponseAfterClick,
  setCoverLetterValue,
  detectResponseFlow,
  closeApplyModal,
};
