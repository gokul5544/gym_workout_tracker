# Gym Tracker — Full Project Documentation

> This document is intended to give a complete LLM-readable understanding of the project: what it is, how it works, every design decision, every file, every function, and every known quirk. Read this before touching anything.

---

## 1. Project Overview

A zero-cost, browser-based gym workout tracker built as a **single HTML file**. It runs entirely in the browser (optimised for iPhone Chrome/Safari) and syncs workout data to **Google Sheets** via a Google Apps Script web app. There is no server, no database, no framework, no build step.

### Core goals
- Log sets (exercise, weight, reps, notes) during a workout
- Sync every set to Google Sheets automatically in real time
- Work offline and retry when signal returns
- Survive page refreshes without losing data
- Show rest timer, next-set clock, and pre-fill from previous sessions
- Hosted as a static file (originally Netlify, user migrating to Ubuntu VPS with nginx)

### Tech stack
- **Frontend:** Single HTML file — vanilla JS, no dependencies, no frameworks
- **Backend:** Google Apps Script deployed as a Web App (acts as a REST API)
- **Storage:** Google Sheets (primary/permanent) + localStorage (session crash recovery + offline queue)
- **Fonts:** Lora (serif), IBM Plex Mono (monospace), DM Sans (UI) — loaded from Google Fonts
- **Design language:** W2 Slate & Linen — see Section 4

---

## 2. File Structure

There are two files. That's it.

```
gym-tracker.html     — The entire frontend application
apps-script.gs       — Google Apps Script backend (paste into Apps Script editor)
```

### gym-tracker.html
One file containing HTML structure, all CSS, and all JavaScript. No external dependencies except Google Fonts. The Apps Script URL is the only configuration needed — marked with `YOUR_APPS_SCRIPT_URL_HERE`.

### apps-script.gs
Deployed as a Google Apps Script Web App. Handles POST (log a set) and GET (history / prefill) requests. Bound to a Google Spreadsheet where all workout data lives.

---

## 3. Architecture & Data Flow

### Writing a set (POST)
1. User fills in weight + reps + optional notes, taps **Log Set**
2. JS immediately writes the set to `sessionLog` (in-memory object) and `localStorage` (crash recovery)
3. JS sends a `fetch` POST to the Apps Script URL with the set payload
4. Apps Script appends a row to the correct sheet tab in Google Sheets
5. If the fetch fails (no signal), the payload goes into `offlineQueue` in localStorage
6. A `setInterval` retries the queue every 5 seconds until it flushes

### Reading history (GET)
- When user taps **Last 3 Sessions**, the app fetches `?action=history&exercise=NAME`
- Apps Script reads the exercise's sheet tab, groups rows by date, returns last 3 dates as JSON
- Displayed in a bottom-sheet modal

### Pre-filling weight/reps
Two-tier priority system:
1. **Within-session (priority 1):** If the current session already has sets logged for this exercise, the weight from the last set auto-fills the weight field. Reps are cleared (user must re-enter intentionally).
2. **Cross-session (priority 2, fallback):** If no current session data exists for this exercise, the app fetches `?action=prefill&exercise=NAME` from Sheets and populates weight + reps from the most recent row. A "Pre-filled from last session" hint appears.

### localStorage keys
| Key | Purpose |
|-----|---------|
| `gym_exercises` | User-added exercises (extras beyond defaults) |
| `gym_offline_queue` | Sets that failed to POST, waiting to retry |
| `gym_active_session` | Full session snapshot for crash/refresh recovery |

---

## 4. Design System — W2 Slate & Linen

The design went through 15+ iterations across two series (Utilitarian and Analog Warmth). The user selected W2 from the Analog Warmth series.

