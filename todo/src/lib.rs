use std::collections::HashSet;

use chrono::{Datelike, Duration, Local, LocalResult, NaiveDate, TimeZone};
use hyperware_process_lib::{
    homepage::add_to_homepage,
    http::server::{send_ws_push, WsMessageType},
    logging::warn,
    our, println, Address, LazyLoadBlob, Request as ProcessRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

const ICON: &str = include_str!("./icon");
const SPIDER_PROCESS_ID: (&str, &str, &str) = ("spider", "spider", "sys");

#[derive(Serialize, Deserialize)]
pub struct TodoState {
    entries: Vec<Entry>,
    notes: Vec<Note>,
    next_entry_id: u64,
    next_note_id: u64,
    spider_api_key: Option<String>,
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
            spider_api_key: None,
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
    Archived,
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
    pub is_public_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchAllResult {
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

#[hyperapp_macro::hyperapp(
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
            #[cfg(feature = "public-mode")]
            is_public_mode: true,
            #[cfg(not(feature = "public-mode"))]
            is_public_mode: false,
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

    #[local]
    #[http]
    async fn search_all(&self, query: Option<String>) -> Result<SearchAllResult, String> {
        let query = query.unwrap_or_default();
        let query_lower = query.to_lowercase();
        let match_all = query.is_empty() || query == "*";

        let matching_entries: Vec<Entry> = self
            .entries
            .iter()
            .filter(|entry| {
                // Exclude archived entries from search results
                if entry.status == EntryStatus::Archived {
                    return false;
                }
                if match_all {
                    return true;
                }
                entry.title.to_lowercase().contains(&query_lower)
                    || entry.summary.to_lowercase().contains(&query_lower)
                    || entry.description.to_lowercase().contains(&query_lower)
                    || entry
                        .project
                        .as_ref()
                        .map(|p| p.to_lowercase().contains(&query_lower))
                        .unwrap_or(false)
                    || entry
                        .assignees
                        .iter()
                        .any(|a| a.to_lowercase().contains(&query_lower))
            })
            .cloned()
            .collect();

        let matching_notes: Vec<Note> = self
            .notes
            .iter()
            .filter(|note| {
                if match_all {
                    return true;
                }
                note.title.to_lowercase().contains(&query_lower)
                    || note.content.to_lowercase().contains(&query_lower)
                    || note.summary.to_lowercase().contains(&query_lower)
                    || note
                        .tags
                        .iter()
                        .any(|t| t.to_lowercase().contains(&query_lower))
            })
            .cloned()
            .collect();

        Ok(SearchAllResult {
            entries: matching_entries,
            notes: matching_notes,
        })
    }

    #[http]
    async fn spider_connect(&mut self, force_new: Option<bool>) -> Result<SpiderConnectResult, String> {
        let should_force = force_new.unwrap_or(false);
        if !should_force {
            if let Some(existing) = &self.spider_api_key {
                return Ok(SpiderConnectResult {
                    api_key: existing.clone(),
                });
            }
        }

        let body = json!({
            "CreateSpiderKey": {
                "name": format!("todo-{}", our().node.clone()),
                "permissions": vec!["read", "write", "chat"],
                "adminKey": "",
            }
        });
        let response = ProcessRequest::to(Address::new("our", SPIDER_PROCESS_ID))
            .body(
                serde_json::to_vec(&body)
                    .map_err(|err| format!("failed to serialize spider key request: {err}"))?,
            )
            .send_and_await_response(5)
            .map_err(|err| format!("failed to contact spider: {err:?}"))?
            .map_err(|err| format!("spider returned an error: {err:?}"))?;

        let parsed: Result<SpiderApiKey, String> = serde_json::from_slice(response.body())
            .map_err(|err| format!("failed to parse spider key response: {err}"))?;

        match parsed {
            Ok(key) => {
                self.spider_api_key = Some(key.key.clone());
                Ok(SpiderConnectResult { api_key: key.key })
            }
            Err(err) => Err(format!("spider refused to create key: {err}")),
        }
    }

    #[http]
    async fn spider_status(&self) -> Result<SpiderStatusInfo, String> {
        let ping_body = json!({ "Ping": null });
        let available = ProcessRequest::to(Address::new("our", SPIDER_PROCESS_ID))
            .body(
                serde_json::to_vec(&ping_body)
                    .map_err(|err| format!("failed to serialize ping: {err}"))?,
            )
            .send_and_await_response(2)
            .map(|result| result.is_ok())
            .unwrap_or(false);

        Ok(SpiderStatusInfo {
            connected: self.spider_api_key.is_some() && available,
            has_api_key: self.spider_api_key.is_some(),
            spider_available: available,
        })
    }

    #[http]
    async fn spider_mcp_servers(&self, api_key: Option<String>) -> Result<SpiderMcpServersResult, String> {
        let key = api_key
            .or_else(|| self.spider_api_key.clone())
            .ok_or_else(|| "Spider API key missing".to_string())?;

        let body = json!({
            "ListMcpServers": {
                "authKey": key,
            }
        });

        let response = ProcessRequest::to(Address::new("our", SPIDER_PROCESS_ID))
            .body(
                serde_json::to_vec(&body)
                    .map_err(|err| format!("failed to serialize MCP server request: {err}"))?,
            )
            .send_and_await_response(5)
            .map_err(|err| format!("failed to contact spider for MCP servers: {err:?}"))?
            .map_err(|err| format!("spider returned an error for MCP servers: {err:?}"))?;

        let parsed: Result<Vec<SpiderMcpServerSummary>, String> = serde_json::from_slice(response.body())
            .map_err(|err| format!("failed to parse MCP server response: {err}"))?;

        parsed
            .map(|servers| SpiderMcpServersResult { servers })
            .map_err(|err| format!("spider MCP servers error: {err}"))
    }

    #[http]
    async fn spider_chat(&mut self, mut request: SpiderChatPayload) -> Result<SpiderChatResult, String> {
        if request.api_key.is_empty() {
            if let Some(stored) = &self.spider_api_key {
                request.api_key = stored.clone();
            } else {
                request.api_key = self
                    .spider_connect(Some(false))
                    .await?
                    .api_key;
            }
        }

        let spider_address = Address::new("our", SPIDER_PROCESS_ID);
        let mut refreshed_key: Option<String> = None;

        for attempt in 0..2 {
            let payload = json!({ "Chat": encode_spider_chat(&request) });
            let response = ProcessRequest::to(spider_address.clone())
                .body(
                    serde_json::to_vec(&payload)
                        .map_err(|err| format!("failed to serialize chat request: {err}"))?,
                )
                .send_and_await_response(30)
                .map_err(|err| format!("failed to contact spider for chat: {err:?}"))?
                .map_err(|err| format!("spider returned chat error: {err:?}"))?;

            let json_body: serde_json::Value = serde_json::from_slice(response.body())
                .map_err(|err| format!("failed to parse spider chat response: {err}"))?;

            if let Some(err_value) = json_body.get("Err") {
                let err_msg = err_value
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| err_value.to_string());
                if err_msg.contains("Invalid API key") && attempt == 0 {
                    match self.spider_connect(Some(true)).await {
                        Ok(new_key) => {
                            request.api_key = new_key.api_key.clone();
                            refreshed_key = Some(new_key.api_key);
                            continue;
                        }
                        Err(connect_err) => {
                            warn!("Failed to refresh spider API key: {connect_err}");
                        }
                    }
                }
                return Err(err_msg);
            }

            if let Some(ok_value) = json_body.get("Ok") {
                let mut parsed = decode_spider_chat(ok_value.clone())
                    .map_err(|err| format!("failed to decode spider chat payload: {err}"))?;
                if let Some(new_key) = refreshed_key.clone() {
                    self.spider_api_key = Some(new_key.clone());
                    parsed.refreshed_api_key = Some(new_key);
                } else if self.spider_api_key.is_none() {
                    self.spider_api_key = Some(request.api_key.clone());
                }
                return Ok(parsed);
            }

            warn!("Unexpected spider chat response: {json_body:?}");
            return Err("Spider returned an unexpected response".to_string());
        }

        Err("Unable to complete Spider chat request".to_string())
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
        // No demo content - users start with an empty slate
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiderApiKey {
    pub key: String,
    pub name: String,
    pub permissions: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiderConnectResult {
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiderStatusInfo {
    pub connected: bool,
    pub has_api_key: bool,
    #[serde(rename = "spider_available")]
    pub spider_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiderMcpServersResult {
    pub servers: Vec<SpiderMcpServerSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiderChatPayload {
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub messages: Vec<SpiderMessage>,
    #[serde(rename = "llmProvider")]
    pub llm_provider: Option<String>,
    pub model: Option<String>,
    #[serde(rename = "mcpServers")]
    pub mcp_servers: Option<Vec<String>>,
    pub metadata: Option<SpiderConversationMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiderChatResult {
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    pub response: SpiderMessage,
    #[serde(rename = "allMessages")]
    pub all_messages: Option<Vec<SpiderMessage>>,
    #[serde(rename = "refreshedApiKey", skip_serializing_if = "Option::is_none")]
    pub refreshed_api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiderMessage {
    pub role: String,
    pub content: SpiderMessageContent,
    #[serde(rename = "toolCallsJson")]
    pub tool_calls_json: Option<String>,
    #[serde(rename = "toolResultsJson")]
    pub tool_results_json: Option<String>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiderMessageContent {
    pub text: Option<String>,
    pub audio: Option<Vec<u8>>,
    pub base_six_four_audio: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiderConversationMetadata {
    #[serde(rename = "startTime")]
    pub start_time: String,
    pub client: String,
    #[serde(rename = "fromStt")]
    pub from_stt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiderMcpServerSummary {
    pub id: String,
    pub name: Option<String>,
    pub connected: bool,
}

fn encode_spider_chat(request: &SpiderChatPayload) -> serde_json::Value {
    let messages: Vec<serde_json::Value> = request
        .messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role,
                "content": encode_spider_content(&message.content),
                "toolCallsJson": message.tool_calls_json,
                "toolResultsJson": message.tool_results_json,
                "timestamp": message.timestamp,
            })
        })
        .collect();

    json!({
        "apiKey": request.api_key,
        "messages": messages,
        "llmProvider": request.llm_provider,
        "model": request.model,
        "mcpServers": request.mcp_servers,
        "metadata": request.metadata,
    })
}

fn encode_spider_content(content: &SpiderMessageContent) -> serde_json::Value {
    if let Some(text) = &content.text {
        return json!({ "Text": text });
    }
    if let Some(audio) = &content.audio {
        return json!({ "Audio": audio });
    }
    if let Some(base64) = &content.base_six_four_audio {
        return json!({ "BaseSixFourAudio": base64 });
    }
    serde_json::Value::Null
}

fn decode_spider_message(content: serde_json::Value) -> SpiderMessageContent {
    if let Some(text) = content.get("Text").and_then(|v| v.as_str()) {
        return SpiderMessageContent {
            text: Some(text.to_string()),
            audio: None,
            base_six_four_audio: None,
        };
    }
    if let Some(base64) = content.get("BaseSixFourAudio").and_then(|v| v.as_str()) {
        return SpiderMessageContent {
            text: None,
            audio: None,
            base_six_four_audio: Some(base64.to_string()),
        };
    }
    if let Some(audio) = content.get("Audio").and_then(|v| v.as_array()) {
        let bytes: Vec<u8> = audio
            .iter()
            .filter_map(|val| val.as_u64().and_then(|n| u8::try_from(n).ok()))
            .collect();
        return SpiderMessageContent {
            text: None,
            audio: Some(bytes),
            base_six_four_audio: None,
        };
    }
    if let Some(text) = content.as_str() {
        return SpiderMessageContent {
            text: Some(text.to_string()),
            audio: None,
            base_six_four_audio: None,
        };
    }
    SpiderMessageContent {
        text: None,
        audio: None,
        base_six_four_audio: None,
    }
}

fn decode_spider_chat(value: serde_json::Value) -> Result<SpiderChatResult, String> {
    let conversation_id = value
        .get("conversationId")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let response = value
        .get("response")
        .ok_or_else(|| "missing response".to_string())
        .and_then(decode_spider_message_obj)?;

    let all_messages = value
        .get("allMessages")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|val| decode_spider_message_obj(val).ok())
                .collect::<Vec<_>>()
        });

    Ok(SpiderChatResult {
        conversation_id,
        response,
        all_messages,
        refreshed_api_key: None,
    })
}

fn decode_spider_message_obj(value: &serde_json::Value) -> Result<SpiderMessage, String> {
    let role = value
        .get("role")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing role".to_string())?
        .to_string();

    let content = value
        .get("content")
        .ok_or_else(|| "missing content".to_string())
        .map(|c| decode_spider_message(c.clone()))?;

    let tool_calls_json = value
        .get("toolCallsJson")
        .and_then(|v| v.as_str())
        .map(String::from);
    let tool_results_json = value
        .get("toolResultsJson")
        .and_then(|v| v.as_str())
        .map(String::from);
    let timestamp = value
        .get("timestamp")
        .and_then(|v| v.as_u64())
        .unwrap_or_default();

    Ok(SpiderMessage {
        role,
        content,
        tool_calls_json,
        tool_results_json,
        timestamp,
    })
}
