// 커밋 SHA로 고정한 GitHub 링크. 저장소가 바뀌어도 같은 내용을 가리킨다 (FR-017, FR-024).

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export function blobUrl(owner: string, name: string, commitSha: string, path: string): string {
  return `https://github.com/${owner}/${name}/blob/${commitSha}/${encodePath(path)}`;
}

export function lineUrl(owner: string, name: string, commitSha: string, path: string, startLine: number, endLine: number): string {
  const anchor = startLine === endLine ? `#L${startLine}` : `#L${startLine}-L${endLine}`;
  return `${blobUrl(owner, name, commitSha, path)}${anchor}`;
}
