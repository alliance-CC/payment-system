-- payment-system 固有マイグレーション: 契約に「SAF案件番号」を追加。
-- 用途: 会員ID (当システムの採番) とは別に、現場が後から手入力する管理番号。
--       データローダ用CSVの主キーとして使う。
--
-- 注意: payment_contracts は当面 CRM(Memolyze.app)と同じ Supabase を共有するテーブル。
--       追加のみ・冪等なので既存データ/CRM 側に影響しない。Supabase の SQL Editor で一度実行すること。
--       (未適用でも申込・課金は動作する。SAF案件番号の保存/表示のみ行えない)
alter table if exists public.payment_contracts
  add column if not exists saf_case_no text;

comment on column public.payment_contracts.saf_case_no is
  'SAF案件番号 (現場が管理画面で手入力する管理番号)。会員IDとは別物。データローダ用CSVで使用。';
