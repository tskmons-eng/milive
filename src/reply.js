// Inquiry reply templates and reply-page helpers.

function processInquiryReplyPage() {
  const textarea = document.getElementById('honbun');
  if (!textarea) return;

  // Check if we already added buttons
  if (document.querySelector('.cs-reply-container')) return;

  const container = document.createElement('div');
  container.className = 'cs-reply-container';

  const buttons = [
    {
      text: '在庫あり', color: 'success', template: `お問い合わせありがとうございます。
ご希望のお車は【在庫あり】です。

ただ、問い合わせが多く在庫は動きやすいため、
確実にご覧いただくにはお早めの下見予約がおすすめです。

下見は水曜・土曜・日曜が最短で、予約制です。
お急ぎでしたらお電話やLINEいただければすぐに調整します。

TEL;070-9194-7383　坂本
公式LINE:https://lin.ee/irwSbxP

お車の見積もりですが、
県内にお住まいの方であれば、
掲載金額が込み込みの料金となります。

県外の方は、お電話やLINEにて追加の名義変更代金について計算させて頂きます。
お安くできる場合もございますのでぜひ、お気軽にご連絡ください。

さらに今季は乗換サポートキャンペーン実施中で、
下取りがあれば最大5万円引きとなります。損せずご購入いただけるタイミングです。

ご検討のほどよろしくお願いいたします。

*******************
株式会社car more　
ゼットエスモーターズ
営業　坂本

〒370-0123
群馬県伊勢崎市境東230
TEL：070-9194-7383
LINE:@469oueim
*******************`
    },
    {
      text: '県外', color: 'primary', template: `お問い合わせありがとうございます。
ご希望のお車は【在庫あり】です。

ただ、問い合わせが多いため、
確実にご覧いただくにはお早めの下見予約がおすすめです。
ビデオ通話での下見や、商談も可能で、
水曜・土曜・日曜が最短で、予約制となっております。
お急ぎでしたらお電話やLINEいただければすぐに調整します。
TEL:070-9194-7383　坂本
公式LINE:https://lin.ee/irwSbxP

そしてお車の見積もりですが、
県外の方は、お電話やLINEにて追加の名義変更代金について計算させて頂きます。
お安くできる場合もございますのでぜひ、お気軽にご連絡ください。

当店は、
ご来店頂く場合を除き、基本商談を抑える事が出来ず、
先着順でのご案内となります。（遠方の方は電話で決定も可能。）
在庫はまだございますが、是非お早めにご購入をご検討頂ければ幸いです。

☆今季は乗換サポートキャンペーン☆
下取りがあれば最大5万円引き。
お得な条件を押さえながらご検討いただけます。

人気車両は先着順で売れてしまうこともありますので、急ぎの場合は直接お電話いただければ即対応します。

ご検討のほどよろしくお願いいたします。

*******************
株式会社car more　
ゼットエスモーターズ
営業　坂本

〒370-0123
群馬県伊勢崎市境東230
TEL：070-9194-7383
LINE:@469oueim
*******************`
    },
    {
      text: '商談中', color: 'warning', template: `お問い合わせありがとうございます。

こちらの車両は現在商談中です。

ただ、掲載前の近い条件の車体ございます。
もしよろしければご案内できるのですが、いかがでしょうか？

当店は良心的な価格設定に自信がありますので、
他にも条件に合う車体をお探しでしたら、
お電話やLINEにて、〇〇の在庫はあるか？など、ご連絡頂けるだけですぐ状況をお伝えできます。
中には、掲載のない掘り出し物が見つかることもございますので一度確認することをオススメいたします。
お気軽にどうぞ、よろしくお願いします。

TEL;070-9194-7383　坂本
公式LINE:https://lin.ee/irwSbxP

また今季は乗換サポートキャンペーン中で、
下取りがあれば最大5万円引きになります。

下見は予約制で水曜・土曜・日曜が最短。先の予定やビデオ通話も可能です。
予約は埋まりやすいため、お早めのご検討をおすすめします。

*******************
株式会社car more　
ゼットエスモーターズ
営業　坂本

〒370-0123
群馬県伊勢崎市境東230
TEL：070-9194-7383
LINE:@469oueim
*******************`
    },
    {
      text: '在庫無しほか勧誘', color: 'danger', template: `お問い合わせありがとうございます。
ご希望いただいたお車は先日ご成約となりました。

ただ、掲載前の近い条件の車体ございます。
もしよろしければご案内できるのですが、いかがでしょうか？

当店は良心的な価格設定に自信がありますので、
他にも条件に合う車体をお探しでしたら、
お電話やLINEにて、〇〇の在庫はあるか？など、ご連絡頂けるだけですぐ状況をお伝えできます。
中には、掲載のない掘り出し物が見つかることもございますので一度確認することをオススメいたします。
お気軽にどうぞ、よろしくお願いします。

TEL;070-9194-7383　坂本
公式LINE:https://lin.ee/irwSbxP

また今季は乗換サポートキャンペーン中で、
下取りがあれば最大5万円引きになります。

下見は予約制で水曜・土曜・日曜が最短。先の予定やビデオ通話も可能です。
予約は埋まりやすいため、お早めのご検討をおすすめします。

*******************
株式会社car more　
ゼットエスモーターズ
営業　坂本

〒370-0123
群馬県伊勢崎市境東230
TEL：070-9194-7383
LINE:@469oueim
*******************`
    },
    {
      text: '在庫無しさよなら', color: 'danger', template: `お問い合わせありがとうございます。
ご希望いただいたお車は先日ご成約となりました。
ただし、カーセンサーにまだ掲載できていない同条件の在庫があることもございます。

当店は良心的な価格設定に自信がありますので、
条件に合う車体をお探しでしたら、
お電話やLINEにて、〇〇の在庫はあるか？など、ご連絡頂けるだけですぐ状況をお伝えできます。
中には、掲載のない掘り出し物が見つかることもございますので一度確認することをオススメいたします。
お気軽にどうぞ、よろしくお願いします。

TEL;070-9194-7383　坂本
公式LINE:https://lin.ee/irwSbxP

また今季は乗換サポートキャンペーン中で、
下取りがあれば最大5万円引きになります。

下見は予約制で水曜・土曜・日曜が最短。先の予定やビデオ通話も可能です。
予約は埋まりやすいため、お早めのご検討をおすすめします。

*******************
株式会社car more　
ゼットエスモーターズ
営業　坂本

〒370-0123
群馬県伊勢崎市境東230
TEL：070-9194-7383
LINE:@469oueim
*******************`
    },
    {
      text: '不具合確認', color: 'warning', template: `お問い合わせありがとうございます。

お車の見積もりですが、
県内にお住まいの方であれば、
掲載金額が込み込みの料金となります。
県外の方は、LINEやお電話にて追加の名義変更代金について計算させて頂きます。
お安くできる場合もございますのでぜひ、お気軽にご連絡ください。
TEL;070-9194-7383　坂本
公式LINE:https://lin.ee/irwSbxP

そしてご指摘の不安点について
現状、目立った大きい凹み等見受けられませんが値段相応の小キズ等はあります。
エンジン等は問題なく走行できます。
ご試乗可能ですので心配があるようでしたらお気軽にお申し付けください。また、

お客様により安心いただけるよう、プレミア保証（年間14,000円～／エンジン交換まで対応可）もご利用可能です。※車体によって審査がある場合があります。
壊れても対応できる保証制度があるので、現状販売でも心配なくご検討いただけます。

また、今季は乗換サポートキャンペーン実施中です☆
下取りがあれば最大5万円引きとなります。損せずご購入いただけるタイミングです。

下見は予約制で水曜・土曜・日曜が最短、予約がすぐ埋まるためお早めにどうぞ。
急ぎの場合はお電話いただければ即対応します。

ご検討のほどよろしくお願いいたします。

*******************
株式会社car more　
ゼットエスモーターズ
営業　坂本

〒370-0123
群馬県伊勢崎市境東230
TEL：070-9194-7383
LINE:@469oueim
*******************`
    },
    {
      text: '交換箇所不明', color: 'warning', template: `お問い合わせありがとうございます。

お車の見積もりですが、
県内にお住まいの方であれば、
掲載金額が込み込みの料金となります。
県外の方は、LINEやお電話にて追加の名義変更代金について計算させて頂きます。
お安くできる場合もございますのでぜひ、お気軽にご連絡ください。
TEL;070-9194-7383　坂本
公式LINE:https://lin.ee/irwSbxP

そしてご指摘の不安点について
交換履歴等は不明です。
現状問題はございませんが中古車問こともありますので内見をお勧めいたします。
また、
お客様により安心いただけるよう、プレミア保証（年間14,000円～／エンジン交換まで対応可）もご利用可能です。※車体によって審査がある場合があります。
壊れても対応できる保証制度があるので、現状販売でも心配なくご検討いただけます。

また、今季は乗換サポートキャンペーン実施中です☆
下取りがあれば最大5万円引きとなります。損せずご購入いただけるタイミングです。

下見は予約制で水曜・土曜・日曜が最短、予約がすぐ埋まるためお早めにどうぞ。
急ぎの場合はお電話いただければ即対応します。

ご検討のほどよろしくお願いいたします。

*******************
株式会社car more　
ゼットエスモーターズ
営業　坂本

〒370-0123
群馬県伊勢崎市境東230
TEL：070-9194-7383
LINE:@469oueim
*******************`
    },
    {
      text: '予約調整', color: 'info', template: `お世話になっております。

来店予約ありがとうございます。

10時30分ですと既に埋まっておりますので、11時はいかがでしょうか？


*******************
株式会社car more　
ゼットエスモーターズ
営業　坂本

〒370-0123
群馬県伊勢崎市境東230
TEL：070-9194-7383
LINE:@469oueim
*******************

https://lin.ee/4yfH2Ak`
    },
    {
      text: '来店間に合わず', color: 'secondary', template: `お世話になっております。　

ご回答が間に合わず、申し訳ございませんでした。

別日はいかがでしょうか？

お電話での対応もできますのでよろしくお願いいたします。

お車の見積もりですが、
県内にお住まいの方であれば、
掲載金額が込み込みの料金となります。
また、今季は乗換サポートキャンペーン下取りがあれば最大5万円引き。
お得な条件を押さえながらご検討いただけます。

当店はご来店頂く場合を除き、基本商談を抑える事が出来ず、
先着順でのご案内となります。
在庫はまだございますが、是非お早めに内見やご購入をご検討頂ければ幸いです。

TEL;070-9194-7383　坂本
公式LINE:https://lin.ee/irwSbxP


流れはシンプルで、まずは下見→気に入れば契約→当店にて納車です。
下見は予約制で、
最短では水曜・土曜・日曜。その他、ビデオ通話での商談も可能です。
急ぎの場合は直接お電話やLINEいただければ即対応します。

ご検討のほどよろしくお願いいたします。

*******************
株式会社car more　
ゼットエスモーターズ
営業　坂本

〒370-0123
群馬県伊勢崎市境東230
TEL：070-9194-7383
LINE:@469oueim
*******************`
    },
    {
      text: 'ローン', color: 'info', template: `お世話になっております！

自社ローンは取り扱いが無いのですが、プレミアローンの取り扱いがあります。

弊社かなり高いプランに加入しておりますので、通りやすくなっております。

ぜひともご検討ください！

*******************
株式会社car more　
ゼットエスモーターズ
営業　坂本

〒370-0123
群馬県伊勢崎市境東230
TEL：070-9194-7383
LINE:@469oueim
*******************

https://lin.ee/4yfH2Ak`
    },
    {
      text: '署名', color: 'light', append: true, template: `

*******************
株式会社car more　
ゼットエスモーターズ
営業　坂本

〒370-0123
群馬県伊勢崎市境東230
TEL：070-9194-7383
LINE:@469oueim
*******************

https://lin.ee/4yfH2Ak`
    }
  ];

  buttons.forEach(btn => {
    const button = document.createElement('button');
    button.textContent = btn.text;
    button.className = `cs-reply-btn ${btn.color || ''}`;
    button.addEventListener('click', (e) => {
      e.preventDefault();
      if (btn.append) {
        textarea.value += btn.template;
      } else {
        textarea.value = btn.template;
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.dispatchEvent(new Event('keyup', { bubbles: true }));
    });
    container.appendChild(button);
  });

  textarea.parentNode.insertBefore(container, textarea);

  // Duplicate confirm button above the input form
  const confirmBtn = document.getElementById('defaultConfirmMessageBtn');
  if (confirmBtn && !document.getElementById('clonedConfirmBtn')) {
    const clonedBtn = confirmBtn.cloneNode(true);
    clonedBtn.id = 'clonedConfirmBtn';
    clonedBtn.style.marginBottom = '15px';
    clonedBtn.addEventListener('click', (e) => {
      e.preventDefault();
      confirmBtn.click();
    });
    container.parentNode.insertBefore(clonedBtn, container);
  }

  // Auto-fill kaitoSha
  const kaitoShaInput = document.querySelector('input[name="kaitoSha"]');
  if (kaitoShaInput && !kaitoShaInput.value) {
    kaitoShaInput.value = 'サカモト';
    kaitoShaInput.dispatchEvent(new Event('input', { bubbles: true }));
    kaitoShaInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

}

function processConfirmationPage() {
  // Duplicate send message button above the table on confirmation page
  const sendBtn = document.getElementById('sendMessageButton');
  if (sendBtn && !document.getElementById('clonedSendBtnTop')) {
    const clonedBtn = sendBtn.cloneNode(true);
    clonedBtn.id = 'clonedSendBtnTop';
    clonedBtn.style.marginBottom = '15px';
    clonedBtn.style.display = 'block';
    clonedBtn.addEventListener('click', (e) => {
      e.preventDefault();
      sendBtn.click();
    });

    const table = document.querySelector('table.bdGrayT');
    if (table) {
      table.parentNode.insertBefore(clonedBtn, table);
    } else {
      const contents = document.querySelector('.p10');
      if (contents) {
        contents.insertBefore(clonedBtn, contents.firstChild);
      }
    }
  }
}

function processCompletionPage() {
  // Simple check for the completion header
  const headers = document.querySelectorAll('h2');
  let isCompletion = false;
  for (const h2 of headers) {
    if (h2.textContent.includes('問合せ回答完了')) {
      isCompletion = true;
      break;
    }
  }

  if (isCompletion) {
    const returnLink = document.querySelector('a[title="問合せ一覧へ戻る"]');
    if (returnLink) {
      // Create a visual indicator that we are redirecting
      const msg = document.createElement('div');
      msg.textContent = '自動で一覧に戻ります...';
      msg.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:rgba(0,0,0,0.8); color:white; padding:20px; border-radius:10px; z-index:10000; font-size:18px;';
      document.body.appendChild(msg);

      setTimeout(() => {
        returnLink.click();
      }, 500); // Small delay to let user see "Completed"
    }
  }
}

async function processLoginPage() {
  const { carsensorLoginId, carsensorPassword } = await chrome.storage.local.get([
    'carsensorLoginId',
    'carsensorPassword'
  ]);
  if (!carsensorLoginId || !carsensorPassword) return;

  const loginIdInput = document.querySelector('input[name="loginId"]');
  const passwordInput = document.querySelector('input[name="passwordCd"]');
  const loginBtn = document.querySelector('input[name="doLogin"]');

  if (loginIdInput && passwordInput && loginBtn) {
    loginIdInput.value = carsensorLoginId;
    passwordInput.value = carsensorPassword;

    // Trigger events just in case
    loginIdInput.dispatchEvent(new Event('input', { bubbles: true }));
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Click login
    loginBtn.click();
  }
}
