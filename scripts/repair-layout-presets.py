#!/usr/bin/env python3
"""重建 layout_presets 表：去重、从修订恢复缺失项、重置 sort_order。"""
from __future__ import annotations

import json
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / 'data' / 'cat.db'

ORDER = [6, 10, 20, 15, 24, 16, 25, 17, 26, 18, 27, 19]
RESTORE_META = {
    17: ('CRAR-教练级', 'crar-教练级'),
    18: ('CRAR-高级进阶', 'crar-高级进阶'),
    19: ('CRAR-初级救援装备维护', 'crar-初级救援装备维护'),
    20: ('CRAR-初级复核', 'crar-初级复核'),
    24: ('CRAR-中级复核', 'crar-中级复核'),
}
CRAR_GROUP_ID = 3


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def table_sql(db: sqlite3.Connection, name: str) -> str:
    row = db.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    if not row or not row[0]:
        raise RuntimeError(f'找不到表 {name}')
    return row[0]


def collect_preset_ids(db: sqlite3.Connection) -> list[int]:
    ids = set()
    for (pid,) in db.execute('SELECT DISTINCT preset_id FROM layout_preset_revisions'):
        ids.add(int(pid))
    for (pid,) in db.execute('SELECT DISTINCT id FROM layout_presets'):
        ids.add(int(pid))
    return sorted(ids)


def read_existing_row(db: sqlite3.Connection, preset_id: int) -> sqlite3.Row | None:
    try:
        return db.execute(
            'SELECT * FROM layout_presets WHERE id = ? ORDER BY rowid LIMIT 1',
            (preset_id,),
        ).fetchone()
    except sqlite3.DatabaseError:
        return None


def read_revision_row(db: sqlite3.Connection, preset_id: int) -> tuple[dict, str, str]:
    row = db.execute(
        '''
        SELECT snapshot, created_at FROM layout_preset_revisions
        WHERE preset_id = ? ORDER BY id DESC LIMIT 1
        ''',
        (preset_id,),
    ).fetchone()
    if not row:
        raise RuntimeError(f'preset {preset_id} 无修订记录')
    snap = json.loads(row[0])
    if snap.get('v') != 2:
        raise RuntimeError(f'preset {preset_id} 修订格式不支持')
    created_at = row[1] or now_iso()
    return snap, created_at, created_at


def build_row(db: sqlite3.Connection, preset_id: int, sort_order: int) -> tuple:
    existing = read_existing_row(db, preset_id)
    if existing:
        return (
            preset_id,
            existing['name'],
            existing['slug'],
            existing['layout_overrides'],
            existing['font_scale'],
            existing['show_layout_boxes'],
            existing['is_default'],
            existing['created_at'],
            existing['updated_at'],
            existing['preview_sample_row'],
            existing['svg_template_id'],
            existing['table_template_id'],
            existing['show_reference_layer'],
            existing['show_template_layer'],
            existing['page_width_mm'],
            existing['page_height_mm'],
            sort_order,
            existing['page_nav_column'],
            existing['group_id'],
        )

    if preset_id not in RESTORE_META:
        raise RuntimeError(f'preset {preset_id} 无现有行且无恢复元数据')

    name, slug = RESTORE_META[preset_id]
    snap, created_at, updated_at = read_revision_row(db, preset_id)
    return (
        preset_id,
        name,
        slug,
        json.dumps(snap.get('layout_overrides') or {}, ensure_ascii=False),
        float(snap.get('font_scale') or 1),
        1 if snap.get('show_layout_boxes') else 0,
        0,
        created_at,
        updated_at,
        json.dumps(snap.get('preview_sample_row') or {}, ensure_ascii=False),
        snap.get('svg_template_id'),
        snap.get('table_template_id'),
        1 if snap.get('show_reference_layer') else 0,
        1 if snap.get('show_template_layer', True) else 0,
        float(snap.get('page_width_mm') or 297),
        float(snap.get('page_height_mm') or 210),
        sort_order,
        snap.get('page_nav_column') or '',
        CRAR_GROUP_ID if preset_id != 6 else 2,
    )


def main() -> int:
    if not DB_PATH.exists():
        print(f'未找到数据库: {DB_PATH}', file=sys.stderr)
        return 1

    backup = DB_PATH.with_name(
        f'cat.db.before-preset-repair-{datetime.now().strftime("%Y%m%d_%H%M%S")}.db'
    )
    shutil.copy2(DB_PATH, backup)
    print(f'已备份: {backup}')

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        create_sql = table_sql(db, 'layout_presets').replace(
            'CREATE TABLE layout_presets',
            'CREATE TABLE layout_presets_new',
            1,
        )
        db.executescript(
            'DROP TABLE IF EXISTS layout_presets_new;\n'
            + create_sql
            + ';\n'
        )

        order = ORDER[:]
        for pid in collect_preset_ids(db):
            if pid not in order:
                order.append(pid)

        insert_sql = '''
          INSERT INTO layout_presets_new (
            id, name, slug, layout_overrides, font_scale, show_layout_boxes, is_default,
            created_at, updated_at, preview_sample_row, svg_template_id, table_template_id,
            show_reference_layer, show_template_layer, page_width_mm, page_height_mm,
            sort_order, page_nav_column, group_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        '''
        restored = []
        for sort_order, preset_id in enumerate(order):
            row = build_row(db, preset_id, sort_order)
            if preset_id in RESTORE_META and read_existing_row(db, preset_id) is None:
                restored.append(preset_id)
            db.execute(insert_sql, row)

        db.executescript(
            '''
            DROP TABLE layout_presets;
            ALTER TABLE layout_presets_new RENAME TO layout_presets;
            '''
        )
        seq = db.execute('SELECT MAX(id) FROM layout_presets').fetchone()[0]
        db.execute("UPDATE sqlite_sequence SET seq = ? WHERE name = 'layout_presets'", (seq,))
        db.commit()
        db.execute('VACUUM')

        rows = db.execute(
            'SELECT id, name, sort_order FROM layout_presets ORDER BY sort_order, id'
        ).fetchall()
        print(f'已恢复模板 id: {restored or "(无)"}')
        print(f'当前共 {len(rows)} 个模板:')
        for row in rows:
            print(f'  {row["sort_order"]:>2}  id={row["id"]}  {row["name"]}')
        print('integrity_check:', db.execute('PRAGMA integrity_check').fetchone()[0])
    finally:
        db.close()

    print('完成。请重启 API 后刷新布局模板库页面。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
