import { createHash } from "node:crypto";

// 접속 출처 식별 (research R16). 원본 IP는 저장하지 않고 비밀값을 섞은 해시만 남긴다.

export function hashClientKey(ip: string, salt: string): string {
  return createHash("sha256").update(`${ip}|${salt}`).digest("hex");
}
