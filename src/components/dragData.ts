export type DragSource =
  | { kind: 'hand' }
  | { kind: 'board'; x: number; y: number };

const MIME = 'application/x-card-source';

export function setDragSource(e: React.DragEvent, source: DragSource): void {
  e.dataTransfer.setData(MIME, JSON.stringify(source));
  e.dataTransfer.setData('text/plain', JSON.stringify(source));
  e.dataTransfer.effectAllowed = 'move';
}

export function getDragSource(e: React.DragEvent): DragSource | null {
  const raw = e.dataTransfer.getData(MIME) || e.dataTransfer.getData('text/plain');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragSource;
  } catch {
    return null;
  }
}
