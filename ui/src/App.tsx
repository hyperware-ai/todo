import { marked } from 'marked';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import './App.css';
import { Todo as BackendTodo } from '#caller-utils';
import { useTodoStore } from './store/todo';
import {
  COMPLETED_SECTION,
  TIMESCALES,
  type Entry,
  type Note,
  type ViewName,
} from './types/todo';
import ChatView from './ChatView';

marked.setOptions({
  breaks: true,
  gfm: true,
});

const statusCopy: Record<BackendTodo.EntryStatus, string> = {
  [BackendTodo.EntryStatus.Backlog]: 'Backlog',
  [BackendTodo.EntryStatus.UpNext]: 'Up next',
  [BackendTodo.EntryStatus.InProgress]: 'In progress',
  [BackendTodo.EntryStatus.Blocked]: 'Blocked',
  [BackendTodo.EntryStatus.Review]: 'Review',
  [BackendTodo.EntryStatus.Done]: 'Done',
  [BackendTodo.EntryStatus.Archived]: 'Archived',
};

const priorityCopy: Record<BackendTodo.EntryPriority, string> = {
  [BackendTodo.EntryPriority.High]: 'High',
  [BackendTodo.EntryPriority.Medium]: 'Medium',
  [BackendTodo.EntryPriority.Low]: 'Low',
};

