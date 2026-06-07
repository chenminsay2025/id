#!/usr/bin/env python3
"""从本地/源数据库把缺失的 layout_presets 同步到服务器/目标库。"""
from __future__ import annotations

import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def connect(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    return db


def table_columns(db: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in db.execute(f'PRAGMA table_info({table})')]


def fetch_presets(db: sqlite3.Connection) -> dict[int, sqlite3.Row]:
    return {int(row['id']): row for row in db.execute('SELECT * FROM layout_presets ORDER BY id')}


def resource_exists(db: sqlite3.Connection, table: str, row_id: int | None) -> bool:
    if row_id is None:
        return True
    return db.execute(f'SELECT 1 FROM {table} WHERE id = ?', (row_id,)).fetchone() is not None


def copy_revisions(src: sqlite3.Connection, dst: sqlite3.Connection, preset_id: int) -> int:
    rows = src.execute(
        'SELECT preset_id, snapshot, created_at FROM layout_preset_revisions WHERE preset_id = ? ORDER BY id',
        (preset_id,),
    ).fetchall()
    if not rows:
        return 0
    existing = dst.execute(
        'SELECT COUNT(*) FROM layout_preset_revisions WHERE preset_id = ?',
        (preset_id,),
    ).fetchone()[0]
    if existing:
        return 0
    ins = dst.cursor()
    for row in rows:
        ins.execute(
            'INSERT INTO layout_preset_revisions (preset_id, snapshot, created_at) VALUES (?, ?, ?)',
            (row['preset_id'], row['snapshot'], row['created_at']),
        )
    return len(rows)


def main() -> int:
    if len(sys.argv) < 3:
        print('用法: python3 scripts/sync-layout-presets.py <源库(本地)> <目标库(服务器)>', file=sys.stderr)
        print('示例: python3 scripts/sync-layout-presets.py data/cat.local.db data/cat.db', file=sys.stderr)
        return 1

    src_path = Path(sys.argv[1]).resolve()
    dst_path = Path(sys.argv[2]).resolve()
    for p in (src_path, dst_path):
        if not p.is_file():
            print(f'数据库不存在: {p}', file=sys.stderr)
            return 1

    backup = dst_path.with_name(
        f'{dst_path.name}.before-preset-sync-{datetime.now().strftime("%Y%m%d_%H%M%S")}'
    )
    shutil.copy2(dst_path, backup)
    print(f'已备份目标库: {backup}')

    src = connect(src_path)
    dst = connect(dst_path)
    try:
        src_presets = fetch_presets(src)
        dst_presets = fetch_presets(dst)
        missing_ids = sorted(set(src_presets) - set(dst_presets))

        print(f'源库 layout_presets: {len(src_presets)} 个')
        print(f'目标库 layout_presets: {len(dst_presets)} 个')
        if not missing_ids:
            print('目标库已包含源库全部布局模板，无需同步。')
            return 0

        print(f'待同步 {len(missing_ids)} 个: {missing_ids}')
        cols = [c for c in table_columns(dst, 'layout_presets') if c != 'id']
        placeholders = ', '.join('?' for _ in cols)
        col_names = ', '.join(cols)
        insert_sql = f'INSERT INTO layout_presets (id, {col_names}) VALUES (?, {placeholders})'

        synced = []
        skipped = []
        for preset_id in missing_ids:
            row = src_presets[preset_id]
            svg_id = row['svg_template_id']
            table_id = row['table_template_id']
            warnings = []
            if not resource_exists(dst, 'svg_templates', svg_id):
                warnings.append(f'SVG 模板 #{svg_id} 在目标库不存在')
            if not resource_exists(dst, 'table_templates', table_id):
                warnings.append(f'表格模板 #{table_id} 在目标库不存在')
            if warnings:
                print(f'  跳过 id={preset_id}「{row["name"]}」: {"; ".join(warnings)}')
                skipped.append(preset_id)
                continue

            values = [row[c] for c in cols]
            dst.execute(insert_sql, [preset_id, *values])
            rev_count = copy_revisions(src, dst, preset_id)
            synced.append((preset_id, row['name'], rev_count))
            print(f'  + id={preset_id}「{row["name"]}」 修订 {rev_count} 条')

        if synced:
            max_id = dst.execute('SELECT MAX(id) FROM layout_presets').fetchone()[0]
            dst.execute(
                "UPDATE sqlite_sequence SET seq = ? WHERE name = 'layout_presets'",
                (max_id,),
            )
        dst.commit()

        print()
        print(f'同步完成: 成功 {len(synced)} 个, 跳过 {len(skipped)} 个')
        if skipped:
            print('跳过的模板需先在目标库补齐 SVG/表格模板，或手动在后台重建。')
        print('请重启 API 后刷新布局模板库页面。')
        print('可运行: python3 scripts/check-orphan-preset-refs.py', dst_path)
    finally:
        src.close()
        dst.close()

    return 0 if not skipped else 2


if __name__ == '__main__':
    raise SystemExit(main())
