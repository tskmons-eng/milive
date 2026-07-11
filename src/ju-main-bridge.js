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

    const handleAction = () => {
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
        if (!token || (action !== "change" && action !== "click")) {
            writeResult({ ok: false, action, error: "invalid_action" });
            return;
        }

        const target = document.querySelector(`[${TOKEN_ATTR}="${token}"]`);
        if (!target) {
            writeResult({ ok: false, action, error: "target_missing" });
            return;
        }

        try {
            if (action === "change") {
                if (typeof target.checked !== "boolean") {
                    writeResult({ ok: false, action, error: "checkbox_missing" });
                    return;
                }
                const expected = !!payload.checked;
                if (target.checked !== expected) target.click();
                writeResult({
                    ok: target.checked === expected,
                    action,
                    method: "native_click",
                    targetId: target.id || "",
                    checked: !!target.checked
                });
                return;
            }

            target.click();
            writeResult({
                ok: true,
                action,
                targetId: target.id || "",
                method: "native_click"
            });
        } catch (error) {
            writeResult({
                ok: false,
                action,
                error: String(error?.message || error).slice(0, 200)
            });
        }
    };

    window.addEventListener(ACTION_EVENT, handleAction);
    document.documentElement?.setAttribute(READY_ATTR, "1");
})();
