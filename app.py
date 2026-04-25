from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import json
import os
import hashlib
from datetime import datetime, timezone
import uuid
import random
import io
import re

try:
    import PyPDF2
except ImportError:
    PyPDF2 = None
try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    requests = None
    BeautifulSoup = None

app = Flask(__name__)
CORS(app)

DATA_DIR = 'data'
UPLOADS_DIR = 'uploads'
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

ROLES = frozenset({'admin', 'judge', 'user'})
REGISTERABLE_ROLES = frozenset({'judge', 'user'})

ADMIN_USERNAME = 'manish'
ADMIN_PASSWORD = 'manish'
ADMIN_TOKEN = 'admin-fixed-token'
ADMIN_USER = {
    'id': ADMIN_TOKEN,
    'username': ADMIN_USERNAME,
    'password': hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest(),
    'role': 'admin',
}

APP_NAME = 'Intelligent Court Case Prioritization System'
APP_SHORT = 'CASE'

# Priority module:
# Base = (Days_Old × 1.5) + Type_Score + Urgency_Factor + Deadline_Factor
TYPE_SCORE = {
    'criminal': 30,
    'cyber': 28,
    'constitutional': 26,
    'commercial': 24,
    'family': 20,
    'labour': 18,
    'property': 17,
    'civil': 15,
}
# Bands: higher score = more urgent (RED), lower = routine (GREEN)
PRIORITY_RED_MIN = 75.0
PRIORITY_YELLOW_MIN = 40.0

WORKFLOW_STAGES = frozenset({
    'intake', 'assigned', 'hearing', 'decision', 'archived',
})

BNS_PDF_URL = 'https://www.indiacode.nic.in/bitstream/123456789/20062/1/a202345.pdf'
_BNS_TEXT_CACHE = None

# Keyword to section mapping; punishment text is extracted live from online BNS PDF.
OFFENCE_SECTION_HINTS = [
    {'keywords': ('murder', 'homicide', 'kill'), 'sections': ('103',)},
    {'keywords': ('rape', 'sexual assault', 'sexual violence'), 'sections': ('64', '65', '66')},
    {'keywords': ('theft', 'steal', 'stolen'), 'sections': ('303',)},
    {'keywords': ('robbery', 'dacoity', 'loot'), 'sections': ('309', '310')},
    {'keywords': ('dowry', 'cruelty', 'domestic violence', '498a'), 'sections': ('85',)},
    {'keywords': ('kidnap', 'abduct', 'abduction'), 'sections': ('137', '140')},
    {'keywords': ('cheat', 'fraud', 'forgery', 'scam'), 'sections': ('318', '335', '336')},
    {'keywords': ('assault', 'hurt', 'grievous hurt', 'battery'), 'sections': ('115', '117')},
]


def normalize_case_type(raw):
    s = (raw or 'civil').strip().lower()
    return s if s in TYPE_SCORE else 'civil'


