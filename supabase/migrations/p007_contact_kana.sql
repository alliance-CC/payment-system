-- payment-system 固有マイグレーション: 契約に「フリガナ (セイ・メイ)」を追加。
-- 用途: 先方 (nuworks) へのエントリーCSVの契約者名_セイ・メイ (プラス) / 契約者名_姓_カナ・名_カナ (プレミアム)。
--       申込画面で聞き、全角カタカナで「セイ メイ」(半角空白区切り) の形で入れる。管理画面からも直せる。
--
-- 注意: payment_contracts は当面 CRM(Memolyze.app)と同じ Supabase を共有するテーブル。
--       追加のみ・冪等なので既存データ/CRM 側に影響しない。Supabase の SQL Editor で一度実行すること。
--       (未適用でも申込・課金は動作する。フリガナの保存・CSVへの出力・管理画面の表示だけ行えない)
alter table if exists public.payment_contracts
  add column if not exists contact_kana text;

comment on column public.payment_contracts.contact_kana is
  'フリガナ (全角カタカナ・「セイ メイ」の半角空白区切り)。申込画面で入力、管理画面で修正可。エントリーCSVで使用。';
