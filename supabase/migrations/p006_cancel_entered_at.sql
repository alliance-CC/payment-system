-- payment-system 固有マイグレーション: 契約に「解約エントリー済み日時」を追加。
-- 用途: 先方システム(nuworks)へ解約を入れた案件を記録し、入れ忘れた日の解約を次の回に拾えるようにする。
--       エンカンAIが一括解約を入れ終わったあとに立てる。管理画面からも手動で立てる/外せる。
--
-- 注意: payment_contracts は当面 CRM(Memolyze.app)と同じ Supabase を共有するテーブル。
--       追加のみ・冪等なので既存データ/CRM 側に影響しない。Supabase の SQL Editor で一度実行すること。
alter table if exists public.payment_contracts
  add column if not exists cancel_entered_at timestamptz;

comment on column public.payment_contracts.cancel_entered_at is
  '先方システムへ解約を入れた日時。null = 解約未エントリー (解約済みの案件のみ意味を持つ)。';

-- 2026-09-30 (JST) までの解約は、すでに手で先方へ入れてある (担当者確認 2026-09-30)。
-- 実行した日に関係なく、この日までの解約だけを「解約エントリー済み」にする (何度実行しても同じ)。
update public.payment_contracts
   set cancel_entered_at = '2026-09-30T15:00:00Z'
 where canceled_at is not null
   and canceled_at < '2026-09-30T15:00:00Z'
   and cancel_entered_at is null;
