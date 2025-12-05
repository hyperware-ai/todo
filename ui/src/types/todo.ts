import { Todo as BackendTodo } from '#caller-utils';

export type Entry = BackendTodo.Entry;
export type Note = BackendTodo.Note;
export type EntryTimescale = BackendTodo.EntryTimescale;
export type ViewName = 'chat' | 'todo' | 'notes';
export type NoteEditorTab = 'content' | 'metadata';
export type EntryEditMode = 'view' | 'edit';

export interface TimescaleDefinition {
  key: EntryTimescale;
  label: string;
  blurb: string;
  accent: string;
}

export const TIMESCALES: TimescaleDefinition[] = [
  {
    key: BackendTodo.EntryTimescale.Overdue,
    label: 'Catch up',
    blurb: 'Anything that slipped past the due time',
    accent: 'var(--rose-500)',
  },
  {
    key: BackendTodo.EntryTimescale.Today,
    label: 'Today',
    blurb: 'Focus lane for the current day',
    accent: 'var(--iris-500)',
  },
  {
    key: BackendTodo.EntryTimescale.ThisWeek,
    label: 'This week',
    blurb: 'Still in the sprint window',
    accent: 'var(--amber-500)',
  },
  {
    key: BackendTodo.EntryTimescale.ThisMonth,
    label: 'This month',
    blurb: 'Coming up soon, still flexible',
    accent: 'var(--cyan-500)',
  },
  {
    key: BackendTodo.EntryTimescale.Later,
    label: 'Later',
    blurb: 'Queued, but not urgent',
    accent: 'var(--slate-500)',
  },
  {
    key: BackendTodo.EntryTimescale.Someday,
    label: 'Someday',
    blurb: 'Ideas without hard dates',
    accent: 'var(--mauve-500)',
  },
];

export const COMPLETED_SECTION = {
  key: BackendTodo.EntryTimescale.Completed,
  label: 'Recently',
  blurb: 'Recently completed entries',
  accent: 'var(--green-500)',
};

export const ARCHIVED_SECTION = {
  label: 'Archive',
  blurb: 'Archived entries',
  accent: 'var(--slate-500)',
};

export interface SectionGroup {
  definition: TimescaleDefinition;
  entries: Entry[];
}

export const ACTIVE_VIEWS: { key: ViewName; label: string }[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'todo', label: 'TODO' },
  { key: 'notes', label: 'Notes' },
];

export interface SearchAllResult {
  entries: Entry[];
  notes: Note[];
}