### Colour tokens
```css
--bg:         #2a2d35   /* slate blue-grey, main background */
--surface:    #23262e   /* card/block surfaces */
--surface2:   #1e2028   /* deeper inset surfaces, header */
--border:     #353840   /* standard border */
--border2:    #2e3138   /* subtle inner borders */
--text:       #e8e0d0   /* warm cream — primary text */
--muted:      #6a6d78   /* mid grey — labels, secondary text */
--muted2:     #4a4d58   /* darker muted — faint labels */
--terracotta: #c4613a   /* rest card active state — full bleed */
--terra-text: #e8b09a   /* terracotta-toned text */
--warning:    #f59e0b   /* amber — offline badge, restore banner */
--danger:     #ef4444   /* red — delete, error */
--success:    #4ade80   /* green — session active pill */
--cream-btn:  #c8c0b0   /* log set button, highlights */
```

### Typography
- **Lora** (serif, Google Fonts) — exercise names, headings, modal titles, start screen logo
- **IBM Plex Mono** (monospace, Google Fonts) — all numbers: timers, set data, badges, history rows
- **DM Sans** (sans-serif, Google Fonts) — UI chrome: buttons, labels, toasts, form text

### Design principles
- No gradients, no glows, no glassmorphism
- Borders and typography create structure, not decoration
- Set log rows are ledger-style: border-bottom only, no cards
- One inverted accent moment per screen: rest card flips to solid terracotta when active
- Inputs use `border-radius: 3px` (near-square, not pill)
- Buttons are rectangular, DM Sans, 800 weight, letter-spaced uppercase

---

## 5. JavaScript State

All state lives in module-level variables. There is no framework, no reactive system.

```js
sessionActive       boolean       Whether a session is in progress
sessionStartTime    Date|null     When the session started (for elapsed timer)
sessionTimerInt     interval ID   Ticks the session elapsed display
sessionLog          object        { exerciseName: [setEntry, ...] }
                                  The source of truth for current session sets

restTimerInt        interval ID   Ticks the rest count-up display
restStartTime       timestamp     Date.now() when rest started
restElapsed         number        Seconds elapsed since last set logged
restActive          boolean       Whether rest timer is currently counting

restTargetIdx       number        Index into REST_TARGET_STEPS array (default 5 = 3:00)
restTargetSecs      number        Current target rest in seconds

pendingDelEx        string|null   Exercise name awaiting delete confirmation
pendingDelIdx       number|null   Set index awaiting delete confirmation
editingEx           string|null   Exercise name currently being edited inline
editingIdx          number|null   Set index currently being edited inline

exerciseSelectOpen  boolean       Whether the exercise picker dropdown is visible

userExercises       array         Extra exercises added by user (persisted to localStorage)
exerciseList        array         Full list = DEFAULT_EXERCISES + userExercises, sorted
offlineQueue        array         Sets that failed to sync, waiting to retry
```

### setEntry object shape
Every logged set is stored as this object in `sessionLog[exercise][]`:
```js
{
  setNum:   number,   // 1-based position in this session for this exercise
  weight:   string,   // e.g. "225" or "—" if not entered
  reps:     string,   // e.g. "5"
  notes:    string,   // e.g. "felt strong" or "—"
  restTime: string,   // e.g. "2m 14s" or "—" for first set
  time:     string    // e.g. "09:31" — wall clock time when logged
}
```

---

## 6. Key Functions Reference

### Session lifecycle
| Function | What it does |
|----------|-------------|
| `startSession()` | Sets `sessionActive=true`, records start time, shows active UI |
| `showSessionUI()` | DOM manipulation to swap start screen for active session view |
| `confirmEndSession()` | Shows native confirm dialog with set count summary |
| `endSession()` | Resets all state, clears localStorage session, returns to start screen |
| `updateSessionTimer()` | Called every second, updates elapsed time display in session bar |

### Session persistence (crash/refresh recovery)
| Function | What it does |
|----------|-------------|
| `saveSessionState()` | Serialises `sessionLog` + `sessionStartTime` + today's date to `localStorage` |
| `clearSessionState()` | Removes the saved session from `localStorage` |
| `checkForSavedSession()` | On page load: checks for today's saved session, shows restore banner if found |
| `restoreSession()` | Reads saved state, rebuilds `sessionLog`, resumes session timer |
| `dismissRestore()` | Discards saved session, hides banner |

