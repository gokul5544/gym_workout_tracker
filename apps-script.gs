// =============================================
// GYM TRACKER — Google Apps Script Backend
// =============================================
// Deploy as a Web App:
//   Execute as: Me
//   Who has access: Anyone
// =============================================

const DAILY_LIMIT = 200;

function getRateLimitKey() {
  // Key resets automatically each day
  return 'requests_' + new Date().toISOString().slice(0, 10); // e.g. "requests_2026-02-20"
}

function isRateLimited() {
  const props = PropertiesService.getScriptProperties();
  const key = getRateLimitKey();
  const count = parseInt(props.getProperty(key) || '0');
  if (count >= DAILY_LIMIT) return true;
  props.setProperty(key, String(count + 1));
  return false;
}

// =============================================
// POST — Log a set
// =============================================
function doPost(e) {
  try {
    if (isRateLimited()) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Daily limit reached' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const data = JSON.parse(e.postData.contents);

    // ─── ACTION: update (edit sync) ──────────────────────────────
    if (data.action === 'update') {
      return handleUpdate(data);
    }

    const exerciseName = data.exercise;
    const date        = data.date;
    const time        = data.time;
    const sets        = data.sets;
    const reps        = data.reps;
    const weight      = data.weight;
    const notes       = data.notes;
    const restTime    = data.restTime || '—';

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(exerciseName);

    // Auto-create a tab for this exercise if it doesn't exist yet
    if (!sheet) {
      sheet = ss.insertSheet(exerciseName);
      sheet.appendRow(['Date', 'Time', 'Set #', 'Reps', 'Weight (lbs)', 'RPE / Notes', 'Rest Before Set']);
      const headerRange = sheet.getRange(1, 1, 1, 7);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#064e3b');
      headerRange.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([date, time, sets, reps, weight, notes, restTime]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// =============================================
// UPDATE — Find a row by date + set# and overwrite reps/weight/notes
// =============================================
function handleUpdate(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(data.exercise);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Sheet not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) { // skip header row (i=0)
    // Normalize date — Sheets may auto-parse the cell as a Date object
    let rowDate = rows[i][0];
    if (rowDate instanceof Date) {
      rowDate = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), 'dd/MM/yyyy');
    } else {
      rowDate = String(rowDate);
    }
    const rowSetNum = String(rows[i][2]);

    if (rowDate === data.date && rowSetNum === String(data.setNum)) {
      // Columns (1-indexed): Reps=4, Weight(lbs)=5, RPE/Notes=6
      sheet.getRange(i + 1, 4).setValue(data.reps);
      sheet.getRange(i + 1, 5).setValue(data.weight);
      sheet.getRange(i + 1, 6).setValue(data.notes);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: 'Row not found' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================
// GET — Two actions:
//   ?action=history&exercise=NAME  → last 3 sessions grouped by date
//   ?action=prefill&exercise=NAME  → last logged weight + reps for that exercise
// =============================================
function doGet(e) {
  try {
    if (isRateLimited()) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'Daily limit reached' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const action   = e.parameter.action   || 'history';
    const exercise = e.parameter.exercise || '';

    if (!exercise) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'No exercise specified' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(exercise);

    // Sheet doesn't exist yet — return empty results for either action
    if (!sheet) {
      const empty = action === 'prefill' ? {} : [];
      return ContentService
        .createTextOutput(JSON.stringify(empty))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const rows = sheet.getDataRange().getValues();
    // Only header row — no data yet
    if (rows.length <= 1) {
      const empty = action === 'prefill' ? {} : [];
      return ContentService
        .createTextOutput(JSON.stringify(empty))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ─── ACTION: prefill ────────────────────────────────────────
    // Returns the weight and reps from the most recent (last) row
    if (action === 'prefill') {
      const lastRow = rows[rows.length - 1];
      // Columns: Date(0), Time(1), Set#(2), Reps(3), Weight(4), Notes(5), RestTime(6)
      const weight = String(lastRow[4] || '').trim();
      const reps   = String(lastRow[3] || '').trim();
      return ContentService
        .createTextOutput(JSON.stringify({ weight, reps }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ─── ACTION: history ────────────────────────────────────────
    // Groups all rows by date, returns last 3 dates most recent first
    const sessionMap = {};
    for (let i = 1; i < rows.length; i++) {
      const [date, time, setNum, reps, weight, notes, restTime] = rows[i];
      const dateStr = String(date);
      // Sheets auto-parses time strings like "09:17" as Date objects — format them back
      let timeStr;
      if (time instanceof Date) {
        timeStr = Utilities.formatDate(time, Session.getScriptTimeZone(), 'HH:mm');
      } else {
        timeStr = String(time);
      }
      if (!sessionMap[dateStr]) sessionMap[dateStr] = [];
      sessionMap[dateStr].push({
        setNum:   setNum,
        time:     timeStr,
        reps:     String(reps),
        weight:   String(weight),
        notes:    String(notes    || '—'),
        restTime: String(restTime || '—')
      });
    }

    // Sort dates chronologically and take the last 3, most recent first
    const allDates = Object.keys(sessionMap).sort();
    const last3    = allDates.slice(-3).reverse();
    const sessions = last3.map(date => ({
      date,
      sets: sessionMap[date]
    }));

    return ContentService
      .createTextOutput(JSON.stringify(sessions))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
