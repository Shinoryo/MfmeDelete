import { chromium } from 'playwright';
import { mfmeConfig } from './mfme.config.js';

function parseArgs(argv) {
  const options = {
    headless: false,
    dryRun: false,
    maxDeletes: Number.POSITIVE_INFINITY,
    fromMonth: null,
    toMonth: null,
    keepOpen: false,
    concurrency: null,
    retryCount: null,
    retryDelayMs: null
  };

  const normalizedArgv = argv.map((arg) => arg.replace(/[\u2010-\u2015\u2212\u30fc]/g, '-'));

  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const arg = normalizedArgv[index];

    if (arg === '--headless') {
      options.headless = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--keep-open') {
      options.keepOpen = true;
      continue;
    }

    if (arg.startsWith('--max-deletes=')) {
      const rawValue = arg.split('=')[1];
      const parsedValue = Number.parseInt(rawValue, 10);

      if (!Number.isNaN(parsedValue) && parsedValue > 0) {
        options.maxDeletes = parsedValue;
      }
      continue;
    }

    if (arg.startsWith('--concurrency=')) {
      const rawValue = arg.split('=')[1];
      const parsedValue = Number.parseInt(rawValue, 10);

      if (!Number.isNaN(parsedValue) && parsedValue > 0) {
        options.concurrency = Math.min(parsedValue, 5);
      }
      continue;
    }

    if (arg.startsWith('--retry-count=')) {
      const rawValue = arg.split('=')[1];
      const parsedValue = Number.parseInt(rawValue, 10);

      if (!Number.isNaN(parsedValue) && parsedValue >= 0) {
        options.retryCount = parsedValue;
      }
      continue;
    }

    if (arg.startsWith('--retry-delay-ms=')) {
      const rawValue = arg.split('=')[1];
      const parsedValue = Number.parseInt(rawValue, 10);

      if (!Number.isNaN(parsedValue) && parsedValue >= 0) {
        options.retryDelayMs = parsedValue;
      }
      continue;
    }

    if (arg.startsWith('--from-month=')) {
      options.fromMonth = arg.split('=')[1] ?? null;
      continue;
    }

    if (arg === '--from-month') {
      options.fromMonth = normalizedArgv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg.startsWith('--to-month=')) {
      options.toMonth = arg.split('=')[1] ?? null;
      continue;
    }

    if (arg === '--to-month') {
      options.toMonth = normalizedArgv[index + 1] ?? null;
      index += 1;
      continue;
    }
  }

  // npm が --from-month のような引数を npm 設定として解釈した場合でも拾えるようにする
  options.fromMonth = options.fromMonth ?? process.env.npm_config_from_month ?? null;
  options.toMonth = options.toMonth ?? process.env.npm_config_to_month ?? null;

  if (options.maxDeletes === Number.POSITIVE_INFINITY) {
    const maxDeletesFromEnv = Number.parseInt(process.env.npm_config_max_deletes ?? '', 10);
    if (!Number.isNaN(maxDeletesFromEnv) && maxDeletesFromEnv > 0) {
      options.maxDeletes = maxDeletesFromEnv;
    }
  }

  if (!options.keepOpen) {
    const keepOpenFromEnv = (process.env.npm_config_keep_open ?? '').toLowerCase();
    if (keepOpenFromEnv === 'true' || keepOpenFromEnv === '1') {
      options.keepOpen = true;
    }
  }

  if (options.concurrency === null) {
    const concurrencyFromEnv = Number.parseInt(process.env.npm_config_concurrency ?? '', 10);
    if (!Number.isNaN(concurrencyFromEnv) && concurrencyFromEnv > 0) {
      options.concurrency = Math.min(concurrencyFromEnv, 5);
    }
  }

  if (options.retryCount === null) {
    const retryCountFromEnv = Number.parseInt(process.env.npm_config_retry_count ?? '', 10);
    if (!Number.isNaN(retryCountFromEnv) && retryCountFromEnv >= 0) {
      options.retryCount = retryCountFromEnv;
    }
  }

  if (options.retryDelayMs === null) {
    const retryDelayFromEnv = Number.parseInt(process.env.npm_config_retry_delay_ms ?? '', 10);
    if (!Number.isNaN(retryDelayFromEnv) && retryDelayFromEnv >= 0) {
      options.retryDelayMs = retryDelayFromEnv;
    }
  }

  options.concurrency ??= 1;
  options.retryCount ??= 3;
  options.retryDelayMs ??= 700;

  return options;
}

