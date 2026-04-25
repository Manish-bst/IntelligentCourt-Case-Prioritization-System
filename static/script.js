let currentUser = null;
let token = localStorage.getItem('token');
const CASE_TYPE_OPTIONS = [
  { value: 'criminal', label: 'Criminal', score: 30 },
  { value: 'cyber', label: 'Cyber', score: 28 },
  { value: 'constitutional', label: 'Constitutional', score: 26 },
  { value: 'commercial', label: 'Commercial', score: 24 },
  { value: 'family', label: 'Family', score: 20 },
  { value: 'labour', label: 'Labour', score: 18 },
  { value: 'property', label: 'Property', score: 17 },
  { value: 'civil', label: 'Civil', score: 15 },
];

async function apiCall(endpoint, options = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!options.isFormData) headers['Content-Type'] = 'application/json';

  const config = { ...options, headers: { ...headers, ...options.headers } };
  delete config.isFormData;

  try {
    const res = await fetch(endpoint, config);
    const data = await res.json().catch(() => ({}));
    if (
      res.status === 401 &&
      endpoint !== '/login' &&
      endpoint !== '/signup'
    ) {
      showAlert('Session expired. Please log in again.', 'error');
      logout();
      return null;
    }
    if (data.error) showAlert(data.error, 'error');
    return data;
  } catch (err) {
    showAlert(`Network error: ${err.message}`, 'error');
    return null;
  }
}

function showAlert(msg, type = 'success') {
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = msg;
  document.querySelector('.container').prepend(alert);
  setTimeout(() => alert.remove(), 5000);
}

// Auto-capitalize first letter of each word in name/title/note fields
function autoCapitalize(str) {
  return str.replace(/(^|\s)\S/g, (ch) => ch.toUpperCase());
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
  if (!el.dataset.autocap) return;
  const pos = el.selectionStart;
  el.value = autoCapitalize(el.value);
  el.setSelectionRange(pos, pos);
});

function showAuthTab(which) {
  document.getElementById('tab-signup').classList.toggle('active', which === 'signup');
  document.getElementById('tab-login').classList.toggle('active', which === 'login');
  document.getElementById('panel-signup').classList.toggle('hidden', which !== 'signup');
  document.getElementById('panel-login').classList.toggle('hidden', which !== 'login');
}

function saveUser(user, newtoken) {
  currentUser = user;
  token = newtoken;
  localStorage.setItem('token', token);
}

function loadRoleDashboard() {
  const role = currentUser && currentUser.role;
  if (!role) return;
  document.getElementById('auth-section').classList.add('hidden');
  document.getElementById('logout-btn').classList.remove('hidden');
  document.getElementById('dashboard').classList.remove('hidden');

  if (role === 'admin') loadAdminDashboard();
  else if (role === 'judge') loadJudgeDashboard();
  else loadUserDashboard();
}

document.addEventListener('DOMContentLoaded', () => {
  if (!token) return;
  apiCall('/me').then((data) => {
    if (data && data.id) {
      currentUser = data;
      loadRoleDashboard();
    }
  });
});

async function signup() {
  const username = document.getElementById('signup-username').value.trim();
  const password = document.getElementById('signup-password').value;
  const role = document.getElementById('signup-role').value;
  const data = await apiCall('/signup', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  });
  if (data && data.user) {
    saveUser(data.user, data.token);
    showAlert('Account created. Logged in successfully.');
    currentUser = data.user;
    loadRoleDashboard();
  }
}

async function login() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const role = document.getElementById('login-role').value;
  const data = await apiCall('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  });
  if (data && data.user) {
    saveUser(data.user, data.token);
    currentUser = data.user;
    loadRoleDashboard();
  }
}

function logout() {
  localStorage.clear();
  token = null;
  currentUser = null;
  location.reload();
}

function escapeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function priorityCell(c) {
  const color = c.priority_color || 'GREEN';
  const score = c.priority_score != null ? c.priority_score : '—';
  const df = c.deadline_factor != null ? c.deadline_factor : 0;
  const title = `Score = (${c.days_old ?? 0}d × 1.5) + type ${c.type_score ?? '—'} + urgency ${c.urgency_factor ?? '—'} + deadline ${df}`;
  return `
    <span class="pri-badge pri-${color}" title="${escapeHtml(title)}">${escapeHtml(color)}</span>
    <div class="pri-score">${escapeHtml(String(score))}</div>
    <small class="muted">d=${c.days_old ?? 0} · u=${c.urgency_factor ?? '—'} · dl=${df}</small>`;
}

