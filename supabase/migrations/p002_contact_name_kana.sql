-- フリガナ(カタカナ) 保存用の列を payment_contracts に追加する。
-- 申込フォームで「セイ・メイ」を必須入力し、管理ボード・通知メールに反映する。
-- Supabase SQL Editor でこの1文を実行してください (既存行は NULL のまま)。
alter table payment_contracts add column if not exists contact_name_kana text;
