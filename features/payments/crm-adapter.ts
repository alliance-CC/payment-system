// CRM アダプタ (§1.2 OEM 方針「接続口(アダプタ)を固定」)。
//
// 決済モジュールが CRM に触れるのは、この少数の決まった関数だけ。
// CRM 本体(または OEM 先)がこのインターフェースを実装すれば、別テナントでも
// 同じ決済モジュールをそのまま接続できる。決済モジュールは CRM の内部構造を知らない。
//
// ⚠️ 決済モジュールに「渡さない」もの (§5・セキュリティ): カード番号・有効期限・
//    セキュリティコード・生口座番号・秘密鍵・authHash・Token Api Key。
//    CRM が持つのは「種別」と「会員ID」と契約状態のみ。

export type ConsentRecord = {
  acceptedAt: string;      // ISO
  termsVersion: string;
  planId: string;
  paymentMethod: "card" | "bank";
  ip?: string;
  userAgent?: string;
};

export type ContractState = {
  accountId: string;               // 会員ID (共通キー §5)
  planId: string;
  paymentMethod: "card" | "bank";
  status: "active" | "delinquent" | "suspended" | "canceled" | "failed";
  nextChargeDate?: string;         // ISO (継続課金 §5-②)。初回与信のみの段階では未使用
  lastResult?: { vResultCode: string | null; at: string };
  orderId?: string;                // VeriTrans↔CRM 結合キー
};

// 顧客照合キー (§5・§10)。正確なキーは要確定 (電話+氏名 / メール / 案件ID埋め込み)。
export type MatchKey = {
  phone?: string;
  name?: string;
  email?: string;
  caseId?: string;                 // 申込リンクに埋めた案件ID (?case=...)
};

// 決済モジュールが要求する CRM 側の最小インターフェース。
export interface CrmAdapter {
  // 照合 → あれば取得 / 無ければ新規作成 (オープン申込 upsert §5)。顧客ID を返す。
  upsertCustomer(key: MatchKey): Promise<string>;
  // 契約状態を更新 (契約プラン・会員ID・ステータス・日付)。
  updateContract(customerId: string, state: ContractState): Promise<void>;
  // 同意を記録 (履歴保存 §1.1-2)。
  recordConsent(customerId: string, consent: ConsentRecord): Promise<void>;
}

// ---- Supabase (Memolyze CRM) 実装 (§6-6) ----------------------------------
// 弊社=最初のテナント (§1.2)。OEM 先は同インターフェースの別実装を差し替え可能。
//
// 照合ポリシー (§5・§10 要確定):
//   1. caseId (申込リンク ?case=案件ID) があれば deals → deal_customers から顧客を特定
//   2. 電話番号の正規化一致 (自テナント内)
//   3. 見つからなければ customers を新規作成 (オープン申込 upsert)
// 契約状態そのもの (§5: 契約状態/次回課金日/会員ID/最新結果) は payment_contracts が
// 一次ソース。customers 側は照合・表示用の緩い紐付けとする。

import { createSupabaseService } from "@/shared/db/service";

function normalizePhone(s: string): string {
  return (s ?? "").replace(/[^0-9]/g, "").replace(/^81/, "0");
}

export function supabaseCrmAdapter(tenantId: string): CrmAdapter {
  const service = createSupabaseService();
  return {
    async upsertCustomer(key: MatchKey): Promise<string> {
      // 1. 案件ID埋め込み (?case=...) からの特定 (§5: 照合精度向上策)
      if (key.caseId) {
        const { data: dc } = await service
          .from("deal_customers")
          .select("customer_id, deals!inner(tenant_id)")
          .eq("deal_id", key.caseId)
          .limit(1);
        const hit = (dc ?? []).find((r: any) => r.deals?.tenant_id === tenantId);
        if (hit?.customer_id) return hit.customer_id as string;
      }

      // 2. 電話番号照合 (正規化して完全一致・自テナント内)
      if (key.phone) {
        const norm = normalizePhone(key.phone);
        if (norm) {
          const { data: cands } = await service
            .from("customers")
            .select("id, phone")
            .eq("tenant_id", tenantId)
            .not("phone", "is", null)
            .limit(2000);
          const hit = (cands ?? []).find((c: any) => normalizePhone(c.phone) === norm);
          if (hit) return hit.id as string;
        }
      }

      // 3. 新規作成 (オープン申込 §0: CRM は関所にしない)
      const { data: created, error } = await service
        .from("customers")
        .insert({
          tenant_id: tenantId,
          name: key.name || key.phone || "申込顧客",
          phone: key.phone ?? null,
          email: key.email ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`customers insert failed: ${error.message}`);
      return (created as any).id as string;
    },

    async updateContract(customerId: string, state: ContractState): Promise<void> {
      // 契約状態の一次ソースは payment_contracts (features/payments/store.ts)。
      // ここでは顧客側に参照メモを残す (会員ID・プラン・状態 §5「CRMに渡す項目」)。
      const note =
        `【継続課金】会員ID: ${state.accountId} / プラン: ${state.planId} / ` +
        `支払: ${state.paymentMethod === "card" ? "クレジットカード" : "口座振替"} / 状態: ${state.status}` +
        (state.nextChargeDate ? ` / 次回課金日: ${state.nextChargeDate}` : "");
      await service
        .from("customers")
        .update({ memo: note })
        .eq("id", customerId)
        .eq("tenant_id", tenantId);
      // memo 更新の失敗で申込全体は失敗させない (結果は無視してよい)
    },

    async recordConsent(_customerId: string, _consent: ConsentRecord): Promise<void> {
      // 同意ログの実体は payment_consents (features/payments/store.ts insertConsent) に保存する。
      // このメソッドは OEM 先が CRM 側にも同意を写したい場合の拡張点として残す。
    },
  };
}