async function loadAdminDashboard() {
  document.getElementById('dashboard-title').innerHTML = '⚖️ Admin Registry &amp; Analytics';

  // Fetch stats first to show in welcome banner
  const statsData = await apiCall('/stats');
  const total = statsData ? statsData.total : 0;
  const open = statsData ? statsData.open : 0;
  const solved = statsData ? statsData.solved : 0;
  const pending = statsData ? statsData.pending_closure : 0;
  const priColors = statsData ? (statsData.by_priority_color || {}) : {};

  document.getElementById('dashboard-content').innerHTML = `
    <div class="welcome-banner fade-in-up">
      <h2>Welcome back, ${escapeHtml(currentUser.username || 'Admin')} 👋</h2>
      <p class="welcome-sub">Here's an overview of your court case management system.</p>
    </div>

    <div class="priority-summary fade-in-up delay-1" id="priority-summary">
      <div class="summary-card sc-total"><div class="sc-value">${total}</div><div class="sc-label">Total Cases</div></div>
      <div class="summary-card sc-urgent"><div class="sc-value" id="sc-urgent">0</div><div class="sc-label">🔴 Urgent (RED)</div></div>
      <div class="summary-card sc-medium"><div class="sc-value" id="sc-medium">0</div><div class="sc-label">🟡 Medium (YELLOW)</div></div>
      <div class="summary-card sc-normal"><div class="sc-value" id="sc-normal">0</div><div class="sc-label">🟢 Normal (GREEN)</div></div>
    </div>

    <div class="grid-2 fade-in-up delay-1">
      <div class="card block">
        <div class="section-header">
          <span class="section-icon">📝</span>
          <div><h3>Register New Case</h3><p class="section-desc">File a new court matter. A case number is auto-generated.</p></div>
        </div>
        <label class="label-inline">Case Title</label>
        <input id="case-title" data-autocap="1" placeholder="e.g. State vs. John Doe" />
        <label class="label-inline">Plaintiff (Person Filing)</label>
        <input id="case-plaintiff" data-autocap="1" placeholder="Full name of the filer" />
        <label class="label-inline">Defendant (Against)</label>
        <input id="case-defendant" data-autocap="1" placeholder="Full name of the respondent" />
        <label class="label-inline">Case Type</label>
        <select id="case-type">
          ${CASE_TYPE_OPTIONS.map((t) => `<option value="${t.value}" ${t.value === 'civil' ? 'selected' : ''}>${t.label} — Weight: ${t.score}</option>`).join('')}
        </select>
        <label class="label-inline">Statutory Deadline (optional)</label>
        <input id="case-deadline" type="date" />
        <label class="label-inline">Citizen User ID</label>
        <input id="case-userid" placeholder="The citizen's portal user ID" />
        <button type="button" onclick="addCase()">📋 File Case</button>
      </div>
      <div class="card block">
        <div class="section-header">
          <span class="section-icon">👨‍⚖️</span>
          <div><h3>Create Judge Account</h3><p class="section-desc">Add a new judge to the system for case assignment.</p></div>
        </div>
        <label class="label-inline">Judge Username</label>
        <input id="judge-username" type="text" placeholder="e.g. justice_sharma" />
        <label class="label-inline">Temporary Password</label>
        <input id="judge-password" type="password" placeholder="Initial password" />
        <button type="button" class="btn-secondary" onclick="createJudge()">➕ Add Judge</button>
      </div>
    </div>

    <div class="card block fade-in-up delay-2">
      <div class="section-header">
        <span class="section-icon">👥</span>
        <div><h3>Registered Users</h3><p class="section-desc">All citizens, judges, and staff on the platform.</p></div>
      </div>
      <div id="users-list" class="table-wrap"></div>
    </div>

    <div class="charts-grid fade-in-up delay-2">
      <div class="chart-box"><div class="chart-box-header"><h4 class="chart-title">📊 Case Status</h4></div><div class="chart-box-body"><canvas id="stats-chart"></canvas></div></div>
      <div class="chart-box"><div class="chart-box-header"><h4 class="chart-title">📈 Case Volume</h4></div><div class="chart-box-body"><canvas id="bar-chart"></canvas></div></div>
      <div class="chart-box"><div class="chart-box-header"><h4 class="chart-title">📁 Distribution by Type</h4></div><div class="chart-box-body"><canvas id="chart-types"></canvas></div></div>
      <div class="chart-box"><div class="chart-box-header"><h4 class="chart-title">⚖️ Judge Workload</h4></div><div class="chart-box-body"><canvas id="chart-judges"></canvas></div></div>
    </div>

    <div class="card block fade-in-up delay-3" id="resolution-card">
      <p class="muted small" id="resolution-stat"></p>
    </div>

    <div class="fade-in-up delay-3">
      <div class="section-header" style="margin-bottom:20px">
        <span class="section-icon">📋</span>
        <div><h3>All Cases — Sorted by Priority</h3><p class="section-desc"><span class="pri-legend pri-RED">RED</span> ≥ 75 · <span class="pri-legend pri-YELLOW">YELLOW</span> 40–74 · <span class="pri-legend pri-GREEN">GREEN</span> &lt; 40</p></div>
      </div>
      <div id="admin-cases"></div>
    </div>

    <div class="info-box fade-in-up delay-4">
      <strong>ℹ️ How Priority Works:</strong> Each case gets a score = (Days Old × 1.5) + Type Weight + Urgency (0–20) + Deadline Factor (0–25). Higher scores = more urgent. You can adjust urgency manually in the table above.
    </div>
  `;
  await refreshAdminUsers();
  await loadCasesAdmin();
}

