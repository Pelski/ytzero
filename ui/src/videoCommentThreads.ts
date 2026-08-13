import type { VideoComment, VideoCommentSort } from "./api";

export interface VideoCommentThread {
  comment: VideoComment;
  replies: VideoCommentThread[];
}

export function buildVideoCommentThreads(comments: VideoComment[], sort: VideoCommentSort): VideoCommentThread[] {
  const byId = new Map<string, VideoCommentThread>();
  const ordered: VideoCommentThread[] = [];
  for (const comment of comments) {
    if (byId.has(comment.id)) continue;
    const thread = { comment, replies: [] } satisfies VideoCommentThread;
    byId.set(comment.id, thread);
    ordered.push(thread);
  }

  const roots: VideoCommentThread[] = [];
  for (const thread of ordered) {
    const parent = thread.comment.parent && thread.comment.parent !== "root"
      ? byId.get(thread.comment.parent)
      : undefined;
    if (!parent) {
      roots.push(thread);
      continue;
    }

    let ancestor: VideoCommentThread | undefined = parent;
    const visited = new Set<string>();
    let cyclic = false;
    while (ancestor && !visited.has(ancestor.comment.id)) {
      if (ancestor.comment.id === thread.comment.id) {
        cyclic = true;
        break;
      }
      visited.add(ancestor.comment.id);
      const parentId: string | null = ancestor.comment.parent;
      ancestor = parentId && parentId !== "root" ? byId.get(parentId) : undefined;
    }
    if (cyclic) roots.push(thread);
    else parent.replies.push(thread);
  }

  return roots.map((thread, index) => ({ thread, index })).sort((left, right) => {
    const difference = sort === "new"
      ? (right.thread.comment.timestamp ?? -1) - (left.thread.comment.timestamp ?? -1)
      : right.thread.comment.likeCount - left.thread.comment.likeCount;
    return difference || left.index - right.index;
  }).map(({ thread }) => thread);
}
