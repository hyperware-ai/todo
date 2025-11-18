use std::collections::HashSet;

use chrono::{Datelike, Duration, Local, LocalResult, NaiveDate, TimeZone};
use hyperprocess_macro::hyperprocess;
use hyperware_process_lib::{
    homepage::add_to_homepage,
    http::server::{send_ws_push, WsMessageType},
    our, println, LazyLoadBlob,
};
use serde::{Deserialize, Serialize};

const ICON: &str = include_str!("./icon");

#[derive(Serialize, Deserialize)]
pub struct TodoState {
    entries: Vec<Entry>,
    notes: Vec<Note>,
    next_entry_id: u64,
    next_note_id: u64,
    #[serde(skip)]
    connected_channels: HashSet<u32>,
}

impl Default for TodoState {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            notes: Vec::new(),
            next_entry_id: 1,
            next_note_id: 1,
            connected_channels: HashSet::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum EntryStatus {
    Backlog,
    UpNext,
    InProgress,
    Blocked,
    Review,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum EntryPriority {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum EntryTimescale {
    Overdue,
    Today,
    ThisWeek,
    ThisMonth,
    Later,
    Someday,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: u64,
    pub title: String,
    pub summary: String,
    pub description: String,
    pub project: Option<String>,
    pub status: EntryStatus,
    pub timescale: EntryTimescale,
    pub priority: EntryPriority,
    pub due_ts: Option<i64>,
    pub start_ts: Option<i64>,
    pub dependencies: Vec<u64>,
    pub note_ids: Vec<u64>,
    pub assignees: Vec<String>,
    pub is_completed: bool,
    pub completed_at_ts: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryDraft {
    pub id: Option<u64>,
    pub title: String,
    pub summary: String,
    pub description: String,
    pub project: Option<String>,
    pub status: EntryStatus,
    pub priority: EntryPriority,
    pub due_ts: Option<i64>,
    pub start_ts: Option<i64>,
    pub dependencies: Vec<u64>,
    pub note_ids: Vec<u64>,
    pub assignees: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: u64,
    pub title: String,
    pub content: String,
    pub pinned: bool,
    pub tags: Vec<String>,
    pub linked_entry_ids: Vec<u64>,
    pub summary: String,
    pub accent: String,
    pub last_edited_ts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDraft {
    pub id: Option<u64>,
    pub title: String,
    pub content: String,
    pub pinned: bool,
    pub tags: Vec<String>,
    pub linked_entry_ids: Vec<u64>,
    pub accent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppBootstrap {
    pub entries: Vec<Entry>,
    pub notes: Vec<Note>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WsServerMessage {
    Snapshot {
        entries: Vec<Entry>,
        notes: Vec<Note>,
    },
    EntryUpdated {
        entry: Entry,
    },
    EntryRemoved {
        entry_id: u64,
    },
    NoteUpdated {
        note: Note,
    },
    NoteRemoved {
        note_id: u64,
    },
}

#[derive(Debug, Deserialize)]
enum WsClientMessage {
    Subscribe,
    Ping,
}

#[hyperprocess(
    name = "Todo App",
    ui = Some(hyperware_process_lib::http::server::HttpBindingConfig::default().authenticated(false)),
    endpoints = vec![
        hyperware_process_lib::hyperapp::Binding::Http {
            path: "/api",
            config: hyperware_process_lib::http::server::HttpBindingConfig::default().authenticated(false),
        },
        hyperware_process_lib::hyperapp::Binding::Ws {
            path: "/ws",
            config: hyperware_process_lib::http::server::WsBindingConfig::default().authenticated(false),
        },
    ],
    save_config = hyperware_process_lib::hyperapp::SaveOptions::EveryMessage,
    wit_world = "todo-ware-dot-hypr-v0"
)]
impl TodoState {
    #[init]
    async fn initialize(&mut self) {
        add_to_homepage("Todo App", Some(ICON), Some("/"), None);
        self.connected_channels.clear();
        println!("Todo app ready on node {}", our().node.clone());
        self.ensure_demo_content();
    }

    #[http]
    async fn bootstrap(&mut self) -> Result<AppBootstrap, String> {
        self.ensure_demo_content();
        Ok(AppBootstrap {
            entries: self.entries.clone(),
            notes: self.notes.clone(),
        })
    }

    #[local]
    #[http]
    async fn save_entry(&mut self, mut draft: EntryDraft) -> Result<Entry, String> {
        if draft.title.trim().is_empty() {
            return Err("Entries require a title.".to_string());
        }

        if draft.summary.trim().is_empty() {
            draft.summary = summarize_text(&draft.description);
        }

        let entry = if let Some(id) = draft.id {
            let entry = self
                .entries
                .iter_mut()
                .find(|e| e.id == id)
                .ok_or_else(|| "Entry not found".to_string())?;

            entry.title = draft.title;
            entry.summary = draft.summary;
            entry.description = draft.description;
            entry.project = draft.project;
            entry.status = draft.status;
            entry.priority = draft.priority;
            entry.due_ts = draft.due_ts;
            entry.start_ts = draft.start_ts;
            entry.dependencies = draft.dependencies;
            entry.note_ids = draft.note_ids.clone();
            entry.assignees = draft.assignees;
            refresh_entry_timescale(entry);
            entry.clone()
        } else {
            let mut entry = Entry {
                id: self.next_entry_id(),
                title: draft.title,
                summary: draft.summary,
                description: draft.description,
                project: draft.project,
                status: draft.status,
                timescale: EntryTimescale::Someday,
                priority: draft.priority,
                due_ts: draft.due_ts,
                start_ts: draft.start_ts,
                dependencies: draft.dependencies,
                note_ids: draft.note_ids.clone(),
                assignees: draft.assignees,
                is_completed: false,
                completed_at_ts: None,
            };
            refresh_entry_timescale(&mut entry);
            self.entries.push(entry.clone());
            entry
        };

        let touched_notes = self.sync_entry_note_links(entry.id, entry.note_ids.clone());
        for note in touched_notes {
            self.broadcast(&WsServerMessage::NoteUpdated { note });
        }
        self.broadcast(&WsServerMessage::EntryUpdated {
            entry: entry.clone(),
        });
        Ok(entry)
    }

    #[local]
    #[http]
    async fn toggle_entry_completion(
        &mut self,
        entry_id: u64,
        completed: bool,
    ) -> Result<Entry, String> {
        let entry = self
            .entries
            .iter_mut()
            .find(|e| e.id == entry_id)
            .ok_or_else(|| "Entry not found".to_string())?;

        entry.is_completed = completed;
        entry.completed_at_ts = if completed {
            entry.status = EntryStatus::Done;
            Some(now_ts())
        } else {
            None
        };

        refresh_entry_timescale(entry);
        let snapshot = entry.clone();
        self.broadcast(&WsServerMessage::EntryUpdated {
            entry: snapshot.clone(),
        });
        Ok(snapshot)
    }

    #[local]
    #[http]
    async fn delete_entry(&mut self, entry_id: u64) -> Result<bool, String> {
        if let Some(idx) = self.entries.iter().position(|e| e.id == entry_id) {
            let entry = self.entries.remove(idx);
            let touched_notes = self.sync_entry_note_links(entry.id, Vec::new());
            self.broadcast(&WsServerMessage::EntryRemoved { entry_id });
            for note in touched_notes {
                self.broadcast(&WsServerMessage::NoteUpdated { note });
            }
            Ok(true)
        } else {
            Err("Entry not found".to_string())
        }
    }

    #[local]
    #[http]
    async fn save_note(&mut self, draft: NoteDraft) -> Result<Note, String> {
        if draft.title.trim().is_empty() {
            return Err("Notes require a title.".to_string());
        }

        let accent = draft
            .accent
            .unwrap_or_else(|| random_accent_for(&draft.tags));

        let note = if let Some(id) = draft.id {
            let note = self
                .notes
                .iter_mut()
                .find(|n| n.id == id)
                .ok_or_else(|| "Note not found".to_string())?;

            note.title = draft.title;
            note.content = draft.content;
            note.pinned = draft.pinned;
            note.tags = draft.tags;
            note.linked_entry_ids = draft.linked_entry_ids.clone();
            note.summary = summarize_text(&note.content);
            note.last_edited_ts = now_ts();
            note.accent = accent;
            note.clone()
        } else {
            let mut note = Note {
                id: self.next_note_id(),
                title: draft.title,
                content: draft.content,
                pinned: draft.pinned,
                tags: draft.tags,
                linked_entry_ids: draft.linked_entry_ids.clone(),
                summary: String::new(),
                accent,
                last_edited_ts: now_ts(),
            };
            note.summary = summarize_text(&note.content);
            self.notes.push(note.clone());
            note
        };

        let touched_entries = self.sync_note_entry_links(note.id, note.linked_entry_ids.clone());
        for entry in touched_entries {
            self.broadcast(&WsServerMessage::EntryUpdated { entry });
        }
        self.broadcast(&WsServerMessage::NoteUpdated { note: note.clone() });
        Ok(note)
    }

    #[local]
    #[http]
    async fn delete_note(&mut self, note_id: u64) -> Result<bool, String> {
        if let Some(idx) = self.notes.iter().position(|n| n.id == note_id) {
            self.notes.remove(idx);
            let touched_entries = self.sync_note_entry_links(note_id, Vec::new());
            self.broadcast(&WsServerMessage::NoteRemoved { note_id });
            for entry in touched_entries {
                self.broadcast(&WsServerMessage::EntryUpdated { entry });
            }
            Ok(true)
        } else {
            Err("Note not found".to_string())
        }
    }

    #[ws]
    fn websocket(&mut self, channel_id: u32, message_type: WsMessageType, blob: LazyLoadBlob) {
        match message_type {
            WsMessageType::Text => {
                if let Ok(text) = String::from_utf8(blob.bytes) {
                    if let Ok(msg) = serde_json::from_str::<WsClientMessage>(&text) {
                        match msg {
                            WsClientMessage::Subscribe => {
                                self.connected_channels.insert(channel_id);
                                self.send_snapshot(channel_id);
                            }
                            WsClientMessage::Ping => {
                                // Keep-alive; no action needed beyond acknowledging receipt
                            }
                        }
                    }
                }
            }
            WsMessageType::Close => {
                self.connected_channels.remove(&channel_id);
            }
            WsMessageType::Pong | WsMessageType::Ping | WsMessageType::Binary => {}
        }
    }
}

impl TodoState {
    fn ensure_demo_content(&mut self) {
        if !self.entries.is_empty() || !self.notes.is_empty() {
            return;
        }

        let now = Local::now();
        let mut seed_entry = |title: &str,
                              summary: &str,
                              description: &str,
                              project: Option<&str>,
                              status: EntryStatus,
                              priority: EntryPriority,
                              due_offset_hours: Option<i64>,
                              note_ids: Vec<u64>,
                              assignees: Vec<&str>|
         -> Entry {
            let due_ts =
                due_offset_hours.map(|hours| (now + Duration::hours(hours)).timestamp_millis());
            Entry {
                id: self.next_entry_id(),
                title: title.to_string(),
                summary: summary.to_string(),
                description: description.to_string(),
                project: project.map(|p| p.to_string()),
                status,
                timescale: EntryTimescale::Someday,
                priority,
                due_ts,
                start_ts: None,
                dependencies: Vec::new(),
                note_ids,
                assignees: assignees.iter().map(|a| a.to_string()).collect(),
                is_completed: false,
                completed_at_ts: None,
            }
        };

        let mut entries = vec![
            seed_entry(
                "Stand-up sync",
                "Sync with AI-planning pod",
                "Quick hitlist review plus assign AI backlog deliverables.",
                Some("Unified Planner OS"),
                EntryStatus::InProgress,
                EntryPriority::Medium,
                Some(1),
                Vec::new(),
                vec!["Alex"],
            ),
            seed_entry(
                "Draft kanban automation",
                "Spec AI moves between boards",
                "Add heuristics so GPT suggestions nudge blocked items across Kanban + Gantt.",
                Some("Unified Planner OS"),
                EntryStatus::UpNext,
                EntryPriority::High,
                Some(4),
                Vec::new(),
                vec!["Drew", "Ivy"],
            ),
            seed_entry(
                "Prep Gantt milestones",
                "Plot October release windows",
                "Translate backlog dependencies into Gantt view.",
                Some("Unified Planner OS"),
                EntryStatus::InProgress,
                EntryPriority::Medium,
                Some(8),
                Vec::new(),
                vec!["Nico"],
            ),
            seed_entry(
                "Ship Notes markdown preview",
                "Preview w/ AI linking",
                "Live markdown preview + entry autocomplete (! references).",
                Some("Notes revamp"),
                EntryStatus::Review,
                EntryPriority::High,
                Some(48),
                Vec::new(),
                vec!["Geo"],
            ),
        ];

        for entry in &mut entries {
            refresh_entry_timescale(entry);
            self.entries.push(entry.clone());
        }
        let sample_notes = vec![
            Note {
                id: self.next_note_id(),
                title: "Focus rituals".to_string(),
                content: "### Ritual stack\n- Pomodoro 40/10\n- Archive animation only after >6 items\n- `!rtm` to surface real-time metrics".to_string(),
                pinned: true,
                tags: vec!["Focus".to_string(), "AI".to_string()],
                linked_entry_ids: vec![self.entries[0].id],
                summary: "Ritual stack for flow and animation rules".to_string(),
                accent: "#c7d2fe".to_string(),
                last_edited_ts: now_ts(),
            },
            Note {
                id: self.next_note_id(),
                title: "Sprint kickoff".to_string(),
                content: "Outline blockers, dependencies, and CPM-critical milestones for the unified planner launch.".to_string(),
                pinned: false,
                tags: vec!["Sprint".to_string(), "Planning".to_string()],
                linked_entry_ids: vec![self.entries[2].id, self.entries[3].id],
                summary: "Kickoff outline for planner launch.".to_string(),
                accent: "#fee2e2".to_string(),
                last_edited_ts: now_ts(),
            },
        ];

        self.notes.extend(sample_notes);
        let link_jobs: Vec<(u64, Vec<u64>)> = self
            .notes
            .iter()
            .map(|note| (note.id, note.linked_entry_ids.clone()))
            .collect();
        for (note_id, linked) in link_jobs {
            self.sync_note_entry_links(note_id, linked);
        }
    }
    fn sync_entry_note_links(&mut self, entry_id: u64, note_ids: Vec<u64>) -> Vec<Note> {
        let desired: HashSet<u64> = note_ids.into_iter().collect();
        let mut touched = Vec::new();
        for note in &mut self.notes {
            let mut dirty = false;
            if desired.contains(&note.id) {
                if !note.linked_entry_ids.contains(&entry_id) {
                    note.linked_entry_ids.push(entry_id);
                    dirty = true;
                }
            } else {
                let before = note.linked_entry_ids.len();
                note.linked_entry_ids.retain(|id| *id != entry_id);
                if note.linked_entry_ids.len() != before {
                    dirty = true;
                }
            }
            if dirty {
                touched.push(note.clone());
            }
        }
        touched
    }

    fn sync_note_entry_links(&mut self, note_id: u64, entry_ids: Vec<u64>) -> Vec<Entry> {
        let desired: HashSet<u64> = entry_ids.into_iter().collect();
        let mut touched = Vec::new();
        for entry in &mut self.entries {
            let mut dirty = false;
            if desired.contains(&entry.id) {
                if !entry.note_ids.contains(&note_id) {
                    entry.note_ids.push(note_id);
                    dirty = true;
                }
            } else {
                let before = entry.note_ids.len();
                entry.note_ids.retain(|id| *id != note_id);
                if entry.note_ids.len() != before {
                    dirty = true;
                }
            }
            if dirty {
                touched.push(entry.clone());
            }
        }
        touched
    }

    fn broadcast(&self, message: &WsServerMessage) {
        if self.connected_channels.is_empty() {
            return;
        }
        if let Ok(json) = serde_json::to_string(message) {
            let bytes = json.into_bytes();
            for channel_id in &self.connected_channels {
                let blob = LazyLoadBlob {
                    mime: Some("application/json".to_string()),
                    bytes: bytes.clone(),
                };
                send_ws_push(*channel_id, WsMessageType::Text, blob);
            }
        }
    }

    fn send_snapshot(&self, channel_id: u32) {
        self.send_ws_message(
            channel_id,
            &WsServerMessage::Snapshot {
                entries: self.entries.clone(),
                notes: self.notes.clone(),
            },
        );
    }

    fn send_ws_message(&self, channel_id: u32, message: &WsServerMessage) {
        if let Ok(json) = serde_json::to_string(message) {
            let blob = LazyLoadBlob {
                mime: Some("application/json".to_string()),
                bytes: json.into_bytes(),
            };
            send_ws_push(channel_id, WsMessageType::Text, blob);
        }
    }

    fn next_entry_id(&mut self) -> u64 {
        let id = self.next_entry_id;
        self.next_entry_id += 1;
        id
    }

    fn next_note_id(&mut self) -> u64 {
        let id = self.next_note_id;
        self.next_note_id += 1;
        id
    }
}

fn refresh_entry_timescale(entry: &mut Entry) {
    entry.timescale = if entry.is_completed {
        EntryTimescale::Completed
    } else {
        compute_timescale(entry.due_ts)
    };
}

fn compute_timescale(due_ts: Option<i64>) -> EntryTimescale {
    let due_ts = match due_ts {
        Some(ts) => ts,
        None => return EntryTimescale::Someday,
    };

    if let LocalResult::Single(due) = Local.timestamp_millis_opt(due_ts) {
        let today = Local::now().date_naive();
        let due_date = due.date_naive();

        if due_date < today {
            return EntryTimescale::Overdue;
        }

        if due_date == today {
            return EntryTimescale::Today;
        }

        let weekday = today.weekday().number_from_monday() as i64;
        let end_of_week = today + Duration::days(7 - weekday);

        if due_date <= end_of_week {
            return EntryTimescale::ThisWeek;
        }

        let end_of_month = last_day_of_month(today.year(), today.month());

        if due_date <= end_of_month {
            return EntryTimescale::ThisMonth;
        }

        return EntryTimescale::Later;
    }

    EntryTimescale::Someday
}

fn last_day_of_month(year: i32, month: u32) -> NaiveDate {
    let next_month = if month == 12 { 1 } else { month + 1 };
    let next_year = if month == 12 { year + 1 } else { year };
    NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .unwrap()
        .pred_opt()
        .unwrap()
}

fn summarize_text(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return "No description yet.".to_string();
    }
    let snippet = trimmed
        .lines()
        .next()
        .unwrap_or(trimmed)
        .chars()
        .take(120)
        .collect::<String>();
    snippet
}

fn now_ts() -> i64 {
    Local::now().timestamp_millis()
}

fn random_accent_for(tags: &[String]) -> String {
    if tags.iter().any(|t| t.contains("Focus")) {
        return "#c7d2fe".to_string();
    }
    if tags.iter().any(|t| t.contains("Sprint")) {
        return "#fee2e2".to_string();
    }
    "#e0f2fe".to_string()
}