### Exercise management
| Function | What it does |
|----------|-------------|
| `populateDropdown(selected)` | Rebuilds the `<select>` options from `exerciseList` |
| `toggleExerciseSelect()` | Shows/hides the dropdown row (tap-to-change pattern) |
| `onExerciseSelect()` | Fires when exercise changes: updates display name, shows rest card, triggers pre-fill |
| `addExercise()` | Adds new exercise to list, saves to localStorage, selects it |
| `deleteExercise()` | Removes exercise from list, resets exercise UI |
| `saveUserExercises()` | Persists only the non-default exercises to localStorage |

### Pre-fill
| Function | What it does |
|----------|-------------|
| `prefillForExercise(exercise)` | Priority router: checks session first, falls back to Sheets fetch |
| `fetchLastEntryFromSheets(exercise)` | GET `?action=prefill&exercise=NAME`, populates weight + reps fields, shows hint |

### Rest timer
| Function | What it does |
|----------|-------------|
| `startRestTimer()` | Resets elapsed, sets `restActive=true`, starts interval |
| `stopRestTimer()` | Clears interval, sets `restActive=false` |
| `resetRestTimer()` | Stops timer, zeroes elapsed, hides "next set at" display |
| `updateRestUI(isResting)` | Toggles `.resting` class on rest card (terracotta flip), updates display |
| `showNextSetTime()` | Calculates `now + restTargetSecs`, shows "NEXT SET AT HH:MM" |
| `getRestStr()` | Returns human string like "2m 14s" or "—" for logging to Sheets |
| `initRestTarget()` | Called when exercise selected — sets default 3:00, marks bar as unset |
| `stepRestTarget(dir)` | +1/-1 through REST_TARGET_STEPS array, removes unset class on first touch |
| `updateRestTargetDisplay()` | Updates the target stepper display text from current index |

### Rest target stepper
```js
const REST_TARGET_STEPS = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300]
// 0:30, 1:00, 1:30, 2:00, 2:30, 3:00 (default, index 5), 3:30, 4:00, 4:30, 5:00
```

### Set logging
| Function | What it does |
|----------|-------------|
| `logSet()` | Validates, creates setEntry, pushes to sessionLog, saves state, sends to Sheets, starts rest timer |
| `clearSetForm()` | Clears weight/reps/notes inputs |
| `stepWeight(dir)` | +/- 0.5 on weight stepper button |
| `stepReps(dir)` | +/- 1 on reps stepper button |
| `updateSetBadge(exercise)` | Updates "Set N" badge and exercise title in form header |
| `getNextSetNum(exercise)` | Returns `sessionLog[exercise].length + 1` |

### Set editing (inline)
| Function | What it does |
|----------|-------------|
| `openEditSet(exercise, index)` | Closes any open edit, populates edit row inputs, adds `.open` class |
| `closeEditSet()` | Removes `.open` from edit row, nulls editing state |
| `saveEditSet(exercise, index)` | Reads edit row inputs, validates reps, updates sessionLog, re-renders |

**Critical ID note:** Edit rows use numeric IDs only — `editrow-0`, `editrow-1`, etc. Never embed exercise names in element IDs — exercise names contain spaces and special characters that break `getElementById`. The exercise name is passed as a JS function argument only.

### Set deletion
| Function | What it does |
|----------|-------------|
| `promptDeleteSet(exercise, index)` | Stores pending delete, opens confirm overlay |
| `closeConfirm()` | Closes confirm overlay, nulls pending state |
| `executeDeleteSet()` | Splices set from sessionLog, renumbers remaining sets, re-renders |

### History modal
| Function | What it does |
|----------|-------------|
| `openHistory()` | Shows modal with spinner, fetches `?action=history&exercise=NAME` from Sheets |
| `closeHistory()` | Hides modal |

