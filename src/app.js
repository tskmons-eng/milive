function runInquiryReplyTools() {
  processInquiryReplyPage();
  processConfirmationPage();
  processCompletionPage();
}

function createUI() {
  const url = window.location.href;

  if (url.includes('/login/')) {
    processLoginPage();
    return;
  }

  if (url.includes('/inquiry/reply/') || url.includes('/inquiry/lumpSumReply/')) {
    runInquiryReplyTools();
    return;
  }

  if (url.includes('registrationList')) {
    createListPageUI();
    return;
  }

  if (url.includes('motorgate.jp') && document.querySelector('input[name="frame_no"]')) {
    createListPageUI();
    return;
  }

  if (url.includes('registBasicInfo') || url.includes('motorgate.jp')) {
    createEditPageUI();
  }
}

(async () => {
  const { lastAuth } = await chrome.storage.local.get('lastAuth');
  const authIntervalDays = 30;
  const isAuthed = lastAuth && Date.now() - lastAuth <= authIntervalDays * 24 * 60 * 60 * 1000;

  if (isAuthed) {
    createUI();
  } else {
    console.log('Carsensor Tools: authentication required.');
  }
})();
