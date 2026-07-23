import { redirect } from "next/navigation";

// 決済アプリのトップは管理画面 (未認証なら /admin/login へ)。
// 一般利用者は LP (別プロジェクト) から /subscribe?plan=… へ直接遷移してくる。
export default function Home() {
  redirect("/admin");
}