### Offline queue
| Function | What it does |
|----------|-------------|
| `flushQueue()` | Called every 5s via setInterval — attempts to POST each queued item, keeps failures |
| `updateOfflineBadge()` | Shows/hides the amber "X queued" pill in session bar |

### Rendering
| Function | What it does |
|----------|-------------|
| `renderSetsLog(exercise)` | Rebuilds the full set log DOM for the current exercise from sessionLog |
| `renderSessionSummary()` | Rebuilds the session summary block (exercise → set count) |

---

## 7. Apps Script Backend

### Deployment
- Open Google Apps Script (script.google.com)
- Paste `apps-script.gs` contents
- Deploy → New deployment → Web App
- Execute as: **Me**
- Who has access: **Anyone**
- Copy the deployment URL — this is `APPS_SCRIPT_URL` in the HTML file

### Rate limiting
200 requests per day via `PropertiesService`. The counter key includes today's date so it auto-resets at midnight. Both GET and POST count toward the limit.

### POST — `doPost(e)`
Logs a set. Creates the exercise sheet tab if it doesn't exist yet (with formatted header row). Appends one row per set.

**Request body (JSON):**
```json
{
  "exercise": "Deadlift",
  "date": "23/02/2026",
  "time": "09:31",
  "sets": 1,
  "reps": "5",
  "weight": "225",
  "notes": "—",
  "restTime": "2m 14s"
}
```

**Sheet column order:** Date | Time | Set # | Reps | Weight (lbs) | RPE / Notes | Rest Before Set

**Important:** Sheet tabs are named exactly after the exercise. The header row is only written once on tab creation. Existing data is never modified.

### GET — `doGet(e)`
Two actions selected via `?action=` parameter:

**`?action=prefill&exercise=NAME`**
Returns weight and reps from the last row in the exercise's sheet tab.
```json
{ "weight": "225", "reps": "5" }
```

**`?action=history&exercise=NAME`**
Returns last 3 training dates for the exercise, most recent first, with all sets per date.
```json
[
  {
    "date": "23/02/2026",
    "sets": [
      { "setNum": 1, "time": "09:31", "reps": "5", "weight": "225", "notes": "—", "restTime": "—" },
      { "setNum": 2, "time": "09:35", "reps": "5", "weight": "225", "notes": "—", "restTime": "2m 14s" }
    ]
  }
]
```

---

## 8. Default Exercise List

Hardcoded in `DEFAULT_EXERCISES`. These are never written to localStorage — only user-added extras are persisted.

```
Abs Crunch
Clean And Press
Deadlift
Incline Bench Press 30 Degree
Lateral Raise Dumbbell Inward
Pull Ups
Push Press
Squat
Strict Shoulder Press
```

---

## 9. Session Restore (Refresh Safety)

Every time a set is logged or deleted, the full session state is written to `localStorage['gym_active_session']`:

```json
{
  "sessionLog": { "Deadlift": [...] },
  "sessionStartTime": "2026-02-23T09:15:00.000Z",
  "date": "23/02/2026"
}
```

On page load, `checkForSavedSession()` runs and checks:
1. Does a saved session exist?
2. Is it from today?
3. Does it contain at least one set?

If all three: shows an amber restore banner with set count summary. User taps **Restore** → session resumes exactly where it left off including the elapsed session timer. User taps **Discard** → state is cleared.

The session state is cleared on `endSession()` and on `dismissRestore()`.

**What survives a refresh:** All logged sets, session start time, which exercises were used.
**What does not survive a refresh:** The rest timer (resets to 0), the exercise dropdown selection (user must re-select), any values typed into the form but not yet logged.

---

## 10. HTML Structure Overview

