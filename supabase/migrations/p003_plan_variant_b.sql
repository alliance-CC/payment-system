-- payment-system 固有マイグレーション: 既存契約のプラン表記に社内区分「B」を付す。
--
-- 背景: まもるん無しの安価プラン(A)を追加したため、社内表記を A/B で区別する。
--   A … まもるん無し  (plusA=990円 / premiumA=1430円)
--   B … まもるん有り  (plus=1320円 / premium=1870円 ＝ 従来プラン)
-- 既存で獲得済みの契約はすべて B のため、plan_name に接尾辞 B を付ける。
--
-- ※ plan_id は変更しない (既存の LP リンク ?plan=plus と契約の紐付けをそのまま維持)。
-- ※ 顧客向けの表記は「暮らし安心プラス」のままで、A/B は管理画面・CSV・連携シート
--    などの社内表記にのみ現れる。
-- ※ 冪等: 既に A/B が付いている行は変更しない。Supabase の SQL Editor で一度実行すること。
update public.payment_contracts
   set plan_name = plan_name || 'B'
 where plan_name is not null
   and plan_name !~ '[AB]$';
