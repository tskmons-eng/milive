(() => {
    // window.open をオーバーライドして強制的に新しいタブで開く
    // Object.definePropertyを使うことで、より確実に定義する

    // すでにオーバーライド済みなら何もしない
    if (window._mlive_overridden) return;
    window._mlive_overridden = true;

    const originalOpen = window.open;

    Object.defineProperty(window, 'open', {
        configurable: true, // サイト側が壊れないように念のためtrue
        writable: true,
        value: function (url, name, features) {
            console.log("MLive Linkifier: Intercepted window.open", { url, name, features });

            // 第3引数(features)を無視し、第2引数(name)を _blank にすることで新しいタブを強制
            // ※ name が指定されていると、その名前の既存のポップアップを再利用しようとするため _blank に書き換える
            return originalOpen(url, '_blank');
        }
    });

    console.log("MLive Linkifier: window.open override installed (MAIN world, hardened)");
})();
