"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/db";
import { renderTemplate, identifierError, type TemplateVar } from "@/lib/template";
import { localDate } from "@/lib/timezone";

const TEMPLATE_SYNTAX_DOC = `Daily note placeholders:
{Q1.question}  - question text
{Q1.answer}    - previous answer
{Q1.asked}     - true/false
{Q1.prompt}    - LLM answer prompt
$date("yyyy-MM-dd")          - entry date, e.g. 2026-08-10
$date("dddd")                - e.g. "Monday"
$date("d")                   - e.g. "10"
$date("MMMM d, yyyy")        - e.g. "August 10, 2026"`;

interface Question {
  id?: number;
  identifier: string;
  question: string;
  answer_prompt: string;
  asked: boolean;
  sort_order: number;
}

export function SettingsClient({
  initialProfile,
  initialQuestions,
  initialProfiles,
  initialTemplateContent,
}: {
  initialProfile: Profile | null;
  initialQuestions: Question[];
  initialProfiles: Profile[];
  initialTemplateContent: string | null;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [draft, setDraft] = useState<Profile | null>(initialProfile ? { ...initialProfile } : null);
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
  const [templateContent, setTemplateContent] = useState<string | null>(initialTemplateContent);
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<string>("general");
  const [aiTestResult, setAiTestResult] = useState("");
  const [aiTesting, setAiTesting] = useState(false);
  const [googleTestResult, setGoogleTestResult] = useState("");
  const [googleTesting, setGoogleTesting] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const preview = useMemo(() => {
    const tpl = templateContent ?? "No template file set — the app falls back to its built-in default template.";
    const vars: Record<string, TemplateVar> = {};
    for (const q of questions) {
      vars[q.identifier] = { question: q.question || "?", answer: "Nothing much.", asked: q.asked, prompt: q.answer_prompt || "..." };
    }
    const dateStr = localDate(Date.now(), draft?.timezone || "UTC");
    return {
      tpl,
      rendered: renderTemplate(tpl, vars, dateStr),
    };
  }, [questions, draft, templateContent]);

  useEffect(() => {
    const ok = new URLSearchParams(window.location.search).get("google_ok");
    if (ok) {
      setMessage(ok === "both" ? "Google connected" : `Google ${ok} connected`);
      window.history.replaceState({}, "", "/settings");
    }
  }, []);

  function updateDraft(partial: Partial<Profile>) {
    setDraft((prev) => prev ? { ...prev, ...partial } : prev);
    setDirty(true);
  }

  function updateQuestion(i: number, partial: Partial<Question>) {
    setQuestions((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...partial };
      return next;
    });
    setDirty(true);
  }

  function addQuestion() {
    setQuestions((prev) => [...prev, { identifier: `Q${prev.length + 1}`, question: "", answer_prompt: "", asked: true, sort_order: prev.length }]);
    setDirty(true);
  }

  function removeQuestion(i: number) {
    setQuestions((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  function moveQuestion(i: number, dir: number) {
    const j = i + dir;
    if (j < 0 || j >= questions.length) return;
    setQuestions((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setMessage("");
    try {
      if (dirty) {
        const bad = questions
          .map((q, i) => identifierError(q.identifier, questions.slice(0, i).map((x) => x.identifier)))
          .find(Boolean);
        if (bad) {
          setMessage(bad);
          return;
        }
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: draft, questions }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d.error) {
          setMessage(d.error || `Save failed (${res.status})`);
          return;
        }
        if (d.template_content !== undefined) setTemplateContent(d.template_content);
      }
      setMessage("Saved");
      setDirty(false);
      setTimeout(() => setMessage(""), 1500);
    } catch {
      setMessage("Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function createProfile() {
    if (!newProfileName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ create_profile: { name: newProfileName.trim() }, profile_questions: [] }),
      });
      const d = await res.json();
      if (d.error) { setMessage(d.error); return; }
      setNewProfileName("");
      const r = await fetch("/api/settings");
      const data = await r.json();
      setProfiles(data.profiles || []);
      setMessage("Profile created");
    } catch {
      setMessage("Failed to create");
    } finally {
      setSaving(false);
    }
  }

  async function activateProfile(id: number) {
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ set_active_profile_id: id }) });
    const r = await fetch("/api/settings");
    const d = await r.json();
    setProfile(d.profile);
    if (d.profile) setDraft({ ...d.profile });
    setQuestions(d.questions || []);
    setTemplateContent(d.template_content ?? null);
    setProfiles(d.profiles || []);
    setDirty(false);
    setMessage("Profile activated");
  }

  async function deleteProfile(id: number) {
    if (!confirm("Delete this profile? This removes its questions and entries.")) return;
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete_profile_id: id }) });
    const r = await fetch("/api/settings");
    const d = await r.json();
    setProfiles(d.profiles || []);
    setMessage("Profile deleted");
  }

  async function exportProfile(id: number) {
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ export_profile_id: id }) });
    const d = await res.json();
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `profile-${id}.json`;
    a.click();
  }

  async function importProfile(file: File) {
    const text = await file.text();
    const json = JSON.parse(text);
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ create_profile: json.profile, profile_questions: json.questions }) });
    const r = await fetch("/api/settings");
    const d = await r.json();
    setProfiles(d.profiles || []);
    setMessage("Profile imported");
  }

  async function testAI() {
    if (!draft) return;
    setAiTesting(true);
    setAiTestResult("");
    try {
      const res = await fetch("/api/ai-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: draft.llm_endpoint,
          model: draft.llm_model,
          apiKey: draft.llm_api_key,
        }),
      });
      const d = await res.json();
      setAiTestResult(d.success ? `Connected in ${d.latency_ms}ms` : (d.error || "Failed"));
    } catch {
      setAiTestResult("Connection error");
    } finally {
      setAiTesting(false);
    }
  }

  async function testGoogle() {
    setGoogleTesting(true);
    setGoogleTestResult("");
    try {
      const res = await fetch("/api/integrations/google-test");
      const d = await res.json();
      if (d.error) {
        setGoogleTestResult(d.error);
      } else {
        setGoogleTestResult(d.summary);
      }
    } catch {
      setGoogleTestResult("Connection error");
    } finally {
      setGoogleTesting(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function changePassword() {
    if (!currentPass || !newPass) return;
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ change_password: { currentPassword: currentPass, newPassword: newPass } }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) { setMessage(d.error || "Password change failed"); return; }
    setMessage("Password changed");
    setCurrentPass("");
    setNewPass("");
  }

  if (!profile && profiles.length === 0) {
    return (
      <div className="text-center py-12 space-y-4">
        <p className="text-zinc-400">No profiles configured.</p>
        <div className="flex gap-2 justify-center">
          <input value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} placeholder="Profile name" className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200" />
          <button onClick={createProfile} className="bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3 py-2 text-sm font-medium text-white">Create</button>
        </div>
        <label className="text-xs text-zinc-400 block cursor-pointer">
          or import <input type="file" accept=".json" onChange={(e) => e.target.files?.[0] && importProfile(e.target.files[0])} className="hidden" />
        </label>
      </div>
    );
  }

  if (!draft) return <p className="text-zinc-500 text-sm text-center py-12">No active profile. Select or create one.</p>;

  const tabs = ["general", "ai", "questions", "integrations", "profiles", "account"];

  return (
    <div className="-mx-4 flex h-full flex-col">
      {/* Fixed tab bar; content scrolls underneath (same pattern as viewer). */}
      <div className="bg-zinc-950 border-b border-zinc-800">
        <div className="flex overflow-x-auto overflow-y-hidden">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-emerald-500 text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none px-4 pt-4 pb-4">
        <div className="space-y-6">

      {tab === "general" && (
        <div className="space-y-3">
          <Field label="Daily note folder" value={draft.daily_note_folder} onChange={(v) => updateDraft({ daily_note_folder: v })} placeholder="/path/to/obsidian/vault/1 Dailies" />
          <Field label="Template note path" value={draft.template_note_path} onChange={(v) => updateDraft({ template_note_path: v })} placeholder="/path/to/template.md" />
          <details className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
            <summary className="text-sm cursor-pointer text-zinc-300 list-none">Template syntax &amp; preview</summary>
            <div className="mt-3 space-y-3 text-xs text-zinc-500 leading-relaxed">
              <p>Daily note template is plain Markdown with these placeholders:</p>
              <pre className="bg-zinc-950 border border-zinc-800 rounded p-3 overflow-x-auto text-zinc-300">{TEMPLATE_SYNTAX_DOC}</pre>
              <p>
                <code>$date("...")</code> follows{' '}
                <a href="https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings" target="_blank" rel="noreferrer" className="text-emerald-400 underline">
                  .NET custom date and time format strings
                </a>{' '}
                and formats the entry's date. Common codes: <code>dddd</code> full day, <code>MMMM</code> full month, <code>yyyy</code> year, <code>MM</code> month, <code>dd</code> day. <code>D</code> is accepted as <code>d</code>.
              </p>
              <p><strong className="text-zinc-300">Template preview</strong> — renders with today's date and your saved questions:</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <pre className="bg-zinc-950 border border-zinc-800 rounded p-3 overflow-x-auto text-zinc-300 whitespace-pre-wrap">{preview.tpl}</pre>
                <pre className="bg-zinc-950 border border-zinc-800 rounded p-3 overflow-x-auto text-zinc-300 whitespace-pre-wrap">{preview.rendered}</pre>
              </div>
              {!templateContent && (
                <p className="text-amber-400/80 bg-amber-900/20 rounded p-2">No template file set or readable — the app falls back to its built-in default template.</p>
              )}
            </div>
          </details>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Timezone</label>
            <select
              value={draft.timezone || "UTC"}
              onChange={(e) => updateDraft({ timezone: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              {["UTC", ...(typeof Intl.supportedValuesOf === "function"
                ? (Intl.supportedValuesOf("timeZone") as string[])
                : [])].map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {tab === "ai" && (
        <div className="space-y-3">
          <Field label="Endpoint" value={draft.llm_endpoint} onChange={(v) => updateDraft({ llm_endpoint: v })} placeholder="http://localhost:11434/v1" />
          <Field label="Model" value={draft.llm_model} onChange={(v) => updateDraft({ llm_model: v })} placeholder="llama3.2" />
          <Field label="API Key" value={draft.llm_api_key} onChange={(v) => updateDraft({ llm_api_key: v })} type="password" placeholder="(optional)" />
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Personality</label>
            <textarea
              value={draft.personality_prompt}
              onChange={(e) => updateDraft({ personality_prompt: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 h-24 resize-y"
            />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={testAI} disabled={aiTesting} className="text-xs bg-zinc-800 hover:bg-zinc-700 rounded px-3 py-1.5 text-zinc-300 disabled:opacity-50">
              {aiTesting ? "Testing..." : "Test connection"}
            </button>
            {aiTestResult && (
              <span className={`text-xs ${aiTestResult.startsWith("Connected") ? "text-emerald-400" : "text-red-400"}`}>
                {aiTestResult}
              </span>
            )}
          </div>
        </div>
      )}

      {tab === "questions" && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs text-zinc-400 pb-2 border-b border-zinc-800">
            <input
              type="checkbox"
              checked={draft.asking_method === "ask_in_one_go"}
              onChange={() => updateDraft({ asking_method: draft.asking_method === "ask_in_one_go" ? "one_by_one" : "ask_in_one_go" })}
            />
            Ask all questions at once
          </label>
          {questions.map((q, i) => {
            const nameErr = identifierError(q.identifier, questions.slice(0, i).map((x) => x.identifier));
            return (
              <div key={`q-${i}`} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <button onClick={() => moveQuestion(i, -1)} disabled={i === 0} className="text-zinc-600 hover:text-zinc-400 disabled:opacity-30 text-xs" title="Move up">&uarr;</button>
                  <button onClick={() => moveQuestion(i, 1)} disabled={i === questions.length - 1} className="text-zinc-600 hover:text-zinc-400 disabled:opacity-30 text-xs" title="Move down">&darr;</button>
                  <input
                    value={q.identifier}
                    onChange={(e) => updateQuestion(i, { identifier: e.target.value })}
                    className={`w-16 bg-zinc-800 border rounded px-2 py-1 text-xs text-zinc-200 ${nameErr ? "border-red-500" : "border-zinc-700"}`}
                    placeholder="ID"
                    title={nameErr ?? undefined}
                  />
                  <label className="flex items-center gap-1 text-xs text-zinc-500">
                    <input type="checkbox" checked={q.asked} onChange={(e) => updateQuestion(i, { asked: e.target.checked })} />
                    asked
                  </label>
                  <div className="flex-1" />
                  <button onClick={() => removeQuestion(i)} className="text-red-600 hover:text-red-400 text-xs" title="Delete">&times;</button>
                </div>
                {nameErr && <p className="text-xs text-red-400">{nameErr}</p>}
                <input value={q.question} onChange={(e) => updateQuestion(i, { question: e.target.value })} placeholder="Question text" className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200" />
                <input value={q.answer_prompt} onChange={(e) => updateQuestion(i, { answer_prompt: e.target.value })} placeholder="LLM answer prompt" className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200" />
              </div>
            );
          })}
          <button onClick={addQuestion} className="text-xs text-emerald-400 hover:text-emerald-300">
            + Add question
          </button>
        </div>
      )}

      {tab === "integrations" && (
        <div className="space-y-3">
          <details className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
            <summary className="text-sm cursor-pointer text-zinc-300 list-none">Google</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-zinc-500 leading-relaxed">
                Go to{' '}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-emerald-400 underline">console.cloud.google.com/apis/credentials</a>
                {' '}&rarr; first set up <strong>OAuth consent screen</strong> (External, add scopes for Tasks + Calendar).
                Then Create credentials &rarr; <strong>OAuth client ID</strong> &rarr; Web application.
                Add <code className="text-zinc-400 bg-zinc-800 px-1 rounded">http://localhost:11123/api/auth/google/callback</code> as Authorized redirect URI.
              </p>
              <p className="text-xs text-amber-400/80 bg-amber-900/20 rounded p-2">
                The redirect URI uses localhost. When accessing this app from another device on your LAN, Google will redirect you back to localhost:11123 — you must complete the OAuth callback by running{' '}
                <code className="text-amber-400 bg-amber-900/40 px-1 rounded">curl &quot;http://localhost:11123/api/auth/google/callback?code=...&amp;state=...&quot;</code>{' '}
                on the server machine, or open the link in a browser on the server itself.
              </p>
              <Field label="Google Client ID" value={draft.google_client_id || ""} onChange={(v) => updateDraft({ google_client_id: v })} placeholder="1234567890-xxx.apps.googleusercontent.com" />
              <Field label="Google Client Secret" value={draft.google_client_secret || ""} onChange={(v) => updateDraft({ google_client_secret: v })} type="password" placeholder="GOCSPX-xxx" />

              <div className="flex items-center gap-4 pt-1 border-t border-zinc-800">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!draft.google_tasks_enabled} onChange={(e) => updateDraft({ google_tasks_enabled: e.target.checked ? 1 : 0 })} />
                  Tasks
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!draft.google_calendar_enabled} onChange={(e) => updateDraft({ google_calendar_enabled: e.target.checked ? 1 : 0 })} />
                  Calendar
                </label>
              </div>

              <div className="flex items-center gap-2">
                <a href="/api/auth/google/login?service=both&return=/settings" className="text-xs bg-emerald-600 hover:bg-emerald-500 rounded px-3 py-1.5 text-white">
                  Connect Google
                </a>
                <button onClick={testGoogle} disabled={googleTesting} className="text-xs bg-zinc-800 hover:bg-zinc-700 rounded px-3 py-1.5 text-zinc-300 disabled:opacity-50">
                  {googleTesting ? "Testing..." : "Test"}
                </button>
              </div>
              {googleTestResult && (
                <p className={`text-xs px-2 py-1.5 rounded ${googleTestResult.startsWith("Fully") ? "bg-emerald-900/30 text-emerald-400" : "bg-zinc-800 text-zinc-400"}`}>
                  {googleTestResult}
                </p>
              )}
            </div>
          </details>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!draft.media_enabled} onChange={(e) => updateDraft({ media_enabled: e.target.checked ? 1 : 0 })} />
            Media gallery
          </label>
          {draft.media_enabled ? <Field label="Media folder" value={draft.media_folder} onChange={(v) => updateDraft({ media_folder: v })} placeholder="/path/to/photos" /> : null}

          <div className="pt-3 border-t border-zinc-800">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!draft.obsidian_enabled} onChange={(e) => updateDraft({ obsidian_enabled: e.target.checked ? 1 : 0 })} />
              Obsidian notes
            </label>
            {draft.obsidian_enabled ? (
              <div className="mt-3 space-y-3">
                <Field label="Note folder" value={draft.obsidian_folder} onChange={(v) => updateDraft({ obsidian_folder: v })} placeholder="/path/to/vault" />
                <Field label="Excluded folders (comma-separated)"
                  value={draft.obsidian_exclude_folders}
                  onChange={(v) => updateDraft({ obsidian_exclude_folders: v })}
                  placeholder="templates, attachments, archive"
                />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!draft.obsidian_include_content} onChange={(e) => updateDraft({ obsidian_include_content: e.target.checked ? 1 : 0 })} />
                  Include note content (generate a short summary of each note)
                </label>
                <p className="text-xs text-zinc-600">
                  Notes are matched to the session date via <code className="text-zinc-400">created</code> frontmatter,
                  falling back to file creation time. Includes same-day notes only.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {tab === "profiles" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} placeholder="New profile name" className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200" />
            <button onClick={createProfile} className="bg-emerald-600 hover:bg-emerald-500 rounded-lg px-3 py-2 text-xs font-medium text-white">Create</button>
            <label className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-3 py-2 text-xs font-medium text-zinc-300 cursor-pointer">
              Import<input type="file" accept=".json" onChange={(e) => { const f = e.target.files?.[0]; if (f) importProfile(f); }} className="hidden" /></label>
          </div>
          <details className="mt-2">
            <summary className="text-xs text-zinc-500 cursor-pointer list-none">Profile import format</summary>
            <pre className="mt-2 text-xs text-zinc-500 whitespace-pre-wrap">{`{ "profile": { ... }, "questions": [ ... ] }`}</pre>
          </details>
          <div className="space-y-2 mt-4">
            {profiles.map((p) => (
              <div key={p.id} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}{p.is_default ? <span className="text-xs text-zinc-500 ml-2">default</span> : null}</p>
                  <p className="text-xs text-zinc-600">{p.llm_model} &middot; {p.asking_method === "ask_in_one_go" ? "All at once" : "One by one"}</p>
                </div>
                {!p.is_active && <button onClick={() => activateProfile(p.id)} className="text-xs bg-zinc-800 hover:bg-zinc-700 rounded px-2 py-1 text-zinc-300 whitespace-nowrap">Activate</button>}
                <button onClick={() => exportProfile(p.id)} className="text-xs bg-zinc-800 hover:bg-zinc-700 rounded px-2 py-1 text-zinc-300 whitespace-nowrap">Export</button>
                {!p.is_default && <button onClick={() => deleteProfile(p.id)} className="text-xs bg-red-900/50 hover:bg-red-900 rounded px-2 py-1 text-red-300 whitespace-nowrap">Del</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "account" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-2">Change password</label>
            <div className="space-y-2 max-w-sm">
              <input type="password" value={currentPass} onChange={(e) => setCurrentPass(e.target.value)} placeholder="Current password" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200" />
              <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="New password" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200" />
              <button onClick={changePassword} className="text-xs bg-emerald-600 hover:bg-emerald-500 rounded px-3 py-2 text-white">Change</button>
            </div>
          </div>
          <button onClick={handleLogout} className="text-xs text-red-400 hover:text-red-300">Log out</button>
        </div>
      )}
        </div>
      </div>

      {dirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="fixed bottom-20 md:bottom-6 right-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-6 py-3 rounded-xl text-sm transition-colors shadow-lg z-40"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      )}

      {message && (
        <p className="text-sm fixed bottom-16 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-zinc-800 text-emerald-400 z-50 text-xs">
          {message}
        </p>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-xs text-zinc-500 mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 placeholder:text-zinc-500" />
    </div>
  );
}