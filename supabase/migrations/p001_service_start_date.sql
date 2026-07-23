-- payment-system 固有マイグレーション: 契約に「利用開始日」を追加。
-- 用途: 申込時に選択した利用開始日を起点に「2ヶ月無料 → 3ヶ月目課金」を行う (§無料期間)。
--
-- 注意: payment_contracts は当面 CRM(Memolyze.app)と同じ Supabase を共有するテーブル。
--       追加のみ・冪等なので既存データ/CRM 側に影響しない。Supabase の SQL Editor で一度実行すること。
--       (未適用でも申込・課金は動作するが、管理画面の「利用開始日」表示は申込日からの推定値になる)
alter table if exists public.payment_contracts
  add column if not exists service_start_date date;

comment on column public.payment_contracts.service_start_date is
  '利用開始日 (申込時に選択)。2ヶ月無料の起点。未設定なら申込日の翌月1日を推定利用開始日とする。';
