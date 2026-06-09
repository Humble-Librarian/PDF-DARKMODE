// ============================================================
// background.js — Service Worker (Manifest V3)
// 
// Flow: When the user clicks the extension icon:
// 1. If the active tab is a PDF → open reader.html in the SAME tab
//    with the PDF URL passed as a query parameter
// 2. If the active tab is NOT a PDF → open reader.html in a NEW tab
//    so the user can upload a PDF without losing their current page
// ============================================================

chrome.action.onClicked.addListener((tab) => {
  const readerUrl = chrome.runtime.getURL('reader.html');
  const isPdf = tab.url && tab.url.toLowerCase().includes('.pdf');

  if (isPdf) {
    // PDF tab: convert in-place
    chrome.tabs.update(tab.id, { 
      url: readerUrl + '?url=' + encodeURIComponent(tab.url) + '&title=' + encodeURIComponent(tab.title || '')
    });
  } else {
    // Non-PDF tab: open upload screen in new tab
    chrome.tabs.create({ url: readerUrl });
  }
});
