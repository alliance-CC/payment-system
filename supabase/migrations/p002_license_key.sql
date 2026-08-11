-- payment-system 固有マイグレーション: 契約に「ウイルスバスターのライセンスキー」を追加。
-- 用途: プレミアム申込時に連携スプレッドシート(ライセンスキータブ)から1件確保し、
--       付与したキーを契約に保持する (管理画面表示・エントリーCSV出力に使用)。
--
-- 注意: payment_contracts は当面 CRM(Memolyze.app)と同じ Supabase を共有するテーブル。
--       追加のみ・冪等なので既存データ/CRM 側に影響しない。Supabase の SQL Editor で一度実行すること。
--       (未適用でも申込・課金は動作する。ライセンスキーの保存/表示のみ行われない)
alter table if exists public.payment_contracts
  add column if not exists license_key text;

comment on column public.payment_contracts.license_key is
  'ウイルスバスターのライセンスキー (プレミアム申込時にスプレッドシートから付与)。プラスは null。';
