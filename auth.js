document.getElementById("submit").onclick = async () => {
    const emailProp = document.getElementById("email");
    const msg = document.getElementById("msg");
    const btn = document.getElementById("submit");

    const email = emailProp.value.trim();
    if (!email) {
        msg.textContent = "メールアドレスを入力してください";
        return;
    }

    msg.textContent = "確認中...";
    msg.style.color = "#666";
    btn.disabled = true;

    try {
        // background.js 経由で認証
        // chrome.runtime.getBackgroundPage() は MV3 では非推奨の場合があるが、
        // ここでは一番シンプルな構成として messaging を使うか、直接呼ぶか。
        // MV3 service worker だと getBackgroundPage は使えないため、message passing にする。

        const response = await chrome.runtime.sendMessage({ type: "VERIFY_EMAIL", email });

        if (response && response.success) {
            msg.textContent = "認証成功";
            msg.style.color = "#28a745";
            setTimeout(() => {
                window.close();
            }, 1000);
        } else {
            msg.textContent = "このメールアドレスは許可されていません";
            msg.style.color = "#d9534f";
            btn.disabled = false;
        }
    } catch (err) {
        console.error(err);
        msg.textContent = "エラーが発生しました: " + err.message;
        msg.style.color = "#d9534f";
        btn.disabled = false;
    }
};
