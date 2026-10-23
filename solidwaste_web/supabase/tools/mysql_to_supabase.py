#!/usr/bin/env python3
"""
Copies the ECollect data from the PHP/MySQL database into an SQL file for Supabase
(supabase/setup/04_data.sql). Logins and passwords are NOT copied: accounts get a
Supabase login through the website (staff) or by signing up again (residents).

Usage (needs Python 3 and `pip install pymysql`):
    python supabase/tools/mysql_to_supabase.py --host 127.0.0.1 --user root --password "" \
        --database solidwaste_scheduling > supabase/setup/04_data.sql
"""
import argparse, datetime, decimal, json, re, sys
import pymysql

ap = argparse.ArgumentParser()
ap.add_argument('--host', default='127.0.0.1'); ap.add_argument('--port', type=int, default=3306)
ap.add_argument('--user', default='root'); ap.add_argument('--password', default='')
ap.add_argument('--database', default='solidwaste_scheduling')
a = ap.parse_args()
db = pymysql.connect(host=a.host, port=a.port, user=a.user, password=a.password, database=a.database,
                     cursorclass=pymysql.cursors.DictCursor, charset='utf8mb4')

def table_exists(t):
    with db.cursor() as c:
        c.execute('SHOW TABLES LIKE %s', (t,)); return c.fetchone() is not None

def cols(t):
    with db.cursor() as c:
        c.execute(f'SHOW COLUMNS FROM `{t}`'); return [r['Field'] for r in c.fetchall()]

def rows(t, order):
    with db.cursor() as c:
        c.execute(f'SELECT * FROM `{t}` ORDER BY {order}'); return c.fetchall()