function parseMonthToken(token, argName) {
  const matched = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(token ?? '');
  if (!matched) {
    throw new Error(`${argName} は YYYY-MM 形式で指定してください。`);
  }

  return {
    year: Number.parseInt(matched[1], 10),
    month: Number.parseInt(matched[2], 10)
  };
}

function compareYearMonth(left, right) {
  if (left.year !== right.year) {
    return left.year - right.year;
  }

  return left.month - right.month;
}

function formatMonthLabel(yearMonth) {
  return `${yearMonth.year}-${String(yearMonth.month).padStart(2, '0')}`;
}

function buildMonthRange(options) {
  if (!options.fromMonth && !options.toMonth) {
    return null;
  }

  if (!options.fromMonth || !options.toMonth) {
    throw new Error('--from-month と --to-month はセットで指定してください。');
  }

  const left = parseMonthToken(options.fromMonth, '--from-month');
  const right = parseMonthToken(options.toMonth, '--to-month');

  const cmp = compareYearMonth(left, right);
  const newer = cmp >= 0 ? left : right;
  const older = cmp >= 0 ? right : left;
  const months = [];

  let cursor = { ...newer };
  while (compareYearMonth(cursor, older) >= 0) {
    months.push({
      year: cursor.year,
      month: cursor.month,
      label: formatMonthLabel(cursor)
    });

    if (cursor.month === 1) {
      cursor = { year: cursor.year - 1, month: 12 };
    } else {
      cursor = { year: cursor.year, month: cursor.month - 1 };
    }
  }

  return months;
}

function buildMonthUrl(baseUrl, yearMonth) {
  const targetUrl = new URL(baseUrl);
  const fromValue = `${yearMonth.year}/${String(yearMonth.month).padStart(2, '0')}/01`;
  targetUrl.searchParams.set('from', fromValue);
  targetUrl.searchParams.set('sorted', 'date');
  return targetUrl.toString();
}

function parseYearMonthFromLabel(label) {
  const matched = /^(\d{4})\/(\d{1,2})\//.exec(label.trim());
  if (!matched) {
    return null;
  }

  return {
    year: Number.parseInt(matched[1], 10),
    month: Number.parseInt(matched[2], 10)
  };
}

function isSameYearMonth(left, right) {
  return left && right && left.year === right.year && left.month === right.month;
}

async function waitForIdle(page) {
  const loading = page.locator(mfmeConfig.selectors.loadingIndicator).first();

  try {
    await loading.waitFor({ state: 'detached', timeout: 1500 });
  } catch {
    // Loading indicator is optional.
  }
}

async function getCurrentMonthLabel(page) {
  const title = page.locator(mfmeConfig.selectors.monthTitle).first();
  if (!(await title.count())) {
    return 'unknown';
  }

  return (await title.innerText()).replace(/\s+/g, ' ').trim();
}

async function getStableMonthLabel(page) {
  await page.waitForFunction(
    ({ selector }) => {
      const title = document.querySelector(selector);
      if (!title) {
        return false;
      }

      const text = title.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      return /^(\d{4})\/(\d{1,2})\//.test(text);
    },
    { selector: mfmeConfig.selectors.monthTitle },
    { timeout: mfmeConfig.timeouts.actionMs }
  );

  return getCurrentMonthLabel(page);
}