async function refreshAdminUsers() {
  const users = await apiCall('/users');
  if (!Array.isArray(users)) return;
  const el = document.getElementById('users-list');
  el.innerHTML = `
    <table class="table">
      <thead><tr><th>User ID</th><th>Username</th><th>Role</th></tr></thead>
      <tbody>
        ${users.map((u) => `
          <tr>
            <td><code>${escapeHtml(u.id)}</code></td>
            <td>${escapeHtml(u.username || '—')}</td>
            <td>${escapeHtml(u.role || '—')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function createJudge() {
  const username = document.getElementById('judge-username').value.trim();
  const password = document.getElementById('judge-password').value;
  const data = await apiCall('/admin/judges', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (data && data.user) {
    showAlert('Judge account created.');
    document.getElementById('judge-username').value = '';
    document.getElementById('judge-password').value = '';
    refreshAdminUsers();
  }
}

async function addCase() {
  const title = document.getElementById('case-title').value.trim();
  const plaintiff = document.getElementById('case-plaintiff').value.trim();
  const defendant = document.getElementById('case-defendant').value.trim();
  const user_id = document.getElementById('case-userid').value.trim();
  const case_type = document.getElementById('case-type').value;
  const dl = document.getElementById('case-deadline').value;
  const statutory_deadline = dl ? `${dl}T23:59:59+00:00` : null;
  if (!user_id || !plaintiff || !defendant) {
    showAlert('Enter citizen user ID, filer name, and respondent name.', 'error');
    return;
  }
  const data = await apiCall('/cases', {
    method: 'POST',
    body: JSON.stringify({
      title,
      plaintiff,
      defendant,
      user_id,
      case_type,
      statutory_deadline,
    }),
  });
  if (data && data.case) {
    showAlert(`Matter filed. Case Number: ${data.case.case_number || data.case.id} (internal ID ${data.case.id})`);
    loadCasesAdmin();
  }
}

async function loadCasesAdmin() {
  const cases = await apiCall('/cases');
  const users = await apiCall('/users');
  const judges = Array.isArray(users) ? users.filter((u) => u.role === 'judge') : [];

  const el = document.getElementById('admin-cases');
  if (!el) return;

  const sorted = Array.isArray(cases) ? [...cases] : [];
  sorted.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));

  if (sorted.length === 0) {
    el.innerHTML = `<div class="empty-state"><span class="empty-icon">📂</span><p>No cases filed yet. Register a new case above to get started.</p></div>`;
    updateCharts();
    return;
  }

  el.innerHTML = `<div class="case-cards-list">${sorted.map((c) => {
    const opts = judges.map(
      (j) => `<option value="${j.id}" ${c.judge_id === j.id ? 'selected' : ''}>${escapeHtml(j.username || 'judge')}</option>`,
    ).join('');
    const caseTypeOptions = CASE_TYPE_OPTIONS.map(
      (t) => `<option value="${t.value}" ${c.case_type === t.value ? 'selected' : ''}>${t.label}</option>`,
    ).join('');
    const caseNo = c.case_number || '—';
    const dl = c.statutory_deadline ? String(c.statutory_deadline).slice(0, 10) : '—';
    const color = c.priority_color || 'GREEN';
    const score = c.priority_score != null ? c.priority_score : '—';
    const pdfIcon = c.pdf_path ? '📄' : '—';
    const created = c.created_at ? String(c.created_at).slice(0, 10) : '—';
    return `
    <div class="case-card">
      <div class="case-card-top">
        <div class="case-card-pri pri-bg-${color}">
          ${score}
          <small>${color}</small>
        </div>
        <div class="case-card-info">
          <h4>${escapeHtml(c.title || 'Untitled')} — ${escapeHtml(caseNo)}</h4>
          <div class="case-card-meta">
            <code>${escapeHtml(c.id)}</code>
            <span>·</span>
            <span>${escapeHtml(c.plaintiff || '—')} <em>v.</em> ${escapeHtml(c.defendant || '—')}</span>
          </div>
        </div>
        <div class="case-card-badges">
          <span class="badge status-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span>
          <span class="badge stage-badge">${escapeHtml(c.workflow_stage || 'intake')}</span>
        </div>
      </div>
      <div class="case-card-body">
        <div class="case-card-field">
          <span class="case-card-field-label">Case Type</span>
          <select class="select-inline" onchange="setCaseType('${c.id}', this.value)" style="margin:0">${caseTypeOptions}</select>
        </div>
        <div class="case-card-field">
          <span class="case-card-field-label">Statutory Deadline</span>
          <span class="case-card-field-value">${escapeHtml(dl)}</span>
        </div>
        <div class="case-card-field">
          <span class="case-card-field-label">Filed</span>
          <span class="case-card-field-value">${escapeHtml(created)}</span>
        </div>
        <div class="case-card-field">
          <span class="case-card-field-label">Urgency (0–20)</span>
          <input type="number" min="0" max="20" class="input-tiny" value="${c.urgency_factor != null ? c.urgency_factor : ''}" onchange="setUrgency('${c.id}', this.value)" style="margin:0" />
        </div>
        <div class="case-card-field">
          <span class="case-card-field-label">Citizen ID</span>
          <code>${escapeHtml(c.user_id || '—')}</code>
        </div>
        <div class="case-card-field">
          <span class="case-card-field-label">Assigned Judge</span>
          <div style="display:flex;gap:6px;align-items:center">
            <select id="judge-sel-${c.id}" class="select-inline" style="margin:0;min-width:120px">${opts || '<option value="">Unassigned</option>'}</select>
            <button type="button" class="btn-small" onclick="assignJudgeSelect('${c.id}')" style="margin:0">Assign</button>
          </div>
        </div>
        <div class="case-card-field">
          <span class="case-card-field-label">Document ${pdfIcon}</span>
          <div class="pdf-upload-zone">
            <span class="upload-icon">📎</span>
            <input type="file" id="pdf-${c.id}" accept=".pdf" />
            <button type="button" class="btn-small" onclick="uploadPDF('${c.id}')" style="margin:0">Upload</button>
          </div>
        </div>
      </div>
      <div class="case-card-actions">
        <button type="button" class="btn-danger btn-small" onclick="deleteCase('${c.id}')">🗑️ Delete</button>
        ${c.status === 'pending_closure'
          ? `<button type="button" class="btn-small" onclick="adminCloseCase('${c.id}')">✅ Approve Closure</button>`
          : ''}
        ${c.closure_request_note ? `<span class="muted" style="font-size:0.8rem;margin-left:auto">📝 ${escapeHtml(c.closure_request_note.slice(0, 60))}</span>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;

  // Update priority summary cards
  const redCount = sorted.filter(c => (c.priority_color || 'GREEN') === 'RED').length;
  const yellowCount = sorted.filter(c => (c.priority_color || 'GREEN') === 'YELLOW').length;
  const greenCount = sorted.filter(c => (c.priority_color || 'GREEN') === 'GREEN').length;
  const scU = document.getElementById('sc-urgent'); if (scU) scU.textContent = redCount;
  const scM = document.getElementById('sc-medium'); if (scM) scM.textContent = yellowCount;
  const scN = document.getElementById('sc-normal'); if (scN) scN.textContent = greenCount;

  updateCharts();
}

function setCaseType(caseId, case_type) {
  apiCall(`/cases/${caseId}`, {
    method: 'PUT',
    body: JSON.stringify({ case_type }),
  }).then((d) => {
    if (d) {
      showAlert('Case type updated; priority recalculated.');
      loadCasesAdmin();
    }
  });
}

function setUrgency(caseId, value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return;
  apiCall(`/cases/${caseId}`, {
    method: 'PUT',
    body: JSON.stringify({ urgency_factor: n }),
  }).then((d) => {
    if (d) {
      showAlert('Urgency factor updated.');
      loadCasesAdmin();
    }
  });
}

function assignJudgeSelect(caseId) {
  const sel = document.getElementById(`judge-sel-${caseId}`);
  const judge_id = sel ? sel.value : '';
  apiCall(`/cases/${caseId}`, {
    method: 'PUT',
    body: JSON.stringify({ judge_id: judge_id || null }),
  }).then((d) => {
    if (d) showAlert('Judge assigned.');
    loadCasesAdmin();
  });
}

function uploadPDF(caseId) {
  const fileInput = document.getElementById(`pdf-${caseId}`);
  if (!fileInput || !fileInput.files.length) {
    showAlert('Choose a PDF first.', 'error');
    return;
  }
  const formData = new FormData();
  formData.append('pdf', fileInput.files[0]);
  formData.append('case_id', caseId);
  apiCall('/upload_pdf', { method: 'POST', body: formData, isFormData: true }).then((d) => {
    if (d) {
      showAlert('PDF uploaded.');
      if (typeof loadCasesAdmin === 'function') loadCasesAdmin();
    }
  });
}

function deleteCase(caseId) {
  if (!confirm('Delete this case and remove its file reference?')) return;
  apiCall(`/cases/${caseId}`, { method: 'DELETE' }).then((d) => {
    if (d) loadCasesAdmin();
  });
}

function adminCloseCase(caseId) {
  apiCall(`/cases/${caseId}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'closed' }),
  }).then((d) => {
    if (d) {
      showAlert('Case closed with judge verdict.');
      loadCasesAdmin();
    }
  });
}

