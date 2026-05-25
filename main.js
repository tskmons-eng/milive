document.addEventListener('DOMContentLoaded', async () => {
    const { lastAuth, email, carsensorLoginId, carsensorPassword } = await chrome.storage.local.get([
        "lastAuth",
        "email",
        "carsensorLoginId",
        "carsensorPassword"
    ]);

    const AUTH_INTERVAL_DAYS = 30;
    const isExpired = !lastAuth || Date.now() - lastAuth > AUTH_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

    if (isExpired) {
        document.body.innerHTML = '<p>Authentication expired.<br>Please authenticate again.</p>';
        chrome.action.setPopup({ popup: "auth.html" });
        return;
    }

    if (email) {
        document.getElementById("email-display").textContent = email;
    }

    const loginIdInput = document.getElementById("login-id");
    const passwordInput = document.getElementById("login-password");
    const message = document.getElementById("settings-message");
    const saveButton = document.getElementById("save-settings");

    loginIdInput.value = carsensorLoginId || "";
    passwordInput.value = carsensorPassword || "";

    saveButton.addEventListener("click", async () => {
        await chrome.storage.local.set({
            carsensorLoginId: loginIdInput.value.trim(),
            carsensorPassword: passwordInput.value
        });
        message.textContent = "Saved";
        setTimeout(() => {
            message.textContent = "";
        }, 1500);
    });
});