async function alignToTargetMonth(page, yearMonth) {
  const maxSteps = 36;

  for (let step = 0; step < maxSteps; step += 1) {
    const currentLabel = await getStableMonthLabel(page);
    const currentYearMonth = parseYearMonthFromLabel(currentLabel);

    if (isSameYearMonth(currentYearMonth, yearMonth)) {
      return;
    }

    if (!currentYearMonth) {
      throw new Error(`表示月の解析に失敗しました。表示月: ${currentLabel}`);
    }

    const moveToPast = compareYearMonth(currentYearMonth, yearMonth) > 0;
    const monthButton = page.locator(moveToPast ? '#calendar .fc-button-prev' : '#calendar .fc-button-next').first();
    const buttonClass = await monthButton.getAttribute('class');

    if (buttonClass?.includes('fc-state-disabled')) {
      throw new Error(`月移動ボタンが無効です。表示月: ${currentLabel}, 対象月: ${formatMonthLabel(yearMonth)}`);
    }

    await monthButton.click();
    await page.waitForFunction(
      ({ selector, oldLabel }) => {
        const title = document.querySelector(selector);
        if (!title) {
          return false;
        }

        const text = title.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        return text !== oldLabel;
      },
      {
        selector: mfmeConfig.selectors.monthTitle,
        oldLabel: currentLabel
      },
      { timeout: mfmeConfig.timeouts.actionMs }
    );
    await waitForIdle(page);
  }

  throw new Error(`対象月に移動できませんでした。対象: ${formatMonthLabel(yearMonth)}`);
}

async function collectDeleteTargets(page) {
  return page.locator(mfmeConfig.selectors.transactionRow).evaluateAll(
    (rows, payload) => {
      return rows
        .map((row) => {
          const link = row.querySelector(payload.deleteSelector);
          const href = link?.getAttribute('href');

          if (!href) {
            return null;
          }

          const absoluteHref = new URL(href, payload.currentUrl).toString();
          const snapshot = (row.textContent ?? '').replace(/\s+/g, ' ').trim();

          return {
            href: absoluteHref,
            snapshot
          };
        })
        .filter((item) => item !== null);
    },
    {
      deleteSelector: mfmeConfig.selectors.deleteTrigger,
      currentUrl: page.url()
    }
  );
}

function isDeleteResponseSuccess(status) {
  return (status >= 200 && status < 300) || (status >= 300 && status < 400);
}

function isRetryableDeleteStatus(status) {
  return status === 429 || status === 422 || status === 403;
}

async function sendDeleteRequest(page, absoluteHref) {
  const csrfToken = await page
    .locator('meta[name="csrf-token"]')
    .first()
    .getAttribute('content')
    .catch(() => null);

  const baseHeaders = {
    Accept: 'text/javascript, application/javascript, text/html, application/json;q=0.9, */*;q=0.8',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: page.url()
  };

  if (csrfToken) {
    baseHeaders['X-CSRF-Token'] = csrfToken;
  }

  const deleteResponse = await page.request.fetch(absoluteHref, {
    method: 'DELETE',
    headers: baseHeaders,
    failOnStatusCode: false
  });

  if (isDeleteResponseSuccess(deleteResponse.status())) {
    return {
      ok: true,
      method: 'DELETE',
      status: deleteResponse.status(),
      url: deleteResponse.url()
    };
  }

  const form = new URLSearchParams();
  form.set('_method', 'delete');
  if (csrfToken) {
    form.set('authenticity_token', csrfToken);
  }

  const postResponse = await page.request.fetch(absoluteHref, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    data: form.toString(),
    failOnStatusCode: false
  });

  return {
    ok: isDeleteResponseSuccess(postResponse.status()),
    method: 'POST(_method=delete)',
    status: postResponse.status(),
    url: postResponse.url()
  };
}

async function requestDeleteByHref(page, absoluteHref, options) {
  const maxAttempts = options.retryCount + 1;
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await sendDeleteRequest(page, absoluteHref);
    lastResult = {
      ...result,
      attempt,
      maxAttempts
    };

    if (result.ok) {
      return lastResult;
    }

    if (!isRetryableDeleteStatus(result.status) || attempt >= maxAttempts) {
      return lastResult;
    }

    const waitMs = options.retryDelayMs * attempt;
    console.log(`再試行 ${attempt}/${maxAttempts - 1}: HTTP ${result.status} のため ${waitMs}ms 待機`);
    await page.waitForTimeout(waitMs);
  }

  return lastResult;
}

