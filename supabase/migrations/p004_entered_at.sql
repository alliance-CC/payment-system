-- payment-system 固有マイグレーション: 契約に「エントリー済み日時」を追加。
-- 用途: 先方システムへのエントリー(登録)が済んだ案件を管理画面でチェックし、
--       未対応の案件が埋もれないようにする。管理画面から手動で立てる/外す。
--
-- 注意: payment_contracts は当面 CRM(Memolyze.app)と同じ Supabase を共有するテーブル。
--       追加のみ・冪等なので既存データ/CRM 側に影響しない。Supabase の SQL Editor で一度実行すること。
--       (未適用でも申込・課金は動作する。エントリー済みの記録/表示のみ行えない)
alter table if exists public.payment_contracts
  add column if not exists entered_at timestamptz;

comment on column public.payment_contracts.entered_at is
  '先方システムへのエントリーが完了した日時 (管理画面で手動チェック)。null = 未エントリー。';
