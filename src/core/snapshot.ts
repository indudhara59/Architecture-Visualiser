import { ArchGraph, Snapshot, SnapshotDiff } from './types';

export function toSnapshot(graph: ArchGraph): Snapshot {
  return {
    savedAt: new Date().toISOString(),
    files: graph.files.map((f) => f.path).sort(),
    componentEdges: graph.componentEdges.map(({ from, to, count }) => ({ from, to, count })),
    fileEdges: graph.fileEdges.map(({ from, to }) => ({ from, to })),
  };
}

export function diffSnapshot(prev: Snapshot, graph: ArchGraph): SnapshotDiff {
  const key = (e: { from: string; to: string }) => `${e.from}\u0000${e.to}`;
  const setDiff = <T>(a: T[], b: T[], k: (x: T) => string) => {
    const bs = new Set(b.map(k));
    return a.filter((x) => !bs.has(k(x)));
  };
  const curFiles = graph.files.map((f) => f.path);
  const id = (s: string) => s;
  return {
    savedAt: prev.savedAt,
    addedFiles: setDiff(curFiles, prev.files, id),
    removedFiles: setDiff(prev.files, curFiles, id),
    addedFileEdges: setDiff(graph.fileEdges, prev.fileEdges, key).map(({ from, to }) => ({ from, to })),
    removedFileEdges: setDiff(prev.fileEdges, graph.fileEdges, key),
    addedComponentEdges: setDiff(graph.componentEdges, prev.componentEdges, key).map(({ from, to }) => ({ from, to })),
    removedComponentEdges: setDiff(prev.componentEdges, graph.componentEdges, key).map(({ from, to }) => ({ from, to })),
  };
}
