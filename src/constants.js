// content.js

// --- Configuration ---

const HOST_CARSENSOR = 'carsensor.net';
const HOST_MOTORGATE = 'motorgate.jp';

// Carsensor Selectors (Target for Import, Source for Copy)
const CS_SEL = {
  year: '#nenshikiPulldown',        // 初度登録年 (Year)
  month: '#torokuMPulldown',        // 登録月 (Month)
  maker: '#makerPulldown',          // メーカー (Maker)
  model: '#shashuPulldown',         // 車種 (Model)
  grade: '#gradePulldown',          // グレード (Grade)
  chassisNo: '#shadaiNumber',       // 車台番号 (Chassis No)
  mileage: '#kyori1',               // 走行距離 (Mileage)
  mileageUnit: '#ksaiSoukokyoriPullDown', // 距離単位 (1=10k km)
  priceMain: '#kakakuMan',          // 本体価格・万円 (Price Main)
  priceSub: '#kakakuSen',           // 本体価格・千円 (Price Sub)
  totalMain: '#ksaiSogakuMan',      // 総額・万円 (Total Main)
  totalSub: '#ksaiSogakuSen',       // 総額・千円 (Total Sub)
  color: '#simpleColorKana',        // 色・テキスト (Color Input)
  modelCode: '#katashikiPulldown',  // 型式・選択 (Model Code Select)
  modelCodeInput: 'input[name="usedKatasikisitei"]', // 型式・入力 (Model Code Input)
  mission: '#missionPulldown',      // ミッション (Transmission)
  note: '#ksaiGradeHokiKjComment',  // PRコメント (Note)
  shakenRadio: 'input[name="ksaiShakenZanHyojiCd"]', // 車検有無 (Radio)
  shakenType: '#shakenPullDown',    // 車検整備別 (Select)
  shakenYear: '#shakenY',           // 車検満了年 (Year)
  shakenMonth: '#shakenM',          // 車検満了月 (Month)
  legalMaint: 'select[name="seibiKbnCd"]' // 法定整備 (Select)
};

// MotorGate Selectors (Target for Import, Source for Copy)
const MG_SEL = {
  year: '#AdY',                     // 初度登録年 (Year)
  month: '#AdM',                    // 登録月 (Month)
  maker: '#BrandName',              // メーカー (Maker)
  model: '#ModelName',              // 車種 (Model)
  grade: '#GradeName',              // グレード (Grade)
  chassisNo: 'input[name="temp_syadai_num"]', // 車台番号 (Chassis No)
  mileage: '#Soukou',               // 走行距離・km (Mileage)
  mileageUnit: 'input[name="SoukouKbn"]', // 距離区分 (Radio)
  price: '#Kakaku',                 // 本体価格・万円 (Price)
  totalPrice: '#TotalPrice',        // 総額・万円 (Total Price)
  colorSelect: 'select[name^="Color"]', // 色・選択 (Color Select)
  colorInput: '#ColorName',         // 色・入力 (Color Input)
  mission: '#MissionDtl',           // ミッション (Transmission)
  repairHist: 'input[name="RepairHist"]', // 修復歴 (Repair History)
  recycle: '#AdditionalRecyclingCharge', // リサイクル (Recycle Fee)
  note: '#GradeFukabun',            // コメント (Note)
  shakenFlg: 'input[name="SyakenFlg"]', // 車検有無フラグ (Radio)
  shakenYear: '#SyakenYY',          // 車検満了年 (Year)
  shakenMonth: '#SyakenMM'          // 車検満了月 (Month)
};


// --- UI Injection ---

// --- UI Injection ---
