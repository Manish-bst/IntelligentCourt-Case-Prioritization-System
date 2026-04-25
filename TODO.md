# CourtCase Management System - Implementation Plan

## Status: In Progress ⏳

### 0. Fix 404 Error (Static Serving) ✅ Complete
- [x] **app.py**: Add `@app.route('/')` → `send_from_directory('static', 'index.html')`
- [x] **app.py**: Add `@app.route('/<path:path>')` → `send_from_directory('static', path)`
- [ ] Test: `python app.py` → http://localhost:5000/ loads without 404
- [x] Update TODO status

### 1. Backend Updates (app.py) ✅ Complete
- [x] Add auth helpers (`get_current_user`, `@requires_auth`, `@admin_only` decorators)
- [x] Protect routes: /cases*, /upload_pdf, /summary*, /punishment with auth
- [x] Add /stats endpoint for admin charts (counts: total/open/solved/by_judge)
- [x] Fix /users GET for token validation
- [x] Ensure case fields: user_id, judge_id, hearing_date, closure_requested

### 2. Frontend Enhancements (static/script.js)
- [ ] Admin: PDF upload form/button (FormData POST /upload_pdf)
- [ ] Admin: "Add Judge" form (POST /signup role='judge')
- [ ] Judge: Hearing date input/button (PUT hearing_date), "Request Closure" (PUT status='pending_closure')
- [ ] User: Filter cases by currentUser.id
- [ ] Global: Handle 401 (logout), load /stats for charts, show logout btn

### 3. UI Polish (static/index.html)
- [ ] Ensure logout btn visibility (JS controlled)

### 4. Testing & Deployment
- [ ] Install deps: `pip install -r requirements.txt`
- [ ] Run server: `python app.py`
- [ ] Browser test: signup/login roles, full flows (add case/PDF/allocate/summarize/punishment/date/closure/view/charts)
- [ ] All checks ✅

**Next Step:** Complete 404 fix → Frontend enhancements
