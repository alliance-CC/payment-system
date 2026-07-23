import { redirect } from "next/navigation";

// 決済アプリのルートはストック商材LPへ誘導する。
export default function Home() {
  redirect("/lp");
}