function App() {
  const {
    entries,
    notes,
    error,
    activeView,
    selectedEntryId,
    selectedNoteId,
    entryEditMode,
    noteEditorTab,
    initialize,
    setActiveView,
    openEntry,
    closeEntry,
    toggleEntryCompletion,
    saveEntry,
    deleteEntry,
    archiveEntry,
    openNote,
    closeNote,
    createEntry,
    createNote,
    saveNoteContent,
    saveNoteMetadata,
    deleteNote,
    setEntryEditMode,
    setNoteEditorTab,
    setError,
  } = useTodoStore();
  const [chatResetToken, setChatResetToken] = useState(0);
  const [showArchiveModal, setShowArchiveModal] = useState(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const activeEntry = entries.find((entry) => entry.id === selectedEntryId) || null;
  const activeNote = notes.find((note) => note.id === selectedNoteId) || null;

  const archivedEntries = useMemo(
    () => entries.filter((entry) => entry.status === BackendTodo.EntryStatus.Archived),
    [entries],
  );

  const completedEntries = useMemo(
    () => entries.filter(
      (entry) =>
        entry.timescale === BackendTodo.EntryTimescale.Completed &&
        entry.status !== BackendTodo.EntryStatus.Archived
    ),
    [entries],
  );

  const handleArchiveCompleted = async () => {
    for (const entry of completedEntries) {
      await archiveEntry(entry.id);
    }
  };

  const handleNew = () => {
    if (activeView === 'todo') {
      createEntry();
    } else if (activeView === 'notes') {
      createNote();
    } else {
      setChatResetToken((token) => token + 1);
    }
  };

  return (
    <div className="app-shell">
      {error && (
        <div className="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <main className={`app-main ${activeView === 'chat' ? 'chat-mode' : ''}`}>
        <div style={{ display: activeView === 'chat' ? 'contents' : 'none' }}>
          <ChatView resetToken={chatResetToken} />
        </div>
        {activeView === 'todo' && (
          <TodoView
            entries={entries}
            onToggle={toggleEntryCompletion}
            onOpenEntry={openEntry}
            onArchiveCompleted={handleArchiveCompleted}
            onViewArchive={() => setShowArchiveModal(true)}
            archivedCount={archivedEntries.length}
          />
        )}
        {activeView === 'notes' && (
          <NotesView notes={notes} entries={entries} onOpenNote={openNote} />
        )}
      </main>

      <BottomNav activeView={activeView} onNavigate={setActiveView} onFabClick={handleNew} />

      {activeEntry && (
        <EntryModal
          entry={activeEntry}
          notes={notes}
          mode={entryEditMode}
          onClose={closeEntry}
          onEdit={() => setEntryEditMode('edit')}
          onCancelEdit={() => setEntryEditMode('view')}
          onSave={saveEntry}
          onDelete={async (entryId) => {
            await deleteEntry(entryId);
            closeEntry();
          }}
          onOpenNote={openNote}
        />
      )}

      {activeNote && (
        <NoteEditorDrawer
          note={activeNote}
          entries={entries}
          tab={noteEditorTab}
          onClose={closeNote}
          onTabChange={setNoteEditorTab}
          onSaveContent={saveNoteContent}
          onSaveMetadata={saveNoteMetadata}
          onDelete={deleteNote}
        />
      )}

      {showArchiveModal && (
        <ArchiveModal
          entries={archivedEntries}
          onClose={() => setShowArchiveModal(false)}
          onOpenEntry={(entryId) => {
            setShowArchiveModal(false);
            openEntry(entryId);
          }}
          onDeleteEntry={deleteEntry}
        />
      )}
    </div>
  );
}

interface TodoViewProps {
  entries: Entry[];
  onToggle: (entryId: number, completed: boolean) => Promise<void>;
  onOpenEntry: (entryId: number) => void;
  onArchiveCompleted: () => Promise<void>;
  onViewArchive: () => void;
  archivedCount: number;
}

function TodoView({ entries, onToggle, onOpenEntry, onArchiveCompleted, onViewArchive, archivedCount }: TodoViewProps) {
  const [archivingId, setArchivingId] = useState<number | null>(null);

  // Filter out archived entries from all views
  const activeEntries = useMemo(
    () => entries.filter((entry) => entry.status !== BackendTodo.EntryStatus.Archived),
    [entries],
  );

  const groups = useMemo(() => {
    return TIMESCALES.map((definition) => ({
      definition,
      entries: activeEntries.filter((entry) => entry.timescale === definition.key),
    }));
  }, [activeEntries]);

  const completedEntries = useMemo(
    () => activeEntries.filter((entry) => entry.timescale === BackendTodo.EntryTimescale.Completed),
    [activeEntries],
  );

  const handleToggle = async (entryId: number, completed: boolean) => {
    const activeCount = entries.filter((entry) => !entry.is_completed).length;
    if (!completed && archivingId === entryId) {
      setArchivingId(null);
    }
    if (completed && activeCount > 6) {
      setArchivingId(entryId);
      setTimeout(() => setArchivingId(null), 700);
    }
    await onToggle(entryId, completed);
  };

  return (
    <section className="todo-view">
      {groups.map(({ definition, entries: sectionEntries }) => {
        const visible = sectionEntries.filter(
          (entry) => !entry.is_completed || entry.id === archivingId,
        );
        if (!visible.length) return <Fragment key={definition.key} />;
        return (
          <article key={definition.key} className="timescale-section">
            <p className="timescale-label">{definition.label}</p>
            <div className="timescale-card">
              <div className="timescale-head">
                <p>{definition.blurb}</p>
                <span className="badge" style={{ color: definition.accent }}>
                  {visible.length}
                </span>
              </div>
              <div className="entry-stack">
                {visible.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    archiving={archivingId === entry.id}
                    onToggle={() => handleToggle(entry.id, !entry.is_completed)}
                    onOpen={() => onOpenEntry(entry.id)}
                  />
                ))}
              </div>
            </div>
          </article>
        );
      })}

      {completedEntries.length > 0 && (
        <article className="timescale-section">
          <p className="timescale-label">{COMPLETED_SECTION.label}</p>
          <div className="timescale-card archive-card">
            <div className="timescale-head">
              <p>{COMPLETED_SECTION.blurb}</p>
              <span className="badge">{completedEntries.length}</span>
            </div>
            <div className="archive-grid">
              {completedEntries.slice(0, 6).map((entry) => (
                <button
                  key={entry.id}
                  className="archive-pill"
                  onClick={() => onOpenEntry(entry.id)}
                >
                  <span className="check-icon">✓</span>
                  <span>{entry.title}</span>
                </button>
              ))}
            </div>
            <div className="archive-actions">
              <button className="ghost" onClick={onArchiveCompleted}>
                Archive All
              </button>
              <button className="ghost" onClick={onViewArchive}>
                View Archive {archivedCount > 0 && <span className="badge">{archivedCount}</span>}
              </button>
            </div>
          </div>
        </article>
      )}

      {completedEntries.length === 0 && archivedCount > 0 && (
        <article className="timescale-section">
          <div className="timescale-card archive-card">
            <div className="archive-actions centered">
              <button className="ghost" onClick={onViewArchive}>
                View Archive <span className="badge">{archivedCount}</span>
              </button>
            </div>
          </div>
        </article>
      )}

      <p className="tap-hint">Tap an entry to open the detail modal</p>
    </section>
  );
}

interface EntryCardProps {
  entry: Entry;
  archiving: boolean;
  onToggle: () => void;
  onOpen: () => void;
}

function EntryCard({ entry, archiving, onToggle, onOpen }: EntryCardProps) {
  return (
    <div className={`entry-card ${archiving ? 'archiving' : ''}`}>
      <button
        aria-label="Toggle complete"
        onClick={onToggle}
        className={`entry-check ${entry.is_completed ? 'checked' : ''}`}
      >
        {entry.is_completed ? '✓' : ''}
      </button>
      <button className="entry-body" onClick={onOpen}>
        <div className="entry-headline">
          <h3>{entry.title}</h3>
          <span className="entry-time">{formatTodoTime(entry.due_ts)}</span>
        </div>
        <p className="entry-meta-line">{buildEntryMeta(entry)}</p>
        {entry.summary && <p className="entry-summary">{entry.summary}</p>}
        <div className="entry-footer">
          <span className="pill pill-soft">{statusCopy[entry.status]}</span>
          <span className="pill pill-ghost">{priorityCopy[entry.priority]}</span>
          {entry.note_ids.length > 0 && (
            <span className="pill pill-ghost">
              {entry.note_ids.length} linked note{entry.note_ids.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

interface NotesViewProps {
  notes: Note[];
  entries: Entry[];
  onOpenNote: (noteId: number) => void;
}

function NotesView({ notes, entries, onOpenNote }: NotesViewProps) {
  const safeNotes = Array.isArray(notes) ? notes : [];
  const safeEntries = Array.isArray(entries) ? entries : [];
  const pinned = safeNotes.filter((note) => note.pinned);
  const recent = safeNotes
    .filter((note) => !note.pinned)
    .sort((a, b) => (b.last_edited_ts ?? 0) - (a.last_edited_ts ?? 0));
  const grouped = groupNotesByDay(recent);

  return (
    <section className="notes-view">
      {pinned.length > 0 && (
        <div className="notes-section">
          <p className="section-label">Pinned</p>
          <div className="pinned-grid">
            {pinned.map((note) => (
              <NoteTile key={note.id} note={note} onClick={() => onOpenNote(note.id)} />
            ))}
          </div>
        </div>
      )}

      <div className="notes-section">
        <p className="section-label">All notes</p>
        {grouped.length === 0 && <p className="empty">No notes yet. Start with a quick jot.</p>}
        {grouped.map((group) => (
          <div key={group.label} className="note-day">
            <p className="eyebrow">{group.label}</p>
            {group.notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                entries={safeEntries}
                onClick={() => onOpenNote(note.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

interface NoteTileProps {
  note: Note;
  onClick: () => void;
}

function NoteTile({ note, onClick }: NoteTileProps) {
  const tags = note.tags ?? [];
  const linkedCount = note.linked_entry_ids?.length ?? 0;
  const accent = note.accent || 'var(--slate-900)';

  return (
    <button className="note-tile" style={{ background: accent }} onClick={onClick}>
      <div className="note-tile-tags">
        {tags.length > 0 ? tags.join(' • ') : 'Pinned'}
      </div>
      <h3>{note.title}</h3>
      <p>{note.summary || 'Wins, blockers, and auto-run ideas land here.'}</p>
      <div className="note-links">
        Linked entries • {linkedCount}
      </div>
    </button>
  );
}

interface NoteRowProps {
  note: Note;
  entries: Entry[];
  onClick: () => void;
}

function NoteRow({ note, entries, onClick }: NoteRowProps) {
  const linkedEntries = (note.linked_entry_ids ?? [])
    .map((id) => entries.find((entry) => entry.id === id))
    .filter(Boolean) as Entry[];
  return (
    <button className="note-row" onClick={onClick}>
      <div className="note-row-head">
        <h3>{note.title}</h3>
        <span className="timestamp">{formatRelative(note.last_edited_ts ?? null)}</span>
      </div>
      <p className="note-row-summary">{note.summary || 'Tasks referenced: add a quick blurb.'}</p>
      <p className="note-row-links">
        Linked entries:{' '}
        {linkedEntries.length > 0
          ? linkedEntries
              .map((entry) => entry.title)
              .slice(0, 3)
              .join(', ')
          : 'none yet'}
      </p>
    </button>
  );
}

interface EntryModalProps {
  entry: Entry;
  notes: Note[];
  mode: 'view' | 'edit';
  onClose: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (draft: BackendTodo.EntryDraft) => Promise<void>;
  onDelete: (entryId: number) => Promise<void>;
  onOpenNote: (noteId: number) => void;
}

function EntryModal({
  entry,
  notes,
  mode,
  onClose,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onOpenNote,
}: EntryModalProps) {
  const [form, setForm] = useState(entryToDraft(entry));

  useEffect(() => {
    setForm(entryToDraft(entry));
  }, [entry]);

  const relatedNotes = notes.filter((note) => entry.note_ids.includes(note.id));

  const handleSave = async () => {
    await onSave(form);
    onCancelEdit();
  };

  const handleOverlayClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    event.stopPropagation();
    onClose();
  };

  return (
    <div className="sheet-overlay entry-overlay" onMouseDown={handleOverlayClick}>
      <div className="entry-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <button className="icon-button" onClick={onClose} aria-label="Close entry">
            ←
          </button>
          <div className="panel-title">
            <p className="eyebrow">Entry details</p>
            {mode === 'view' ? (
              <h2>{entry.title}</h2>
            ) : (
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            )}
          </div>
        </div>

        <div className="pill-row meta-bar">
          {mode === 'view' ? (
            <span className="pill">{statusCopy[entry.status]}</span>
          ) : (
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as BackendTodo.EntryStatus })}
              className="status-select"
            >
              {Object.entries(statusCopy).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          )}
          {entry.due_ts && <span className="pill">{formatRelative(entry.due_ts)}</span>}
        </div>

        <div className="panel-content">
          <div className="meta-field">
            <span className="eyebrow">Summary</span>
            {mode === 'view' ? (
              <p style={{ margin: 0 }}>{entry.summary}</p>
            ) : (
              <textarea
                value={form.summary}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
              />
            )}
          </div>

          <div className="meta-field">
            <span className="eyebrow">Planning notes</span>
            {mode === 'view' ? (
              <p style={{ margin: 0 }}>{entry.description || 'No description yet.'}</p>
            ) : (
              <textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            )}
          </div>

          <div className="meta-field">
            <span className="eyebrow">Project</span>
            {mode === 'view' ? (
              <p style={{ margin: 0 }}>{entry.project ?? 'Unassigned'}</p>
            ) : (
              <input
                value={form.project ?? ''}
                onChange={(event) =>
                  setForm({ ...form, project: event.target.value || null })
                }
              />
            )}
          </div>

          <div className="meta-field">
            <span className="eyebrow">Due</span>
            {mode === 'view' ? (
              <p style={{ margin: 0 }}>{formatDueDate(entry.due_ts)}</p>
            ) : (
              <div className={`date-input-wrapper ${!form.due_ts ? 'empty' : ''}`}>
                <input
                  type="datetime-local"
                  value={toInputDate(form.due_ts)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      due_ts: event.target.value ? new Date(event.target.value).getTime() : null,
                    })
                  }
                />
              </div>
            )}
          </div>

          <div className="meta-field">
            <span className="eyebrow">Assignees</span>
            {mode === 'view' ? (
              <div className="pill-row">
                {entry.assignees.map((assignee) => (
                  <span key={assignee} className="pill">
                    {assignee}
                  </span>
                ))}
                {entry.assignees.length === 0 && <p style={{ margin: 0 }}>No assignees yet.</p>}
              </div>
            ) : (
              <input
                value={form.assignees.join(', ')}
                onChange={(event) =>
                  setForm({
                    ...form,
                    assignees: event.target.value
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
              />
            )}
          </div>

          <div className="meta-field">
            <span className="eyebrow">Notes</span>
            {mode === 'view' ? (
              relatedNotes.length === 0 ? (
                <p style={{ margin: 0 }}>No linked notes yet.</p>
              ) : (
                <div className="linked-notes">
                  {relatedNotes.map((note) => (
                    <button key={note.id} onClick={() => onOpenNote(note.id)}>
                      <h4>{note.title}</h4>
                      <p>{note.summary}</p>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className="link-list">
                {notes.map((note) => (
                  <label key={note.id}>
                    <input
                      type="checkbox"
                      checked={form.note_ids.includes(note.id)}
                      onChange={() =>
                        setForm({
                          ...form,
                          note_ids: form.note_ids.includes(note.id)
                            ? form.note_ids.filter((id) => id !== note.id)
                            : [...form.note_ids, note.id],
                        })
                      }
                    />
                    <span>{note.title}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sheet-actions">
          {mode === 'view' ? (
            <button onClick={onEdit}>Edit</button>
          ) : (
            <>
              <button className="ghost danger" onClick={() => onDelete(entry.id)}>
                Delete
              </button>
              <button className="ghost" onClick={onCancelEdit}>
                Cancel
              </button>
              <button onClick={handleSave}>Save</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface NoteDrawerProps {
  note: Note;
  entries: Entry[];
  tab: 'content' | 'metadata';
  onClose: () => void;
  onTabChange: (tab: 'content' | 'metadata') => void;
  onSaveContent: (noteId: number, content: string) => Promise<void>;
  onSaveMetadata: (
    noteId: number,
    meta: {
      title: string;
      tags: string[];
      pinned: boolean;
      linkedEntryIds: number[];
      accent?: string | null;
    },
  ) => Promise<void>;
  onDelete: (noteId: number) => Promise<void>;
}

function NoteEditorDrawer({
  note,
  entries,
  tab,
  onClose,
  onTabChange,
  onSaveContent,
  onSaveMetadata,
  onDelete,
}: NoteDrawerProps) {
  const safeTags = note.tags ?? [];
  const safeLinked = note.linked_entry_ids ?? [];
  const safeEntries = Array.isArray(entries) ? entries : [];
  const [contentDraft, setContentDraft] = useState(note.content);
  const [title, setTitle] = useState(note.title);
  const [tagsInput, setTagsInput] = useState(safeTags.join(', '));
  const [linkedIds, setLinkedIds] = useState<number[]>(safeLinked);
  const [pinned, setPinned] = useState(note.pinned);
  const [contentMode, setContentMode] = useState<'write' | 'preview'>('write');
  const [lastSaved, setLastSaved] = useState(note.content);
  const liveTitle = title.trim() ? title : 'Untitled note';

  useEffect(() => {
    setContentDraft(note.content);
    setTitle(note.title);
    setTagsInput((note.tags ?? []).join(', '));
    setLinkedIds(note.linked_entry_ids ?? []);
    setPinned(note.pinned);
    setContentMode('write');
    setLastSaved(note.content);
  }, [note.id]);

  const htmlPreview = useMemo(
    () => ({ __html: marked.parse(contentDraft || '') }),
    [contentDraft],
  );

  const flushContent = useCallback(async () => {
    if (contentDraft === lastSaved) return;
    await onSaveContent(note.id, contentDraft);
    setLastSaved(contentDraft);
  }, [contentDraft, lastSaved, note.id, onSaveContent]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void flushContent();
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [contentDraft, flushContent]);

  useEffect(() => {
    return () => {
      void flushContent();
    };
  }, [flushContent]);

  const handleClose = useCallback(() => {
    flushContent()
      .catch(() => {
        // errors surface through store
      })
      .finally(() => {
        onClose();
      });
  }, [flushContent, onClose]);

  const handleToggleLink = (entryId: number) => {
    setLinkedIds((prev) =>
      prev.includes(entryId) ? prev.filter((id) => id !== entryId) : [...prev, entryId],
    );
  };

  const handleSaveMetadata = () =>
    onSaveMetadata(note.id, {
      title,
      pinned,
      tags: tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      linkedEntryIds: linkedIds,
      accent: note.accent,
    });

  const handleOverlayClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    event.stopPropagation();
    handleClose();
  };

  const isDirty = contentDraft !== (lastSaved ?? '');

  return (
    <div className="sheet-overlay note-overlay" onMouseDown={handleOverlayClick}>
      <div className="note-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <button className="icon-button" onClick={handleClose} aria-label="Close note editor">
            ←
          </button>
          <div className="panel-title">
            <p className="eyebrow">Notes</p>
            <h2>{liveTitle}</h2>
          </div>
          <div className="pill-switch">
            <button
              className={tab === 'content' ? 'active' : ''}
              onClick={() => onTabChange('content')}
            >
              Edit
            </button>
            <button
              className={tab === 'metadata' ? 'active' : ''}
              onClick={() => onTabChange('metadata')}
            >
              Meta
            </button>
          </div>
        </div>

        <div className="panel-content">
          {tab === 'content' ? (
            <div className="note-editor">
              <div className="pill-switch compact">
                <button
                  className={contentMode === 'write' ? 'active' : ''}
                  onClick={() => setContentMode('write')}
                >
                  Write
                </button>
                <button
                  className={contentMode === 'preview' ? 'active' : ''}
                  onClick={() => setContentMode('preview')}
                >
                  Preview
                </button>
              </div>
              {contentMode === 'write' ? (
                <textarea
                  value={contentDraft}
                  onChange={(event) => setContentDraft(event.target.value)}
                />
              ) : (
                <div className="note-preview" dangerouslySetInnerHTML={htmlPreview} />
              )}
              <div className="note-editor-footer">
                <button className="ghost danger" onClick={() => onDelete(note.id)}>
                  Delete
                </button>
                <span className="save-indicator">{isDirty ? 'Saving…' : 'Saved'}</span>
              </div>
            </div>
          ) : (
            <div className="note-metadata">
              <div className="meta-field">
                <span className="eyebrow">Title</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>

              <div className="meta-field">
                <span className="eyebrow">Tags</span>
                <input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} />
              </div>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(event) => setPinned(event.target.checked)}
                />
                <span>Pin to top</span>
              </label>

              <div className="meta-field">
                <span className="eyebrow">Linked entries</span>
                <div className="link-list">
                  {safeEntries.map((entry) => (
                    <label key={entry.id}>
                      <input
                        type="checkbox"
                        checked={linkedIds.includes(entry.id)}
                        onChange={() => handleToggleLink(entry.id)}
                      />
                      <span>{entry.title}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="sheet-actions">
                <button className="ghost" onClick={() => onDelete(note.id)}>
                  Delete
                </button>
                <button onClick={handleSaveMetadata}>Save metadata</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ArchiveModalProps {
  entries: Entry[];
  onClose: () => void;
  onOpenEntry: (entryId: number) => void;
  onDeleteEntry: (entryId: number) => Promise<void>;
}

function ArchiveModal({ entries, onClose, onOpenEntry, onDeleteEntry }: ArchiveModalProps) {
  const handleOverlayClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    event.stopPropagation();
    onClose();
  };

  return (
    <div className="sheet-overlay archive-overlay" onMouseDown={handleOverlayClick}>
      <div className="archive-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <button className="icon-button" onClick={onClose} aria-label="Close archive">
            ←
          </button>
          <div className="panel-title">
            <p className="eyebrow">Archive</p>
            <h2>Archived Tasks</h2>
          </div>
        </div>

        <div className="panel-content archive-list">
          {entries.length === 0 ? (
            <p className="empty-message">No archived tasks yet.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="archive-item">
                <button className="archive-item-body" onClick={() => onOpenEntry(entry.id)}>
                  <span className="check-icon">✓</span>
                  <div className="archive-item-info">
                    <h4>{entry.title}</h4>
                    {entry.summary && <p>{entry.summary}</p>}
                  </div>
                </button>
                <button
                  className="ghost danger archive-item-delete"
                  onClick={() => onDeleteEntry(entry.id)}
                  aria-label="Delete"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface BottomNavProps {
  activeView: ViewName;
  onNavigate: (view: ViewName) => void;
  onFabClick: () => void;
}

function BottomNav({ activeView, onNavigate, onFabClick }: BottomNavProps) {
  const items: Array<{
    key: string;
    label: string;
    icon: NavIconName;
    onClick?: () => void;
    active?: boolean;
    disabled?: boolean;
  }> = [
    {
      key: 'chat',
      label: 'Chat',
      icon: 'chat',
      onClick: () => onNavigate('chat'),
      active: activeView === 'chat',
    },
    {
      key: 'todo',
      label: 'TODO',
      icon: 'todo',
      onClick: () => onNavigate('todo'),
      active: activeView === 'todo',
    },
    { key: 'projects', label: 'Projects', icon: 'projects', disabled: true },
    { key: 'calendar', label: 'Calendar', icon: 'calendar', disabled: true },
    {
      key: 'notes',
      label: 'Notes',
      icon: 'notes',
      onClick: () => onNavigate('notes'),
      active: activeView === 'notes',
    },
    { key: 'search', label: 'Search', icon: 'search', disabled: true },
  ];

  return (
    <nav className="bottom-nav">
      {items.map((item) => (
        <button
          key={item.key}
          className={`nav-item ${item.active ? 'active' : ''}`}
          onClick={item.onClick}
          disabled={item.disabled}
        >
          <span className="nav-icon" aria-hidden="true">
            {NAV_ICONS[item.icon]}
          </span>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}
      <button className={`nav-item new ${activeView === 'chat' ? 'subtle' : ''}`} onClick={onFabClick}>
        <span className="nav-icon" aria-hidden="true">
          {NAV_ICONS.plus}
        </span>
        <span className="nav-label">New</span>
      </button>
    </nav>
  );
}

type IconName = 'todo' | 'projects' | 'calendar' | 'notes' | 'search' | 'plus';
type NavIconName = IconName | 'chat';

const NAV_ICONS: Record<NavIconName, JSX.Element> = {
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 6.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-5H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
      <circle cx="9" cy="11.75" r=".75" />
      <circle cx="12" cy="11.75" r=".75" />
      <circle cx="15" cy="11.75" r=".75" />
    </svg>
  ),
  todo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="4" y="4.5" width="4.5" height="4.5" rx="1.5" />
      <path d="M11 6.75h9" />
      <rect x="4" y="10.75" width="4.5" height="4.5" rx="1.5" />
      <path d="M11 13h9" />
      <rect x="4" y="17" width="4.5" height="4.5" rx="1.5" />
      <path d="M11 19.25h9" />
    </svg>
  ),
  projects: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="4" y="5" width="4.5" height="14" rx="1.5" />
      <rect x="9.75" y="5" width="4.5" height="10" rx="1.5" />
      <rect x="15.5" y="5" width="4.5" height="12" rx="1.5" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="4" y="6" width="16" height="13" rx="2" />
      <path d="M4 10h16" />
      <path d="M9 4v4" />
      <path d="M15 4v4" />
    </svg>
  ),
  notes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M8.5 8.5h7" />
      <path d="M8.5 12.5h5" />
      <path d="M8.5 16.5h4" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="11" cy="11" r="5.5" />
      <path d="M15.5 15.5L20 20" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  ),
};

function buildEntryMeta(entry: Entry): string {
  const parts: string[] = [];
  if (entry.project) parts.push(entry.project);
  if (entry.assignees.length) parts.push(entry.assignees.join(', '));
  if (entry.dependencies.length) parts.push(`Deps ${entry.dependencies.length}`);
  return parts.join(' • ') || 'No metadata yet';
}

function formatTodoTime(timestamp: number | null | undefined): string {
  if (!timestamp) return 'Anytime';
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function groupNotesByDay(notes: Note[]): { label: string; notes: Note[] }[] {
  const groups = new Map<string, Note[]>();
  notes.forEach((note) => {
    const label = formatDayLabel(note.last_edited_ts);
    const bucket = groups.get(label);
    if (bucket) {
      bucket.push(note);
    } else {
      groups.set(label, [note]);
    }
  });
  return Array.from(groups.entries()).map(([label, groupedNotes]) => ({
    label,
    notes: groupedNotes,
  }));
}

function formatDayLabel(timestamp: number | null | undefined): string {
  if (!timestamp) return 'Earlier';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const noteDate = new Date(timestamp);
  noteDate.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - noteDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return noteDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatRelative(timestamp: number | null): string {
  if (!timestamp) return 'No date';
  const now = Date.now();
  const delta = timestamp - now;
  const abs = Math.abs(delta);
  const minutes = Math.round(abs / (1000 * 60));
  if (minutes < 60) {
    return delta >= 0 ? `in ${minutes}m` : `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return delta >= 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return delta >= 0 ? `in ${days}d` : `${days}d ago`;
}

function formatDueDate(timestamp: number | null | undefined): string {
  if (!timestamp) return 'No date';
  const date = new Date(timestamp);
  return `${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} • ${date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function toInputDate(timestamp: number | null): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

function entryToDraft(entry: Entry): BackendTodo.EntryDraft {
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    description: entry.description,
    project: entry.project,
    status: entry.status,
    priority: entry.priority,
    due_ts: entry.due_ts,
    start_ts: entry.start_ts,
    dependencies: entry.dependencies,
    note_ids: entry.note_ids,
    assignees: entry.assignees,
  };
}

export default App;
