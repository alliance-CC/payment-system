// Supabase 未接続でも UI を確認できるよう、最低限のモックデータを提供する。
// Phase A 以降は案件パターン (deal_templates) 中心の設計に再構成済み。
// 実際に DB から読まれるデータは Supabase 側に作成する。ここは shape の参考と
// auth fallback の demo profile を提供するだけ。
//
// 本番では一切使われない (env が揃った時点でフォールバックは無効)。

export const isDemo = () =>
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_URL.includes("example.supabase.co");

const PROFILE = {
  id: "demo-user",
  full_name: "デモ ユーザー",
  role: "admin" as const,
  team: "営業1課",
  extension: "101",
  user_type: "internal" as const,
  client_company_id: null as string | null,
  client_store_id: null as string | null,
};

// ─── 案件パターン (deal_templates) — Phase A 以降の単一ソース ──────────
const DEAL_TEMPLATES = [
  {
    id: "tpl_resident", name: "入居者案件", is_active: true, sort_order: 1,
    default_status: "申込",
    default_data: {
      statuses: ["申込", "確認中", "営業中", "成約", "失注"],
      products: ["電気", "ガス", "通信", "引越し", "ウォーターサーバー"],
      pickup_fields: ["product_type", "request_date", "movein_date"],
      sections: [
        { title: "入居者情報", width: "full", fields: [
          { key: "tenant_name", label: "入居者氏名", type: "text", required: true, width: "half", pickup: false },
          { key: "tenant_phone", label: "電話番号", type: "text", required: false, width: "half", pickup: false },
          { key: "tenant_email", label: "メール", type: "text", required: false, width: "half", pickup: false },
        ]},
        { title: "案件詳細", width: "full", fields: [
          { key: "product_type", label: "商材", type: "select", options: ["電気","ガス","通信","引越し","ウォーターサーバー"], required: true, width: "third", pickup: true },
          { key: "request_date", label: "依頼日", type: "date", required: false, width: "third", pickup: true },
          { key: "movein_date",  label: "入居日", type: "date", required: false, width: "third", pickup: true },
        ]},
      ],
      flags: [
        { label: "ライフライン取次状況", items: ["電気", "ガス", "通信"] },
      ],
      validations: [],
    },
  },
  {
    id: "tpl_referrer", name: "送客元案件", is_active: true, sort_order: 2,
    default_status: "登録",
    default_data: {
      statuses: ["登録", "稼働中", "停止"],
      products: [],
      pickup_fields: ["store_name", "manager_name", "phone"],
      sections: [
        { title: "送客元情報", width: "full", fields: [
          { key: "store_name", label: "店舗名", type: "text", required: true, width: "half", pickup: true },
          { key: "manager_name", label: "担当者", type: "text", required: false, width: "half", pickup: true },
          { key: "phone", label: "電話", type: "text", required: false, width: "half", pickup: true },
          { key: "email", label: "メール", type: "text", required: false, width: "half", pickup: false },
        ]},
      ],
      flags: [], validations: [],
    },
  },
  {
    id: "tpl_parent", name: "親会社案件", is_active: true, sort_order: 3,
    default_status: "契約中",
    default_data: {
      statuses: ["契約中", "停止"],
      products: [],
      pickup_fields: ["company_name", "representative"],
      sections: [
        { title: "親会社情報", width: "full", fields: [
          { key: "company_name", label: "会社名", type: "text", required: true, width: "half", pickup: true },
          { key: "representative", label: "代表者", type: "text", required: false, width: "half", pickup: true },
          { key: "headquarters_address", label: "本社住所", type: "text", required: false, width: "full", pickup: false },
        ]},
      ],
      flags: [], validations: [],
    },
  },
];

// ─── パターン間 Lookup 定義 ──────────────────────────────────────────
const PATTERN_LOOKUPS = [
  // 入居者案件 → 送客元案件
  {
    id: "pl1", from_template_id: "tpl_resident", to_template_id: "tpl_referrer",
    lookup_key: "referrer_source", lookup_label: "送客元",
    pickup_fields: ["store_name", "manager_name", "phone"],
    required: true, sort_order: 0,
  },
  // 送客元案件 → 親会社案件
  {
    id: "pl2", from_template_id: "tpl_referrer", to_template_id: "tpl_parent",
    lookup_key: "parent_company", lookup_label: "親会社",
    pickup_fields: ["company_name", "representative"],
    required: false, sort_order: 0,
  },
];

