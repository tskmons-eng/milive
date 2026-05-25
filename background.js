const AUTH_API = "https://script.google.com/macros/s/AKfycbzaDKSrHO26qWzZahbxD6Sw5S5Kzd_f0WRjvYRkPk6rJDudkdsTTagTu3TL5ppkrT52iw/exec";
const AUTH_INTERVAL_DAYS = 30;

chrome.runtime.onStartup.addListener(checkAuth);
chrome.runtime.onInstalled.addListener(checkAuth);

// Message listener for auth.js (MV3 compatible)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "VERIFY_EMAIL") {
        verifyEmail(request.email).then(success => {
            sendResponse({ success });
        });
        return true; // Keep channel open for sendResponse
    }
});

async function checkAuth() {
    if (await needsAuth()) {
        chrome.action.setPopup({ popup: "auth.html" });
    } else {
        chrome.action.setPopup({ popup: "main.html" });
    }
}

async function needsAuth() {
    const { lastAuth } = await chrome.storage.local.get("lastAuth");
    if (!lastAuth) return true;

    const diff = Date.now() - lastAuth;
    return diff > AUTH_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
}

async function verifyEmail(email) {
    try {
        const res = await fetch(AUTH_API, {
            method: "POST",
            // GAS often has issues with CORS preflight (OPTIONS) for application/json.
            // Using text/plain avoids the preflight (Simple Request).
            // GAS e.postData.contents will still contain the JSON string.
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ email })
        });

        const data = await res.json();
        if (data.allowed) {
            await chrome.storage.local.set({
                lastAuth: Date.now(),
                email
            });
            // Switch popup to main
            chrome.action.setPopup({ popup: "main.html" });
            return true;
        }
        return false;
    } catch (e) {
        console.error("Auth Error:", e);
        return false;
    }
}
