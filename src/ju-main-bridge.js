(() => {
    if (!location.hostname.includes("junavi.jp") || window._mlive_ju_react_bridge_installed) return;
    window._mlive_ju_react_bridge_installed = true;

    const ACTION_ATTR = "data-mlive-ju-main-action";
    const RESULT_ATTR = "data-mlive-ju-main-action-result";
    const HISTORY_ATTR = "data-mlive-ju-main-action-history";
    const TOKEN_ATTR = "data-mlive-ju-main-action-token";
    const READY_ATTR = "data-mlive-ju-main-bridge-ready";
    const ACTION_EVENT = "mlive-linkifier:ju-main-action";
    const ACTION_HISTORY_LIMIT = 24;

    const writeResult = result => {
        const root = document.documentElement;
        if (!root) return;

        try {
            const entry = { at: Date.now(), ...result };
            root.setAttribute(RESULT_ATTR, JSON.stringify(entry).slice(0, 1200));

            const rawHistory = root.getAttribute(HISTORY_ATTR) || "[]";
            const history = JSON.parse(rawHistory);
            const nextHistory = Array.isArray(history) ? history : [];
            nextHistory.push(entry);
            root.setAttribute(HISTORY_ATTR, JSON.stringify(nextHistory.slice(-ACTION_HISTORY_LIMIT)).slice(0, 12000));
        } catch {
            root.setAttribute(RESULT_ATTR, JSON.stringify({ ok: false, error: "result_serialize_failed" }));
        }
    };

    const waitForNativeActionToSettle = () => new Promise(resolve => {
        const finish = () => window.setTimeout(resolve, 0);
        if (typeof window.requestAnimationFrame === "function") {
            window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
            return;
        }
        finish();
    });

    const handleAction = async () => {
        const root = document.documentElement;
        if (!root) return;

        let payload;
        try {
            payload = JSON.parse(root.getAttribute(ACTION_ATTR) || "");
        } catch {
            writeResult({ ok: false, error: "invalid_payload" });
            return;
        }

        const action = String(payload?.action || "");
        const token = String(payload?.token || "");
        const eventName = action === "change" ? "onChange" : action === "click" ? "onClick" : "";
        if (!token || !eventName) {
            writeResult({ ok: false, token, action, error: "invalid_action" });
            return;
        }

        const target = document.querySelector(`[${TOKEN_ATTR}="${token}"]`);
        if (!target) {
            writeResult({ ok: false, token, action, error: "target_missing" });
            return;
        }

        if (typeof target.click !== "function") {
            writeResult({ ok: false, token, action, error: "click_missing" });
            return;
        }

        try {
            let alreadySelected = false;
            if (action === "change") {
                if (typeof target.checked !== "boolean") {
                    writeResult({ ok: false, token, action, error: "checkbox_missing" });
                    return;
                }
                alreadySelected = target.checked === !!payload.checked;
            }

            const metadata = {
                token,
                action,
                eventName,
                targetId: target.id || "",
                targetTag: target.tagName || "",
                method: "native_dom_click",
                alreadySelected
            };

            if (!alreadySelected) target.click();
            await waitForNativeActionToSettle();
            writeResult({ ok: true, completed: true, ...metadata });
        } catch (error) {
            writeResult({
                ok: false,
                token,
                action,
                error: String(error?.message || error).slice(0, 200)
            });
        }
    };

    window.addEventListener(ACTION_EVENT, handleAction);
    document.documentElement?.setAttribute(READY_ATTR, "1");
})();