def case_days_old(case):
    created = case.get('created_at')
    if not created:
        return 0
    try:
        dt = datetime.fromisoformat(created.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        delta = now - dt
        return max(0, int(delta.total_seconds() // 86400))
    except (ValueError, TypeError):
        return 0


def generate_case_number(case_type):
    year = datetime.now(timezone.utc).year
    prefix = {
        'criminal': 'CR',
        'cyber': 'CY',
        'constitutional': 'CN',
        'commercial': 'CM',
        'family': 'FA',
        'labour': 'LB',
        'property': 'PR',
        'civil': 'CV',
    }
    code = prefix.get(normalize_case_type(case_type), 'CV')
    seq = random.randint(1000, 9999)
    return f'{APP_SHORT}-{year}-{code}-{seq}'


def deadline_factor(case):
    """Extra priority if statutory deadline is near or overdue (0–25)."""
    raw = case.get('statutory_deadline')
    if not raw or not str(raw).strip():
        return 0
    try:
        dt = datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        days_until = (dt - now).total_seconds() / 86400.0
        if days_until < 0:
            return 25
        if days_until <= 7:
            return 15
        if days_until <= 30:
            return 8
        return 0
    except (ValueError, TypeError, OSError):
        return 0


def ensure_priority_stored_fields(case):
    """Persist case_type and one-time random urgency_factor for stable scoring."""
    changed = False
    if case.get('urgency_factor') is None:
        case['urgency_factor'] = random.randint(0, 20)
        changed = True
    if not case.get('case_type'):
        case['case_type'] = 'civil'
        changed = True
    return changed


def migrate_case_defaults(case):
    """Backfill realistic fields for older records."""
    changed = ensure_priority_stored_fields(case)
    if not case.get('case_number'):
        case['case_number'] = generate_case_number(case.get('case_type'))
        changed = True
    case.setdefault('plaintiff', '')
    case.setdefault('defendant', '')
    case.setdefault('court', 'District Court — General Division')
    case.setdefault('jurisdiction', '')
    case.setdefault('workflow_stage', 'intake')
    case.setdefault('statutory_deadline', None)
    case.setdefault('filing_date', case.get('created_at'))
    case.setdefault('activity_log', [])
    case.setdefault('chamber_notes', [])
    if case.get('status') in ('closed', 'solved'):
        case['workflow_stage'] = 'archived'
    return changed


def append_activity(case, actor_id, role, action, message=''):
    case.setdefault('activity_log', [])
    case['activity_log'].append({
        'ts': datetime.now(timezone.utc).isoformat(),
        'actor_id': actor_id,
        'role': role,
        'action': action,
        'message': message[:500] if message else '',
    })


def compute_priority(case):
    """
    Priority_Score = (Days_Old × 1.5) + Type_Score + Urgency_Factor + Deadline_Factor
    Color: RED (high), YELLOW (medium), GREEN (lower priority).
    """
    case_type = normalize_case_type(case.get('case_type'))
    type_score = TYPE_SCORE[case_type]
    try:
        urgency = int(case.get('urgency_factor', 0))
    except (TypeError, ValueError):
        urgency = 0
    urgency = max(0, min(20, urgency))
    days_old = case_days_old(case)
    df = deadline_factor(case)
    priority_score = round((days_old * 1.5) + type_score + urgency + df, 2)
    if priority_score >= PRIORITY_RED_MIN:
        color = 'RED'
    elif priority_score >= PRIORITY_YELLOW_MIN:
        color = 'YELLOW'
    else:
        color = 'GREEN'
    return {
        'case_type': case_type,
        'type_score': type_score,
        'urgency_factor': urgency,
        'deadline_factor': df,
        'days_old': days_old,
        'priority_score': priority_score,
        'priority_color': color,
    }


def enrich_case_for_response(case):
    """Return case dict with priority breakdown for API consumers."""
    out = dict(case)
    meta = compute_priority(out)
    out.update(meta)
    return out


def user_public(u):
    return {k: v for k, v in u.items() if k != 'password'}


def ensure_user_defaults(user):
    """Backfill legacy user fields from older schema."""
    changed = False
    if not user.get('username'):
        legacy = (user.get('email') or '').strip().lower()
        if legacy:
            user['username'] = legacy.split('@')[0]
            changed = True
    if user.get('role') not in ROLES:
        user['role'] = 'user'
        changed = True
    return changed


def load_json(filename):
    path = os.path.join(DATA_DIR, filename)
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []


def save_json(filename, data):
    path = os.path.join(DATA_DIR, filename)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)


def normalize_users(users):
    """Keep only valid user objects with id/username/password/role."""
    cleaned = []
    changed = False
    for u in users:
        if not isinstance(u, dict):
            changed = True
            continue
        if ensure_user_defaults(u):
            changed = True
        if not u.get('id') or not u.get('username') or not u.get('password'):
            changed = True
            continue
        cleaned.append(u)
    return cleaned, changed


def normalize_cases(cases):
    """Keep only valid case objects with id."""
    cleaned = []
    changed = False
    for c in cases:
        if not isinstance(c, dict):
            changed = True
            continue
        if not c.get('id'):
            changed = True
            continue
        cleaned.append(c)
    return cleaned, changed


def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()


def get_current_user(token):
    if not token:
        return None
    if token == ADMIN_TOKEN:
        return dict(ADMIN_USER)
    users = load_json('users.json')
    users, changed = normalize_users(users)
    if changed:
        save_json('users.json', users)
    return next((user for user in users if user.get('id') == token), None)


def requires_auth(f):
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '').replace('Bearer ', '')
        user = get_current_user(auth_header)
        if not user:
            return jsonify({'error': 'Unauthorized'}), 401
        request.current_user = user
        return f(*args, **kwargs)
    return decorated_function


def requires_role(*roles):
    def decorator(f):
        from functools import wraps
        @wraps(f)
        def wrapped(*args, **kwargs):
            if getattr(request, 'current_user', None) is None:
                return jsonify({'error': 'Unauthorized'}), 401
            if request.current_user.get('role') not in roles:
                return jsonify({'error': 'Forbidden'}), 403
            return f(*args, **kwargs)
        return wrapped
    return decorator


def can_access_case(user, case):
    role = user.get('role')
    uid = user['id']
    if role == 'admin':
        return True
    if role == 'judge' and case.get('judge_id') == uid:
        return True
    if role == 'user' and case.get('user_id') == uid:
        return True
    return False


@app.route('/signup', methods=['POST'])
def signup():
    data = request.json or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password') or ''
    role = (data.get('role') or '').strip().lower()
    if not username or not password or not role:
        return jsonify({'error': 'Username, password, and role are required'}), 400
    if role not in REGISTERABLE_ROLES:
        return jsonify({'error': 'Registration role must be citizen or judge'}), 400
    users = load_json('users.json')
    users, users_changed = normalize_users(users)
    if users_changed:
        save_json('users.json', users)
    if username == ADMIN_USERNAME:
        return jsonify({'error': 'This username is reserved'}), 400
    if any(u.get('username', '').lower() == username for u in users):
        return jsonify({'error': 'Username already exists'}), 400

    user_id = str(uuid.uuid4())[:8]
    user = {
        'id': user_id,
        'username': username,
        'password': hash_password(password),
        'role': role,
    }
    users.append(user)
    save_json('users.json', users)
    return jsonify({
        'message': 'Signup successful. You can log in now.',
        'user': user_public(user),
        'token': user_id,
    })


@app.route('/login', methods=['POST'])
def login():
    data = request.json or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password') or ''
    role = (data.get('role') or '').strip().lower()
    if not username or not password or not role:
        return jsonify({'error': 'Username, password, and role are required'}), 400

    if role == 'admin':
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            return jsonify({
                'message': 'Admin login successful',
                'user': user_public(ADMIN_USER),
                'token': ADMIN_TOKEN,
            })
        return jsonify({'error': 'Invalid admin credentials'}), 401

    users = load_json('users.json')
    users, users_changed = normalize_users(users)
    if users_changed:
        save_json('users.json', users)
    hashed_pw = hash_password(password)
    user = next(
        (
            u for u in users
            if u.get('username', '').lower() == username
            and u['password'] == hashed_pw
            and u.get('role') == role
        ),
        None,
    )
    if not user:
        return jsonify({'error': 'Invalid credentials'}), 401
    return jsonify({
        'message': 'Login successful',
        'user': user_public(user),
        'token': user['id'],
    })


@app.route('/me', methods=['GET'])
@requires_auth
def me():
    return jsonify(user_public(request.current_user))


@app.route('/admin/judges', methods=['POST'])
@requires_auth
@requires_role('admin')
def admin_create_judge():
    data = request.json or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400
    if username == ADMIN_USERNAME:
        return jsonify({'error': 'This username is reserved'}), 400
    users = load_json('users.json')
    users, users_changed = normalize_users(users)
    if users_changed:
        save_json('users.json', users)
    if any(u.get('username', '').lower() == username for u in users):
        return jsonify({'error': 'Username already exists'}), 400
    user_id = str(uuid.uuid4())[:8]
    judge = {
        'id': user_id,
        'username': username,
        'password': hash_password(password),
        'role': 'judge',
    }
    users.append(judge)
    save_json('users.json', users)
    return jsonify({'message': 'Judge account created', 'user': user_public(judge)})


@app.route('/users', methods=['GET'])
@requires_auth
def get_users():
    if request.current_user['role'] == 'admin':
        users = load_json('users.json')
        users, users_changed = normalize_users(users)
        if users_changed:
            save_json('users.json', users)
        return jsonify([user_public(u) for u in users])
    return jsonify({'valid': True, 'role': request.current_user.get('role')})


def _enriched_cases_for_stats(cases):
    return [enrich_case_for_response(c) for c in cases]


@app.route('/app_info', methods=['GET'])
def app_info():
    return jsonify({
        'name': APP_NAME,
        'short': APP_SHORT,
        'priority_formula': (
            '(Days_Old × 1.5) + Type_Score + Urgency_Factor (0–20) + Deadline_Factor (0–25)'
        ),
        'type_scores': dict(TYPE_SCORE),
    })


@app.route('/stats', methods=['GET'])
@requires_auth
@requires_role('admin')
def stats():
    cases = load_json('cases.json')
    cases, cases_changed = normalize_cases(cases)
    if cases_changed:
        save_json('cases.json', cases)
    _stats_migrated = False
    for c in cases:
        if migrate_case_defaults(c):
            _stats_migrated = True
    if _stats_migrated:
        save_json('cases.json', cases)

    users = load_json('users.json')
    users, users_changed = normalize_users(users)
    if users_changed:
        save_json('users.json', users)
    judges = {u['id']: u.get('username', '') for u in users if u.get('role') == 'judge'}

    by_type = {k: 0 for k in TYPE_SCORE.keys()}
    by_priority = {'RED': 0, 'YELLOW': 0, 'GREEN': 0}
    by_stage = {}
    judge_load = {}

    enriched = _enriched_cases_for_stats(cases)
    for ec in enriched:
        ct = normalize_case_type(ec.get('case_type'))
        if ct in by_type:
            by_type[ct] += 1
        col = ec.get('priority_color', 'GREEN')
        by_priority[col] = by_priority.get(col, 0) + 1
        st = ec.get('workflow_stage') or 'intake'
        by_stage[st] = by_stage.get(st, 0) + 1
        jid = ec.get('judge_id')
        if jid:
            judge_load[jid] = judge_load.get(jid, 0) + 1

    workload = [
        {
            'judge_id': jid,
            'username': judges.get(jid, '—'),
            'assigned_cases': n,
        }
        for jid, n in sorted(judge_load.items(), key=lambda x: -x[1])
    ]

    closed = [c for c in cases if c.get('status') in ('closed', 'solved')]
    resolution_days = []
    for c in closed:
        try:
            created = datetime.fromisoformat((c.get('created_at') or '').replace('Z', '+00:00'))
            closed_at = c.get('closed_at')
            if closed_at:
                end = datetime.fromisoformat(closed_at.replace('Z', '+00:00'))
            else:
                continue
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            resolution_days.append((end - created).days)
        except (ValueError, TypeError):
            pass
    avg_resolution_days = round(sum(resolution_days) / len(resolution_days), 1) if resolution_days else None

    stats_data = {
        'total': len(cases),
        'open': len([c for c in cases if c.get('status') == 'open']),
        'solved': len([c for c in cases if c.get('status') in ('solved', 'closed')]),
        'pending_closure': len([c for c in cases if c.get('status') == 'pending_closure']),
        'by_type': by_type,
        'by_priority_color': by_priority,
        'by_workflow_stage': by_stage,
        'judge_workload': workload,
        'avg_resolution_days': avg_resolution_days,
    }
    return jsonify(stats_data)


@app.route('/cases', methods=['GET', 'POST'])
@requires_auth
def cases():
    all_cases = load_json('cases.json')
    all_cases, cases_changed = normalize_cases(all_cases)
    if cases_changed:
        save_json('cases.json', all_cases)

    if request.method == 'POST':
        if request.current_user['role'] != 'admin':
            return jsonify({'error': 'Admin only'}), 403
        data = request.json or {}
        ct = normalize_case_type(data.get('case_type'))
        uid = data.get('user_id')
        plaintiff = (data.get('plaintiff') or '').strip()
        defendant = (data.get('defendant') or '').strip()
        if not uid or not plaintiff or not defendant:
            return jsonify({'error': 'Citizen user_id, filer name, and against-person name are required'}), 400
        now_iso = datetime.now(timezone.utc).isoformat()
        case = {
            'id': str(uuid.uuid4())[:8],
            'case_number': generate_case_number(ct),
            'title': (data.get('title') or 'Untitled').strip(),
            'plaintiff': plaintiff,
            'defendant': defendant,
            'court': (data.get('court') or 'District Court — General Division').strip(),
            'jurisdiction': (data.get('jurisdiction') or '').strip(),
            'user_id': uid,
            'judge_id': data.get('judge_id'),
            'case_type': ct,
            'urgency_factor': random.randint(0, 20),
            'workflow_stage': 'intake',
            'status': 'open',
            'summary': '',
            'punishment': '',
            'verdict': '',
            'pdf_path': None,
            'hearing_date': None,
            'closure_request_note': '',
            'statutory_deadline': data.get('statutory_deadline') or None,
            'filing_date': (data.get('filing_date') or now_iso[:10]),
            'created_at': now_iso,
            'closed_at': None,
            'activity_log': [],
            'chamber_notes': [],
        }
        migrate_case_defaults(case)
        if case.get('judge_id'):
            case['workflow_stage'] = 'assigned'
        append_activity(
            case,
            request.current_user['id'],
            request.current_user.get('role') or 'admin',
            'case_created',
            f"Registered case {case['case_number']}: {case['title']}",
        )
        all_cases.append(case)
        save_json('cases.json', all_cases)
        return jsonify({'message': 'Case added', 'case': enrich_case_for_response(case)})

    any_changed = False
    for c in all_cases:
        if migrate_case_defaults(c):
            any_changed = True
    if any_changed:
        save_json('cases.json', all_cases)

    role = request.current_user['role']
    uid = request.current_user['id']
    if role == 'judge':
        filtered_cases = [c for c in all_cases if c.get('judge_id') == uid]
    elif role == 'user':
        filtered_cases = [c for c in all_cases if c.get('user_id') == uid]
    else:
        filtered_cases = all_cases
    return jsonify([enrich_case_for_response(c) for c in filtered_cases])


@app.route('/cases/<case_id>', methods=['GET', 'PUT', 'DELETE'])
@requires_auth
def case_by_id(case_id):
    cases_data = load_json('cases.json')
    cases_data, cases_changed = normalize_cases(cases_data)
    if cases_changed:
        save_json('cases.json', cases_data)
    case = next((c for c in cases_data if c.get('id') == case_id), None)
    if not case:
        return jsonify({'error': 'Case not found'}), 404

    if not can_access_case(request.current_user, case):
        return jsonify({'error': 'Forbidden'}), 403

    if request.method == 'PUT':
        body = request.json or {}
        role = request.current_user['role']

        if role == 'user':
            return jsonify({'error': 'Citizens cannot edit cases'}), 403

        prev_status = case.get('status')

        if role == 'judge':
            allowed = {
                'summary', 'punishment', 'verdict', 'hearing_date',
                'status', 'closure_request_note', 'workflow_stage',
            }
            body = {k: v for k, v in body.items() if k in allowed}
            if 'status' in body and body['status'] not in (
                'open', 'pending_closure', 'solved', 'closed',
            ):
                del body['status']
            if 'workflow_stage' in body and body['workflow_stage'] not in WORKFLOW_STAGES:
                del body['workflow_stage']

        if role == 'admin':
            admin_keys = {
                'title', 'plaintiff', 'defendant', 'court', 'jurisdiction',
                'case_type', 'workflow_stage', 'statutory_deadline', 'filing_date',
                'urgency_factor', 'judge_id', 'user_id', 'hearing_date', 'status',
                'summary', 'punishment', 'closure_request_note',
            }
            body = {k: v for k, v in body.items() if k in admin_keys}
            if 'case_type' in body:
                body['case_type'] = normalize_case_type(body.get('case_type'))
            if 'urgency_factor' in body:
                try:
                    u = int(body['urgency_factor'])
                    body['urgency_factor'] = max(0, min(20, u))
                except (TypeError, ValueError):
                    del body['urgency_factor']
            if 'statutory_deadline' in body and body['statutory_deadline'] in ('', None):
                body['statutory_deadline'] = None
            if 'workflow_stage' in body and body['workflow_stage'] not in WORKFLOW_STAGES:
                del body['workflow_stage']
            if 'status' in body and body['status'] not in (
                'open', 'pending_closure', 'solved', 'closed',
            ):
                del body['status']
            if body.get('status') in ('closed', 'solved'):
                judge_verdict = (case.get('verdict') or '').strip()
                if not judge_verdict:
                    return jsonify({
                        'error': 'Judge verdict is required before admin can close the case',
                    }), 400

        changed_keys = [k for k in body if body.get(k) != case.get(k)]
        case.update(body)
        migrate_case_defaults(case)
        ensure_priority_stored_fields(case)

        sts = case.get('status')
        ws = case.get('workflow_stage')
        if sts in ('closed', 'solved') and prev_status not in ('closed', 'solved'):
            case['closed_at'] = datetime.now(timezone.utc).isoformat()
        if sts in ('closed', 'solved'):
            case['workflow_stage'] = 'archived'
        elif sts == 'pending_closure':
            case['workflow_stage'] = 'decision'
        elif case.get('hearing_date') and ws in ('intake', 'assigned') and sts == 'open':
            case['workflow_stage'] = 'hearing'
        elif case.get('judge_id') and ws == 'intake' and sts == 'open':
            case['workflow_stage'] = 'assigned'

        if changed_keys:
            append_activity(
                case,
                request.current_user['id'],
                role or 'staff',
                'case_updated',
                ', '.join(changed_keys)[:400],
            )

        save_json('cases.json', cases_data)
        return jsonify({'message': 'Case updated', 'case': enrich_case_for_response(case)})

    if request.method == 'DELETE':
        if request.current_user['role'] != 'admin':
            return jsonify({'error': 'Admin only'}), 403
        pdf_path = case.get('pdf_path')
        if pdf_path and os.path.isfile(pdf_path):
            try:
                os.remove(pdf_path)
            except OSError:
                pass
        cases_data = [c for c in cases_data if c.get('id') != case_id]
        save_json('cases.json', cases_data)
        return jsonify({'message': 'Case deleted'})

    if migrate_case_defaults(case):
        save_json('cases.json', cases_data)
    return jsonify(enrich_case_for_response(case))


@app.route('/upload_pdf', methods=['POST'])
@requires_auth
def upload_pdf():
    if request.current_user['role'] != 'admin':
        return jsonify({'error': 'Admin only'}), 403
    if 'pdf' not in request.files:
        return jsonify({'error': 'No PDF provided'}), 400

    file = request.files['pdf']
    case_id = request.form.get('case_id')
    if not case_id:
        return jsonify({'error': 'case_id required'}), 400
    safe_name = os.path.basename(file.filename or 'document.pdf')
    filepath = os.path.join(UPLOADS_DIR, f"{case_id}_{safe_name}")
    file.save(filepath)

    cases = load_json('cases.json')
    cases, cases_changed = normalize_cases(cases)
    if cases_changed:
        save_json('cases.json', cases)
    for c in cases:
        if c.get('id') == case_id:
            c['pdf_path'] = filepath
            migrate_case_defaults(c)
            append_activity(
                c,
                request.current_user['id'],
                request.current_user.get('role') or 'admin',
                'document_uploaded',
                os.path.basename(filepath),
            )
            break
    save_json('cases.json', cases)
    return jsonify({'pdf_path': filepath})


@app.route('/cases/<case_id>/chamber_notes', methods=['POST'])
@requires_auth
def add_chamber_note(case_id):
    cases_data = load_json('cases.json')
    case = next((c for c in cases_data if c['id'] == case_id), None)
    if not case:
        return jsonify({'error': 'Case not found'}), 404
    if not can_access_case(request.current_user, case):
        return jsonify({'error': 'Forbidden'}), 403
    role = request.current_user.get('role')
    if role not in ('admin', 'judge'):
        return jsonify({'error': 'Forbidden'}), 403
    data = request.json or {}
    text = (data.get('message') or '').strip()
    if not text:
        return jsonify({'error': 'message required'}), 400
    migrate_case_defaults(case)
    note = {
        'ts': datetime.now(timezone.utc).isoformat(),
        'author_id': request.current_user['id'],
        'text': text[:4000],
    }
    case.setdefault('chamber_notes', []).append(note)
    append_activity(
        case,
        request.current_user['id'],
        role,
        'chamber_note',
        text[:200],
    )
    save_json('cases.json', cases_data)
    return jsonify({'message': 'Note added', 'case': enrich_case_for_response(case)})


def extract_pdf_text(pdf_path, max_pages=5, max_chars=4000):
    if not PyPDF2:
        return None
    try:
        with open(pdf_path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            n = min(len(reader.pages), max_pages)
            parts = []
            for i in range(n):
                t = reader.pages[i].extract_text() or ''
                parts.append(t.strip())
        text = '\n\n'.join(parts)[:max_chars]
        return text
    except Exception:
        return None


def get_bns_text_online():
    """
    Download BNS 2023 PDF from India Code and cache extracted text in memory.
    """
    global _BNS_TEXT_CACHE
    if _BNS_TEXT_CACHE is not None:
        return _BNS_TEXT_CACHE

    if not requests or not PyPDF2:
        return None
    try:
        resp = requests.get(
            BNS_PDF_URL,
            headers={'User-Agent': 'CourtCaseSystem/1.0'},
            timeout=25,
        )
        if resp.status_code != 200:
            return None
        reader = PyPDF2.PdfReader(io.BytesIO(resp.content))
        pages = []
        for p in reader.pages:
            pages.append((p.extract_text() or '').strip())
        # Keep as one normalized text blob for fast substring search.
        _BNS_TEXT_CACHE = '\n'.join(pages)
        return _BNS_TEXT_CACHE
    except Exception:
        return None


def extract_bns_punishment_lines(query, max_hits=4):
    """
    Find section + punishment snippets from online BNS text for a query.
    """
    text = get_bns_text_online()
    if not text:
        return []

    low = text.lower()
    stop = {'with', 'under', 'case', 'law', 'crime', 'offence', 'offense', 'section'}
    tokens = [t for t in re.findall(r'[a-z0-9]+', query.lower()) if len(t) >= 4 and t not in stop]
    if not tokens:
        tokens = [query.lower()]

    hits = []
    for tok in tokens:
        for m in re.finditer(re.escape(tok), low):
            hits.append(m.start())
            if len(hits) >= 12:
                break
        if len(hits) >= 12:
            break

    snippets = []
    seen = set()
    for pos in hits:
        s = max(0, pos - 900)
        e = min(len(text), pos + 900)
        window = text[s:e]

        section_matches = list(re.finditer(r'(Section\s+\d+[A-Za-z]?)', window, flags=re.IGNORECASE))
        section = section_matches[-1].group(1) if section_matches else 'Section (context)'

        sent_matches = re.findall(
            r'([^.:\n]{0,180}(?:shall\s+be\s+punished|punished\s+with)[^.:\n]{0,220}\.?)',
            window,
            flags=re.IGNORECASE,
        )
        filtered = [
            s for s in sent_matches
            if any(t in s.lower() for t in tokens)
        ]
        chosen = filtered[0] if filtered else (sent_matches[0] if sent_matches else '')

        if chosen:
            punishment_text = chosen.strip()
            line = f'{section}: {punishment_text}'
        else:
            # Fallback to short context around the hit if punishment sentence not found
            compact = ' '.join(window.split())
            line = f'{section}: {compact[:220]}...'

        key = line.lower()
        if key not in seen:
            snippets.append(line)
            seen.add(key)
        if len(snippets) >= max_hits:
            break

    return snippets


def extract_bns_section_punishment(section_no):
    """
    Extract likely punishment sentence for a specific BNS section number
    from the online official PDF text.
    """
    text = get_bns_text_online()
    if not text:
        return None

    pattern = re.compile(
        rf'(Section|SECTION)\s+{re.escape(section_no)}\b(.{{0,1800}})',
        flags=re.IGNORECASE | re.DOTALL,
    )
    m = pattern.search(text)
    if not m:
        return None

    block = ' '.join(m.group(0).split())
    sent = re.search(
        r'([^.]{0,180}(?:shall\s+be\s+punished|punished\s+with)[^.]{0,260}\.?)',
        block,
        flags=re.IGNORECASE,
    )
    if sent:
        return f'Section {section_no}: {sent.group(1).strip()}'

    # fallback if punishment sentence was not OCR-extracted cleanly
    return f'Section {section_no}: {block[:260]}...'


@app.route('/summary/<case_id>', methods=['GET'])
@requires_auth
def get_summary(case_id):
    cases = load_json('cases.json')
    case = next((c for c in cases if c['id'] == case_id), None)
    if not case:
        return jsonify({'error': 'Case not found'}), 404
    if not can_access_case(request.current_user, case):
        return jsonify({'error': 'Forbidden'}), 403

    if not case.get('pdf_path'):
        return jsonify({'summary': 'No PDF uploaded for this case.'})

    text = extract_pdf_text(case['pdf_path'])
    if text is None:
        return jsonify({'summary': 'Could not read PDF (install PyPDF2 or check file).'})

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    condensed = ' '.join(lines[:40])
    if len(condensed) > 1200:
        condensed = condensed[:1200].rsplit(' ', 1)[0] + '…'

    summary = (
        '[AI-style digest] Key points extracted from the filing:\n\n'
        f'{condensed}\n\n'
        '(Generated from the PDF text; review the full document for accuracy.)'
    )
    return jsonify({'summary': summary})


@app.route('/punishment/<path:crime>', methods=['GET'])
@requires_auth
def get_punishment(crime):
    q = (crime or '').strip()
    if not q:
        return jsonify({'punishment': 'Enter a crime or legal topic to search.'})

    ql = q.lower()
    section_targets = []
    for row in OFFENCE_SECTION_HINTS:
        if any(k in ql for k in row['keywords']):
            section_targets.extend(row['sections'])
    # unique, preserve order
    section_targets = list(dict.fromkeys(section_targets))

    snippets = []
    for sec in section_targets:
        s = extract_bns_section_punishment(sec)
        if s:
            snippets.append(s)
        if len(snippets) >= 4:
            break

    # fallback to generic extraction if keyword mapping did not match
    if not snippets:
        snippets = extract_bns_punishment_lines(q)

    if not snippets:
        return jsonify({
            'punishment': (
                f'Could not fetch online legal text right now for "{crime}". '
                'Try again in a moment with a specific offense term.'
            ),
        })

    lines = [f'Online India Code references for "{crime}" (Bharatiya Nyaya Sanhita, 2023):']
    lines.extend(f'- {m}' for m in snippets[:4])
    lines.append(f'Source: {BNS_PDF_URL}')
    lines.append('Note: Auto-extracted educational output; verify with official bare act text.')
    return jsonify({'punishment': '\n'.join(lines)})


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)


if __name__ == '__main__':
    app.run(debug=True, port=5000)