def lit(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float, decimal.Decimal)): return str(v)
    if isinstance(v, datetime.datetime): return "'" + v.strftime('%Y-%m-%d %H:%M:%S') + "+08'"   # MySQL ran on Philippine time
    if isinstance(v, datetime.date): return "'" + v.isoformat() + "'"
    if isinstance(v, datetime.timedelta):
        s = int(v.total_seconds()); return "'%02d:%02d:%02d'" % (s // 3600, s % 3600 // 60, s % 60)
    return "'" + str(v).replace("'", "''") + "'"

def path_json(raw):
    """'8.23,124.23; 8.24,124.24' (PHP format) or JSON -> JSON [{latitude, longitude}] (app format)."""
    if raw is None or str(raw).strip() == '': return None
    s = str(raw).strip()
    if s.startswith('['):
        return s
    pts = []
    for pair in re.split(r'[;\n]+', s):
        p = [x.strip() for x in pair.split(',')]
        if len(p) == 2:
            try: pts.append({'latitude': round(float(p[0]), 6), 'longitude': round(float(p[1]), 6)})
            except ValueError: pass
    return json.dumps(pts, separators=(',', ':')) if pts else None

# table -> (order, columns to copy, {column: transform})
PLAN = [
    ('barangay_admin', 'barangay_admin_id', ['barangay_admin_id', 'firstname', 'lastname', 'email'], {}),
    ('lgu_admin', 'lgu_admin_id', ['lgu_admin_id', 'email', 'first_name', 'last_name'], {}),
    ('truck', 'truck_id', ['truck_id', 'plate_number', 'max_capacity_kg'], {}),
    ('route', 'route_id', ['route_id', 'zone_name', 'path_coordinates', 'boundary_coordinates', 'boundary_source',
                          'barangay_admin_id', 'collection_days', 'start_time', 'end_time', 'collection_mode'],
     {'path_coordinates': path_json, 'boundary_coordinates': path_json}),
    ('waste_category', 'waste_category_id', ['waste_category_id', 'category_name', 'disposal_guidelines'], {}),
    ('garbage_collector', 'garbage_collector_id', ['garbage_collector_id', 'route_id', 'truck_id', 'email', 'first_name', 'last_name'], {}),
    ('resident', 'resident_id', ['resident_id', 'email', 'first_name', 'last_name', 'contact_number', 'home_address', 'route_id'], {}),
    ('collection_point', 'collection_point_id', ['collection_point_id', 'name', 'landmark', 'route_id', 'latitude', 'longitude',
                          'location_source', 'location_confirmed', 'maps_url', 'collection_days', 'start_time', 'end_time',
                          'standby_minutes', 'stop_order', 'is_active', 'updated_at'],
     {'location_confirmed': lambda v: bool(v), 'is_active': lambda v: bool(v)}),
    ('collection_point_zone', 'collection_point_id, route_id', ['collection_point_id', 'route_id'], {}),
    ('collection_schedule', 'collection_schedule_id', ['collection_schedule_id', 'waste_category_id', 'day_of_week', 'schedule_status',
                          'barangay_admin_id', 'garbage_collector_id', 'route_id', 'start_time', 'end_time', 'schedule_type',
                          'collection_point_id', 'effective_from'], {}),
    ('pickup_log', 'pickup_log_id', ['pickup_log_id', 'collection_schedule_id', 'garbage_collector_id', 'pickup_date', 'completed_at'], {}),
    ('location_history', 'location_history_id', ['location_history_id', 'garbage_collector_id', 'latitude', 'longitude', 'timestamp'], {}),
    ('announcement', 'announcement_id', ['announcement_id', 'lgu_admin_id', 'barangay_admin_id', 'title', 'content', 'published_timestamp', 'expiry_date'], {}),
    ('feedback_report', 'feedback_report_id', ['feedback_report_id', 'lgu_admin_id', 'resident_id', 'report_type', 'description', 'status',
                          'latitude', 'longitude', 'created_at', 'barangay_id'], {}),
    ('emergency_collection', 'emergency_collection_id', ['emergency_collection_id', 'route_id', 'location_text', 'latitude', 'longitude',
                          'collection_date', 'start_time', 'end_time', 'reason', 'garbage_collector_id', 'truck_id', 'status', 'notes',
                          'created_by', 'created_at', 'updated_at', 'completed_at'], {}),
    ('reports', 'report_id', ['report_id', 'lgu_admin_id', 'report_type', 'generated_timestamp'], {}),
]

out = []
w = out.append
w('-- =====================================================================')
w('-- ECollect | Supabase setup 4 of 4: Barangay Poblacion data')
w(f'-- Copied from the MySQL database "{a.database}" on {datetime.datetime.now():%d %b %Y %H:%M} by supabase/tools/mysql_to_supabase.py')
w('-- Run ONCE, after 01-03, on an empty project. Logins are not copied (see the setup guide).')
w('-- =====================================================================')
w('begin;')
w("set local ecollect.allow_zone_change = 'on';   -- the 10 zones are inserted once, here")
w('')
existing_ids = {}
for table, order, wanted, tf in PLAN:
    if not table_exists(table):
        w(f'-- {table}: not in the MySQL database, skipped'); continue
    have = set(cols(table))
    use = [c for c in wanted if c in have]
    data = rows(table, order)
    # Drop references to rows that do not exist (the old data has a few), so the import never fails.
    w(f'-- {table}: {len(data)} row(s)')
    for r in data:
        vals = []
        for c in use:
            v = r[c]
            if c in tf: v = tf[c](v)
            if c == 'garbage_collector_id' and table != 'garbage_collector' and v is not None and v not in existing_ids.get('garbage_collector', set()):
                v = None
            if c == 'waste_category_id' and table != 'waste_category' and v is not None and v not in existing_ids.get('waste_category', set()):
                v = None
            vals.append(lit(v))
        colsql = ', '.join('"timestamp"' if c == 'timestamp' else c for c in use)
        w(f'insert into public.{table} ({colsql}) values ({", ".join(vals)});')
    key = order.split(',')[0].strip()
    existing_ids[table] = {r[key] for r in data}
    w('')

w('-- Continue numbering after the imported rows.')
for table, order, wanted, tf in PLAN:
    key = order.split(',')[0].strip()
    if ',' in order or not table_exists(table): continue
    w(f"select setval(pg_get_serial_sequence('public.{table}', '{key}'), greatest(coalesce((select max({key}) from public.{table}), 0), 1), (select count(*) > 0 from public.{table}));")
w('')
w('commit;')
w("notify pgrst, 'reload schema';")
w('')
w('-- Check: should list Zone 1 ... Zone 10.')
w('select route_id, zone_name, collection_days, start_time, end_time, collection_mode from public.route order by route_id;')
sys.stdout.write('\n'.join(out) + '\n')
