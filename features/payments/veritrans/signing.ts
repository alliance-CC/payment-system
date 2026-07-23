// VeriTrans 4G OPEN API — リクエスト署名 (§3) の純関数部。
// client.ts (サーバー専用) から使う。テスト可能にするためここに分離している。
//
// ⚠️ 典型バグ (§3): authHash に使う minify(params) 文字列と、実際に送信する
//    params 部分の文字列は「バイト単位で完全一致」させること。
//    → minify 文字列を 1 度だけ作り、hash 計算にも body 生成にも使い回す。
import { createHash } from "crypto";

export type SignedRequest = {
  /** params の minify 済み JSON (これが authHash の材料であり body の一部) */
  minified: string;
  /** SHA256(ccid + minified + key) の hex */
  authHash: string;
  /** URL エンコード前の JSON ボディ */
  json: string;
  /** 実際に送信するボディ (JSON 全体を URL エンコード §3-3) */
  body: string;
};

export function signVtRequest(
  params: Record<string, any>,
  merchantCcid: string,
  merchantKey: string,
): SignedRequest {
  // JSON.stringify の既定出力は区切り記号にスペースを挟まない
  // (Python の separators=(",", ":") と一致)。非ASCIIもエスケープしない (ensure_ascii=False 相当)。
  const minified = JSON.stringify(params);
  const authHash = createHash("sha256")
    .update(merchantCcid + minified + merchantKey, "utf8")
    .digest("hex");
  // params は再シリアライズせず、minified をそのまま埋め込む
  const json = `{"params":${minified},"authHash":"${authHash}"}`;
  return { minified, authHash, json, body: encodeURIComponent(json) };
}
