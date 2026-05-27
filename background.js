// When the extension icon is clicked, check if the user is on a PDF
chrome.action.onClicked.addListener((tab) => {
  const readerUrl = chrome.runtime.getURL('reader.html');
  const isPdf = tab.url && tab.url.toLowerCase().includes('.pdf');

  if (isPdf) {
    // If they are viewing a PDF, convert it in the SAME tab!
    chrome.tabs.update(tab.id, { 
      url: readerUrl + '?url=' + encodeURIComponent(tab.url) + '&title=' + encodeURIComponent(tab.title || '')
    });
  } else {
    // If it's a normal webpage, open upload screen in a NEW tab so they don't lose their page
    chrome.tabs.create({ url: readerUrl });
  }
});