async function deleteSingleRow(page, options, sequence, target) {
  console.log(`対象 ${sequence + 1}: ${target.snapshot}`);

  if (options.dryRun) {
    return true;
  }

  const deleteResult = await requestDeleteByHref(page, target.href, options);
  console.log(`削除レスポンス: ${deleteResult.method} ${deleteResult.status} ${deleteResult.url} (attempt ${deleteResult.attempt}/${deleteResult.maxAttempts})`);

  if (!deleteResult.ok) {
    throw new Error(`削除リクエストが失敗しました: HTTP ${deleteResult.status} (${deleteResult.method})`);
  }

  await page.evaluate(
    ({ rowSelector, deleteSelector, href }) => {
      const rows = document.querySelectorAll(rowSelector);
      for (const row of rows) {
        const link = row.querySelector(deleteSelector);
        if (!link) {
          continue;
        }

        const absoluteHref = new URL(link.getAttribute('href') ?? '', location.href).toString();
        if (absoluteHref === href) {
          row.remove();
          return;
        }
      }
    },
    {
      rowSelector: mfmeConfig.selectors.transactionRow,
      deleteSelector: mfmeConfig.selectors.deleteTrigger,
      href: target.href
    }
  );

  return true;
}

async function deleteRows(page, options) {
  let deletedCount = 0;
  const currentMonthLabel = await getStableMonthLabel(page);
  console.log(`月: ${currentMonthLabel}`);

  const targets = await collectDeleteTargets(page);

  if (!targets.length) {
    console.log('この月に削除対象はありません。');
    return deletedCount;
  }

  const maxDeletesForMonth = Math.min(options.maxDeletes, targets.length);
  const workerCount = options.dryRun ? 1 : Math.min(options.concurrency, maxDeletesForMonth);
  let cursor = 0;
  let firstError = null;

  const runWorker = async () => {
    while (true) {
      if (firstError) {
        return;
      }

      if (cursor >= maxDeletesForMonth) {
        return;
      }

      const sequence = cursor;
      const target = targets[sequence];
      cursor += 1;

      try {
        await deleteSingleRow(page, options, sequence, target);
        deletedCount += 1;
        console.log(`削除完了 ${deletedCount}件`);
      } catch (error) {
        firstError = error;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  if (firstError) {
    throw firstError;
  }

  await waitForIdle(page);

  return deletedCount;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const monthRange = buildMonthRange(options);

  if (options.fromMonth || options.toMonth) {
    console.log(`範囲指定: from=${options.fromMonth ?? 'none'} to=${options.toMonth ?? 'none'}`);
  }

  if (monthRange) {
    console.log(`範囲モード: ${monthRange[0].label} -> ${monthRange[monthRange.length - 1].label} (${monthRange.length}ヶ月)`);
  }

  const browser = await chromium.launchPersistentContext('.mfme-profile', {
    channel: 'msedge',
    headless: options.headless,
    viewport: { width: 1440, height: 960 }
  });

  const page = browser.pages()[0] ?? await browser.newPage();
  page.setDefaultNavigationTimeout(mfmeConfig.timeouts.navigationMs);
  page.setDefaultTimeout(mfmeConfig.timeouts.actionMs);

  try {
    let totalDeleted = 0;

    if (monthRange) {
      for (const month of monthRange) {
        if (totalDeleted >= options.maxDeletes) {
          break;
        }

        const targetUrl = buildMonthUrl(mfmeConfig.startUrl, month);
        console.log(`対象月: ${month.label}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await waitForIdle(page);
        await alignToTargetMonth(page, month);

        const monthDeleted = await deleteRows(page, {
          ...options,
          maxDeletes: options.maxDeletes - totalDeleted
        });
        totalDeleted += monthDeleted;
      }
    } else {
      await page.goto(mfmeConfig.startUrl, { waitUntil: 'domcontentloaded' });
      totalDeleted = await deleteRows(page, options);
    }

    console.log(`処理終了: ${totalDeleted}件`);

    if (options.keepOpen) {
      console.log('keep-open が有効です。終了するには Playwright インスペクタで Resume してください。');
      await page.pause();
    }
  } catch (error) {
    if (options.keepOpen) {
      console.error('処理に失敗しました。画面を保持します。');
      console.error(error);
      console.log('keep-open が有効です。終了するには Playwright インスペクタで Resume してください。');
      await page.pause();
      return;
    }

    throw error;
  } finally {
    if (!options.keepOpen) {
      await browser.close();
    }
  }
}

main().catch((error) => {
  console.error('処理に失敗しました。');
  console.error(error);
  process.exitCode = 1;
});
