import HyperwareClientApi from '@hyperware-ai/client-api';
import { create } from 'zustand';

import { ApiError, Todo } from '#caller-utils';
import { getNodeId, getProcessId, isHyperwareEnvironment } from '../types/global';
import type {
  Entry,
  EntryEditMode,
  Note,
  NoteEditorTab,
  ViewName,
} from '../types/todo';

const BASE_URL = import.meta.env.BASE_URL || '/';
if (typeof window !== 'undefined' && window.our) {
  window.our.process = BASE_URL.replace(/\//g, '');
}

const resolveNodeOrigin = () => {
  if (import.meta.env.VITE_NODE_URL) return import.meta.env.VITE_NODE_URL;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:8080';
};

const normalizeOrigin = (origin: string) => origin.replace(/\/$/, '');
const normalizeBasePath = (base: string) => (base === '/' ? '' : base.replace(/\/$/, ''));

const NODE_ORIGIN = normalizeOrigin(resolveNodeOrigin());
const BASE_PATH = normalizeBasePath(BASE_URL);
const PROXY_TARGET = `${NODE_ORIGIN}${BASE_PATH}`;
const WEBSOCKET_PATH = '/ws';
const WEBSOCKET_URL = `${PROXY_TARGET.replace(/^http/, 'ws')}${WEBSOCKET_PATH}`;

type ServerMessage =
  | { type: 'snapshot'; entries: Entry[]; notes: Note[] }
  | { type: 'entryUpdated'; entry: Entry }
  | { type: 'entryRemoved'; entryId: number }
  | { type: 'noteUpdated'; note: Note }
  | { type: 'noteRemoved'; noteId: number };

interface NoteMetadataPayload {
  title: string;
  tags: string[];
  pinned: boolean;
  linkedEntryIds: number[];
  accent?: string | null;
}

interface TodoStore {
  nodeId: string | null;
  isConnected: boolean;
  wsReady: boolean;
  entries: Entry[];
  notes: Note[];
  isLoading: boolean;
  error: string | null;
  isPublicMode: boolean;
  activeView: ViewName;
  selectedEntryId: number | null;
  selectedNoteId: number | null;
  entryEditMode: EntryEditMode;
  noteEditorTab: NoteEditorTab;
  initialize: () => void;
  fetchBootstrap: () => Promise<void>;
  connectRealtime: () => void;
  setActiveView: (view: ViewName) => void;
  setEntryEditMode: (mode: EntryEditMode) => void;
  setNoteEditorTab: (tab: NoteEditorTab) => void;
  openEntry: (entryId: number) => void;
  closeEntry: () => void;
  toggleEntryCompletion: (entryId: number, completed: boolean) => Promise<void>;
  saveEntry: (draft: Todo.EntryDraft) => Promise<void>;
  openNote: (noteId: number) => void;
  closeNote: () => void;
  createEntry: () => Promise<void>;
  createNote: () => Promise<void>;
  saveNoteContent: (noteId: number, content: string) => Promise<void>;
  saveNoteMetadata: (noteId: number, meta: NoteMetadataPayload) => Promise<void>;
  deleteNote: (noteId: number) => Promise<void>;
  deleteEntry: (entryId: number) => Promise<void>;
  archiveEntry: (entryId: number) => Promise<void>;
  setError: (error: string | null) => void;
}

let wsClient: HyperwareClientApi | null = null;

export const useTodoStore = create<TodoStore>((set, get) => ({
  nodeId: null,
  isConnected: false,
  wsReady: false,
  entries: [],
  notes: [],
  isLoading: false,
  error: null,
  isPublicMode: false,
  activeView: 'chat',
  selectedEntryId: null,
  selectedNoteId: null,
  entryEditMode: 'view',
  noteEditorTab: 'content',

  initialize: () => {
    const nodeId = getNodeId();
    set({
      nodeId,
      isConnected: nodeId !== null,
    });

    if (!nodeId) {
      set({
        error: 'Connect to a Hyperware node to sync data.',
      });
      return;
    }

    get().fetchBootstrap();
    get().connectRealtime();
  },

  fetchBootstrap: async () => {
    if (!get().isConnected) return;
    set({ isLoading: true, error: null });

    try {
      const snapshot = await Todo.bootstrap();
      set({
        entries: sortEntries(snapshot.entries),
        notes: sortNotes(snapshot.notes),
        isPublicMode: snapshot.is_public_mode,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: extractErrorMessage(error),
        isLoading: false,
      });
    }
  },

  connectRealtime: () => {
    if (wsClient || !isHyperwareEnvironment()) return;
    const nodeId = getNodeId();
    const processId = getProcessId();
    if (!nodeId || !processId) {
      return;
    }

    try {
      wsClient = new HyperwareClientApi({
        uri: WEBSOCKET_URL,
        nodeId,
        processId,
        onOpen: (_event, api) => {
          api.send({ data: { type: 'subscribe' } });
          set({ wsReady: true });
        },
        onMessage: (json) => {
          try {
            const payload = JSON.parse(json as string) as ServerMessage;
            applyRealtime(payload, set);
          } catch (error) {
            console.error('Failed to parse realtime payload', error);
          }
        },
        onClose: () => {
          wsClient = null;
          set({ wsReady: false });
          setTimeout(() => get().connectRealtime(), 2000);
        },
        onError: () => {
          set({ error: 'Realtime connection failed.' });
        },
      });
    } catch (error) {
      set({ error: extractErrorMessage(error) });
    }
  },

  setActiveView: (view) => {
    set({ activeView: view });
    if (view === 'todo' || view === 'notes') {
      get().fetchBootstrap();
    }
  },
  setEntryEditMode: (mode) => set({ entryEditMode: mode }),
  setNoteEditorTab: (tab) => set({ noteEditorTab: tab }),

  openEntry: (entryId) => set({ selectedEntryId: entryId, entryEditMode: 'view' }),
  closeEntry: () => set({ selectedEntryId: null, entryEditMode: 'view' }),

  toggleEntryCompletion: async (entryId, completed) => {
    set({ isLoading: true });
    try {
      const updated = await Todo.toggle_entry_completion(entryId, completed);
      set((state) => ({
        entries: upsertEntry(state.entries, updated),
        isLoading: false,
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoading: false });
    }
  },

  saveEntry: async (draft) => {
    set({ isLoading: true });
    try {
      const updated = await Todo.save_entry(draft);
      set((state) => ({
        entries: upsertEntry(state.entries, updated),
        isLoading: false,
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoading: false });
    }
  },

  openNote: (noteId) => set({ selectedNoteId: noteId, noteEditorTab: 'content' }),
  closeNote: () => set({ selectedNoteId: null }),

  createEntry: async () => {
    try {
      const draft: Todo.EntryDraft = {
        id: null,
        title: 'New entry',
        summary: '',
        description: '',
        project: null,
        status: Todo.EntryStatus.UpNext,
        priority: Todo.EntryPriority.Medium,
        due_ts: null,
        start_ts: null,
        dependencies: [],
        note_ids: [],
        assignees: [],
      };
      const created = await Todo.save_entry(draft);
      set((state) => ({
        entries: upsertEntry(state.entries, created),
        selectedEntryId: created.id,
        entryEditMode: 'edit',
        activeView: 'todo',
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error) });
    }
  },

  createNote: async () => {
    try {
      const newNote = await Todo.save_note({
        id: null,
        title: 'Untitled note',
        content: '',
        pinned: false,
        tags: [],
        linked_entry_ids: [],
        accent: null,
      });
      set((state) => ({
        notes: upsertNote(state.notes, newNote),
        selectedNoteId: newNote.id,
        activeView: 'notes',
        noteEditorTab: 'content',
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error) });
    }
  },

  saveNoteContent: async (noteId, content) => {
    const note = get().notes.find((n) => n.id === noteId);
    if (!note) {
      set({ error: 'Note not found.' });
      return;
    }
    try {
      const updated = await Todo.save_note({
        id: noteId,
        title: note.title,
        content,
        pinned: note.pinned,
        tags: note.tags,
        linked_entry_ids: note.linked_entry_ids,
        accent: note.accent,
      });
      set((state) => ({
        notes: upsertNote(state.notes, updated),
        entries: syncEntriesWithNote(state.entries, updated),
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error) });
    }
  },

  saveNoteMetadata: async (noteId, meta) => {
    const note = get().notes.find((n) => n.id === noteId);
    if (!note) {
      set({ error: 'Note not found.' });
      return;
    }
    try {
      const updated = await Todo.save_note({
        id: noteId,
        title: meta.title,
        content: note.content,
        pinned: meta.pinned,
        tags: meta.tags,
        linked_entry_ids: meta.linkedEntryIds,
        accent: meta.accent ?? note.accent,
      });
      set((state) => ({
        notes: upsertNote(state.notes, updated),
        entries: syncEntriesWithNote(state.entries, updated),
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error) });
    }
  },

  deleteNote: async (noteId) => {
    try {
      await Todo.delete_note(noteId);
      set((state) => ({
        notes: state.notes.filter((n) => n.id !== noteId),
        selectedNoteId: state.selectedNoteId === noteId ? null : state.selectedNoteId,
        entries: removeNoteFromEntries(state.entries, noteId),
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error) });
    }
  },

  deleteEntry: async (entryId) => {
    try {
      await Todo.delete_entry(entryId);
      set((state) => ({
        entries: state.entries.filter((e) => e.id !== entryId),
        selectedEntryId: state.selectedEntryId === entryId ? null : state.selectedEntryId,
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error) });
    }
  },

  archiveEntry: async (entryId) => {
    const state = get();
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry) return;

    // Optimistically update the UI immediately
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === entryId ? { ...e, status: Todo.EntryStatus.Archived } : e
      ),
    }));

    try {
      const draft: Todo.EntryDraft = {
        id: entry.id,
        title: entry.title,
        summary: entry.summary,
        description: entry.description,
        project: entry.project,
        status: Todo.EntryStatus.Archived,
        priority: entry.priority,
        due_ts: entry.due_ts,
        start_ts: entry.start_ts,
        dependencies: entry.dependencies,
        note_ids: entry.note_ids,
        assignees: entry.assignees,
      };
      await Todo.save_entry(draft);
    } catch (error) {
      // Revert on error
      set((state) => ({
        entries: state.entries.map((e) =>
          e.id === entryId ? { ...e, status: entry.status } : e
        ),
        error: extractErrorMessage(error),
      }));
    }
  },

  setError: (error) => set({ error }),
}));

function extractErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Something went wrong.';
}

function upsertEntry(list: Entry[], entry: Entry): Entry[] {
  const next = list.filter((item) => item.id !== entry.id);
  next.push(entry);
  return sortEntries(next);
}

function upsertNote(list: Note[], note: Note): Note[] {
  const next = list.filter((item) => item.id !== note.id);
  next.push(note);
  return sortNotes(next);
}

function syncEntriesWithNote(entries: Entry[], note: Note): Entry[] {
  const linkedIds = new Set(note.linked_entry_ids ?? []);
  let changed = false;
  const next = entries.map((entry) => {
    const hasLink = entry.note_ids.includes(note.id);
    const shouldLink = linkedIds.has(entry.id);
    if (hasLink === shouldLink) {
      return entry;
    }
    changed = true;
    if (shouldLink) {
      return {
        ...entry,
        note_ids: [...entry.note_ids, note.id],
      };
    }
    return {
      ...entry,
      note_ids: entry.note_ids.filter((id) => id !== note.id),
    };
  });
  return changed ? next : entries;
}

function removeNoteFromEntries(entries: Entry[], noteId: number): Entry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (!entry.note_ids.includes(noteId)) return entry;
    changed = true;
    return {
      ...entry,
      note_ids: entry.note_ids.filter((id) => id !== noteId),
    };
  });
  return changed ? next : entries;
}

