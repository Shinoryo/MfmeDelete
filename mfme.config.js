export const mfmeConfig = {
  startUrl: "https://moneyforward.com/cf",
  selectors: {
    transactionRow: 'tr:has(td.delete a[data-method="delete"])',
    deleteTrigger: 'td.delete a[data-method="delete"]',
    monthTitle: '#calendar .fc-header-title h2',
    previousMonth: '#calendar .fc-button-prev',
    loadingIndicator: '#js-alert .alert:has-text("読み込み"), .loading, .spinner'
  },
  timeouts: {
    navigationMs: 30000,
    actionMs: 10000
  }
};
