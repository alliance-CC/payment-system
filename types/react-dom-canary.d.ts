// Next.js の App Router は React canary を同梱しており、useFormStatus が使える。
// ただし @types/react-dom の既定 (index.d.ts) には型が無く、canary.d.ts 側にある。
// 型だけをプロジェクト全体に読み込む (実行時には何も増えない)。
/// <reference types="react-dom/canary" />
