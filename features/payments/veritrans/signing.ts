// VeriTrans 4G OPEN API — リクエスト署名 (§3) の純関数部。
// client.ts (サーバー専用) から使う。テスト可能にするためここに分離している。
//
// ⚠️ 典型バグ (§3): authHash に使う minify(params) 文字列と、実際に送信する
//    params 部分の文字列は「バイト単位で完全一致」させること。
//    → minify 文字列を 1 度だけ作り、hash 計算にも body 生成にも使い回す。
import { createHash, timingSafeEqual } from "crypto";

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

// --- 結果通知(PUSH) / ブラウザ復帰の改ざんチェック (3DS 開発ガイド 4-5 / 4.4.1) ---
//
// 決済サーバーは結果連携時に vAuthInfo を付与する:
//   vAuthInfo = SHA-256( merchantCcid + 「値」の連結文字列 + merchantKey ) の hex。
//   ・連結順は authParams が示す (パラメータ名のカンマ区切りを Base64 したもの)。
//   ・連結するのは「値」のみ (パラメータ名・区切り文字は含めない)。UTF-8 でバイト化。
//   ・個数と順序は固定ではないため、受信のたびに authParams を見て動的に組み立てること。
// これを検証しない限り mpiMstatus / cardMstatus 等の結果は信用してはならない
// (第三者が pushUrl / redirectionUri を直接叩いて「成功」を詐称できてしまうため)。
export type PushHashResult = {
  /** 改ざんチェック成功 (受信 vAuthInfo と再計算が一致) */
  ok: boolean;
  /** 再計算したハッシュ (デバッグ用。ログには出さないこと) */
  expected: string;
  /** 受信した vAuthInfo (小文字化) */
  actual: string;
  /** authParams をデコードして得た連結順 */
  order: string[];
};

export function verifyPushHash(
  received: Record<string, string | null | undefined>,
  merchantCcid: string,
  merchantKey: string,
): PushHashResult {
  const actual = String(received.vAuthInfo ?? "").toLowerCase();
  let order: string[] = [];
  try {
    order = Buffer.from(String(received.authParams ?? ""), "base64")
      .toString("utf8")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    order = [];
  }
  // authParams 順にパラメータ「値」のみを連結 (未受信キーは空文字)。
  const concatenated = order.map((name) => String(received[name] ?? "")).join("");
  const expected = createHash("sha256")
    .update(merchantCcid + concatenated + merchantKey, "utf8")
    .digest("hex");
  const ok =
    order.length > 0 &&
    actual.length === expected.length &&
    (() => {
      try {
        return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
      } catch {
        return false;
      }
    })();
  return { ok, expected, actual, order };
}
