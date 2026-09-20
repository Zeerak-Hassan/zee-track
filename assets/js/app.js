// =============================================================
// LOGBOOK v1.3.3
// =============================================================

const APP_VERSION = 'v1.3.3';

// =============================================================
// INDEXED DB
// =============================================================
const DB_NAME = 'logbook';
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('routines'))  d.createObjectStore('routines',  { keyPath: 'id' });
      if (!d.objectStoreNames.contains('workouts'))  d.createObjectStore('workouts',  { keyPath: 'id' });
      if (!d.objectStoreNames.contains('exercises')) d.createObjectStore('exercises', { keyPath: 'name' });
      if (!d.objectStoreNames.contains('meta'))      d.createObjectStore('meta',      { keyPath: 'key' });
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e.target.error);
  });
}

const tx      = (store, mode = 'readonly') => db.transaction(store, mode).objectStore(store);
const dbGetAll = store => new Promise((res, rej) => { const r = tx(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbGet    = (store, key) => new Promise((res, rej) => { const r = tx(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbPut    = (store, val) => new Promise((res, rej) => { const r = tx(store, 'readwrite').put(val); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
const dbDel    = (store, key) => new Promise((res, rej) => { const r = tx(store, 'readwrite').delete(key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
const dbClear  = store => new Promise((res, rej) => { const r = tx(store, 'readwrite').clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });

// =============================================================
// EXERCISE CATALOGUE — comprehensive, categorised
// =============================================================
const EXERCISE_CATALOGUE = {
  'Chest': [
    'Bench Press', 'Incline Bench Press', 'Decline Bench Press',
    'Dumbbell Bench Press', 'Incline Dumbbell Press', 'Dumbbell Fly',
    'Cable Fly', 'Pec Deck', 'Push-Up', 'Dip',
    'Smith Machine Flat Press', 'Smith Machine Incline Press',
  ],
  'Back': [
    'Deadlift', 'Sumo Deadlift',
    'Pull-Up', 'Chin-Up',
    'Lat Pulldown', 'Seated Cable Row', 'Bent-Over Row', 'Barbell Row',
    'Pendlay Row', 'Dumbbell Row', 'T-Bar Row', 'Widegrip Rows',
    'Seated Rows', 'Face Pull',
  ],
  'Shoulders': [
    'Overhead Press', 'Dumbbell Shoulder Press', 'Machine Shoulder Press',
    'Shoulder Press', 'Arnold Press',
    'Lateral Raise', 'Machine Lateral Raises', 'Cable Lateral Raises',
    'Front Raise', 'Rear Delt Fly', 'Rear Delt',
    'Upright Row', 'Shrug',
  ],
  'Arms — Biceps': [
    'Bicep Curl', 'Hammer Curl', 'Preacher Curl', 'Cable Curl',
    'Incline Dumbbell Curl', 'Concentration Curl',
    'Reverse Grip Cable Curl', 'Barbell Curl',
  ],
  'Arms — Triceps': [
    'Tricep Pushdown', 'Overhead Rope Pushdown', 'Single Arm Cable Pushdown',
    'Skull Crusher', 'Overhead Tricep Extension', 'Close-Grip Bench Press',
    'JM Press', 'Tricep Dip',
  ],
  'Arms — Forearms': [
    'Forearms', 'Wrist Curl', 'Reverse Wrist Curl', 'Farmers Carry',
  ],
  'Legs': [
    'Back Squat', 'Front Squat', 'Bulgarian Split Squat',
    'Leg Press', 'Leg Extension', 'Leg Curl',
    'Hip Thrust', 'Romanian Deadlift',
    'Calf Raise (Standing)', 'Calf Raise (Seated)',
    'Hack Squat', 'Lunge',
  ],
  'Core': [
    'Plank', 'Ab Wheel', 'Cable Crunch', 'Hanging Leg Raise',
    'Sit-Up', 'Crunch', 'Abs', 'Russian Twist', 'Leg Raise',
  ],
};

// Flat sorted list for search
const ALL_EXERCISES_FLAT = Object.values(EXERCISE_CATALOGUE).flat();

async function seedExercises() {
  const existing = await dbGetAll('exercises');
  const existingNames = new Set(existing.map(e => e.name));
  // Add any catalogue exercises not yet in DB
  for (const name of ALL_EXERCISES_FLAT) {
    if (!existingNames.has(name)) {
      await dbPut('exercises', { name, builtin: true, unit: 'kg' });
    }
  }
  // Migration: ensure every exercise has a unit
  for (const ex of existing) {
    if (!ex.unit) { ex.unit = 'kg'; await dbPut('exercises', ex); }
  }
}

async function getExerciseUnit(name) {
  const ex = await dbGet('exercises', name);
  return (ex && ex.unit) || 'kg';
}

// =============================================================
// STATE
// =============================================================
const state = {
  currentView: 'home',
  editingRoutine: null,
  activeWorkout: null,
  deferredInstallPrompt: null,
  _exConfigCallback: null,
  _exConfigUnit: null,
  _pendingImport: null,
  _editingWorkout: null,
};

// =============================================================
// HELPERS
// =============================================================
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const fmtDate = ts => {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  const dt    = new Date(d); dt.setHours(0,0,0,0);
  const diff  = Math.round((today - dt) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7)  return `${diff}d ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const fmtTime = ms => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
};

const dayKey = ts => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function getWorkoutStreak(workouts) {
  const days = [...new Set(workouts.map(w => dayKey(w.finishedAt)).filter(Boolean))].sort((a, b) => b - a);
  if (days.length === 0) return 0;
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    const diff = Math.round((days[i - 1] - days[i]) / 86400000);
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

function getUniqueExerciseCount(routines, workouts) {
  const names = new Set();
  routines.forEach(r => (r.exercises || []).forEach(ex => names.add(ex.name)));
  workouts.forEach(w => (w.exercises || []).forEach(ex => names.add(ex.name)));
  return names.size;
}

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2400);
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsString = s => JSON.stringify(String(s));

async function getCompletedWorkouts() {
  return (await dbGetAll('workouts'))
    .filter(w => w.finishedAt)
    .sort((a, b) => b.finishedAt - a.finishedAt);
}

function getSetCount(workout) {
  return (workout.exercises || []).reduce((sum, ex) => sum + (ex.sets || []).length, 0);
}

function getBestSet(exercise) {
  const sets = (exercise.sets || []).filter(s => s.weight !== '' && s.reps !== '');
  if (sets.length === 0) return null;
  return sets.reduce((best, set) => isBetterSet(set, best) ? set : best, sets[0]);
}

function isBetterSet(candidate, current) {
  if (!current) return true;
  const candidateWeight = parseFloat(candidate.weight) || 0;
  const currentWeight = parseFloat(current.weight) || 0;
  const candidateReps = parseInt(candidate.reps) || 0;
  const currentReps = parseInt(current.reps) || 0;
  if (candidateWeight > currentWeight) return true;
  return candidateWeight === currentWeight && candidateReps > currentReps;
}

function setLabel(set, unit = 'kg') {
  if (!set) return 'No sets';
  const unitLabel = unit === 'plates' ? 'plates' : 'kg';
  return `${set.weight} ${unitLabel} x ${set.reps}`;
}

function workoutTitle(workout) {
  return workout.name || 'Workout';
}

function workoutMeta(workout) {
  const exCount = (workout.exercises || []).length;
  const setCount = getSetCount(workout);
  const duration = workout.duration ? ` | ${fmtTime(workout.duration)}` : '';
  return `${exCount} exercise${exCount === 1 ? '' : 's'} | ${setCount} set${setCount === 1 ? '' : 's'}${duration}`;
}

// =============================================================
// VIEW SWITCHING
// =============================================================
function showView(name) {
  state.currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo(0, 0);
  updateFAB();
  if (name === 'home')     renderHome();
  if (name === 'history')  renderHistory();
  if (name === 'progress') renderProgress();
  if (name === 'settings') renderAppStatus();
}

function updateFAB() {
  document.getElementById('fab').classList.toggle('hidden', state.currentView !== 'home');
}
function onFabClick() { openRoutineEditor(null); }

// =============================================================
// HOME


// =============================================================
// ROUTINE EDITOR
// =============================================================
async function openRoutineEditor(id) {
  if (id) {
    state.editingRoutine = await dbGet('routines', id);
    document.getElementById('routineEditTitle').textContent = 'Edit Routine';
    document.getElementById('deleteRoutineBtn').classList.remove('hidden');
  } else {
    state.editingRoutine = { id: uid(), name: '', exercises: [], createdAt: Date.now() };
    document.getElementById('routineEditTitle').textContent = 'New Routine';
    document.getElementById('deleteRoutineBtn').classList.add('hidden');
  }
  document.getElementById('routineNameInput').value = state.editingRoutine.name;
  renderRoutineExercises();
  showView('routine-edit');
}

function renderRoutineExercises() {
  const r = state.editingRoutine;
  document.getElementById('routineExCount').textContent = r.exercises.length;
  const list = document.getElementById('routineExercisesList');
  if (r.exercises.length === 0) {
    list.innerHTML = `<p class="text-faint center soft-empty">No exercises yet.</p>`;
    return;
  }
  list.innerHTML = r.exercises.map((ex, i) => {
    const unit = ex.unit || 'kg';
    return `
    <div class="exercise-row">
      <div>
        <div class="name">${escapeHtml(ex.name)}<span class="unit-tag unit-tag-${unit}">${unit}</span></div>
        <div class="targets">${ex.sets} sets · ${ex.reps} reps target</div>
      </div>
      <div class="actions">
        <button class="icon-btn rename-ex-btn" title="Rename" data-exname="${escapeHtml(ex.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4Z"/></svg>
        </button>
        <button class="icon-btn" onclick="editRoutineExercise(${i})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        </button>
        <button class="icon-btn" onclick="moveRoutineEx(${i},-1)" ${i===0?'disabled':''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 15l-6-6-6 6"/></svg>
        </button>
        <button class="icon-btn" onclick="moveRoutineEx(${i},1)" ${i===r.exercises.length-1?'disabled':''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <button class="icon-btn" onclick="deleteRoutineEx(${i})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  // Wire rename buttons via event delegation (avoids quote-escaping issues in onclick)
  list.querySelectorAll('.rename-ex-btn').forEach(btn => {
    btn.addEventListener('click', () => openRenameExerciseModal(btn.dataset.exname, 'routine-edit'));
  });
}

function moveRoutineEx(i, dir) {
  const arr = state.editingRoutine.exercises;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  renderRoutineExercises();
}
function deleteRoutineEx(i) { state.editingRoutine.exercises.splice(i, 1); renderRoutineExercises(); }

function editRoutineExercise(i) {
  const ex = state.editingRoutine.exercises[i];
  const prevUnit = ex.unit || 'kg';
  openExerciseConfigModal(ex.name, ex.sets, ex.reps, ex.unit || 'kg', (sets, reps, unit) => {
    ex.sets = sets; ex.reps = reps; ex.unit = unit;
    if (unit !== prevUnit) {
      dbGet('exercises', ex.name).then(c => { if (c) { c.unit = unit; dbPut('exercises', c); } });
    }
    renderRoutineExercises();
  });
}

async function saveRoutine() {
  const name = document.getElementById('routineNameInput').value.trim();
  if (!name) { toast('Name required'); return; }
  if (state.editingRoutine.exercises.length === 0) { toast('Add at least one exercise'); return; }
  state.editingRoutine.name = name;
  state.editingRoutine.updatedAt = Date.now();
  await dbPut('routines', state.editingRoutine);
  toast('Saved');
  showView('home');
}

function deleteCurrentRoutine() {
  openModal(`
    <h3>Delete routine?</h3>
    <div class="modal-sub">Past workouts are unaffected.</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Keep</button>
      <button class="btn btn-danger" onclick="confirmDeleteRoutine()">Delete</button>
    </div>`);
}
async function confirmDeleteRoutine() {
  await dbDel('routines', state.editingRoutine.id);
  closeModal(); toast('Deleted'); showView('home');
}

// =============================================================
// EXERCISE PICKER — category list, no freeform typing required
// =============================================================
async function openExercisePicker(context) {
  // Load custom exercises not in the catalogue
  const allDb = await dbGetAll('exercises');
  const catalogueSet = new Set(ALL_EXERCISES_FLAT);
  const customs = allDb.filter(e => !catalogueSet.has(e.name)).sort((a,b) => a.name.localeCompare(b.name));

  const renderList = (filter = '') => {
    const f = filter.toLowerCase().trim();
    let html = '';

    // Custom "add new" option when typing something not in any list
    const allNames = [...ALL_EXERCISES_FLAT, ...customs.map(e => e.name)];
    if (f && !allNames.find(n => n.toLowerCase() === f)) {
      html += `<div class="exercise-list-item add-new" onclick='addCustomExercise(${jsString(filter)}, ${jsString(context)})'>+ Add "${escapeHtml(filter)}"</div>`;
    }

    if (customs.length > 0 && (!f || customs.some(e => e.name.toLowerCase().includes(f)))) {
      const filtered = customs.filter(e => !f || e.name.toLowerCase().includes(f));
      if (filtered.length) {
        html += `<div class="ex-category-header">My Exercises</div>`;
        html += filtered.map(e => exerciseListItem(e.name, e.unit || 'kg', context)).join('');
      }
    }

    for (const [cat, names] of Object.entries(EXERCISE_CATALOGUE)) {
      const filtered = names.filter(n => !f || n.toLowerCase().includes(f));
      if (!filtered.length) continue;
      html += `<div class="ex-category-header">${escapeHtml(cat)}</div>`;
      html += filtered.map(n => {
        const unit = allDb.find(e => e.name === n)?.unit || 'kg';
        return exerciseListItem(n, unit, context);
      }).join('');
    }

    if (!html) html = `<p class="text-faint center soft-empty">No matches.</p>`;
    document.getElementById('exerciseListEl').innerHTML = html;
  };

  openModal(`
    <h3>Pick Exercise</h3>
    <div class="modal-sub">Browse by category or search</div>
    <div class="exercise-picker-search">
      <input type="text" id="exPickerSearch" placeholder="Search…" autocomplete="off">
    </div>
    <div class="exercise-list" id="exerciseListEl"></div>`);

  document.getElementById('exPickerSearch').addEventListener('input', e => renderList(e.target.value));
  renderList();
  setTimeout(() => document.getElementById('exPickerSearch').focus(), 100);
}

function exerciseListItem(name, unit, context) {
  const tag = `<span class="unit-tag unit-tag-${unit}">${unit}</span>`;
  return `<div class="exercise-list-item" onclick='pickExercise(${jsString(name)}, ${jsString(context)})'>${escapeHtml(name)}${tag}</div>`;
}

async function addCustomExercise(name, context) {
  await dbPut('exercises', { name, builtin: false, unit: 'kg' });
  pickExercise(name, context);
}

async function pickExercise(name, context) {
  closeModal();
  const unit = await getExerciseUnit(name);
  if (context === 'routine') {
    openExerciseConfigModal(name, 3, 8, unit, (sets, reps, newUnit) => {
      if (newUnit !== unit) dbGet('exercises', name).then(ex => { if (ex) { ex.unit = newUnit; dbPut('exercises', ex); } });
      state.editingRoutine.exercises.push({ name, sets, reps, unit: newUnit });
      renderRoutineExercises();
    });
  } else {
    addExerciseToActiveWorkout(name, 3);
  }
}

// =============================================================
// EXERCISE CONFIG MODAL
// =============================================================
function openExerciseConfigModal(name, defaultSets, defaultReps, defaultUnit, onSave) {
  if (typeof defaultUnit === 'function') { onSave = defaultUnit; defaultUnit = 'kg'; }
  state._exConfigCallback = onSave;
  state._exConfigUnit = defaultUnit;
  openModal(`
    <h3>${escapeHtml(name)}</h3>
    <div class="modal-sub">Sets · Reps · Unit</div>
    <div class="form-row">
      <div><label>Sets</label><input type="number" id="cfgSets" value="${defaultSets}" min="1" max="20" inputmode="numeric"></div>
      <div><label>Reps</label><input type="number" id="cfgReps" value="${defaultReps}" min="1" max="100" inputmode="numeric"></div>
    </div>
    <div class="mt-2">
      <label>Track in</label>
      <div class="unit-toggle" id="unitToggle">
        <button type="button" class="unit-toggle-btn ${defaultUnit==='kg'?'active':''}" data-unit="kg" onclick="setCfgUnit('kg')">Kilograms</button>
        <button type="button" class="unit-toggle-btn ${defaultUnit==='plates'?'active':''}" data-unit="plates" onclick="setCfgUnit('plates')">Plate count</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmExerciseConfig()">Save</button>
    </div>`);
}
function setCfgUnit(unit) {
  state._exConfigUnit = unit;
  document.querySelectorAll('#unitToggle .unit-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.unit === unit));
}
function confirmExerciseConfig() {
  const sets = parseInt(document.getElementById('cfgSets').value) || 3;
  const reps = parseInt(document.getElementById('cfgReps').value) || 8;
  const unit = state._exConfigUnit || 'kg';
  if (state._exConfigCallback) state._exConfigCallback(sets, reps, unit);
  state._exConfigCallback = null;
  state._exConfigUnit = null;
  closeModal();
}

// =============================================================
// ACTIVE WORKOUT
// =============================================================
async function startWorkoutFromRoutine(routineId) {
  if (state.activeWorkout) {
    openModal(`
      <h3>Workout in progress</h3>
      <div class="modal-sub">Finish or cancel the current session first.</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">OK</button>
        <button class="btn btn-primary" onclick="closeModal();showView('workout')">View</button>
      </div>`);
    return;
  }
  const r = await dbGet('routines', routineId);
  state.activeWorkout = {
    id: uid(), routineId: r.id, name: r.name,
    startedAt: Date.now(), finishedAt: null,
    exercises: r.exercises.map(ex => ({
      name: ex.name, targetSets: ex.sets, targetReps: ex.reps, unit: ex.unit || 'kg',
      sets: Array.from({ length: ex.sets }, () => ({ weight: '', reps: '', done: false }))
    }))
  };
  await prefillFromLastSession();
  document.getElementById('activeWorkoutName').textContent = r.name;
  renderActiveWorkout();
  showView('workout');
  saveWorkoutDraft();
}

async function addExerciseToActiveWorkout(name, defaultSetCount = 3) {
  const last = await getLastSessionForExercise(name);
  const unit = await getExerciseUnit(name);
  const sets = Array.from({ length: defaultSetCount }, (_, i) => {
    const ls = last && last.sets[i];
    return { weight: ls ? ls.weight : '', reps: ls ? ls.reps : '', done: false };
  });
  state.activeWorkout.exercises.push({
    name, targetSets: defaultSetCount,
    targetReps: last ? (last.sets[0]?.reps || 8) : 8,
    unit, sets, lastSession: last
  });
  renderActiveWorkout();
  saveWorkoutDraft();
}

async function prefillFromLastSession() {
  for (const ex of state.activeWorkout.exercises) {
    const last = await getLastSessionForExercise(ex.name);
    ex.lastSession = last;
    if (last) {
      ex.sets.forEach((s, i) => {
        const ls = last.sets[i];
        if (ls && s.weight === '' && s.reps === '') { s.weight = ls.weight; s.reps = ls.reps; }
      });
    }
  }
}

async function getLastSessionForExercise(name) {
  const workouts = (await dbGetAll('workouts')).filter(w => w.finishedAt).sort((a,b) => b.finishedAt - a.finishedAt);
  for (const w of workouts) {
    const ex = w.exercises.find(e => e.name === name);
    if (ex) {
      const done = ex.sets.filter(s => s.done && s.weight !== '' && s.reps !== '');
      if (done.length > 0) return { date: w.finishedAt, sets: done };
    }
  }
  return null;
}



function updateSet(ei, si, field, val) {
  state.activeWorkout.exercises[ei].sets[si][field] = val;
  saveWorkoutDraft();
}
function toggleSetDone(ei, si) {
  const s = state.activeWorkout.exercises[ei].sets[si];
  if (!s.done && (s.weight === '' || s.reps === '')) { toast('Enter weight and reps'); return; }
  s.done = !s.done;
  renderActiveWorkout();
  saveWorkoutDraft();
  if (s.done && navigator.vibrate) navigator.vibrate(20);
  if (s.done) focusNextSet(ei, si);
}
function focusNextSet(ei, si) {
  setTimeout(() => {
    const nextWeight = document.querySelector(`[data-set-input="${ei}-${si + 1}-weight"]`);
    if (nextWeight) nextWeight.focus();
  }, 50);
}
function addSetToExercise(ei) {
  const ex = state.activeWorkout.exercises[ei];
  const last = ex.sets[ex.sets.length - 1];
  ex.sets.push({ weight: last ? last.weight : '', reps: last ? last.reps : '', done: false });
  renderActiveWorkout();
  saveWorkoutDraft();
  focusNextSet(ei, ex.sets.length - 2);
}
function copyPreviousSet(ei) {
  const ex = state.activeWorkout.exercises[ei];
  const targetIndex = ex.sets.findIndex(s => !s.done && s.weight === '' && s.reps === '');
  const si = targetIndex >= 0 ? targetIndex : ex.sets.findIndex(s => !s.done);
  if (si <= 0) { toast('No previous set'); return; }
  const prev = ex.sets[si - 1];
  ex.sets[si].weight = prev.weight;
  ex.sets[si].reps = prev.reps;
  renderActiveWorkout();
  saveWorkoutDraft();
  focusNextSet(ei, si - 1);
}
function removeActiveExercise(ei) {
  state.activeWorkout.exercises.splice(ei, 1);
  renderActiveWorkout();
  saveWorkoutDraft();
}

function continueActiveWorkout() {
  if (!state.activeWorkout) { toast('No active workout'); return; }
  document.getElementById('activeWorkoutName').textContent = workoutTitle(state.activeWorkout);
  renderActiveWorkout();
  showView('workout');
}

async function saveWorkoutDraft() {
  if (state.activeWorkout) await dbPut('meta', { key: 'activeWorkoutDraft', value: state.activeWorkout });
}
async function loadWorkoutDraft() {
  const draft = await dbGet('meta', 'activeWorkoutDraft');
  if (draft && draft.value && !draft.value.finishedAt) {
    state.activeWorkout = draft.value;
    document.getElementById('activeWorkoutName').textContent = state.activeWorkout.name;
    renderActiveWorkout();
    return true;
  }
  return false;
}
async function clearWorkoutDraft() { await dbDel('meta', 'activeWorkoutDraft'); }

async function finishWorkout() {
  const w = state.activeWorkout;
  const completedExercises = w.exercises
    .map(ex => ({
      ...ex,
      sets: ex.sets.filter(s => s.done && s.weight !== '' && s.reps !== ''),
    }))
    .filter(ex => ex.sets.length > 0);
  if (completedExercises.length === 0) {
    openModal(`
      <h3>No completed sets</h3>
      <div class="modal-sub">Mark at least one set as done before finishing.</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Back</button>
        <button class="btn btn-danger" onclick="closeModal();doCancelWorkout()">Cancel Workout</button>
      </div>`);
    return;
  }
  w.exercises = completedExercises;
  w.finishedAt = Date.now();
  w.duration   = w.finishedAt - w.startedAt;
  const prs = await detectPRs(w);
  await dbPut('workouts', w);
  await clearWorkoutDraft();
  state.activeWorkout = null;
  toast(prs.length > 0 ? `${prs.length} PR${prs.length > 1 ? 's' : ''} hit!` : 'Workout saved', prs.length ? 'pr' : '');
  showView('history');
}

async function detectPRs(workout) {
  const prev = (await dbGetAll('workouts')).filter(w => w.id !== workout.id && w.finishedAt);
  return workout.exercises.filter(ex => {
    const prevBest = Math.max(0, ...prev.flatMap(w =>
      (w.exercises.find(e => e.name === ex.name)?.sets || []).map(s => parseFloat(s.weight) || 0)));
    const thisBest = Math.max(...ex.sets.map(s => parseFloat(s.weight) || 0));
    return thisBest > prevBest && prevBest > 0;
  });
}

function cancelWorkout() {
  openModal(`
    <h3>Cancel workout?</h3>
    <div class="modal-sub">All data in this session will be lost.</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Keep going</button>
      <button class="btn btn-danger" onclick="closeModal();doCancelWorkout()">Cancel</button>
    </div>`);
}
async function doCancelWorkout() {
  state.activeWorkout = null;
  await clearWorkoutDraft();
  showView('home');
}

// =============================================================
// EXPORT / IMPORT / RESET
// =============================================================
async function exportData() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    routines:  await dbGetAll('routines'),
    workouts:  (await dbGetAll('workouts')).filter(w => w.finishedAt),
    exercises: await dbGetAll('exercises'),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `logbook-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async evt => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!data.version) throw new Error('Invalid file');
      state._pendingImport = data;
      openModal(`
        <h3>Import data?</h3>
        <div class="modal-sub">${data.routines?.length||0} routines · ${data.workouts?.length||0} workouts</div>
        <p class="text-dim mb-2 modal-copy">This will <strong>replace</strong> all current data.</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="doImport()">Replace All</button>
        </div>`);
    } catch { toast('Invalid file'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

async function doImport() {
  const data = state._pendingImport;
  if (!data) return;
  await dbClear('routines'); await dbClear('workouts'); await dbClear('exercises'); await dbClear('meta');
  for (const r of data.routines  || []) await dbPut('routines',  r);
  for (const w of data.workouts  || []) await dbPut('workouts',  w);
  for (const e of data.exercises || []) await dbPut('exercises', e);
  state.activeWorkout = null;
  state._pendingImport = null;
  closeModal(); toast('Imported'); showView('home');
}

function confirmReset() {
  openModal(`
    <h3>Erase everything?</h3>
    <div class="modal-sub">All routines, workouts, and records gone forever.</div>
    <p class="text-dim mb-2 modal-copy">Type <strong>ERASE</strong> to confirm:</p>
    <input type="text" id="eraseConfirm" autocomplete="off">
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="doReset()">Erase</button>
    </div>`);
}
async function doReset() {
  if (document.getElementById('eraseConfirm').value !== 'ERASE') { toast('Type ERASE exactly'); return; }
  await dbClear('routines'); await dbClear('workouts'); await dbClear('exercises'); await dbClear('meta');
  await seedExercises();
  closeModal(); toast('Reset complete'); showView('home');
}

// =============================================================
// SETTINGS / APP STATUS
// =============================================================
async function renderAppStatus() {
  const el = document.getElementById('appStatus');
  const versionEl = document.getElementById('versionInfo');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  let storage = '';
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      storage = `\nStorage · ${(est.usage/1024/1024).toFixed(2)} MB used`;
    } catch {}
  }
  if (el) el.textContent = `Mode · ${standalone ? 'Installed (PWA)' : 'Browser'}${storage}`;
  if (versionEl) versionEl.textContent = `Logbook · ${APP_VERSION}`;
}

// =============================================================
// PWA INSTALL
// =============================================================
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  state.deferredInstallPrompt = e;
  const dismissed = localStorage.getItem('installBannerDismissed');
  if (!dismissed || Date.now() - parseInt(dismissed) > 7 * 86400000) {
    document.getElementById('installBanner').classList.remove('hidden');
  }
});
async function triggerInstall() {
  if (!state.deferredInstallPrompt) { toast('Use browser menu: Add to Home Screen'); return; }
  state.deferredInstallPrompt.prompt();
  const { outcome } = await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  document.getElementById('installBanner').classList.add('hidden');
  if (outcome === 'accepted') toast('Installed!');
}
function dismissInstallBanner() {
  document.getElementById('installBanner').classList.add('hidden');
  localStorage.setItem('installBannerDismissed', Date.now());
}
window.addEventListener('appinstalled', () => {
  document.getElementById('installBanner').classList.add('hidden');
  toast('Logbook installed');
});

// =============================================================
// MODAL
// =============================================================
function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBackdrop').classList.add('show');
}
function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('show');
  state._exConfigCallback = null;
  state._exConfigUnit = null;
  state._pendingImport = null;
  state._editingWorkout = null;
}

// =============================================================
// UI ENHANCEMENTS
// =============================================================
async function renderHome() {
  const routines = await dbGetAll('routines');
  const workouts = await getCompletedWorkouts();

  const homeNote = document.getElementById('homeHeroNote');
  const routineCount = document.getElementById('routineCountLabel');
  const activeBanner = document.getElementById('activeWorkoutBanner');
  if (homeNote) {
    homeNote.textContent = state.activeWorkout
      ? `${workoutTitle(state.activeWorkout)} in progress`
      : workouts[0]
        ? `${workouts.length} workout${workouts.length === 1 ? '' : 's'} logged · Last ${fmtDate(workouts[0].finishedAt)}`
        : 'No workouts yet.';
  }
  if (routineCount) {
    routineCount.textContent = `${routines.length} saved`;
  }
  if (activeBanner) {
    activeBanner.innerHTML = state.activeWorkout ? `
      <div class="card active-session-card">
        <div class="card-kicker">In Progress</div>
        <div class="info">
          <h3>${escapeHtml(workoutTitle(state.activeWorkout))}</h3>
          <div class="meta">Started ${fmtDate(state.activeWorkout.startedAt)} | ${(state.activeWorkout.exercises || []).length} exercises</div>
        </div>
        <div class="inline-actions mt-2">
          <button class="btn btn-accent btn-sm" onclick="continueActiveWorkout()">Continue</button>
          <button class="btn btn-ghost btn-sm" onclick="cancelWorkout()">Cancel</button>
        </div>
      </div>` : '';
  }

  const list = document.getElementById('routinesList');
  if (routines.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No routines yet.</h3>
        <p>Create one routine to start logging workouts.</p>
      </div>`;
    return;
  }

  routines.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  list.innerHTML = routines.map(r => `
    <div class="card routine-card card-clickable" onclick="startWorkoutFromRoutine('${r.id}')">
      <div class="info">
        <h3>${escapeHtml(r.name)}</h3>
        <div class="meta">${r.exercises.length} exercise${r.exercises.length === 1 ? '' : 's'} | <a onclick="event.stopPropagation();openRoutineEditor('${r.id}')">edit</a></div>
      </div>
      <div class="arrow">></div>
    </div>
  `).join('');
}

async function renderHistory() {
  const workouts = await getCompletedWorkouts();
  const routines = await dbGetAll('routines');
  const summary = document.getElementById('historySummary');
  const list = document.getElementById('historyList');
  if (summary) {
    const setTotal = workouts.reduce((sum, w) => sum + getSetCount(w), 0);
    summary.textContent = workouts.length
      ? `${workouts.length} workout${workouts.length === 1 ? '' : 's'} | ${setTotal} completed sets`
      : 'Saved workouts appear here.';
  }
  if (!list) return;
  if (workouts.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No saved workouts.</h3>
        <p>Finish a workout and it will show up here.</p>
      </div>`;
    return;
  }

  const stats = `
    <div class="stats-grid">
      <div class="stat-box">
        <div class="value">${workouts.length}</div>
        <div class="label">Workouts</div>
      </div>
      <div class="stat-box">
        <div class="value">${getWorkoutStreak(workouts)}</div>
        <div class="label">Streak</div>
      </div>
      <div class="stat-box">
        <div class="value">${getUniqueExerciseCount(routines, workouts)}</div>
        <div class="label">Exercises</div>
      </div>
    </div>`;

  list.innerHTML = stats + workouts.map(w => `
    <div class="card history-card card-clickable" onclick="openWorkoutDetail(${jsString(w.id)})">
      <div class="info">
        <div class="card-kicker">${fmtDate(w.finishedAt)}</div>
        <h3>${escapeHtml(workoutTitle(w))}</h3>
        <div class="meta">${workoutMeta(w)}</div>
      </div>
      <div class="arrow">></div>
    </div>
  `).join('');
}

async function renderProgress() {
  const workouts = await getCompletedWorkouts();
  const progress = collectExerciseProgress(workouts);
  const summary = document.getElementById('progressSummary');
  const list = document.getElementById('progressList');
  if (summary) {
    summary.textContent = progress.length
      ? `${progress.length} exercise${progress.length === 1 ? '' : 's'} tracked from saved workouts`
      : 'Track your strongest lifts over time.';
  }
  if (!list) return;
  if (progress.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No progress yet.</h3>
        <p>Complete sets in a workout to build exercise history.</p>
      </div>`;
    return;
  }

  list.innerHTML = progress.map(item => `
    <div class="card progress-card card-clickable" onclick="openExerciseProgress(${jsString(item.name)})">
      <div class="info">
        <h3>${escapeHtml(item.name)}</h3>
        <div class="meta">${item.sessions.length} session${item.sessions.length === 1 ? '' : 's'} | Best ${escapeHtml(setLabel(item.bestSet, item.unit))}</div>
      </div>
      <div class="arrow">></div>
    </div>
  `).join('');
}

function collectExerciseProgress(workouts) {
  const map = new Map();
  for (const w of workouts) {
    for (const ex of w.exercises || []) {
      const sets = (ex.sets || []).filter(s => s.weight !== '' && s.reps !== '');
      if (sets.length === 0) continue;
      if (!map.has(ex.name)) {
        map.set(ex.name, { name: ex.name, unit: ex.unit || 'kg', sessions: [], bestSet: null });
      }
      const item = map.get(ex.name);
      const bestSet = getBestSet({ sets });
      item.sessions.push({ workout: w, exercise: ex, bestSet });
      if (isBetterSet(bestSet, item.bestSet)) {
        item.bestSet = bestSet;
        item.unit = ex.unit || item.unit;
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function openWorkoutDetail(id) {
  const workout = await dbGet('workouts', id);
  if (!workout) { toast('Workout not found'); renderHistory(); return; }
  const detailRows = (workout.exercises || []).map(ex => {
    const unit = ex.unit || 'kg';
    return `
      <div class="detail-row">
        <div class="detail-row-title">${escapeHtml(ex.name)}<span class="unit-tag unit-tag-${unit}">${unit}</span></div>
        <div class="set-chip-list">
          ${(ex.sets || []).map((set, i) => `<span class="set-chip">${i + 1}. ${escapeHtml(setLabel(set, unit))}</span>`).join('')}
        </div>
      </div>`;
  }).join('');

  openModal(`
    <h3>${escapeHtml(workoutTitle(workout))}</h3>
    <div class="modal-sub">${fmtDate(workout.finishedAt)} · ${workoutMeta(workout)}</div>
    <div class="detail-stack">${detailRows || '<p class="text-faint center">No completed sets.</p>'}</div>
    <div class="modal-actions">
      <button class="btn btn-danger" onclick="confirmDeleteWorkout(${jsString(workout.id)})">Delete</button>
      <button class="btn btn-primary" onclick="openEditWorkout(${jsString(workout.id)})">Edit</button>
    </div>`);
}

async function openExerciseProgress(name) {
  const workouts = await getCompletedWorkouts();
  const item = collectExerciseProgress(workouts).find(ex => ex.name === name);
  if (!item) { toast('No history'); renderProgress(); return; }
  const rows = item.sessions.map(session => {
    const unit = session.exercise.unit || item.unit || 'kg';
    return `
      <div class="detail-row">
        <div class="detail-row-title">${fmtDate(session.workout.finishedAt)}</div>
        <div class="meta mb-2">${escapeHtml(workoutTitle(session.workout))} | Best ${escapeHtml(setLabel(session.bestSet, unit))}</div>
        <div class="set-chip-list">
          ${(session.exercise.sets || []).map((set, i) => `<span class="set-chip">${i + 1}. ${escapeHtml(setLabel(set, unit))}</span>`).join('')}
        </div>
      </div>`;
  }).join('');

  openModal(`
    <h3>${escapeHtml(item.name)}</h3>
    <div class="modal-sub">${item.sessions.length} sessions · Best ${escapeHtml(setLabel(item.bestSet, item.unit))}</div>
    <div class="detail-stack">${rows}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" onclick="closeModal();showView('history')">History</button>
    </div>`);
}

function confirmDeleteWorkout(id) {
  openModal(`
    <h3>Delete workout?</h3>
    <div class="modal-sub">This saved session will be removed permanently.</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Keep</button>
      <button class="btn btn-danger" onclick="deleteWorkout(${jsString(id)})">Delete</button>
    </div>`);
}

async function deleteWorkout(id) {
  await dbDel('workouts', id);
  closeModal();
  toast('Workout deleted');
  renderHistory();
  if (state.currentView === 'progress') renderProgress();
}

async function openEditWorkout(id) {
  const workout = await dbGet('workouts', id);
  if (!workout) { toast('Workout not found'); renderHistory(); return; }
  state._editingWorkout = JSON.parse(JSON.stringify(workout));
  renderWorkoutEditor();
}

function renderWorkoutEditor() {
  const w = state._editingWorkout;
  if (!w) return;
  const rows = (w.exercises || []).map((ex, ei) => {
    const unit = ex.unit || 'kg';
    return `
      <div class="detail-row">
        <div class="detail-row-title">${escapeHtml(ex.name)}<span class="unit-tag unit-tag-${unit}">${unit}</span></div>
        <div class="detail-stack">
          ${(ex.sets || []).map((set, si) => `
            <div class="edit-set-row">
              <div>
                <label>${unit === 'plates' ? 'Plates' : 'Weight'}</label>
                <input type="number" inputmode="${unit === 'plates' ? 'numeric' : 'decimal'}" step="${unit === 'plates' ? '1' : '0.5'}" id="edit-w-${ei}-${si}" value="${escapeHtml(set.weight)}">
              </div>
              <div>
                <label>Reps</label>
                <input type="number" inputmode="numeric" id="edit-r-${ei}-${si}" value="${escapeHtml(set.reps)}">
              </div>
              <button class="icon-btn" title="Remove set" onclick="removeEditSet(${ei},${si})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');

  openModal(`
    <h3>Edit Workout</h3>
    <div class="modal-sub">${fmtDate(w.finishedAt)} · Edit saved sets</div>
    <div class="form-grid mb-2">
      <div>
        <label>Workout Name</label>
        <input type="text" id="editWorkoutName" value="${escapeHtml(workoutTitle(w))}">
      </div>
    </div>
    <div class="detail-stack">${rows || '<p class="text-faint center">No sets to edit.</p>'}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="openWorkoutDetail(${jsString(w.id)})">Cancel</button>
      <button class="btn btn-primary" onclick="saveEditedWorkout()">Save</button>
    </div>`);
}

function captureEditWorkoutInputs() {
  const w = state._editingWorkout;
  if (!w) return;
  w.name = document.getElementById('editWorkoutName')?.value.trim() || workoutTitle(w);
  (w.exercises || []).forEach((ex, ei) => {
    (ex.sets || []).forEach((set, si) => {
      const weight = document.getElementById(`edit-w-${ei}-${si}`)?.value ?? set.weight;
      const reps = document.getElementById(`edit-r-${ei}-${si}`)?.value ?? set.reps;
      set.weight = weight;
      set.reps = reps;
      set.done = weight !== '' && reps !== '';
    });
  });
}

function removeEditSet(ei, si) {
  captureEditWorkoutInputs();
  const w = state._editingWorkout;
  if (!w || !w.exercises[ei]) return;
  w.exercises[ei].sets.splice(si, 1);
  w.exercises = w.exercises.filter(ex => (ex.sets || []).length > 0);
  renderWorkoutEditor();
}

async function saveEditedWorkout() {
  captureEditWorkoutInputs();
  const w = state._editingWorkout;
  if (!w) return;
  w.exercises = (w.exercises || [])
    .map(ex => ({ ...ex, sets: (ex.sets || []).filter(set => set.weight !== '' && set.reps !== '') }))
    .filter(ex => ex.sets.length > 0);
  if (w.exercises.length === 0) { toast('Add at least one set'); return; }
  w.updatedAt = Date.now();
  await dbPut('workouts', w);
  state._editingWorkout = null;
  closeModal();
  toast('Workout updated');
  renderHistory();
  if (state.currentView === 'progress') renderProgress();
}

function renderActiveWorkout() {
  const w = state.activeWorkout;
  const c = document.getElementById('activeExercises');
  if (!w || w.exercises.length === 0) {
    c.innerHTML = `<p class="text-faint center soft-empty">No exercises. Add one below.</p>`;
    return;
  }

  c.innerHTML = w.exercises.map((ex, ei) => {
    const unit = ex.unit || 'kg';
    const colHeader = unit === 'plates' ? 'PLATES' : 'KG';
    const step = unit === 'plates' ? '1' : '0.5';
    const imode = unit === 'plates' ? 'numeric' : 'decimal';
    const lastTxt = ex.lastSession
      ? ex.lastSession.sets.map(s => `${s.weight}x${s.reps}`).join(' | ') + ` | ${fmtDate(ex.lastSession.date)}`
      : 'No previous data';

    return `
    <div class="exercise-block">
      <div class="exercise-block-head">
        <div>
          <h3>${escapeHtml(ex.name)}<span class="unit-tag unit-tag-${unit}">${unit}</span></h3>
          <div class="target">Target | ${ex.targetSets} x ${ex.targetReps}</div>
        </div>
        <button class="icon-btn" onclick="removeActiveExercise(${ei})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="last-session">${lastTxt}</div>
      <div class="sets-table">
        <div class="row head"><div>SET</div><div>${colHeader}</div><div>REPS</div><div></div></div>
        ${ex.sets.map((s, si) => `
          <div class="row ${s.done ? 'done' : ''}">
            <div class="set-num">${si + 1}</div>
            <input type="number" inputmode="${imode}" step="${step}" value="${s.weight}"
              data-set-input="${ei}-${si}-weight"
              oninput="updateSet(${ei},${si},'weight',this.value)"
              placeholder="${ex.lastSession?.sets[si]?.weight ?? '-'}">
            <input type="number" inputmode="numeric" value="${s.reps}"
              data-set-input="${ei}-${si}-reps"
              oninput="updateSet(${ei},${si},'reps',this.value)"
              placeholder="${ex.lastSession?.sets[si]?.reps ?? ex.targetReps}">
            <button class="check-btn ${s.done ? 'done' : ''}" onclick="toggleSetDone(${ei},${si})">
              ${s.done ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 12l5 5L20 7"/></svg>' : ''}
            </button>
          </div>`).join('')}
      </div>
      <div class="add-set-row">
        <button class="add-set-btn" onclick="addSetToExercise(${ei})">Add Set</button>
        <button class="copy-set-btn" onclick="copyPreviousSet(${ei})">Copy Previous</button>
      </div>
    </div>`;
  }).join('');
}


// =============================================================
// EXERCISE RENAME — rename with history migration
// =============================================================
function openRenameExerciseModal(oldName, context) {
  // context: 'routine' (index i) or 'catalogue'
  openModal(`
    <h3>Rename Exercise</h3>
    <div class="modal-sub">Old name · ${escapeHtml(oldName)}</div>
    <div class="form-grid mb-2">
      <div>
        <label>New Name</label>
        <input type="text" id="renameInput" value="${escapeHtml(oldName)}" autocomplete="off">
      </div>
    </div>
    <p class="text-dim mb-2 modal-copy modal-copy-sm">All past workout history will be updated to the new name.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmRenameExercise(${jsString(oldName)}, ${jsString(context)})">Rename</button>
    </div>`);
  setTimeout(() => {
    const inp = document.getElementById('renameInput');
    if (inp) { inp.focus(); inp.select(); }
  }, 80);
}

async function confirmRenameExercise(oldName, context) {
  const newName = document.getElementById('renameInput')?.value.trim();
  if (!newName) { toast('Name required'); return; }
  if (newName === oldName) { closeModal(); return; }

  // 1. Update the exercises catalogue record
  const exRec = await dbGet('exercises', oldName);
  if (exRec) {
    await dbDel('exercises', oldName);
    await dbPut('exercises', { ...exRec, name: newName });
  } else {
    await dbPut('exercises', { name: newName, builtin: false, unit: 'kg' });
  }

  // 2. Migrate all workout history — walk every workout, rename matching exercises
  const allWorkouts = await dbGetAll('workouts');
  for (const w of allWorkouts) {
    let changed = false;
    for (const ex of w.exercises) {
      if (ex.name === oldName) { ex.name = newName; changed = true; }
    }
    if (changed) await dbPut('workouts', w);
  }

  // 3. Update all routines that reference the old name
  const allRoutines = await dbGetAll('routines');
  for (const r of allRoutines) {
    let changed = false;
    for (const ex of r.exercises) {
      if (ex.name === oldName) { ex.name = newName; changed = true; }
    }
    if (changed) await dbPut('routines', r);
  }

  // 4. If we're currently in routine editor, refresh in-memory state too
  if (state.editingRoutine) {
    for (const ex of state.editingRoutine.exercises) {
      if (ex.name === oldName) ex.name = newName;
    }
  }

  closeModal();
  toast(`Renamed to "${newName}"`);

  // Refresh whatever view triggered the rename
  if (context === 'routine-edit') renderRoutineExercises();
  if (state.currentView === 'home') renderHome();
  if (state.currentView === 'history') renderHistory();
  if (state.currentView === 'progress') renderProgress();
}

// =============================================================
// SERVICE WORKER - caches the app shell for offline use
// =============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(registration => registration.update())
      .catch(error => console.error('[Logbook] Service worker registration failed:', error));
  });
}

// Request persistent storage
(async () => {
  if (navigator.storage?.persist) {
    try { const p = await navigator.storage.persisted(); if (!p) await navigator.storage.persist(); } catch {}
  }
})();

// =============================================================
// BOOT
// =============================================================
(async function boot() {
  await openDB();
  await seedExercises();

  const today = new Date();
  document.getElementById('dateStamp').textContent =
    today.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
  document.getElementById('versionInfo').textContent = `Logbook - ${APP_VERSION}`;

  const resumed = await loadWorkoutDraft();
  if (resumed) { showView('workout'); toast('Resumed workout'); }
  else showView('home');
})();