function updateCharts() {
  apiCall('/stats').then((stats) => {
    if (!stats || stats.error) return;
    const resEl = document.getElementById('resolution-stat');
    if (resEl) {
      resEl.textContent = stats.avg_resolution_days != null
        ? `⏱️ Average time from filing to disposition: ${stats.avg_resolution_days} days.`
        : '⏱️ Average disposition time will appear once matters are closed.';
    }

    const chartFont = { family: "'Inter', sans-serif", size: 12 };
    const defaultOpts = {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 800, easing: 'easeOutQuart' },
      plugins: {
        legend: { position: 'bottom', labels: { font: chartFont, padding: 14, usePointStyle: true, pointStyleWidth: 10 } },
        tooltip: { backgroundColor: '#0f172a', titleFont: { ...chartFont, weight: '700' }, bodyFont: chartFont, padding: 12, cornerRadius: 8, displayColors: true },
      },
    };

    const pie = document.getElementById('stats-chart');
    if (pie) {
      if (window.statsPie) window.statsPie.destroy();
      window.statsPie = new Chart(pie.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Open', 'Resolved', 'Pending'],
          datasets: [{
            data: [stats.open, stats.solved, stats.pending_closure],
            backgroundColor: ['#ef4444', '#22c55e', '#f59e0b'],
            borderWidth: 0,
            hoverOffset: 8,
          }],
        },
        options: { ...defaultOpts, cutout: '65%' },
      });
    }

    const bar = document.getElementById('bar-chart');
    if (bar) {
      if (window.statsBar) window.statsBar.destroy();
      const barCtx = bar.getContext('2d');
      const grad = barCtx.createLinearGradient(0, 0, 0, 300);
      grad.addColorStop(0, '#3b82f6');
      grad.addColorStop(1, '#1e40af');
      window.statsBar = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: ['Total', 'Open', 'Resolved', 'Pending'],
          datasets: [{
            label: 'Cases',
            data: [stats.total, stats.open, stats.solved, stats.pending_closure],
            backgroundColor: [grad, '#ef4444', '#22c55e', '#f59e0b'],
            borderRadius: 6,
            borderSkipped: false,
          }],
        },
        options: { ...defaultOpts, plugins: { ...defaultOpts.plugins, legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: chartFont }, grid: { color: '#f1f5f9' } }, x: { ticks: { font: chartFont }, grid: { display: false } } } },
      });
    }

    const types = document.getElementById('chart-types');
    if (types && stats.by_type) {
      if (window.chartTypes) window.chartTypes.destroy();
      const bt = stats.by_type;
      const typeLabels = CASE_TYPE_OPTIONS.map((t) => t.label);
      const typeData = CASE_TYPE_OPTIONS.map((t) => bt[t.value] || 0);
      window.chartTypes = new Chart(types.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: typeLabels,
          datasets: [{
            data: typeData,
            backgroundColor: ['#7c3aed', '#0891b2', '#2563eb', '#dc2626', '#d97706', '#059669', '#14b8a6', '#8b5cf6'],
            borderWidth: 0,
            hoverOffset: 6,
          }],
        },
        options: { ...defaultOpts, cutout: '55%' },
      });
    }

    const judges = document.getElementById('chart-judges');
    if (judges && stats.judge_workload) {
      if (window.chartJudges) window.chartJudges.destroy();
      const wl = stats.judge_workload;
      const labels = wl.length ? wl.map((w) => (w.username || w.judge_id).slice(0, 22)) : ['(none)'];
      const data = wl.length ? wl.map((w) => w.assigned_cases) : [0];
      const jCtx = judges.getContext('2d');
      const jGrad = jCtx.createLinearGradient(0, 0, 400, 0);
      jGrad.addColorStop(0, '#3b82f6');
      jGrad.addColorStop(1, '#8b5cf6');
      window.chartJudges = new Chart(jCtx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Assigned', data, backgroundColor: jGrad, borderRadius: 6, borderSkipped: false }] },
        options: { ...defaultOpts, indexAxis: 'y', plugins: { ...defaultOpts.plugins, legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1, font: chartFont }, grid: { color: '#f1f5f9' } }, y: { ticks: { font: { ...chartFont, weight: '600' } }, grid: { display: false } } } },
      });
    }
  });
}