```
<header>                          Training Log title + date/time
<session-bar>                     Green active pill + session elapsed + offline badge
<restore-banner>                  Amber banner shown on page load if saved session found
<start-screen>                    Shown when no session active
<active-session>                  Shown during active session (hidden initially)
  <exercise-block>
    <exercise-name-row>           Tap to toggle dropdown open/closed
    <exercise-select-row>         Hidden by default, shown when tapped
      <select>                    Exercise dropdown
      <add-exercise-row>          Text input + Add button
    <exercise-action-row>         "Last 3 Sessions" + "Remove" buttons
  <rest-card>                     Hidden until exercise selected
    <rest-top>                    Timer display + Reset button
    <rest-target-bar>             Prominent stepper for target rest (0:30–5:00)
  <set-form>                      Weight + Reps steppers + Notes + Log Set button
  <sets-log>                      Ledger-style logged sets for current exercise
  <session-summary>               Exercise → set count overview
  <end-session-btn>
<history-modal>                   Bottom sheet, fetches from Sheets on open
<confirm-overlay>                 Delete confirmation dialog
<toast>                           Ephemeral status messages
```

---

## 11. Known Quirks & Hard-Won Lessons

### iOS Safari / Chrome limitations
- The app cannot reliably alert through the lock screen. Solution: "NEXT SET AT HH:MM" clock display so user checks their watch.
- `maximum-scale=1.0, user-scalable=no` in viewport meta prevents iOS double-tap zoom on inputs.
- Inputs use `inputmode="decimal"` (weight) and `inputmode="numeric"` (reps) to trigger the numeric keypad instead of full keyboard.

### Exercise names in element IDs — NEVER DO THIS
Exercise names contain spaces (e.g. "Pull Ups", "Clean And Press") which make them invalid HTML IDs and cause `getElementById` to return null silently. All dynamic element IDs use only numeric indices. Exercise names are passed as JavaScript function arguments, never embedded in IDs.

**Wrong:**
```js
document.getElementById(`edit-${exercise}-${index}`)  // "edit-Pull Ups-0" — broken
```
**Right:**
```js
document.getElementById(`editrow-${index}`)  // "editrow-0" — safe
```

### fetch mode: no-cors
All POST requests use `mode: 'no-cors'` because the Apps Script endpoint doesn't return CORS headers on POST. This means the response body is opaque and unreadable — the app cannot confirm success from the response. Success is assumed if no exception is thrown; failure goes to the offline queue.

GET requests do not use `no-cors` because they need to read the response body.

### Apps Script redeployment
Any change to `doGet` or `doPost` requires a **new deployment version** in Apps Script. Editing and saving the script without deploying a new version does not update the live URL. The URL itself stays the same across versions — only the code changes.

### Sheet header safety
The header row (`Date | Time | Set # | Reps | Weight (lbs) | RPE / Notes | Rest Before Set`) is only written when a new exercise sheet tab is **created for the first time**. If a tab already exists, `doPost` skips directly to `appendRow`. Existing data is never touched.

### History fetch vs localStorage
The history modal previously read from localStorage. It now fetches live from Google Sheets via the GET endpoint. This was changed because the app is permanently hosted on a VPS with reliable signal, making Sheets the better single source of truth. localStorage is now used only for crash recovery and the offline queue.

---

## 12. Deployment

### Current / target: Ubuntu VPS with nginx
```bash
sudo apt install nginx
sudo nano /var/www/html/index.html   # paste gym-tracker.html contents
# App accessible at http://VPS_IP
```

Optional HTTPS:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### Configuration required in gym-tracker.html
```js
const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';
// Replace with the Web App URL from Apps Script deployment
```

### Apps Script setup
1. Go to script.google.com
2. Open or create a project bound to your workout Google Spreadsheet
3. Paste the contents of `apps-script.gs`
4. Deploy → New deployment → Web App → Execute as Me → Anyone → Deploy
5. Copy the URL and paste it into `gym-tracker.html`

---

## 13. What Has Been Deliberately Left Out

- No authentication — the app is personal, URL obscurity is sufficient
- No edit-to-Sheets sync — inline edits update `sessionLog` and localStorage only, not the Sheets row (the row was already appended at log time)
- No delete-from-Sheets — deletions only affect the current session in memory; the Sheets row remains
- No service worker / PWA — kept simple, refresh recovery via localStorage is sufficient
- No charts or analytics — raw data is in Sheets where the user can build their own
