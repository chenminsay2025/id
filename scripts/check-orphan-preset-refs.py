#!/usr/bin/env python3
"""检查证书/行是否引用了不存在的 layout_presets.id。"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / 'data' / 'cat.db'


def main() -> int:
    db_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DB_PATH
    if not db_path.is_file():
        print(f'数据库不存在: {db_path}', file=sys.stderr)
        return 1

    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    preset_ids = {int(r[0]) for r in db.execute('SELECT id FROM layout_presets')}
    print(f'layout_presets 共 {len(preset_ids)} 条: {sorted(preset_ids)}')
    print()

    issues = []

    for row in db.execute('SELECT id, title, preset_id FROM certificates WHERE preset_id IS NOT NULL'):
        pid = int(row['preset_id'])
        if pid not in preset_ids:
            issues.append(('certificate', row['id'], row['title'], pid, None))

    for row in db.execute('''
        SELECT cr.certificate_id, c.title, cr.sort_order, cr.preset_id
        FROM certificate_rows cr
        JOIN certificates c ON c.id = cr.certificate_id
        WHERE cr.preset_id IS NOT NULL
    '''):
        pid = int(row['preset_id'])
        if pid not in preset_ids:
            issues.append((
                'certificate_row',
                row['certificate_id'],
                row['title'],
                pid,
                row['sort_order'],
            ))

    if not issues:
        print('未发现无效 preset_id 引用。')
        return 0

    print(f'发现 {len(issues)} 处无效 preset_id 引用:')
    for kind, cert_id, title, pid, sort_order in issues:
        loc = f'证书 #{cert_id}「{title}」'
        if kind == 'certificate_row':
            loc += f' 第 {sort_order + 1} 行'
        else:
            loc += '（默认布局）'
        print(f'  - {loc} → 布局模板 #{pid} 不存在')

    print()
    print('修复建议:')
    print('  1. 在服务器上运行 scripts/repair-layout-presets.py 恢复缺失的布局模板')
    print('  2. 或在后台重新为上述证书选择有效布局模板后保存')
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
