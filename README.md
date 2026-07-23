# Memoreal Payments — 継続課金 決済アプリ

CRM 本体から分離した、**公開の決済(継続課金)アプリ**。
「ストック商材LP → 利用規約 → 決済登録(VeriTrans 4G) → CRM反映」を担う。

```
LP (/lp) → /subscribe?plan=… → 会員登録+カード登録(無料期間中は課金なし)
        → 無料期間終了後 日次Cronが会員ID都度決済 → CRM(payment_contracts等)へ反映
```

## 構成 (CRM との関係)

| | このアプリ (memoreal-payments) | CRM 本体 (Memoreal) |
|---|---|---|
| 面 | 公開: LP / 申込 / 規約 / 決済API / 課金Cron | 社内: 案件・顧客・レポート等 + 契約管理(/admin/payments) |
| 認証 | 不要 (公開申込 + CRON_SECRET) | Supabase 認証 + RLS |
| デプロイ | 独立 Vercel プロジェクト | 別 Vercel プロジェクト |
| DB | **当面は CRM と同じ Supabase を共有** (将来 別プロジェクトへ) | 同左 |

DB スキーマ(マイグレーション)は CRM 側リポジトリが管理する。本アプリは
`payment_contracts` / `payment_charges` / `payment_consents` と、顧客照合用に
`customers` / `deals` / `deal_customers` / `tenants` / `integrations` を service_role で読み書きする。

## ルート

- `/lp` — ストック商材LP (`public/lp/index.html`)
- `/subscribe` — 申込フロー(①プラン ②利用規約+同意+お客様情報 ③カード → 決済登録)
- `/subscribe/update-card` — カード更新
- `/legal/terms` `/legal/tokusho` — 利用規約 / 特定商取引法に基づく表記
- `/api/payments/veritrans/subscribe` `/update-card` `/mpi-result` — 決済API
- `/api/payments/cron/charge` — 日次課金 (Vercel Cron / `vercel.json`、10:00 JST)

## 開発

```bash
npm install
cp .env.example .env.local   # 値を設定
npm run dev                  # http://localhost:3000/lp
npm test                     # vitest (モックVeriTransでの機械検証)
npm run typecheck
npm run build
```

## デプロイ (Vercel)

1. この GitHub リポジトリを Vercel の新規プロジェクトとして Import
2. Environment Variables に `.env.example` のキーを設定
   (Supabase 3値は CRM と同じプロジェクトの値、VeriTrans 3値はテスト利用情報通知書)
3. Cron は `vercel.json` の定義で自動登録される (`CRON_SECRET` を設定)

## 決済の実機検証

VeriTrans 検証環境(`api3.veritrans.co.jp`)へ到達できる環境で、
テスト利用情報通知書の3値を設定して `/subscribe` を実行する。詳細な手順・
テストカード・SPEC_CHECK は CRM 側 `docs/` の決済ドキュメントを参照。