const timescaleRank: Record<Todo.EntryTimescale, number> = {
  [Todo.EntryTimescale.Overdue]: 0,
  [Todo.EntryTimescale.Today]: 1,
  [Todo.EntryTimescale.ThisWeek]: 2,
  [Todo.EntryTimescale.ThisMonth]: 3,
  [Todo.EntryTimescale.Later]: 4,
  [Todo.EntryTimescale.Someday]: 5,
  [Todo.EntryTimescale.Completed]: 6,
};

function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const rankDelta = timescaleRank[a.timescale] - timescaleRank[b.timescale];
    if (rankDelta !== 0) return rankDelta;
    if (a.due_ts && b.due_ts) {
      return a.due_ts - b.due_ts;
    }
    if (a.due_ts && !b.due_ts) return -1;
    if (!a.due_ts && b.due_ts) return 1;
    return a.id - b.id;
  });
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return b.last_edited_ts - a.last_edited_ts;
  });
}

function applyRealtime(message: ServerMessage, set: (fn: (state: TodoStore) => Partial<TodoStore>) => void) {
  switch (message.type) {
    case 'snapshot':
      set(() => ({
        entries: sortEntries(message.entries),
        notes: sortNotes(message.notes),
      }));
      break;
    case 'entryUpdated':
      set((state) => ({
        entries: upsertEntry(state.entries, message.entry),
      }));
      break;
    case 'entryRemoved':
      set((state) => ({
        entries: state.entries.filter((entry) => entry.id !== message.entryId),
        selectedEntryId: state.selectedEntryId === message.entryId ? null : state.selectedEntryId,
      }));
      break;
    case 'noteUpdated':
      set((state) => ({
        notes: upsertNote(state.notes, message.note),
        entries: syncEntriesWithNote(state.entries, message.note),
      }));
      break;
    case 'noteRemoved':
      set((state) => ({
        notes: state.notes.filter((note) => note.id !== message.noteId),
        selectedNoteId: state.selectedNoteId === message.noteId ? null : state.selectedNoteId,
        entries: removeNoteFromEntries(state.entries, message.noteId),
      }));
      break;
    default:
      break;
  }
}

export const useEntries = () => useTodoStore((state) => state.entries);
export const useNotes = () => useTodoStore((state) => state.notes);