// ─── 案件 (deals) — template_id を持つ ───────────────────────────────
const DEALS = [
  { id: "d_parent_1", template_id: "tpl_parent", deal_uid: "PAR0000000000001",
    title: "アパマンショップ 関東本部", status: "契約中", amount: 0, contract_date: null,
    assigned_to: "demo-user", archived_at: null,
    updated_at: "2026-05-01T00:00:00Z", created_at: "2026-04-01T00:00:00Z" },
  { id: "d_ref_1", template_id: "tpl_referrer", deal_uid: "REF0000000000001",
    title: "新宿店", status: "稼働中", amount: 0, contract_date: null,
    assigned_to: "demo-user", archived_at: null,
    updated_at: "2026-05-10T00:00:00Z", created_at: "2026-04-10T00:00:00Z" },
  { id: "d_tenant_1", template_id: "tpl_resident", deal_uid: "RSD0000000000001",
    title: "田中様 電気切替", status: "成約", amount: 24000, contract_date: "2026-05-10",
    assigned_to: "demo-user", archived_at: null,
    updated_at: "2026-05-13T09:00:00Z", created_at: "2026-05-01T00:00:00Z" },
  { id: "d_tenant_2", template_id: "tpl_resident", deal_uid: "RSD0000000000002",
    title: "高橋様 通信契約", status: "営業中", amount: 36000, contract_date: null,
    assigned_to: "demo-user", archived_at: null,
    updated_at: "2026-05-12T09:00:00Z", created_at: "2026-05-05T00:00:00Z" },
];

// ─── 案件間リンク実体 (deal_lookups) ────────────────────────────────
const DEAL_LOOKUPS = [
  { id: "dl1", from_deal_id: "d_tenant_1", lookup_key: "referrer_source", to_deal_id: "d_ref_1" },
  { id: "dl2", from_deal_id: "d_tenant_2", lookup_key: "referrer_source", to_deal_id: "d_ref_1" },
  { id: "dl3", from_deal_id: "d_ref_1",    lookup_key: "parent_company",  to_deal_id: "d_parent_1" },
];

// ─── 案件のカスタムフィールド値 (deal_custom_fields) ─────────────────
const DEAL_CUSTOM_FIELDS: { deal_id: string; field_key: string; value: string }[] = [
  // 親会社
  { deal_id: "d_parent_1", field_key: "company_name",        value: "アパマンショップ 関東本部" },
  { deal_id: "d_parent_1", field_key: "representative",      value: "本部 太郎" },
  // 送客元
  { deal_id: "d_ref_1", field_key: "store_name",   value: "新宿店" },
  { deal_id: "d_ref_1", field_key: "manager_name", value: "新宿 店長" },
  { deal_id: "d_ref_1", field_key: "phone",        value: "03-0000-0001" },
  // 入居者1
  { deal_id: "d_tenant_1", field_key: "tenant_name",   value: "田中 大輔" },
  { deal_id: "d_tenant_1", field_key: "tenant_phone",  value: "090-1111-2222" },
  { deal_id: "d_tenant_1", field_key: "product_type",  value: "電気" },
  { deal_id: "d_tenant_1", field_key: "request_date",  value: "2026-05-01" },
  { deal_id: "d_tenant_1", field_key: "movein_date",   value: "2026-05-10" },
  // 入居者2
  { deal_id: "d_tenant_2", field_key: "tenant_name",   value: "高橋 美咲" },
  { deal_id: "d_tenant_2", field_key: "tenant_phone",  value: "090-3333-4444" },
  { deal_id: "d_tenant_2", field_key: "product_type",  value: "通信" },
  { deal_id: "d_tenant_2", field_key: "request_date",  value: "2026-05-05" },
];

const NOTES: any[] = [
  { id: "n1", deal_id: "d_tenant_1", kind: "stickynote", color: "#FDE68A", body: "本日中に書類確認！", author_id: "demo-user", created_at: "2026-05-13T08:00:00Z" },
];

const CALLS = [
  { id: "k1", deal_id: "d_tenant_1", customer_id: null, agent_id: "demo-user", direction: "outbound", result: "answered", duration_sec: 120, started_at: "2026-05-13T08:30:00Z", ended_at: "2026-05-13T08:32:00Z", created_at: "2026-05-13T08:30:00Z", bluebean_call_id: "bb_1" },
];

const FEE_PLANS = [
  { id: "fp1", client_company_id: null, client_store_id: null, product_type: "電気", fee_type: "open_base", unit_amount: 5000, trigger_status: "成約", active: true, note: "電気成約 5,000円", created_at: "2026-04-01T00:00:00Z" },
];

const INTEGRATIONS = [
  { id: "ig1", provider: "bluebean", label: "default", config: { base_url: "https://api.bluebean.example.com" }, secret: { token: "******", webhook_secret: "******" }, is_active: true, updated_at: "2026-05-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z" },
];

const TEMPLATES = [
  { id: "mt1", scenario: "thanks_won",  product_type: "電気", channel: "sms",   body: "{{customer_name}} 様\n{{store_name}}様からのご紹介の電気契約、ありがとうございます。手続きを進めます。", created_at: "2026-04-01T00:00:00Z" },
  { id: "mt2", scenario: "thanks_lost", product_type: null,   channel: "email", body: "{{customer_name}} 様\nこの度はご案内のお時間をいただきありがとうございました。", created_at: "2026-04-01T00:00:00Z" },
];