function loadJudgeDashboard() {
  document.getElementById('dashboard-title').innerHTML = '👨‍⚖️ Judicial Chambers';
  document.getElementById('dashboard-content').innerHTML = `
    <div class="welcome-banner fade-in-up">
      <h2>Welcome, Hon. ${escapeHtml(currentUser.username || 'Judge')} 👋</h2>
      <p class="welcome-sub">Matters assigned to your bench are listed below. Chamber notes are private to you and the registry.</p>
    </div>
    <div id="judge-cases" class="fade-in-up delay-1"></div>
  `;
  loadMyCases();
}

function loadMyCases() {
  apiCall('/cases').then((cases) => {
    const wrap = document.getElementById('judge-cases');
    if (!wrap) return;
    const list = Array.isArray(cases) ? cases : [];
    if (list.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><span class="empty-icon">📂</span><p>No cases assigned to your bench yet.</p></div>`;
      return;
    }
    // Store cases globally for modal access
    window._judgeCases = {};
    list.forEach(c => { window._judgeCases[c.id] = c; });

    wrap.innerHTML = list.map((c) => {
      const color = c.priority_color || 'GREEN';
      const score = c.priority_score != null ? c.priority_score : '—';
      const parties = `${escapeHtml(c.plaintiff || '—')} v. ${escapeHtml(c.defendant || '—')}`;
      return `
      <div class="judge-case-row" onclick="openCaseDetail('${c.id}')">
        <div class="jcr-pri pri-bg-${color}">${score}<small>${color}</small></div>
        <div class="jcr-info">
          <h4>${escapeHtml(c.title || 'Untitled')} — ${escapeHtml(c.case_number || c.id)}</h4>
          <div class="jcr-sub">${parties} · ${escapeHtml(c.hearing_date || 'No hearing')}</div>
        </div>
        <div class="jcr-right">
          <span class="badge status-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span>
          <span class="badge stage-badge">${escapeHtml(c.workflow_stage || 'intake')}</span>
          <span class="jcr-arrow">→</span>
        </div>
      </div>`;
    }).join('');
  });
}

function openCaseDetail(caseId) {
  const c = (window._judgeCases || {})[caseId];
  if (!c) return;
  const color = c.priority_color || 'GREEN';
  const score = c.priority_score != null ? c.priority_score : '—';
  const dl = c.statutory_deadline ? String(c.statutory_deadline).slice(0, 10) : '—';
  const notes = (c.chamber_notes || []).slice(-5).map((n) => `<li>${escapeHtml((n.text || '').slice(0, 200))}</li>`).join('') || '<li class="muted">No chamber notes yet.</li>';
  const acts = (c.activity_log || []).slice(-5).map((a) => `<li><strong>${escapeHtml(a.action)}</strong> — ${escapeHtml((a.message || '').slice(0, 100))}</li>`).join('') || '<li class="muted">No activity logged.</li>';

  const overlay = document.createElement('div');
  overlay.className = 'case-modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="case-modal">
      <div class="case-modal-header">
        <div>
          <h3>${escapeHtml(c.title || 'Untitled')}</h3>
          <div style="display:flex;gap:6px;margin-top:6px">
            <span class="pri-badge pri-${color}">${color} — ${score}</span>
            <span class="badge status-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span>
            <span class="badge stage-badge">${escapeHtml(c.workflow_stage || 'intake')}</span>
          </div>
        </div>
        <button class="case-modal-close" onclick="this.closest('.case-modal-overlay').remove()">✕</button>
      </div>
      <div class="case-modal-body">
        <div class="detail-grid">
          <div class="detail-item"><span class="detail-label">Case Number</span><span class="detail-value">${escapeHtml(c.case_number || '—')}</span></div>
          <div class="detail-item"><span class="detail-label">Internal ID</span><code>${escapeHtml(c.id)}</code></div>
          <div class="detail-item"><span class="detail-label">Plaintiff</span><span class="detail-value">${escapeHtml(c.plaintiff || '—')}</span></div>
          <div class="detail-item"><span class="detail-label">Defendant</span><span class="detail-value">${escapeHtml(c.defendant || '—')}</span></div>
          <div class="detail-item"><span class="detail-label">Statutory Deadline</span><span class="detail-value">${escapeHtml(dl)}</span></div>
          <div class="detail-item"><span class="detail-label">Next Hearing</span><span class="detail-value">${escapeHtml(c.hearing_date || 'Not scheduled')}</span></div>
          <div class="detail-item"><span class="detail-label">Case Type</span><span class="detail-value">${escapeHtml(c.case_type || '—')}</span></div>
          <div class="detail-item"><span class="detail-label">Urgency Factor</span><span class="detail-value">${c.urgency_factor != null ? c.urgency_factor : '—'} / 20</span></div>
        </div>

        <div class="case-modal-section">
          <h4>📄 AI Summary</h4>
          <p>${escapeHtml(c.summary || 'No summary generated yet. Click "AI Summary" below to extract from PDF.')}</p>
        </div>

        <div class="case-modal-section">
          <h4>⚖️ Legal Provisions</h4>
          <p>${escapeHtml(c.punishment || 'No provisions loaded yet.')}</p>
        </div>

        <div class="case-modal-section">
          <h4>📝 Verdict / Decision</h4>
          <p>${escapeHtml(c.verdict || 'No verdict published yet.')}</p>
        </div>

        <div class="case-modal-section">
          <h4>🗒️ Chamber Notes</h4>
          <ul class="mini-list" style="font-size:0.88rem">${notes}</ul>
        </div>

        <div class="case-modal-section">
          <h4>📋 Activity Log</h4>
          <ul class="mini-list" style="font-size:0.85rem">${acts}</ul>
        </div>

        <div class="case-modal-section">
          <h4>🗒️ Add Chamber Note</h4>
          <div style="display:flex;gap:8px">
            <input id="modal-note-input" data-autocap="1" placeholder="Type your note here…" style="flex:1;margin:0" />
            <button type="button" class="btn-small" onclick="submitChamberNote('${c.id}')" style="margin:0;white-space:nowrap">Save Note</button>
          </div>
        </div>

        <div class="case-modal-section">
          <h4>📅 Set Hearing Date</h4>
          <div style="display:flex;gap:8px">
            <input id="modal-hearing-input" type="date" style="flex:1;margin:0" />
            <button type="button" class="btn-small" onclick="submitHearingDate('${c.id}')" style="margin:0;white-space:nowrap">Set Date</button>
          </div>
        </div>

        <div class="case-modal-section">
          <h4>⚖️ Legal Provisions Search</h4>
          <div style="display:flex;gap:8px">
            <input id="modal-crime-input" placeholder="e.g. theft, murder, dowry, assault" style="flex:1;margin:0" />
            <button type="button" class="btn-small" onclick="submitPunishment('${c.id}')" style="margin:0;white-space:nowrap">Search</button>
          </div>
        </div>

        <div class="case-modal-section">
          <h4>📝 Request Closure</h4>
          <input id="modal-verdict-input" data-autocap="1" placeholder="Verdict text (visible to citizen)" style="margin:0 0 8px 0" />
          <input id="modal-closure-note-input" data-autocap="1" placeholder="Optional note to admin (internal)" style="margin:0 0 8px 0" />
          <button type="button" class="btn-warn btn-small" onclick="submitClosure('${c.id}')" style="margin:0">✅ Submit Closure Request</button>
        </div>
      </div>
      <div class="case-modal-actions">
        <button type="button" class="btn-small" onclick="summarizeCase('${c.id}')">🤖 Generate AI Summary (from PDF)</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

// Refresh case data in background and re-open modal with updated info
async function refreshAndReopenModal(caseId) {
  const cases = await apiCall('/cases');
  const list = Array.isArray(cases) ? cases : [];
  window._judgeCases = {};
  list.forEach(c => { window._judgeCases[c.id] = c; });
  // Close existing modal if any
  const existing = document.querySelector('.case-modal-overlay');
  if (existing) existing.remove();
  // Re-open with fresh data
  if (window._judgeCases[caseId]) openCaseDetail(caseId);
  // Also refresh the case list behind the modal
  const wrap = document.getElementById('judge-cases');
  if (wrap) {
    wrap.innerHTML = list.map((c) => {
      const color = c.priority_color || 'GREEN';
      const score = c.priority_score != null ? c.priority_score : '—';
      const parties = `${escapeHtml(c.plaintiff || '—')} v. ${escapeHtml(c.defendant || '—')}`;
      return `<div class="judge-case-row" onclick="openCaseDetail('${c.id}')">
        <div class="jcr-pri pri-bg-${color}">${score}<small>${color}</small></div>
        <div class="jcr-info"><h4>${escapeHtml(c.title || 'Untitled')} — ${escapeHtml(c.case_number || c.id)}</h4><div class="jcr-sub">${parties} · ${escapeHtml(c.hearing_date || 'No hearing')}</div></div>
        <div class="jcr-right"><span class="badge status-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span><span class="badge stage-badge">${escapeHtml(c.workflow_stage || 'intake')}</span><span class="jcr-arrow">→</span></div>
      </div>`;
    }).join('');
  }
}

function submitChamberNote(caseId) {
  const input = document.getElementById('modal-note-input');
  const text = input ? input.value.trim() : '';
  if (!text) { showAlert('Please type a note first.', 'error'); return; }
  apiCall(`/cases/${caseId}/chamber_notes`, {
    method: 'POST',
    body: JSON.stringify({ message: text }),
  }).then((d) => {
    if (d) {
      showAlert('Note recorded.');
      refreshAndReopenModal(caseId);
    }
  });
}

function submitHearingDate(caseId) {
  const input = document.getElementById('modal-hearing-input');
  const d = input ? input.value.trim() : '';
  if (!d) { showAlert('Please pick a date first.', 'error'); return; }
  apiCall(`/cases/${caseId}`, { method: 'PUT', body: JSON.stringify({ hearing_date: d }) }).then(() => {
    showAlert('Hearing date updated.');
    refreshAndReopenModal(caseId);
  });
}

function submitPunishment(caseId) {
  const input = document.getElementById('modal-crime-input');
  const crime = input ? input.value.trim() : '';
  if (!crime) { showAlert('Please enter an offense keyword.', 'error'); return; }
  showAlert('Fetching legal provisions…');
  apiCall(`/punishment/${encodeURIComponent(crime)}`).then((data) => {
    if (data && data.punishment) {
      apiCall(`/cases/${caseId}`, {
        method: 'PUT',
        body: JSON.stringify({ punishment: data.punishment }),
      }).then(() => {
        showAlert('Legal provisions saved.');
        refreshAndReopenModal(caseId);
      });
    }
  });
}

function submitClosure(caseId) {
  const vi = document.getElementById('modal-verdict-input');
  const ni = document.getElementById('modal-closure-note-input');
  const verdict = vi ? vi.value.trim() : '';
  const note = ni ? ni.value.trim() : '';
  if (!verdict) { showAlert('Please enter a verdict.', 'error'); return; }
  apiCall(`/cases/${caseId}`, {
    method: 'PUT',
    body: JSON.stringify({
      verdict,
      closure_request_note: note,
      status: 'pending_closure',
    }),
  }).then((d) => {
    if (d) {
      showAlert('Closure requested. Admin will review.');
      refreshAndReopenModal(caseId);
    }
  });
}

function loadUserDashboard() {
  document.getElementById('dashboard-title').innerHTML = '🏛️ Citizen Portal';
  document.getElementById('dashboard-content').innerHTML = `
    <div class="welcome-banner fade-in-up">
      <h2>Welcome, ${escapeHtml(currentUser.username || 'Citizen')} 👋</h2>
      <p class="welcome-sub">Track your court matters and check case status updates here.</p>
      <div class="stat-cards">
        <div class="stat-card"><div class="stat-value" style="font-size:1rem">${escapeHtml(currentUser.id)}</div><div class="stat-label">Your User ID</div></div>
      </div>
    </div>

    <div class="card block fade-in-up delay-1">
      <div class="section-header">
        <span class="section-icon">🔍</span>
        <div><h3>Track Your Case</h3><p class="section-desc">Enter your case ID to see its full status, hearings, and verdict.</p></div>
      </div>
      <label class="label-inline">Case ID</label>
      <input id="case-id-input" placeholder="Enter your 8-character case ID" />
      <button type="button" onclick="viewMyCase()">🔍 View Case Details</button>
    </div>

    <div id="case-details" class="card block hidden fade-in-up delay-2"></div>

    <div class="info-box fade-in-up delay-3">
      <strong>💡 Tip:</strong> Your User ID is <code id="my-uid"></code> — share this with the registry when filing a new case so it gets linked to your account.
    </div>
  `;
  document.getElementById('my-uid').textContent = currentUser.id;
}

function viewMyCase() {
  const caseId = document.getElementById('case-id-input').value.trim();
  if (!caseId) {
    showAlert('Enter a case ID.', 'error');
    return;
  }
  apiCall(`/cases/${caseId}`).then((c) => {
    if (!c || c.error) return;
    const view = document.getElementById('case-details');
    view.classList.remove('hidden');
    view.innerHTML = `
      <h3>${escapeHtml(c.title)}</h3>
      <p class="muted">Case Number: <strong>${escapeHtml(c.case_number || '—')}</strong> · Internal ID: <code>${escapeHtml(c.id)}</code></p>
      <p>${escapeHtml(c.plaintiff || '—')} <i>v.</i> ${escapeHtml(c.defendant || '—')}</p>
      <p class="muted small">${escapeHtml(c.court || '')}${c.jurisdiction ? ` · ${escapeHtml(c.jurisdiction)}` : ''}</p>
      <p class="pri-inline">${priorityCell(c)}</p>
      <hr>
      <p><b>Status</b> ${escapeHtml(c.status)} · <b>Stage</b> ${escapeHtml(c.workflow_stage || '—')}</p>
      <p><b>Next hearing</b> ${escapeHtml(c.hearing_date || 'Not scheduled')}</p>
      <p><b>Summary</b><br>${escapeHtml(c.summary || '—')}</p>
      <p><b>Applicable legal provisions</b><br>${escapeHtml(c.punishment || '—')}</p>
      <p><b>Decision</b><br>${escapeHtml(c.verdict || 'No final order published yet.')}</p>
    `;
  });
}
