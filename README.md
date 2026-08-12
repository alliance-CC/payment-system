# Memoreal Payments — 継続課金 決済アプリ

**LPから申し込まれた後の「裏側」を担う決済システム + 登録者管理画面。**
LP (別プロジェクト: `alliance-CC/kurashi-anshin-lp`) の申込ボタンが本アプリの
`/subscribe?plan=…` (絶対URL) へ遷移してくる。

```
LP (別プロジェクト) ──申込ボタン──▶ /subscribe?plan=…
   ① プラン確認 → ② 利用規約+同意+氏名/電話 → ③ カード → 決済登録(VeriTrans 4G)
   → 無料期間(既定2ヶ月・申込月含む)後、日次Cronが会員ID都度決済で毎月課金
   → CRM(共有Supabase)へ反映 + alliance@lifeap.co へ申込通知

トップ(/) ──▶ /admin 登録者管理ボード (パスワードログイン)
```

## 役割分担

| | このアプリ (payment-system) | LP (kurashi-anshin-lp) | CRM (Memolyze.app) |
|---|---|---|---|
| 面 | 申込/規約/決済API/課金Cron + **登録者管理画面** | 集客・商品訴求 | 社内の案件・顧客管理 |
| トップ | `/admin` ログイン | LP本体 | CRMログイン |
| DB | **当面CRMと同じSupabaseを共有** (将来分離) | なし | 同左 (スキーマ管理はCRM側) |

## ルート

- `/` → `/admin` (未認証は `/admin/login`)
- `/admin` — **登録者管理ボード**: 申込日/会員ID/プラン/利用開始日/課金開始日/解約日/
  支払方法/状況(利用前・利用中・解約・申込未完了)/氏名・電話・メール/規約同意/当月課金状況
  (正常・決済不備・確認中・未課金・対象外)。月フィルタ・要注意ハイライト・解約操作
  - **申込未完了** = 初回登録取引が未確定のまま (3DS 認証画面での離脱等)。決済登録が
    済んでいないため課金されない。正常な「利用前」と混ざらないよう分けて表示する
- `/subscribe` `/subscribe/update-card` — 申込・カード更新 (LPからの着地先)
- `/legal/terms` `/legal/tokusho` — 利用規約 / 特定商取引法に基づく表記
- `/api/payments/veritrans/*` — 決済API / `/api/payments/cron/charge` — 日次課金 (10:00 JST)
- `/api/payments/cron/mpi-sweep` — 放置された3DS申込の片付け。認証画面で離脱されると
  結果が返らず「確認中」が残り続けるため、VeriTrans へ照会して確定させる。対象は申込時の
  0円与信のみで、金額ありの在疑義には触れない (二重課金を避け手動確定に委ねる)。
  Vercel Hobby は cron 2本・日次のみのため専用 cron は登録せず、日次課金 Cron が
  実行前に同じ処理を呼ぶ。この口は手動実行用 (Pro なら毎時 cron に登録すると復旧が早い)

カード番号等の決済個人情報はブラウザ→VeriTrans直送で、本アプリのサーバー・DB・ログ・
管理画面のいずれにも保持しない。

## 開発

```bash
npm install
cp .env.example .env.local   # 値を設定 (ADMIN_PASSWORD 必須)
npm run dev                  # http://localhost:3000 → /admin
npm test / npm run typecheck / npm run build
```

## デプロイ (Vercel)

1. GitHub リポジトリを Vercel に Import (push で自動デプロイ)
2. Environment Variables を設定 — `.env.example` 参照。特に:
   - Supabase 3値 (CRMと同じプロジェクトの値)
   - VeriTrans 3値 (テスト利用情報通知書)
   - `ADMIN_PASSWORD` (管理ボード) / `CRON_SECRET`
   - `PAYMENTS_NOTIFY_EMAIL=alliance@lifeap.co` + `SMTP_*` (申込通知)
3. Cron は `vercel.json` で自動登録

## LP との連携 (LP側の実装メモ)

LP の「このプランで申し込む」ボタンを本アプリの本番URLへ:

```html
<a href="https://<payment-system のドメイン>/subscribe?plan=plus">このプランで申し込む</a>
<a href="https://<payment-system のドメイン>/subscribe?plan=premium">このプランで申し込む</a>
```

プランIDは `features/payments/plans.ts` (`VT_PLANS_JSON` で上書き可) と一致させること。

## 決済の実機検証

VeriTrans 検証環境(`api3.veritrans.co.jp`)へ到達できる環境で、テスト利用情報通知書の
3値を設定して `/subscribe` を実行する。検証環境のテストカード例: `4111 1111 1111 1111`。