const SETTLEMENTS = [
  { id: "st1", period: "2026-04", client_company_id: null, client_store_id: null, status: "approved", total_amount: 25000, approved_at: "2026-05-01T00:00:00Z", published_at: null, created_at: "2026-04-30T00:00:00Z", client_companies: null, client_stores: null },
];

// ─── 外部メイン画面レイアウト (Phase C) ─────────────────────────────
const EXTERNAL_LAYOUTS = [
  {
    id: "ext1", tenant_id: "demo-tenant", scope_type: "tenant", scope_value: null,
    name: "デフォルト", is_active: true,
    blocks: [
      { id: "b1", type: "heading", width: "full", config: { text: "ようこそ", level: 1 } },
      { id: "b2", type: "announcement", width: "full", config: { title: "重要なお知らせ", body: "月次精算は毎月10日締めです。", tone: "info" } },
      { id: "b3", type: "kpi", width: "quarter", config: { template_id: "tpl_resident", metric: "count",     label: "入居者案件 (全期間)", scope: "all", tone: "info" } },
      { id: "b4", type: "kpi", width: "quarter", config: { template_id: "tpl_resident", metric: "won_count", label: "成約数", scope: "all", tone: "success" } },
      { id: "b5", type: "kpi", width: "quarter", config: { template_id: "tpl_resident", metric: "win_rate",  label: "成約率", scope: "all", tone: "info" } },
      { id: "b6", type: "kpi", width: "quarter", config: { template_id: "tpl_resident", metric: "sum_amount",label: "金額合計", scope: "all", tone: "neutral" } },
      { id: "b7", type: "deal_list", width: "full", config: { template_id: "tpl_resident", title: "最新の入居者案件", max_rows: 10, show_status: true, show_amount: true, scope: "all" } },
    ],
  },
];

// ─── タブ (Phase B / pinned_items テーブル) ─────────────────────────
const TABS = [
  { id: "tab1", user_id: "demo-user", tenant_id: "demo-tenant", href: "/deals?template=tpl_resident", label: "入居者案件", kind: "pattern",   is_pinned: true,  position: 0, last_opened_at: "2026-05-13T10:00:00Z", scope: "personal", created_at: "2026-05-01T00:00:00Z" },
  { id: "tab2", user_id: "demo-user", tenant_id: "demo-tenant", href: "/deals?template=tpl_referrer", label: "送客元案件", kind: "pattern",   is_pinned: true,  position: 1, last_opened_at: "2026-05-13T09:00:00Z", scope: "personal", created_at: "2026-05-01T00:00:00Z" },
  { id: "tab3", user_id: "demo-user", tenant_id: "demo-tenant", href: "/deals/d_tenant_1",            label: "田中様 電気切替", kind: "deal",   is_pinned: false, position: 0, last_opened_at: "2026-05-13T10:30:00Z", scope: "personal", created_at: "2026-05-13T10:30:00Z" },
];

export const demo = {
  profile: () => PROFILE,
  deals: () => DEALS,
  deal:  (id: string) => DEALS.find(d => d.id === id) ?? null,
  dealTemplates: () => DEAL_TEMPLATES,
  patternLookups: () => PATTERN_LOOKUPS,
  dealLookups: () => DEAL_LOOKUPS,
  dealCustomFields: (id?: string) => id ? DEAL_CUSTOM_FIELDS.filter(c => c.deal_id === id) : DEAL_CUSTOM_FIELDS,
  notes: (dealId: string) => NOTES.filter(n => n.deal_id === dealId),
  calls: (dealId?: string) => dealId ? CALLS.filter(c => c.deal_id === dealId) : CALLS,
  users: () => [
    { id: "demo-user",  full_name: "デモ ユーザー",   role: "admin", team: "営業1課", extension: "101", is_active: true, user_type: "internal", client_company_id: null, client_store_id: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "demo-user2", full_name: "高橋 マネージャー", role: "leader", team: "営業1課", extension: "102", is_active: true, user_type: "internal", client_company_id: null, client_store_id: null, created_at: "2026-01-05T00:00:00Z" },
    { id: "demo-user3", full_name: "新人 アルバイト", role: "ippan", team: "営業2課", extension: "201", is_active: true, user_type: "internal", client_company_id: null, client_store_id: null, created_at: "2026-04-01T00:00:00Z" },
  ],
  audit: () => [
    { id: 1, action: "update", target_table: "deals", target_id: "d_tenant_1", created_at: "2026-05-13T09:00:00Z", profiles: { full_name: "デモ ユーザー" } },
  ],
  feePlans: () => FEE_PLANS,
  integrations: () => INTEGRATIONS,
  templates: () => TEMPLATES,
  settlements: () => SETTLEMENTS,
  externalLayouts: () => EXTERNAL_LAYOUTS,
  tabs: () => TABS,
  invitations: () => [],
};
